const express = require("express");
const fetch = require("node-fetch");
const BigNumber = require("bignumber.js");
const fs = require("fs");
const monitoringCurrencies = ['vlx', 'btc', 'ltc', 'eth', 'gbx', 'usdt', 'busd', 'usdc', 'ht', 'bnb', 'sol' ];
const app = express();
let tickerRefreshPromise = null;
let cachedTicker = null;

let port = null;
let explorerUrl = null;
let cmcLimit = null;
let debug = false;

function initParams() {
  if (process.env.HTTP_PORT) {
    port = parseInt(process.env.HTTP_PORT);
    console.log("Trying to listen to port", port, ". It's value taken from environment variable HTTP_PORT.");
  } else {
    port = 5000;
    console.log("Trying to listen to port", port, ". You can set environment variable HTTP_PORT to change it.");
  }
  if (process.env.EXPLORER_URL) {
    explorerUrl = process.env.EXPLORER_URL;
    console.log("Using explorer url taken from environment variable EXPLORER_URL", explorerUrl);
  } else {
    explorerUrl = "http://127.0.0.1:4000/api";
    console.log("Using default explorer url. You can set environment variable EXPLORER_URL to change it", explorerUrl);
  }
  if (process.env.CMC_LIMIT) {
    cmcLimit = process.env.CMC_LIMIT;
    console.log("Using coinmarketcap limit taken from environment variable CMC_LIMIT", cmcLimit);
  } else {
    cmcLimit = 3000;
    console.log("Using coinmarketcap limit. You can set environment variable CMC_LIMIT to change it", cmcLimit);
  }

  if (process.env.DEBUG && process.env.DEBUG !== "false" && process.env.DEBUG !== "no" && process.env.DEBUG !== "0" && process.env.DEBUG !== "FALSE" && process.env.DEBUG !== "NO") {
    debug = true;
  }
}

async function getVlxSupplyBN() {
  try {
    const resSupply = await fetch(`https://mainnet.velas.com/rpc`, {
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
    return new BigNumber(supply/1e9 + '');
  } catch(e) {
    console.error(e);
    return new BigNumber(0);
  }
}

async function getCryptoCoinsInfo() {
  try {
    const resCmcListing = await fetch(`https://web-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=${cmcLimit}&start=1`);
    const jsonCmcListing = await resCmcListing.json();
    const result = Object.create(null);
    for (let currency of monitoringCurrencies) {
      const currencyUpper = currency.toUpperCase();
      result[currency] = jsonCmcListing.data.find((coin) => coin.symbol === currencyUpper);
      if (!result[currency]) {
        result[currency] = {
          quote: {
            USD: {
              price: 0,
              volume_24h: 0
            }
          }
        };
      }
    }
    return result;
  }catch(e) {
    console.error(e);
    return Object.create(null);
  }
}

// async function getVlxBalanceBN(address) {
//   const res = await fetch(`${explorerUrl}?module=account&action=eth_get_balance&address=${address}`);
//   const json = await res.json();
//   const balance = json.result;
//   return new BigNumber(balance).dividedBy(1e18);
// }

function fixTotalSupply(supply) {
  if (!supply) {
    return '';
  }
  return supply + "";
  // return Math.round(Math.max(2080000000, supply)) + "";
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
  try {
    const startAt = Date.now();
    const [supplyBN, prices] = await Promise.all([
      getVlxSupplyBN(),
      getCryptoCoinsInfo(),
    ]);
    const total_supply = fixTotalSupply(supplyBN.toNumber())
    const available_supply = total_supply;
    const volume     = round(prices.vlx.quote.USD.volume_24h);
    const price_btc  = round8(prices.vlx.quote.USD.price / prices.btc.quote.USD.price);
    const volume_btc = round8(prices.vlx.quote.USD.volume_24h / prices.btc.quote.USD.price);

    const price_usd  = round6(prices.vlx.quote.USD.price);
    const btc_usd = round8(prices.btc.quote.USD.price);

    if (!cachedTicker) {
      cachedTicker = {};
    }
    cachedTicker.total_supply = total_supply || cachedTicker.total_supply || "0";
    cachedTicker.price_usd = price_usd || cachedTicker.price_usd || "0";
    cachedTicker.volume = volume || cachedTicker.volume || "0";
    cachedTicker.price_btc = price_btc || cachedTicker.price_btc || "0";
    cachedTicker.volume_btc = volume_btc || cachedTicker.volume_btc || "0";
    cachedTicker.available_supply = available_supply || cachedTicker.available_supply || "0";

    for (const currency in prices) {
      if (currency === 'vlx') {
        continue;
      }
      try {
        cachedTicker[`${currency}_price`] = round8(prices[currency].quote.USD.price);
      }catch(e) {
        console.error(`Parsing ${currency} error`, e);
      }
    }
    if (debug) {
      console.log("Got ticker", Date.now() - startAt, new Date());
    }
  } catch(e) {
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
    await queryTicker();
    if (debug) {
      console.log('Ticker queried recurcively in ms ', Date.now() - startAt);
    }
  }catch(e) {
    console.error('Query ticker', e);
  }
  setTimeout(refreshTickerRecursively, 5000);
}

initParams();
refreshTickerRecursively();

app.get('/ticker', async (req, res, next) => {
  try {
    const ticker = await queryTickerCached();
    if (!ticker) {
      throw new Error("Error composing ticker");
    }
    res.json(ticker);
  } catch(e) {
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
  } catch(e) {
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
  } catch(e) {
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
  } catch(e) {
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
  }catch(e) {
    next(e);
  }
});
app.listen(port, () => {
  console.log("Listening");
});
