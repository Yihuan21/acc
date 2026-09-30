import test from "node:test";
import assert from "node:assert/strict";
import {runBacktest} from "../backtest.js";
const bars=Array.from({length:90},(_,i)=>{const p=100+i;return{date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:p,high:p+1,low:p-1,close:p,volume:1000}});
test("buy and hold produces positive return on rising data",()=>{const r=runBacktest(bars,{capital:10000,strategy:"buyhold",feeRate:0,slippage:0,position:1});assert(r.final>10000);assert(r.cum>0);assert.equal(r.trades,1)});
test("invalid capital is rejected",()=>{assert.throws(()=>runBacktest(bars,{capital:0}),/初始资金/)});
test("insufficient data is rejected",()=>{assert.throws(()=>runBacktest([bars[0]],{}),/至少需要/)});
test("backtest handles fund-like daily NAV data",()=>{const r=runBacktest(bars.map(x=>({...x,open:x.open/100,high:x.high/100,low:x.low/100,close:x.close/100})),{capital:5000,strategy:"buyhold",feeRate:0,slippage:0});assert(r.final>5000);assert.equal(r.trades,1)});
test("benchmark starts on executable day",()=>{const r=runBacktest(bars,{capital:10000,strategy:"buyhold",feeRate:0,slippage:0});assert.equal(r.benchmark,10000*(bars.at(-1).close/bars[1].close));});

test("lot size prevents fractional execution",()=>{const r=runBacktest(bars,{capital:1000,strategy:"buyhold",feeRate:0,slippage:0,lotSize:100});assert.equal(r.tradeLog.length,0);});
test("minimum and asymmetric fees are applied",()=>{const r=runBacktest(bars,{capital:10000,strategy:"buyhold",feeRate:0,buyFeeRate:.001,sellFeeRate:.002,minFee:5,stampDutyRate:.001});assert(r.tradeLog[0].fee>=5);});

test("benchmark return is exposed",()=>{const r=runBacktest(bars,{capital:10000,strategy:"buyhold",feeRate:0,slippage:0});assert.equal(r.benchmarkReturn,(r.benchmark/10000-1)*100);});

test("A-share sized lots and sell stamp duty remain available in the engine",()=>{
  const r=runBacktest(bars,{capital:20000,strategy:"buyhold",feeRate:0,buyFeeRate:0,sellFeeRate:0,stampDutyRate:.0005,lotSize:100});
  assert.equal(r.tradeLog[0].qty,100);
  assert.equal(r.tradeLog[0].side,"buy");
});

test("sell can liquidate the remaining position even when it is below the buy lot",()=>{
  const down=Array.from({length:15},(_,i)=>100-i);
  const bars2=down.concat(Array.from({length:16},(_,i)=>86+i)).map((p,i)=>({
    date:new Date(Date.UTC(2024,0,i+1)).toISOString().slice(0,10),
    open:p,high:p+1,low:p-1,close:p,volume:1000
  }));
  const r=runBacktest(bars2,{capital:10000,strategy:"rsi",feeRate:0,slippage:0,lotSize:100});
  assert.equal(r.tradeLog[0].side,"buy");
  assert.equal(r.tradeLog[0].qty,100);
  assert.equal(r.tradeLog.at(-1).side,"sell");
  assert.equal(r.tradeLog.at(-1).qty,100);
});

test("risk output contains a drawdown curve and total fees",()=>{
  const r=runBacktest(bars,{capital:10000,strategy:"buyhold",feeRate:.001,slippage:0});
  assert.equal(r.drawdownCurve.length,bars.length);
  assert(r.fees>0);
});


test("backtest uses adjusted OHLC consistently when provided",()=>{
  const raw=[100,102,104,106,108].map((p,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:p,high:p+1,low:p-1,close:p,adjOpen:p/2,adjHigh:(p+1)/2,adjLow:(p-1)/2,adjClose:p/2,volume:1000}));
  const r=runBacktest(raw,{capital:1000,strategy:"buyhold",feeRate:0,slippage:0});
  assert.equal(r.tradeLog[0].price,51);
  assert.equal(r.final,1057);
});

test("incoherent OHLC rows are excluded from the backtest",()=>{
  const bad={date:"2025-04-01",open:100,high:90,low:95,close:100,volume:1};
  const good={date:"2025-04-02",open:100,high:101,low:99,close:100,volume:1};
  const good2={date:"2025-04-03",open:100,high:101,low:99,close:102,volume:1};
  const r=runBacktest([bad,good,good2],{capital:10000,strategy:"buyhold",feeRate:0,slippage:0});
  assert.equal(r.bars[0].date,"2025-04-02");
});

test("benchmark respects lot size, position and entry fee",()=>{
  const r=runBacktest(bars,{capital:10000,strategy:"buyhold",feeRate:0,buyFeeRate:.001,slippage:0,position:.5,lotSize:100});
  const qty=49*100;
  const gross=qty*bars[1].open;
  const fee=gross*.001;
  assert.equal(r.benchmark,10000-gross-fee+qty*bars.at(-1).close);
});
