import {DataAPI} from "./data.js?v=20260930-08";
import {runBacktest} from "./backtest.js?v=20260930-08";
import {createSimulation,currentBar,visibleBars,stepSimulation,jumpSimulationToDate,executeSimulationTrade,simulationEquity,simulationReturn} from "./simulation.js?v=20260930-08";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const money=(v,c="CNY")=>{const cur=String(c||"CNY").toUpperCase();return new Intl.NumberFormat(cur==="USD"?"en-US":"zh-CN",{style:"currency",currency:cur==="USD"?"USD":"CNY",maximumFractionDigits:2}).format(Number(v)||0)};
const num=v=>Number(v||0).toLocaleString("en-US",{maximumFractionDigits:4}), iso=d=>new Date(d).toISOString().slice(0,10);
const BUILTIN_API=String(window.__INVESTMENT_API__||"https://investment-simulator-api.yihuanchen219.workers.dev").trim().replace(/\/$/,"");
const defaults={cash:100000,initialCash:100000,positions:{},trades:[],recent:[],csv:{},simulation:null,settings:{apiBase:BUILTIN_API,usdCny:7.2}};
let state;try{state=JSON.parse(localStorage.getItem("invest-sim")||"null")||structuredClone(defaults)}catch{state=structuredClone(defaults)}
state.settings=state.settings&&typeof state.settings==="object"?state.settings:{};
state.settings.apiBase=String(state.settings.apiBase||BUILTIN_API).trim().replace(/\/$/,"");
state.settings.usdCny=Number(state.settings.usdCny)||7.2;
state.positions=state.positions&&typeof state.positions==="object"?state.positions:{};
state.trades=Array.isArray(state.trades)?state.trades:[];
state.recent=Array.isArray(state.recent)?state.recent:[];
state.csv=state.csv&&typeof state.csv==="object"?state.csv:{};
state.simulation=state.simulation&&typeof state.simulation==="object"?state.simulation:null;
if(state.simulation)state.simulation.playing=false;
state.cash=Number.isFinite(Number(state.cash))?Number(state.cash):100000;
state.initialCash=Number.isFinite(Number(state.initialCash))?Number(state.initialCash):state.cash;
const save=()=>localStorage.setItem("invest-sim",JSON.stringify(state));
const toast=m=>{const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),3600)};
const buttonText=b=>b?.dataset.originalText||b?.textContent||"";
function setButtonBusy(b,busy,label="处理中…"){if(!b)return;if(busy){if(!b.dataset.originalText)b.dataset.originalText=buttonText(b);b.disabled=true;b.classList.add("is-busy");b.setAttribute("aria-busy","true");if(label)b.textContent=label}else{b.disabled=false;b.classList.remove("is-busy");b.removeAttribute("aria-busy");if(b.dataset.originalText){b.textContent=b.dataset.originalText;delete b.dataset.originalText}}}
function flashButton(b,ok=true){if(!b)return;b.classList.remove("is-success","is-error");void b.offsetWidth;b.classList.add(ok?"is-success":"is-error");setTimeout(()=>b.classList.remove("is-success","is-error"),900)}
document.addEventListener("click",e=>{const b=e.target.closest("button");if(!b||b.disabled)return;b.classList.add("is-pressed");setTimeout(()=>b.classList.remove("is-pressed"),180)},true);
document.addEventListener("submit",e=>{const b=e.submitter;if(!b)return;setButtonBusy(b,true,"处理中…");clearTimeout(b.__busyTimer);b.__busyTimer=setTimeout(()=>setButtonBusy(b,false),1500)},true);const api=()=>new DataAPI(state.settings);
const quoteCacheKey=s=>String(s||"").trim().toUpperCase();
const cachedQuote=s=>{try{return JSON.parse(localStorage.getItem("invest-quote:"+quoteCacheKey(s))||"null")}catch{return null}};
const rememberQuote=(s,q)=>{try{localStorage.setItem("invest-quote:"+quoteCacheKey(s),JSON.stringify({...q,cachedAt:Date.now()}))}catch{}};

window.addEventListener("error",e=>{if(e?.message)toast("应用错误："+e.message)});
window.addEventListener("unhandledrejection",e=>{const m=e?.reason?.message||String(e?.reason||"");if(m)toast("操作失败："+m)});

