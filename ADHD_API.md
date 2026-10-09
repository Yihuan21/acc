# i-have-adhd mode for the Cloudflare AI API

This integration adds a separate, protected general-chat endpoint to the existing `acc-api` Worker. It does **not** change the contract of `POST /api/assistant`, which remains dedicated to investment-strategy JSON.

## 1. Configure the Worker secrets

In the directory containing `wrangler.toml`, run:

```bash
npx wrangler secret put ADHD_CHAT_API_KEY
```

Enter a long, random token when prompted. Keep it private. The existing `DEEPSEEK_API_KEY` secret is also required.

If you deploy from the Cloudflare dashboard, open **Workers & Pages → acc-api → Settings → Variables and Secrets → Add → Secret**, and add `ADHD_CHAT_API_KEY`. Do not put either key in `app.js`, `index.html`, GitHub Pages, or any public client-side code.

The general-chat endpoint is intended for trusted server-side callers. A browser-only app cannot safely keep a static bearer token secret; do not ship `ADHD_CHAT_API_KEY` to the browser. If a public browser UI needs this endpoint, put an authenticated server-side/session layer in front of it first.

## 2. Call the API with the mode on or off

Endpoint: `POST https://YOUR-WORKER-DOMAIN/api/chat`

Headers:

```http
Content-Type: application/json
Authorization: Bearer YOUR_ADHD_CHAT_API_KEY
```

### ADHD mode enabled

```json
{
  "adhdMode": true,
  "model": "deepseek-chat",
  "temperature": 0.7,
  "max_tokens": 1200,
  "messages": [
    { "role": "user", "content": "Explain how to debug a failed deployment." }
  ]
}
```

When `adhdMode` is `true`, the Worker fetches the canonical `skills/i-have-adhd/SKILL.md` from this repository:

`https://raw.githubusercontent.com/Yihuan21/i-have-adhd/main/skills/i-have-adhd/SKILL.md`

It strips the YAML frontmatter and adds the skill text as a system instruction. Cloudflare's fetch cache is configured for five minutes, so rule updates can take up to about five minutes to appear.

### ADHD mode disabled

Send the same request with:

```json
"adhdMode": false
```

When disabled, the Worker does not fetch or inject `SKILL.md`. The caller's messages are sent without the ADHD instructions. If omitted, `adhdMode` is off.

## 3. Compatibility and limits

- The response body is passed through from DeepSeek's Chat Completions API, so clients can read `choices[0].message.content` as usual.
- The response includes `x-adhd-mode: on` or `x-adhd-mode: off` for diagnostics.
- `POST /api/assistant` is unchanged. Keep using it for investment strategy research because it enforces its JSON strategy contract and historical-data validation.
- Supported roles are `system`, `developer`, `user`, and `assistant`; send 1–100 messages.
- `model` defaults to `deepseek-chat`; `temperature` is clamped to 0–2 and `max_tokens` to 16–4096.
- If `SKILL.md` cannot be fetched while the mode is on, the endpoint returns an error instead of silently pretending the mode is active.
- The API key and chat endpoint are separate from the public market-data endpoints. Keep the chat token private and apply rate limits/authentication appropriate to your deployment.

## 4. Quick verification

After deploying the Worker, make one authenticated request with `adhdMode: true` and one with `adhdMode: false`. Confirm the responses contain the corresponding `x-adhd-mode` header. Then call `GET /api/health` to confirm the existing Worker is reachable.

The feature is opt-in per request. No change to the existing investment assistant's prompt or output format is required.
