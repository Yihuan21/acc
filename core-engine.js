/*
 * Unified investment core engine
 * Shared by backtest, simulation and chart layers.
 * Keeps historical simulation isolated from future data.
 */

export function clampHistoryByDate(bars, simulationDate){
  const end = String(simulationDate || "9999-12-31").slice(0,10);
  return (Array.isArray(bars)?bars:[])
    .filter(b => String(b.date || "").slice(0,10) <= end)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}

export function normalizeBar(bar){
  if(!bar) return null;
  const open=Number(bar.open), high=Number(bar.high), low=Number(bar.low), close=Number(bar.close);
  if(![open,high,low,close].every(Number.isFinite)) return null;
  return {
    date:String(bar.date).slice(0,10),
    open,
    high:Math.max(high,open,close),
    low:Math.min(low,open,close),
    close,
    volume:Number(bar.volume)||0
  };
}

export function prepareMarketBars(bars, simulationDate){
  return clampHistoryByDate((Array.isArray(bars)?bars:[]).map(normalizeBar).filter(Boolean),simulationDate);
}

export function buildTradeMarkers(trades){
  return (Array.isArray(trades)?trades:[]).map(t=>({
    date:String(t.date||t.time||"").slice(0,10),
    side:t.side,
    price:Number(t.price)||0,
    qty:Number(t.qty)||0
  }));
}

export function validateNoFutureData(bars,simulationDate){
  const end=String(simulationDate||"").slice(0,10);
  return !(bars||[]).some(b=>String(b.date).slice(0,10)>end);
}

export function normalizeAsset(asset){
  const type=String(asset?.type||asset?.assetType||"stock").toLowerCase();
  if(type.includes("fund")) return "fund";
  if(type.includes("etf")) return "etf";
  return "stock";
}
