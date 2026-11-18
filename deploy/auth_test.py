#!/usr/bin/env python3
"""End-to-end auth tests for CTO Review. Passwords come from env vars (names given by
--reader-env / --admin-env); they are never printed. Usage:
  python3 auth_test.py https://cto-review.pages.dev [--reader-env CTO_REVIEW_SHARED_PASSWORD] [--admin-env CTO_REVIEW_ADMIN_PASSWORD]
"""
import argparse, os, re, sys, urllib.request, urllib.parse, urllib.error, http.client
ap = argparse.ArgumentParser(); ap.add_argument('base')
ap.add_argument('--reader-env', default='CTO_REVIEW_SHARED_PASSWORD'); ap.add_argument('--admin-env', default='CTO_REVIEW_ADMIN_PASSWORD')
ap.add_argument('--ua', default='cto-review-selftest/1.0')
a = ap.parse_args(); B = a.base.rstrip('/')
class NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *x, **k): return None
op = urllib.request.build_opener(NoRedir)
def req(path, method='GET', data=None, cookie=None, accept='text/html'):
    h = {'User-Agent': a.ua, 'Accept': accept}
    if cookie: h['Cookie'] = cookie
    if data is not None:
        data = urllib.parse.urlencode(data).encode(); h['Content-Type'] = 'application/x-www-form-urlencoded'; h['Origin'] = B
    r = urllib.request.Request(B + path, data=data, headers=h, method=method)
    try: resp = op.open(r, timeout=30)
    except urllib.error.HTTPError as e: resp = e
    body = resp.read().decode('utf-8', 'replace')
    return resp.status if hasattr(resp, 'status') else resp.code, resp.headers, body
results = []
def check(name, cond, info=''):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{info}]' if info else ''))
def login(user, pw, nxt='/'):
    s, h, b = req('/login', 'POST', {'username': user, 'password': pw, 'next': nxt})
    sc = h.get('Set-Cookie') or ''
    m = re.match(r'(ctor_s=[^;]+)', sc)
    return s, h, b, (m.group(1) if m else None), sc
rp, apw = os.environ.get(a.reader_env), os.environ.get(a.admin_env)
if not rp or not apw: sys.exit('missing password env vars')
s, h, b = req('/'); check('unauth / -> redirect to /login', s in (302, 303) and h.get('Location', '').startswith('/login'), f"{s} {h.get('Location','')[:40]}")
check('no Access redirect', 'cloudflareaccess' not in (h.get('Location') or ''))
s, h, b = req('/login'); check('login page 200 + form', s == 200 and 'name="password"' in b and 'dir="rtl"' in b, str(s))
check('login page CSP header', "script-src 'self'" in (h.get('Content-Security-Policy') or ''))
for p in ['/assets/app.js', '/index.json', '/search.json', '/2026-11-17/brief.json', '/admin/', '/admin/sources.json', '/admin/stats/', '/admin/stats/data.json', '/archive/']:
    s, h, b = req(p); check(f'unauth {p} blocked', s in (302, 303, 401) and 'CTO<b>Review' not in b and '"date"' not in b, str(s))
s, h, b = req('/assets/style.css'); check('unauth style.css allowed', s == 200, str(s))
s, h, b = req('/assets/fonts/heebo-var.woff2') if False else (200, {}, '')
s, h, b, c, sc = login('cto', 'definitely-wrong-password')
check('wrong password -> 401 + error, no cookie', s == 401 and 'שגויים' in b and not c, str(s))
s, h, b, c, sc = login('cto', rp, '/archive/')
check('reader login -> 303 to next + cookie', s == 303 and h.get('Location') == '/archive/' and c, f"{s} {h.get('Location')}")
check('cookie flags HttpOnly/Secure/SameSite=Lax/Max-Age=604800', all(x in sc for x in ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=604800']))
rc = c
s, h, b = req('/', cookie=rc); check('reader / loads', s == 200 and 'CTO<b>Review' in b, str(s))
check('reader nav has no admin link', 'data-admin' not in b and 'href="admin/"' not in b)
check('reader page has /logout link', 'href="/logout"' in b)
s, h, b = req('/2026-11-17/brief.json', cookie=rc); check('reader brief.json loads', s == 200 and '"date"' in b, str(s))
s, h, b = req('/assets/app.js', cookie=rc); check('reader assets load', s == 200, str(s))
s, h, b = req('/admin/', cookie=rc); check('reader /admin/ denied (403 login page)', s == 403 and 'admin' in b and 'srcs' not in b, str(s))
s, h, b = req('/admin/stats/', cookie=rc); check('reader /admin/stats/ denied', s == 403, str(s))
s, h, b = req('/admin/stats/data.json', cookie=rc, accept='application/json'); check('reader stats JSON denied', s == 403 and '"events"' not in b, str(s))
s, h, b = req('/admin/sources.json', cookie=rc); check('reader admin sources.json denied', s == 403, str(s))
s, h, b, c, sc = login('admin', rp); check('admin user with reader password rejected', s == 401 and not c, str(s))
s, h, b, c, sc = login('admin', apw, '/admin/stats/'); check('admin login -> /admin/stats/ + cookie', s == 303 and h.get('Location') == '/admin/stats/' and c, f"{s} {h.get('Location')}")
ac = c
s, h, b = req('/admin/', cookie=ac); check('admin /admin/ loads', s == 200 and 'id="srcs"' in b, str(s))
s, h, b = req('/', cookie=ac); check('admin nav shows admin link', 'data-admin' in b)
s, h, b = req('/admin/stats/', cookie=ac); check('admin stats page loads', s == 200 and 'stats.js' in b, str(s))
s, h, b = req('/admin/stats/data.json', cookie=ac, accept='application/json')
import json
try: ev = json.loads(b).get('events', [])
except Exception: ev = []
check('stats JSON has events', s == 200 and len(ev) > 0, f"{s} events={len(ev)}")
check('stats has a fail and admin success', any(e.get('o') == 'fail' for e in ev) and any(e.get('o') == 'success' and e.get('r') == 'admin' for e in ev))
check('no raw IP in events', not re.search(r'\b\d{1,3}(\.\d{1,3}){3}\b', b))
s, h, b = req('/logout', cookie=rc); check('logout clears cookie', s == 303 and 'Max-Age=0' in (h.get('Set-Cookie') or ''), str(s))
s, h, b = req('/', cookie='ctor_s=' + rc.split('=', 1)[1][:-3] + 'AAA'); check('tampered cookie rejected', s in (302, 303), str(s))
print(f"{sum(r for _, r in results)}/{len(results)} passed")
sys.exit(0 if all(r for _, r in results) else 1)
