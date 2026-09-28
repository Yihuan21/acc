export class DataAPI{
  constructor(settings={}){this.s=settings;this.base=String(settings.apiBase||"").replace(/\/$/,"")}
  async request(path,params={}){
    const url=new URL(this.base?this.base+path:"https://query1.finance.yahoo.com"+path);
    for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null&&v!=="")url.searchParams.set(k,v);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{const r=await fetch(url,{signal:controller.signal});if(!r.ok)throw Error("数据接口 HTTP "+r.status);const j=await r.json();if(j?.chart?.error)throw Error(j.chart.error.description||"行情接口返回错误");return j}catch(e){if(e.name==="AbortError")throw Error("数据接口超时");throw e}finally{clearTimeout(timer)}
  }
  async quote(symbol){
    const path=this.base?"/api/yahoo":"/v8/finance/chart/"+encodeURIComponent(symbol);
    const j=await this.request(path,this.base?{symbol,range:"1d",interval:"1m"}:{range:"1d",interval:"1m"});
    const m=j.chart?.result?.[0];if(!m)throw Error("找不到该标的");
    const q=m.meta||{},p=Number(q.regularMarketPrice);if(!Number.isFinite(p))throw Error("接口未返回价格");
    const prev=Number(q.previousClose??q.chartPreviousClose??p)||p;
    return{symbol:q.symbol||symbol,name:q.longName||q.shortName||symbol,price:p,change:p-prev,changePct:prev?(p/prev-1)*100:0,high:Number(q.regularMarketDayHigh)||p,low:Number(q.regularMarketDayLow)||p,currency:q.currency||"USD",time:(Number(q.regularMarketTime)||Date.now()/1000)*1000}
  }
  async history(symbol,start,end){
    const from=Math.floor(new Date(start||"2000-01-01T00:00:00").getTime()/1000);
    const to=Math.floor(new Date(end||new Date()).getTime()/1000)+86400;
    if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw Error("日期范围无效");
    const path=this.base?"/api/yahoo":"/v8/finance/chart/"+encodeURIComponent(symbol);
    const j=await this.request(path,this.base?{symbol,period1:from,period2:to,interval:"1d",events:"div,splits"}:{period1:from,period2:to,interval:"1d",events:"div,splits"});
    const m=j.chart?.result?.[0];if(!m)throw Error("历史数据为空");
    const q=m.indicators?.quote?.[0]||{},adj=m.indicators?.adjclose?.[0]?.adjclose||[];
    const rows=(m.timestamp||[]).map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),open:Number(q.open?.[i]),high:Number(q.high?.[i]),low:Number(q.low?.[i]),close:Number(adj[i]??q.close?.[i]),volume:Number(q.volume?.[i])||0})).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(x.close)&&x.close>0);
    if(rows.length<2)throw Error("历史数据不足");
    const seen=new Set();return rows.filter(x=>{if(seen.has(x.date))return false;seen.add(x.date);return true});
  }
}