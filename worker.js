// Cloudflare Worker：统一代理股票/ETF/基金历史与行情数据
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "access-control-max-age": "86400"
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

const proxy = async (target, cache = "public,max-age=30") => {
  try {
    const r = await fetch(target, {
      headers: {
        "User-Agent": "investment-lab/1.0",
        "Referer": "https://finance.yahoo.com/"
      }
    });
    const text = await r.text();
    if (!r.ok) {
      return json({
        error: "上游数据接口返回 HTTP " + r.status,
        upstream: r.status,
        detail: text.slice(0, 300)
      }, 502);
    }
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": cache,
        ...cors
      }
    });
  } catch (e) {
    return json({
      error: "上游数据接口连接失败",
      detail: String(e?.message || e)
    }, 502);
  }
};

export default {
  async fetch(request) {
    const u = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, 405);
    }

    if (u.pathname === "/api/health") {
      return json({
        ok: true,
        service: "investment-simulator-api",
        time: new Date().toISOString()
      });
    }

    if (u.pathname === "/api/yahoo") {
      const symbol = u.searchParams.get("symbol");
      if (!symbol) return json({ error: "symbol required" }, 400);

      const target = new URL(
        "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(symbol)
      );

      for (const k of ["period1", "period2", "interval", "range", "events"]) {
        if (u.searchParams.has(k)) {
          target.searchParams.set(k, u.searchParams.get(k));
        }
      }

      return proxy(target, "public,max-age=30");
    }

    if (u.pathname === "/api/fund") {
      const code = u.searchParams.get("fundCode");
      if (!/^\d{6}$/.test(String(code || ""))) {
        return json({ error: "fundCode must be 6 digits" }, 400);
      }

      const target = new URL("https://api.fund.eastmoney.com/f10/lsjz");

      for (const k of ["fundCode", "startDate", "endDate", "pageIndex", "pageSize"]) {
        if (u.searchParams.has(k)) {
          target.searchParams.set(k, u.searchParams.get(k));
        }
      }

      const requested = Math.max(
        1,
        Number(target.searchParams.get("pageSize") || 5000)
      );
      target.searchParams.set("pageSize", Math.min(5000, requested));

      return proxy(target, "public,max-age=300");
    }

    return json({
      ok: true,
      service: "investment-simulator-api",
      endpoints: ["/api/health", "/api/yahoo", "/api/fund"]
    });
  }
};
