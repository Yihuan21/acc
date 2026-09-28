import {DataAPI} from "./data.js?v=20260928-8";
import {runBacktest} from "./backtest.js?v=20260928-8";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const money=(v,c="CNY")=>{const cur=String(c||"CNY").toUpperCase();return new Intl.NumberFormat(cur==="USD"?"en-US":"zh-CN",{style:"currency",currency:cur==="USD"?"USD":"CNY",maximumFractionDigits:2}).format(Number(v)||0)};
const num=v=>Number(v||0).toLocaleString("en-US",{maximumFractionDigits:4}), iso=d=>new Date(d).toISOString().slice(0,10);
const defaults={cash:100000,initialCash:100000,positions:{},trades:[],recent:[],csv:{},settings:{apiBase:"",usdCny:7.2}};
let state;try{state=JSON.parse(localStorage.getItem("invest-sim")||"null")||structuredClone(defaults)}catch{state=structuredClone(defaults)}
state.settings=state.settings&&typeof state.settings==="object"?state.settings:{};
state.settings.apiBase=String(state.settings.apiBase||"").trim().replace(/\/$/,"");
state.settings.usdCny=Number(state.settings.usdCny)||7.2;
state.positions=state.positions&&typeof state.positions==="object"?state.positions:{};
state.trades=Array.isArray(state.trades)?state.trades:[];
state.recent=Array.isArray(state.recent)?state.recent:[];
state.csv=state.csv&&typeof state.csv==="object"?state.csv:{};
state.cash=Number.isFinite(Number(state.cash))?Number(state.cash):100000;
state.initialCash=Number.isFinite(Number(state.initialCash))?Number(state.initialCash):state.cash;
const save=()=>localStorage.setItem("invest-sim",JSON.stringify(state));
const toast=m=>{const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),2600)};
const api=()=>new DataAPI(state.settings);
window.addEventListener("error",e=>{if(e?.message)toast("应用错误："+e.message)});
window.addEventListener("unhandledrejection",e=>{const m=e?.reason?.message||String(e?.reason||"");if(m)toast("操作失败："+m)});

