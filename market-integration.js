// Unified market integration layer
// Shared by backtest, simulation and chart rendering.

export function clampHistoryByDate(rows, simulationDate) {
  const limit = simulationDate ? String(simulationDate).slice(0,10) : null;
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r && r.date && (!limit || String(r.date).slice(0,10) <= limit))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));
}

export function normalizeAsset(asset='auto') {
  const a = String(asset).toLowerCase();
  if (['stock','fund','etf'].includes(a)) return a;
  return 'stock';
}

export function normalizeBar(row) {
  if (!row) return null;
  const open = Number(row.open);
  const high = Number(row.high);
  const low = Number(row.low);
  const close = Number(row.close);
  if (![open,high,low,close].every(Number.isFinite)) return null;
  if (Math.min(open,high,low,close) <= 0) return null;
  if (high < Math.max(open,close) || low > Math.min(open,close)) return null;
  return {...row, open, high, low, close, volume:Number(row.volume||0)};
}

export function tradeMarker(trade) {
  if (!trade) return null;
  return {
    date:String(trade.date || trade.time || '').slice(0,10),
    side:trade.side,
    price:Number(trade.price || 0)
  };
}
