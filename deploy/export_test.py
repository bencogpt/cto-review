#!/usr/bin/env python3
"""Checks /admin/export.json access per role. Passwords come from env vars and are never printed."""
import json, os, re, sys, urllib.request, urllib.parse, urllib.error
B = (sys.argv[1] if len(sys.argv) > 1 else 'https://cto-review.pages.dev').rstrip('/')
class NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *x, **k): return None
op = urllib.request.build_opener(NoRedir)
def req(path, method='GET', data=None, cookie=None, accept='application/json'):
    h = {'User-Agent': 'cto-review-selftest/1.0', 'Accept': accept}
    if cookie: h['Cookie'] = cookie
    if data is not None:
        data = urllib.parse.urlencode(data).encode(); h['Content-Type'] = 'application/x-www-form-urlencoded'; h['Origin'] = B
    try: r = op.open(urllib.request.Request(B + path, data=data, headers=h, method=method), timeout=60)
    except urllib.error.HTTPError as e: r = e
    return r.code, r.headers, r.read()
def login(u, pw):
    s, h, b = req('/login', 'POST', {'username': u, 'password': pw, 'next': '/'}, accept='text/html')
    m = re.match(r'(ctor_s=[^;]+)', h.get('Set-Cookie') or ''); return m.group(1) if m else None
ok = True
def check(n, c, i=''):
    global ok; ok &= bool(c); print(('PASS ' if c else 'FAIL ') + n + (f'  [{i}]' if i else ''))
rp, apw = os.environ.get('CTO_REVIEW_SHARED_PASSWORD'), os.environ.get('CTO_REVIEW_ADMIN_PASSWORD')
if not rp or not apw: sys.exit('missing password env vars')
s, h, b = req('/admin/export.json'); check('anon export blocked (401 JSON, or 303 to login)', s == 401 or (s == 303 and 'need=admin' in h.get('Location', '')), f"{s} {h.get('Location')}")
for p in ('/admin/export.json', '/%61dmin/export.json', '//admin/export.json', '/admin%2Fexport.json'):
    s, h, b = req(p, cookie=login('cto', rp)); check(f'reader {p} blocked', s in (403,) or (s in (301, 302, 303, 307, 308) and 'export' not in (h.get('Location') or '').lower() + 'x' * 0 and s != 200), f'{s} {len(b)}B')
ac = login('admin', apw)
s, h, b = req('/admin/export.json', cookie=ac)
d = json.loads(b.decode('utf-8')) if s == 200 else {}
check('admin export 200 JSON', s == 200 and d.get('format') == 'cto-review-export' and d.get('format_version') == 1, f'{s} {len(b)} bytes')
if d: print('counts', len(d['briefs']), len(d['glossary']['entries']), len(d['sources']['sources']), d['generated_at'])
t = b.decode('utf-8', 'replace')
check('export has no identity/email strings', not re.search(r'amiram|grokbot|bencogpt|[\w.+-]+@[A-Za-z0-9-]+\.[A-Za-z]', t, re.I))
check('export has no password values', rp not in t and apw not in t)
s, h, b = req('/admin/', cookie=ac, accept='text/html'); check('admin page has export link', b'download="cto-review-export-' in b and b'href="export.json"' in b, str(s))
s, h, b = req('/admin/', cookie=login('cto', rp), accept='text/html'); check('reader /admin/ has no export link', b'export.json' not in b, str(s))
sys.exit(0 if ok else 1)

