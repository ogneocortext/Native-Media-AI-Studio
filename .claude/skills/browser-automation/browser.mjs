#!/usr/bin/env node
/**
 * browser-automation — load a page, report what actually happened.
 *
 * Text-first by economy: console errors, failed requests and the accessibility
 * tree catch most breakage for a fraction of the tokens a frame costs, and they
 * answer questions about structure and state that a picture cannot. Screenshots
 * ARE readable now (see core/engine/image-read.ts) — they are just the expensive
 * instrument, kept for the questions that are actually visual.
 */
import { createRequire } from 'node:module'
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

/**
 * Where patchright is: it ships only inside the CodeGPT sidecar, and this script
 * runs from the user's copy in ~/.codegpt/skills with no idea which editor
 * installed that sidecar. In order:
 *
 *   1. CODEGPT_RUNTIME_MODULES, set by the CLI.
 *   2. ~/.codegpt/runtime.json, written by the sidecar at boot
 *      (core/skills/runtime-location.ts). This is the one that knows, and it
 *      covers every host.
 *   3. Beside this script, for a copy run from inside the extension or a checkout.
 *   4. The extension folders of VS Code and its forks, newest CodeGPT version
 *      first, and the JetBrains plugin's sidecar folder.
 *   5. The current directory.
 *
 * Guessing only VS Code's two folders used to fail every run on Cursor,
 * Windsurf, Insiders, VSCodium, Visual Studio and JetBrains.
 *
 * Never hardcode the extension version directory — it is rewritten on every
 * update, which is exactly how the CLI shim breaks when something pins it.
 * Glob and take the highest version present.
 */
const byVersion = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

const EDITOR_EXTENSION_DIRS = [
  '.vscode', '.vscode-insiders', '.vscode-oss', '.cursor', '.windsurf', '.trae', '.kiro', '.positron',
].flatMap((d) => [join(homedir(), d, 'extensions'), join(homedir(), `${d}-server`, 'extensions')])

function candidateRoots() {
  const roots = []
  const add = (dir) => {
    if (!dir) return
    const withSlash = dir.endsWith('/') || dir.endsWith('\\') ? dir : dir + '/'
    if (!roots.includes(withSlash)) roots.push(withSlash)
  }

  add(process.env.CODEGPT_RUNTIME_MODULES)

  const home = process.env.CODEGPT_HOME || join(homedir(), '.codegpt')
  try {
    add(JSON.parse(readFileSync(join(home, 'runtime.json'), 'utf8'))?.modulesRoot)
  } catch {}

  // .../standalone/skills/browser-automation/browser.mjs -> .../standalone/
  const here = dirname(fileURLToPath(import.meta.url))
  add(resolve(here, '..', '..'))
  add(resolve(here, '..', '..', '..'))

  for (const base of EDITOR_EXTENSION_DIRS) {
    if (!existsSync(base)) continue
    const newest = readdirSync(base).filter((d) => d.startsWith('danielsanmedium.dscodegpt-')).sort(byVersion).pop()
    if (newest) add(join(base, newest, 'standalone'))
  }

  const jetbrains = join(homedir(), '.jetbrains-codegpt')
  if (existsSync(jetbrains)) {
    const newest = readdirSync(jetbrains).filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort(byVersion).pop()
    if (newest) add(join(jetbrains, newest, 'standalone'))
  }

  add(process.cwd())
  return roots
}

function resolveChromium() {
  const roots = candidateRoots()
  for (const root of roots) {
    try {
      const mod = createRequire(root)('patchright')
      const chromium = mod?.chromium ?? mod?.default?.chromium
      if (chromium) return { chromium, root }
    } catch {}
  }
  throw new Error(
    'Could not resolve patchright, which ships with the CodeGPT extension. Checked:\n  ' +
      roots.join('\n  ') +
      '\nOpening the editor with CodeGPT enabled once records where it is installed (~/.codegpt/runtime.json).',
  )
}

const args = process.argv.slice(2)
const flag = (n) => {
  const i = args.indexOf(n)
  return i === -1 ? undefined : args[i + 1]
}
/**
 * The positional url is the first bare arg — but NOT the value that belongs to a
 * value-taking flag. Without this, `--session my-id` makes `my-id` look like the
 * url and the tool tries to navigate to it. Boolean flags (--snapshot/--full/
 * --close) consume no value, so their following bare arg IS the url.
 */
