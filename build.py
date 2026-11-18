#!/usr/bin/env python3
"""CTO Review – static site generator.

Usage:
  python3 build.py                       # rebuild dist/ from content/*.json
  python3 build.py --add BRIEF.json      # import a layered brief (sanitized) into content/, then rebuild
  python3 build.py --add BRIEF.json --title "..."   # optional title override for the imported day
  python3 build.py --replica             # offline replica build: no login, «טעינת עדכון» page, client-side merge
                                         # of imported JSON files (IndexedDB). Serve dist/ with python -m http.server.
  Options: --out DIR (output folder, default dist/), --content DIR (brief folder, default content/).

Only briefs with format_version "2-layered" are accepted.
Every build also regenerates the admin area (dist/admin/) from the sources registry
(/workspace/cto-sources/sources.json, override with CTO_SOURCES env var), sanitized.

Emerging-tech heat scale (item field "heat"; null/absent on non-emerging items).
The score is relative to that day's candidates, not an absolute industry rank:
  3 = לוהט – top of daily GitHub trending, or a viral post with broad engagement,
      plus corroborating signals.
  2 = חם  – top-10 trending / strong engagement.
  1 = עולה – early but clearly growing.
Public pages show only the flame marker next to the tag pill (🔥 / 🔥🔥 / 🔥🔥🔥).
The verified "momentum" text stays in the content JSON and is revealed in a
hover/focus/tap tooltip; it is never printed as a «סימני תאוצה» body line.
"""
import base64
import argparse, datetime as dt, html, json, os, re, shutil, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import glossary_lib  # noqa: E402  (glossary.json matcher, shared with glossary_suggest.py)

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
DIST = ROOT / "dist"
# Offline replica mode (python3 build.py --replica): no login worker, no stats, no logout; adds the
# «טעינת עדכון» admin page (/admin/import/), the client day view (/day/?d=YYYY-MM-DD) and the client runtime
# (assets/replica.js + assets/import.js) that merges imported JSON files from IndexedDB. Relative links get an
# explicit index.html so the folder also works from file://. The live build is unchanged when this is False.
REPLICA = False
SITE_NAME = "CTO Review"
TAGLINE = "סקירת טכנולוגיה יומית"

HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט",
             "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
HE_DAYS = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"]  # date.weekday()
TAGS = {
    "action": ("דורש פעולה", "tag-action"),
    "watch": ("למעקב", "tag-watch"),
    "background": ("רקע", "tag-bg"),
}
# heat: 1=עולה, 2=חם, 3=לוהט (see module docstring for the scale).
HEAT = {
    1: ("עולה", "🔥"),
    2: ("חם", "🔥🔥"),
    3: ("לוהט", "🔥🔥🔥"),
}
# Fields that must never be published (internal production notes).
STRIP_TOP = {"notes"}
STRIP_ITEM = set()


def esc(s):
    return html.escape(str(s or ""), quote=True)


# ---------------------------------------------------------------------------
# Glossary margin notes (see README "Glossary"). glossary.json is applied on every build,
# so `build.py --add` marks new briefs automatically. Override the file with CTO_GLOSSARY.
# ---------------------------------------------------------------------------
GLOSSARY_FILE = Path(os.environ.get("CTO_GLOSSARY", str(ROOT / "glossary.json")))
GLOSSARY = glossary_lib.load(GLOSSARY_FILE) if GLOSSARY_FILE.exists() else {"entries": []}
GL = glossary_lib.Matcher(GLOSSARY["entries"])


class GlossCtx:
    """Per-item state: first occurrence of each entry is marked once across headline/summary/why/action."""
    def __init__(self, anchor):
        self.anchor, self.used, self.n = anchor, [], 0


def gl_html(text, ctx):
    """Escape text and wrap the first occurrence of each glossary entry (per item) in a toggletip."""
    text = str(text or "")
    if ctx is None:
        return esc(text)
    out, pos = [], 0
    for s, e, ent in GL.find(text):
        if ent["key"] in ctx.used or s < pos:
            continue
        ctx.used.append(ent["key"])
        ctx.n += 1
        nid = f"gl-{ctx.anchor}-{ctx.n}"
        # Keep a Hebrew prefix / opening bracket and closing punctuation on the same line as the term
        # (the button is an atomic inline, so the browser would otherwise allow a break next to it).
        lead = re.search(r"[^\s]{0,4}$", text[pos:s]).group()
        tail = re.match(r"[)\]}.,;:!?\"'»״׳…%]*", text[e:]).group()
        # The button is a neutral object for the bidi algorithm; a strong mark of the term's own direction on
        # both sides keeps the surrounding punctuation ordered as in the plain text, e.g. «ב-Java (Java4Shell)».
        mark = "\u200f" if re.match(r"[\u0590-\u05FF]", text[s]) else "\u200e"
        out.append(esc(text[pos:s - len(lead)]))
        out.append(f'<span class="gl-nb">{esc(lead)}{mark}'
                   f'<button type="button" class="term" data-gl="{esc(ent["key"])}" popovertarget="{nid}" '
                   f'popovertargetaction="show" interestfor="{nid}" aria-expanded="false">{esc(text[s:e])}</button>'
                   f'<span class="gl-note" id="{nid}" popover="hint" role="tooltip">'
                   f'<b class="gl-t" dir="auto">{esc(ent["term"])}</b> '
                   f'<span class="gl-d">{esc(ent["definition_he"])}</span></span>{mark}{esc(tail)}</span>')
        pos = e + len(tail)
    out.append(esc(text[pos:]))
    return "".join(out)


def he_date(d, with_day=True):
    x = dt.date.fromisoformat(d)
    s = f"{x.day} ב{HE_MONTHS[x.month - 1]} {x.year}"
    return f"יום {HE_DAYS[x.weekday()]}, {s}" if with_day else s


def sanitize(brief, title=None):
    b = {k: v for k, v in brief.items() if k not in STRIP_TOP}
    b["items"] = [{k: v for k, v in it.items() if k not in STRIP_ITEM} for it in b.get("items", [])]
    if title:
        b["title"] = title
    else:
        b["title"] = f"{TAGLINE} – {he_date(b['date'], with_day=False)}"
    return b


def load_briefs():
    out = []
    for f in sorted(CONTENT.glob("*.json")):
        b = json.load(open(f, encoding="utf-8"))
        if b.get("format_version") != "2-layered":
            print(f"skip {f.name}: not layered", file=sys.stderr)
            continue
        out.append(b)
    out.sort(key=lambda b: b["date"], reverse=True)
    return out


def counts(b):
    c = {"action": 0, "watch": 0, "background": 0}
    for it in b["items"]:
        c[it.get("tag", "background")] = c.get(it.get("tag", "background"), 0) + 1
    return c


def pill(tag):
    he, cls = TAGS.get(tag, TAGS["background"])
    return f'<span class="pill {cls}">{he}</span>'


def heat_badge(it):
    """Flame marker next to the tag pill. Momentum text lives in a tooltip only."""
    try:
        level = int(it["heat"]) if it.get("heat") is not None else 0
    except (TypeError, ValueError):
        return ""
    if level not in HEAT:
        return ""
    word, flames = HEAT[level]
    tip_id = f'heat-tip-{esc(it.get("id", ""))}'
    momentum = it.get("momentum") or ""
    tip_inner = f'<strong class="heat-lvl">{esc(word)}</strong>'
    if momentum:
        tip_inner += f" {esc(momentum)}"
    return (
        f'<span class="heat" data-heat="{level}">'
        f'<button type="button" class="heat-btn" aria-label="רמת תאוצה: {esc(word)}" '
        f'aria-describedby="{tip_id}" aria-expanded="false">'
        f'<span class="heat-flames" aria-hidden="true">{flames}</span></button>'
        f'<span id="{tip_id}" class="heat-tip" role="tooltip"><span class="heat-tip-body">{tip_inner}</span></span>'
        f"</span> "
    )


# ---------------------------------------------------------------------------
# Stable per-item anchors + share buttons (see README "Anchors and sharing").
# Rule: item anchor = "item-" + the item's JSON "id" (characters outside [A-Za-z0-9_-] -> "-", max 80);
# items without an id get "item-n<order>" (1-based position in the brief's items array);
# a repeated anchor in the same brief gets "-2", "-3"... Watchlist («שווה מעקב») entries get "watch-<order>".
# Depends only on the content JSON, so it is identical on every rebuild and on / and /YYYY-MM-DD/.
# ---------------------------------------------------------------------------
SHARE_MAX = 280
SHARE_ICON = ('<svg class="share-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" '
              'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
              '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>'
              '<path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>')


