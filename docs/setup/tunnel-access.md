# Tunnel / Sandbox Access

Expose the running local services through a public HTTPS tunnel so an AI agent
in a sandbox VM (or any remote machine) can reach them for interactive testing
and interaction while the server runs on your local machine.

## Prerequisites

- Backend and frontend must already be running locally:
  - Backend: `http://127.0.0.1:8000`
  - Frontend: `http://127.0.0.1:5173`
- A tunnel provider account (free tiers work):
  - **ngrok** — https://ngrok.com/download (recommended, most reliable)
  - **localtunnel** — `npx localtunnel` (no account needed, less reliable)
- PowerShell 7.6+ (scripts use `#Requires -Version 7.6`)

## Quick Start (ngrok)

### 1. Install ngrok

```powershell
# Download from https://ngrok.com/download and unzip to a folder on PATH
# Or via chocolatey:
choco install ngrok

# Required once per machine - tunnels will not start without it:
ngrok config add-authtoken <your-token>
```

### 2. Start the tunnel

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-tunnel.ps1
```

Only the **Vite dev server** is published. Vite proxies `/api`, `/output` and
`/ws` to `127.0.0.1:8000`, so one public URL reaches both the UI and the API:

```
  Frontend    : https://a1b2c3d4.ngrok-free.app
  API         : https://a1b2c3d4.ngrok-free.app/api/...   (proxied by Vite)
  Verified    : True
```

A free ngrok account serves **one endpoint at a time**, so the backend cannot
be published as well on the free tier - this mode is the default for that reason.
To publish the backend directly instead (handy when a non-browser client calls
the API and you would rather not depend on the Vite proxy):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-tunnel.ps1 -Target both
```

If `Verified : False`, the tunnel is not usable - check
`scripts/utility/ngrok-backend.log` before pointing an agent at it.

### 3. CORS needs no configuration

The script exports `PUBLIC_ORIGIN` **for its own PowerShell session only** — the
already-running backend process never sees it, so there is nothing to restart.

Tunnel hostnames are randomized on every start, so they cannot be listed in a
static allowlist. Instead the backend matches them by pattern
(`get_public_origin_regex()` in `packages/backend/app/core/cors.py`), covering
localtunnel, ngrok, Cloudflare Tunnel and serveo. Both the global
`CORSMiddleware` and the per-endpoint helpers in `api/audio.py` use the same
check, so preflights and media downloads agree.

Set `PUBLIC_ORIGIN` / `PUBLIC_ORIGINS` **only** for a custom tunnel domain that
isn't one of the known providers.

### 4. Point the sandbox VM agent at the public URLs

Read the current URLs from `scripts/utility/tunnel-urls.json` (written by the
script) rather than hard-coding them — they rotate every session.

**localtunnel only:** every request must send the bypass header, otherwise the
agent receives an HTML interstitial instead of JSON.

```bash
# Backend API
curl -H 'bypass-tunnel-reminder: true' https://<random>.loca.lt/api/health

# Frontend
curl -H 'bypass-tunnel-reminder: true' https://<random>.loca.lt/
```

To make browser code in the frontend call the public API, set these **before
starting Vite** (they are `VITE_`-prefixed, so they are build-time):

```
VITE_PUBLIC_BACKEND_URL=https://<random>.loca.lt
VITE_PUBLIC_FRONTEND_URL=https://<random>.loca.lt
VITE_PUBLIC_EVENTS_URL=https://<random>.loca.lt/api/events
```

The frontend's own dev proxy always targets `127.0.0.1`, since Vite runs on
this machine.

### 5. Stop tunnels when done

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\stop-tunnel.ps1
```

Stop before restarting the frontend or backend: the stop script kills the
tunnel process tree, and a stale tunnel left pointing at a dead port returns
502 to the agent.

### 6. Check the tunnel is still serving

`Verified : True` in the state file is a point-in-time result from startup. The
localtunnel free tier drops connections minutes later, so re-probe when in doubt:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\check-tunnel.ps1
```

```
  Tunnel check (ngrok)
    frontend   : UP   https://a1b2c3d4.ngrok-free.app -> 200
  Tunnel is serving.
```