const VALUE_FLAGS = new Set([
  '--wait',
  '--eval',
  '--script',
  '--screenshot',
  '--timeout',
  '--session',
])
const url = (() => {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a)) i++
      continue
    }
    return a
  }
  return undefined
})()

/**
 * Session mode. A one-shot launch is the right default — most QA is "load this,
 * tell me what broke" — but a live-app loop (drive a form, think, drive more)
 * needs the SAME page to survive between invocations, because the whole ref
 * scheme dies on a fresh context. `--session <id>` keeps a detached chromium
 * alive across calls; each call reconnects to it over CDP, acts on the page it
 * left open, and exits WITHOUT killing the browser. `--close` tears it down.
 *
 * Why a detached chrome + CDP rather than launchServer(): launchServer ties the
 * browser's lifetime to THIS node process, which exits after every call. We want
 * the browser to outlive the call, so chrome is spawned as its own detached
 * process and every invocation just connects to its debugging port.
 */
const sessionId = flag('--session')
const closing = args.includes('--close')
const sessionMode = !!sessionId

const sessionDir = join(homedir(), '.codegpt', 'ab-sessions')
const sessionFile = (id) => join(sessionDir, `${id}.json`)
const sessionProfile = (id) => join(sessionDir, `${id}-profile`)

// url is required in the classic one-shot; in session mode it is optional
// (omit it to act on the page the session already has open).
if (!url && !sessionMode) {
  console.error(
    'usage: browser.mjs <url> [--snapshot [--full]] [--wait sel] [--eval js]' +
      ' [--script f] [--screenshot p] [--timeout ms]\n' +
      '       browser.mjs [url] --session <id> [ ...actions ]   # persistent page across calls\n' +
      '       browser.mjs --session <id> --close                # tear the session down',
  )
  process.exit(2)
}
const timeout = Number(flag('--timeout') ?? 30000)

const { chromium, root } = resolveChromium()

/**
 * Which browser to drive: the Chromium build patchright pins, else one already
 * on this machine.
 *
 * The pinned build is a ~190 MB download that fails often (October 2026: about
 * 11% of the skill's users hit "Executable doesn't exist" at least once), is
 * re-downloaded whenever patchright moves its pin, and has NO download at all for
 * macOS 11-13, Ubuntu 18.04/20.04 or Debian 11. A Chrome, Edge, Chromium or Brave
 * the user already has does the job for this skill: it tests the user's own
 * pages, so the fingerprint work web_fetch needs the pinned build for does not
 * apply. CODEGPT_BROWSER_PATH names one explicitly.
 */
