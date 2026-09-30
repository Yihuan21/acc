export function normalizeSimulationBars(bars){
  const seen=new Set();
  return (Array.isArray(bars)?bars:[])
    .map(b=>({
      ...b,
      date:String(b?.date||"").slice(0,10),
      open:Number(b?.open),
      high:Number(b?.high),
      low:Number(b?.low),
      close:Number(b?.close)
    }))
    .filter(b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&Number.isFinite(b.close)&&b.close>0&&Number.isFinite(b.open)&&b.open>0&&Number.isFinite(b.high)&&b.high>0&&Number.isFinite(b.low)&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close))
    .sort((a,b)=>a.date.localeCompare(b.date))
    .filter(b=>{if(seen.has(b.date))return false;seen.add(b.date);return true});
}

export function createSimulation({symbol,assetType="auto",capital=100000,bars,startIndex=0}={}){
  const clean=normalizeSimulationBars(bars);
  if(clean.length<2) throw new Error("历史数据不足，至少需要 2 个交易日");
  const cash=Number(capital);
  const key=String(symbol||"").toUpperCase();
  const currency =
    assetType === "fund" ||
    /\.SS$|\.SZ$/.test(key) ||
    /^(60|68|00|30|5)\d{4}$/.test(key)
      ? "CNY"
      : "USD";
  if(!Number.isFinite(cash)||cash<=0) throw new Error("初始资金必须大于 0");
  return {
    version:1,
    symbol:key,
    assetType:String(assetType||"auto"),
    currency,
    initialCash:cash,
    cash,
    position:{qty:0,avg:0,price:clean[Math.max(0,Math.min(startIndex,clean.length-1))].close,lastBuyDate:""},
    trades:[],
    bars:clean,
    currentIndex:Math.max(0,Math.min(startIndex,clean.length-1)),
    playing:false,
    startedAt:new Date().toISOString()
  };
}

export function currentBar(sim){return sim?.bars?.[sim.currentIndex]||null;}
export function visibleBars(sim){return sim?.bars?.slice(0,(sim.currentIndex??0)+1)||[];}

/**
 * Once a trade has been executed, the simulation timeline cannot move
 * before the most recent trade. This keeps the portfolio state causal:
 * a later trade must never remain in the account while the clock is moved
 * to an earlier date.
 */
export function latestTradeIndex(sim){
  if(!sim?.bars?.length||!Array.isArray(sim.trades)||!sim.trades.length)return -1;
  let latest=-1;
  for(const trade of sim.trades){
    const date=String(trade?.date||"").slice(0,10);
    const index=sim.bars.findIndex(b=>b.date===date);
    if(index>latest)latest=index;
  }
  return latest;
}
export function stepSimulation(sim,delta=1){
  if(!sim?.bars?.length)return sim;
  const d=Math.trunc(delta||0);
  const floor=latestTradeIndex(sim);
  const minIndex=floor>=0?floor:0;
  sim.currentIndex=Math.max(minIndex,Math.min(sim.bars.length-1,sim.currentIndex+d));
  const bar=currentBar(sim);
  if(bar)sim.position.price=bar.close;
  return sim;
}
export function jumpSimulationToDate(sim,date){
  if(!sim?.bars?.length)return sim;
  const target=String(date||"").slice(0,10);
  let idx=sim.bars.findIndex(b=>b.date>=target);
  if(idx<0)idx=sim.bars.length-1;
  const floor=latestTradeIndex(sim);
  if(floor>=0)idx=Math.max(floor,idx);
  sim.currentIndex=idx;
  sim.position.price=sim.bars[idx].close;
  return sim;
}
export function simulationEquity(sim){
  const bar=currentBar(sim), price=bar?.close||sim?.position?.price||0;
  return Number(sim?.cash||0)+Number(sim?.position?.qty||0)*price;
}
export function simulationReturn(sim){
  const initial=Number(sim?.initialCash||0);
  return initial?((simulationEquity(sim)/initial)-1)*100:0;
}
export function isAShareStock(symbol,assetType="auto"){
  const s=String(symbol||"").trim().toUpperCase().replace(/\.(SS|SZ)$/,"");
  return (assetType==="stock"||assetType==="auto")&&/^(60|68|00|30)\d{4}$/.test(s);
}
export function aShareLot(symbol){const s=String(symbol||"").trim().toUpperCase().replace(/\.(SS|SZ)$/,"");return /^68\d{4}$/.test(s)?200:100;}

export function executeSimulationTrade(sim,{side,qty,price,date,feeRate=0.0005,stampDutyRate=0.0005}={}){
  const bar=currentBar(sim);
  if(!bar)throw new Error("当前没有历史交易日");
  const tradeDate=String(date||bar.date).slice(0,10);
  if(tradeDate!==bar.date)throw new Error("交易日期必须等于当前模拟日期");
  let quantity=Number(qty), executionPrice=Number(price);
  if(!Number.isFinite(quantity)||quantity<=0)throw new Error("交易数量必须大于 0");
  if(!Number.isFinite(executionPrice)||executionPrice<=0)throw new Error("成交价必须大于 0");
  const aShare=isAShareStock(sim.symbol,sim.assetType);
  const lot=aShare?aShareLot(sim.symbol):1;
  if(aShare&&side==="buy")quantity=Math.floor(quantity/lot)*lot;
  if(aShare&&side==="sell"&&quantity%lot!==0)quantity=Math.floor(quantity/lot)*lot;
  if(quantity<=0)throw new Error("A股买入数量需满足最小交易单位");
  if(side==="sell"&&quantity>sim.position.qty)throw new Error("持仓不足");
  if(aShare&&side==="sell"&&sim.position.lastBuyDate===tradeDate)throw new Error("A股实行T+1，今日买入的持仓不能今日卖出");
  const gross=executionPrice*quantity;
  const fee=gross*Math.max(0,Number(feeRate)||0)+(aShare&&side==="sell"?gross*Math.max(0,Number(stampDutyRate)||0):0);
  if(side==="buy"){
    if(gross+fee>sim.cash)throw new Error("现金不足");
    sim.position.avg=(sim.position.avg*sim.position.qty+gross+fee)/(sim.position.qty+quantity);
    sim.position.qty+=quantity;
    sim.position.lastBuyDate=tradeDate;
    sim.cash-=gross+fee;
  }else{
    sim.cash+=gross-fee;
    sim.position.qty-=quantity;
    if(sim.position.qty<=0){
      sim.position.qty=0;
      sim.position.avg=0;
      sim.position.lastBuyDate="";
    }
  }
  sim.position.price=executionPrice;
  const record={date:tradeDate,side,qty:quantity,price:executionPrice,gross,fee,currency:sim.currency,cashAfter:sim.cash,positionQty:sim.position.qty,stampDuty:aShare&&side==="sell"?gross*Math.max(0,Number(stampDutyRate)||0):0};
  sim.trades.push(record);
  return record;
}
