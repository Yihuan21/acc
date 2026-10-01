// RSI reversal diagnostic: signals are generated only from data available on the signal bar.
// Future bars are used only AFTER the signal to evaluate whether it actually captured a turning point.
export function calculateRSI(bars, period=14){
  const out=Array(bars.length).fill(null);
  if(!Array.isArray(bars)||bars.length<=period)return out;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){
    const d=Number(bars[i].close)-Number(bars[i-1].close);
    gain+=Math.max(d,0); loss+=Math.max(-d,0);
  }
  let avgGain=gain/period,avgLoss=loss/period;
  out[period]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  for(let i=period+1;i<bars.length;i++){
    const d=Number(bars[i].close)-Number(bars[i-1].close);
    avgGain=(avgGain*(period-1)+Math.max(d,0))/period;
    avgLoss=(avgLoss*(period-1)+Math.max(-d,0))/period;
    out[i]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  }
  return out;
}

const finite=(v)=>Number.isFinite(Number(v))?Number(v):null;
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));

function localExtreme(bars, center, side, radius){
  const from=Math.max(0,center-radius),to=Math.min(bars.length-1,center+radius);
  let idx=from;
  for(let i=from+1;i<=to;i++){
    if(side==="bottom" ? Number(bars[i].low)<Number(bars[idx].low) : Number(bars[i].high)>Number(bars[idx].high)) idx=i;
  }
  return idx;
}

function forwardOutcome(bars,signalIndex,side,lookahead){
  const end=Math.min(bars.length-1,signalIndex+lookahead);
  if(end<=signalIndex)return null;
  const entry=Number(bars[signalIndex].close);
  if(!(entry>0))return null;
  let bestIndex=signalIndex,bestMove=0;
  for(let i=signalIndex+1;i<=end;i++){
    const px=side==="buy"?Number(bars[i].high):Number(bars[i].low);
    const move=side==="buy"?px/entry-1:1-px/entry;
    if(move>bestMove){bestMove=move;bestIndex=i;}
  }
  const finalClose=Number(bars[end].close);
  const finalMove=side==="buy"?finalClose/entry-1:1-finalClose/entry;
  return {bestIndex,bestMove,finalMove};
}

export function detectRSIReversals(bars,{period=14,oversold=30,overbought=70,minTurn=1.5}={}){
  const rsi=calculateRSI(bars,period),signals=[];
  for(let i=period+2;i<bars.length;i++){
    const a=rsi[i-2],b=rsi[i-1],c=rsi[i];
    if(a==null||b==null||c==null)continue;
    // Require a threshold excursion and an actual RSI turn, rather than every oversold/overbought bar.
    const bullish=a<=oversold && b>=a && c>b && (c-a)>=minTurn && c>oversold;
    const bearish=a>=overbought && b<=a && c<b && (a-c)>=minTurn && c<overbought;
    if(bullish)signals.push({index:i,date:bars[i].date,side:"buy",rsi:c,reason:"RSI 从超卖区向上反转"});
    if(bearish)signals.push({index:i,date:bars[i].date,side:"sell",rsi:c,reason:"RSI 从超买区向下反转"});
  }
  return {rsi,signals};
}

export function diagnoseRSIReversal(bars,options={}){
  const cfg={period:14,oversold:30,overbought:70,minTurn:1.5,lookahead:10,extremeRadius:8,targetPct:0.02,...options};
  const clean=(bars||[]).filter(b=>b&&b.date&&finite(b.close)>0&&finite(b.high)>0&&finite(b.low)>0);
  if(clean.length<cfg.period+8)throw Error("RSI诊断至少需要约 25 个有效交易日");
  const {rsi,signals}=detectRSIReversals(clean,cfg);
  const details=signals.map(s=>{
    const actual=localExtreme(clean,s.index,s.side==="buy"?"bottom":"top",cfg.extremeRadius);
    const outcome=forwardOutcome(clean,s.index,s.side,cfg.lookahead);
    const favorable=outcome?outcome.bestMove:0;
    const targetHit=favorable>=cfg.targetPct;
    const barsToExtreme=actual-s.index;
    const hindsightDistance=Math.abs(barsToExtreme);
    // Timing: signal close to the retrospectively observed turning point. 0 days = 100.
    const timingScore=clamp(100*(1-hindsightDistance/Math.max(1,cfg.extremeRadius)));
    const directionScore=targetHit?100:clamp(favorable/cfg.targetPct*100);
    const finalScore=outcome?clamp(directionScore*.6+timingScore*.4):0;
    return {...s,actualIndex:actual,actualDate:clean[actual].date,barsToExtreme,hindsightDistance,
      favorableMove:favorable*100,finalMove:(outcome?.finalMove||0)*100,targetHit,
      timingScore,directionScore,score:finalScore};
  });
  const sideStats=(side)=>{
    const a=details.filter(x=>x.side===side);
    if(!a.length)return {count:0,hitRate:0,avgScore:0,avgTiming:0,avgMove:0,avgDelay:0};
    return {count:a.length,
      hitRate:a.filter(x=>x.targetHit).length/a.length*100,
      avgScore:a.reduce((s,x)=>s+x.score,0)/a.length,
      avgTiming:a.reduce((s,x)=>s+x.timingScore,0)/a.length,
      avgMove:a.reduce((s,x)=>s+x.favorableMove,0)/a.length,
      avgDelay:a.reduce((s,x)=>s+x.barsToExtreme,0)/a.length};
  };
  const buy=sideStats("buy"),sell=sideStats("sell");
  const all=details.length?details.reduce((s,x)=>s+x.score,0)/details.length:0;
  const hit=details.length?details.filter(x=>x.targetHit).length/details.length*100:0;
  const samplePenalty=details.length<8?Math.max(0,1-(8-details.length)*.08):1;
  const diagnosticScore=clamp(all*samplePenalty);
  const verdict=details.length<8?"样本偏少，暂不能下结论":
    diagnosticScore>=70?"较多信号接近真实拐点":
    diagnosticScore>=50?"有一定拐点识别能力，但误差明显":
    "当前区间没有显示出稳定的拐点捕捉能力";
  return {config:cfg,rsi,signals:details,score:diagnosticScore,hitRate:hit,verdict,buy,sell,
    sampleSize:details.length,dataPoints:clean.length,startDate:clean[0].date,endDate:clean.at(-1).date};
}