const systemBrowsers = () => {
  const env = process.env
  const home = homedir()
  if (process.platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
    return [
      ['Google Chrome', 'Google\\Chrome\\Application\\chrome.exe'],
      ['Microsoft Edge', 'Microsoft\\Edge\\Application\\msedge.exe'],
      ['Chromium', 'Chromium\\Application\\chrome.exe'],
      ['Brave', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    ].flatMap(([label, rel]) => roots.map((r) => [label, join(r, rel)]))
  }
  if (process.platform === 'darwin') {
    return [
      ['Google Chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'],
      ['Microsoft Edge', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      ['Chromium', 'Chromium.app/Contents/MacOS/Chromium'],
      ['Brave', 'Brave Browser.app/Contents/MacOS/Brave Browser'],
    ].flatMap(([label, rel]) => ['/Applications', join(home, 'Applications')].map((d) => [label, join(d, rel)]))
  }
  const dirs = [...(env.PATH || '').split(':'), '/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome']
  return [
    ['Google Chrome', 'google-chrome-stable'],
    ['Google Chrome', 'google-chrome'],
    ['Chromium', 'chromium'],
    ['Chromium', 'chromium-browser'],
    ['Microsoft Edge', 'microsoft-edge-stable'],
    ['Microsoft Edge', 'microsoft-edge'],
    ['Brave', 'brave-browser'],
  ].flatMap(([label, bin]) => dirs.filter(Boolean).map((d) => [label, join(d, bin)]))
}

function browserCandidates() {
  const out = []
  const add = (label, path) => {
    if (path && existsSync(path) && !out.some((c) => c.path === path)) out.push({ label, path })
  }
  add('CODEGPT_BROWSER_PATH', process.env.CODEGPT_BROWSER_PATH)
  let pinned = ''
  try {
    pinned = chromium.executablePath()
  } catch {}
  add('pinned Chromium', pinned)
  for (const [label, path] of systemBrowsers()) add(label, path)
  return { candidates: out, pinned }
}

const { candidates: browsers, pinned: pinnedPath } = browserCandidates()
if (!browsers.length) {
  console.error(
    'No browser to drive. The pinned Chromium is not installed' +
      (pinnedPath ? ` (expected at ${pinnedPath})` : ' (patchright offers no download for this OS version)') +
      ', and no Chrome, Edge, Chromium or Brave was found.\n' +
      `Either install it: "${process.execPath}" "${join(root, 'node_modules', 'patchright', 'cli.js')}" install chromium --no-shell\n` +
      'or install Google Chrome, or set CODEGPT_BROWSER_PATH to a Chromium-based browser.',
  )
  process.exit(1)
}
let browserUsed = browsers[0]

/** Ask the OS for a free TCP port by binding :0 and reading it back. */
const freePort = () =>
  new Promise((res, rej) => {
    const srv = createServer()
    srv.on('error', rej)
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => res(p))
    })
  })

/** Is a chrome DevTools endpoint answering on this port? */
const cdpReachable = async (port) => {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 800)
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: c.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

/**
 * Connect to the session's browser, launching a fresh detached chrome the first
 * time (or if the recorded one is gone). Returns a connected Browser plus the
 * page to act on — the one the session left open, or a new blank one.
 */
async function acquireSession(id) {
  mkdirSync(sessionDir, { recursive: true })
  let meta = null
  try {
    meta = JSON.parse(readFileSync(sessionFile(id), 'utf8'))
  } catch {}

  if (!meta || !(await cdpReachable(meta.port))) {
    // Stale or first run — spawn a new detached chrome that outlives us.
    const port = await freePort()
    const child = spawn(
      browserUsed.path,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${sessionProfile(id)}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--headless=new',
        // opt into software WebGL so headless Chromium doesn't warn about the
        // deprecated automatic SwiftShader fallback on WebGL/canvas pages
        '--enable-unsafe-swiftshader',
        'about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    )
    child.unref()
    meta = { port, pid: child.pid, id }
    // Wait for the debugging port to come up before we try to connect.
    const start = Date.now()
    while (Date.now() - start < 10000) {
      if (await cdpReachable(port)) break
      await new Promise((r) => setTimeout(r, 100))
    }
    writeFileSync(sessionFile(id), JSON.stringify(meta))
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${meta.port}`)
  const context = browser.contexts()[0] ?? (await browser.newContext({ locale: 'en-US' }))
  const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage())
  return { browser, page, meta }
}

// --close: kill the detached chrome and forget the session. No page work.
if (sessionMode && closing) {
  let meta = null
  try {
    meta = JSON.parse(readFileSync(sessionFile(sessionId), 'utf8'))
  } catch {}
  // Kill the process GROUP, not the pid. chrome's launcher process exec's/exits
  // right after startup, so meta.pid is usually already gone while the real
  // browser lives on — but because we spawned detached, the browser is in the
  // group led by meta.pid, so -pid reaches it. SIGKILL follows as a backstop.
  if (meta?.pid) {
    try { process.kill(-meta.pid, 'SIGTERM') } catch {}
    try { process.kill(meta.pid, 'SIGTERM') } catch {}
    const t = setTimeout(() => {
      try { process.kill(-meta.pid, 'SIGKILL') } catch {}
    }, 1500)
    if (typeof t.unref === 'function') t.unref()
  }
  try {
    rmSync(sessionFile(sessionId), { force: true })
  } catch {}
  console.log(`session    ${sessionId}  closed${meta?.pid ? ` (pgid ${meta.pid})` : ''}`)
  // Give SIGTERM a moment to land before we exit (the SIGKILL timer is unref'd).
  await new Promise((r) => setTimeout(r, 300))
  process.exit(0)
}

let browser, ctx, page
if (sessionMode) {
  ;({ browser, page } = await acquireSession(sessionId))
} else {
  // First browser that launches: a candidate can exist and still fail (missing
  // shared libraries, a broken install), and the next one may work.
  let lastError
  for (const candidate of browsers) {
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: candidate.path,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
      })
      browserUsed = candidate
      break
    } catch (e) {
      lastError = e
    }
  }
  if (!browser) throw lastError
  ctx = await browser.newContext({ locale: 'en-US' })
  page = await ctx.newPage()
}

const consoleMsgs = []
const failures = []
/**
 * Headless Chromium's software-WebGL fallback (SwiftShader) emits deprecation
 * and context-lost warnings that say nothing about the page under test — they
 * fire on any page that touches a <canvas>/WebGL context. SwiftShader is opted
 * into via the launch flags above; these residual lines are pure host noise.
 */
const CONSOLE_NOISE = /GroupMarkerNotSet|Automatic fallback to software WebGL|CONTEXT_LOST_WEBGL|Failed to create WebGL|swiftshader/i
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    const text = m.text()
    if (CONSOLE_NOISE.test(text)) return
    consoleMsgs.push(`[${m.type()}] ${text.slice(0, 300)}`)
  }
})
page.on('pageerror', (e) => consoleMsgs.push(`[uncaught] ${String(e).slice(0, 300)}`))
/**
 * Third-party analytics/ads are blocked in most environments and drown the
 * signal — a first run against the CodeGPT sidebar reported 8 "failures", 6 of
 * which were doubleclick and google-analytics beacons. Only same-origin and
 * unknown hosts are worth the reader's attention.
 */
const NOISE = /(^|\.)(google|googletagmanager|google-analytics|doubleclick|facebook|segment|sentry|posthog|mixpanel)\./
const noisy = (u) => { try { return NOISE.test(new URL(u).hostname) } catch { return false } }
page.on('requestfailed', (r) => {
  if (!noisy(r.url())) failures.push(`${r.failure()?.errorText ?? 'failed'} ${r.url().slice(0, 140)}`)
})
page.on('response', (r) => {
  if (r.status() >= 400 && !noisy(r.url())) failures.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`)
})