def item_anchors(b):
    """{position in b["items"]: anchor id} – deterministic, see rule above."""
    out, seen = {}, set()
    for n, it in enumerate(b.get("items", []), 1):
        raw = it.get("id")
        slug = re.sub(r"[^A-Za-z0-9_-]+", "-", str(raw)).strip("-")[:80] if raw not in (None, "") else ""
        base = f"item-{slug}" if slug else f"item-n{n}"
        a, k = base, 2
        while a in seen:
            a, k = f"{base}-{k}", k + 1
        seen.add(a)
        out[n - 1] = a
    return out


def anchor_of(b, it):
    return item_anchors(b)[next(i for i, x in enumerate(b["items"]) if x is it)]


def short_text(s, limit=SHARE_MAX):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    if len(s) <= limit:
        return s
    cut = s[:limit].rsplit(" ", 1)[0].rstrip(" ,;:–-")
    return cut + "…"


def share_btn(url, title, text, describedby=""):
    db = f' aria-describedby="{esc(describedby)}"' if describedby else ""
    return (f'<button type="button" class="share-btn" data-share data-share-url="{esc(url)}" '
            f'data-share-title="{esc(title)}" data-share-text="{esc(text)}"{db}>{SHARE_ICON}<span>שיתוף</span></button>')


def render_item(it, anchor=None, date=""):
    anchor = anchor or f'item-{it.get("id", "")}'
    srcs = " · ".join(
        f'<a href="{esc(s["url"])}" target="_blank" rel="noopener noreferrer">{esc(s.get("label") or s["url"])}</a>'
        for s in it.get("sources", []) if s.get("url"))
    hid = f"h-{anchor}"
    share = share_btn(f"/{date}/#{anchor}", it.get("headline") or "", short_text(it.get("summary")), hid) if date else ""
    g = GlossCtx(anchor)
    parts = [f'<article class="item" data-tag="{esc(it.get("tag","background"))}" id="{esc(anchor)}">',
             f'<div class="item-head"><h3>{pill(it.get("tag"))} {heat_badge(it)}<span class="headline" id="{esc(hid)}">{gl_html(it["headline"], g)}</span></h3>{share}</div>',
             f'<p class="summary">{gl_html(it.get("summary"), g)}</p>']
    if it.get("why_it_matters"):
        parts.append(f'<p class="why"><strong>למה זה חשוב לנו:</strong> {gl_html(it["why_it_matters"], g)}</p>')
    if it.get("action"):
        parts.append(f'<p class="todo"><strong>מה כדאי לעשות:</strong> {gl_html(it["action"], g)}</p>')
    if srcs:
        parts.append(f'<p class="sources"><strong>מקורות:</strong> {srcs}</p>')
    parts.append("</article>")
    return "\n".join(parts)


def day_nav(rel, older=None, newer=None):
    """Prev/next links between adjacent briefs. In RTL, "newer" sits on the right (start), "older" on the left."""
    def link(x, cls, arrow_txt):
        if not x:
            return f'<span class="dn {cls} off" aria-disabled="true">{arrow_txt}</span>'
        return (f'<a class="dn {cls}" href="{rel}{x["date"]}/" rel="{"prev" if cls == "older" else "next"}">'
                f'{arrow_txt}<span class="dd">{he_date(x["date"], with_day=False)}</span></a>')
    return ('<nav class="daynav" aria-label="ניווט בין סקירות">'
            + link(newer, "newer", "→ הסקירה הבאה (חדשה יותר)")
            + link(older, "older", "הסקירה הקודמת (ישנה יותר) ←")
            + "</nav>")


def render_brief(b, rel, older=None, newer=None):
    sections, order = {}, []
    anchors = item_anchors(b)
    for n, it in enumerate(b["items"]):
        s = it.get("section", "כללי")
        if s not in sections:
            sections[s] = []
            order.append(s)
        sections[s].append((anchors[n], it))
    c = counts(b)
    out = [f'<header class="brief-head"><p class="kicker">{he_date(b["date"])}</p>',
           f'<h1>{esc(b["title"])}</h1>',
           '<p class="stats">'
           f'{pill("action")} {c["action"]} &nbsp; {pill("watch")} {c["watch"]} &nbsp; {pill("background")} {c["background"]}'
           f' &nbsp;·&nbsp; <a class="dl" href="{rel}{b["date"]}/brief.json" download="tech-brief-{b["date"]}.json">הורדת JSON</a>'
           ' &nbsp;·&nbsp; <button type="button" class="print-btn" data-print>הדפסה</button>'
           f' &nbsp;·&nbsp; <button type="button" class="print-btn" data-save-pdf data-date="{esc(b["date"])}">שמירה כ-PDF</button></p>'
           + day_nav(rel, older, newer) + '</header>']
    if b.get("exec_summary"):
        out.append('<section class="mgmt" id="mgmt"><h2>להנהלה – בשורה התחתונה</h2>')
        out += [f"<p>{esc(p)}</p>" for p in b["exec_summary"]]
        out.append("</section>")
    out.append('<nav class="toc" aria-label="ניווט בסקירה">'
               + "".join(f'<a href="#sec-{i}">{esc(s)}</a>' for i, s in enumerate(order))
               + '</nav><div class="filters" role="group" aria-label="סינון לפי תגית">'
               '<button class="on" data-f="all">הכל</button><button data-f="action">דורש פעולה</button>'
               '<button data-f="watch">למעקב</button><button data-f="background">רקע</button></div>')
    for i, s in enumerate(order):
        out.append(f'<section class="topic" id="sec-{i}"><h2>{esc(s)}</h2>')
        out += [render_item(it, a, b["date"]) for a, it in sections[s]]
        out.append("</section>")
    if b.get("watchlist"):
        out.append('<section class="watchlist" id="watchlist"><h2>שווה מעקב</h2><ul>')
        for n, w in enumerate(b["watchlist"], 1):
            link = f' <a href="{esc(w["url"])}" target="_blank" rel="noopener noreferrer">למקור</a>' if w.get("url") else ""
            wid = f"watch-{n}"
            share = share_btn(f'/{b["date"]}/#{wid}', f'שווה מעקב · {he_date(b["date"], with_day=False)}',
                              short_text(w.get("text")), f"{wid}-t")
            out.append(f'<li id="{wid}"><span id="{wid}-t">{esc(w["text"])}</span>{link} {share}</li>')
        out.append("</ul></section>")
    out.append(day_nav(rel, older, newer).replace('class="daynav"', 'class="daynav bottom"', 1))
    # Floating jump-to-section menu (native Popover API; app.js adds a fallback) + reading-progress bar.
    # Section anchors: #mgmt, #sec-<i> (i = order of first appearance of the section in items, 0-based), #watchlist.
    jumps = ([("mgmt", "להנהלה – בשורה התחתונה")] if b.get("exec_summary") else []) \
        + [(f"sec-{i}", s) for i, s in enumerate(order)] + ([("watchlist", "שווה מעקב")] if b.get("watchlist") else [])
    out.append('<div class="read-progress" aria-hidden="true"></div>'
               '<button type="button" class="jump-btn" data-jump-btn popovertarget="jump-menu" title="קפיצה לפרק בסקירה">'
               '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" '
               'stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span>פרקים</span></button>'
               '<nav id="jump-menu" class="jump-menu" popover aria-label="פרקים בסקירה"><p class="jump-h">קפיצה לפרק</p><ul>'
               + "".join(f'<li><a href="#{a}">{esc(t)}</a></li>' for a, t in jumps)
               + '</ul></nav>')
    return "\n".join(out)


def he_month(d):
    x = dt.date.fromisoformat(d)
    return f"{HE_MONTHS[x.month - 1]} {x.year}"


def archive_row(b, rel, current=None):
    c = counts(b)
    cur = ' aria-current="page" class="cur"' if b["date"] == current else ""
    return (f'<li{cur} data-date="{esc(b["date"])}"><a href="{rel}{b["date"]}/"><span class="d">{he_date(b["date"])}</span>'
            f'<span class="n">{len(b["items"])} ידיעות · {c["action"]} דורשות פעולה</span></a></li>')


def archive_list(briefs, rel, current=None):
    return '<ul class="archive">' + "".join(archive_row(b, rel, current) for b in briefs) + "</ul>"


