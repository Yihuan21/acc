import {optimizeAIStrategy} from "./ai-strategy.js?v=20261003-04";
// Dynamic AI portfolio simulation. Decisions see only bars strictly before the execution day.
export async function runDynamicAISimulation(bars,{capital=100000,apiBase,requestAI,feeRate=.0005,slippage=.0005,decisionEvery=5,monthlyReview=true,onProgress=()=>{}}={}){
  const clean=(Array.isArray(bars)?bars:[]).map(b=>({...b,date:String(b.date||"").slice(0,10),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)})).filter(b=>/^\\d{4}-\\d{2}-\\d{2}$/.test(b.date)&&b.open>0&&b.close>0).sort((a,b)=>a.date.localeCompare(b.date)).filter((b,i,a)=>!i||b.date!==a[i-1].date);
  if(clean.length<100)throw new Error("动态模拟至少需要100个交易日");
  let cash=Number(capital),qty=0,peak=cash,lastDecision=-99,lastMonth="",lastTrainMonth="",activeTarget=0.0,activeReason="尚未产生AI决策",lastAIStatus="待决策";
  const initial=cash,decisions=[],trades=[],curve=[],reviews=[];
  const localFallback=(prefix)=>{
    const c=prefix.map(x=>x.close),n=c.length;
    if(n<60)return {targetExposure:0,reason:"历史长度不足，安全保持现金"};
    const avg=(k)=>c.slice(-k).reduce((s,x)=>s+x,0)/k;
    const fast=avg(20),slow=avg(60),mom=c[n-1]/c[Math.max(0,n-21)]-1;
    if(fast>slow&&mom>0.01)return {targetExposure:.6,reason:"API降级：20日均线高于60日均线且20日动量为正，采用受限多头仓位"};
    if(fast<slow||mom<-.05)return {targetExposure:0,reason:"API降级：趋势转弱或动量显著为负，降至现金"};
    return {targetExposure:Math.min(activeTarget,.3),reason:"API降级：信号不明确，限制仓位并避免增加风险"};
  };
  for(let i=1;i<clean.length;i++){
    const bar=clean[i],prev=clean.slice(0,i),month=bar.date.slice(0,7);
    if(i-lastDecision>=Math.max(1,decisionEvery)){
      let decision,aiOk=false;
      // A model review can only use past bars. A monthly review is an optimization check, not permission to see future prices.
      const doMonthly=monthlyReview&&month!==lastTrainMonth&&prev.length>=120;
      let monthlyOptimization=null;
      if(doMonthly){try{monthlyOptimization=optimizeAIStrategy(prev.slice(-1200),{capital,feeRate,slippage})}catch{monthlyOptimization=null}}
      try{
        if(prev.length<60)throw new Error("历史数据尚不足60个交易日，先使用本地安全规则");
        if(typeof requestAI!=="function")throw new Error("AI请求函数不可用");
        const payload={mode:"dynamic_decision",symbol:"",assetType:"auto",asOfDate:prev.at(-1).date,trainingBars:prev.slice(-1200),account:{cash,equity:cash+qty*prev.at(-1).close,quantity:qty,exposurePct:(qty*prev.at(-1).close/Math.max(1,cash+qty*prev.at(-1).close))*100,peakEquity:peak,currentDrawdownPct:peak>0?(peak-(cash+qty*prev.at(-1).close))/peak*100:0},monthlyReview:doMonthly,monthlyOptimization:monthlyOptimization?.ok?{tested:monthlyOptimization.tested,validationRange:monthlyOptimization.validationRange,candidates:monthlyOptimization.top.slice(0,5).map(x=>({strategy:x.config.strategy,score:x.score,returnPct:x.returnPct,maxDrawdownPct:x.maxDrawdownPct}))}:null,previousDecision:activeReason};
        const answer=await requestAI(apiBase,payload);
        decision=answer?.decision;
        if(!decision||!Number.isFinite(Number(decision.targetExposure)))throw new Error("AI未返回有效目标仓位");
        aiOk=true;
        if(doMonthly){lastTrainMonth=month;reviews.push({date:prev.at(-1).date,status:"已检查",reason:String(decision.monthlyReview||"根据截至当时的历史数据完成月度模型检查。")})}
      }catch(error){
        decision=localFallback(prev);
        lastAIStatus="API失败，已安全降级";
        if(doMonthly){lastTrainMonth=month;reviews.push({date:prev.at(-1).date,status:"API失败，采用本地规则",reason:String(error?.message||error)})}
      }
      activeTarget=Math.max(0,Math.min(.7,Number(decision.targetExposure)||0));
      activeReason=String(decision.reason||"未提供决策理由").slice(0,500);
      lastDecision=i;lastAIStatus=aiOk?"AI决策":"本地规则降级";
      decisions.push({date:prev.at(-1).date,executionDate:bar.date,targetExposure:activeTarget,reason:activeReason,ai:aiOk,status:lastAIStatus,monthlyReview:doMonthly,trainingBars:prev.length});
    }
    const open=bar.open,mark=bar.close;
    let equity=cash+qty*open;
    const dd=peak>0?(peak-equity)/peak:0;
    let target=activeTarget;
    if(dd>=.2)target=0; // deterministic portfolio-level drawdown gate
    const targetValue=Math.max(0,equity*target),currentValue=qty*open,diff=targetValue-currentValue;
    if(Math.abs(diff)>Math.max(1,equity*.03)){
      if(diff>0&&cash>0){
        const budget=Math.min(cash,diff),px=open*(1+slippage),fee=budget*feeRate;
        const bought=Math.max(0,(budget-fee)/px);
        if(bought>0){cash-=bought*px+fee;qty+=bought;trades.push({date:bar.date,side:"buy",price:px,qty:bought,gross:bought*px,fee,reason:dd>=.2?"风控限制":"AI目标仓位再平衡",decisionReason:activeReason})}
      }else if(diff<0&&qty>0){
        const sellQty=Math.min(qty,-diff/open),px=open*(1-slippage),gross=sellQty*px,fee=gross*feeRate;
        cash+=gross-fee;qty-=sellQty;trades.push({date:bar.date,side:"sell",price:px,qty:sellQty,gross,fee,reason:dd>=.2?"触发20%组合回撤限制":"AI目标仓位再平衡",decisionReason:activeReason});
      }
    }
    equity=cash+qty*mark;peak=Math.max(peak,equity);
    curve.push({date:bar.date,equity,cash,qty,close:mark,drawdownPct:peak>0?(peak-equity)/peak*100:0});
    onProgress({index:i,total:clean.length,date:bar.date,decisions:decisions.length,trades:trades.length});
  }
  const final=curve.at(-1)?.equity??cash,returns=curve.map(x=>(x.equity/initial-1)*100),maxDrawdownPct=Math.max(0,...curve.map(x=>x.drawdownPct)),fees=trades.reduce((s,x)=>s+x.fee,0),benchmarkPct=(clean.at(-1).close/clean[1].open-1)*100;
  return {symbol:"",bars:clean,capital:initial,final,profit:final-initial,returnPct:(final/initial-1)*100,benchmarkPct,excessPct:(final/initial-1)*100-benchmarkPct,maxDrawdownPct,fees,trades,decisions,curve,reviews,apiStatus:lastAIStatus,settings:{decisionEvery,monthlyReview,execution:"next_open",maxExposurePct:70,drawdownLimitPct:20},leakageGuard:{executionUsesNextOpen:true,decisionBarsEndBeforeExecution:true,latestDecisionDate:decisions.at(-1)?.date||null}};
}