It exits non-zero when nothing is serving, so it works as a pre-flight check.
It probes with `Accept: application/json`, which is also what avoids ngrok's
`ERR_NGROK_6024` interstitial page.

## Tunnel State

The tunnel script writes runtime state to `scripts/utility/tunnel-urls.json`
(gitignored — it holds live public hostnames and PIDs) and appends to
`scripts/utility/tunnel.log`. Useful keys:

| Key | Meaning |
|---|---|
| `backend_url` / `frontend_url` | Public HTTPS endpoints |
| `verified` | `true` only after the script probed the backend through the tunnel |
| `required_headers` | Headers the agent must send (localtunnel bypass) |
| `backend_node_pid` / `frontend_node_pid` | The real tunnel processes |
| `backend_process_tree` / `frontend_process_tree` | Everything to kill on stop |

Other automation (agents, Playwright, diagnostic scripts) can read the JSON
file to discover the current public URLs without parsing stdout.

## Environment Variables Reference

### Backend (FastAPI)

| Variable | Purpose | Example |
|---|---|---|
| `PUBLIC_ORIGIN` | Custom tunnel origin, matched in addition to the known providers | `https://studio.example.com` |
| `PUBLIC_ORIGINS` | Comma-separated list of custom origins | `https://a.example.com,https://b.example.com` |

Known providers (`*.loca.lt`, `*.ngrok-free.app`, `*.ngrok.app`, `*.ngrok.io`,
`*.trycloudflare.com`, `*.serveo.net`) are allowed without configuring anything.

### Frontend (Vite / TypeScript)

| Variable | Purpose | Example |
|---|---|---|
| `VITE_PUBLIC_BACKEND_URL` | Override backend API base URL in tunnel mode | `https://x.loca.lt` |
| `VITE_PUBLIC_FRONTEND_URL` | Override frontend base URL in tunnel mode | `https://x.loca.lt` |
| `VITE_PUBLIC_EVENTS_URL` | Override SSE endpoint URL | `https://x.loca.lt/api/events` |
| `VITE_PUBLIC_SSE_URL` | Alias for `VITE_PUBLIC_EVENTS_URL` | `https://x.loca.lt/api/events` |
| `VITE_BACKEND_URL` | Backend URL for local dev (ignored in tunnel mode) | `http://127.0.0.1:8000` |

All are read at **build/dev-server start**, so set them before `pnpm dev`.

## Backend CORS Changes

`CORSMiddleware` is configured with `get_all_origins()` (local + explicitly
configured public origins) **and** `get_public_origin_regex()`. The regex is
what makes randomized tunnel hostnames work; the static list alone cannot.

Per-endpoint helpers in `api/audio.py` use `is_origin_allowed()`, which applies
the same regex, so proxied media downloads through the tunnel receive
`Access-Control-Allow-Origin` instead of being blocked.

## Frontend CORS / URL Changes

- `vite.config.ts` sets `server.host: "0.0.0.0"` and an explicit
  `allowedHosts` list. **Vite 8 removed the `"all"` wildcard** — passing the
  string now matches no host and every tunnel request is refused with
  `403 Blocked request`. Tunnel providers are listed by suffix; unknown hosts
  stay blocked.
- `vite.config.ts` reads `VITE_PUBLIC_BACKEND_URL` for the frontend's notion of
  the API origin; when set, `config/ports.json` no longer overrides it.
- `portConfig.ts` detects tunnel mode via `isTunnelMode()` (exported as
  `isPublicTunnelActive()`) and derives `events_url` / `sse_url` from the public
  backend URL.
- `sseService.ts` **prefers the same-origin `/api/events` proxy when a tunnel is
  active**, because `getEventsUrl()` returns an absolute `127.0.0.1` address that
  resolves to the *agent's* machine rather than this host. Un-tunneled local
  dev still prefers the configured go-dashboard URL.

