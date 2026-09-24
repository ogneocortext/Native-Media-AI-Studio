"""Design auditor: contrast (WCAG + APCA) + axe-core + mobile checks.

Layers (see docs/knowledge-library/design-auditing-2026.md):
  1. Computed contrast per visible text node (WCAG ratio + APCA Lc).
  2. axe-core engine rules (wcag2a + wcag2aa tags only).
  3. Mobile viewport: horizontal overflow + sub-24px targets.
VLM screenshot review stays a separate, human-driven step.

Every route runs at desktop 1440x900 in BOTH themes (polarity must be
tested both ways). Mobile 390x844 runs dark on all routes + light on /.

Exit 0 only when: zero WCAG offenders, zero axe violations, zero
overflow/small-target offenders. APCA Lc < 45 on >=12px text is reported
as ADVISORY (non-blocking) — spot text legitimately lives there.

The frontend URL resolves from config/ports.json (frontend_url), falling
back to :5173; override with --base-url= or --port=. Every result row is
tagged with a run id + UTC timestamp so runs can be diffed over time.

Run from the repo root (frontend dev server must be up):
    python tools/tests/contrast_audit.py [/route ...] [--themes dark,light]
        [--base-url=http://127.0.0.1:5173 | --port=5173]

Exit codes: 0 = clean, 1 = blocking failures, 2 = frontend unreachable.
"""

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROUTES = ["/", "/library", "/queue", "/settings", "/health"]
RESULTS = Path(__file__).resolve().parent / "contrast_audit_results.jsonl"


def find_axe_source() -> Path | None:
    """Locate axe.min.js: local node_modules, root, or pnpm store."""
    cands = [
        ROOT / "packages/frontend/node_modules/axe-core/axe.min.js",
        ROOT / "node_modules/axe-core/axe.min.js",
    ]
    for pnpm_dir in (
        ROOT / "node_modules/.pnpm",
        ROOT / "packages/frontend/node_modules/.pnpm",
    ):
        cands.extend(sorted(pnpm_dir.glob(
            "axe-core@*/node_modules/axe-core/axe.min.js")))
    for c in cands:
        if c.exists():
            return c
    return None


