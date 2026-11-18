#!/usr/bin/env python3
"""Checks /admin/export.json and /admin/update.json access per role. Passwords come from env vars and are never printed."""
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
rc = login('cto', rp); ac = login('admin', apw)
for name, fmt in (('export', 'cto-review-export'), ('update', 'cto-review-update')):
    f = f'/admin/{name}.json'
    s, h, b = req(f); check(f'anon {name} blocked (401 JSON, or 303 to login)', s == 401 or (s == 303 and 'need=admin' in h.get('Location', '')), f"{s} {h.get('Location')}")
    for p in (f, f'/%61dmin/{name}.json', f'//admin/{name}.json', f'/admin%2F{name}.json'):
        s, h, b = req(p, cookie=rc); check(f'reader {p} blocked', s != 200 and (s == 403 or s in (301, 302, 303, 307, 308)), f'{s} {len(b)}B')
    s, h, b = req(f, cookie=ac)
    d = json.loads(b.decode('utf-8')) if s == 200 else {}
    check(f'admin {name} 200 JSON', s == 200 and d.get('format') == fmt and d.get('format_version') == 1, f'{s} {len(b)} bytes')
    if name == 'export' and d: print('  counts', len(d['briefs']), len(d['glossary']['entries']), len(d['sources']['sources']), d['generated_at']); latest = max(x['date'] for x in d['briefs'])
    if name == 'update' and d:
        print('  update', d['brief']['date'], len(d['glossary']['entries']), len(d['sources']['sources']), d['generated_at'])
        check('update brief = latest brief', d['brief']['date'] == latest and d.get('date') == latest, d['brief']['date'])
    t = b.decode('utf-8', 'replace')
    check(f'{name} has no identity/email strings', not re.search(r'amiram|grokbot|bencogpt|[\w.+-]+@[A-Za-z0-9-]+\.[A-Za-z]', t, re.I))
    check(f'{name} has no password values', rp not in t and apw not in t)
s, h, b = req('/admin/', cookie=ac, accept='text/html')
check('admin page has export link', b'download="cto-review-export-' in b and b'href="export.json"' in b, str(s))
check('admin page has daily update link', b'download="cto-review-update-' in b and b'href="update.json"' in b and 'עדכון יומי מלא (JSON)'.encode() in b, str(s))
s, h, b = req('/admin/', cookie=rc, accept='text/html'); check('reader /admin/ has no export/update link', b'export.json' not in b and b'update.json' not in b, str(s))
sys.exit(0 if ok else 1)
