const express = require("express");
const fetch = require("node-fetch");
const BigNumber = require("bignumber.js");
const fs = require("fs");
const monitoringCurrencies = ['velas', 'bitcoin', 'litecoin', 'ethereum', 'gobyte', 'tether', 'binance-usd', 'usd-coin', 'huobi-token', 'bnb', 'solana', 'bitorbit', 'usdv', 'pulsepad', 'velhalla', 'weway', 'swapz', 'astroswap', 'qmall-token', 'verve', 'metavpad', 'velaspad', 'wagyuswap', 'velerodao', 'multi-collateral-dai', 'cardano', 'metafame', 'polygon', 'avalanche'];
const app = express();
let cachedTicker = null;

let port = null;
let debug = false;

const TIMEOUT = parseInt(process.env.NETWORK_TIMEOUT) || 100000;
const VELAS_RPC_URL = process.env.VELAS_RPC_URL || "https://api.velas.com/rpc";
const API_KEY = process.env.CMC_API_KEY;
const REFRESH_PERIOD = parseInt(process.env.REFRESH_PERIOD) || 300000;

if (!API_KEY) {
  console.error("CMC_API_KEY env variable required");
  process.exit(1);
}

function withTimeout(func, timeoutMS = TIMEOUT) {
  return new Promise(async (resolve, reject) => {
    let isResolved = false;
    const timeout = setTimeout(() => {
      if (isResolved) return;
      isResolved = true;
      reject(new Error('Timeout'));
    }, timeoutMS);
    try {
      const res = await func();
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        resolve(res);
      } else {
        console.warn('Got result after timeout');
      }
    } catch (e) {
      if (!isResolved) {
        isResolved = true;
        reject(e);
      } else {
        console.warn('Error after timeout', e);
      }
    }
  });
}

function initParams() {
  if (process.env.HTTP_PORT) {
    port = parseInt(process.env.HTTP_PORT);
    console.log("Trying to listen to port", port, ". It's value taken from environment variable HTTP_PORT.");
  } else {
    port = 5000;
    console.log("Trying to listen to port", port, ". You can set environment variable HTTP_PORT to change it.");
  }

  if (process.env.DEBUG && process.env.DEBUG !== "false" && process.env.DEBUG !== "no" && process.env.DEBUG !== "0" && process.env.DEBUG !== "FALSE" && process.env.DEBUG !== "NO") {
    debug = true;
  }
}

async function getVlxSupplyBN() {
  try {
    const resSupply = await fetch(VELAS_RPC_URL, {
      method: 'POST',
      cache: 'no-cache',
      headers: {
        'content-type': 'application/json',
        accept: '*/*',
      },
      body: '{"method":"getSupply","jsonrpc":"2.0","params":[{"commitment":"max"}],"id":"69e8210f-1227-4a0d-a96d-c89d990bd296"}'
    });
    const jsonSupply = await resSupply.json();
    if (!jsonSupply.result || !jsonSupply.result.value || !jsonSupply.result.value.total) {
      console.log('Got invalid response when trying to getSupply', jsonSupply);
      return new BigNumber(0);
    }
    const supply = jsonSupply.result.value.total;
    if (debug) {
      console.log('Got supply', supply);
    }
    return new BigNumber(supply / 1e9 + '');
  } catch (e) {
    console.error(e);
    return new BigNumber(0);
  }
}

async function getCryptoCoinsInfo() {
  try {
    const res = await fetch(
      `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?slug=${monitoringCurrencies.join()}`,
      { headers: { 'X-CMC_PRO_API_KEY': API_KEY } }
    );
    const json = await res.json();
    const result = Object.create(null);
    for (let k in json.data) {
      const currencyUpper = json.data[k].symbol;
      result[currencyUpper.toLowerCase()] = {
        quote: json.data[k].quote,
      };
    }
    if (json?.status?.error_message) {
      console.log('cmc response', json);
    }
    return result;
  } catch (e) {
    console.error(e);
    return Object.create(null);
  }
}

function addLabPrices(prices) {
  if (!prices) {
    return;
  }
  prices.labbusd_price = prices.busd_price;
  prices.labusdt_price = prices.usdt_price;
  prices.labusdc_price = prices.usdc_price;
  prices.labeth_price = prices.eth_price;
  prices.labbnb_price = prices.bnb_price;
  prices.labmatic_price = prices.matic_price;
  prices.labavax_price = prices.avax_price;
}

function addAnyPrices(prices) {
  if (!prices) {
    return;
  }
  prices.anybusd_price = prices.busd_price;
  prices.anyusdt_price = prices.usdt_price;
  prices.anyusdc_price = prices.usdc_price;
  prices.anyeth_price = prices.eth_price;
  prices.anybnb_price = prices.bnb_price;
  prices.anymatic_price = prices.matic_price;
  prices.anyavax_price = prices.avax_price;
  prices.anydai_price = prices.dai_price;
}

function fixTotalSupply(supply) {
  if (!supply) {
    return '';
  }
  return supply + "";
}

