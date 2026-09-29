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

export function enrichDailyKLine(rows=[]) {
  const data=addIndicators(rows);
  return data.map((row,index)=>({
    ...row,
    change:index===0?0:((row.close-data[index-1].close)/data[index-1].close)*100,
    range:((row.high-row.low)/row.open)*100,
    bullish: row.close >= row.open
  }));
}

export function klinePoint(row){
  if(!row)return null;
  return {date:row.date,open:row.open,high:row.high,low:row.low,close:row.close,volume:row.volume,change:row.change,ma5:row.ma5,ma10:row.ma10,ma20:row.ma20,ma60:row.ma60};
}

export function movingAverageSignal(rows=[]){
  return enrichDailyKLine(rows).map(row=>({date:row.date,signal: row.ma5 && row.ma20 && row.ma5>row.ma20 ? 'above' : 'below'}));
}

// 供K线组件使用：生成完整图表窗口数据
// 保证传入模拟日期时不会包含未来交易日
export function buildDailyKlineWindow(rows=[], options={}) {
  const data = options.simulationDate
    ? visibleKLine(rows, options.simulationDate)
    : normalizeKLine(rows);
  const enriched = enrichDailyKLine(data);
  const limit = Math.max(1, Number(options.limit) || enriched.length);
  return enriched.slice(-limit);
}

// 计算区间最高最低，供自适应缩放使用
export function klineRange(rows=[]) {
  const data = normalizeKLine(rows);
  if(!data.length) return {high:null, low:null};
  return {high:Math.max(...data.map(x=>x.high)), low:Math.min(...data.map(x=>x.low))};
}
