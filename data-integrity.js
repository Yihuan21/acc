// 数据完整性检查工具
// 用于行情、回测、模拟交易共用校验

export function assertNoFutureData(rows = [], simulationDate) {
  const limit = String(simulationDate || '').slice(0, 10);
  if (!limit) return true;
  const bad = rows.some(row => String(row?.date || '').slice(0, 10) > limit);
  if (bad) throw new Error('检测到未来行情数据，已阻止模拟');
  return true;
}

export function sanitizePriceBar(row) {
  const x = {
    date: String(row?.date || '').slice(0, 10),
    open: Number(row?.open),
    high: Number(row?.high),
    low: Number(row?.low),
    close: Number(row?.close),
    volume: Number(row?.volume || 0)
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return null;
  if (![x.open, x.high, x.low, x.close].every(Number.isFinite)) return null;
  if (x.open <= 0 || x.close <= 0 || x.high < x.low) return null;
  if (x.high < Math.max(x.open, x.close) || x.low > Math.min(x.open, x.close)) return null;
  return x;
}
