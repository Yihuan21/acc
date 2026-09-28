export class DataAPI {
  constructor(settings = {}) {
    this.s = settings;
    this.base = String(settings.apiBase || "").trim().replace(/\/$/, "");
  }

  async request(path, params = {}) {
    const url = new URL(/^https?:\/\//.test(path)
      ? path
      : (this.base ? this.base + path : "https://query1.finance.yahoo.com" + path));
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      let response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } catch (error) {
        if (!this.base && /^https:\/\/(query1|query2)\.finance\.yahoo\.com/.test(url.origin + url.pathname)) {
          throw new Error("行情接口被浏览器网络策略拦截；请在「设置」填写已部署的 Cloudflare Worker API 地址");
        }
        if (!this.base && url.hostname === "api.fund.eastmoney.com") {
          throw new Error("基金接口被浏览器跨域策略拦截；请在「设置」填写已部署的 Cloudflare Worker API 地址");
        }
        throw error;
      }
      if (!response.ok) throw new Error("数据接口 HTTP " + response.status);
      const json = await response.json();
      if (json?.chart?.error) throw new Error(json.chart.error.description || "行情接口返回错误");
      return json;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("数据接口超时；请检查 Worker API 地址和网络连接");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async fundHistory(code, start, end) {
    const from = start || "2000-01-01";
    const to = end || new Date().toISOString().slice(0, 10);
    const path = this.base ? "/api/fund" : "https://api.fund.eastmoney.com/f10/lsjz";
    const pageSize = 5000;
    const pages = [];
    for (let pageIndex = 1; pageIndex <= 10; pageIndex++) {
      const params = { fundCode: code, startDate: from, endDate: to, pageIndex, pageSize };
      const json = await this.request(path, this.base ? params : { ...params, callback: "" });
      const list = json?.Data?.LSJZList || json?.data?.LSJZList || json?.LSJZList || [];
      if (!Array.isArray(list) || !list.length) break;
      pages.push(...list);
      if (list.length < pageSize) break;
    }
    const list = pages;
    const rows = list.map(item => {
      const close = Number(item.DWJZ ?? item.close);
      return {
        date: String(item.FSRQ ?? item.date ?? "").slice(0, 10),
        open: close,
        high: close,
        low: close,
        close,
        volume: 0
      };
    }).filter(row =>
      /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
      Number.isFinite(row.close) &&
      row.close > 0
    );
    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 2) throw new Error("基金历史净值不足");
    return rows;
  }

  async fundQuote(code) {
    const rows = await this.fundHistory(code);
    const last = rows.at(-1);
    const prev = rows.at(-2) || last;
    return {
      symbol: code,
      name: "基金 " + code,
      price: last.close,
      change: last.close - prev.close,
      changePct: prev.close ? (last.close / prev.close - 1) * 100 : 0,
      high: last.close,
      low: last.close,
      currency: "CNY",
      time: new Date(last.date + "T00:00:00").getTime(),
      assetType: "fund"
    };
  }

  async quote(symbol, { assetType = "auto" } = {}) {
    if (assetType === "fund" && /^\d{6}$/.test(String(symbol))) {
      return this.fundQuote(String(symbol));
    }
    const path = this.base ? "/api/yahoo" : "/v8/finance/chart/" + encodeURIComponent(symbol);
    const params = this.base
      ? { symbol, range: "1d", interval: "1m" }
      : { range: "1d", interval: "1m" };
    const json = await this.request(path, params);
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("找不到该标的");
    const price = Number(meta.regularMarketPrice);
    if (!Number.isFinite(price)) throw new Error("接口未返回价格");
    const previous = Number(meta.previousClose ?? meta.chartPreviousClose ?? price) || price;
    const instrument = String(meta.instrumentType || "").toUpperCase();
    const detected =
      instrument.includes("MUTUALFUND") || instrument.includes("FUND") ? "fund" :
      instrument.includes("ETF") ? "etf" :
      instrument.includes("EQUITY") ? "stock" : "unknown";
    return {
      symbol: meta.symbol || symbol,
      name: meta.longName || meta.shortName || symbol,
      price,
      change: price - previous,
      changePct: previous ? (price / previous - 1) * 100 : 0,
      high: Number(meta.regularMarketDayHigh) || price,
      low: Number(meta.regularMarketDayLow) || price,
      currency: meta.currency || "USD",
      time: (Number(meta.regularMarketTime) || Date.now() / 1000) * 1000,
      assetType: detected
    };
  }

  async history(symbol, start, end, assetType = "auto") {
    if (assetType === "fund" && /^\d{6}$/.test(String(symbol))) {
      return this.fundHistory(String(symbol), start, end);
    }

    const from = Math.floor(new Date(start || "2000-01-01T00:00:00").getTime() / 1000);
    const to = Math.floor(new Date(end || new Date()).getTime() / 1000) + 86400;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      throw new Error("日期范围无效");
    }

    const path = this.base ? "/api/yahoo" : "/v8/finance/chart/" + encodeURIComponent(symbol);
    const params = this.base
      ? { symbol, period1: from, period2: to, interval: "1d", events: "div,splits" }
      : { period1: from, period2: to, interval: "1d", events: "div,splits" };
    const json = await this.request(path, params);
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("历史数据为空");

    const quote = result.indicators?.quote?.[0] || {};
    const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
    const rows = (result.timestamp || []).map((timestamp, index) => {
      const rawOpen = Number(quote.open?.[index]);
      const rawHigh = Number(quote.high?.[index]);
      const rawLow = Number(quote.low?.[index]);
      const rawClose = Number(quote.close?.[index]);
      const adjClose = Number(adjusted[index]);
      const factor = Number.isFinite(rawClose) && rawClose > 0 && Number.isFinite(adjClose) && adjClose > 0
        ? adjClose / rawClose
        : 1;
      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        open: rawOpen,
        high: rawHigh,
        low: rawLow,
        close: rawClose,
        adjOpen: Number.isFinite(rawOpen) && rawOpen > 0 ? rawOpen * factor : rawOpen,
        adjHigh: Number.isFinite(rawHigh) && rawHigh > 0 ? rawHigh * factor : rawHigh,
        adjLow: Number.isFinite(rawLow) && rawLow > 0 ? rawLow * factor : rawLow,
        adjClose: Number.isFinite(adjClose) && adjClose > 0 ? adjClose : rawClose,
        volume: Number(quote.volume?.[index]) || 0
      };
    }).filter(row =>
      /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
      Number.isFinite(row.close) &&
      row.close > 0
    );

    const seen = new Set();
    const clean = rows.filter(row => {
      if (seen.has(row.date)) return false;
      seen.add(row.date);
      return true;
    });
    if (clean.length < 2) throw new Error("历史数据不足");
    return clean;
  }
}
