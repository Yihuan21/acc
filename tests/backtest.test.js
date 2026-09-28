import test from "node:test";
import assert from "node:assert/strict";
import {runBacktest} from "../backtest.js";
const bars=Array.from({length:90},(_,i)=>{const p=100+i;return{date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:p,high:p+1,low:p-1,close:p,volume:1000}});
test("buy and hold produces positive return on rising data",()=>{const r=runBacktest(bars,{capital:10000,strategy:"buyhold",feeRate:0,slippage:0,position:1});assert(r.final>10000);assert(r.cum>0);assert.equal(r.trades,1)});
test("invalid capital is rejected",()=>{assert.throws(()=>runBacktest(bars,{capital:0}),/初始资金/)});
test("insufficient data is rejected",()=>{assert.throws(()=>runBacktest([bars[0]],{}),/至少需要/)});
test("backtest handles fund-like daily NAV data",()=>{const r=runBacktest(bars.map(x=>({...x,open:x.open/100,high:x.high/100,low:x.low/100,close:x.close/100})),{capital:5000,strategy:"buyhold",feeRate:0,slippage:0});assert(r.final>5000);assert.equal(r.trades,1)});
test("benchmark starts on executable day",()=>{const r=runBacktest(bars,{capital:10000,strategy:"buyhold",feeRate:0,slippage:0});assert.equal(r.benchmark,10000*(bars.at(-1).close/bars[1].close));});