const t0 = Date.now()
let status = 0
let navError = null
try {
  // In session mode the url is optional: without it, act on whatever page the
  // session already has open instead of navigating.
  if (url) {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
    status = resp?.status() ?? 0
  }
  const wait = flag('--wait')
  if (wait) await page.waitForSelector(wait, { timeout })
  /**
   * Wait for CONTENT, not for a fixed delay. A flat 1200ms sleep reported
   * bodyChars 0 on one run of the CodeGPT sidebar and 169 on the next — same
   * URL, same build. A client-rendered app that is merely slow is
   * indistinguishable from one that is broken unless you actually wait for it.
   */
  await page
    .waitForFunction(() => (document.body?.innerText || '').trim().length > 0, {
      timeout: Math.min(timeout, 15000),
    })
    .catch(() => {})
} catch (e) {
  navError = String(e).split('\n')[0]
}


/**
 * Accessibility snapshot with clickable refs.
 *
 * WHY REFS. Driving a page by CSS selector means AUTHORING a selector from a
 * DOM you cannot see, and a selector that matches nothing fails exactly like an
 * element that is absent — the single most expensive failure mode in practice.
 * A snapshot that hands back `@e7 button "Run"` removes the authoring step: you
 * click what the page says is there.
 *
 * Rolled by hand because patchright 1.61's ariaSnapshot() has no refs —
 * `{ref: true}` returns the identical string, and `_snapshotForAI` (what
 * Playwright's own MCP server uses) is not exposed. The structure ariaSnapshot
 * gives is still the best readable view of the page, so `full` returns that
 * instead; refs are for acting, the aria tree is for reading.
 *
 * The ref is stamped as a data attribute IN the page, so it dies on navigation
 * or a re-render. That is why re-snapshotting after anything that changes the
 * page is part of the contract rather than an optimisation.
 */
const REF_ATTR = 'data-ab-ref'
const MAX_SNAPSHOT_CHARS = 15000