def archive_grouped(briefs, rel):
    groups, order = {}, []
    for b in briefs:
        m = b["date"][:7]
        if m not in groups:
            groups[m] = []
            order.append(m)
        groups[m].append(b)
    out = []
    for m in order:
        n = len(groups[m])
        out.append(f'<section class="agroup" data-month="{m}"><h2>{he_month(m + "-01")}'
                   f' <span class="gc">({n} {"סקירות" if n != 1 else "סקירה"})</span></h2>'
                   f'<ul class="archive">' + "".join(archive_row(b, rel) for b in groups[m]) + "</ul></section>")
    return "".join(out)


def action_items(briefs):
    """All items tagged "action" across the archive, newest brief first, in brief order."""
    out = []
    for b in briefs:
        rows = [it for it in b["items"] if it.get("tag") == "action"]
        if rows:
            out.append((b, rows))
    return out


def render_actions(briefs, rel):
    groups = action_items(briefs)
    total = sum(len(r) for _, r in groups)
    head = ('<header class="brief-head"><p class="kicker">מעקב רוחבי מכל הסקירות</p><h1>דורש פעולה</h1>'
            f'<p class="stats">{pill("action")} {total} פריטים פתוחים מתוך {len(groups)} '
            f'{"סקירות" if len(groups) != 1 else "סקירה"} · מהחדש לישן. '
            'זו תצוגה מצטברת של כל הידיעות שתויגו «דורש פעולה» בארכיון, ללא סימון ביצוע.</p></header>')
    if not total:
        return head + '<p class="empty">אין כרגע פריטים שדורשים פעולה בארכיון.</p>'
    out = [head]
    for b, rows in groups:
        x = dt.date.fromisoformat(b["date"])
        short = f"{x.day}.{x.month}.{x.year}"
        out.append(f'<section class="agroup actions-day"><h2><a href="{rel}{b["date"]}/">{he_date(b["date"])}</a>'
                   f' <span class="gc">({len(rows)})</span></h2><ol class="actions">')
        for it in rows:
            url = f'{rel}{b["date"]}/#{esc(anchor_of(b, it))}'
            sec = f' · {esc(it["section"])}' if it.get("section") else ""
            todo = (f'<p class="todo"><strong>מה כדאי לעשות:</strong> {esc(it["action"])}</p>'
                    if it.get("action") else "")
            out.append(f'<li class="arow"><p class="ameta"><span class="ad">{short}</span>{sec}</p>'
                       f'<h3><a href="{url}">{esc(it["headline"])}</a></h3>{todo}'
                       f'<p class="ago"><a href="{url}">לידיעה המלאה בסקירה ←</a></p></li>')
        out.append("</ol></section>")
    return "\n".join(out)


def live_scripts(rel, cur, scripts):
    return (f'<script src="{rel}assets/app.js" defer></script>'
            + (f'<script src="{rel}assets/admin.js" defer></script>' if cur == "admin" else "")
            + "".join(f'<script src="{rel}assets/{x}" defer></script>' for x in scripts))


def replica_scripts(rel, cur, scripts, attrs):
    """Replica: data + import + runtime; replica.js renders merged data, then loads app.js / admin.js itself."""
    data = [f"{rel}assets/replica-data.js"] + ([f"{rel}assets/replica-sources.js"] if cur in ("admin", "import") else [])
    a = "".join(f' data-{k}="{esc(v)}"' for k, v in (attrs or {}).items())
    return ("".join(f'<script src="{x}" defer></script>' for x in data)
            + f'<script src="{rel}assets/import.js" defer></script>'
            + f'<script src="{rel}assets/replica.js" defer data-rel="{esc(rel)}" data-cur="{esc(cur)}"{a}'
            + (' data-admin-js' if cur == "admin" else "") + '></script>'
            + "".join(f'<script src="{rel}assets/{x}" defer></script>' for x in scripts))


def page(title, body, rel, aside="", cur="", wide=False, scripts=(), page_attrs=None):
    year = dt.date.today().year
    return f"""<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex,nofollow">
<title>{esc(title)}</title>
<script src="{rel}assets/theme.js"></script>
{'' if REPLICA else '<link rel="preload" href="'+rel+'assets/fonts/heebo-var.woff2" as="font" type="font/woff2" crossorigin>'+chr(10)}<link rel="stylesheet" href="{rel}assets/style.css">
<link rel="icon" href="{rel}assets/favicon.svg" type="image/svg+xml">{'<link rel="stylesheet" href="'+rel+'assets/import.css">' if REPLICA else ''}
</head>
<body>
<a class="skip-link" href="#main">דילוג לתוכן</a>
<header class="masthead"><div class="wrap">
<a class="brand" href="{rel}"><span class="mark" dir="ltr">CTO<b>Review</b></span><span class="tag">{TAGLINE}</span></a>
<nav class="topnav" aria-label="ניווט ראשי">{nav(rel, cur)}<button type="button" class="theme-btn" data-theme-toggle aria-pressed="false" aria-label="Dark mode" title="Dark mode"><svg class="icon-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 14.3A9 9 0 1 1 9.7 3 7 7 0 0 0 21 14.3z"/></svg><svg class="icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg></button>{'' if REPLICA else '<a class="logout" href="/logout">יציאה</a>'}</nav>
</div></header>
<div class="wrap layout{' wide' if wide else ''}">
<main id="main" tabindex="-1">{body}</main>
{aside}
</div>
<button type="button" class="to-top" data-to-top aria-label="חזרה לראש העמוד" title="חזרה לראש העמוד"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
<div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true"></div>
<footer class="foot"><div class="wrap"><bdi>{SITE_NAME}</bdi> · סקירת טכנולוגיה יומית · {year}</div></footer>
{replica_scripts(rel, cur, scripts, page_attrs) if REPLICA else live_scripts(rel, cur, scripts)}
</body>
</html>
"""


NAV = [("", "home", "הסקירה האחרונה"), ("actions/", "actions", "דורש פעולה"), ("archive/", "archive", "ארכיון"),
       ("glossary/", "glossary", "מילון מושגים"), ("admin/", "admin", "מאגר מקורות"), ("admin/stats/", "stats", "סטטיסטיקות")]
# Tight CSP: everything self-hosted, no inline script/style, no third-party requests.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; "
       "connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'")


REPLICA_NAV = NAV[:5] + [("admin/import/", "import", "טעינת עדכון")]


def nav(rel, cur):
    # cur "~key" = highlight the section without aria-current (e.g. a dated brief page under ארכיון)
    hl, is_page = cur.lstrip("~"), not cur.startswith("~")
    if REPLICA:  # no roles in the replica: every link is shown, no data-admin, no stats
        return "".join(f'<a href="{rel}{h}"' + ((' aria-current="page" class="cur"' if is_page else ' class="cur"')
                                               if k == hl else "") + f'>{t}</a>' for h, k, t in REPLICA_NAV)
    return "".join(f'<a href="{rel}{h}"' + (' data-admin' if k in ("admin", "stats") else '') + ((' aria-current="page" class="cur"' if is_page else ' class="cur"')
                                           if k == hl else "") + f'>{t}</a>'
                   for h, k, t in NAV)


_REL_HREF = re.compile(r'href="(?![a-zA-Z][a-zA-Z0-9+.-]*:|/|#)([^"#?]*)((?:\?[^"#]*)?(?:#[^"]*)?)"')


def replica_hrefs(text):
    """Replica only: relative folder links get an explicit index.html (file:// has no directory index)."""
    return _REL_HREF.sub(lambda m: f'href="{m.group(1)}index.html{m.group(2)}"'
                         if m.group(1) == "" or m.group(1).endswith("/") else m.group(0), text)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    if REPLICA and path.suffix == ".html":
        text = replica_hrefs(text)
    path.write_text(text, encoding="utf-8")


