// Cloudflare Worker：统一代理股票、ETF、基金真实行情与历史数据
// Deployment marker: 2026-09-29 — credentials-ready redeploy
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
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


function deepseekSystemPrompt() {
  return `你是“投资实验室”的策略研究助手。你的任务不是预测下一根K线，而是在给定的历史训练数据上寻找可解释、可回测的交易规则。
严格规则：
1. 你只能使用请求中提供的 trainingBars。绝不能假设、推断或补充 trainingBars 之后的价格。
2. 不允许使用未来函数、未来收益、未来最高最低点、后视指标。
3. 只能从允许的策略族中选择：ma、rsi、momentum、trend、dca、buyhold。
4. 返回 JSON，不要 Markdown。字段必须包括 strategy、fast、slow、rsiPeriod、oversold、overbought、momentumLookback、momentumThreshold、trendThreshold、dcaDays、position、maxDrawdown、reason、risks。
5. 参数必须适合历史回测，不要承诺收益，不要声称知道未来。
6. position 和 maxDrawdown 用 0 到 1 的小数表示。`;
}

async function proxyDeepSeek(request) {
  if (!request.env?.DEEPSEEK_API_KEY) {
    return json({ error: "Cloudflare 尚未配置 DEEPSEEK_API_KEY" }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: "请求 JSON 无效" }, 400); }
  const bars = Array.isArray(body?.trainingBars) ? body.trainingBars : [];
  const asOf = String(body?.asOfDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return json({ error: "缺少有效 asOfDate" }, 400);
  if (!bars.length || bars.length > 1600) return json({ error: "trainingBars 数量必须为 1-1600" }, 400);
  const clean = bars.map(x => ({
    date: String(x?.date || "").slice(0,10),
    open: Number(x?.open), high: Number(x?.high), low: Number(x?.low),
    close: Number(x?.close), volume: Number(x?.volume || 0)
  })).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.close));
  if (!clean.length || clean.some(x => x.date > asOf)) {
    return json({ error: "数据越界：AI 收到了 asOfDate 之后的数据" }, 400);
  }
  const userPayload = {
    task: "从训练历史中寻找一个稳健、简单、可解释的投资策略，供严格的样本外回测使用。",
    symbol: String(body?.symbol || ""),
    assetType: String(body?.assetType || "auto"),
    asOfDate: asOf,
    trainingRange: { start: clean[0].date, end: clean.at(-1).date, count: clean.length },
    trainingBars: clean
  };
  const upstream = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + request.env.DEEPSEEK_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.15,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: deepseekSystemPrompt() },
        { role: "user", content: JSON.stringify(userPayload) }
      ]
    })
  });
  const raw = await upstream.text();
  if (!upstream.ok) return json({ error: "DeepSeek 请求失败", status: upstream.status, detail: raw.slice(0,500) }, 502);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return json({ error: "DeepSeek 返回无效 JSON" }, 502); }
  const content = parsed?.choices?.[0]?.message?.content;
  if (!content) return json({ error: "DeepSeek 未返回策略" }, 502);
  let strategy;
  try { strategy = JSON.parse(content); } catch { return json({ error: "DeepSeek 策略不是有效 JSON" }, 502); }
  return json({
    ok: true,
    provider: "deepseek",
    model: parsed?.model || "deepseek-chat",
    asOfDate: asOf,
    trainingRange: { start: clean[0].date, end: clean.at(-1).date, count: clean.length },
    strategy
  });
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
    if (u.pathname === "/api/assistant") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      return proxyDeepSeek(request);
    }
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

    if (u.pathname === "/api/health") {
      const deep = u.searchParams.get("deep") === "1";
      const result = {
        ok: true,
        service: "acc-api",
        worker: "acc-api",
        version: "2026-09-30",
        time: new Date().toISOString(),
        endpoints: ["/api/health", "/api/yahoo", "/api/fund", "/api/assistant"]
      };
      if (deep) {
        const yahoo = await upstream(
          "https://query2.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d",
          YAHOO_HEADERS
        );
        const fund = await upstream(
          "https://api.fund.eastmoney.com/f10/lsjz?fundCode=000001&pageIndex=1&pageSize=1",
          EASTMONEY_HEADERS
        );
        result.deepseek = { configured: Boolean(request.env?.DEEPSEEK_API_KEY) };
        result.upstreams = {
          yahoo: { ok: yahoo.ok, status: yahoo.status },
          eastmoney: { ok: fund.ok, status: fund.status }
        };
        result.ok = yahoo.ok && fund.ok;
      }
      return json(result, result.ok ? 200 : 502);
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
      service: "acc-api",
      endpoints: ["/api/health", "/api/yahoo", "/api/fund", "/api/assistant"]
    });
  }
};
