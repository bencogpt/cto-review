#!/usr/bin/env python3
"""Upload missing Pages assets. Never prints the upload token. Shreds the token file."""
import json, os, sys, urllib.request, urllib.error, pathlib, time

TOKEN_PATH = os.environ.get("CTO_UPLOAD_TOKEN_FILE")
ITEMS_PATH = "/workspace/cto-deploy/items.json"
MANIFEST_PATH = "/workspace/cto-deploy/manifest.json"

def shred(path):
    if not path:
        return
    p = pathlib.Path(path)
    if not p.exists():
        return
    try:
        size = p.stat().st_size
        with open(p, "wb") as f:
            for _ in range(3):
                f.seek(0)
                f.write(os.urandom(size if size > 0 else 64))
                f.flush()
                os.fsync(f.fileno())
        p.unlink(missing_ok=True)
    except Exception as e:
        print("shred-error", type(e).__name__, file=sys.stderr)
        try:
            p.unlink(missing_ok=True)
        except Exception:
            pass

def load_jwt(path):
    raw = pathlib.Path(path).read_text(encoding="utf-8")
    # The token file may be wrapped in a tool-result fence. Extract a JWT
    # without printing any of the file contents.
    import re
    m = re.search(r"eyJ[\w-]+\.[\w-]+\.[\w-]+", raw)
    if m:
        return m.group(0)
    raise SystemExit("token-file-unusable")

def api(jwt, path, body):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path,
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + jwt, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:500]
        # Do not print request headers or token. Status + short body only.
        return e.code, err_body

def main():
    if not TOKEN_PATH:
        print("missing-token-path", file=sys.stderr)
        return 2
    jwt = None
    try:
        jwt = load_jwt(TOKEN_PATH)
        if not isinstance(jwt, str) or not jwt.startswith("eyJ") or len(jwt) < 20:
            print("token-shape-invalid", file=sys.stderr)
            return 3
        manifest = json.load(open(MANIFEST_PATH))
        items = json.load(open(ITEMS_PATH))
        hashes = [i["key"] for i in items]
        if set(hashes) != set(manifest.values()) or len(hashes) != len(manifest):
            print("manifest-items-mismatch", file=sys.stderr)
            return 4
        status, res = api(jwt, "/pages/assets/check-missing", {"hashes": hashes})
        if status != 200 or not isinstance(res, dict) or not res.get("success"):
            print("check-missing-failed", status, res if isinstance(res, str) else res.get("errors"))
            return 5
        missing = set(res.get("result") or [])
        print("check-missing-ok", "missing", len(missing))
        for i in items:
            if i["key"] not in missing:
                continue
            payload = {"key": i["key"], "value": i["value"], "metadata": i.get("metadata") or {}, "base64": True}
            st, r = api(jwt, "/pages/assets/upload", [payload])
            ok = isinstance(r, dict) and r.get("success")
            print("upload", i["key"], st, "ok" if ok else (r if isinstance(r, str) else r.get("errors")))
            if not ok:
                return 6
        st, r = api(jwt, "/pages/assets/upsert-hashes", {"hashes": hashes})
        ok = isinstance(r, dict) and r.get("success")
        print("upsert", st, "ok" if ok else (r if isinstance(r, str) else r.get("errors")))
        if not ok:
            return 7
        st, res = api(jwt, "/pages/assets/check-missing", {"hashes": hashes})
        leftover = res.get("result") if isinstance(res, dict) else res
        print("recheck", st, "missing", leftover)
        if st != 200 or leftover not in ([], None):
            return 8
        print("upload-complete")
        return 0
    finally:
        # drop jwt from memory as best-effort; always shred the file
        jwt = None
        shred(TOKEN_PATH)

if __name__ == "__main__":
    sys.exit(main())