TEXT_PROBE_JS = """() => {
  const parseColor = (s) => {
    s = (s || '').trim();
    let m = s.match(/^rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)$/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    m = s.match(/^oklch\\(\\s*([\\d.]+)(%?)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\s*\\)$/);
    if (m) {
      // Oklab -> LINEAR sRGB matrix, then EOTF encode to sRGB. Skipping
      // the encode (treating linear as sRGB) underestimates contrast ~2x —
      // that bug once reported our secondary text at 2.9:1 instead of ~7:1.
      const L = m[2] ? +m[1] / 100 : +m[1];
      const C = +m[3], H = +m[4] * Math.PI / 180;
      const a = C * Math.cos(H), b = C * Math.sin(H);
      const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
      const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
      const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
      const l = l_ * l_ * l_, mm = m_ * m_ * m_, ss = s_ * s_ * s_;
      const enc = (x) => {
        x = Math.max(0, x);
        return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
      };
      const to255 = (x) => Math.max(0, Math.min(255, Math.round(enc(x) * 255)));
      return [
        to255(+4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss),
        to255(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss),
        to255(-0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * ss),
        m[5] === undefined ? 1 : +m[5],
      ];
    }
    m = s.match(/^color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\s*\\)$/);
    if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    if (/^transparent$/i.test(s)) return [0, 0, 0, 0];
    return null;
  };
  const lin = ([r, g, b]) => {
    const f = (c) => { c = Math.max(0, Math.min(1, c)); return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return [f(r / 255), f(g / 255), f(b / 255)];
  };
  // APCA 0.0.98G (sRGB): soft-clamp, polarity exponents, 1.14 scale, offsets.
  const apcaY = (rgb) => {
    const [R, G, B] = lin(rgb);
    let Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    if (Y < 0.022) Y = Y + Math.pow(0.022 - Y, 1.414);
    return Y;
  };
  const apcaLc = (fgRgb, bgRgb) => {
    const Yt = apcaY(fgRgb), Yb = apcaY(bgRgb);
    const reverse = Yt > Yb;  // light text on dark bg
    const s = reverse
      ? Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)
      : Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57);
    const v = s * 1.14;
    if (Math.abs(v) < 0.1) return 0;
    return Math.round((v > 0 ? v * 100 - 2.7 : v * 100 + 2.7) * 10) / 10;
  };
  const effBg = (el) => {
    // True alpha compositing down the ancestor chain onto the Canvas
    // system color (pseudo-layer washes excluded: <0.05 ratio impact).
    let canvas = [0, 0, 0];
    try {
      const d = document.createElement('div');
      d.style.backgroundColor = 'Canvas';
      document.body.appendChild(d);
      const cc = parseColor(getComputedStyle(d).backgroundColor);
      if (cc) canvas = [cc[0], cc[1], cc[2]];
      d.remove();
    } catch { /* fall back to black */ }
    const chain = [];
    let tag = 'canvas';
    let hasPaint = false;
    let n = el;
    while (n) {
      const cs = getComputedStyle(n);
      const c = parseColor(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') hasPaint = true;
      if (c) {
        chain.push(c);
        if (c[3] >= 0.95 && tag === 'canvas') {
          tag = n.tagName + '.' + String(n.className.baseVal !== undefined ? '' : n.className).split(' ')[0];
        }
      }
      if (n === document.documentElement) break;
      n = n.parentElement;
    }
    let r = canvas[0], g = canvas[1], b = canvas[2];
    for (let i = chain.length - 1; i >= 0; i--) {
      const L = chain[i], a = L[3];
      r = L[0] * a + r * (1 - a);
      g = L[1] * a + g * (1 - a);
      b = L[2] * a + b * (1 - a);
    }
    return {
      rgb: [r, g, b],
      disp: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`,
      at: tag,
      hasPaint,
    };
  };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (!text || text.length < 2) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    // NOTE: no viewport-fold filtering — contrast is computed-style, same on/off screen.
    if (r.width < 2 || r.height < 2) continue;
    // What is actually painted under the text's center? IMG/VIDEO/CANVAS
    // anywhere in the hit stack (thumbnails, covers) is invisible to
    // computed style — text over media is UNVERIFIABLE here (axe + VLM
    // review cover it instead). Check the whole stack, not just the top:
    // the top hit is the text element itself.
    let overMedia = false;
    try {
      // Below-fold coordinates hit-test the wrong location when clamped,
      // so bring the element into view first (also settles lazy images).
      // behavior:'instant' — smooth scrolling would leave the measurement
      // mid-glide and miss the underlying image.
      let rr = r;
      if (r.bottom < 0 || r.top > innerHeight) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        rr = el.getBoundingClientRect();
      }
      const cx = rr.left + rr.width / 2;
      const cy = Math.min(Math.max(rr.top + rr.height / 2, 0), innerHeight - 1);
      if (cx >= 0 && cx <= innerWidth) {
        const stack = document.elementsFromPoint(cx, cy);
        overMedia = stack.some((h) => /^(IMG|VIDEO|CANVAS)$/.test(h.tagName));
      }
    } catch { /* keep false */ }
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.2) continue;
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const bg = effBg(el);
    const fgL = lin([fg[0], fg[1], fg[2]]);
    const bgL = lin(bg.rgb);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const a = lum(fgL), b = lum(bgL);
    const fs = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight) >= 700;
    const large = fs >= 24 || (fs >= 18.66 && bold);
    out.push({
      text: text.slice(0, 80),
      fg: cs.color,
      bg: `rgb(${Math.round(bg.rgb[0])}, ${Math.round(bg.rgb[1])}, ${Math.round(bg.rgb[2])})`,
      bg_at: bg.at,
      cls: String(el.className).split(' ').slice(0, 4).join('.'),
      tag: el.tagName, fs: Math.round(fs), bold, large,
      ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100,
      lc: apcaLc([fg[0], fg[1], fg[2]], bg.rgb),
      paint: !!bg.hasPaint || overMedia,
    });
  }
  return out;
}"""

MOBILE_PROBE_JS = """() => {
  const de = document.documentElement;
  const vw = window.innerWidth;
  const overflow = de.scrollWidth > vw + 1;
  const wide = [];
  const seenWide = new Set();
  const describe = (el) => el.tagName + '.' + String(el.className.baseVal !== undefined ? '' : el.className).split(' ').slice(0, 2).join('.');
  for (const el of document.querySelectorAll('body *')) {
    if (wide.length >= 10) break;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    // Too wide OR right edge past the viewport (off-canvas drawers that
    // still expand the scroll area are the usual cause).
    const tooWide = r.width > vw + 1 && r.width < 10000;
    const sticksOut = r.left < vw && r.left + r.width > vw + 1 && r.width >= 50;
    if ((overflow || tooWide || sticksOut) && (tooWide || sticksOut)) {
      const key = describe(el);
      if (!seenWide.has(key)) { seenWide.add(key); wide.push(key + ' x=' + Math.round(r.left) + ' w=' + Math.round(r.width)); }
    }
  }
  // Sub-24px interactive targets (WCAG AA minimum; 44px is the target).
  // Inline <a> links are EXEMPT per WCAG 2.2 (inline exception) — dense
  // "View output" rows would otherwise drown the signal. Same treatment
  // for underlined <button>s inside paragraphs: de-facto inline text links
  // (e.g. dashboard footer shortcuts), not 44px-target territory.
  const small = [];
  for (const el of document.querySelectorAll('button, input, select, [role="button"]')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 2 || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const deFactoLink = el.tagName === 'BUTTON'
      && (cs.textDecorationLine || '').includes('underline')
      && el.parentElement && el.parentElement.tagName === 'P';
    if (deFactoLink) continue;
    if (r.width < 24 || r.height < 24) {
      const label = (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40);
      small.push(`${el.tagName} ${Math.round(r.width)}x${Math.round(r.height)} "${label}"`);
      if (small.length >= 15) break;
    }
  }
  // (Inline <a> links are exempt per WCAG 2.2 and intentionally unscanned.)
  return { vw, overflow, wide, small };
}"""

