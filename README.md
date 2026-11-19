# CTO Review – ארכיון פנימי של סקירת הטכנולוגיה היומית

אתר סטטי (RTL, עברית) שנבנה מקובצי JSON במבנה השכבות (format_version "2-layered").

## Layout
- `content/YYYY-MM-DD.json` – one sanitized brief per day (the `notes` field is stripped on import).
- `assets/` – style.css, theme.js (applies a stored light/dark preference before first paint), app.js (tag filter, print button, archive search, dark-mode toggle, emerging-tech heat tooltips), admin.js (registry search/filters),
  favicon.svg, `fonts/heebo-var.woff2` + `fonts/OFL.txt` (self-hosted Heebo, SIL OFL 1.1).
- `build.py` – generator. `glossary.json` + `glossary_lib.py` – glossary data and matcher; `glossary_suggest.py` – lists
  brief terms not yet in the glossary. `dist/` – output (do not edit by hand).
- `dist/` contains: `index.html` (latest brief + archive sidebar), `archive/index.html`, `actions/index.html`,
  `YYYY-MM-DD/index.html`, `YYYY-MM-DD/brief.json`, `index.json` (date, title, items, actions, url),
  `search.json` (archive search index), `robots.txt` (Disallow all),
  `_headers` (X-Robots-Tag noindex, no-store, DENY framing, CSP). Every page has `<meta name="robots" content="noindex,nofollow">`.

## Pages
- `/` – latest brief («הסקירה האחרונה»), archive sidebar.
- `/actions/` – «דורש פעולה»: every item tagged `action` across all briefs, newest day first, grouped by Hebrew date.
  Each row: date, section, headline, «מה כדאי לעשות» (omitted when `action` is null), link to `/{date}/#item-{id}`.
  Rolling view of the archive, no done-state. Days without action items are skipped; empty state if none.
- `/archive/` – grouped by Hebrew month/year (e.g. «נובמבר 2026»), per-day counts (items · דורשות פעולה),
  search box that filters by date (ISO, d.m.yyyy, Hebrew), title, headlines and summaries. The index is
  `dist/search.json`, fetched same-origin by app.js; matching headlines are listed under each day with links
  to the item. Query is kept in the hash (`/archive/#q=...`). Without the index it falls back to the visible text.
- `/YYYY-MM-DD/` – one brief. Toolbar: tag counts, «הורדת JSON» (`download="tech-brief-YYYY-MM-DD.json"`; the file on the server stays `brief.json`), «הדפסה» (button wired in app.js → `window.print()`), «שמירה כ-PDF» (`data-save-pdf`, temporary title `CTO-Review-YYYY-MM-DD`).
  Prev/next links (older / newer) at the top and bottom; the missing direction is shown disabled on the first/last day.
  The nav highlights «הסקירה האחרונה» for the newest brief and «ארכיון» for older ones (no aria-current on dated pages).
- `/glossary/` – «מילון מושגים» (see Glossary below).
- `/admin/` – sources registry mirror (below). `/admin/stats/` – login statistics (admin only, see Login).

## Print, logout, font, CSP
- Print CSS hides masthead, sidebar, TOC, filters, footer, day navigation, print/download buttons and logout;
  prints every item regardless of the active tag filter, avoids splitting items, keeps tag-pill colours.
- «יציאה» (end of the masthead nav, quieter pill style) → `/logout` (clears the login cookie, served by the worker).
  Not a site section, never marked current.
- Dark mode (moon / sun icon in the masthead, next to logout; hover title «Dark mode» / «Light mode», no Hebrew label):
  keeps the current layout and typography, and applies the charcoal / gold «מודיעין לילי» palette via
  `html[data-theme="dark"]`. `assets/theme.js` runs in `<head>` (no `defer`) and restores `localStorage` key
  `cto-review-theme` (`light` or `dark`) before paint, so the page does not flash. The default is the current light
  theme; the choice is per browser and is not sent to the server. Print CSS forces the light paper look even when
  the reader is in dark mode. The toggle is a `<button>` with inline SVG icons, hidden in print.