const snapshotWithRefs = async (page, { full = false } = {}) => {
  if (full) {
    const aria = await page.locator('body').ariaSnapshot().catch(() => '')
    return aria.length > MAX_SNAPSHOT_CHARS
      ? aria.slice(0, MAX_SNAPSHOT_CHARS) + `\n… [truncated at ${MAX_SNAPSHOT_CHARS} chars]`
      : aria
  }

  return await page.evaluate(
    ({ attr, cap }) => {
      const INTERACTIVE =
        'button, a[href], input, select, textarea, summary, [contenteditable="true"],' +
        '[role=button], [role=link], [role=checkbox], [role=radio], [role=tab],' +
        '[role=menuitem], [role=option], [role=switch], [role=textbox], [role=combobox]'

      // Accessible name, in roughly the order the accname spec resolves it.
      // Deliberately not a full implementation — enough that a human-readable
      // label comes out for the things one actually clicks.
      const nameOf = (el) => {
        const byLabelled = el.getAttribute('aria-labelledby')
        if (byLabelled) {
          const t = byLabelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.innerText || '')
            .join(' ')
            .trim()
          if (t) return t
        }
        const aria = el.getAttribute('aria-label')
        if (aria?.trim()) return aria.trim()
        if (el.id) {
          const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
          if (lbl?.innerText?.trim()) return lbl.innerText.trim()
        }
        const own = (el.innerText || '').replace(/\s+/g, ' ').trim()
        if (own) return own
        for (const a of ['placeholder', 'title', 'alt', 'value', 'name']) {
          const v = el.getAttribute(a)
          if (v?.trim()) return v.trim()
        }
        // Icon-only controls have no text and no label — and they are exactly
        // the ones a name-based locator cannot find, so anything that
        // distinguishes them is worth more here than elsewhere.
        const inner = el.querySelector('[aria-label], img[alt], svg[data-icon], [data-testid]')
        const hint =
          inner?.getAttribute('aria-label') ||
          inner?.getAttribute('alt') ||
          inner?.getAttribute('data-icon') ||
          inner?.getAttribute('data-testid')
        if (hint?.trim()) return hint.trim()
        return ''
      }

      const roleOf = (el) => {
        const explicit = el.getAttribute('role')
        if (explicit) return explicit
        const tag = el.tagName.toLowerCase()
        if (tag === 'a') return 'link'
        if (tag === 'input') return el.type === 'checkbox' || el.type === 'radio' ? el.type : 'textbox'
        if (tag === 'textarea') return 'textbox'
        return tag
      }

      // Clear stale refs so numbering restarts and a dead ref cannot resolve.
      for (const old of document.querySelectorAll(`[${attr}]`)) old.removeAttribute(attr)

      const lines = []
      let n = 0
      for (const el of document.querySelectorAll(INTERACTIVE)) {
        const r = el.getBoundingClientRect()
        // Zero-area or display:none elements are not clickable and would only
        // pad the list; an offscreen-but-scrollable one still counts.
        if (r.width === 0 || r.height === 0) continue
        const style = getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none') continue

        const ref = `e${++n}`
        el.setAttribute(attr, ref)
        const name = nameOf(el).slice(0, 80)
        const state = [
          el.disabled ? 'disabled' : '',
          el.getAttribute('aria-checked') === 'true' || el.checked ? 'checked' : '',
          el.getAttribute('aria-expanded') === 'true' ? 'expanded' : '',
          // The tell that a nameless button opens something.
          el.getAttribute('aria-haspopup') ? `haspopup=${el.getAttribute('aria-haspopup')}` : '',
        ]
          .filter(Boolean)
          .join(' ')
        lines.push(`@${ref} ${roleOf(el)}${name ? ` "${name}"` : ''}${state ? ` [${state}]` : ''}`)
        if (lines.join('\n').length > cap) {
          lines.push(`… [truncated at ${cap} chars — pass full:true or narrow the page]`)
          break
        }
      }
      return lines.join('\n')
    },
    { attr: REF_ATTR, cap: MAX_SNAPSHOT_CHARS },
  )
}

/** Resolve a `@e3` (or bare `e3`) ref to a locator. */
const byRef = (page, ref) => page.locator(`[${REF_ATTR}="${String(ref).replace(/^@/, '')}"]`)