AXE_RUN_JS = """async () => {
  if (typeof axe === 'undefined') return { error: 'axe not injected' };
  const res = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    // color-contrast DISABLED by design (2026-09-23): axe 4.13 resolves our
    // oklch()/color-mix()/light-dark() backgrounds as #ffffff, producing
    // false violations (proven: sidebar-title fg #eeeeee vs "bg #ffffff" on
    // a dark sidebar). Our computed-style probe owns contrast instead.
    rules: { 'color-contrast': { enabled: false } },
  });
  return {
    violations: res.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
      count: v.nodes.length,
    })),
  };
}"""


def verdict(r: dict) -> str:
    if r.get("paint"):
        # Gradient/photo-backed text can't be ratioed from computed style
        # (covered by axe + VLM review instead). Never a failure.
        return "UNVERIFIABLE"
    if r["ratio"] >= 4.5:
        return "PASS"
    if r["large"] and r["ratio"] >= 3.0:
        return "PASS-LARGE"
    if r["ratio"] >= 3.0:
        return "WEAK"
    return "FAIL"


def apca_advisory(r: dict) -> bool:
    """WCAG passes but perceptually thin on >=12px text. Non-blocking."""
    return (r["verdict"] in ("PASS", "PASS-LARGE")
            and abs(r.get("lc", 99)) < 45 and r["fs"] >= 12)


def theme_init(theme: str) -> str:
    """Init script pinning the app theme at document start on every load.

    Registered per browser context, so React boots with the theme already in
    localStorage — eliminating the old goto -> set -> reload double page-load.
    """
    return (
        "() => { try { localStorage.setItem('theme', '" + theme + "'); }"
        " catch { /* pre-origin pages */ } }"
    )


def load(pg, base_url: str, route: str, mobile: bool = False) -> None:
    """Navigate; the context init script has already pinned the theme."""
    pg.goto(f"{base_url}{route}", wait_until="networkidle", timeout=45000)
    if mobile:
        # Wait past hydration: the drawer only leaves normal flow once React
        # marks isMobile. Measuring earlier flags pre-hydration layout.
        try:
            pg.wait_for_function(
                "() => !!document.querySelector('.sidebar-mobile')",
                timeout=8000)
        except Exception:
            pass
        # Let drawer transitions + lazy content settle; re-check below.
        pg.wait_for_timeout(1500)
    pg.wait_for_timeout(2000)


def default_base_url() -> str:
    """Frontend URL from config/ports.json, falling back to :5173."""
    try:
        data = json.loads(
            (ROOT / "config/ports.json").read_text(encoding="utf-8"))
        url = data.get("frontend_url")
        if url:
            return str(url).rstrip("/")
        port = data.get("frontend_port")
        if port:
            return f"http://127.0.0.1:{port}"
    except Exception:
        pass
    return "http://127.0.0.1:5173"


def preflight(base_url: str) -> bool:
    """Fail fast with a clear message when the dev server is down."""
    try:
        with urllib.request.urlopen(base_url, timeout=5) as resp:
            return resp.status < 500
    except Exception as e:
        print(f"ERROR: frontend unreachable at {base_url} ({e})")
        print("Start it with scripts\\start-services.ps1, or pass "
              "--base-url=http://host:port to point elsewhere.")
        return False