- Font: Heebo variable (wght 400–700), subset to Hebrew + Latin (`unicode-range` in style.css), ~36 KB woff2,
  loaded via `@font-face` with a path relative to style.css (`fonts/heebo-var.woff2`), so it works from every page.
  No Google Fonts / CDN requests. Rebuild the subset with fontTools (`varLib.instancer` wght=400:700 + `subset --flavor=woff2`).
- `_headers` adds `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self';
  img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`
  (constant `CSP` in build.py). No inline scripts, inline styles or event-handler attributes are allowed – put
  any new behaviour in `assets/app.js` and styling in `assets/style.css`. No analytics or third-party requests.

## Admin area – sources registry mirror (`/admin/`)
Every build (`python3 build.py` and `python3 build.py --add ...`) regenerates `dist/admin/` from the
current master registry `/workspace/cto-sources/sources.json` (override with `CTO_SOURCES=/path/sources.json`).
The registry itself is only read, never modified.
- `dist/admin/index.html` – «אזור ניהול · מאגר המקורות»: summary strip (updated date, totals, reliability 5–2,
  status, Hebrew count, topics), search (name / id / X handle / best_for / url), combinable filters
  (topic, reliability, status, type, language, access), sort, expand-in-place cards, sanitized changelog.
  Client-side only (`assets/admin.js`); filter state is kept in the URL hash, e.g. `/admin/#topic=quantum&rel=5`.
- `dist/admin/sources.json` – sanitized download («הורדת JSON»): sources + changelog, no `schema` block.
- `dist/admin/export.json` – full export («ייצוא מלא (JSON)»), see «Full data export» below.
- Sanitization (`clean_text` / `clean_source` in build.py): `delivery` -> «מנוי במייל»; inbox addresses, bot/inbox
  wording, box-browser sign-in notes and origin-account / following-list wording are rewritten
  (origin wording -> «סריקת רשת ב-X»); unknown `discovered_via` -> `other`. The build **fails** if a forbidden
  string survives in dist/admin (see `FORBIDDEN`).
- Masthead nav on every page: הסקירה האחרונה | דורש פעולה | ארכיון | מילון מושגים | מאגר מקורות | סטטיסטיקות | (theme toggle) | יציאה. The «מאגר מקורות» and «סטטיסטיקות» links carry
  `data-admin`; the worker strips them (HTMLRewriter) for the reader role, so only admins see them. Covered by the same `_headers` (`/*`),
  robots.txt and `noindex,nofollow` meta. Static files only – fits the Cloudflare Pages free plan.


## Full data export – `/admin/export.json` (2026-11-18)
- Every build that has briefs writes `dist/admin/export.json` (`build_export` in build.py):
  `{"format":"cto-review-export","format_version":1,"generated_at":ISO+offset,"latest":date,"counts":{briefs,glossary,sources},
  "briefs":[all briefs, oldest first, the same objects as /YYYY-MM-DD/brief.json],"glossary":{= /glossary.json},"sources":{= /admin/sources.json}}`.
- Link «ייצוא מלא (JSON)» on the /admin/ meta row, `download="cto-review-export-<latest brief date>.json"`. Under `/admin/`, so the worker
  allows only the admin role (readers get 403 JSON; anonymous -> 303 to /login?next=…&need=admin). No worker change was needed.
- Build-time asserts (build fails): glossary and sources parts must pass the full `FORBIDDEN` list; briefs (news text) must pass the identity
  subset `EXPORT_FORBIDDEN_ID` (private account / inbox identifiers and internal wording); the whole file must contain no
  email address and no secret / login-log pattern (`EXPORT_SECRETS`), and not the values of the box password env vars (never printed).
- The offline replica imports it with `assets/import.js` from the replica kit (SPEC section 9). The kit sample `cto-review-export-2026-11-18.json`
  is derived from this file after the full FORBIDDEN check (the 2026-11-12 brief is left out of the sample because its news text names a
  third-party product that matches the full list).

## Daily full update – `/admin/update.json` (2026-11-18)
- Every live build also writes `dist/admin/update.json` (`build_update`): `{"format":"cto-review-update","format_version":1,
  "generated_at","date":latest,"counts","brief":{latest brief, = /YYYY-MM-DD/brief.json},"glossary":{= /glossary.json},
  "sources":{= /admin/sources.json}}` (~0.7 MB). Same cleaning and the same build-time asserts as the full export (`export_checked`).