def build():
    briefs = load_briefs()
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(ROOT / "assets", DIST / "assets")
    # Pages advanced-mode worker: shared-password login, reader/admin roles, login stats (see README "Login").
    # Deploy MUST upload it as _worker.bundle (prep.py writes deploy-latest.js); without it the site is unprotected.
    if not REPLICA:
        shutil.copy(ROOT / "worker" / "_worker.js", DIST / "_worker.js")
    write(DIST / "robots.txt", "User-agent: *\nDisallow: /\n")
    write(DIST / "_headers", "/*\n  X-Robots-Tag: noindex, nofollow\n  X-Frame-Options: DENY\n"
          "  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n"
          f"  Content-Security-Policy: {CSP}\n")
    if not briefs:
        write(DIST / "index.html", page(SITE_NAME, "<p>עדיין אין סקירות בארכיון.</p>", ""))
        write(DIST / "actions" / "index.html", page(f"דורש פעולה | {SITE_NAME}", render_actions([], "../"), "../",
                                                    cur="actions", wide=True))
        build_admin([])
        return
    adj = lambda i: (briefs[i + 1] if i + 1 < len(briefs) else None, briefs[i - 1] if i > 0 else None)
    for i, b in enumerate(briefs):
        d = DIST / b["date"]
        aside = f'<aside class="side"><h2>ארכיון</h2>{archive_list(briefs, "../", b["date"])}</aside>'
        older, newer = adj(i)
        write(d / "index.html", page(f'{b["title"]} | {SITE_NAME} | CTO-Review-{b["date"]}', render_brief(b, "../", older, newer), "../", aside,
                                     cur="~home" if i == 0 else "~archive", page_attrs={"page": "day", "date": b["date"]}))
        write(d / "brief.json", json.dumps(brief_with_glossary(b), ensure_ascii=False, indent=2))
    latest = briefs[0]
    aside = f'<aside class="side"><h2>ארכיון</h2>{archive_list(briefs, "", latest["date"])}</aside>'
    write(DIST / "index.html", page(f"{SITE_NAME} – {TAGLINE} | CTO-Review-{latest['date']}",
                                    '<p class="latest-badge">הסקירה האחרונה</p>' + render_brief(latest, "", *adj(0)), "", aside,
                                    cur="home", page_attrs={"page": "home"}))
    arch = ('<header class="brief-head"><h1>ארכיון הסקירות</h1>'
            f'<p class="kicker">כל הסקירות היומיות, מהחדשה לישנה ({len(briefs)} סקירות).</p></header>'
            '<div class="asearch" role="search"><label class="fl q" for="aq"><span>חיפוש בארכיון</span>'
            '<input id="aq" type="search" autocomplete="off" placeholder="תאריך, כותרת, ידיעה או תקציר"></label>'
            '<span id="acnt" class="acnt" aria-live="polite"></span></div>'
            '<div id="archive-groups" data-index="../search.json">' + archive_grouped(briefs, "../") + '</div>'
            '<p class="empty hidden" id="aempty">לא נמצאו סקירות שמתאימות לחיפוש.</p>')
    write(DIST / "archive" / "index.html", page(f"ארכיון | {SITE_NAME}", arch, "../", cur="archive", wide=True,
                                                page_attrs={"page": "archive"}))
    write(DIST / "actions" / "index.html", page(f"דורש פעולה | {SITE_NAME}", render_actions(briefs, "../"), "../",
                                                cur="actions", wide=True, page_attrs={"page": "actions"}))
    write(DIST / "index.json", json.dumps(
        [{"date": b["date"], "title": b["title"], "items": len(b["items"]), "actions": counts(b)["action"],
          "url": f'/{b["date"]}/'} for b in briefs],
        ensure_ascii=False, indent=2))
    # Small client-side search index for /archive/ (date, title, headlines, summaries).
    write(DIST / "search.json", json.dumps(
        [{"date": b["date"], "he": he_date(b["date"]), "title": b["title"],
          "items": [{"id": it.get("id"), "a": item_anchors(b)[n], "h": it.get("headline") or "", "s": it.get("summary") or "",
                     "tag": it.get("tag") or "background"} for n, it in enumerate(b["items"])]} for b in briefs],
        ensure_ascii=False, separators=(",", ":")))
    print(f"built {len(briefs)} briefs -> {DIST}")
    build_glossary(briefs)
    build_admin(briefs)
    if REPLICA:
        build_replica(briefs)


# ---------------------------------------------------------------------------
# Glossary outputs: /glossary.json (same format as glossary.json), per-item "glossary" keys in
# /YYYY-MM-DD/brief.json, and the reader page /glossary/ («מילון מושגים»).
# ---------------------------------------------------------------------------
GL_SHOW_OCC = 5  # occurrence links shown before the «ועוד» disclosure


def brief_with_glossary(b):
    """Copy of the brief for brief.json: each item gets an optional "glossary": [keys] (first-occurrence order)."""
    out = dict(b)
    items = []
    for it in b.get("items", []):
        keys = GL.item_keys(it)
        items.append({**it, "glossary": keys} if keys else dict(it))
    out["items"] = items
    return out


def gl_occurrences(briefs):
    """{key: [(brief, anchor, item)]} newest brief first, brief order within a day."""
    occ = {}
    for b in briefs:
        anchors = item_anchors(b)
        for n, it in enumerate(b["items"]):
            for k in GL.item_keys(it):
                occ.setdefault(k, []).append((b, anchors[n], it))
    return occ


def gl_norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[\u0591-\u05C7]", "", str(s or "")).replace("\u05f4", '"')).strip().lower()


def render_glossary(briefs, rel):
    occ = gl_occurrences(briefs)
    latest = briefs[0] if briefs else None
    latest_keys = set()
    if latest:
        for it in latest["items"]:
            latest_keys.update(GL.item_keys(it))
    entries = [e for e in GLOSSARY["entries"] if e["key"] in occ]
    entries.sort(key=lambda e: e["term"].casefold())
    by_cat = {}
    for e in entries:
        by_cat.setdefault(e["category"], []).append(e)
    n_latest = sum(1 for e in entries if e["key"] in latest_keys)
    head = ('<header class="brief-head"><p class="kicker">הסברים קצרים למושגים, לחברות ולמוצרים שמופיעים בסקירות</p>'
            '<h1>מילון מושגים</h1>'
            f'<p class="stats">{len(entries)} מושגים מתוך הסקירות'
            + (f' · {n_latest} מופיעים בעדכון האחרון' if latest else "")
            + f' &nbsp;·&nbsp; <a class="dl" href="{rel}glossary.json" download="cto-review-glossary.json">הורדת JSON</a></p></header>')
    out = [head]
    if latest and n_latest:
        chips = "".join(f'<li><a href="#g-{esc(e["key"])}" dir="auto">{esc(e["term"])}</a></li>'
                        for e in entries if e["key"] in latest_keys)
        out.append('<section class="gl-latest" aria-labelledby="gl-latest-h">'
                   f'<h2 id="gl-latest-h">מופיעים בעדכון האחרון</h2>'
                   f'<p class="kicker"><a href="{rel}{latest["date"]}/">{he_date(latest["date"])}</a></p>'
                   f'<ul class="gl-chips">{chips}</ul></section>')
    cats = [c for c in glossary_lib.CAT_ORDER if c in by_cat]
    out.append('<div class="gl-tools" role="search" aria-label="חיפוש במילון">'
               '<label class="fl q" for="gq"><span>חיפוש במילון</span>'
               '<input id="gq" type="search" autocomplete="off" placeholder="מושג, חברה, מוצר או מילה מההסבר"></label>'
               '<div class="gl-cats" role="group" aria-label="סינון לפי סוג">'
               '<button type="button" data-gc="all" aria-pressed="true">הכל</button>'
               + "".join(f'<button type="button" data-gc="{c}" aria-pressed="false">{glossary_lib.CAT_HE[c]}</button>' for c in cats)
               + '</div>'
               + ('<label class="gl-only"><input type="checkbox" id="gl-latest-only"> רק מושגים מהעדכון האחרון</label>' if latest else "")
               + '<span id="gcnt" class="acnt" aria-live="polite"></span></div>')
    out.append('<div id="gl-list">')
    for c in cats:
        out.append(f'<section class="gl-group" data-cat="{c}" aria-labelledby="gg-{c}"><h2 id="gg-{c}">{glossary_lib.CAT_HE[c]}'
                   f' <span class="gc">({len(by_cat[c])})</span></h2>')
        for e in by_cat[c]:
            rows = occ[e["key"]]
            is_latest = e["key"] in latest_keys
            q = gl_norm(" ".join([e["term"]] + list(e.get("aliases") or []) + [e["definition_he"]]))

            def li(row):
                b, a, it = row
                x = dt.date.fromisoformat(b["date"])
                return (f'<li><a href="{rel}{b["date"]}/#{esc(a)}"><span class="ad">{x.day}.{x.month}.{x.year}</span> '
                        f'{esc(it.get("headline"))}</a></li>')
            occ_html = "".join(li(r) for r in rows[:GL_SHOW_OCC])
            more = ""
            if len(rows) > GL_SHOW_OCC:
                more = (f'<details class="gl-more"><summary>ועוד {len(rows) - GL_SHOW_OCC} ידיעות</summary>'
                        f'<ul class="gl-occ">{"".join(li(r) for r in rows[GL_SHOW_OCC:])}</ul></details>')
            link_html = (f'<p class="gl-link"><a href="{esc(e["url"])}" target="_blank" rel="noopener noreferrer">לאתר הרשמי ↗</a></p>'
                         if e.get("url") else "")
            badge = '<span class="gl-badge">בעדכון האחרון</span>' if is_latest else ""
            word = "ידיעה אחת" if len(rows) == 1 else f"{len(rows)} ידיעות"
            out.append(f'<article class="gl-entry" id="g-{esc(e["key"])}" data-cat="{c}" data-latest="{1 if is_latest else 0}" '
                       f'data-q="{esc(q)}"><h3><span class="gl-term" dir="auto">{esc(e["term"])}</span>{badge}</h3>'
                       f'<p class="gl-def">{esc(e["definition_he"])}</p>{link_html}'
                       f'<p class="gl-occ-h">מופיע ב{word}:</p><ul class="gl-occ">{occ_html}</ul>{more}</article>')
        out.append('</section>')
    out.append('</div><p class="empty hidden" id="gempty">לא נמצאו מושגים שמתאימים לחיפוש.</p>')
    if not entries:
        out.append('<p class="empty">עדיין אין מושגים מהמילון בסקירות.</p>')
    return "\n".join(out)