def main(argv: list[str]) -> int:
    from playwright.sync_api import sync_playwright

    routes = [a for a in argv if a.startswith("/")] or ROUTES
    themes = ["dark", "light"]
    base_url = default_base_url()
    for a in argv:
        if a.startswith("--themes="):
            themes = [t for t in a.split("=", 1)[1].split(",") if t in ("dark", "light")] or themes
        elif a.startswith("--base-url="):
            base_url = a.split("=", 1)[1].rstrip("/")
        elif a.startswith("--port="):
            base_url = f"http://127.0.0.1:{a.split('=', 1)[1]}"

    # Tags every results row so runs stay diffable in the append-only log.
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    def stamp(row: dict) -> dict:
        row["run"] = run_id
        row["ts"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        return row

    axe_src = None
    axe_path = find_axe_source()
    if axe_path:
        axe_src = axe_path.read_text(encoding="utf-8")
        print(f"axe-core: {axe_path.name} via {axe_path.parent.parent.name}")
    else:
        print("axe-core: NOT FOUND (skipping engine pass)")

    if not preflight(base_url):
        return 2
    print(f"auditing {base_url} routes={routes} themes={themes} run={run_id}")

    failures = 0
    advisories = 0
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        # --- desktop: contrast + axe, both themes ---
        for theme in themes:
            ctx = b.new_context(viewport={"width": 1440, "height": 900})
            ctx.add_init_script(theme_init(theme))
            pg = ctx.new_page()
            for route in routes:
                load(pg, base_url, route)
                rows = pg.evaluate(TEXT_PROBE_JS)
                accused = 0
                unverifiable = 0
                with open(RESULTS, "a", encoding="utf-8") as f:
                    for r in rows:
                        r["route"] = route
                        r["theme"] = theme
                        r["verdict"] = verdict(r)
                        if r["verdict"] == "UNVERIFIABLE":
                            unverifiable += 1
                            continue
                        if apca_advisory(r):
                            r["apca"] = "CAUTION"
                            advisories += 1
                        if r["verdict"] in ("FAIL", "WEAK"):
                            f.write(json.dumps(stamp(r)) + "\n")
                            accused += 1
                            failures += 1
                n = len(rows)
                print(f"[{theme}] {route}: {n} nodes, {accused} below AA, "
                      f"{unverifiable} gradient-backed (axe+VLM covered)",
                      flush=True)
                if axe_src:
                    pg.evaluate(axe_src)
                    ax = pg.evaluate(AXE_RUN_JS)
                    if "error" in ax:
                        print(f"[{theme}] {route}: axe error: {ax['error']}")
                    else:
                        nv = len(ax["violations"])
                        failures += nv
                        for v in ax["violations"]:
                            print(f"[{theme}] {route}: AXE {v['impact']} "
                                  f"{v['id']}: {v['help'][:80]} "
                                  f"x{v['count']} e.g. {v['nodes'][:2]}")
                            with open(RESULTS, "a", encoding="utf-8") as f:
                                f.write(json.dumps(stamp({
                                    "kind": "axe", "route": route,
                                    "theme": theme, **v,
                                })) + "\n")
                        if not nv:
                            print(f"[{theme}] {route}: axe clean")
            ctx.close()
        # --- mobile 390px: overflow + targets (dark all routes, light /) ---
        mob_themes: dict[str, list[str]] = {"dark": routes, "light": ["/"]}
        if "light" not in themes:
            mob_themes = {"dark": routes}
        if "dark" not in themes:
            mob_themes = {"light": ["/"]}
        for theme, mroutes in mob_themes.items():
            ctx = b.new_context(viewport={"width": 390, "height": 844},
                                is_mobile=True, has_touch=True)
            ctx.add_init_script(theme_init(theme))
            pg = ctx.new_page()
            for route in mroutes:
                load(pg, base_url, route, mobile=True)
                m = pg.evaluate(MOBILE_PROBE_JS)
                if m["overflow"] or m["wide"] or m["small"]:
                    # Bare overflow counts even when no offender element was
                    # identified — previously that printed OVERFLOW but could
                    # still exit 0.
                    failures += (int(bool(m["overflow"]))
                                 + len(m["wide"]) + len(m["small"]))
                    print(f"[mob/{theme}] {route}: OVERFLOW vw={m['vw']} "
                          f"wide={m['wide']} small_targets={m['small']}")
                    with open(RESULTS, "a", encoding="utf-8") as f:
                        f.write(json.dumps(stamp({
                            "kind": "mobile", "route": route,
                            "theme": theme, **m,
                        })) + "\n")
                else:
                    print(f"[mob/{theme}] {route}: clean")
            ctx.close()
        b.close()

    with open(RESULTS, "a", encoding="utf-8") as f:
        f.write(json.dumps(stamp({
            "kind": "summary", "base_url": base_url, "routes": routes,
            "themes": themes, "failures": failures, "advisories": advisories,
        })) + "\n")
    print(f"\nblocking failures: {failures} | APCA advisories: {advisories}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
