// AI策略助手：DeepSeek 只参与“策略发现”，实际交易信号由本地历史回放引擎生成。
// 设计约束：AI 请求只携带训练区间数据；测试区间不会发送给 AI。
// 测试阶段每个信号只读取当前交易日之前的数据，并在下一交易日开盘执行。
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||a));
const safeNum=(v,d)=>Number.isFinite(Number(v))?Number(v):d;

export async function requestAIStrategy(apiBase,payload){
  const base=String(apiBase||"").replace(/\/$/,"");
  if(!base)throw Error("未配置 Cloudflare Worker 地址");
  const response=await fetch(base+"/api/assistant",{
    method:"POST",
    headers:{"content-type":"application/json","accept":"application/json"},
    body:JSON.stringify(payload)
  });
  let data=null;
  try{data=await response.json()}catch{throw Error("AI接口返回了无效数据")}
  if(!response.ok||data?.error){const detail=data?.detail?("："+String(data.detail).slice(0,600)):"";throw Error((data?.error||("AI接口 HTTP "+response.status))+detail)}
  return data;
}

function sma(bars,i,n){
  if(i<n-1)return null;
  let s=0;for(let j=i-n+1;j<=i;j++)s+=Number(bars[j].close)||0;
  return s/n;
}
function rsi(bars,i,n){
  if(i<n)return null;
  let gain=0,loss=0;
  for(let j=i-n+1;j<=i;j++){const d=Number(bars[j].close)-Number(bars[j-1].close);if(d>0)gain+=d;else loss-=d}
  if(loss===0)return 100;
  return 100-100/(1+gain/loss);
}
function momentum(bars,i,n){
  if(i<n)return null;
  return Number(bars[i].close)/Number(bars[i-n].close)-1;
}
function decisionAt(bars,i,cfg){
  if(i<1)return {signal:"hold",reason:"样本外第一天尚不足以形成完整的前一交易日信号。"};
  const s=String(cfg.strategy||"ma"), prev=bars[i-1];
  if(s==="buyhold")return {signal:i===cfg.startIndex?"buy":"hold",reason:i===cfg.startIndex?"样本外起点执行一次买入并持有。":"继续持有，不因短期波动退出。"};
  if(s==="dca")return {signal:((i-cfg.startIndex)%Math.max(5,cfg.dcaDays||21)===0)?"buy":"hold",reason:((i-cfg.startIndex)%Math.max(5,cfg.dcaDays||21)===0)?("按每 "+cfg.dcaDays+" 个交易日一次的定投规则，在当前历史时点投入。"):"尚未到下一次定投周期。"};
  if(s==="ma"){
    const f=sma(bars,i-1,cfg.fast),sl=sma(bars,i-1,cfg.slow),pf=sma(bars,i-2,cfg.fast),ps=sma(bars,i-2,cfg.slow);
    if([f,sl,pf,ps].some(x=>x==null))return {signal:"hold",reason:"均线历史长度不足，保持空仓。"};
    if(pf<=ps&&f>sl)return {signal:"buy",reason:"前一交易日短期均线向上穿越长期均线，形成金叉。"};
    if(pf>=ps&&f<sl)return {signal:"sell",reason:"前一交易日短期均线向下跌破长期均线，形成死叉。"};
    return {signal:"hold",reason:"短期与长期均线没有形成新的交叉，继续等待。"};
  }
  if(s==="rsi"){
    const v=rsi(bars,i-1,cfg.rsiPeriod);
    if(v==null)return {signal:"hold",reason:"RSI历史长度不足。"};
    if(v<=cfg.oversold)return {signal:"buy",reason:"前一交易日 RSI 为 "+v.toFixed(1)+"，低于超卖线 "+cfg.oversold+"，触发反转买入规则。"};
    if(v>=cfg.overbought)return {signal:"sell",reason:"前一交易日 RSI 为 "+v.toFixed(1)+"，高于超买线 "+cfg.overbought+"，触发反转卖出规则。"};
    return {signal:"hold",reason:"前一交易日 RSI 位于规则区间内，没有触发交易。"};
  }
  if(s==="momentum"){
    const m=momentum(bars,i-1,cfg.momentumLookback);
    if(m==null)return {signal:"hold",reason:"动量历史长度不足。"};
    if(m>=cfg.momentumThreshold)return {signal:"buy",reason:"前一交易日 "+cfg.momentumLookback+" 日动量为 "+(m*100).toFixed(2)+"%，达到买入阈值 "+(cfg.momentumThreshold*100).toFixed(2)+"%。"};
    if(m<=-cfg.momentumThreshold)return {signal:"sell",reason:"前一交易日 "+cfg.momentumLookback+" 日动量为 "+(m*100).toFixed(2)+"%，低于卖出阈值 -"+(cfg.momentumThreshold*100).toFixed(2)+"%。"};
    return {signal:"hold",reason:"动量尚未突破设定阈值。"};
  }
  if(s==="trend"){
    const f=sma(bars,i-1,cfg.fast),sl=sma(bars,i-1,cfg.slow),close=Number(prev.close)||1;
    if(f==null||sl==null)return {signal:"hold",reason:"趋势均线历史长度不足。"};
    const spread=(f-sl)/close;
    if(spread>=cfg.trendThreshold)return {signal:"buy",reason:"前一交易日快慢均线价差为 "+(spread*100).toFixed(2)+"%，超过趋势阈值 "+(cfg.trendThreshold*100).toFixed(2)+"%。"};
    if(spread<=-cfg.trendThreshold)return {signal:"sell",reason:"前一交易日快慢均线价差为 "+(spread*100).toFixed(2)+"%，跌破趋势阈值 -"+(cfg.trendThreshold*100).toFixed(2)+"%。"};
    return {signal:"hold",reason:"趋势强度未达到交易阈值。"};
  }
  return {signal:"hold",reason:"当前策略没有产生交易信号。"};
}
function signalAt(bars,i,cfg){ return decisionAt(bars,i,cfg).signal; }


