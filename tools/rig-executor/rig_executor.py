#!/usr/bin/env python3
"""Rig-side bridge executor (Route B, v1 — READ-ONLY).

Run this ON THE OWNER'S RIG (Windows). It exposes four read-only,
root-confined tools to the cloud agent's relay over the tailnet:

    list_dir   {path}                                  directory listing
    read_file  {path, max_bytes?}                      text file contents (capped)
    grep       {pattern, path?, glob?}                 regex search under the root
    file_info  {path}                                  size / mtime / type

There is deliberately NO write, delete, or shell capability in this
program. If it is not in the list above, it cannot be done.

Security model:
  * Binds to the host given by --host (default: the machine's
    Tailscale IPv4 via `tailscale ip -4`; falls back to 127.0.0.1
    with a loud warning, which makes it unreachable from the tailnet).
  * Every request needs the session token (Authorization: Bearer).
    The token is generated fresh on each launch and printed once —
    closing the window kills both the server and the token. Set the
    EXECUTOR_TOKEN environment variable only if you want a stable one.
  * Every requested path is resolved and must stay inside --root;
    escapes (.., symlinks, junctions) are refused and logged.
  * Every call — success, refusal, or error — is appended to an
    audit log (executor-audit.jsonl next to this script).

Usage:
    py rig_executor.py --root "C:\\path\\to\\Native-Media-AI-Studio"
    py rig_executor.py --root . --host 100.x.y.z --port 8799

Python 3, standard library only. Ctrl+C stops it.
"""
import argparse, datetime, hmac, json, os, re, secrets, subprocess, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 64 * 1024
READ_DEFAULT = 64 * 1024
READ_HARD_CAP = 256 * 1024
LIST_CAP = 200
GREP_FILE_CAP = 512 * 1024
GREP_FILES_CAP = 2000
GREP_MATCH_CAP = 100
SKIP_DIRS = {".git", "node_modules", ".kilo", ".agents", "dist", "build",
             "__pycache__", ".bridge-executor"}

STATE = {}  # root_real, root_norm, token, audit_path


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec="seconds")