function round(num) {
  if (!num) {
    return '';
  }
  return Math.round((num + Number.EPSILON)) + "";
}

function round6(num) {
  if (!num) {
    return '';
  }
  return Math.round((num + Number.EPSILON) * 1e6) / 1e6 + "";
}

function round8(num) {
  if (!num) {
    return '';
  }
  return (Math.round((num + Number.EPSILON) * 1e8) / 1e8).toFixed(8);
}

async function queryTicker() {
  console.log('queryTicker');
  try {
    const startAt = Date.now();
    const [supplyBN, prices] = await Promise.all([
      getVlxSupplyBN(),
      getCryptoCoinsInfo(),
    ]);
    if (!prices.vlx) return cachedTicker;
    const total_supply = fixTotalSupply(supplyBN.toNumber())
    const available_supply = total_supply;
    const volume = round(prices.vlx.quote.USD.volume_24h);
    const price_btc = round8(prices.vlx.quote.USD.price / prices.btc.quote.USD.price);
    const volume_btc = round8(prices.vlx.quote.USD.volume_24h / prices.btc.quote.USD.price);

    const price_usd = round6(prices.vlx.quote.USD.price);
    const btc_usd = round8(prices.btc.quote.USD.price);

    if (!cachedTicker) {
      cachedTicker = {};
    }
    cachedTicker.total_supply = total_supply || cachedTicker.total_supply || "0";
    cachedTicker.price_usd = price_usd || cachedTicker.price_usd || "0";
    cachedTicker.volume = volume || cachedTicker.volume || "0";
    cachedTicker.price_btc = price_btc || cachedTicker.price_btc || "0";
    cachedTicker.btc_usd = btc_usd || cachedTicker.btc_usd || "0";
    cachedTicker.volume_btc = volume_btc || cachedTicker.volume_btc || "0";
    cachedTicker.available_supply = available_supply || cachedTicker.available_supply || "0";
    cachedTicker.ts = Date.now();

    for (const currency in prices) {
      try {
        cachedTicker[`${currency}_price`] = round8(prices[currency].quote.USD.price);
        cachedTicker[`${currency}_24hdiff`] = round8(prices[currency].quote.USD.percent_change_24h);
      } catch (e) {
        console.error(`Parsing ${currency} error`, e);
      }
    }
    addLabPrices(cachedTicker);
    addAnyPrices(cachedTicker);

    if (debug) {
      console.log("Got ticker", Date.now() - startAt, new Date());
    }
  } catch (e) {
    console.error(e);
  }
  return cachedTicker;
}

async function queryTickerCached() {
  if (!cachedTicker) {
    return await queryTicker();
  }
  return cachedTicker;
}

async function refreshTickerRecursively() {
  try {
    const startAt = Date.now();
    await withTimeout(queryTicker);
    if (debug) {
      console.log('Ticker queried recurcively in ms ', Date.now() - startAt);
    }
  } catch (e) {
    console.error('Query ticker', e);
  } finally {
    setTimeout(refreshTickerRecursively, REFRESH_PERIOD);
  }
}

initParams();

refreshTickerRecursively();

function filterOut24Diff(ticker) {
  ticker = Object.assign({}, ticker);
  for (const key of Object.keys(ticker)) {
    if (key.endsWith('_24hdiff')) {
      delete ticker[key];
    }
  }
  return ticker;
}

app.get('/ticker', async (req, res, next) => {
  try {
    let ticker = await queryTickerCached();
    if (!req.query.include24hdiff) { //
      ticker = filterOut24Diff(ticker);
    }

    if (!ticker) {
      throw new Error("Error composing ticker");
    }
    res.json(ticker);
  } catch (e) {
    console.error(e);
    next(e);
  }
});

app.get('/asapi', async (req, res, next) => {
  try {
    const ticker = await queryTickerCached();
    if (!ticker) {
      throw new Error("Error composing ticker");
    }
    res.send(ticker.available_supply);
  } catch (e) {
    console.error(e);
    next(e);
  }
});

app.get('/tsapi', async (req, res, next) => {
  try {
    const ticker = await queryTickerCached();
    if (!ticker) {
      throw new Error("Error composing ticker");
    }
    res.send(ticker.total_supply);
  } catch (e) {
    console.error(e);
    next(e);
  }
});

app.get('/api/v1/stats/totalcoins', async (req, res, next) => {
  try {
    const ticker = await queryTickerCached();
    if (!ticker) {
      throw new Error("Error composing ticker");
    }
    res.send(ticker.total_supply);
  } catch (e) {
    console.error(e);
    next(e);
  }
});

app.get('/config.toml', async (req, res, next) => {
  try {
    const signer_acc = req.query.signer_acc.replace(/\W/g, '');
    const config = fs.readFileSync('config.toml').toString();
    if (signer_acc) {
      res.send(config.split('${signer_acc}').join(signer_acc));
      return;
    }
    res.send(config);
  } catch (e) {
    console.error(e);
    next(e);
  }
});
app.listen(port, () => {
  console.log("Listening");
});
