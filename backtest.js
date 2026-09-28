export const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
export const stdev=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1))};
export const maxDrawdown=curve=>{let peak=-Infinity,dd=0,peakIndex=0,maxDuration=0;for(let i=0;i<curve.length;i++){if(curve[i]>peak){peak=curve[i];peakIndex=i}if(peak>0)dd=Math.max(dd,(peak-curve[i])/peak);maxDuration=Math.max(maxDuration,i-peakIndex)}return{maxDrawdown:dd,maxDuration}};
const cleanBars=bars=>[...(bars||[])].filter(x=>x&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(Number(x.close))&&Number(x.close)>0).map(x=>({date:x.date,open:Number.isFinite(Number(x.open))&&Number(x.open)>0?Number(x.open):Number(x.close),high:Number(x.high)||Number(x.close),low:Number(x.low)||Number(x.close),close:Number(x.close),volume:Number(x.volume)||0})).sort((a,b)=>a.date.localeCompare(b.date)).filter((x,i,a)=>i===0||x.date!==a[i-1].date);
const sma=(bars,end,n)=>end-n+1<0?null:mean(bars.slice(end-n+1,end+1).map(x=>x.close));
const rsi=(bars,end,n=14)=>{if(end<n)return null;let g=0,l=0;for(let i=end-n+1;i<=end;i++){const d=bars[i].close-bars[i-1].close;g+=Math.max(d,0);l+=Math.max(-d,0)}if(l===0)return 100;return 100-100/(1+g/l)};
export function runBacktest(raw,{capital=100000,strategy="buyhold",feeRate=0.0005,slippage=0.0005,position=1,riskFreeRate=0,assetType="auto",buyFeeRate, sellFeeRate, minFee=0, stampDutyRate=0, lotSize=1}={}){
 const bars=cleanBars(raw);capital=Number(capital);feeRate=Math.max(0,Number(feeRate)||0);slippage=Math.max(0,Number(slippage)||0);position=Math.min(1,Math.max(.01,Number(position)||1));riskFreeRate=Number(riskFreeRate)||0;const buyRate=Math.max(0,Number(buyFeeRate??feeRate)||0),sellRate=Math.max(0,Number(sellFeeRate??feeRate)||0),minimumFee=Math.max(0,Number(minFee)||0),stampRate=Math.max(0,Number(stampDutyRate)||0),lot=Math.max(.000001,Number(lotSize)||1);
 if(bars.length<2)throw Error("至少需要 2 个有效交易日");if(!Number.isFinite(capital)||capital<=0)throw Error("初始资金必须大于 0");
 let cash=capital,shares=0,tradeLog=[],curve=[],lastSignal="";
 const roundLot=n=>Math.floor((n+1e-10)/lot)*lot;const feeFor=(gross,rate,stamp=0)=>gross<=0?0:Math.max(minimumFee,gross*rate)+gross*stamp;const buy=(i,p,n)=>{n=roundLot(n);if(n<=0)return false;const px=p*(1+slippage),gross=px*n,fee=feeFor(gross,buyRate);if(gross+fee>cash+1e-8)return false;cash-=gross+fee;shares+=n;tradeLog.push({date:bars[i].date,side:"buy",price:px,qty:n,fee});return true};
 const sell=(i,p,n)=>{n=roundLot(n);if(n<=0||n>shares+1e-8)return false;const px=p*(1-slippage),gross=px*n,fee=feeFor(gross,sellRate,stampRate);cash+=gross-fee;shares-=n;if(Math.abs(shares)<1e-10)shares=0;tradeLog.push({date:bars[i].date,side:"sell",price:px,qty:n,fee});return true};
 for(let i=0;i<bars.length;i++){
   const b=bars[i];
   if(i>0){
     if(strategy==="buyhold"&&i===1){const n=(cash*position)/(b.open*(1+slippage));buy(i,b.open,n)}
     if(strategy==="dca"&&i%21===0){const budget=Math.min(cash,capital/12*position);const n=budget/(b.open*(1+slippage));buy(i,b.open,n)}
     if(strategy==="ma"&&i>=61){const fast=sma(bars,i-1,20),slow=sma(bars,i-1,60);if(fast>slow&&lastSignal!=="long"){if(shares===0){const n=(cash*position)/(b.open*(1+slippage));buy(i,b.open,n)}else if(fast<slow&&lastSignal!=="flat"){if(shares>0)sell(i,b.open,shares);lastSignal="flat"}}
     if(strategy==="rsi"&&i>=15){const v=rsi(bars,i-1,14);if(v<30&&lastSignal!=="long"){if(shares===0){const n=(cash*position)/(b.open*(1+slippage));buy(i,b.open,n)}lastSignal="long"}else if(v>70&&lastSignal!=="flat"){if(shares>0)sell(i,b.open,shares);lastSignal="flat"}}
   }
   curve.push(cash+shares*b.close);
 }
 const final=curve.at(-1),daily=curve.slice(1).map((v,j)=>curve[j]>0?v/curve[j]-1:0),rfDaily=(1+riskFreeRate/100)**(1/252)-1,excess=daily.map(x=>x-rfDaily),vol=stdev(daily)*Math.sqrt(252),sh=stdev(excess)?mean(excess)/stdev(excess)*Math.sqrt(252):0;
 const downside=stdev(daily.filter(x=>x<rfDaily)),sortino=downside?mean(excess)/downside*Math.sqrt(252):0;
 const years=Math.max(1/365,(new Date(bars.at(-1).date)-new Date(bars[0].date))/31557600000),cum=(final/capital-1)*100,cagr=(final>0?(Math.pow(final/capital,1/years)-1)*100:-100),mdd=maxDrawdown(curve);
 const benchmark=capital*(bars.at(-1).close/bars[1].close),benchmarkReturn=benchmark/capital-1,buys=tradeLog.filter(x=>x.side==="buy"),sells=tradeLog.filter(x=>x.side==="sell");
 return{bars,curve,final,cum,cagr,maxDrawdown:mdd.maxDrawdown*100,maxDrawdownDays:mdd.maxDuration,volatility:vol*100,sharpe:sh,sortino,trades:tradeLog.length,buys:buys.length,sells:sells.length,benchmark,alpha:cum-benchmarkReturn*100,benchmarkReturn:benchmarkReturn*100,tradeLog,assetType,lotSize:lot};
}
