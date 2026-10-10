// Cloudflare Worker：统一代理股票、ETF、基金真实行情与历史数据
// Deployment marker: 2026-09-29 — credentials-ready redeploy
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
  "access-control-allow-headers": "Content-Type,Accept,Authorization",
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


function deepseekSystemPrompt(mode="strategy") {
  if(mode==="dynamic_decision") return `你是投资组合动态风险决策助手。每次只对当前账户生成目标持仓比例，不选择一套固定策略。只使用 trainingBars 和 account，严禁使用未来信息。目标仓位 targetExposure 必须为0到0.70之间的小数；不确定时降低仓位或持有现金。不得保证收益，不得根据测试区间数据决策。reason 用简洁中文说明趋势、动量、波动与账户风险；monthlyReview 在 monthlyReview=true 时阅读 monthlyOptimization（仅基于过去数据的本地候选检验），判断是否有必要更新策略参数；避免仅因近期短期收益而重训。只返回JSON：{ "decision": { "targetExposure": 0.0, "reason": "...", "monthlyReview": "..." } }。`;
  return `你是“投资实验室”的策略研究助手。你的任务不是预测下一根K线，而是在给定的历史训练数据上寻找可解释、可回测的交易规则。
严格规则：
1. 你只能使用请求中提供的 trainingBars。绝不能假设、推断或补充 trainingBars 之后的价格。
2. 不允许使用未来函数、未来收益、未来最高最低点、后视指标。
3. 只能从允许的策略族中选择：ma、rsi、momentum、trend、dca、buyhold。
4. 在做最终策略判断前，必须阅读 optimization.candidates 和 optimization.robustness.candidates。后者已经经过多个时间窗口、参数邻域扰动以及手续费和滑点压力测试。
5. 你必须从 robustness.candidates 的前10名中选择 candidateId，不得自行创造参数组合。正常模式优先选择 stable 为 true 的候选；如果 selectionMode=retry_after_robust_failure，说明全部候选都没有通过稳定性门槛，此时必须避开 excludedCandidateIds，重新选择另一候选继续样本外测试，并在 reason/risks 中明确说明这是鲁棒失败后的强制重选，不得伪称其已通过鲁棒门槛。
6. 返回 JSON，不要 Markdown。字段必须包括 candidateId、strategy、fast、slow、rsiPeriod、oversold、overbought、momentumLookback、momentumThreshold、trendThreshold、dcaDays、position、maxDrawdown、reason、risks。
7. 参数必须适合历史回测，不要承诺收益，不要声称知道未来。
8. position 和 maxDrawdown 用 0 到 1 的小数表示。`;
}

async function proxyDeepSeek(request, env) {
  if (!env?.DEEPSEEK_API_KEY) {
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
  const dynamicMode = String(body?.mode || "") === "dynamic_decision";
  const userPayload = {
    mode: dynamicMode ? "dynamic_decision" : "strategy_research",
    account: dynamicMode ? (body?.account || {}) : undefined,
    monthlyReview: dynamicMode ? Boolean(body?.monthlyReview) : undefined,
    monthlyOptimization: dynamicMode ? (body?.monthlyOptimization || null) : undefined,
    previousDecision: dynamicMode ? String(body?.previousDecision || "") : undefined,
    task: "从训练历史中寻找一个稳健、简单、可解释的投资策略，供严格的样本外回测使用。",
    symbol: String(body?.symbol || ""),
    assetType: String(body?.assetType || "auto"),
    asOfDate: asOf,
    trainingRange: { start: clean[0].date, end: clean.at(-1).date, count: clean.length },
    trainingBars: clean,
    selectionMode: String(body?.selectionMode || "normal"),
    excludedCandidateIds: Array.isArray(body?.excludedCandidateIds) ? body.excludedCandidateIds.map(Number).filter(Number.isFinite) : [],
    optimization: body?.optimization || { tested: 0, candidates: [] }
  };
  const upstream = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.15,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: deepseekSystemPrompt(dynamicMode ? "dynamic_decision" : "strategy") },
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
  if (dynamicMode) {
    const target = Number(strategy?.decision?.targetExposure);
    if (!Number.isFinite(target)) return json({ error: "DeepSeek 动态决策缺少有效 targetExposure" }, 502);
    strategy.decision.targetExposure = Math.max(0, Math.min(0.70, target));
    strategy.decision.reason = String(strategy.decision.reason || "未提供决策理由").slice(0, 500);
  }
  return json({
    ok: true,
    provider: "deepseek",
    model: parsed?.model || "deepseek-chat",
    asOfDate: asOf,
    trainingRange: { start: clean[0].date, end: clean.at(-1).date, count: clean.length },
    strategy
  });
}