## Using localtunnel (fallback)

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-tunnel.ps1 -Provider localtunnel
```

`localtunnel` requires Node.js + `npx`. URLs look like
`https://<random>.loca.lt`, and **every request must carry
`bypass-tunnel-reminder: true`** or the client gets an HTML interstitial
instead of JSON. The free tier is also less reliable than ngrok: transient
`408`/`502` responses are normal, so retry a couple of times before assuming
the tunnel is broken. If the backend probe in the script reports
`Verified: False`, the tunnel is genuinely unusable.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent gets HTML instead of JSON | Missing `bypass-tunnel-reminder: true` (localtunnel) |
| ngrok returns the "You are about to visit ..." page | ngrok's `ERR_NGROK_6024` interstitial. Send `Accept: application/json`; browsers dismiss it after one visit |
| `ERR_NGROK_334` / "endpoint is already online" | The account is already using its one free endpoint. Run `stop-tunnel.ps1`, or use the default `-Target frontend` (one endpoint serves UI and API) |
| `ERR_NGROK_334` even after stopping | An orphaned `ngrok.exe` still holds the endpoint. Check `Get-Process ngrok` and kill leftovers |
| `403 CORS` / preflight returns 400 with no ACAO | Restart the backend so `allow_origin_regex` is loaded. Custom domains must be set via `PUBLIC_ORIGIN` |
| `403 Blocked request. This host ... is not allowed` from the frontend | Vite `allowedHosts` — the string `"all"` is **not** a wildcard in Vite 8. Add the tunnel suffix (e.g. `.loca.lt`) and restart Vite |
| `502` / `503` from the tunnel | The local process died. Check the port is still listening, then `stop-tunnel.ps1` and restart — stale tunnels stay bound to a dead port |
| `Connection refused` from the agent | Tunnel not running; check `scripts/utility/tunnel.log` and `verified` in `tunnel-urls.json` |
| Agent sees stale URL | Re-run `start-tunnel.ps1`; free-tier hostnames rotate each session |
| Old tunnels never die | Already fixed — the stop script now kills the node process and sweeps orphans. Confirm with `Get-Process ngrok` and the `lt-*.log` files |
| Media/audio 403s through the tunnel | `api/audio.py` must use `is_origin_allowed()`; a raw `get_all_origins()` lookup cannot match randomized hostnames |
| `Permission denied` on `tunnel.log` | Close whatever holds the file, or delete it and retry |
| Backend binds `0.0.0.0` instead of `127.0.0.1` | Expected and correct — the tunnel and the LAN both need it. Only the tunnel exposes it; the port is otherwise firewalled |

## Security Notes

- **A tunnel publishes your local API to the internet, unauthenticated.**
  Anyone who learns the URL can drive your generation pipeline. Stop tunnels
  when not actively testing, and prefer a short-lived provider hostname over a
  stable custom domain.
- CORS restricts *browser-based* cross-origin reads; it is not
  authentication. Direct `curl`/script access to the API bypasses it entirely.
  Do not treat an allowlisted origin as a security boundary.
- `allow_origin_regex` trusts any `*.loca.lt` / `*.ngrok-*.app` /
  `*.trycloudflare.com` host, not just your own tunnel. That is a deliberate
  trade-off — hostnames are randomized per start and cannot be pinned — but it
  does mean another tenant of the same provider can be allowlisted. Only run
  tunnels on a trusted network.
- For anything beyond a throwaway test agent, put authentication in front of
  the app (ngrok `--basic-auth`, Cloudflare Access, or an API key checked in a
  FastAPI dependency) and pass the credential in the `Authorization` header.

## Credential hygiene

- **Never commit the authtoken.** `ngrok config add-authtoken` stores it in the user
  profile (`%LOCALAPPDATA%\ngrok\ngrok.yml`), outside this repository. If you paste a
  token into a tracked file, a commit message, or a script, rotate it at
  <https://dashboard.ngrok.com/get-started/your-authtoken> — removing the line
  from the working tree does not remove it from git history.
- Prefer `<your-token>` placeholders in docs, as above.
- `scripts/utility/tunnel-urls.json` holds **live public hostnames** for a
  publicly reachable endpoint, so it is gitignored. Do not force-add it.
- On Windows, the Microsoft Store build of ngrok virtualizes its config: ngrok
  reports the file as valid, but PowerShell `Test-Path` cannot see it. That is
  expected, not a broken install — verify with `ngrok config check`.