export function optimizeAIStrategy(bars,{capital=100000,feeRate=.0005,slippage=.0005}={}){
  // 只在“训练区间内部”做二次切分：前段用于参数选择，后段用于验证。
  // 最终样本外区间完全不参与优化。
  if(!Array.isArray(bars)||bars.length<120) return {ok:false,reason:"训练数据不足",candidates:[],tested:0};
  const validationStart=Math.max(60,Math.floor(bars.length*.65));
  const grid=[];
  const add=(strategy,p)=>grid.push({strategy,...p,position:.7,maxDrawdown:.2});
  for(const fast of [10,20,30])for(const slow of [50,80,120])if(fast<slow)add("ma",{fast,slow});
  for(const period of [7,14,21])for(const oversold of [25,30,35])for(const overbought of [65,70,75])add("rsi",{rsiPeriod:period,oversold,overbought});
  for(const lookback of [10,20,40,60])for(const threshold of [.03,.05,.08,.12])add("momentum",{momentumLookback:lookback,momentumThreshold:threshold});
  for(const fast of [10,20,30])for(const slow of [50,80,120])for(const threshold of [.005,.01,.02])if(fast<slow)add("trend",{fast,slow,trendThreshold:threshold});
  for(const dcaDays of [10,21,42])add("dca",{dcaDays});
  add("buyhold",{});
  const scored=[];
  for(const raw of grid){
    const r=evaluateAIWalkForward(bars,raw,{capital,feeRate,slippage,startIndex:validationStart});
    const tradePenalty=Math.max(0,2-r.closedTrades)*1.5;
    const score=r.returnPct-r.maxDrawdownPct*.65+r.excessReturnPct*.35-tradePenalty;
    scored.push({
      config:normalizeAIConfig(raw),
      score,
      returnPct:r.returnPct,
      excessReturnPct:r.excessReturnPct,
      maxDrawdownPct:r.maxDrawdownPct,
      trades:r.closedTrades,
      winRatePct:r.winRatePct
    });
  }
  scored.sort((a,b)=>b.score-a.score);
  const top=scored.slice(0,10);
  return {
    ok:true,
    tested:grid.length,
    validationStart,
    validationRange:{start:bars[validationStart]?.date||null,end:bars.at(-1)?.date||null,count:bars.length-validationStart},
    top
  };
}

export function normalizeAIConfig(raw){
  const allowed=["ma","rsi","momentum","trend","dca","buyhold"];
  const strategy=allowed.includes(raw?.strategy)?raw.strategy:"ma";
  return {
    strategy,
    fast:Math.round(clamp(raw?.fast,5,80)),
    slow:Math.round(clamp(raw?.slow,20,200)),
    rsiPeriod:Math.round(clamp(raw?.rsiPeriod,5,30)),
    oversold:Math.round(clamp(raw?.oversold,10,45)),
    overbought:Math.round(clamp(raw?.overbought,55,90)),
    momentumLookback:Math.round(clamp(raw?.momentumLookback,5,120)),
    momentumThreshold:clamp(raw?.momentumThreshold,.01,.30),
    trendThreshold:clamp(raw?.trendThreshold,.002,.08),
    dcaDays:Math.round(clamp(raw?.dcaDays,5,60)),
    position:clamp(raw?.position,.05,1),
    maxDrawdown:clamp(raw?.maxDrawdown,.03,.80)
  };
}