const ADHD_SKILL_URL = "https://raw.githubusercontent.com/Yihuan21/i-have-adhd/main/skills/i-have-adhd/SKILL.md";

async function loadAdhdSkill() {
  const response = await fetch(ADHD_SKILL_URL, {
    headers: { "Accept": "text/plain" },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!response.ok) throw new Error("SKILL.md fetch failed: " + response.status);
  const markdown = await response.text();
  const skill = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "").trim();
  if (!skill || skill.length > 30000) throw new Error("SKILL.md is empty or unexpectedly large");
  return skill;
}

async function proxyChat(request, env) {
  if (!env?.ADHD_CHAT_API_KEY) return json({ error: "AI chat endpoint is not configured" }, 503);
  const authorization = request.headers.get("Authorization") || "";
  if (authorization !== "Bearer " + env.ADHD_CHAT_API_KEY) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "请求 JSON 无效" }, 400); }

  if (!Array.isArray(body?.messages) || body.messages.length < 1 || body.messages.length > 100) {
    return json({ error: "messages 必须是 1-100 条的数组" }, 400);
  }
  const allowedRoles = new Set(["system", "developer", "user", "assistant"]);
  const messages = body.messages.map(message => {
    if (!message || !allowedRoles.has(message.role) || message.content === undefined || message.content === null) {
      throw new Error("INVALID_MESSAGES");
    }
    return { role: message.role, content: message.content };
  });

  const adhdMode = body.adhdMode === true;
  if (adhdMode) {
    let skill;
    try { skill = await loadAdhdSkill(); }
    catch (error) {
      return json({ error: "无法读取 i-have-adhd 的 SKILL.md", detail: String(error?.message || error) }, 502);
    }
    const existingSystem = messages.find(message => message.role === "system" && typeof message.content === "string");
    if (existingSystem) {
      existingSystem.content = skill + "\n\n---\n\nAdditional system instructions from the caller:\n" + existingSystem.content;
    } else {
      messages.unshift({ role: "system", content: skill });
    }
  }

  const model = typeof body.model === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(body.model)
    ? body.model : "deepseek-chat";
  const temperature = Number.isFinite(Number(body.temperature))
    ? Math.max(0, Math.min(2, Number(body.temperature))) : 0.7;
  const maxTokens = Number.isFinite(Number(body.max_tokens))
    ? Math.max(16, Math.min(4096, Math.floor(Number(body.max_tokens)))) : 1200;

  let upstreamResponse;
  try {
    upstreamResponse = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false })
    });
  } catch (error) {
    return json({ error: "AI 上游请求失败", detail: String(error?.message || error).slice(0, 300) }, 502);
  }
  const raw = await upstreamResponse.text();
  return new Response(raw, {
    status: upstreamResponse.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-adhd-mode": adhdMode ? "on" : "off",
      ...cors
    }
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
  async fetch(request, env) {
    const u = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: cors });
    if (u.pathname === "/api/assistant") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      return proxyDeepSeek(request, env);
    }
    if (u.pathname === "/api/chat") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!env?.DEEPSEEK_API_KEY) return json({ error: "AI provider is not configured" }, 503);
      try {
        return await proxyChat(request, env);
      } catch (error) {
        if (String(error?.message || error) === "INVALID_MESSAGES") {
          return json({ error: "messages 中的 role 或 content 无效" }, 400);
        }
        return json({ error: "AI chat request failed", detail: String(error?.message || error).slice(0, 300) }, 500);
      }
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
        endpoints: ["/api/health", "/api/yahoo", "/api/fund", "/api/assistant", "/api/chat"]
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
        result.deepseek = { configured: Boolean(env?.DEEPSEEK_API_KEY) };
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
      endpoints: ["/api/health", "/api/yahoo", "/api/fund", "/api/assistant", "/api/chat"]
    });
  }
};
