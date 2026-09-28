// Cloudflare Worker：统一代理股票、ETF、基金真实行情与历史数据
// Deployment marker: 2026-09-29 — credentials-ready redeploy
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,OPTIONS",
  "access-control-allow-headers": "Content-Type,Accept",
  "access-control-max-age": "86400",
  "vary": "Origin"
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...cors,
      ...extra
    }
  });

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; InvestmentSimulator/1.0)",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

const EASTMONEY_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1",
  "Accept": "*/*",
  "Referer": "https://fund.eastmoney.com/",
  "Origin": "https://fund.eastmoney.com"
};

async function upstream(target, headers = {}, cache = "public,max-age=30") {
  try {
    const response = await fetch(target, {
      method: "GET",
      headers,
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body, headers: response.headers };
  } catch (error) {
    return { ok: false, status: 599, body: String(error?.message || error), headers: new Headers() };
  }
}

async function proxyYahoo(symbol, params) {
  const hosts = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];
  let last = null;
  for (const host of hosts) {
    const target = new URL("https://" + host + "/v8/finance/chart/" + encodeURIComponent(symbol));
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") target.searchParams.set(key, value);
    }
    const result = await upstream(target, YAHOO_HEADERS, "public,max-age=30");
    last = { host, ...result };
    if (result.ok) {
      return new Response(result.body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public,max-age=30",
          "x-data-source": host,
          ...cors
        }
      });
    }
  }
  return json({
    error: "Yahoo Finance 上游不可用",
    upstream: last?.status,
    source: last?.host,
    detail: String(last?.body || "").slice(0, 500)
  }, 502);
}

async function proxyFund(params) {
  const target = new URL("https://api.fund.eastmoney.com/f10/lsjz");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") target.searchParams.set(key, value);
  }
  const result = await upstream(target, EASTMONEY_HEADERS, "public,max-age=300");
  if (!result.ok) {
    return json({
      error: "天天基金历史净值接口不可用",
      upstream: result.status,
      detail: String(result.body || "").slice(0, 500)
    }, 502);
  }
  return new Response(result.body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public,max-age=300",
      "x-data-source": "eastmoney",
      ...cors
    }
  });
}

export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: cors });
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

    if (u.pathname === "/api/health") {
      return json({
        ok: true,
        service: "investment-simulator-api",
        worker: "investment-simulator-api",
        time: new Date().toISOString(),
        endpoints: ["/api/health", "/api/yahoo", "/api/fund"]
      });
    }

    if (u.pathname === "/api/yahoo") {
      const symbol = u.searchParams.get("symbol");
      if (!symbol) return json({ error: "symbol required" }, 400);
      const params = {};
      for (const key of ["period1", "period2", "interval", "range", "events", "includeAdjustedClose"]) {
        if (u.searchParams.has(key)) params[key] = u.searchParams.get(key);
      }
      return proxyYahoo(symbol, params);
    }

    if (u.pathname === "/api/fund") {
      const code = u.searchParams.get("fundCode");
      if (!/^\d{6}$/.test(String(code || ""))) return json({ error: "fundCode must be 6 digits" }, 400);
      const params = {};
      for (const key of ["fundCode", "startDate", "endDate", "pageIndex", "pageSize"]) {
        if (u.searchParams.has(key)) params[key] = u.searchParams.get(key);
      }
      const requested = Math.max(1, Number(params.pageSize || 5000));
      params.pageSize = Math.min(5000, requested);
      return proxyFund(params);
    }

    return json({
      ok: true,
      service: "investment-simulator-api",
      endpoints: ["/api/health", "/api/yahoo", "/api/fund"]
    });
  }
};
