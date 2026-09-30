import test from "node:test";
import assert from "node:assert/strict";
import {
  createSimulation,
  stepSimulation,
  jumpSimulationToDate,
  visibleBars,
  executeSimulationTrade,
  simulationEquity,
  latestTradeIndex
} from "../simulation.js";

const bars=[
  {date:"2020-01-02",open:10,high:11,low:9,close:10},
  {date:"2020-01-03",open:11,high:12,low:10,close:11},
  {date:"2020-01-06",open:9,high:10,low:8,close:9},
  {date:"2020-01-07",open:12,high:13,low:11,close:12},
  {date:"2020-01-08",open:13,high:14,low:12,close:13}
];

test("historical simulation exposes only data up to the current simulation date",()=>{
  const sim=createSimulation({symbol:"AAPL",capital:1000,bars});
  assert.equal(currentDate(sim),"2020-01-02");
  assert.deepEqual(visibleBars(sim).map(x=>x.date),["2020-01-02"]);
  stepSimulation(sim,2);
  assert.equal(currentDate(sim),"2020-01-06");
  assert.deepEqual(visibleBars(sim).map(x=>x.date),["2020-01-02","2020-01-03","2020-01-06"]);
  assert.equal(visibleBars(sim).some(x=>x.date>"2020-01-06"),false);
});

test("historical simulation rejects future-date trades",()=>{
  const sim=createSimulation({symbol:"AAPL",capital:1000,bars});
  assert.throws(()=>executeSimulationTrade(sim,{side:"buy",qty:10,price:10,date:"2020-01-08",feeRate:0}),/当前模拟日期/);
});

test("historical simulation can execute multiple trades as time advances",()=>{
  const sim=createSimulation({symbol:"AAPL",capital:1000,bars});
  executeSimulationTrade(sim,{side:"buy",qty:10,price:10,date:"2020-01-02",feeRate:0});
  stepSimulation(sim,1);
  executeSimulationTrade(sim,{side:"sell",qty:10,price:11,date:"2020-01-03",feeRate:0});
  assert.equal(sim.position.qty,0);
  assert.equal(sim.cash,1010);
  assert.equal(simulationEquity(sim),1010);
});

test("A-share historical simulation enforces lots and T+1",()=>{
  const sim=createSimulation({symbol:"600000",assetType:"stock",capital:100000,bars});
  executeSimulationTrade(sim,{side:"buy",qty:150,price:10,date:"2020-01-02",feeRate:0});
  assert.equal(sim.position.qty,100);
  assert.throws(()=>executeSimulationTrade(sim,{side:"sell",qty:100,price:11,date:"2020-01-02",feeRate:0}),/T\+1/);
  stepSimulation(sim,1);
  executeSimulationTrade(sim,{side:"sell",qty:100,price:11,date:"2020-01-03",feeRate:0});
  assert.equal(sim.position.qty,0);
  assert.equal(sim.currency,"CNY");
});

test("US replay uses USD account units and exchange suffixes still enforce A-share lots",()=>{
  const us=createSimulation({symbol:"AAPL",capital:1000,bars});
  assert.equal(us.currency,"USD");
  const ash=createSimulation({symbol:"600000.SS",assetType:"stock",capital:100000,bars});
  executeSimulationTrade(ash,{side:"buy",qty:150,price:10,date:"2020-01-02",feeRate:0});
  assert.equal(ash.position.qty,100);
});

test("date jump never exposes data after target date",()=>{
  const sim=createSimulation({symbol:"AAPL",capital:1000,bars});
  jumpSimulationToDate(sim,"2020-01-06");
  assert.equal(sim.bars[sim.currentIndex].date,"2020-01-06");
  assert.equal(visibleBars(sim).at(-1).date,"2020-01-06");
});

function currentDate(sim){return sim.bars[sim.currentIndex].date;}


test("timeline may move after a trade but never before the latest trade date",()=>{
  const sim=createSimulation({symbol:"AAPL",capital:1000,bars});
  executeSimulationTrade(sim,{side:"buy",qty:10,price:10,date:"2020-01-02",feeRate:0});
  stepSimulation(sim,3);
  assert.equal(sim.currentIndex,3);
  stepSimulation(sim,-1);
  assert.equal(sim.currentIndex,2);
  assert.equal(latestTradeIndex(sim),0);
  jumpSimulationToDate(sim,"2020-01-02");
  assert.equal(sim.currentIndex,0);
  jumpSimulationToDate(sim,"2020-01-01");
  assert.equal(sim.currentIndex,0);
});

test("A-share T+1 tracks each purchase lot instead of only the last buy date",()=>{
  const sim=createSimulation({symbol:"600000",assetType:"stock",capital:100000,bars});
  executeSimulationTrade(sim,{side:"buy",qty:100,price:10,date:"2020-01-02",feeRate:0});
  stepSimulation(sim,1);
  executeSimulationTrade(sim,{side:"buy",qty:100,price:11,date:"2020-01-03",feeRate:0});
  stepSimulation(sim,1);
  assert.throws(()=>executeSimulationTrade(sim,{side:"sell",qty:300,price:12,date:"2020-01-06",feeRate:0}),/持仓不足|T\+1|可卖数量/);
  executeSimulationTrade(sim,{side:"sell",qty:200,price:12,date:"2020-01-06",feeRate:0});
  assert.equal(sim.position.qty,0);
});

test("A-share simulation keeps each buy lot independently sellable under T+1",()=>{
  const bars=[
    {date:"2025-01-06",open:10,high:10,low:10,close:10},
    {date:"2025-01-07",open:10,high:10,low:10,close:10},
    {date:"2025-01-08",open:10,high:10,low:10,close:10}
  ];
  const sim=createSimulation({symbol:"600000",assetType:"stock",capital:10000,bars,startIndex:0});
  executeSimulationTrade(sim,{side:"buy",qty:100,price:10,date:"2025-01-06",feeRate:0});
  sim.currentIndex=1;
  executeSimulationTrade(sim,{side:"buy",qty:100,price:10,date:"2025-01-07",feeRate:0});
  sim.currentIndex=2;
  executeSimulationTrade(sim,{side:"buy",qty:100,price:10,date:"2025-01-08",feeRate:0});
  const sold=executeSimulationTrade(sim,{side:"sell",qty:200,price:10,date:"2025-01-08",feeRate:0});
  assert.equal(sold.qty,200);
  assert.equal(sim.position.qty,100);
  assert.equal(sim.position.lots.length,1);
  assert.equal(sim.position.lots[0].buyDate,"2025-01-08");
});


test("US historical simulation permits same-day round trips",()=>{
  const sim=createSimulation({symbol:"AAPL",capital:1000,bars});
  executeSimulationTrade(sim,{side:"buy",qty:10,price:10,date:"2020-01-02",feeRate:0});
  const sold=executeSimulationTrade(sim,{side:"sell",qty:10,price:10,date:"2020-01-02",feeRate:0});
  assert.equal(sold.qty,10);
  assert.equal(sim.position.qty,0);
  assert.equal(sim.cash,1000);
});

test("historical simulation rejects unknown trade directions",()=>{
  const sim=createSimulation({symbol:"AAPL",capital:1000,bars});
  assert.throws(()=>executeSimulationTrade(sim,{side:"hold",qty:1,price:10,date:"2020-01-02",feeRate:0}),/交易方向无效/);
});
