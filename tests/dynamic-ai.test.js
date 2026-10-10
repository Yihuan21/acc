import test from "node:test";
import assert from "node:assert/strict";
import {runDynamicAISimulation} from "../dynamic-ai.js";

function bars(){
  const out=[];let p=100;
  for(let i=0;i<180;i++){
    if(i<90)p=100+i*.12;
    else if(i<118)p=(100+89*.12)*Math.pow(.972,i-89);
    else p=(100+89*.12)*Math.pow(.972,118-89)*Math.pow(1.026,i-118);
    const open=i?out[i-1].close:p;
    out.push({date:new Date(Date.UTC(2022,0,1+i)).toISOString().slice(0,10),open,high:Math.max(open,p)*1.01,low:Math.min(open,p)*.99,close:p});
  }
  return out;
}

test("dynamic simulation accepts ISO dates and never sends the execution bar to the AI",async()=>{
  const seen=[];
  const report=await runDynamicAISimulation(bars(),{
    capital:100000,
    decisionMode:"ai",
    decisionEvery:5,
    monthlyReview:false,
    requestAI:async(_base,payload)=>{
      seen.push(payload);
      return {decision:{targetExposure:.7,reason:"mock AI trend decision"}};
    }
  });
  assert.ok(report.curve.length>100);
  assert.ok(report.decisions.length>0);
  assert.ok(seen.length>0,"AI request callback should be invoked");
  for(const p of seen)assert.ok(p.trainingBars.every(b=>b.date<=p.asOfDate));
  for(const d of report.decisions)assert.ok(d.date<d.executionDate);
});

test("20% drawdown protection permits staged re-entry after cooldown and confirmation",async()=>{
  const report=await runDynamicAISimulation(bars(),{
    capital:100000,
    decisionMode:"ai",
    decisionEvery:5,
    monthlyReview:false,
    requestAI:async()=>({decision:{targetExposure:.7,reason:"mock AI decision"}})
  });
  assert.ok(report.riskEvents>=1,"the falling market should trigger drawdown protection");
  const firstProtection=report.decisions.findIndex(d=>d.riskEvent);
  assert.ok(firstProtection>=0);
  const protectionDate=report.decisions[firstProtection].executionDate;
  const reentry=report.trades.find(t=>t.side==="buy"&&t.date>protectionDate&&/试仓|恢复|再平衡/.test(t.reason));
  assert.ok(reentry,"the strategy should be able to buy again after a confirmed recovery");
});

test("local quant mode makes zero AI API calls",async()=>{
  let calls=0;
  const report=await runDynamicAISimulation(bars(),{
    capital:100000,
    decisionMode:"local",
    monthlyReview:true,
    requestAI:async()=>{calls++;throw new Error("should not be called")}
  });
  assert.equal(calls,0);
  assert.equal(report.apiCalls,0);
  assert.ok(report.decisions.every(d=>d.decisionMode==="local"||d.status==="组合回撤保护"||d.status==="分阶段重新入场"||d.status==="恢复期风险保护"));
});