const info = await page
  .evaluate(() => ({
    title: document.title || '',
    bodyChars: (document.body?.innerText || '').trim().length,
    head: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  }))
  .catch(() => ({ title: '', bodyChars: 0, head: '' }))

/**
 * Script mode. The useful QA actions are sequences — click, wait, assert — and a
 * fixed set of --click/--type flags would be a worse Playwright than Playwright.
 * The file default-exports async (page) => result; we own the browser, the
 * reporting and the teardown.
 */
let scriptResult
const scriptPath = flag('--script')
if (scriptPath) {
  try {
    // Resolve to an absolute path, then to a file:// URL. A bare path handed
    // to import() is parsed as a URL, so a Windows absolute path like
    // `c:\qa\test.mjs` fails with ERR_UNSUPPORTED_ESM_URL_SCHEME ("Received
    // protocol 'c:'") — the old `startsWith('/')` test never recognised it as
    // absolute either, so it was also wrongly prefixed with cwd. Field-hit
    // 2026-08-16 (Zone A s15, gpt-5.6-luna on Windows): two failed attempts
    // before the model gave up on --script and fell back to --eval.
    const mod = await import(pathToFileURL(resolve(scriptPath)).href)
    /**
     * Second argument: ref-based helpers. `page` stays first and unchanged, so
     * every script written before these existed keeps working.
     */
    const ui = {
      snapshot: (opts) => snapshotWithRefs(page, opts),
      ref: (r) => byRef(page, r),
      click: (r, opts) => byRef(page, r).click(opts),
      fill: (r, text, opts) => byRef(page, r).fill(text, opts),
      text: (r) => byRef(page, r).innerText(),
    }
    scriptResult = await (mod.default ?? mod.run)(page, ui)
  } catch (e) {
    scriptResult = `SCRIPT ERROR: ${String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')}`
  }
}

let evalResult
const expr = flag('--eval')
if (expr) {
  try {
    evalResult = await page.evaluate(`(() => (${expr}))()`)
  } catch (e) {
    evalResult = `EVAL ERROR: ${String(e).split('\n')[0]}`
  }
}
let snapshotOut
if (args.includes('--snapshot')) {
  snapshotOut = await snapshotWithRefs(page, { full: args.includes('--full') }).catch(
    (e) => `SNAPSHOT ERROR: ${String(e).split('\n')[0]}`,
  )
}

const shot = flag('--screenshot')
if (shot) await page.screenshot({ path: shot, fullPage: true }).catch(() => {})

console.log(`url        ${url}`)
console.log(`http       ${status}${navError ? `  NAV ERROR: ${navError}` : ''}`)
console.log(`load       ${Date.now() - t0}ms`)
console.log(`title      ${JSON.stringify(info.title)}`)
console.log(`bodyChars  ${info.bodyChars}`)
console.log(`patchright ${root}`)
console.log(`browser    ${browserUsed.label}  ${browserUsed.path}`)
if (info.head) console.log(`text       ${info.head}`)
if (expr) console.log(`eval       ${JSON.stringify(evalResult)}`)
if (scriptPath) console.log(`script     ${JSON.stringify(scriptResult, null, 1)}`)
if (shot) console.log(`screenshot ${shot}  (read this file to look at it)`)
if (snapshotOut !== undefined) console.log(`\nsnapshot:\n${snapshotOut}`)
console.log(`\nconsole errors/warnings (${consoleMsgs.length}):`)
for (const m of consoleMsgs.slice(0, 15)) console.log(`  ${m}`)
console.log(`\nrequests failed (${failures.length}):`)
for (const f of [...new Set(failures)].slice(0, 15)) console.log(`  ${f}`)

if (sessionMode) {
  // Leave the detached chrome running for the next call. Dropping our CDP client
  // (by exiting) does NOT kill it — chrome is its own detached process, not a
  // child of ours. Flush the last write first so nothing is lost on exit, since
  // the live websocket would otherwise keep the event loop from ending on its own.
  await new Promise((r) => process.stdout.write('\n', r))
  process.exit(0)
} else {
  await browser.close()
}
process.exit(navError ? 1 : 0)
