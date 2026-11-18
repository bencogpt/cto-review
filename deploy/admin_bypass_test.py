#!/usr/bin/env python3
"""Reader must not reach the admin area through path variants. Reads the reader password from env
(CTO_REVIEW_SHARED_PASSWORD), never prints it. Run: bash -lc 'python3 admin_bypass_test.py'
Expected today (unpatched worker): FAIL on //admin/, /%61dmin/, /admin%2F... ; after the patched worker: all PASS."""
import os, re, sys, urllib.parse, http.client
H = sys.argv[1] if len(sys.argv) > 1 else 'cto-review.pages.dev'
def raw(path, cookie=None, method='GET', body=None):
    c = http.client.HTTPSConnection(H, timeout=30); h = {'User-Agent': 'cto-review-selftest/1.0', 'Accept': 'text/html'}
    if cookie: h['Cookie'] = cookie
    if body: h['Content-Type'] = 'application/x-www-form-urlencoded'; h['Origin'] = 'https://' + H
    c.request(method, path, body=body, headers=h); r = c.getresponse(); b = r.read().decode('utf-8', 'replace')
    return r.status, {k.lower(): v for k, v in r.getheaders()}, b
s, h, b = raw('/login', method='POST', body=urllib.parse.urlencode({'username': 'cto', 'password': os.environ['CTO_REVIEW_SHARED_PASSWORD'], 'next': '/'}))
m = re.match(r'(ctor_s=[^;]+)', h.get('set-cookie', '')); assert m, 'reader login failed'
rc = m.group(1); bad = 0
for p in ['//admin/', '/%61dmin/', '/admin%2F', '/%61dmin/sources.json', '/admin%2fsources.json', '//admin/stats/', '/ADMIN/', '/%2561dmin/', '/admin/', '/admin/sources.json']:
    s, h, b = raw(p, rc); leak = s == 200 and ('אזור ניהול' in (re.search(r'<title>([^<]*)', b) or [None, ''])[1] or b.lstrip().startswith('{') and '"sources"' in b)
    bad += leak; print(('FAIL ' if leak else 'PASS ') + p, s)
raw('/logout', rc)
sys.exit(1 if bad else 0)
