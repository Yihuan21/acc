export class DataAPI{
  constructor(settings={}){this.s=settings;this.base=(settings.apiBase||"").replace(/\/$/,"")}
  async request(path,params){
    const usingProxy=!!this.base;
    const url=new URL(usingProxy?this.base+path:"https://query1.finance.yahoo.com"+path);
    Object.entries(params||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=="")url.searchParams.set(k,v)});
    const r=await fetch(url);if(!r.ok)throw Error("数据接口 HTTP "+r.status);return r.json()
  }
  async quote(symbol){
    const path=this.base?"/api/yahoo":"/v8/finance/chart/"+encodeURIComponent(symbol);
    const j=await this.request(path,this.base?{symbol,range:"1d",interval:"1m"}:{range:"1d",interval:"1m"});
    const m=j.chart?.result?.[0];if(!m)throw Error("找不到该标的");
    const q=m.meta||{},p=q.regularMarketPrice;if(p==null)throw Error("接口未返回价格");
    const prev=q.previousClose??q.chartPreviousClose??p;
    return{symbol:q.symbol||symbol,name:q.longName||q.shortName||symbol,price:p,change:p-prev,changePct:(p/prev-1)*100,high:q.regularMarketDayHigh||p,low:q.regularMarketDayLow||p,currency:q.currency||"USD",time:(q.regularMarketTime||Date.now()/1000)*1000}
  }
  async history(symbol,start,end){
    const p1=Math.floor(new Date(start||"2000-01-01").getTime()/1000),p2=Math.floor(new Date(end||new Date()).getTime()/1000)+86400;
    const path=this.base?"/api/yahoo":"/v8/finance/chart/"+encodeURIComponent(symbol);
    const j=await this.request(path,this.base?{symbol,period1:p1,period2:p2,interval:"1d",events:"div,splits"}:{period1:p1,period2:p2,interval:"1d",events:"div,splits"});
    const m=j.chart?.result?.[0];if(!m)throw Error("历史数据为空");
    const q=m.indicators?.quote?.[0]||{},adj=m.indicators?.adjclose?.[0]?.adjclose||[];
    return(m.timestamp||[]).map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:adj[i]??q.close?.[i],volume:q.volume?.[i]})).filter(x=>Number.isFinite(x.close))
  }
}