- Link «עדכון יומי מלא (JSON)» on the /admin/ meta row, `download="cto-review-update-<date>.json"`, between «הורדת JSON» and
  «ייצוא מלא (JSON)». Admin only (under /admin/); covered by `deploy/export_test.py` (anonymous 401, reader 403 on 4 path variants,
  admin 200 + format + latest date, no identity strings, no password values, link present for admin only).

## Replica build – `python build.py --replica` (2026-11-18)
Offline copy of the site that can be **updated every day from a file**, without a rebuild and without Internet.
```
python build.py --replica                # -> dist/   (or: --out DIR, --content DIR; env CTO_REPLICA=1 = same)
cd dist && python -m http.server 8000    # open http://localhost:8000/  (file:///…/dist/index.html also works, see limits)
```
- No login (no /login, no worker, no login.js/stats.js, no «יציאה»). Nav: הסקירה האחרונה | דורש פעולה | ארכיון | מילון מושגים |
  מאגר מקורות | **טעינת עדכון** (`/admin/import/`). Admin views are open (it is a private offline copy).
- `/admin/import/`: file picker (multi-file), drag & drop, auto-detects: daily brief `tech-brief-YYYY-MM-DD.json`, daily full update
  `cto-review-update-YYYY-MM-DD.json`, full export `cto-review-export-YYYY-MM-DD.json`, `glossary.json`, `sources.json`.
  Unknown/invalid files are rejected with a reason. Summary after every load; «ייצוא הארכיון המקומי» (merged export);
  «איפוס הנתונים המקומיים» (confirm dialog) returns the site to its built-in content.
- Storage: IndexedDB `cto-review` in the browser (per browser + per origin; `file://` and `http://localhost:8000` are separate).
- Merge (`replica/assets/import.js`): built-in content counts as existing. Identical content -> «באותו נוסח», nothing asked. A daily brief
  or the update's brief for an existing date with different content -> confirm dialog (replace / keep). Full export: newer
  `generated_at` wins. Glossary merges by key. Sources registry: replaced as a whole when newer (asked when loaded alone).
- Rendering (`replica/assets/replica.js`): JS port of the build.py renderers and of `glossary_lib.Matcher` (same margin notes).
  Home shows the newest brief (built-in or loaded); a loaded day opens at `/day/?d=YYYY-MM-DD` with the same HTML/CSS; archive (+search),
  «דורש פעולה», glossary («מה חדש» = newest brief) and the sources mirror merge the data; prev/next links join static and loaded days.
  Then app.js/admin.js are loaded so all behaviours bind. `replica/tests/parity.test.js` checks byte-equal `<main>` output vs
  build.py for every built-in page (28/28) plus XSS cases; `replica/tests/import.test.js` covers the merge rules.
- Data embedded as scripts (`assets/replica-data.js`, `assets/replica-sources.js`) and the font embedded in `style.css` as data: URL,
  so `file://` works. No network calls besides the local files and the same-origin `data/updates/` folder (below); no CDN.
- Security: every value is HTML-escaped; links only http(s) (others dropped); files are parsed as JSON only, never executed.
- Limits: data lives in one browser profile (clearing site data removes it; reload the latest export); on `file://` the «שיתוף» URL
  points to the live-site path (not usable offline) and Chrome may treat every file:// page as one origin; loaded days have no
  per-day `brief.json`/PDF files (the «הורדת JSON» on a loaded day downloads the stored brief); delete = full reset only.