function go(id){const page=$("#"+id);if(!page)return toast("页面加载异常："+id);$$(".page").forEach(x=>x.classList.toggle("active",x.id===id));$$(".tab").forEach(x=>x.classList.toggle("active",x.dataset.go===id));render();window.scrollTo({top:0,behavior:"instant"})}
$$("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
function assetType(raw){return String(raw||"auto").toLowerCase()}
function assetLabel(t){return t==="fund"?"基金":t==="etf"?"ETF":t==="stock"?"股票":"标的"}
function isAShareStock(raw,type="auto"){const s=String(raw||"").trim();return (type==="stock"||type==="auto") && /^(60|68|00|30)\d{4}$/.test(s)}
function aShareLot(raw){return /^68\d{4}$/.test(String(raw||"").trim())?200:100}
function localDate(){const d=new Date(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return d.getFullYear()+"-"+m+"-"+day}
function sym(raw,type="auto"){const s=String(raw||"").trim().toUpperCase();if(/^\d{6}$/.test(s)){if(type==="fund")return s;if(/^(60|68|5)/.test(s))return s+".SS";if(/^(00|30|15|16|18)/.test(s))return s+".SZ"}return s}
async function quote(s,t="auto"){const q=await api().quote(sym(s,t),{assetType:t});rememberQuote(sym(s,t),q);return q}
async function history(s,a,b,t="auto"){const k=sym(s,t),local=state.csv[k];if(local&&local.length){const x=local.filter(v=>(!a||v.date>=a)&&(!b||v.date<=b));if(x.length>1)return x}return api().history(k,a,b,t)}
function positionValue(){return Object.values(state.positions).reduce((a,p)=>a+(p.currency==="USD"?p.qty*p.price*Number(state.settings.usdCny||7.2):p.qty*p.price),0)}
function renderSimulation(){
  const s=state.simulation,empty=$("#simEmpty"),wrap=$("#simWorkspace");
  if(!empty||!wrap)return;
  if(!s){empty.hidden=false;wrap.hidden=true;$("#simLoadForm").hidden=false;return}
  empty.hidden=true;wrap.hidden=false;$("#simLoadForm").hidden=true;
  const bar=currentBar(s),eq=simulationEquity(s),ret=simulationReturn(s);
  $("#simDate").textContent=bar?.date||"—";
  $("#simPrice").textContent=bar?num(bar.close):"—";
  $("#simOpen").textContent=bar?num(bar.open):"—";
  $("#simHigh").textContent=bar?num(bar.high):"—";
  $("#simLow").textContent=bar?num(bar.low):"—";
  $("#simCash").textContent=money(s.cash,s.currency);
  $("#simEquity").textContent=money(eq,s.currency);
  $("#simReturn").textContent=(ret>=0?"+":"")+ret.toFixed(2)+"%";
  $("#simQty").textContent=num(s.position?.qty||0);
  $("#simAvg").textContent=num(s.position?.avg||0);
  $("#simProgress").max=Math.max(1,s.bars.length-1);$("#simProgress").value=s.currentIndex;
  $("#simProgressText").textContent=(s.currentIndex+1)+" / "+s.bars.length;
  $("#simRangeInfo").textContent="当前已解锁："+(s.currentIndex+1)+" 个交易日 · 当前时点 "+bar.date+" · 后续数据未解锁";
  $("#simTradePrice").value=bar?String(bar.close):"";
  $("#simKline").innerHTML=klineSVG(visibleBars(s));
  $("#simTrades").innerHTML=s.trades.length?s.trades.slice().reverse().map(t=>'<div class="row"><span><b>'+(t.side==="buy"?"买入":"卖出")+' '+s.symbol+'</b><small>'+t.date+' · '+num(t.qty)+' × '+num(t.price)+' · 费用 '+num(t.fee)+'</small></span><span>'+money(t.gross,s.currency)+'</span></div>').join(""):'<div class="empty">当前历史时点还没有交易</div>';
  const lastTradeIndex=s.trades.length?Math.max(...s.trades.map(t=>s.bars.findIndex(b=>b.date===String(t.date||"").slice(0,10)))):-1;
  $("#simPrev").disabled=s.currentIndex<=0||s.currentIndex<=lastTradeIndex;$("#simNext").disabled=s.currentIndex>=s.bars.length-1;
  $("#simStep5").disabled=s.currentIndex>=s.bars.length-1;$("#simStep20").disabled=s.currentIndex>=s.bars.length-1;
  $("#simPlay").textContent=s.playing?"暂停":"播放";
}
function render(){
 const mv=positionValue(),tot=state.cash+mv;$("#cash").textContent=money(state.cash);$("#marketValue").textContent=money(mv);$("#totalAssets").textContent=money(tot);$("#portfolioCash").textContent=money(state.cash);$("#portfolioTotal").textContent=money(tot);
 const ps=Object.values(state.positions);
 $("#dashboardPositions").innerHTML=ps.length?ps.map(p=>'<div class="row"><span><b>'+p.symbol+'</b><small>'+num(p.qty)+' · 成本 '+num(p.avg)+'</small></span><b>'+money(p.qty*p.price,p.currency)+'</b></div>').join(""):'<div class="empty">还没有模拟持仓</div>';
 $("#positions").innerHTML=ps.length?ps.map(p=>'<div class="row"><span><b>'+p.symbol+'</b><small>'+num(p.qty)+' · 成本 '+num(p.avg)+' · 最新 '+num(p.price)+'</small></span><strong class="'+(p.price>=p.avg?"positive":"negative")+'">'+money((p.price-p.avg)*p.qty,p.currency)+'</strong></div>').join(""):'<div class="panel empty">暂无持仓</div>';
 $("#trades").innerHTML=state.trades.length?state.trades.slice().reverse().slice(0,50).map(t=>'<div class="row"><span><b>'+(t.side==="buy"?"买入":"卖出")+' '+t.symbol+'</b><small>'+new Date(t.time).toLocaleString()+' · '+num(t.qty)+' × '+num(t.price)+'</small></span><span>'+money(t.total,t.currency)+'</span></div>').join(""):'<div class="empty">暂无交易</div>';
 $("#recentSymbols").innerHTML=state.recent.map(s=>'<button class="chip" data-symbol="'+s+'">'+s+"</button>").join("")||'<span class="muted">暂无记录</span>';
 $$("[data-symbol]").forEach(b=>b.onclick=()=>{$("#symbolInput").value=b.dataset.symbol;$("#quoteForm").requestSubmit()});
 const keys=Object.keys(state.csv);$("#csvInfo").textContent=keys.length?keys.map(k=>k+": "+state.csv[k].length+" 条").join(" · "):"尚未导入数据";
 renderSimulation();
}
$("#quoteForm").onsubmit=async e=>{e.preventDefault();const raw=$("#symbolInput").value.trim(),t=assetType($("#marketType").value);if(!raw)return toast("请输入代码");try{toast("正在获取行情…");const q=await quote(raw,t),k=sym(raw,t),c=q.currency||((t==="fund"||/^\\d{6}$/.test(raw))?"CNY":"USD");state.recent=[k,...state.recent.filter(x=>x!==k)].slice(0,10);save();$("#quoteResult").innerHTML='<div class="panel"><div class="muted">'+q.symbol+" · "+q.name+" · "+assetLabel(q.assetType||t)+'</div><div class="quote-main">'+(c==="USD"?"$":"¥")+num(q.price)+'</div><div class="'+(q.change>=0?"positive":"negative")+'">'+(q.change>=0?"+":"")+num(q.change)+"（"+(q.changePct>=0?"+":"")+q.changePct.toFixed(2)+"%）"+'</div><div class="asset-row"><span>最高 <b>'+num(q.high)+'</b></span><span>最低 <b>'+num(q.low)+'</b></span><span>币种 <b>'+c+"</b></span></div></div>";render();try{await loadKline(raw,t,$("#klineRange .chip.active")?.dataset.range||"3m")}catch(x){$("#klineInfo").textContent="K线加载失败："+x.message;$("#klineChart").innerHTML=""}}catch(x){toast("行情获取失败："+x.message);$("#quoteResult").innerHTML='<div class="panel"><b>获取失败</b><p class="muted">'+x.message+'</p><p class="muted">如果使用 GitHub Pages，请到「设置」填写 Cloudflare Worker API 地址。</p></div>'}};
$$("[data-range]").forEach(b=>b.onclick=async()=>{const active=$$("#klineRange .chip");active.forEach(x=>x.classList.toggle("active",x===b));const raw=$("#symbolInput").value.trim(),t=assetType($("#marketType").value);if(!raw)return toast("请先查询标的");try{b.disabled=true;await loadKline(raw,t,b.dataset.range)}catch(x){$("#klineInfo").textContent="K线加载失败："+x.message}finally{b.disabled=false}});
$$("[data-kline-mode]").forEach(b=>b.onclick=async()=>{const raw=$("#symbolInput").value.trim(),t=assetType($("#marketType").value);if(!raw)return toast("请先查询标的");$("[data-kline-mode]").forEach(x=>x.classList.toggle("active",x===b));try{b.disabled=true;if(b.dataset.klineMode==="intraday")await loadIntraday(raw,t);else await loadKline(raw,t,$("#klineRange .chip.active")?.dataset.range||"3m")}catch(x){$("#klineInfo").textContent="行情图加载失败："+x.message;$("#klineChart").innerHTML=""}finally{b.disabled=false}});$("#tradeForm").onsubmit=async e=>{e.preventDefault();const raw=$("#tradeSymbol").value.trim(),t=assetType($("#tradeType").value),k=sym(raw,t),side=$("#tradeSide").value;let qty=Number($("#tradeQty").value),fr=Math.max(0,Number($("#tradeFee").value)||0);if(!k||qty<=0)return toast("请填写交易信息");const aShare=isAShareStock(raw,t),lot=aShare?aShareLot(raw):1;try{let price=Number($("#tradePrice").value),cur="CNY";if(!price){try{const q=await quote(k,t);price=q.price;cur=q.currency||((t==="fund"||aShare)?"CNY":"USD")}catch(liveError){const cached=cachedQuote(k),existing=state.positions[k];if(cached&&Number.isFinite(Number(cached.price))){price=Number(cached.price);cur=cached.currency||((t==="fund"||aShare)?"CNY":"USD");toast("实时行情暂不可用，已使用最近缓存价格")}else if(existing&&Number.isFinite(Number(existing.price))&&Number(existing.price)>0){price=Number(existing.price);cur=existing.currency||((t==="fund"||aShare)?"CNY":"USD");toast("实时行情暂不可用，已使用持仓最新价格")}else{throw new Error("实时价格获取失败，请在“成交价”中手动输入价格（原始错误："+(liveError?.message||liveError)+"）")}}}else{cur=(t==="fund"||aShare)?"CNY":"USD"}const p=state.positions[k]||{symbol:k,qty:0,avg:0,price,currency:cur,assetType:t,lots:[]};if(!Array.isArray(p.lots)){p.lots=[];if(Number(p.qty)>0)p.lots.push({qty:Number(p.qty),buyDate:String(p.lastBuyDate||"")})}if(aShare){qty=Math.floor(qty/lot)*lot;if(qty<=0)return toast("A股交易数量需为"+lot+"股的整数倍");if(side==="sell"){const sellable=p.lots.filter(x=>String(x.buyDate)<localDate()).reduce((sum,x)=>sum+Number(x.qty||0),0);if(qty>p.qty)return toast("持仓不足");if(qty>sellable)return toast("A股实行T+1，今日买入的持仓不能今日卖出")}}const stamp=aShare&&side==="sell"?0.0005:0;const gross=price*qty,fee=gross*fr+gross*stamp,fx=cur==="USD"?Number(state.settings.usdCny||7.2):1,cost=(gross+fee)*fx,proceeds=(gross-fee)*fx;if(side==="buy"){if(cost>state.cash)return toast("现金不足");p.avg=(p.avg*p.qty+gross+fee)/(p.qty+qty);p.qty+=qty;p.lastBuyDate=localDate();p.lots.push({qty,buyDate:localDate()});state.cash-=cost}else{if(qty>p.qty)return toast("持仓不足");state.cash+=proceeds;let remain=qty;for(const lotItem of p.lots){if(remain<=0)break;if(aShare&&String(lotItem.buyDate)>=localDate())continue;const used=Math.min(Number(lotItem.qty||0),remain);lotItem.qty-=used;remain-=used}p.lots=p.lots.filter(x=>Number(x.qty)>0);p.qty-=qty}if(p.qty<=0){p.qty=0;p.avg=0;p.lastBuyDate="";p.lots=[]}p.price=price;p.currency=cur;p.assetType=p.assetType||t;if(p.qty)state.positions[k]=p;else delete state.positions[k];state.trades.push({symbol:k,side,qty,price,total:gross,fee,currency:cur,cashImpact:side==="buy"?-cost:proceeds,time:Date.now(),assetType:t,stampDuty:stamp});save();render();toast(aShare?"模拟交易已执行（A股规则）":"模拟交易已执行")}catch(x){console.error(x);toast("交易失败："+x.message);}};
function maValues(bars,n){return bars.map((_,i)=>i+1<n?null:bars.slice(i-n+1,i+1).reduce((s,x)=>s+x.close,0)/n)}
function normalizeKlineBars(bars){
  return (bars||[]).map(b=>{
    const close=Number(b.close);
    const open=Number.isFinite(Number(b.open))&&Number(b.open)>0?Number(b.open):close;
    const high=Number.isFinite(Number(b.high))&&Number(b.high)>0?Number(b.high):Math.max(open,close);
    const low=Number.isFinite(Number(b.low))&&Number(b.low)>0?Number(b.low):Math.min(open,close);
    return {...b,open,high:Math.max(high,open,close),low:Math.min(low,open,close),close};
  }).filter(b=>b.date&&Number.isFinite(b.close)&&b.close>0&&Number.isFinite(b.open)&&Number.isFinite(b.high)&&Number.isFinite(b.low));
}
function escapeHTML(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function klinePointHTML(b,prev,type="daily"){
  const change=prev&&Number(prev.close)>0?(Number(b.close)/Number(prev.close)-1)*100:0;
  const time=type==="intraday"?(b.date+" "+b.time):b.date;
  return '<div class="kline-point-title">'+escapeHTML(time)+'</div><div class="kline-point-grid"><span>开 <b>'+num(b.open)+'</b></span><span>高 <b>'+num(b.high)+'</b></span><span>低 <b>'+num(b.low)+'</b></span><span>收 <b>'+num(b.close)+'</b></span><span>涨跌 <b class="'+(change>=0?"positive":"negative")+'">'+(change>=0?"+":"")+change.toFixed(2)+'%</b></span><span>成交量 <b>'+num(b.volume||0)+'</b></span></div>';
}
function klineSVG(bars,{type="daily"}={}){
  const data=normalizeKlineBars(bars).slice(-600),W=1100,H=430,pl=58,pr=18,pt=18,pb=42;
  if(!data.length)return "";
  const highs=data.map(x=>x.high),lows=data.map(x=>x.low),hi=Math.max(...highs),lo=Math.min(...lows),span=hi-lo||1;
  const chartH=H-pt-pb,step=(W-pl-pr)/Math.max(1,data.length),body=Math.max(2,Math.min(10,step*.62));
  const y=v=>pt+(hi-v)/span*chartH, x=i=>pl+(i+.5)*step;
  const grid=[0,.25,.5,.75,1].map(t=>{const yy=pt+t*chartH,val=hi-t*span;return '<line class="kline-grid" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+yy+'" y2="'+yy+'"/><text class="kline-axis" x="4" y="'+(yy+4)+'">'+num(val)+'</text>'}).join("");
  const candles=data.map((b,i)=>{
    const xx=x(i),yyO=y(b.open),yyC=y(b.close),yyH=y(b.high),yyL=y(b.low),up=b.close>=b.open,cls=up?"kline-up":"kline-down";
    const top=Math.min(yyO,yyC),height=Math.max(1,Math.abs(yyC-yyO));
    return '<line class="'+cls+'" x1="'+xx+'" x2="'+xx+'" y1="'+yyH+'" y2="'+yyL+'"/><rect class="'+cls+'" x="'+(xx-body/2)+'" y="'+top+'" width="'+body+'" height="'+height+'"/>';
  }).join("");
  const maPath=type==="daily"?((n,cls)=>{const vals=maValues(data,n),pts=vals.map((v,i)=>v==null?null:[x(i),y(v)]).filter(Boolean);return pts.length>1?'<polyline class="'+cls+'" points="'+pts.map(p=>p.join(",")).join(" ")+'"/>':""}):(()=> "");  
  const labels=[0,Math.floor(data.length/3),Math.floor(data.length*2/3),data.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>'<text class="kline-axis" text-anchor="middle" x="'+x(i)+'" y="'+(H-12)+'">'+escapeHTML(type==="intraday"?data[i].time:data[i].date)+'</text>').join("");
  const hitAreas=data.map((b,i)=>'<rect class="kline-hit" data-kline-index="'+i+'" x="'+(x(i)-Math.max(step/2,8))+'" y="'+pt+'" width="'+Math.max(step,16)+'" height="'+chartH+'" fill="transparent"/>').join("");
  return '<div class="kline-interactive" data-kline-type="'+type+'"><div class="kline-scroll"><svg class="kline-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="'+(type==="intraday"?"分时K线":"日K线")+'">'+grid+candles+(type==="daily"?maPath(5,"kline-ma5")+maPath(20,"kline-ma20")+maPath(60,"kline-ma60"):"")+labels+hitAreas+'</svg></div><div class="kline-tooltip" hidden></div><div class="kline-legend"><span>'+ (type==="intraday"?"5分钟K · 当日":"日K · 每个交易日") +'</span>'+(type==="daily"?'<span>MA5</span><span>MA20</span><span>MA60</span>':"")+'<span>移动/点按图表查看精确坐标</span></div></div>';
}
function bindKlineInteraction(root,bars,type="daily"){
  if(!root)return;
  const data=normalizeKlineBars(bars).slice(-600),tooltip=root.querySelector(".kline-tooltip"),svg=root.querySelector(".kline-svg");
  if(!svg||!tooltip||!data.length)return;
  const crossV=document.createElementNS("http://www.w3.org/2000/svg","line"),crossH=document.createElementNS("http://www.w3.org/2000/svg","line");
  crossV.setAttribute("class","kline-crosshair-v");crossH.setAttribute("class","kline-crosshair-h");crossV.style.pointerEvents="none";crossH.style.pointerEvents="none";svg.insertBefore(crossV,svg.firstChild);svg.insertBefore(crossH,svg.firstChild);
  const show=index=>{
    const i=Math.max(0,Math.min(data.length-1,Number(index)||0)),b=data[i],prev=data[i-1];
    tooltip.innerHTML=klinePointHTML(b,prev,type);
    tooltip.hidden=false;
    const area=svg.querySelector('[data-kline-index="'+i+'"]');
    if(area){
      const xx=area.x.baseVal.value+area.width.baseVal.value/2,highs=data.map(x=>x.high),lows=data.map(x=>x.low),hi=Math.max(...highs),lo=Math.min(...lows),span=hi-lo||1,yy=18+(hi-b.close)/span*(430-18-42);
      crossV.setAttribute("x1",xx);crossV.setAttribute("x2",xx);crossV.setAttribute("y1","18");crossV.setAttribute("y2","388");
      crossH.setAttribute("x1","58");crossH.setAttribute("x2","1082");crossH.setAttribute("y1",yy);crossH.setAttribute("y2",yy);const ar=area.getBoundingClientRect(),rr=root.getBoundingClientRect();tooltip.style.left=Math.max(4,Math.min(rr.width-tooltip.offsetWidth-4,ar.left-rr.left+ar.width/2-tooltip.offsetWidth/2))+"px";tooltip.style.top=Math.max(4,ar.top-rr.top-tooltip.offsetHeight-8)+"px"}
  };
  root.querySelectorAll(".kline-hit").forEach(el=>{
    el.addEventListener("pointermove",()=>show(el.dataset.klineIndex));
    el.addEventListener("pointerdown",()=>show(el.dataset.klineIndex));
    el.addEventListener("focus",()=>show(el.dataset.klineIndex));
    el.setAttribute("tabindex","0");
  });
  show(data.length-1);
}
async function loadKline(raw,t,range){
  const k=sym(raw,t),endDate=new Date(),startDate=new Date(endDate);
  if(range==="3m")startDate.setMonth(startDate.getMonth()-3);
  else if(range==="1y")startDate.setFullYear(startDate.getFullYear()-1);
  else if(range==="5y")startDate.setFullYear(startDate.getFullYear()-5);
  else startDate.setFullYear(startDate.getFullYear()-40);
  const bars=await history(k,iso(startDate),iso(endDate),t);
  if(bars.length<2)throw Error("K线历史数据不足");
  $("#klineInfo").textContent="日K · "+bars.length+" 个交易日 · "+bars[0].date+" → "+bars.at(-1).date;
  $("#klineChart").innerHTML=klineSVG(bars,{type:"daily"});
  bindKlineInteraction($("#klineChart .kline-interactive"),bars,"daily");
}
async function loadIntraday(raw,t){
  const k=sym(raw,t);
  if(t==="fund")throw Error("基金没有连续交易时段分时数据");
  const bars=await api().intraday(k,{range:"1d",interval:"5m",assetType:t});
  $("#klineInfo").textContent="分时K · 5分钟 · "+bars.length+" 个数据点 · "+bars[0].date+" "+bars[0].time+" → "+bars.at(-1).date+" "+bars.at(-1).time;
  $("#klineChart").innerHTML=klineSVG(bars,{type:"intraday"});
  bindKlineInteraction($("#klineChart .kline-interactive"),bars,"intraday");
}
function chart(a){if(!a.length)return"";const w=900,h=240,p=18,lo=Math.min(...a),hi=Math.max(...a),s=hi-lo||1,pts=a.map((v,i)=>p+i*(w-2*p)/Math.max(1,a.length-1)+","+((h-p)-(v-lo)/s*(h-2*p))).join(" ");return'<svg class="chart" viewBox="0 0 '+w+" "+h+'" preserveAspectRatio="none"><polyline points="'+pts+'" fill="none" stroke="currentColor" stroke-width="3"/></svg>'}
async function loadHistoricalSimulation(){
  const raw=$("#simSymbol").value.trim(),t=assetType($("#simType").value),start=$("#simStart").value,end=$("#simEnd").value,capital=Number($("#simCapital").value);
  if(!raw||!start||!end||capital<=0)return toast("请完整填写历史模拟参数");
  if(start>end)return toast("开始日期不能晚于结束日期");
  try{toast("正在加载历史数据…");const k=sym(raw,t),bars=await history(k,start,end,t);if(bars.length<2)throw Error("该区间可用历史数据不足");
    state.simulation=createSimulation({symbol:k,assetType:t,capital,bars});save();render();toast("历史模拟已加载："+bars[0].date+" → "+bars.at(-1).date);
  }catch(e){toast("历史模拟加载失败："+e.message)}
}
function simAdvance(delta){
  if(!state.simulation)return toast("请先加载历史模拟");
  if(delta<0&&state.simulation.trades.length){
    const lastTradeDate=state.simulation.trades.at(-1)?.date;
    const lastTradeIndex=state.simulation.bars.findIndex(b=>b.date===lastTradeDate);
    if(lastTradeIndex>=0&&state.simulation.currentIndex+Math.trunc(delta||0)<lastTradeIndex)
      return toast("不能回到最近一次历史交易发生之前");
  }
  stepSimulation(state.simulation,delta);save();render()
}
function simJump(){
  if(!state.simulation)return;
  const d=$("#simDatePicker").value;if(!d)return;
  const target=state.simulation.bars.findIndex(b=>b.date>=d);
  const lastTradeDate=state.simulation.trades.at(-1)?.date;
  const lastTradeIndex=lastTradeDate?state.simulation.bars.findIndex(b=>b.date===lastTradeDate):-1;
  if(lastTradeIndex>=0&&target>=0&&target<lastTradeIndex)return toast("不能回到最近一次历史交易发生之前");
  jumpSimulationToDate(state.simulation,d);save();render()
}
function stopSimulationPlayback(){if(state.simulation)state.simulation.playing=false;clearInterval(window.__simTimer);window.__simTimer=null}
function toggleSimulationPlayback(){
  if(!state.simulation)return toast("请先加载历史模拟");
  if(state.simulation.playing){stopSimulationPlayback();save();render();return}
  state.simulation.playing=true;render();
  window.__simTimer=setInterval(()=>{const s=state.simulation;if(!s||s.currentIndex>=s.bars.length-1){stopSimulationPlayback();save();render();return}stepSimulation(s,1);save();render()},650);
}
$("#simLoadForm").onsubmit=e=>{e.preventDefault();loadHistoricalSimulation()};
$("#simPrev").onclick=()=>simAdvance(-1);$("#simNext").onclick=()=>simAdvance(1);
$("#simStep5").onclick=()=>simAdvance(5);$("#simStep20").onclick=()=>simAdvance(20);$("#simPlay").onclick=toggleSimulationPlayback;
$("#simJumpBtn").onclick=simJump;
$("#simReset").onclick=()=>{stopSimulationPlayback();state.simulation=null;save();render();toast("历史模拟已清除")};
$("#simProgress").oninput=e=>{if(!state.simulation)return;const target=Math.max(0,Math.min(state.simulation.bars.length-1,Number(e.target.value)||0));const lastTradeDate=state.simulation.trades.at(-1)?.date;
  const lastTradeIndex=lastTradeDate?state.simulation.bars.findIndex(b=>b.date===lastTradeDate):-1;
  if(lastTradeIndex>=0&&target<lastTradeIndex){render();return}state.simulation.currentIndex=target;state.simulation.position.price=currentBar(state.simulation).close;save();render()};
$("#simTradeForm").onsubmit=e=>{
  e.preventDefault();const s=state.simulation;if(!s)return toast("请先加载历史模拟");
  const bar=currentBar(s),side=$("#simSide").value,qty=Number($("#simQtyInput").value),price=Number($("#simTradePrice").value)||bar?.close;
  try{const record=executeSimulationTrade(s,{side,qty,price,date:bar?.date,feeRate:Number($("#simFee").value)||0,stampDutyRate:0.0005});save();render();toast((record.side==="buy"?"买入":"卖出")+"已按 "+record.date+" 历史时点执行")}
  catch(e){toast("历史交易失败："+e.message)}
};
$("#backtestForm").onsubmit=async e=>{e.preventDefault();const t=assetType($("#btType").value),k=sym($("#btSymbol").value,t),cap=Number($("#btCapital").value),a=$("#btStart").value,b=$("#btEnd").value,st=$("#btStrategy").value;if(!k||cap<=0||!a||!b)return toast("参数不完整");try{toast("正在下载历史数据…");const bars=await history(k,a,b,t);if(bars.length<2)throw Error("历史数据不足");const aShare=isAShareStock($("#btSymbol").value,t),autoLot=aShare?aShareLot($("#btSymbol").value):1,lotInput=Number($("#btLot").value)||1,stampInput=Number($("#btStamp").value)||0;const r=runBacktest(bars,{capital:cap,strategy:st,assetType:t,feeRate:Number($("#btFee").value)||0,slippage:Number($("#btSlippage").value)||0,position:Math.min(1,Number($("#btPosition").value)||1),riskFreeRate:Math.max(0,Number($("#btRiskFree").value)||0),buyFeeRate:Number($("#btBuyFee").value)||0,sellFeeRate:Number($("#btSellFee").value)||0,minFee:Number($("#btMinFee").value)||0,stampDutyRate:aShare&&stampInput===0?0.0005:stampInput,lotSize:aShare&&lotInput===1?autoLot:lotInput});const resultCurrency=aShare||t==="fund"?"CNY":"USD";$("#backtestResult").innerHTML='<div class="panel"><div class="metric-grid"><div class="metric"><small>期末资产</small><b>'+money(r.final,resultCurrency)+'</b></div><div class="metric"><small>累计收益</small><b class="'+(r.cum>=0?"positive":"negative")+'">'+r.cum.toFixed(2)+'%</b></div><div class="metric"><small>年化收益</small><b>'+r.cagr.toFixed(2)+'%</b></div><div class="metric"><small>最大回撤</small><b class="negative">-'+r.maxDrawdown.toFixed(2)+'%</b></div><div class="metric"><small>Sharpe</small><b>'+r.sharpe.toFixed(2)+'</b></div><div class="metric"><small>Sortino</small><b>'+r.sortino.toFixed(2)+'</b></div><div class="metric"><small>年化波动</small><b>'+r.volatility.toFixed(2)+'%</b></div><div class="metric"><small>交易次数</small><b>'+r.trades+'</b></div><div class="metric"><small>总费用</small><b>'+money(r.fees,resultCurrency)+'</b></div><div class="metric"><small>回撤持续</small><b>'+r.maxDrawdownDays+' 日</b></div><div class="metric"><small>数据点</small><b>'+bars.length+'</b></div><div class="metric"><small>基准收益</small><b>'+r.benchmarkReturn.toFixed(2)+'%</b></div><div class="metric"><small>相对基准</small><b>'+r.alpha.toFixed(2)+'%</b></div></div><div class="chart-wrap">'+chart(r.curve)+'</div><div class="chart-wrap"><div class="muted">回撤曲线</div>'+chart(r.drawdownCurve)+'</div><p>区间：'+bars[0].date+' → '+bars.at(-1).date+'。信号使用前一交易日收盘价，下一交易日开盘成交，避免未来函数；期末按收盘价估值。仍暂未模拟涨跌停、停牌、成交量约束、分红现金流及完整公司行为。</p></div>';toast("回测完成")}catch(x){toast("回测失败："+x.message)}};
function parseCSV(t){const rows=[];let row=[],cell="",q=false,s=t.replace(/^\uFEFF/,"");for(let i=0;i<s.length;i++){const ch=s[i];if(ch==="\""&&q&&s[i+1]==="\""){cell+="\"";i++;continue}if(ch==="\""){q=!q;continue}if(ch===","&&!q){row.push(cell);cell="";continue}if((ch==="\n"||ch==="\r")&&!q){if(ch==="\r"&&s[i+1]==="\n")i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell="";continue}cell+=ch}if(cell||row.length){row.push(cell);rows.push(row)}if(q)throw Error("CSV 引号未闭合");if(!rows.length)throw Error("CSV 为空");const h=rows[0].map(x=>x.trim().toLowerCase()),di=h.indexOf("date"),ci=h.indexOf("close");if(di<0||ci<0)throw Error("必须有 date、close 列");const ix=k=>h.indexOf(k),seen=new Set(),o=[];for(const a of rows.slice(1)){const d=String(a[di]||"").slice(0,10),c=Number(a[ci]);if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(d)||!Number.isFinite(c)||c<=0||seen.has(d))continue;seen.add(d);o.push({date:d,open:Number(a[ix("open")])||c,high:Number(a[ix("high")])||c,low:Number(a[ix("low")])||c,close:c,volume:Number(a[ix("volume")])||0})}return o.sort((a,b)=>a.date.localeCompare(b.date))}
$("#csvFile").onchange=async e=>{const f=e.target.files[0];if(!f)return;const k=prompt("请输入这份数据的代码，例如 AAPL 或 600519：");if(!k)return;try{const rows=parseCSV(await f.text());if(rows.length<2)throw Error("有效数据不足");state.csv[sym(k,$("#csvType").value)]=rows;save();render();toast("CSV 导入完成")}catch(x){toast("CSV 导入失败："+x.message)}};
$("#clearCsvBtn").onclick=()=>{state.csv={};save();render();toast("本地历史数据已清除")};
$("#exportBtn").onclick=()=>{const a=document.createElement("a"),u=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:"application/json"}));a.href=u;a.download="investment-lab-backup.json";a.click();URL.revokeObjectURL(u)};
$("#importAccount").onchange=async e=>{try{const x=JSON.parse(await e.target.files[0].text());if(typeof x.cash!=="number"||!x.positions)throw Error("格式错误");if(!Number.isFinite(Number(x.cash))||!x.positions||typeof x.positions!=="object"||!Array.isArray(x.trades||[]))throw Error("账户结构无效");state.cash=Number(x.cash);state.initialCash=Number(x.initialCash)>0?Number(x.initialCash):state.cash;state.positions=x.positions;state.trades=x.trades;state.recent=Array.isArray(x.recent)?x.recent:[];state.csv=x.csv&&typeof x.csv==="object"?x.csv:{};state.simulation=x.simulation&&typeof x.simulation==="object"?x.simulation:null;state.settings={...state.settings,...(x.settings||{})};save();render();toast("账户已安全导入")}catch(x){toast("导入失败："+x.message)}};
$("#resetBtn").onclick=()=>{if(confirm("确定重置模拟账户？")){state.cash=state.initialCash;state.positions={};state.trades=[];stopSimulationPlayback();state.simulation=null;save();render();toast("账户已重置")}};
$("#refreshBtn").onclick=async()=>{const ps=Object.values(state.positions);if(!ps.length)return toast("暂无持仓");let ok=0,fail=0;for(const p of ps){try{const q=await quote(p.symbol,p.assetType||"auto");p.price=q.price;p.currency=q.currency;p.assetType=q.assetType||p.assetType;ok++}catch{fail++}}save();render();toast(fail?("刷新完成："+ok+" 个成功，"+fail+" 个失败"):("刷新完成："+ok+" 个标的"))};
$("#settingsForm").onsubmit=async e=>{e.preventDefault();state.settings.apiBase=$("#apiBase").value.trim().replace(/\/$/,"")||BUILTIN_API;state.settings.usdCny=Math.max(0.1,Number($("#usdCny").value)||7.2);const n=Number($("#initialCash").value);if(n>0&&!state.trades.length){state.initialCash=n;state.cash=n}save();toast("设置已保存");try{
    const health=await api().health({deep:true});
    toast(health?.upstreams ? "设置已保存，行情上游连接正常" : "设置已保存，数据接口正常");
  }catch(x){
    toast("设置已保存；数据接口暂不可用，可稍后重试或手动输入成交价");
  }};
$("#apiBase").value=state.settings.apiBase||BUILTIN_API;$("#usdCny").value=state.settings.usdCny;$("#initialCash").value=state.initialCash;const today=new Date(),end=iso(today),start=new Date(today);start.setFullYear(start.getFullYear()-40);$("#btStart").value=iso(start);$("#btEnd").value=end;const simStart=new Date("2020-01-01T00:00:00");$("#simStart").value=iso(simStart);$("#simEnd").value=end;render();
document.documentElement.classList.add("app-ready");
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{});