def build_glossary(briefs):
    write(DIST / "glossary.json", json.dumps(GLOSSARY, ensure_ascii=False, indent=2))
    write(DIST / "glossary" / "index.html", page(f"מילון מושגים | {SITE_NAME}", render_glossary(briefs, "../"), "../",
                                                cur="glossary", wide=True, page_attrs={"page": "glossary"}))
    for f in (DIST / "glossary.json", DIST / "glossary" / "index.html"):
        if FORBIDDEN.search(f.read_text(encoding="utf-8")):
            sys.exit(f"refusing: forbidden wording in {f}")
    print(f"built glossary ({len(GLOSSARY['entries'])} entries) -> {DIST / 'glossary'}")


# ---------------------------------------------------------------------------
# Admin area: sanitized mirror of the technology sources registry.
# ---------------------------------------------------------------------------
SOURCES = Path(os.environ.get("CTO_SOURCES", "/workspace/cto-sources/sources.json"))
if "CTO_SOURCES" not in os.environ and not SOURCES.exists() and (ROOT / "sources" / "sources.json").exists():
    SOURCES = ROOT / "sources" / "sources.json"  # repository copy (the sanitized mirror), e.g. a build from the GitHub ZIP
TOPIC_HE = {"ai": "בינה מלאכותית", "data": "דאטה", "quantum": "קוונטים", "systems_products": "מערכות ומוצרים",
            "cloud": "ענן", "cyber": "סייבר", "enterprise": "ארגוני"}
STATUS_HE = {"active": "פעיל", "probation": "בניסיון", "inactive": "לא פעיל"}
ACCESS_HE = {"free": "פתוח", "paywall": "מאחורי תשלום", "account": "דורש חשבון"}
LANG_HE = {"he": "עברית", "en": "אנגלית"}
TYPE_HE = {"primary_vendor": "ספק ראשוני", "research_lab": "מעבדת מחקר", "academic": "אקדמי",
           "standards_gov": "תקנים ורגולטור", "news_outlet": "כלי חדשות", "trade_press": "עיתונות מקצועית",
           "analyst_firm": "פירמת אנליסטים", "independent_expert": "מומחה עצמאי", "newsletter": "ניוזלטר",
           "community": "קהילה", "aggregator": "מאגד", "social_account": "חשבון רשת"}
REL_HE = {5: "ראשוני / סמכותי", 4: "מערכת חזקה / מומחה מוכר", 3: "עיתונות מקצועית / קהילה",
          2: "סימן מוקדם – דורש אימות", 1: "שמועה"}
VIA_HE = {"itc_cto_dept_recommendation": "המלצת מחלקת CTO", "x_network_scan": "סריקת רשת ב-X"}
FREQ_HE = {"daily": "יומי", "weekly": "שבועי", "frequent": "תכוף", "irregular": "לא סדיר"}
PRIO_HE = {"cloud_announcements": "הכרזות רשמיות של ספקי ענן"}
PUBLIC_FIELDS = ["id", "name", "url", "feed_url", "x_handle", "type", "topics", "reliability",
                 "reliability_rationale", "bias_notes", "best_for", "access", "language", "status",
                 "added", "last_verified", "times_used", "notes", "frequency", "delivery", "subscribed",
                 "discovered_via", "priority", "momentum", "last_momentum_check"]
# Strings that must never reach dist/admin (checked after generation; build fails on a hit).
FORBIDDEN = re.compile(r"amiram|grok\s*bot|grokbot|bencogpt|mail\.grokbot|following[\s_-]*list|"
                       r"תיבת הבוט|לתיבת|box browser|routine|רוטינ", re.I)
_REWRITES = [
    (re.compile(r"email subscription to (?:the )?bot inbox[^;,.]*", re.I), "מנוי במייל"),
    (re.compile(r"מנוי מייל לתיבת הבוט"), "מנוי במייל"),
    (re.compile(r"(?:ל)?תיבת הבוט"), ""),
    (re.compile(r"[\w.+-]+@mail\.grokbot\.com", re.I), ""),
    (re.compile(r"[\w.+-]*bencogpt[\w.+-]*(?:@[\w.-]+)?", re.I), ""),
    (re.compile(r"Signed in on (?:the )?box browser(?: \([^)]*\))?;?\s*", re.I), "יש חשבון מחובר; "),
    (re.compile(r"box browser", re.I), "דפדפן"),
    (re.compile(r"grok\s*bot", re.I), ""),
    (re.compile(r"\bx_network_scan\b"), "סריקת רשת ב-X"),
    (re.compile(r"סריקת רשת ב-X \(סריקת רשת ב-X\)"), "סריקת רשת ב-X"),
    # any origin-account / following-list wording collapses to the approved neutral label
    (re.compile(r"[^;.,]*(?:amiram|following[\s_-]*list|רשימת (?:ה)?עוקבים|רשימת (?:ה)?נעקבים)[^;.,]*", re.I),
     "סריקת רשת ב-X"),
]


def clean_text(v):
    if not isinstance(v, str):
        return v
    for rx, rep in _REWRITES:
        v = rx.sub(rep, v)
    v = re.sub(r"\s{2,}", " ", v).strip()
    v = re.sub(r"\s+([;,.])", r"\1", v).strip("; ").strip()
    return v


def clean_source(s):
    out = {}
    for k in PUBLIC_FIELDS:
        if k not in s:
            continue
        v = s[k]
        if k == "delivery" and v:
            v = "מנוי במייל" if re.search(r"mail|מייל|newsletter", str(v), re.I) else clean_text(v)
        elif k == "discovered_via" and v:
            v = v if v in VIA_HE else "other"
        elif isinstance(v, list):
            v = [clean_text(x) for x in v]
        else:
            v = clean_text(v)
        out[k] = v if v != "" else None
    return out


def load_registry():
    d = json.load(open(SOURCES, encoding="utf-8"))
    srcs = [clean_source(s) for s in d.get("sources", [])]
    log = [{"date": c.get("date"), "change": clean_text(c.get("change"))} for c in d.get("changelog", [])]
    return {"version": d.get("version"), "updated": d.get("updated"), "count": len(srcs),
            "sources": srcs, "changelog": log}


def short_date(d):
    try:
        x = dt.date.fromisoformat(d)
        return f"{x.day}.{x.month}.{x.year}"
    except Exception:
        return esc(d or "—")


def opt_list(name, label, mapping, counts_):
    opts = "".join(f'<option value="{esc(k)}">{esc(v)} ({counts_.get(k, 0)})</option>'
                   for k, v in mapping.items() if counts_.get(k, 0))
    return (f'<label class="fl"><span>{label}</span><select data-k="{name}">'
            f'<option value="">הכל</option>{opts}</select></label>')


def link(url, text=None, cls=""):
    c = f' class="{cls}"' if cls else ""
    return f'<a{c} href="{esc(url)}" target="_blank" rel="noopener noreferrer">{esc(text or url)}</a>'


