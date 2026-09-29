// Unified market core for acc
// Connects data cleaning, simulation and backtest layers without changing existing APIs.

function normalizeMarketType(type='stock'){
  const t=String(type).toLowerCase();
  if(['fund','基金','nav'].includes(t)) return 'fund';
  if(['etf'].includes(t)) return 'etf';
  if(['us','usstock','美股'].includes(t)) return 'us_stock';
  return 'stock';
}

function normalizeBar(row){
  return {
    date: row.date || row.time,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close ?? row.price),
    volume: Number(row.volume || 0)
  };
}

function filterVisibleBars(rows, simulationDate){
  return (rows||[]).map(normalizeBar)
    .filter(x=>x.date && (!simulationDate || x.date<=simulationDate))
    .filter(x=>Number.isFinite(x.close) && x.close>0)
    .sort((a,b)=>a.date.localeCompare(b.date));
}

function buildTradeMarkers(trades=[]){
  return trades.map(t=>({
    date:t.date,
    side:t.side || t.action,
    price:Number(t.price)
  }));
}

function marketSummary(data){
  const bars=data||[];
  return {
    count:bars.length,
    first:bars[0]?.date||null,
    last:bars[bars.length-1]?.date||null
  };
}

if(typeof module!=='undefined') module.exports={
  normalizeMarketType,
  normalizeBar,
  filterVisibleBars,
  buildTradeMarkers,
  marketSummary
};
