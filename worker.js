// Cloudflare Worker：行情与基金数据代理，统一处理浏览器跨域。
export default {async fetch(request){
  const u=new URL(request.url);
  const cors={"access-control-allow-origin":"*","access-control-allow-methods":"GET,OPTIONS","access-control-allow-headers":"Content-Type"};
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(u.pathname==="/api/yahoo"){
    const symbol=u.searchParams.get("symbol");
    if(!symbol)return new Response(JSON.stringify({error:"symbol required"}),{status:400,headers:{"content-type":"application/json",...cors}});
    const target=new URL("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol));
    for(const k of ["period1","period2","interval","range","events"])if(u.searchParams.has(k))target.searchParams.set(k,u.searchParams.get(k));
    const r=await fetch(target.toString(),{headers:{"User-Agent":"investment-lab/1.0"}});
    return new Response(r.body,{status:r.status,headers:{"content-type":"application/json","cache-control":"public,max-age=30",...cors}});
  }
  if(u.pathname==="/api/fund"){
    const code=u.searchParams.get("fundCode");
    if(!/^\d{6}$/.test(String(code||"")))return new Response(JSON.stringify({error:"fundCode must be 6 digits"}),{status:400,headers:{"content-type":"application/json",...cors}});
    const target=new URL("https://api.fund.eastmoney.com/f10/lsjz");
    for(const k of ["fundCode","startDate","endDate","pageIndex","pageSize"])if(u.searchParams.has(k))target.searchParams.set(k,u.searchParams.get(k));
    target.searchParams.set("pageSize",Math.min(5000,Number(target.searchParams.get("pageSize")||5000)));
    const r=await fetch(target.toString(),{headers:{"User-Agent":"Mozilla/5.0","Referer":"https://fund.eastmoney.com/"}});
    return new Response(r.body,{status:r.status,headers:{"content-type":"application/json","cache-control":"public,max-age=300",...cors}});
  }
  return new Response("Investment API",{status:200,headers:{"content-type":"text/plain",...cors}});
}};