function go(id){const page=$("#"+id);if(!page)return toast("页面加载异常："+id);$$(".page").forEach(x=>x.classList.toggle("active",x.id===id));$$(".tab").forEach(x=>x.classList.toggle("active",x.dataset.go===id));render();window.scrollTo({top:0,behavior:"instant"})}
$$("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
function assetType(raw){return String(raw||"auto").toLowerCase()}
function assetLabel(t){return t==="fund"?"基金":t==="etf"?"ETF":t==="stock"?"股票":"标的"}
function isAShareStock(raw,type="auto"){return type==="stock" && /^\d{6}$/.test(String(raw||"").trim())}
function aShareLot(raw){return /^68\d{4}$/.test(String(raw||"").trim())?200:100}
function localDate(){const d=new Date(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return d.getFullYear()+"-"+m+"-"+day}
function sym(raw,type="auto"){const s=String(raw||"").trim().toUpperCase();if(/^\d{6}$/.test(s)){if(type==="fund")return s;if(/^(60|68|5)/.test(s))return s+".SS";if(/^(00|30|15|16|18)/.test(s))return s+".SZ"}return s}
async function quote(s,t="auto"){return api().quote(sym(s,t),{assetType:t})}
async function history(s,a,b,t="auto"){const k=sym(s,t),local=state.csv[k];if(local&&local.length){const x=local.filter(v=>(!a||v.date>=a)&&(!b||v.date<=b));if(x.length>1)return x}return api().history(k,a,b,t)}
function positionValue(){return Object.values(state.positions).reduce((a,p)=>a+(p.currency==="USD"?p.qty*p.price*Number(state.settings.usdCny||7.2):p.qty*p.price),0)}
function render(){
 const mv=positionValue(),tot=state.cash+mv;$("#cash").textContent=money(state.cash);$("#marketValue").textContent=money(mv);$("#totalAssets").textContent=money(tot);$("#portfolioCash").textContent=money(state.cash);$("#portfolioTotal").textContent=money(tot);
 const ps=Object.values(state.positions);
 $("#dashboardPositions").innerHTML=ps.length?ps.map(p=>'<div class="row"><span><b>'+p.symbol+'</b><small>'+num(p.qty)+' · 成本 '+num(p.avg)+'</small></span><b>'+money(p.qty*p.price,p.currency)+'</b></div>').join(""):'<div class="empty">还没有模拟持仓</div>';
 $("#positions").innerHTML=ps.length?ps.map(p=>'<div class="row"><span><b>'+p.symbol+'</b><small>'+num(p.qty)+' · 成本 '+num(p.avg)+' · 最新 '+num(p.price)+'</small></span><strong class="'+(p.price>=p.avg?"positive":"negative")+'">'+money((p.price-p.avg)*p.qty,p.currency)+'</strong></div>').join(""):'<div class="panel empty">暂无持仓</div>';
 $("#trades").innerHTML=state.trades.length?state.trades.slice().reverse().slice(0,50).map(t=>'<div class="row"><span><b>'+(t.side==="buy"?"买入":"卖出")+' '+t.symbol+'</b><small>'+new Date(t.time).toLocaleString()+' · '+num(t.qty)+' × '+num(t.price)+'</small></span><span>'+money(t.total,t.currency)+'</span></div>').join(""):'<div class="empty">暂无交易</div>';
 $("#recentSymbols").innerHTML=state.recent.map(s=>'<button class="chip" data-symbol="'+s+'">'+s+"</button>").join("")||'<span class="muted">暂无记录</span>';
 $$("[data-symbol]").forEach(b=>b.onclick=()=>{$("#symbolInput").value=b.dataset.symbol;$("#quoteForm").requestSubmit()});
 const keys=Object.keys(state.csv);$("#csvInfo").textContent=keys.length?keys.map(k=>k+": "+state.csv[k].length+" 条").join(" · "):"尚未导入数据";
}
$("#quoteForm").onsubmit=async e=>{e.preventDefault();const raw=$("#symbolInput").value.trim(),t=assetType($("#marketType").value);if(!raw)return toast("请输入代码");try{toast("正在获取行情…");const q=await quote(raw,t),k=sym(raw,t),c=q.currency||((t==="fund"||/^\\d{6}$/.test(raw))?"CNY":"USD");state.recent=[k,...state.recent.filter(x=>x!==k)].slice(0,10);save();$("#quoteResult").innerHTML='<div class="panel"><div class="muted">'+q.symbol+" · "+q.name+" · "+assetLabel(q.assetType||t)+'</div><div class="quote-main">'+(c==="USD"?"$":"¥")+num(q.price)+'</div><div class="'+(q.change>=0?"positive":"negative")+'">'+(q.change>=0?"+":"")+num(q.change)+"（"+(q.changePct>=0?"+":"")+q.changePct.toFixed(2)+"%）"+'</div><div class="asset-row"><span>最高 <b>'+num(q.high)+'</b></span><span>最低 <b>'+num(q.low)+'</b></span><span>币种 <b>'+c+"</b></span></div></div>";render();try{await loadKline(raw,t,$("#klineRange .chip.active")?.dataset.range||"3m")}catch(x){$("#klineInfo").textContent="K线加载失败："+x.message;$("#klineChart").innerHTML=""}}catch(x){toast("行情获取失败："+x.message)}};
$("[data-range]").forEach(b=>b.onclick=async()=>{const active=$("#klineRange .chip");active.forEach(x=>x.classList.toggle("active",x===b));const raw=$("#symbolInput").value.trim(),t=assetType($("#marketType").value);if(!raw)return toast("请先查询标的");try{b.disabled=true;await loadKline(raw,t,b.dataset.range)}catch(x){$("#klineInfo").textContent="K线加载失败："+x.message}finally{b.disabled=false}});$("#tradeForm").onsubmit=async e=>{e.preventDefault();const raw=$("#tradeSymbol").value.trim(),t=assetType($("#tradeType").value),k=sym(raw,t),side=$("#tradeSide").value;let qty=Number($("#tradeQty").value),fr=Math.max(0,Number($("#tradeFee").value)||0);if(!k||qty<=0)return toast("请填写交易信息");const aShare=isAShareStock(raw,t),lot=aShare?aShareLot(raw):1;try{let price=Number($("#tradePrice").value),cur="CNY";if(!price){const q=await quote(k,t);price=q.price;cur=q.currency||((t==="fund")?"CNY":"USD")}const p=state.positions[k]||{symbol:k,qty:0,avg:0,price,currency:cur,assetType:t};if(aShare){if(side==="buy")qty=Math.floor(qty/lot)*lot;else if(qty<p.qty&&qty%lot!==0)qty=Math.floor(qty/lot)*lot;if(qty<=0)return toast("A股买入数量需为"+lot+"股的整数倍");if(side==="sell"&&p.lastBuyDate===localDate())return toast("A股实行T+1，今日买入的持仓不能今日卖出")}const stamp=aShare&&side==="sell"?0.0005:0;const gross=price*qty,fee=gross*fr+gross*stamp,fx=cur==="USD"?Number(state.settings.usdCny||7.2):1,cost=(gross+fee)*fx,proceeds=(gross-fee)*fx;if(side==="buy"){if(cost>state.cash)return toast("现金不足");p.avg=(p.avg*p.qty+gross+fee)/(p.qty+qty);p.qty+=qty;p.lastBuyDate=localDate();state.cash-=cost}else{if(qty>p.qty)return toast("持仓不足");state.cash+=proceeds;p.qty-=qty}p.price=price;p.currency=cur;p.assetType=p.assetType||t;if(p.qty)state.positions[k]=p;else delete state.positions[k];state.trades.push({symbol:k,side,qty,price,total:gross,fee,currency:cur,cashImpact:side==="buy"?-cost:proceeds,time:Date.now(),assetType:t,stampDuty:stamp});save();render();toast(aShare?"模拟交易已执行（A股规则）":"模拟交易已执行")}catch(x){toast("交易失败："+x.message)}};
function maValues(bars,n){return bars.map((_,i)=>i+1<n?null:bars.slice(i-n+1,i+1).reduce((s,x)=>s+x.close,0)/n)}
function klineSVG(bars){
  const data=bars.slice(-600),W=1100,H=430,pl=48,pr=18,pt=18,pb=42;
  if(!data.length)return "";
  const highs=data.map(x=>x.high),lows=data.map(x=>x.low),hi=Math.max(...highs),lo=Math.min(...lows),span=hi-lo||1;
  const chartH=H-pt-pb,step=(W-pl-pr)/Math.max(1,data.length),body=Math.max(2,Math.min(9,step*.62));
  const y=v=>pt+(hi-v)/span*chartH, x=i=>pl+(i+.5)*step;
  const grid=[0,.25,.5,.75,1].map(t=>{const yy=pt+t*chartH,val=hi-t*span;return '<line class="kline-grid" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+yy+'" y2="'+yy+'"/><text class="kline-axis" x="4" y="'+(yy+4)+'">'+num(val)+'</text>'}).join("");
  const candles=data.map((b,i)=>{
    const xx=x(i),yyO=y(b.open),yyC=y(b.close),yyH=y(b.high),yyL=y(b.low),up=b.close>=b.open,cls=up?"kline-up":"kline-down";
    const top=Math.min(yyO,yyC),height=Math.max(1,Math.abs(yyC-yyO));
    return '<line class="'+cls+'" x1="'+xx+'" x2="'+xx+'" y1="'+yyH+'" y2="'+yyL+'"/><rect class="'+cls+'" x="'+(xx-body/2)+'" y="'+top+'" width="'+body+'" height="'+height+'"/>';
  }).join("");

  const maPath=(n,cls)=>{const vals=maValues(data,n),pts=vals.map((v,i)=>v==null?null:[x(i),y(v)]).filter(Boolean);return pts.length>1?'<polyline class="'+cls+'" points="'+pts.map(p=>p.join(",")).join(" ")+'"/>':""};
  const labels=[0,Math.floor(data.length/3),Math.floor(data.length*2/3),data.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>'<text class="kline-axis" text-anchor="middle" x="'+x(i)+'" y="'+(H-12)+'">'+data[i].date.slice(0,10)+'</text>').join("");
  return '<div class="kline-scroll"><svg class="kline-svg" viewBox="0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="日K线图">'+grid+candles+maPath(5,"kline-ma5")+maPath(20,"kline-ma20")+maPath(60,"kline-ma60")+labels+'</svg></div><div class="kline-legend"><span>■ MA5</span><span>■ MA20</span><span>■ MA60</span><span>红涨绿跌</span></div>';
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
  $("#klineChart").innerHTML=klineSVG(bars);
}
function chart(a){if(!a.length)return"";const w=900,h=240,p=18,lo=Math.min(...a),hi=Math.max(...a),s=hi-lo||1,pts=a.map((v,i)=>p+i*(w-2*p)/Math.max(1,a.length-1)+","+((h-p)-(v-lo)/s*(h-2*p))).join(" ");return'<svg class="chart" viewBox="0 0 '+w+" "+h+'" preserveAspectRatio="none"><polyline points="'+pts+'" fill="none" stroke="currentColor" stroke-width="3"/></svg>'}
$("#backtestForm").onsubmit=async e=>{e.preventDefault();const t=assetType($("#btType").value),k=sym($("#btSymbol").value,t),cap=Number($("#btCapital").value),a=$("#btStart").value,b=$("#btEnd").value,st=$("#btStrategy").value;if(!k||cap<=0||!a||!b)return toast("参数不完整");try{toast("正在下载历史数据…");const bars=await history(k,a,b,t);if(bars.length<2)throw Error("历史数据不足");const aShare=isAShareStock($("#btSymbol").value,t),autoLot=aShare?aShareLot($("#btSymbol").value):1,lotInput=Number($("#btLot").value)||1,stampInput=Number($("#btStamp").value)||0;const r=runBacktest(bars,{capital:cap,strategy:st,assetType:t,feeRate:Number($("#btFee").value)||0,slippage:Number($("#btSlippage").value)||0,position:Math.min(1,Number($("#btPosition").value)||1),riskFreeRate:Math.max(0,Number($("#btRiskFree").value)||0),buyFeeRate:Number($("#btBuyFee").value)||0,sellFeeRate:Number($("#btSellFee").value)||0,minFee:Number($("#btMinFee").value)||0,stampDutyRate:aShare&&stampInput===0?0.0005:stampInput,lotSize:aShare&&lotInput===1?autoLot:lotInput});$("#backtestResult").innerHTML='<div class="panel"><div class="metric-grid"><div class="metric"><small>期末资产</small><b>'+money(r.final)+'</b></div><div class="metric"><small>累计收益</small><b class="'+(r.cum>=0?"positive":"negative")+'">'+r.cum.toFixed(2)+'%</b></div><div class="metric"><small>年化收益</small><b>'+r.cagr.toFixed(2)+'%</b></div><div class="metric"><small>最大回撤</small><b class="negative">-'+r.maxDrawdown.toFixed(2)+'%</b></div><div class="metric"><small>Sharpe</small><b>'+r.sharpe.toFixed(2)+'</b></div><div class="metric"><small>Sortino</small><b>'+r.sortino.toFixed(2)+'</b></div><div class="metric"><small>年化波动</small><b>'+r.volatility.toFixed(2)+'%</b></div><div class="metric"><small>交易次数</small><b>'+r.trades+'</b></div><div class="metric"><small>总费用</small><b>'+money(r.fees)+'</b></div><div class="metric"><small>回撤持续</small><b>'+r.maxDrawdownDays+' 日</b></div><div class="metric"><small>数据点</small><b>'+bars.length+'</b></div><div class="metric"><small>基准收益</small><b>'+((r.benchmark/cap-1)*100).toFixed(2)+'%</b></div><div class="metric"><small>相对基准</small><b>'+r.alpha.toFixed(2)+'%</b></div></div><div class="chart-wrap">'+chart(r.curve)+'</div><div class="chart-wrap"><div class="muted">回撤曲线</div>'+chart(r.drawdownCurve)+'</div><p>区间：'+bars[0].date+' → '+bars.at(-1).date+'。信号使用前一交易日收盘价，下一交易日开盘成交，避免未来函数；期末按收盘价估值。仍暂未模拟涨跌停、停牌、成交量约束、分红现金流及完整公司行为。</p></div>';toast("回测完成")}catch(x){toast("回测失败："+x.message)}};
function parseCSV(t){const rows=[];let row=[],cell="",q=false,s=t.replace(/^\uFEFF/,"");for(let i=0;i<s.length;i++){const ch=s[i];if(ch==="\""&&q&&s[i+1]==="\""){cell+="\"";i++;continue}if(ch==="\""){q=!q;continue}if(ch===","&&!q){row.push(cell);cell="";continue}if((ch==="\n"||ch==="\r")&&!q){if(ch==="\r"&&s[i+1]==="\n")i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell="";continue}cell+=ch}if(cell||row.length){row.push(cell);rows.push(row)}if(q)throw Error("CSV 引号未闭合");if(!rows.length)throw Error("CSV 为空");const h=rows[0].map(x=>x.trim().toLowerCase()),di=h.indexOf("date"),ci=h.indexOf("close");if(di<0||ci<0)throw Error("必须有 date、close 列");const ix=k=>h.indexOf(k),seen=new Set(),o=[];for(const a of rows.slice(1)){const d=String(a[di]||"").slice(0,10),c=Number(a[ci]);if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(d)||!Number.isFinite(c)||c<=0||seen.has(d))continue;seen.add(d);o.push({date:d,open:Number(a[ix("open")])||c,high:Number(a[ix("high")])||c,low:Number(a[ix("low")])||c,close:c,volume:Number(a[ix("volume")])||0})}return o.sort((a,b)=>a.date.localeCompare(b.date))}
$("#csvFile").onchange=async e=>{const f=e.target.files[0];if(!f)return;const k=prompt("请输入这份数据的代码，例如 AAPL 或 600519：");if(!k)return;try{const rows=parseCSV(await f.text());if(rows.length<2)throw Error("有效数据不足");state.csv[sym(k,$("#csvType").value)]=rows;save();render();toast("CSV 导入完成")}catch(x){toast("CSV 导入失败："+x.message)}};
$("#clearCsvBtn").onclick=()=>{state.csv={};save();render();toast("本地历史数据已清除")};
$("#exportBtn").onclick=()=>{const a=document.createElement("a"),u=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:"application/json"}));a.href=u;a.download="investment-lab-backup.json";a.click();URL.revokeObjectURL(u)};
$("#importAccount").onchange=async e=>{try{const x=JSON.parse(await e.target.files[0].text());if(typeof x.cash!=="number"||!x.positions)throw Error("格式错误");if(!Number.isFinite(Number(x.cash))||!x.positions||typeof x.positions!=="object"||!Array.isArray(x.trades||[]))throw Error("账户结构无效");state.cash=Number(x.cash);state.initialCash=Number(x.initialCash)>0?Number(x.initialCash):state.cash;state.positions=x.positions;state.trades=x.trades;state.recent=Array.isArray(x.recent)?x.recent:[];state.csv=x.csv&&typeof x.csv==="object"?x.csv:{};state.settings={...state.settings,...(x.settings||{})};save();render();toast("账户已安全导入")}catch(x){toast("导入失败："+x.message)}};
$("#resetBtn").onclick=()=>{if(confirm("确定重置模拟账户？")){state.cash=state.initialCash;state.positions={};state.trades=[];save();render();toast("账户已重置")}};
$("#refreshBtn").onclick=async()=>{const ps=Object.values(state.positions);if(!ps.length)return toast("暂无持仓");let ok=0,fail=0;for(const p of ps){try{const q=await quote(p.symbol,p.assetType||"auto");p.price=q.price;p.currency=q.currency;p.assetType=q.assetType||p.assetType;ok++}catch{fail++}}save();render();toast(fail?("刷新完成："+ok+" 个成功，"+fail+" 个失败"):("刷新完成："+ok+" 个标的"))};
$("#settingsForm").onsubmit=e=>{e.preventDefault();state.settings.apiBase=$("#apiBase").value.trim().replace(/\/$/,"");state.settings.usdCny=Math.max(0.1,Number($("#usdCny").value)||7.2);const n=Number($("#initialCash").value);if(n>0&&!state.trades.length){state.initialCash=n;state.cash=n}save();toast("设置已保存")};
$("#apiBase").value=state.settings.apiBase||"";$("#usdCny").value=state.settings.usdCny;$("#initialCash").value=state.initialCash;const today=new Date(),end=iso(today),start=new Date(today);start.setFullYear(start.getFullYear()-40);$("#btStart").value=iso(start);$("#btEnd").value=end;render();
document.documentElement.classList.add("app-ready");
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{});

