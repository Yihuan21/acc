// Core integration helpers
// Unified layer shared by simulation, backtest and chart rendering.

export function clampHistory(rows = [], simulationDate) {
  const limit = String(simulationDate || '').slice(0, 10);
  return (Array.isArray(rows) ? rows : [])
    .filter(x => !limit || String(x.date).slice(0, 10) <= limit);
}

export function createTradeMarker(trade) {
  if (!trade) return null;
  return {
    date: String(trade.date || trade.time || '').slice(0, 10),
    side: trade.side === 'sell' ? 'sell' : 'buy',
    price: Number(trade.price) || 0,
    qty: Number(trade.qty) || 0
  };
}

export function mergeTradeMarkers(bars = [], trades = []) {
  const map = new Map((trades || []).map(t => [String(t.date || t.time).slice(0,10), createTradeMarker(t)]));
  return (bars || []).map(bar => ({
    ...bar,
    tradeMarker: map.get(String(bar.date).slice(0,10)) || null
  }));
}

export function validateBacktestWindow(rows = [], simulationDate) {
  const limit = String(simulationDate || '').slice(0,10);
  if (!limit) return true;
  return !(rows || []).some(x => String(x.date).slice(0,10) > limit);
}

export function normalizeMarketAsset(asset = {}) {
  const type = String(asset.type || asset.assetType || 'stock').toLowerCase();
  return {
    symbol: String(asset.symbol || '').toUpperCase(),
    type: ['stock','fund','etf'].includes(type) ? type : 'stock',
    currency: asset.currency || 'CNY'
  };
}