def render_source(s):
    topics = s.get("topics") or []
    rel = s.get("reliability") or 0
    q = " ".join(str(s.get(k) or "") for k in ("name", "id", "x_handle", "best_for", "url")).lower()
    attrs = (f'data-q="{esc(q)}" data-topic="{esc(" ".join(topics))}" data-rel="{rel}" '
             f'data-status="{esc(s.get("status"))}" data-type="{esc(s.get("type"))}" '
             f'data-lang="{esc(s.get("language"))}" data-access="{esc(s.get("access"))}" '
             f'data-name="{esc((s.get("name") or "").lower())}" data-used="{s.get("times_used") or 0}" '
             f'data-added="{esc(s.get("added"))}"')
    chips = [f'<span class="rel r{rel}" title="{esc(REL_HE.get(rel, ""))}">אמינות {rel}</span>',
             f'<span class="st st-{esc(s.get("status"))}">{esc(STATUS_HE.get(s.get("status"), s.get("status")))}</span>',
             f'<span class="chip">{esc(TYPE_HE.get(s.get("type"), s.get("type")))}</span>']
    chips += [f'<span class="chip tp">{esc(TOPIC_HE.get(t, t))}</span>' for t in topics]
    if s.get("language") == "he":
        chips.append('<span class="chip he">עברית</span>')
    if s.get("access") and s["access"] != "free":
        chips.append(f'<span class="chip acc">{esc(ACCESS_HE.get(s["access"], s["access"]))}</span>')
    rows = [("סוג", TYPE_HE.get(s.get("type"), s.get("type"))),
            ("נושאים", ", ".join(TOPIC_HE.get(t, t) for t in topics)),
            ("אמינות", f'{rel} – {REL_HE.get(rel, "")}'),
            ("נימוק לדירוג", s.get("reliability_rationale")),
            ("הטיות", s.get("bias_notes")),
            ("סטטוס", STATUS_HE.get(s.get("status"), s.get("status"))),
            ("שפה", LANG_HE.get(s.get("language"), s.get("language"))),
            ("גישה", ACCESS_HE.get(s.get("access"), s.get("access")))]
    html_rows = [f"<dt>{k}</dt><dd>{esc(v)}</dd>" for k, v in rows if v]
    if s.get("x_handle"):
        h = s["x_handle"].lstrip("@")
        html_rows.append(f'<dt>חשבון X</dt><dd class="ltr">{link("https://x.com/" + h, "@" + h)}</dd>')
    if s.get("feed_url"):
        html_rows.append(f'<dt>פיד</dt><dd class="ltr">{link(s["feed_url"])}</dd>')
    html_rows.append(f'<dt>כתובת</dt><dd class="ltr">{link(s["url"])}</dd>')
    extra = [("תדירות", FREQ_HE.get(s.get("frequency"), s.get("frequency"))),
             ("קבלה", s.get("delivery")),
             ("מנוי מאז", short_date(s["subscribed"]) if s.get("subscribed") else None),
             ("נוסף דרך", VIA_HE.get(s.get("discovered_via"), "אחר") if s.get("discovered_via") else None),
             ("עדיפות", PRIO_HE.get(s.get("priority"), s.get("priority"))),
             ("הערות", s.get("notes")),
             ("סימני תאוצה (פנימי)", s.get("momentum")),
             ("בדיקת תאוצה אחרונה", short_date(s["last_momentum_check"]) if s.get("last_momentum_check") else None)]
    html_rows += [f"<dt>{k}</dt><dd>{esc(v)}</dd>" for k, v in extra if v]
    html_rows.append(f'<dt>נוסף / אומת</dt><dd>{short_date(s.get("added"))} / {short_date(s.get("last_verified"))}</dd>')
    html_rows.append(f'<dt>צוטט בסקירות</dt><dd>{s.get("times_used") or 0} פעמים</dd>')
    handle = f' <span class="hdl" dir="ltr">@{esc(s["x_handle"].lstrip("@"))}</span>' if s.get("x_handle") else ""
    return (f'<li class="src" {attrs}><details><summary>'
            f'<span class="sn">{esc(s.get("name"))}</span>{handle}'
            f'<span class="chips">{"".join(chips)}</span>'
            f'<span class="bf">{esc(s.get("best_for"))}</span></summary>'
            f'<div class="sd"><p class="open">{link(s["url"], "פתיחת המקור ↗", "go")}</p>'
            f'<dl>{"".join(html_rows)}</dl></div></details></li>')


def admin_head(reg, latest_date):
    """Header + meta row of /admin/. Live: downloads + stats link. Replica: downloads (merged by replica.js) + import page."""
    dl_update = (f'<a class="dl" href="update.json" download="cto-review-update-{latest_date}.json" '
                 'title="הסקירה האחרונה, מילון המושגים ומאגר המקורות, לעדכון היומי של אתר הרפליקה">עדכון יומי מלא (JSON)</a> · '
                 if latest_date and not REPLICA else "")
    dl_export = (f'<a class="dl" href="export.json" download="cto-review-export-{latest_date}.json" '
                 'title="כל הסקירות, מילון המושגים ומאגר המקורות בקובץ אחד, לטעינה באתר הרפליקה">ייצוא מלא (JSON)</a> · '
                 if latest_date else "")
    tail = ('<a class="dl" href="#log">יומן שינויים</a> · <a class="dl" href="import/">טעינת עדכון</a>' if REPLICA else
            '<a class="dl" href="#log">יומן שינויים</a> · <a class="dl" href="stats/">סטטיסטיקות כניסה</a>')
    return ('<header class="brief-head"><p class="kicker">' + ("אזור ניהול · רפליקה" if REPLICA else "אזור ניהול · פנימי") + '</p>'
            '<h1>אזור ניהול · מאגר המקורות</h1>'
            f'<p class="stats">עודכן לאחרונה: {he_date(reg["updated"])} · גרסה {esc(reg["version"])} · '
            '<a class="dl" href="sources.json" download="cto-review-sources.json">הורדת JSON</a> · '
            + dl_update + dl_export + tail + '</p></header>')


def build_admin(briefs=()):
    if not SOURCES.exists():
        print(f"admin: registry not found at {SOURCES}; skipping", file=sys.stderr)
        return
    reg = load_registry()
    S = reg["sources"]
    from collections import Counter
    c_rel = Counter(s.get("reliability") for s in S)
    c_st = Counter(s.get("status") for s in S)
    c_lang = Counter(s.get("language") for s in S)
    c_acc = Counter(s.get("access") for s in S)
    c_type = Counter(s.get("type") for s in S)
    c_top = Counter(t for s in S for t in (s.get("topics") or []))

    def stat(n, label, cls=""):
        return f'<div class="stat {cls}"><b>{n}</b><span>{label}</span></div>'

    summary = ['<section class="summary" aria-label="סיכום המאגר">',
               '<div class="srow">', stat(len(S), "מקורות במאגר", "big"),
               stat(c_lang.get("he", 0), "מקורות בעברית"),
               "".join(stat(c_st.get(k, 0), v, "st-" + k) for k, v in STATUS_HE.items()), "</div>",
               '<div class="srow"><span class="sl">לפי אמינות</span>',
               "".join(stat(c_rel.get(r, 0), f"אמינות {r}", f"r{r}") for r in (5, 4, 3, 2)), "</div>",
               '<div class="srow"><span class="sl">לפי נושא</span>',
               "".join(stat(n, TOPIC_HE.get(t, t)) for t, n in c_top.most_common()), "</div></section>"]
    sel = {"rel": {str(r): f"{r} – {REL_HE[r]}" for r in (5, 4, 3, 2, 1)}}
    filters = ('<section class="afilters" aria-label="חיפוש וסינון">'
               '<label class="fl q"><span>חיפוש</span><input type="search" id="q" '
               'placeholder="שם, מזהה, חשבון X, שימוש או כתובת" autocomplete="off"></label>'
               + opt_list("topic", "נושא", TOPIC_HE, c_top)
               + opt_list("rel", "אמינות", sel["rel"], {str(k): v for k, v in c_rel.items()})
               + opt_list("status", "סטטוס", STATUS_HE, c_st)
               + opt_list("type", "סוג", TYPE_HE, c_type)
               + opt_list("lang", "שפה", LANG_HE, c_lang)
               + opt_list("access", "גישה", ACCESS_HE, c_acc)
               + '<label class="fl"><span>מיון</span><select id="sort">'
               '<option value="rel">אמינות (גבוה לנמוך)</option><option value="name">שם (א–ת / A–Z)</option>'
               '<option value="used">הכי מצוטטים</option><option value="added">נוספו לאחרונה</option></select></label>'
               '<div class="fbar"><span id="cnt" aria-live="polite">מוצגים ' + str(len(S)) + f' מתוך {len(S)}</span>'
               '<button type="button" id="reset">איפוס סינון</button>'
               '<button type="button" id="expand">פתיחת הכל</button></div></section>')
    order = sorted(S, key=lambda s: (-(s.get("reliability") or 0), (s.get("name") or "").lower()))
    items = '<ol class="srcs" id="srcs">' + "".join(render_source(s) for s in order) + "</ol>"
    empty = '<p class="empty hidden" id="empty">לא נמצאו מקורות שמתאימים לסינון.</p>'
    log = ['<section class="changelog"><h2>יומן שינויים</h2><ul>']
    log += [f'<li><span class="d">{short_date(c["date"])}</span> {esc(c["change"])}</li>' for c in reg["changelog"]]
    log.append("</ul></section>")
    head = admin_head(reg, briefs[0]["date"] if briefs else None)
    body = head + "".join(summary) + filters + items + empty + '<div id="log"></div>' + "".join(log)
    out = page(f"אזור ניהול · מאגר המקורות | {SITE_NAME}", body, "../", cur="admin", wide=True, page_attrs={"page": "admin"})
    pub = json.dumps(reg, ensure_ascii=False, indent=2)
    for name, text in (("index.html", out), ("sources.json", pub)):
        m = FORBIDDEN.search(text)
        if m:
            sys.exit(f"refusing: admin/{name} still contains a forbidden string near {text[max(0, m.start()-40):m.end()+40]!r}")
    write(DIST / "admin" / "index.html", out)
    if not REPLICA:
        build_stats()
    write(DIST / "admin" / "sources.json", pub)
    print(f"built admin: {len(S)} sources, {len(reg['changelog'])} changelog entries -> {DIST / 'admin'}")
    if briefs:
        build_export(briefs, reg)
        if not REPLICA:
            build_update(briefs, reg)
    if REPLICA:
        write(DIST / "assets" / "replica-sources.js", replica_js("CTO_REPLICA_SOURCES", reg, FORBIDDEN))


