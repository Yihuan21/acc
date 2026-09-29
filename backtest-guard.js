// 回测安全保护层
// 统一检查回测数据是否违反时间约束

export function validateSimulationWindow(rows = [], simulationDate) {
  const limit = String(simulationDate || '').slice(0, 10);
  if (!limit) return { ok: true, future: [] };

  const future = (Array.isArray(rows) ? rows : []).filter(row => {
    const date = String(row?.date || '').slice(0, 10);
    return date && date > limit;
  });

  return {
    ok: future.length === 0,
    future
  };
}

export function safeBacktestInput(rows = [], simulationDate) {
  const result = validateSimulationWindow(rows, simulationDate);
  if (!result.ok) {
    throw new Error('回测数据包含未来日期，已阻止执行');
  }
  return rows;
}
