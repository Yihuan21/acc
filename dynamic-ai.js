import {optimizeAIStrategy} from "./ai-strategy.js?v=20261003-04";

// Dynamic, point-in-time portfolio simulator. Signal data ends before the execution bar.
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0}
function rsi(values,period=14){
  if(values.length<period+1)return 50;
  let up=0,down=0;
  for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>0)up+=d;else down-=d}
  return down===0?100:100-100/(1+(up/period)/(down/period||1e-12));
}
function indicators(prefix){
  const c=prefix.map(x=>x.close),n=c.length,last=c[n-1],ma=(p)=>mean(c.slice(-p));
  const ma20=ma(20),ma50=ma(50),ma60=ma(60),r=rsi(c,14),rPrev=rsi(c.slice(0,-1),14);
  const ret5=n>5?last/c[n-6]-1:0,ret20=n>20?last/c[n-21]-1:0;
  const window=c.slice(-20),sd=Math.sqrt(mean(window.map(x=>(x-mean(window))**2))),lower=ma20-2*sd;
  const tr=prefix.slice(-14).map((b)=>Math.max(b.high-b.low,Math.abs(b.high-(prefix[prefix.indexOf(b)-1]?.close||b.close)),Math.abs(b.low-(prefix[prefix.indexOf(b)-1]?.close||b.close))));
  const atrPct=last>0?mean(tr)/last:0;
  return {last,ma20,ma50,ma60,rsi:r,rsiPrev:rPrev,ret5,ret20,lower,atrPct,trendUp:ma20>ma50&&ma50>0,oversoldBounce:rPrev<32&&r>=32&&last>prefix[n-2]?.close,nearLowerBand:last<=lower*1.015};
}
function localFallback(prefix,activeTarget){
  if(prefix.length<60)return {targetExposure:0,reason:"历史长度不足60个交易日，暂不建仓"};
  const x=indicators(prefix);
  // Bottom-fishing is confirmation-based: never buy only because the price is falling.
  if(x.oversoldBounce)return {targetExposure:.2,reason:"本地量化：RSI从超卖区回升并出现价格确认，分批试探抄底，仓位上限20%"};
  if(x.nearLowerBand&&x.rsi<32&&x.ret5>-.08)return {targetExposure:.12,reason:"本地量化：接近布林下轨且RSI超卖，采用小仓位均值回归试仓"};
  if(x.trendUp&&x.ret20>.02&&x.ret5>0)return {targetExposure:.6,reason:"本地量化：20/50日均线趋势向上且动量为正，顺势持有"};
  if(x.last>x.ma20&&x.ret5>0)return {targetExposure:.35,reason:"本地量化：价格重回20日均线上方且短期动量改善，分阶段恢复仓位"};
  if(x.last<x.ma50&&x.ret20<-.08)return {targetExposure:0,reason:"本地量化：中期趋势和动量仍弱，保持现金等待止跌确认"};
  return {targetExposure:Math.min(activeTarget,.25),reason:"本地量化：趋势信号不一致，限制仓位等待更清晰的方向"};
}
export async function runDynamicAISimulation(bars,{capital=100000,apiBase,requestAI,feeRate=.0005,slippage=.0005,decisionEvery=5,monthlyReview=true,onProgress=()=>{}}={}){
  const clean=(Array.isArray(bars)?bars:[])
    .map(b=>({...b,date:String(b.date||"").slice(0,10),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)}))
    .filter(b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&b.open>0&&b.close>0)
    .sort((a,b)=>a.date.localeCompare(b.date))
    .filter((b,i,a)=>!i||b.date!==a[i-1].date);
  if(clean.length<100)throw new Error("动态模拟至少需要100个交易日");
  let cash=Number(capital),qty=0,peak=cash,riskPeak=cash,lastDecision=-99,lastTrainMonth="",activeTarget=0,activeReason="尚未产生AI决策",lastAIStatus="待决策";
  let riskPaused=false,cooldownUntil=-1,recoveryStage=0,riskEvents=0;
  const initial=cash,decisions=[],trades=[],curve=[],reviews=[];
  for(let i=1;i<clean.length;i++){
    const bar=clean[i],prev=clean.slice(0,i),month=bar.date.slice(0,7),signal=indicators(prev);
    let riskChanged=false;
    let equityAtOpen=cash+qty*bar.open;
    const totalDD=peak>0?(peak-equityAtOpen)/peak:0;
    // Trigger once per recovery cycle. Reset the local risk anchor after a circuit-breaker event,
    // otherwise the old all-time high would repeatedly force the portfolio back to zero.
    if(!riskPaused&&riskEvents===0&&totalDD>=.20){
      riskPaused=true;cooldownUntil=i+10;recoveryStage=0;riskPeak=equityAtOpen;riskEvents++;riskChanged=true;
      activeTarget=0;activeReason="组合回撤达到20%，启动10个交易日冷静期；冷静期后需出现止跌/趋势确认才分阶段重入";
      decisions.push({date:prev.at(-1).date,executionDate:bar.date,targetExposure:0,reason:activeReason,ai:false,status:"组合回撤保护",monthlyReview:false,trainingBars:prev.length,riskEvent:true});
    }
    // Re-entry is explicit and staged, based only on the prior close history.
    if(riskPaused&&i>=cooldownUntil){
      if(signal.oversoldBounce){
        riskPaused=false;recoveryStage=1;activeTarget=.15;activeReason="回撤后抄底试仓：RSI从超卖区回升并有价格确认，先恢复15%仓位";riskChanged=true;decisions.push({date:prev.at(-1).date,executionDate:bar.date,targetExposure:activeTarget,reason:activeReason,ai:false,status:"分阶段重新入场",monthlyReview:false,trainingBars:prev.length,reentry:true});lastDecision=i;
      }else if(signal.last>signal.ma20&&signal.ret5>0){
        riskPaused=false;recoveryStage=1;activeTarget=.2;activeReason="回撤后趋势恢复：收盘价站回20日均线且5日动量转正，先恢复20%仓位";riskChanged=true;decisions.push({date:prev.at(-1).date,executionDate:bar.date,targetExposure:activeTarget,reason:activeReason,ai:false,status:"分阶段重新入场",monthlyReview:false,trainingBars:prev.length,reentry:true});lastDecision=i;
      }else if(signal.nearLowerBand&&signal.rsi<32&&signal.ret5>-.08){
        riskPaused=false;recoveryStage=1;activeTarget=.1;activeReason="回撤后超卖试仓：布林下轨与RSI双重确认，先恢复10%仓位";riskChanged=true;decisions.push({date:prev.at(-1).date,executionDate:bar.date,targetExposure:activeTarget,reason:activeReason,ai:false,status:"分阶段重新入场",monthlyReview:false,trainingBars:prev.length,reentry:true});lastDecision=i;
      }
    }
    const scheduled=i-lastDecision>=Math.max(1,decisionEvery);
    if(scheduled&&!riskPaused){
      let decision,aiOk=false;
      const doMonthly=monthlyReview&&month!==lastTrainMonth&&prev.length>=120;
      let monthlyOptimization=null;
      if(doMonthly){try{monthlyOptimization=optimizeAIStrategy(prev.slice(-1200),{capital,feeRate,slippage})}catch{monthlyOptimization=null}}
      try{
        if(prev.length<60)throw new Error("历史数据尚不足60个交易日，先使用本地安全规则");
        if(typeof requestAI!=="function")throw new Error("AI请求函数不可用");
        const accountEquity=cash+qty*prev.at(-1).close;
        const answer=await requestAI(apiBase,{
          mode:"dynamic_decision",symbol:"",assetType:"auto",asOfDate:prev.at(-1).date,trainingBars:prev.slice(-1200),
          account:{cash,equity:accountEquity,quantity:qty,exposurePct:qty*prev.at(-1).close/Math.max(1,accountEquity)*100,peakEquity:peak,currentDrawdownPct:peak>0?(peak-accountEquity)/peak*100:0,riskPaused,recoveryStage,indicators:{rsi:signal.rsi,ma20:signal.ma20,ma50:signal.ma50,momentum5Pct:signal.ret5*100,momentum20Pct:signal.ret20*100,atrPct:signal.atrPct*100}},
          monthlyReview:doMonthly,
          monthlyOptimization:monthlyOptimization?.ok?{tested:monthlyOptimization.tested,validationRange:monthlyOptimization.validationRange,candidates:monthlyOptimization.top.slice(0,5).map(x=>({strategy:x.config.strategy,score:x.score,returnPct:x.returnPct,maxDrawdownPct:x.maxDrawdownPct}))}:null,
          previousDecision:activeReason
        });
        decision=answer?.decision;
        if(!decision||!Number.isFinite(Number(decision.targetExposure)))throw new Error("AI未返回有效目标仓位");
        aiOk=true;
        if(doMonthly)reviews.push({date:prev.at(-1).date,status:"候选参数已检查",reason:String(decision.monthlyReview||"使用当时及之前的历史数据检查策略候选；这不是模型权重再训练。")});
      }catch(error){
        decision=localFallback(prev,activeTarget);
        if(doMonthly)reviews.push({date:prev.at(-1).date,status:"API失败，采用本地规则",reason:String(error?.message||error)});
      }
      if(doMonthly)lastTrainMonth=month;
      // Local risk overlay caps model exposure in high-volatility/weak-trend regimes.
      let proposed=Math.max(0,Math.min(.7,Number(decision.targetExposure)||0));
      if(signal.atrPct>.06)proposed=Math.min(proposed,.2);
      else if(!signal.trendUp&&signal.last<signal.ma50)proposed=Math.min(proposed,.35);
      if(signal.oversoldBounce||signal.nearLowerBand&&signal.rsi<32)proposed=Math.min(proposed,.25);
      activeTarget=proposed;
      activeReason=String(decision.reason||"未提供决策理由").slice(0,500);
      lastDecision=i;lastAIStatus=aiOk?"AI决策":"本地规则降级";
      decisions.push({date:prev.at(-1).date,executionDate:bar.date,targetExposure:activeTarget,reason:activeReason,ai:aiOk,status:lastAIStatus,monthlyReview:doMonthly,trainingBars:prev.length,indicators:{rsi:signal.rsi,ma20:signal.ma20,ma50:signal.ma50,momentum5Pct:signal.ret5*100,momentum20Pct:signal.ret20*100,atrPct:signal.atrPct*100}});
    }else if(scheduled&&riskPaused){
      // Advance the schedule without querying the model while the risk gate is intentionally paused.
      lastDecision=i;
    }
    equityAtOpen=cash+qty*bar.open;
    const ddFromRiskPeak=riskPeak>0?(riskPeak-equityAtOpen)/riskPeak:0;
    if(!riskPaused&&recoveryStage>0&&ddFromRiskPeak>=.12){
      riskPaused=true;cooldownUntil=i+5;recoveryStage=0;riskPeak=equityAtOpen;activeTarget=0;riskChanged=true;
      activeReason="重入后相对恢复期高点回撤达到12%，再次暂停5个交易日并等待确认";
      decisions.push({date:prev.at(-1).date,executionDate:bar.date,targetExposure:0,reason:activeReason,ai:false,status:"恢复期风险保护",monthlyReview:false,trainingBars:prev.length,riskEvent:true});
    }
    let target=riskPaused?0:activeTarget;
    // First re-entry tranche is deliberately capped. Only a subsequent confirmed trend decision can scale it up.
    if(recoveryStage===1&&!riskPaused)target=Math.min(target,.25);
    const targetValue=Math.max(0,equityAtOpen*target),currentValue=qty*bar.open,diff=targetValue-currentValue;
    const scheduledRebalance=decisions.at(-1)?.executionDate===bar.date;
    if((scheduledRebalance||riskChanged||riskPaused)&&Math.abs(diff)>Math.max(1,equityAtOpen*.015)){
      if(diff>0&&cash>0){
        const budget=Math.min(cash,diff),px=bar.open*(1+slippage),fee=budget*feeRate,bought=Math.max(0,(budget-fee)/px);
        if(bought>0){cash-=bought*px+fee;qty+=bought;trades.push({date:bar.date,side:"buy",price:px,qty:bought,gross:bought*px,fee,reason:riskPaused?"风控清仓/减仓":recoveryStage?"分阶段恢复/抄底试仓":"动态目标仓位再平衡",decisionReason:activeReason})}
      }else if(diff<0&&qty>0){
        const sellQty=Math.min(qty,-diff/bar.open),px=bar.open*(1-slippage),gross=sellQty*px,fee=gross*feeRate;
        cash+=gross-fee;qty-=sellQty;trades.push({date:bar.date,side:"sell",price:px,qty:sellQty,gross,fee,reason:riskPaused?"触发组合回撤保护": "动态目标仓位再平衡",decisionReason:activeReason});
      }
    }
    const closeEquity=cash+qty*bar.close;peak=Math.max(peak,closeEquity);
    if(!riskPaused)riskPeak=Math.max(riskPeak,closeEquity);
    if(recoveryStage===1&&!riskPaused&&signal.trendUp&&signal.ret20>0)recoveryStage=2;
    curve.push({date:bar.date,equity:closeEquity,cash,qty,close:bar.close,drawdownPct:peak>0?(peak-closeEquity)/peak*100:0,riskPaused,recoveryStage});
    onProgress({index:i,total:clean.length,date:bar.date,decisions:decisions.length,trades:trades.length});
  }
  const final=curve.at(-1)?.equity??cash,maxDrawdownPct=Math.max(0,...curve.map(x=>x.drawdownPct)),fees=trades.reduce((s,x)=>s+x.fee,0),benchmarkPct=(clean.at(-1).close/clean[1].open-1)*100;
  return {symbol:"",bars:clean,capital:initial,final,profit:final-initial,returnPct:(final/initial-1)*100,benchmarkPct,excessPct:(final/initial-1)*100-benchmarkPct,maxDrawdownPct,fees,trades,decisions,curve,reviews,apiStatus:lastAIStatus,riskEvents,settings:{decisionEvery,monthlyReview,execution:"next_open",maxExposurePct:70,drawdownLimitPct:20,cooldownTradingDays:10,reentry:"staged confirmation + oversold rebound"},leakageGuard:{executionUsesNextOpen:true,decisionBarsEndBeforeExecution:true,latestDecisionDate:decisions.at(-1)?.date||null}};
}