# ---------------------------------------------------------------------------
# Full data export (admin only): /admin/export.json, downloaded as cto-review-export-YYYY-MM-DD.json
# (latest brief date). One file with every brief (the same objects as /YYYY-MM-DD/brief.json), the
# glossary (= /glossary.json) and the sanitized sources mirror (= /admin/sources.json), for the
# offline replica's import. Served under /admin/, so the worker allows only the admin role.
# ---------------------------------------------------------------------------
EXPORT_FORMAT, EXPORT_VERSION = "cto-review-export", 1
# Briefs are news text and may legitimately name third-party products, so they get the identity
# subset; glossary and sources must pass the full FORBIDDEN list (as in their own outputs).
EXPORT_FORBIDDEN_ID = re.compile(r"amiram|grokbot|bencogpt|mail\.grokbot|following[\s_-]*list|תיבת הבוט|box browser", re.I)
EXPORT_EMAIL = re.compile(r"[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
EXPORT_SECRETS = re.compile(r"SESSION_SECRET|ADMIN_PASSWORD|SHARED_PASSWORD|CTO_REVIEW_\w*PASSWORD|CTO_UPLOAD_TOKEN|"
                            r"Bearer\s+[\w-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY|\"(?:ip|vh|ua|cookie|password|token)\"\s*:", re.I)


def export_checked(name, data, briefs_part, extra_parts):
    """Serialize an export-style file and refuse to write it if anything forbidden survived (see README)."""
    text = json.dumps(data, ensure_ascii=False, indent=1)
    parts = [("briefs", json.dumps(briefs_part, ensure_ascii=False), EXPORT_FORBIDDEN_ID)] + \
            [(k, json.dumps(v, ensure_ascii=False), FORBIDDEN) for k, v in extra_parts] + [(name, text, EXPORT_FORBIDDEN_ID)]
    for pname, t, rx in parts:
        for chk in (rx, EXPORT_EMAIL, EXPORT_SECRETS):
            m = chk.search(t)
            if m:
                sys.exit(f"refusing: {name} ({pname}) contains a forbidden string near {t[max(0, m.start()-40):m.end()+40]!r}")
    for var in ("CTO_REVIEW_SHARED_PASSWORD", "CTO_REVIEW_ADMIN_PASSWORD"):
        v = os.environ.get(var)
        if v and len(v) >= 4 and v in text:
            sys.exit(f"refusing: {name} contains the value of {var}")  # value itself is never printed
    return text


def build_export(briefs, reg):
    data = {"format": EXPORT_FORMAT, "format_version": EXPORT_VERSION,
            "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "latest": briefs[0]["date"], "counts": {"briefs": len(briefs), "glossary": len(GLOSSARY["entries"]),
                                                     "sources": len(reg["sources"])},
            "briefs": [brief_with_glossary(b) for b in sorted(briefs, key=lambda b: b["date"])],
            "glossary": GLOSSARY, "sources": reg}
    text = export_checked("export", data, data["briefs"], [("glossary", GLOSSARY), ("sources", reg)])
    write(DIST / "admin" / "export.json", text)
    print(f"built export: {len(data['briefs'])} briefs, {len(GLOSSARY['entries'])} glossary entries, "
          f"{len(reg['sources'])} sources, {len(text.encode('utf-8'))} bytes -> {DIST / 'admin' / 'export.json'}"
          f" (download name cto-review-export-{briefs[0]['date']}.json)")


# Daily full update (admin only, live site): /admin/update.json, downloaded as cto-review-update-YYYY-MM-DD.json.
# The latest brief + the full glossary + the sanitized sources mirror, for the replica's daily load.
UPDATE_FORMAT, UPDATE_VERSION = "cto-review-update", 1


def build_update(briefs, reg):
    latest = brief_with_glossary(briefs[0])
    data = {"format": UPDATE_FORMAT, "format_version": UPDATE_VERSION,
            "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "date": latest["date"], "counts": {"briefs": 1, "glossary": len(GLOSSARY["entries"]), "sources": len(reg["sources"])},
            "brief": latest, "glossary": GLOSSARY, "sources": reg}
    text = export_checked("update", data, [latest], [("glossary", GLOSSARY), ("sources", reg)])
    write(DIST / "admin" / "update.json", text)
    print(f"built update: brief {latest['date']}, {len(GLOSSARY['entries'])} glossary entries, {len(reg['sources'])} sources, "
          f"{len(text.encode('utf-8'))} bytes -> {DIST / 'admin' / 'update.json'} (download name cto-review-update-{latest['date']}.json)")


# ---------------------------------------------------------------------------
# Offline replica (python3 build.py --replica). See README «Replica build» and SPEC section 9.
# ---------------------------------------------------------------------------
def replica_js(var, data, rx):
    """Embed data as a classic script (works from file://, no fetch). '</' is escaped so the JSON cannot end the script."""
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    for chk in (rx, EXPORT_EMAIL, EXPORT_SECRETS):
        m = chk.search(body)
        if m:
            sys.exit(f"refusing: {var} contains a forbidden string near {body[max(0, m.start()-40):m.end()+40]!r}")
    return f"/* generated by build.py --replica; data, not code */\nwindow.{var}={body};\n"


def replica_labels():
    return {"site": SITE_NAME, "tagline": TAGLINE, "months": HE_MONTHS, "days": HE_DAYS,
            "tags": {k: list(v) for k, v in TAGS.items()}, "heat": {str(k): list(v) for k, v in HEAT.items()},
            "share_icon": SHARE_ICON, "share_max": SHARE_MAX, "gl_show_occ": GL_SHOW_OCC,
            "cat_he": glossary_lib.CAT_HE, "cat_order": glossary_lib.CAT_ORDER, "item_fields": list(glossary_lib.ITEM_FIELDS),
            "topic": TOPIC_HE, "status": STATUS_HE, "access": ACCESS_HE, "lang": LANG_HE, "type": TYPE_HE,
            "rel": {str(k): v for k, v in REL_HE.items()}, "via": VIA_HE, "freq": FREQ_HE, "prio": PRIO_HE}


