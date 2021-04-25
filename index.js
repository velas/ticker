const express = require("express");
const fetch = require("node-fetch");
const BigNumber = require("bignumber.js");
const fs = require("fs");

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
    cmcLimit = 300;
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
    const btc = jsonCmcListing.data.find((coin) => coin.symbol === "BTC");
    const vlx = jsonCmcListing.data.find((coin) => coin.symbol === "VLX");
    if (!btc) {
      throw new Error("Btc is not found at coinmarketcap listing");
    }
    if (!vlx) {
      throw new Error("Vlx is not found at coinmarketcap listing");
    }
    return {btc, vlx};
  }catch(e) {
    console.error(e);
    return {btc: {quote: {USD: {price: 0, volume_24h: 0}}}, vlx: {quote: {USD: {price: 0, volume_24h: 0}}}};
  }
}

// async function getVlxBalanceBN(address) {
//   const res = await fetch(`${explorerUrl}?module=account&action=eth_get_balance&address=${address}`);
//   const json = await res.json();
//   const balance = json.result;
//   return new BigNumber(balance).dividedBy(1e18);
// }

function fixTotalSupply(supply) {
  return supply + "";
  // return Math.round(Math.max(2080000000, supply)) + "";
}

function round(num) {
  return Math.round((num + Number.EPSILON)) + "";
}

function round6(num) {
  return Math.round((num + Number.EPSILON) * 1e6) / 1e6 + "";
}

function round8(num) {
  return (Math.round((num + Number.EPSILON) * 1e8) / 1e8).toFixed(8);
}

async function queryTicker() {
  try {
    const startAt = Date.now();
    const [supplyBN, {btc, vlx}] = await Promise.all([
      getVlxSupplyBN(),
      getCryptoCoinsInfo(),
    ]);
    const btc_usd = round8(btc.quote.USD.price);
    console.log('btc_usd', btc.quote.USD.price, btc_usd);
    const total_supply = fixTotalSupply(supplyBN.toNumber())
    const available_supply = total_supply;
    const price_usd = round6(vlx.quote.USD.price);
    const volume = round(vlx.quote.USD.volume_24h);
    const price_btc = round8(vlx.quote.USD.price / btc.quote.USD.price);
    const volume_btc = round8(vlx.quote.USD.volume_24h / btc.quote.USD.price);

    cachedTicker = {total_supply, price_usd, volume, price_btc, volume_btc, available_supply};

    if (debug) {
      console.log("Got ticker", Date.now() - startAt, new Date());
    }
  } catch(e) {
    console.error(e);
  }
  return cachedTicker;
}

function queryTickerCached() {
  if (!tickerRefreshPromise) {
    tickerRefreshPromise = (
      queryTicker().then((ticker) => {
        setTimeout(() => { tickerRefreshPromise = null; }, 5000);
        return ticker;
      })
    );
  }
  return tickerRefreshPromise;
}


initParams();

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
