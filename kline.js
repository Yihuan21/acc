// 日K数据处理工具
// 只处理已经提供的历史数据，不负责请求未来数据

export function normalizeKLine(rows = []) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      date: String(row?.date || '').slice(0, 10),
      open: Number(row?.open),
      high: Number(row?.high),
      low: Number(row?.low),
      close: Number(row?.close),
      volume: Number(row?.volume || 0)
    }))
    .filter(row => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return false;
      if (![row.open,row.high,row.low,row.close].every(Number.isFinite)) return false;
      return row.open > 0 && row.high >= row.low && row.close > 0;
    })
    .sort((a,b)=>a.date.localeCompare(b.date))
    .filter(row=>{
      if(seen.has(row.date)) return false;
      seen.add(row.date);
      return true;
    });
}

export function visibleKLine(rows, simulationDate) {
  const limit = String(simulationDate || '').slice(0,10);
  if (!limit) return normalizeKLine(rows);
  return normalizeKLine(rows).filter(row=>row.date<=limit);
}

export function movingAverage(rows, period) {
  const n = Number(period);
  return rows.map((row,index)=>{
    if(index+1<n) return {...row, ma:null};
    const slice=rows.slice(index+1-n,index+1);
    return {...row, ma:slice.reduce((sum,x)=>sum+x.close,0)/n};
  });
}

export function addIndicators(rows=[]) {
  let result=normalizeKLine(rows);
  for(const period of [5,10,20,60]) {
    const values=movingAverage(result,period);
    result=result.map((row,i)=>({...row,[`ma${period}`]:values[i].ma}));
  }
  return result;
}

// 为图表和回测提供统一涨跌幅，不依赖外部数据格式
export function enrichDailyKLine(rows=[]) {
  const data=addIndicators(rows);
  return data.map((row,index)=>({
    ...row,
    change:index===0?0:((row.close-data[index-1].close)/data[index-1].close)*100,
    range:((row.high-row.low)/row.open)*100
  }));
}
