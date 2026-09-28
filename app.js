import {DataAPI} from "./data.js";

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=v=>new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY",maximumFractionDigits:2}).format(Number(v)||0);
const num=v=>Number(v).toLocaleString("en-US",{maximumFractionDigits:4});
const today=new Date();
const iso=d=>d.toISOString().slice(0,10);

const state=JSON.parse(localStorage.getItem("invest-sim")||"null")||{cash:100000,initialCash:100000,positions:{},trades:[],recent:[],settings:{provider:"yahoo",apiBase:""}};
const save=()=>localStorage.setItem("invest-sim",JSON.stringify(state));
const toast=m=>{const t=$("#toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200)};
const api=()=>new DataAPI(state.settings);

function showPage(id){$$(".page").forEach(x=>x.classList.toggle("active",x.id===id));$$(".tab").forEach(x=>x.classList.toggle("active",x.dataset.go===id));window.scrollTo({top:0,behavior:"smooth"});render();}
$$("[data-go]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.go)));

async function quote(symbol){return api().quote(symbol.trim().toUpperCase())}
async function history(symbol,start,end){return api().history(symbol.trim().toUpperCase(),start,end)}

async function renderQuote(q){
  if(!q)return;
  $("#quoteResult").innerHTML=`<div class="panel quote-card"><div class="muted">${q.symbol} · ${q.name||"市场数据"}</div><div class="quote-main">${q.currency==="USD"?"$":"¥"}${num(q.price)}</div><div class="${q.change>=0?"positive":"negative"}">${q.change>=0?"+":""}${num(q.change)}（${q.changePct>=0?"+":""}${q.changePct.toFixed(2)}%）</div><div class="asset-row" style="margin-top:15px"><span>最高 <b>${num(q.high)}</b></span><span>最低 <b>${num(q.low)}</b></span><span>更新时间 <b>${new Date(q.time).toLocaleString()}</b></span></div></div>`;
}

$("#quoteForm").addEventListener("submit",async e=>{e.preventDefault();const s=$("#symbolInput").value.trim();if(!s)return toast("请输入代码");try{toast("正在获取行情…");const q=await quote(s);state.recent=[s.toUpperCase(),...state.recent.filter(x=>x!==s.toUpperCase())].slice(0,8);save();await renderQuote(q);renderRecent();}catch(err){toast("行情获取失败："+err.message)}});
function renderRecent(){$("#recentSymbols").innerHTML=state.recent.map(s=>`<button class="chip" data-symbol="${s}">${s}</button>`).join("")||'<span class="muted">暂无记录</span>';$$("[data-symbol]").forEach(b=>b.onclick=()=>{$("#symbolInput").value=b.dataset.symbol;$("#quoteForm").requestSubmit()})}

function positionValue(){return Object.values(state.positions).reduce((a,p)=>a+(p.qty*p.price),0)}
function render(){const mv=positionValue(),total=state.cash+mv;$("#cash").textContent=money(state.cash);$("#marketValue").textContent=money(mv);$("#totalAssets").textContent=money(total);$("#portfolioCash").textContent=money(state.cash);$("#portfolioTotal").textContent=money(total);renderPositions();renderTrades();renderDashboard();renderRecent();}
function renderDashboard(){const ps=Object.values(state.positions);$("#dashboardPositions").innerHTML=ps.length?ps.map(p=>`<div class="row"><span><b>${p.symbol}</b><small>${num(p.qty)} 股 · 成本 ${num(p.avg)}</small></span><b>${money(p.qty*p.price)}</b></div>`).join(""):'<div class="empty">还没有模拟持仓</div>'}
function renderPositions(){const ps=Object.values(state.positions);$("#positions").innerHTML=ps.length?ps.map(p=>`<div class="row"><span><b>${p.symbol}</b><small>数量 ${num(p.qty)} · 成本 ${num(p.avg)} · 最新 ${num(p.price)}</small></span><strong class="${p.price>=p.avg?"positive":"negative"}>${money((p.price-p.avg)*p.qty)}</strong></div>`).join(""):'<div class="panel empty">暂无持仓</div>'}
function renderTrades(){$("#trades").innerHTML=state.trades.length?state.trades.slice().reverse().slice(0,30).map(t=>`<div class="row"><span><b>${t.side==="buy"?"买入":"卖出"} ${t.symbol}</b><small>${new Date(t.time).toLocaleString()} · ${num(t.qty)} × ${num(t.price)}</small></span><span>${money(t.qty*t.price)}</span></div>`).join(""):'<div class="empty">暂无交易</div>'}

$("#tradeForm").addEventListener("submit",async e=>{e.preventDefault();const symbol=$("#tradeSymbol").value.trim().toUpperCase(),side=$("#tradeSide").value,qty=Number($("#tradeQty").value);if(!symbol||qty<=0)return toast("请填写交易信息");let price=Number($("#tradePrice").value);try{if(!price){toast("正在获取最新价格…");price=(await quote(symbol)).price}const cost=price*qty;const p=state.positions[symbol]||{symbol,qty:0,avg:0,price};if(side==="buy"){if(cost>state.cash)return toast("现金不足");p.avg=(p.avg*p.qty+cost)/(p.qty+qty);p.qty+=qty;state.cash-=cost}else{if(qty>p.qty)return toast("持仓不足");state.cash+=cost;p.qty-=qty}p.price=price;if(p.qty>0)state.positions[symbol]=p;else delete state.positions[symbol];state.trades.push({symbol,side,qty,price,time:Date.now()});save();render();toast("模拟交易已执行")}catch(err){toast("交易失败："+err.message)}});

$("#backtestForm").addEventListener("submit",async e=>{e.preventDefault();const symbol=$("#btSymbol").value.trim().toUpperCase(),capital=Number($("#btCapital").value),start=$("#btStart").value,end=$("#btEnd").value,strategy=$("#btStrategy").value;if(!symbol||capital<=0)return toast("参数不完整");try{toast("正在下载历史数据…");const bars=await history(symbol,start,end);const r=runBacktest(bars,capital,strategy);$("#backtestResult").innerHTML=renderBacktest(r,bars); }catch(err){toast("回测失败："+err.message)}});
function runBacktest(bars,capital,strategy){if(!bars.length)throw Error("没有历史数据");let cash=capital,shares=0,peak=capital,maxDD=0;const equity=[];for(let i=0;i<bars.length;i++){const p=bars[i].close;if(strategy==="buyhold"&&i===0){shares=cash/p;cash=0}if(strategy==="dca"&&i%21===0){const invest=Math.min(cash,capital/12);shares+=invest/p;cash-=invest}if(strategy==="ma"&&i>=60){const ma20=avg(bars.slice(i-20,i).map(x=>x.close)),ma60=avg(bars.slice(i-60,i).map(x=>x.close));if(ma20>ma60&&shares===0){shares=cash/p;cash=0}else if(ma20<ma60&&shares>0){cash+=shares*p;shares=0}}const eq=cash+shares*p;peak=Math.max(peak,eq);maxDD=Math.max(maxDD,(peak-eq)/peak);equity.push(eq)}const final=equity.at(-1);return{final,returnPct:(final/capital-1)*100,maxDD:maxDD*100,annualized:annualized(capital,final,bars[0].date,bars.at(-1).date)} }
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
function annualized(a,b,s,e){const years=Math.max(.01,(new Date(e)-new Date(s))/31557600000);return(Math.pow(b/a,1/years)-1)*100}
function renderBacktest(r,bars){return`<div class="panel"><div class="grid-2"><div><small>期末资产</small><h2>${money(r.final)}</h2></div><div><small>累计收益</small><h2 class="${r.returnPct>=0?"positive":"negative"}">${r.returnPct.toFixed(2)}%</h2></div><div><small>年化收益</small><b>${r.annualized.toFixed(2)}%</b></div><div><small>最大回撤</small><b class="negative">-${r.maxDD.toFixed(2)}%</b></div></div><p>共使用 ${bars.length} 个交易日数据。该结果未计佣金、税费、滑点及特殊公司行为影响。</p></div>`}

$("#refreshBtn").onclick=async()=>{const active=document.querySelector(".page.active")?.id;if(active==="market"&&$("#symbolInput").value)$("#quoteForm").requestSubmit();else{for(const p of Object.values(state.positions)){try{p.price=(await quote(p.symbol)).price}catch{}}save();render();toast("已刷新")}};
$("#settingsForm").addEventListener("submit",e=>{e.preventDefault();state.settings.provider=$("#provider").value;state.settings.apiBase=$("#apiBase").value.trim().replace(/\\/$/,"");const n=Number($("#initialCash").value);if(n>0&&state.initialCash!==n&&state.trades.length===0){state.initialCash=n;state.cash=n}save();toast("设置已保存");render()});
$("#provider").value=state.settings.provider;$("#apiBase").value=state.settings.apiBase;$("#initialCash").value=state.initialCash;
const end=iso(today),st=new Date(today);st.setFullYear(st.getFullYear()-5);$("#btStart").value=iso(st);$("#btEnd").value=end;
render();