### Shared server updates folder – `data/updates/` (2026-11-19)
Imports on «טעינת עדכון» live only in the browser that loaded them. To publish an update to **every visitor** of a hosted
replica (e.g. Windows IIS), put the file in the site's `data/updates/` folder with the helper script. No rebuild.
- `data/updates/manifest.json` is the index (IIS does not list folders): `{"format":"cto-review-updates-manifest","format_version":1,
  "files":["cto-review-update-2026-11-19.json", …],"entries":[{name,kind,date,generated_at,size,sha256}],"generated_at":…}`.
  Written only by `tools/add-update.ps1` (Windows PowerShell 5.1, no modules) or `tools/add_update.py` (Python 3, stdlib); both
  validate the file (update / export / brief / glossary / sources, http(s) links only), copy it atomically, and rebuild the manifest
  from every valid `*.json` in the folder, sorted by date. `-Remove <name>` / `--remove <name>` unpublishes; `-Rebuild` / `--rebuild`
  only rewrites the manifest. `-SiteRoot` defaults to the folder above the script (the build copies both scripts to `dist/tools/`).
- Runtime (`CTOImport.loadServer`, replica pages only, http(s) only): on every page load fetches the manifest with `cache:"no-store"`
  + `?t=<now>`, then each listed file (`no-store`, `?v=<signature>`), and runs the same `detect`/`validate` as a manual import
  (a file with a non-http(s) link is rejected; values are escaped at render time). Parsed files are cached in IndexedDB (`meta`
  store, key `srv:<name>`, signature = size|sha256|generated_at from the manifest, else the ETag): a repeat visit downloads only
  the manifest; a republished file (new sha256) is downloaded again; cache entries of files no longer listed are deleted.
  Server data is never written into the local import store, so removing a file from the manifest removes it for everyone.
- Precedence per day: built-in < server / this-browser import. Between server and local the newer `generated_at` wins; on a tie the
  server copy wins. Glossaries: built-in, then every file glossary from oldest to newest merged by key (newer wins a key; a local
  «החלפת המילון» does not hide server terms). Sources registry: taken whole from the newest file (server wins a tie).
- Silent failure: no manifest (404), a broken manifest, a timeout (8 s) or `file://` -> the site shows built-in + local data, no errors.
  The import page's «מצב הנתונים המקומיים» shows the server folder state, its days and any rejected file.
- The build never ships a `manifest.json` (only `data/updates/README.txt`), so copying a new build over the site keeps published
  updates; `build.py --replica` also preserves an existing `dist/data/updates/`.
- `dist/web.config` (replica build only; template `replica/iis/web.config`, must match `build.py` WEB_CONFIG): default document
  `index.html`; `.json` MIME `application/json` (`<remove>` + `<mimeMap>`, so IIS 10, which already has it, does not fail);
  `Cache-Control: no-cache, no-store, must-revalidate` + `Pragma`/`Expires` for `data/updates`. Other servers ignore it.
