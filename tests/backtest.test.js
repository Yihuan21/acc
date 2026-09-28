import test from "node:test";
import assert from "node:assert/strict";
import {runBacktest} from "../backtest.js";
const bars=Array.from({length:90},(_,i)=>{const p=100+i;return{date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:p,high:p+1,low:p-1,close:p,volume:1000}});
test("buy and hold produces positive return on rising data",()=>{const r=runBacktest(bars,{capital:10000,strategy:"buyhold",feeRate:0,slippage:0,position:1});assert(r.final>10000);assert(r.cum>0);assert.equal(r.trades,1)});
test("invalid capital is rejected",()=>{assert.throws(()=>runBacktest(bars,{capital:0}),/初始资金/)});
test("insufficient data is rejected",()=>{assert.throws(()=>runBacktest([bars[0]],{}),/至少需要/)});
