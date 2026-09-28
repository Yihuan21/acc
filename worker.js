// Cloudflare Worker：可选代理层，避免浏览器跨域限制。
export default {async fetch(request){
  const u=new URL(request.url);
  if(u.pathname!=="/api/yahoo")return new Response("Investment API",{status:200,headers:{"content-type":"text/plain"}});
  const symbol=u.searchParams.get("symbol");
  if(!symbol)return new Response(JSON.stringify({error:"symbol required"}),{status:400,headers:{"content-type":"application/json","access-control-allow-origin":"*"}});
  const target=new URL("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol));
  for(const k of ["period1","period2","interval","range","events"])if(u.searchParams.has(k))target.searchParams.set(k,u.searchParams.get(k));
  const r=await fetch(target.toString(),{headers:{"User-Agent":"investment-simulator/1.0"}});
  return new Response(r.body,{status:r.status,headers:{"content-type":"application/json","cache-control":"public,max-age=30","access-control-allow-origin":"*","access-control-allow-methods":"GET,OPTIONS"}});
}};