def audit(entry):
    entry = {"ts": now_iso(), **entry}
    try:
        with open(STATE["audit_path"], "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass  # auditing must never take the server down


def resolve_inside(path_arg):
    """Resolve a requested path against the root; return real path or None."""
    if not isinstance(path_arg, str) or not path_arg.strip():
        return None
    p = path_arg if os.path.isabs(path_arg) else os.path.join(STATE["root_real"], path_arg)
    real = os.path.realpath(p)
    if os.path.commonpath([os.path.normcase(real), STATE["root_norm"]]) != STATE["root_norm"]:
        return None
    return real


def rel(real):
    return os.path.relpath(real, STATE["root_real"]).replace(os.sep, "/")


# ---------------- tools ----------------

def tool_list_dir(args):
    real = resolve_inside(args.get("path", "."))
    if real is None:
        return None, "path escapes the root or is invalid"
    if not os.path.isdir(real):
        return None, "not a directory"
    out = []
    for name in sorted(os.listdir(real))[:LIST_CAP]:
        full = os.path.join(real, name)
        try:
            out.append({"name": name, "type": "dir" if os.path.isdir(full) else "file",
                        "size": os.path.getsize(full) if os.path.isfile(full) else None})
        except OSError:
            out.append({"name": name, "type": "?", "size": None})
    return {"path": rel(real), "entries": out,
            "truncated": len(out) >= LIST_CAP}, None


def tool_read_file(args):
    real = resolve_inside(args.get("path", ""))
    if real is None:
        return None, "path escapes the root or is invalid"
    if not os.path.isfile(real):
        return None, "not a file"
    cap = min(int(args.get("max_bytes") or READ_DEFAULT), READ_HARD_CAP)
    with open(real, "rb") as f:
        head = f.read(min(cap, os.path.getsize(real)))
    if b"\x00" in head[:4096]:
        return None, "binary file refused"
    text = head.decode("utf-8", "replace")
    return {"path": rel(real), "bytes_returned": len(head),
            "truncated": os.path.getsize(real) > len(head), "content": text}, None


def tool_file_info(args):
    real = resolve_inside(args.get("path", ""))
    if real is None:
        return None, "path escapes the root or is invalid"
    if not os.path.exists(real):
        return None, "does not exist"
    st = os.stat(real)
    return {"path": rel(real), "type": "dir" if os.path.isdir(real) else "file",
            "size": st.st_size,
            "modified": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")}, None


def tool_grep(args):
    pattern = args.get("pattern", "")
    if not pattern or len(pattern) > 300:
        return None, "pattern missing or too long"
    try:
        rx = re.compile(pattern)
    except re.error as e:
        return None, f"bad regex: {e}"
    base = resolve_inside(args.get("path", "."))
    if base is None:
        return None, "path escapes the root or is invalid"
    glob = args.get("glob") or "*"
    matches, scanned = [], 0
    walker = [(os.path.dirname(base), [os.path.basename(base)])] if os.path.isfile(base) else None
    for dirpath, dirnames, filenames in (walker or os.walk(base)):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if scanned >= GREP_FILES_CAP or len(matches) >= GREP_MATCH_CAP:
                break
            import fnmatch
            if not fnmatch.fnmatch(fn, glob):
                continue
            full = os.path.join(dirpath, fn)
            try:
                if os.path.getsize(full) > GREP_FILE_CAP:
                    continue
                scanned += 1
                with open(full, "rb") as f:
                    raw = f.read()
                if b"\x00" in raw[:4096]:
                    continue
                for i, line in enumerate(raw.decode("utf-8", "replace").splitlines(), 1):
                    if rx.search(line):
                        matches.append({"file": rel(full), "line": i,
                                        "text": line.strip()[:300]})
                        if len(matches) >= GREP_MATCH_CAP:
                            break
            except OSError:
                continue
    return {"pattern": pattern, "files_scanned": scanned,
            "matches": matches, "truncated": len(matches) >= GREP_MATCH_CAP}, None


TOOLS = {"list_dir": tool_list_dir, "read_file": tool_read_file,
         "grep": tool_grep, "file_info": tool_file_info}


# ---------------- HTTP ----------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # keep the console clean; the audit log is the record
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        auth = self.headers.get("Authorization", "")
        return auth.startswith("Bearer ") and hmac.compare_digest(auth[7:], STATE["token"])

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"error": "not found"})
        if not self._authorized():
            audit({"tool": None, "outcome": "refused", "detail": "health check with bad or missing token"})
            return self._send(401, {"error": "bad or missing token"})
        self._send(200, {"status": "ok", "root": STATE["root_real"],
                         "tools": sorted(TOOLS), "read_only": True})

    def do_POST(self):
        if self.path != "/call":
            return self._send(404, {"error": "not found"})
        if not self._authorized():
            audit({"tool": None, "outcome": "refused", "detail": "bad or missing token"})
            return self._send(401, {"error": "bad or missing token"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return self._send(413, {"error": "request too large"})
            req = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad JSON"})
        tool, args = req.get("tool"), req.get("args") or {}
        t0 = time.time()
        if tool not in TOOLS:
            audit({"tool": tool, "outcome": "refused", "detail": "unknown tool"})
            return self._send(400, {"error": f"unknown tool: {tool}. "
                                            f"Available: {', '.join(sorted(TOOLS))}"})
        try:
            result, err = TOOLS[tool](args)
        except Exception as e:
            result, err = None, f"{type(e).__name__}: {e}"
        ms = int((time.time() - t0) * 1000)
        args_log = {k: (str(v)[:200]) for k, v in args.items()}
        if err:
            audit({"tool": tool, "args": args_log, "outcome": "error",
                   "detail": err, "ms": ms})
            return self._send(200, {"ok": False, "error": err})
        audit({"tool": tool, "args": args_log, "outcome": "ok",
               "detail": f"{len(json.dumps(result))} bytes", "ms": ms})
        self._send(200, {"ok": True, "result": result})


def detect_tailnet_ip():
    try:
        out = subprocess.run(["tailscale", "ip", "-4"], capture_output=True,
                             text=True, encoding="utf-8", errors="replace",
                             timeout=10).stdout.strip().splitlines()
        for line in out:
            if line.strip().startswith("100."):
                return line.strip()
    except Exception:
        pass
    return None


def main():
    ap = argparse.ArgumentParser(description="Rig-side bridge executor (read-only).")
    ap.add_argument("--root", required=True, help="the only directory the tools may touch")
    ap.add_argument("--host", help="bind address (default: this machine's Tailscale IPv4)")
    ap.add_argument("--port", type=int, default=8799)
    args = ap.parse_args()

    root_real = os.path.realpath(args.root)
    if not os.path.isdir(root_real):
        print(f"error: root is not a directory: {root_real}")
        return 1
    STATE["root_real"] = root_real
    STATE["root_norm"] = os.path.normcase(root_real)
    STATE["token"] = os.environ.get("EXECUTOR_TOKEN") or secrets.token_urlsafe(24)
    STATE["audit_path"] = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       "executor-audit.jsonl")

    host = args.host or detect_tailnet_ip()
    if not host:
        host = "127.0.0.1"
        print("WARNING: no Tailscale IPv4 found - binding to 127.0.0.1 only; "
              "the bridge will NOT reach this server. Pass --host <tailnet IP>.")

    server = ThreadingHTTPServer((host, args.port), Handler)
    audit({"tool": None, "outcome": "startup", "detail": f"root={root_real} bind={host}:{args.port}"})
    print("=" * 64)
    print("BRIDGE EXECUTOR (read-only) is running")
    print(f"  bind:   http://{host}:{args.port}")
    print(f"  root:   {root_real}")
    print(f"  tools:  {', '.join(sorted(TOOLS))}")
    print(f"  audit:  {STATE['audit_path']}")
    print(f"  TOKEN:  {STATE['token']}")
    print("  -> paste the TOKEN to Orion in chat (it dies when this window closes)")
    print("  Ctrl+C stops the server and invalidates the token.")
    print("=" * 64)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
