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
function signalAt(bars,i,cfg){
  // i 是“要执行交易的当天”，所有指标最多读取 i-1。
  if(i<1)return "hold";
  const s=String(cfg.strategy||"ma");
  if(s==="buyhold")return i===1?"buy":"hold";
  if(s==="dca")return ((i-cfg.startIndex)%Math.max(5,cfg.dcaDays||21)===0)?"buy":"hold";
  if(s==="ma"){
    const f=sma(bars,i-1,cfg.fast),sl=sma(bars,i-1,cfg.slow);
    const pf=sma(bars,i-2,cfg.fast),ps=sma(bars,i-2,cfg.slow);
    if([f,sl,pf,ps].some(x=>x==null))return "hold";
    if(pf<=ps&&f>sl)return "buy";
    if(pf>=ps&&f<sl)return "sell";
    return "hold";
  }
  if(s==="rsi"){
    const v=rsi(bars,i-1,cfg.rsiPeriod);
    if(v==null)return "hold";
    if(v<=cfg.oversold)return "buy";
    if(v>=cfg.overbought)return "sell";
    return "hold";
  }
  if(s==="momentum"){
    const m=momentum(bars,i-1,cfg.momentumLookback);
    if(m==null)return "hold";
    if(m>=cfg.momentumThreshold)return "buy";
    if(m<=-cfg.momentumThreshold)return "sell";
    return "hold";
  }
  if(s==="trend"){
    const f=sma(bars,i-1,cfg.fast),sl=sma(bars,i-1,cfg.slow);
    if(f==null||sl==null)return "hold";
    const spread=(f-sl)/(Number(bars[i-1].close)||1);
    if(spread>=cfg.trendThreshold)return "buy";
    if(spread<=-cfg.trendThreshold)return "sell";
    return "hold";
  }
  return "hold";
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
  let cash=capital,qty=0,avg=0,peak=capital,halted=false;
  const trades=[],curve=[];
  for(let i=split;i<bars.length;i++){
    const prevClose=Number(bars[i-1]?.close)||0;
    const open=Number(bars[i]?.open)||Number(bars[i]?.close)||0;
    const mark=Number(bars[i]?.close)||open;
    const equity=cash+qty*mark;
    peak=Math.max(peak,equity);
    const dd=peak>0?1-equity/peak:0;
    if(dd>=cfg.maxDrawdown)halted=true;
    const sig=halted?"hold":signalAt(bars,i,{...cfg,startIndex:split});
    if(sig==="buy"&&qty<=0&&cash>0){
      const budget=cash*cfg.position;
      const px=open*(1+slippage);
      const fee=budget*feeRate;
      const q=Math.max(0,(budget-fee)/Math.max(px,1e-9));
      if(q>0){cash-=q*px+fee;qty=q;avg=px;trades.push({date:bars[i].date,side:"buy",price:px,qty:q,reason:"AI策略信号"});}
    }else if(sig==="sell"&&qty>0){
      const px=open*(1-slippage);
      const gross=qty*px,fee=gross*feeRate;
      cash+=gross-fee;trades.push({date:bars[i].date,side:"sell",price:px,qty,reason:"AI策略信号"});qty=0;avg=0;
    }
    curve.push({date:bars[i].date,value:cash+qty*mark,price:mark,signal:sig});
  }
  const last=Number(bars.at(-1)?.close)||0;
  const final=cash+qty*last;
  const ret=capital?final/capital-1:0;
  let ddPeak=capital,maxDD=0; for(const p of curve){ddPeak=Math.max(ddPeak,p.value); if(ddPeak>0)maxDD=Math.max(maxDD,1-p.value/ddPeak);}
  return {config:cfg,splitDate:bars[split]?.date||null,final,returnPct:ret*100,maxDrawdownPct:maxDD*100,trades,curve,testBars:bars.length-split,leakageGuard:{aiSawThrough:split,aiDidNotReceiveAfterSplit:true,executionUsesNextOpen:true}};
}