- Tests: `node replica/tests/server.test.js` (manifest, validation, cache, pruning, silent failures; env `CTO_DIST` = a live dist);
  browser QA `/workspace/cto-review-qa/tools/replica_shared_qa.js` (fresh profiles, cache, change, precedence, removal, 404, file://).

#### IIS hosting
1. Build: `python build.py --replica`, copy the contents of `dist\` to the site folder, e.g. `C:\inetpub\wwwroot\cto-review`
   (keep the existing `data\updates` folder when you copy a newer build).
2. IIS Manager -> Sites -> Add Website (or an application) pointing at that folder. Static Content must be installed
   (Windows feature «Static Content»); `web.config` sets the default document, the `.json` MIME type and no-cache for updates.
3. Daily: on the live site as admin, `/admin/` -> «עדכון יומי מלא (JSON)» downloads `cto-review-update-YYYY-MM-DD.json`. On the server:
   ```
   powershell -ExecutionPolicy Bypass -File C:\inetpub\wwwroot\cto-review\tools\add-update.ps1 -File C:\Downloads\cto-review-update-YYYY-MM-DD.json -SiteRoot C:\inetpub\wwwroot\cto-review
   ```
   Every user sees the new day on the next page load. First time (or to backfill missing days): publish a full export
   `cto-review-export-YYYY-MM-DD.json` the same way.

## Anchors, sharing and floating controls (2026-11-17)
- Anchors (build.py `item_anchors`, deterministic): item -> `item-` + JSON `id` (chars outside `[A-Za-z0-9_-]` -> `-`, max 80);
  no id -> `item-n<order>` (1-based position in `items`); duplicates -> `-2`, `-3`. Watchlist rows -> `watch-<N>`.
  Sections: `#mgmt`, `#sec-<i>` (order of first appearance), `#watchlist`. Same anchors on `/` and `/YYYY-MM-DD/`;
  used by `/actions/` and `search.json` (`a` field). `--add` produces them automatically – no routine change needed.
- «שיתוף» button per item / watchlist row (`.share-btn`, data-share-url `/{date}/#{anchor}`, title, plain summary ≤280 chars).
  Text = title \n summary \n absolute URL. Touch devices with `navigator.share` -> Web Share; else clipboard -> toast
  «הועתק – כותרת, תקציר וקישור» (`#toast`, aria-live polite) -> execCommand fallback -> manual-copy `<dialog>`.
- `:target` highlight + `scroll-margin-top`. Back-to-top `.to-top` (all pages) and «פרקים» `.jump-btn` + `#jump-menu`
  (native popover, fallback in app.js) appear when `.masthead` leaves view (IntersectionObserver -> `html.is-scrolled`).
  Reading-progress bar `.read-progress` (CSS `animation-timeline: scroll()`, JS fallback). All hidden in print. CSP unchanged.
- `assets/login.js` (public, login page only) appends a shared link's `#anchor` to the hidden `next`, so a reader who
  must log in first still lands on the item.

## Glossary – margin notes and «מילון מושגים» (2026-11-18)
- Data: `glossary.json` (UTF-8): `{version, updated, language, note, entries: [{key, term, aliases, category, definition_he, url?}]}`.
  `category` = company | product | concept | standard | org. `definition_he`: 1–2 plain Hebrew sentences (what it is,
  what it serves), starting with a Hebrew word; English names stay in English («ב-Google»). Do not invent: leave out
  entities you are not sure about. Skip ultra-common names (Google, Microsoft, Apple, Amazon...) and people.
  Override the path with `CTO_GLOSSARY=/path/glossary.json`. The build fails on a missing field, duplicate key,
  unknown category or an alias used by two entries.
- Matching (`glossary_lib.py`, shared by build.py and glossary_suggest.py): whole-word aliases, longest first;
  Latin aliases case-sensitive except all-lowercase `concept` aliases; Hebrew prefix + hyphen (ב-, ל-, ה-, ו-, מ-, ש-, כ-,
  וה-) allowed before a Latin alias and left outside the mark; no match when glued to Latin letters/digits or followed by
  `-x` / `.x` (Claude-BugHunter, GPT-6, Next.js); Hebrew aliases may carry up to two glued one-letter prefixes.
- Applied automatically on every build (`python3 build.py` and `python3 build.py --add …`), to every day: in each item the
  FIRST occurrence of each entry in headline → summary → why_it_matters → action becomes
  `<button class="term" popovertarget interestfor aria-expanded>` + `<span class="gl-note" popover="hint" role="tooltip">`
  (definition in the page, no fetch). Not in links, source labels, tags, the flames tooltip, exec summary, watchlist,
  /actions/ or the archive. A `span.gl-nb` (nowrap) and LRM/RLM marks keep bidi order and line breaks as in plain text.
- Behaviour (assets/app.js + style.css, CSP unchanged): desktop (>900px) note in the left margin column (the archive
  sidebar column in RTL) level with the term, on hover / keyboard focus / click; ≤900px tap opens a card 6px under the
  term; Esc / tap outside closes; one note at a time; `aria-expanded` synced from `toggle`. CSS anchor positioning
  (`main{anchor-name:--gl-main}`, per-pair `--gl-N` set via CSSOM) with JS coordinates as fallback; `interestfor`
  with a hover/focus fallback; `hint`→`auto` fallback; `.open` class fallback without the Popover API.
  Dark mode, forced-colors and prefers-reduced-motion handled. Print: notes hidden, underline removed.
- Outputs: `dist/glossary.json` (same format; behind the login, `*.json` → 401 without a session), and every
  `/YYYY-MM-DD/brief.json` item gets an optional `"glossary": [keys]` (only when it has matches). Download name stays
  `tech-brief-YYYY-MM-DD.json`; content/*.json is not modified.
- Page `/glossary/` («מילון מושגים», nav link after «ארכיון», visible to readers, no `data-admin`): the entries that appear in
  the briefs, grouped by category and sorted A–Z, «מופיעים בעדכון האחרון» chips, search (`#gq`, also `#q=` in the hash),
  category buttons, «רק מושגים מהעדכון האחרון» checkbox, per entry: term, definition, «לאתר הרשמי ↗» (if `url`), links to the
  items where it appears (newest first, 5 shown + «ועוד N ידיעות»). Print-friendly. The build refuses forbidden wording
  in the glossary outputs (same `FORBIDDEN` check as the admin mirror).
- Daily routine: after `build.py --add`, run
  `python3 /workspace/cto-review/glossary_suggest.py /workspace/briefs/tech-brief-YYYY-MM-DD.json` (add `--json` for
  machine output). It lists the brief's entities and Latin terms that no glossary alias matches yet. Add short Hebrew
  definitions for the ones a manager may not know (new vendors, products, attack names, concepts) to `glossary.json`,
  then rebuild (`python3 build.py`) before deploying. Model version names, people and common names can be skipped.

## Emerging technologies – heat scale
Items in «טכנולוגיות מתפרצות» may carry a `heat` field (`1` | `2` | `3`; `null` or omitted on every other item) and a `momentum` field with the verified signals used to rank them. The score is relative to that day's candidates:
- `3` = לוהט – top of daily GitHub trending, or a viral post with broad engagement, plus corroborating signals.
- `2` = חם – top-10 trending / strong engagement.
- `1` = עולה – early but clearly growing.

Public pages render only a flame marker next to the tag pill (`🔥` / `🔥🔥` / `🔥🔥🔥`), with `aria-label` «רמת תאוצה: עולה/חם/לוהט». The `momentum` text is not shown as a body line («סימני תאוצה»); it appears in a small tooltip on hover, keyboard focus, or tap (logic in `assets/app.js`, styles in `assets/style.css`, no inline script, CSP unchanged). Print/PDF shows the flames only. The same `momentum` (and `last_momentum_check`) may be stored on the matching source in the registry for behind-the-scenes ranking; the admin mirror may display those fields, public brief pages do not.

## Daily update
    python3 /workspace/cto-review/build.py --add /workspace/briefs/tech-brief-YYYY-MM-DD.json
Rejects files that are not "2-layered". Each build regenerates every page, including `/actions/`, `/archive/`,
`search.json`, `index.json` and the admin mirror. The daily (and weekly) publish then deploys `dist/` with the
Direct Upload / wrangler flow below.

## Login (shared password, two roles) – replaces Cloudflare Access since 2026-11-17
Pages advanced mode: `worker/_worker.js` is copied by build.py to `dist/_worker.js` on every build. It is the ONLY
access control on `cto-review.pages.dev` (Cloudflare Access now covers only `*.cto-review.pages.dev`, i.e. preview and
per-deployment URLs). Free plan only (Pages Functions + Workers KV free tier).
- Users: `cto` = reader (whole site except `/admin/*`); `admin` = everything incl. `/admin/`, `/admin/stats/` and
  `/admin/stats/data.json`. A reader on `/admin/*` gets the login page with status 403 («האזור הזה מיועד למנהלים»).
- Project secrets (production + preview, type secret_text): `SHARED_PASSWORD`, `ADMIN_PASSWORD` – stored as
  `sha256$<salt>$<hex>` (hex = SHA-256(salt + ":" + password); plain text also accepted), and `SESSION_SECRET`
  (random). Source of the passwords: box env vars `CTO_REVIEW_SHARED_PASSWORD` / `CTO_REVIEW_ADMIN_PASSWORD`.
  Never print them. Changing a password secret ends that role's sessions. Missing secret/binding → 503 (fail closed).
- KV binding `LOGINS` → namespace `cto-review-logins` (id c9e924ec657943549f72b2e6795c9305).
- `/login` (GET form, POST check; Hebrew RTL, site CSS; only script is `assets/login.js`, which keeps a shared link's `#anchor`), `/logout` (clears cookie → `/login?out=1`).
  Unauthenticated: HTML → 303 to `/login?next=…`; `*.json` → 401. Public without login: `/login`, `/logout`,
  `/assets/style.css`, `/assets/theme.js`, `/assets/favicon.svg`, `/assets/fonts/heebo-var.woff2`, `/robots.txt`.
- Cookie `ctor_s` = base64url({r: role, e: expiry}) + "." + HMAC-SHA256; HttpOnly; Secure; SameSite=Lax; 7 days.
  POST /login rejects a foreign `Origin`. Password check is constant-time over digests.
- Rate limit: 10 failed logins per IP per 15-minute window → 429 (+ Retry-After). Counter in KV (`rl:<iphash>:<window>`,
  TTL 30 min) plus an in-memory per-isolate counter (KV reads are edge-cached ~60 s); 0.8 s delay on every failure.
- Stats: every login success/failure writes one KV key `ev:<iso>:<rand>` (TTL 400 days), data in key metadata:
  t (UTC ISO), o (success|fail), r (reader|admin|""), c (country), ci (city), browser, os, device, v (salted SHA-256 of
  the IP, 16 hex – approximate unique visitors; raw IPs are never stored). Page views write nothing
  (KV free tier: 1000 writes/day ≈ 500 failed logins/day; on quota exhaustion logging stops, the site keeps working).
- `/admin/stats/` – static page (build_stats in build.py) + `assets/stats.js`, which reads `data.json` (the worker lists
  KV `ev:` keys). Shows 30-day per-day table, success/fail, approx unique visitors, countries, browsers, OS, devices,
  roles, latest 50 events. Linked from the admin page header.
- Security headers/CSP are set by the worker on every response (same values as `_headers`); CSP unchanged.
- Tests: `bash -lc 'python3 /workspace/cto-deploy/auth_test.py https://cto-review.pages.dev'` (36 checks; reads the two
  password env vars, prints nothing secret; writes a few test events – browser/os "Other").
- Admin-bypass regression test: `bash -lc 'python3 /workspace/cto-deploy/admin_bypass_test.py'` (reader login; 10 path variants such as
  `//admin/`, `/%61dmin/`, `/admin%2F` must not serve the admin area; exit 0 = pass). The worker canonicalizes the path
  (percent-decode, collapse slashes, lower-case) before the admin check (fix of 17 Nov 2026).
- Private login archive: `/workspace/cto-access-logs/kv_pull.js` + `merge_kv.py` (see that folder's README).

## Deploy (Cloudflare Pages project `cto-review`)
Every deploy MUST include the login worker, or the production site would be open. Daily/weekly flow:
1. `python3 /workspace/cto-review/build.py [--add …]` (writes `dist/`, incl. `dist/_worker.js`)
2. `python3 /workspace/cto-deploy/prep.py` (production; `--branch <name>` for a preview). Refuses if `dist/_worker.js`
   is missing. Writes `manifest.json`, `items.json` and `deploy-latest.js`.
3. Cloudflare MCP `execute`: GET `/accounts/{acct}/pages/projects/cto-review/upload-token`, return `result.jwt`, with
   write_to_file → then `CTO_UPLOAD_TOKEN_FILE=<that file> python3 /workspace/cto-deploy/upload_missing.py`
   (never prints the token, shreds the file). Run it right away – the JWT expires within minutes.
4. Cloudflare MCP `execute` with code `"$file:/workspace/cto-deploy/deploy-latest.js"` – creates the deployment with
   manifest + `_headers` + `_worker.bundle` (multipart module bundle, main module `_worker.js`). Check the result:
   `uses_functions` true / stage success, then `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://cto-review.pages.dev/`
   must give `303 …/login?next=%2F`.
Do NOT hand-write a deployment without `_worker.bundle` (the older deploy*.js / step*.js / up.py files lack it; they were moved to
`/workspace/cto-deploy/legacy-DO-NOT-USE/` by the 17 Nov audit). `auth_test.py` needs the two password env vars; run it with
`bash -lc` as shown above so they are loaded.
Bindings and secrets live in the project's deployment_configs (production + preview), not in the upload.
