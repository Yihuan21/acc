// 自动化投资策略引擎：只使用当前及之前的历史数据生成信号，下一交易日开盘执行。
export function sma(bars,i,n){if(i+1<n)return null;let s=0;for(let j=i-n+1;j<=i;j++)s+=Number(bars[j].close)||0;return s/n}
export function rsi(bars,i,n=14){if(i<n)return null;let gain=0,loss=0;for(let j=i-n+1;j<=i;j++){const d=Number(bars[j].close)-Number(bars[j-1].close);if(d>0)gain+=d;else loss-=d}if(loss===0)return 100;return 100-100/(1+gain/loss)}
export function atr(bars,i,n=14){if(i<n)return null;let sum=0;for(let j=i-n+1;j<=i;j++){const b=bars[j],p=bars[j-1];sum+=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close))}return sum/n}
export function momentum(bars,i,n=20){if(i<n)return null;return bars[i].close/bars[i-n].close-1}
export function strategySignal(bars,i,strategy){
  if(i<1)return {signal:"hold",strength:0,reason:"数据不足"};
  const s=String(strategy||"ma");
  if(s==="dca")return {signal:i%21===0?"buy":"hold",strength:i%21===0?1:0,reason:i%21===0?"定期投入日":"等待下一投入日"};
  if(s==="ma"){
    const f=sma(bars,i-1,20),sl=sma(bars,i-1,60),pf=sma(bars,i-2,20),ps=sma(bars,i-2,60);
    if(f==null||sl==null||pf==null||ps==null)return {signal:"hold",strength:0,reason:"均线数据不足"};
    if(pf<=ps&&f>sl)return {signal:"buy",strength:1,reason:"20日均线上穿60日均线"};
    if(pf>=ps&&f<sl)return {signal:"sell",strength:1,reason:"20日均线下穿60日均线"};
    return {signal:"hold",strength:0,reason:f>sl?"趋势向上":"趋势向下"};
  }
  if(s==="rsi"){
    const v=rsi(bars,i-1,14);if(v==null)return {signal:"hold",strength:0,reason:"RSI数据不足"};
    if(v<30)return {signal:"buy",strength:Math.min(1,(30-v)/20+0.5),reason:"RSI超卖"};
    if(v>70)return {signal:"sell",strength:Math.min(1,(v-70)/20+0.5),reason:"RSI超买"};
    return {signal:"hold",strength:0,reason:"RSI中性"};
  }
  if(s==="momentum"){
    const m=momentum(bars,i-1,20);if(m==null)return {signal:"hold",strength:0,reason:"动量数据不足"};
    if(m>0.05)return {signal:"buy",strength:Math.min(1,m/0.2),reason:"20日动量转强"};
    if(m<-0.05)return {signal:"sell",strength:Math.min(1,Math.abs(m)/0.2),reason:"20日动量转弱"};
    return {signal:"hold",strength:0,reason:"动量中性"};
  }
  if(s==="trend"){
    const f=sma(bars,i-1,20),sl=sma(bars,i-1,60),a=atr(bars,i-1,14),p=bars[i-1].close;
    if(f==null||sl==null||a==null)return {signal:"hold",strength:0,reason:"趋势数据不足"};
    const spread=(f-sl)/p;
    if(spread>0.01)return {signal:"buy",strength:Math.min(1,spread/0.05),reason:"趋势强度为正"};
    if(spread<-0.01)return {signal:"sell",strength:Math.min(1,Math.abs(spread)/0.05),reason:"趋势强度转弱"};
    return {signal:"hold",strength:0,reason:"趋势不明确"};
  }
  return {signal:"hold",strength:0,reason:"等待信号"};
}
export function strategyLabel(s){return ({dca:"智能定投",ma:"双均线趋势",rsi:"RSI反转",momentum:"动量突破",trend:"趋势跟随",buyhold:"买入并持有"})[s]||"自动策略"}
export function generateStrategyPlan(bars,{strategy="ma",initialCash=100000,position=1,maxDrawdown=0.2}={}){
  const plan=[];let invested=false;
  for(let i=1;i<bars.length;i++){
    const sig=strategySignal(bars,i,strategy);
    if(sig.signal==="buy"&&!invested){plan.push({index:i,date:bars[i].date,side:"buy",strength:sig.strength,reason:sig.reason,price:bars[i].open});invested=true}
    else if(sig.signal==="sell"&&invested){plan.push({index:i,date:bars[i].date,side:"sell",strength:sig.strength,reason:sig.reason,price:bars[i].open});invested=false}
    if(strategy==="dca"&&sig.signal==="buy")plan[plan.length-1].budget=Math.min(initialCash/12,initialCash*position);
  }
  return plan;
}