IMPORT_PANEL = (
    '<section class="import-panel" data-import-root data-import-manual aria-labelledby="ip-h">'
    '<h2 id="ip-h">טעינת קובץ JSON</h2>'
    '<p class="ip-help">אפשר לבחור או לגרור כמה קבצים יחד: סקירה יומית (<span dir="ltr">tech-brief-YYYY-MM-DD.json</span>), '
    'עדכון יומי מלא (<span dir="ltr">cto-review-update-YYYY-MM-DD.json</span>), ייצוא מלא '
    '(<span dir="ltr">cto-review-export-YYYY-MM-DD.json</span>), מילון מושגים או מאגר מקורות. סוג הקובץ מזוהה לבד.</p>'
    '<div class="ip-row"><input type="file" id="ip-file" accept=".json,application/json" multiple data-import-input>'
    '<label for="ip-file" class="print-btn">בחירת קבצים</label>'
    '<button type="button" class="print-btn" data-import-export>ייצוא הארכיון המקומי</button>'
    '<button type="button" class="print-btn" data-import-reset>איפוס הנתונים המקומיים</button></div>'
    '<div class="dropzone" data-import-drop>גררו לכאן קובץ JSON, או בחרו קובץ</div>'
    '<div class="import-summary" data-import-summary role="status" aria-live="polite"></div>'
    '<dialog data-import-confirm><p data-msg></p><form method="dialog">'
    '<button class="print-btn" value="yes">החלפה</button><button class="print-btn" value="no">ביטול</button></form></dialog>'
    '<dialog data-import-glossary><p data-msg></p><form method="dialog"><button class="print-btn" value="merge">מיזוג</button>'
    '<button class="print-btn" value="replace">החלפת המילון</button><button class="print-btn" value="">ביטול</button></form></dialog>'
    '<dialog data-import-reset-dlg><p data-msg>למחוק את כל הנתונים שנטענו לדפדפן הזה (סקירות, מילון ומאגר מקורות)? '
    'הסקירות שנבנו עם האתר יישארו.</p><form method="dialog"><button class="print-btn" value="yes">מחיקה</button>'
    '<button class="print-btn" value="no">ביטול</button></form></dialog>'
    '</section>')


def build_replica(briefs):
    built_at = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    data = {"format": "cto-review-replica-data", "generated_at": built_at, "labels": replica_labels(),
            "dates": [b["date"] for b in briefs], "briefs": [brief_with_glossary(b) for b in briefs], "glossary": GLOSSARY}
    write(DIST / "assets" / "replica-data.js", replica_js("CTO_REPLICA", data, EXPORT_FORBIDDEN_ID))
    for f in ("import.js", "import.css", "replica.js"):
        src = ROOT / "replica" / "assets" / f
        if not src.exists():
            sys.exit(f"refusing: replica build needs {src}")
        shutil.copy(src, DIST / "assets" / f)
    for f in ("login.js", "stats.js"):  # live-site only
        (DIST / "assets" / f).unlink(missing_ok=True)
    # file:// blocks font files (CORS origin "null"): embed the font in the replica's style.css as a data: URL
    css_p = DIST / "assets" / "style.css"
    css = css_p.read_text(encoding="utf-8")
    font = base64.b64encode((ROOT / "assets" / "fonts" / "heebo-var.woff2").read_bytes()).decode("ascii")
    if 'url("fonts/heebo-var.woff2")' not in css:
        sys.exit("refusing: style.css font url not found for the replica font embedding")
    css_p.write_text(css.replace('url("fonts/heebo-var.woff2")', f'url("data:font/woff2;base64,{font}")'), encoding="utf-8")
    aside = '<aside class="side"><h2>ארכיון</h2>' + archive_list(briefs, "../") + '</aside>'
    day = ('<div class="replica-day" id="replica-day"><p class="empty">טוען את הסקירה…</p>'
           '<noscript><p class="empty">כדי להציג סקירות שנטענו מקובץ צריך JavaScript.</p></noscript></div>')
    write(DIST / "day" / "index.html", page(f"סקירה | {SITE_NAME}", day, "../", aside, cur="~archive",
                                            page_attrs={"page": "dayview"}))
    body = ('<header class="brief-head"><p class="kicker">אזור ניהול · רפליקה</p><h1>טעינת עדכון</h1>'
            '<p class="stats">טוענים כאן את הקובץ שהורד מהאתר החי. הנתונים נשמרים רק בדפדפן הזה (IndexedDB), '
            'והאתר מתעדכן מיד: הסקירה החדשה מופיעה בעמוד הבית, בארכיון, בחיפוש, בלוח «דורש פעולה» ובמילון.</p></header>'
            + IMPORT_PANEL +
            '<section class="replica-status" aria-labelledby="rs-h"><h2 id="rs-h">מצב הנתונים המקומיים</h2>'
            '<div id="replica-status"><p class="empty">טוען…</p></div></section>')
    write(DIST / "admin" / "import" / "index.html", page(f"טעינת עדכון | {SITE_NAME}", body, "../../", cur="import", wide=True,
                                                         page_attrs={"page": "import"}))
    print(f"built replica runtime: {len(briefs)} built-in briefs, day view, import page -> {DIST}")


def build_stats():
    """/admin/stats/ – login statistics (admin role only; data from /admin/stats/data.json served by the worker)."""
    body = ('<header class="brief-head"><p class="kicker">אזור ניהול · פנימי</p>'
            '<h1>אזור ניהול · סטטיסטיקות כניסה</h1>'
            '<p class="stats">כניסות לאתר עם שם משתמש וסיסמה. לא נשמרות כתובות IP: מבקרים ייחודיים מחושבים בקירוב '
            'מטביעת IP מגובבת. · <a class="dl" href="../">מאגר המקורות</a> · '
            '<a class="dl" href="data.json" download="cto-review-logins.json">הורדת JSON</a></p></header>'
            '<p id="st-status" class="kicker" aria-live="polite">טוען נתונים…</p>'
            '<section class="summary hidden" id="st-summary" aria-label="סיכום"><div class="srow" id="st-cards"></div></section>'
            '<section class="st-block hidden" id="st-days-wrap"><h2>כניסות לפי יום · 30 הימים האחרונים</h2>'
            '<table class="st-table st-days"><thead><tr><th scope="col">תאריך</th><th scope="col">הצליחו</th>'
            '<th scope="col">נכשלו</th><th scope="col">מבקרים</th><th scope="col" class="st-barh">היקף</th></tr></thead>'
            '<tbody id="st-days"></tbody></table></section>'
            '<div class="st-grid hidden" id="st-grid">'
            '<section class="st-block"><h2>מדינות</h2><ul class="st-list" id="st-countries"></ul></section>'
            '<section class="st-block"><h2>דפדפנים</h2><ul class="st-list" id="st-browsers"></ul></section>'
            '<section class="st-block"><h2>מערכות הפעלה</h2><ul class="st-list" id="st-os"></ul></section>'
            '<section class="st-block"><h2>סוגי מכשיר</h2><ul class="st-list" id="st-devices"></ul></section>'
            '<section class="st-block"><h2>תפקיד</h2><ul class="st-list" id="st-roles"></ul></section></div>'
            '<section class="st-block hidden" id="st-latest-wrap"><h2>50 האירועים האחרונים</h2><div class="st-scroll">'
            '<table class="st-table"><thead><tr><th scope="col">מתי (שעון ישראל)</th><th scope="col">תוצאה</th>'
            '<th scope="col">תפקיד</th><th scope="col">מדינה / עיר</th><th scope="col">דפדפן</th><th scope="col">מערכת</th>'
            '<th scope="col">מכשיר</th><th scope="col">מבקר</th></tr></thead><tbody id="st-latest"></tbody></table></div></section>')
    write(DIST / "admin" / "stats" / "index.html",
          page(f"אזור ניהול · סטטיסטיקות כניסה | {SITE_NAME}", body, "../../", cur="stats", wide=True, scripts=("stats.js",)))
    print(f"built admin stats page -> {DIST / 'admin' / 'stats'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--add", help="path to a layered brief JSON to import")
    ap.add_argument("--title", help="title override for the imported brief")
    ap.add_argument("--replica", action="store_true", help="offline replica build (no login, import page, client merge)")
    ap.add_argument("--out", help="output folder (default dist/)")
    ap.add_argument("--content", help="folder with the brief JSON files (default content/)")
    a = ap.parse_args()
    global REPLICA, DIST, CONTENT
    REPLICA = a.replica or os.environ.get("CTO_REPLICA") == "1"
    if a.out:
        out = Path(a.out).resolve()
        if out.exists() and any(out.iterdir()) and not (out / "index.html").exists():
            sys.exit(f"refusing: {out} is not empty and does not look like a build output")
        DIST = out
    if a.content:
        CONTENT = Path(a.content).resolve()
    if a.add:
        b = json.load(open(a.add, encoding="utf-8"))
        if b.get("format_version") != "2-layered":
            sys.exit("refusing: brief is not format_version 2-layered")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", b.get("date", "")):
            sys.exit("refusing: brief has no ISO date")
        b = sanitize(b, a.title)
        CONTENT.mkdir(exist_ok=True)
        write(CONTENT / f'{b["date"]}.json', json.dumps(b, ensure_ascii=False, indent=2))
        print(f'imported {b["date"]}')
    build()


if __name__ == "__main__":
    main()
