# LaunchDarkly SE Demo — Server-Side SDK + REST Kill-Switch

A Node.js sample that demonstrates **real-time flag evaluation** with the [LaunchDarkly Node Server SDK](https://docs.launchdarkly.com/sdk/server-side/node), **remote flag control** via the REST API (semantic patch), **multi-context evaluation**, and **custom metric events** (`track`). The browser UI updates live over Server-Sent Events (SSE)—no app restarts required.

---

## What this demo shows

| Capability | How it’s demonstrated |
|------------|------------------------|
| **Server-side evaluation** | `variationDetail` for two flags across many contexts |
| **Why did it evaluate this way?** | Full evaluation reason + `variationIndex` in logs and UI |
| **Live updates** | SDK stream → server logs + SSE → browser (including LD UI changes) |
| **Kill-switch / toggle** | Slide switch → REST `turnFlagOn` / `turnFlagOff` (no LD UI required) |
| **Multi-context loop** | One SDK client evaluates N unique contexts per run |
| **Custom metrics** | `client.track('binary-metric', context)` with conditional sampling to demonstrate Guarded Rollout |
| **End-user experience** | Boolean flag → GIFs; string flag → color switch |

---

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:3000**.

Optional:

```bash
npm run start:sdk   # terminal-only SDK logs (no web UI)
```

---

## Project layout

| File / folder | Role |
|---------------|------|
| **`ld.js`** | Single SDK singleton: contexts, `variationDetail`, flag-update listeners, `track`, SSE payload |
| **`server.js`** | HTTP server on port 3000: UI, REST proxy, `/api/events` (SSE), `/api/config`, `/api/evaluation` |
| **`index.html`** | Split UI: two flags, context selector, live evaluation panels, GIF + color patch |
| **`index.js`** | Optional standalone entry that uses `ld.js` without the web server |
| **`img/`** | `sad_blob.gif` (off), `fireworks.gif` (on) |

```
se_demo/
├── README.md
├── package.json
├── ld.js              # SDK + evaluation loop + track
├── server.js          # HTTP + REST proxy + SSE
├── index.html         # Browser UI
├── index.js           # Optional: npm run start:sdk
└── img/
    ├── sad_blob.gif
    └── fireworks.gif
```

---

## Feature flags

| Flag key | Type | Default (if unavailable) | UI (left / right) |
|----------|------|--------------------------|-------------------|
| `amazing-feature-1` | Boolean | `false` | Left: toggle, GIFs |
| `flag-color-experience` | String (color) | `"gray"` | Right: color patch |

Both flags are evaluated for **every context** on startup and whenever either flag changes in LaunchDarkly.

---

## Contexts (multi-user loop)

Evaluation runs against **multiple unique contexts** using **one** `LaunchDarkly.init()` client (one streaming connection — not one client per context).

| Setting | Location | Description |
|---------|----------|-------------|
| `DEFAULT_CONTEXT_COUNT` | `ld.js` | Default number of contexts (currently **50**) |
| `LD_CONTEXT_COUNT` | Environment | Overrides the default at runtime |

Context keys follow: **`sample-user-key-a-1`** … **`sample-user-key-a-N`**

Each context includes attributes used for targeting demos, for example:

```json
{
  "kind": "user",
  "key": "sample-user-key-a-1",
  "name": "Sample User A 1",
  "tier": "premium",
  "region": "us-east-1",
  "platform": "web"
}
```

**Per evaluation cycle** (startup or flag update), for each context the app:

1. Logs and evaluates `amazing-feature-1` with `variationDetail`
2. Logs and evaluates `flag-color-experience` with `variationDetail`
3. Calls `trackMetric()` (see below)
4. Pushes the full payload to the UI via SSE

Use the **Context** dropdown at the top of the UI to inspect a specific context’s results.

---

## Evaluation: `variationDetail`

This demo uses **`variationDetail`** instead of `variation` so each result includes **value**, **`variationIndex`**, and **`reason`** (e.g. `OFF`, `FALLTHROUGH`, `RULE_MATCH`). That makes demos and debugging much clearer.

| Approach | What you get | Typical use |
|----------|----------------|-------------|
| **`variation`** | Flag value only | Production code paths |
| **`variationDetail`** | Value + reason + `variationIndex` | Debugging, demos, audits |
| **`allFlagsState`** | Many flags for one context | Bulk / bootstrap scenarios |

Docs:

- [Evaluating flags](https://docs.launchdarkly.com/sdk/features/evaluating-flags)
- [Evaluation detail (`variationDetail`)](https://docs.launchdarkly.com/sdk/features/eval-detail)
- [Evaluation reasons](https://docs.launchdarkly.com/sdk/concepts/evaluation-reasons)
- [Flag updates (streaming)](https://docs.launchdarkly.com/sdk/features/flag-updates)

---

## Custom metrics: `track('binary-metric')`

After both flags are evaluated for a context, the app may send a custom event:

```javascript
client.track('binary-metric', context);
client.flush();
```

**Sampling rules** (configured in `ld.js`):

| `flag-color-experience` `variationIndex` | `track()` behavior |
|------------------------------------------|-------------------|
| **`2`** | Sent at **`TRACK_SAMPLE_RATE`** (probabilistic; currently **5%** in code—adjust as needed) |
| **Any other index** | Sent **100%** of the time |

Constants:

| Constant | Purpose |
|----------|---------|
| `METRIC_KEY` | Event / metric key: `binary-metric` |
| `TRACK_SAMPLE_RATE` | Probability when `variationIndex === 2` (e.g. `0.9` = 90%) |
| `TRACK_SAMPLE_VARIATION_INDEX` | Index that triggers sampling (`2`) |
| `TRACK_VARIATION_FLAG_KEY` | Flag whose `variationIndex` drives the rule (`flag-color-experience`) |

Server logs indicate **sent**, **skipped (sampled)**, or **always** for each context.

Docs: [Sending custom events (`track`)](https://docs.launchdarkly.com/sdk/features/events/)

---

## REST API kill-switch (slide toggle)

The **left** slide toggle does **not** change flag state via the SDK. It sends a **semantic PATCH** to the Management API:

- `turnFlagOn` / `turnFlagOff` for environment **`production`**
- Proxied by `server.js` so the API token stays server-side (avoids CORS and token exposure)

Real-world uses of the same pattern:

- Internal admin tools for non-technical operators
- Webhooks / automation when thresholds are breached
- Automated rollback to a safe “off” experience

Docs:

- [Update a feature flag (PATCH)](https://docs.launchdarkly.com/api/operations/patch-feature-flag)
- [Turn flag on / off](https://docs.launchdarkly.com/api/flags/patch-feature-flag#turn-flag-on)
- [Semantic patch](https://docs.launchdarkly.com/api/flags/patch-feature-flag#semantic-patch)

After the REST change, the **SDK stream** re-evaluates all contexts; logs and UI update automatically.

> The REST toggle only targets **`amazing-feature-1`**. `flag-color-experience` is evaluation-only in this demo (change it in the LaunchDarkly UI to see live updates).

---

## Browser UI

**Layout:** two columns (stacks on narrow screens).

| Side | Flag | Controls / display |
|------|------|-------------------|
| **Left** | `amazing-feature-1` | Slide toggle (REST), status, evaluation JSON, GIFs |
| **Right** | `flag-color-experience` | Status, evaluation JSON, color patch (evaluated string as CSS color) |

| `amazing-feature-1` value | Visual |
|---------------------------|--------|
| `false` | `sad_blob.gif` |
| `true` | `fireworks.gif` |

**Live updates:** `EventSource` connects to `GET /api/events`. Changes in the LaunchDarkly UI appear without a manual refresh.

**Context selector:** filters the JSON panels and visuals to one context from the latest evaluation payload.

---

## HTTP API (local server)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Demo UI (`index.html`) |
| `/img/*` | GET | GIF assets |
| `/api/config` | GET | `contextCount`, `contextKeys`, `metricKey` |
| `/api/evaluation` | GET | Latest full evaluation payload (all contexts) |
| `/api/events` | GET | SSE stream of evaluation updates |
| `/api/flag` | GET / PATCH | Proxied flag read / `turnFlagOn` / `turnFlagOff` |

**SSE payload shape (simplified):**

```json
{
  "contextCount": 50,
  "metricKey": "binary-metric",
  "evaluationsByContext": [
    {
      "context": { "kind": "user", "key": "sample-user-key-a-1", "..." : "..." },
      "flags": {
        "amazing-feature-1": { "flagKey": "...", "value": false, "variationIndex": 1, "reason": { "kind": "OFF" } },
        "flag-color-experience": { "flagKey": "...", "value": "blue", "variationIndex": 0, "reason": { "..." } }
      }
    }
  ]
}
```

---

## Flow diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            LaunchDarkly (cloud)                               │
│  Project: demo  │  Env: production  │  Flags: amazing-feature-1,              │
│                                     │         flag-color-experience           │
└────────────▲───────────────────────────────────────▲─────────────────────────┘
             │ SDK stream (flag updates)              │ REST semantic patch
             │                                        │ (amazing-feature-1 on/off)
┌────────────┴────────────────────┐    ┌──────────────┴──────────────────────────┐
│            ld.js               │    │              server.js                   │
│  • single LaunchDarkly.init()  │    │  • :3000 HTTP                            │
│  • loop contexts 1…N           │◀───│  • PATCH /api/flag → Management API      │
│  • variationDetail × 2 flags   │    │  • GET /api/config, /api/evaluation      │
│  • track(binary-metric)        │───▶│  • GET /api/events → SSE to browsers     │
│  • on(update:each-flag)        │    │  • static index.html + img/              │
└────────────▲───────────────────┘    └──────────────▲───────────────────────────┘
             │                                       │
┌────────────┴───────────────────┐    ┌──────────────┴───────────────────────────┐
│  Terminal logs                 │    │  Browser (index.html)                    │
│  • per context, per flag       │    │  • context dropdown                      │
│  • track sent / skipped        │    │  • left: toggle + GIFs                   │
│  • ASCII banner if any ON      │    │  • right: color patch + evaluation JSON  │
└────────────────────────────────┘    └──────────────────────────────────────────┘
```

**Typical paths**

1. **Toggle in browser** → REST PATCH → LD updates → SDK stream → re-evaluate all contexts → logs + SSE → UI updates.  
2. **Change in LaunchDarkly UI** → SDK stream → same re-evaluation loop (no refresh).  
3. **Automated kill-switch** → your service calls the same REST PATCH when conditions fire → same SDK-driven refresh.

---

## Environment configuration

| Setting | Value |
|---------|--------|
| **Project key** | `demo` |
| **Environment** | `production` |
| **Boolean flag** | `amazing-feature-1` |
| **String flag** | `flag-color-experience` |
| **Metric event key** | `binary-metric` |
| **Default context count** | `50` (`DEFAULT_CONTEXT_COUNT` in `ld.js`) |

**Credentials (`.env`, not committed):**

```bash
cp .env.example .env
# Edit .env — set LAUNCHDARKLY_SDK_KEY and LAUNCHDARKLY_API_TOKEN
npm install
npm start
```

**Override context count:**

```bash
export LD_CONTEXT_COUNT=20
npm start
```

**Override port:**

```bash
PORT=3001 npm start
```

> **Security:** Keep secrets in `.env` only (see `.env.example`). `.env` is gitignored — do not commit tokens. Use your own LaunchDarkly SDK key and API token.

---

## Configuration reference (`ld.js`)

| Constant | Description |
|----------|-------------|
| `DEFAULT_CONTEXT_COUNT` | Default N for context loop |
| `FLAGS` | Flag keys + default values |
| `METRIC_KEY` | `track()` event key |
| `TRACK_SAMPLE_RATE` | Sample rate when `variationIndex === 2` |
| `TRACK_SAMPLE_VARIATION_INDEX` | `variationIndex` that triggers sampling (`2`) |
| `TRACK_VARIATION_FLAG_KEY` | Flag used for sampling decision |

Edit `buildContext()` in `ld.js` to change context shape or key format.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Full demo: `server.js` (UI + SDK + REST proxy) |
| `npm run start:sdk` | SDK-only via `index.js` (terminal logs, no HTTP UI) |

---

## Related documentation

**SDK**

- [Node Server SDK](https://docs.launchdarkly.com/sdk/server-side/node)
- [Evaluating flags](https://docs.launchdarkly.com/sdk/features/evaluating-flags)
- [Evaluation detail](https://docs.launchdarkly.com/sdk/features/eval-detail)
- [Evaluation reasons](https://docs.launchdarkly.com/sdk/concepts/evaluation-reasons)
- [Flag updates (streaming)](https://docs.launchdarkly.com/sdk/features/flag-updates)
- [Sending custom events](https://docs.launchdarkly.com/sdk/features/events/)

**REST API**

- [Update a feature flag (PATCH)](https://docs.launchdarkly.com/api/operations/patch-feature-flag)
- [Semantic patch & turn flag on/off](https://docs.launchdarkly.com/api/flags/patch-feature-flag)
- [REST API reference](https://docs.launchdarkly.com/api/)