export function evaluateAIWalkForward(bars,raw,{capital=100000,feeRate=.0005,slippage=.0005,startIndex=0}={}){
  const cfg=normalizeAIConfig(raw);
  const split=Math.max(1,Math.min(bars.length-1,Math.floor(startIndex)));
  let cash=capital,qty=0,peak=capital,halted=false,exposureDays=0;
  const trades=[],curve=[],decisions=[];
  for(let i=split;i<bars.length;i++){
    const open=Number(bars[i]?.open)||Number(bars[i]?.close)||0;
    const mark=Number(bars[i]?.close)||open;
    const equity=cash+qty*mark;
    peak=Math.max(peak,equity);
    const dd=peak>0?1-equity/peak:0;
    if(dd>=cfg.maxDrawdown)halted=true;
    const d=halted
      ? {signal:"hold",reason:"风险控制已触发，当前回撤达到 "+(dd*100).toFixed(2)+"%，停止继续建仓。",riskHalt:true}
      : decisionAt(bars,i,{...cfg,startIndex:split});
    decisions.push({date:bars[i].date,signal:d.signal,reason:d.reason,riskHalt:Boolean(d.riskHalt),price:mark});
    if(qty>0)exposureDays++;
    if(d.signal==="buy"&&qty<=0&&cash>0&&!halted){
      const budget=cash*cfg.position,px=open*(1+slippage),fee=budget*feeRate;
      const q=Math.max(0,(budget-fee)/Math.max(px,1e-9));
      if(q>0){
        cash-=q*px+fee;
        qty=q;
        trades.push({date:bars[i].date,side:"buy",price:px,qty:q,fee,reason:d.reason,signalReason:d.reason});
      }
    }else if(d.signal==="sell"&&qty>0){
      const px=open*(1-slippage),gross=qty*px,fee=gross*feeRate;
      const entry=trades.slice().reverse().find(x=>x.side==="buy"&&!x.exitDate);
      const tradeReturn=entry&&entry.price?px/entry.price-1:null;
      cash+=gross-fee;
      const sell={date:bars[i].date,side:"sell",price:px,qty,fee,reason:d.reason,signalReason:d.reason,entryDate:entry?.date||null,entryPrice:entry?.price||null,tradeReturnPct:tradeReturn==null?null:tradeReturn*100};
      if(entry)entry.exitDate=bars[i].date;
      trades.push(sell);qty=0;
    }
    curve.push({date:bars[i].date,value:cash+qty*mark,price:mark,signal:d.signal});
  }
  const last=Number(bars.at(-1)?.close)||0;
  const final=cash+qty*last;
  const ret=capital?final/capital-1:0;
  let ddPeak=capital,maxDD=0;for(const p of curve){ddPeak=Math.max(ddPeak,p.value);if(ddPeak>0)maxDD=Math.max(maxDD,1-p.value/ddPeak);}
  const firstOpen=Number(bars[split]?.open)||Number(bars[split]?.close)||0;
  const benchmarkReturn=firstOpen>0?last/firstOpen-1:0;
  const closed=trades.filter(x=>x.side==="sell"&&Number.isFinite(x.tradeReturnPct));
  const wins=closed.filter(x=>x.tradeReturnPct>0);
  const best=closed.length?Math.max(...closed.map(x=>x.tradeReturnPct)) : 0;
  const worst=closed.length?Math.min(...closed.map(x=>x.tradeReturnPct)) : 0;
  const avgTrade=closed.length?closed.reduce((s,x)=>s+x.tradeReturnPct,0)/closed.length:0;
  const riskTriggered=decisions.some(x=>x.riskHalt);
  const review=[];
  if(ret>benchmarkReturn)review.push("样本外收益跑赢简单买入并持有基准 "+((ret-benchmarkReturn)*100).toFixed(2)+" 个百分点。");
  else review.push("样本外收益落后简单买入并持有基准 "+((benchmarkReturn-ret)*100).toFixed(2)+" 个百分点，需要检查交易时机与频繁进出成本。");
  if(closed.length)review.push("已完成 "+closed.length+" 笔平仓交易，盈利交易 "+wins.length+" 笔，胜率 "+(wins.length/closed.length*100).toFixed(1)+"%，单笔已实现收益平均 "+avgTrade.toFixed(2)+"%。");
  else review.push("样本外没有完成平仓交易，因此暂时不能用已实现交易胜率评价策略。");
  if(best>0)review.push("最好的一笔已实现交易为 "+best.toFixed(2)+"%；最差的一笔为 "+worst.toFixed(2)+"%。");
  if(maxDD*100>cfg.maxDrawdown*100*.8)review.push("最大回撤接近风险上限，后续复盘应重点检查风控触发前后的仓位暴露。");
  else review.push("最大回撤距离设定风险上限仍有空间，但这不代表未来风险一定较低。");
  return {
    config:cfg,splitDate:bars[split]?.date||null,final,profit:final-capital,returnPct:ret*100,
    benchmarkReturnPct:benchmarkReturn*100,excessReturnPct:(ret-benchmarkReturn)*100,
    maxDrawdownPct:maxDD*100,trades,curve,decisions,testBars:bars.length-split,
    closedTrades:closed.length,winRatePct:closed.length?wins.length/closed.length*100:0,
    avgTradeReturnPct:avgTrade,bestTradeReturnPct:best,worstTradeReturnPct:worst,
    exposurePct:curve.length?exposureDays/curve.length*100:0,riskTriggered,review,
    leakageGuard:{aiSawThrough:split,aiDidNotReceiveAfterSplit:true,executionUsesNextOpen:true}
  };
}
