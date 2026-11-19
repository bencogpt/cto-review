/* CTO Review – offline replica runtime (python3 build.py --replica). See README «Replica build» and SPEC section 9.
 *
 * Merges the data built into the site (assets/replica-data.js, assets/replica-sources.js) with the files the admin
 * loaded on «טעינת עדכון» (IndexedDB, via assets/import.js), and re-renders the page from the merged data:
 * home (newest brief), day pages and the client day view (day/index.html?d=YYYY-MM-DD), archive + search index,
 * «דורש פעולה», «מילון מושגים» and the sources mirror. Then it loads assets/app.js (and admin.js), so every behaviour
 * (filters, share, flames, glossary notes, search) binds to the rendered DOM.
 *
 * The render functions are a line-by-line port of build.py (render_brief, render_item, gl_html, archive_*,
 * render_actions, render_glossary, build_admin/render_source) and of glossary_lib.Matcher, so a built-in day renders
 * to the same HTML as the static page (checked by replica/tests/parity.test.js).
 * Imported JSON is data: every value is HTML-escaped, and only http(s) links are rendered.
 *
 * Three layers (SPEC 9.10): the data built into the site, the shared server folder data/updates/ (every visitor, read by
 * CTOImport.loadServer over http(s) only) and the files imported in this browser (IndexedDB). Precedence per day: a
 * server or local copy always replaces the built-in day; between server and local the newer generated_at wins, and
 * on a tie the server copy wins. Glossaries are merged key by key (newer file wins a key); the sources registry is
 * taken whole from the newest file. A file removed from the manifest stops showing on the next page load.
 */
(function () {
  "use strict";
  var me = document.currentScript || document.querySelector("script[data-rel][src*='replica.js']");
  var REL = me ? me.getAttribute("data-rel") || "" : "", PAGE = me ? me.getAttribute("data-page") || "" : "";
  var CUR = me ? me.getAttribute("data-cur") || "" : "", DATE = me ? me.getAttribute("data-date") || "" : "";
  var ADMIN_JS = !!(me && me.hasAttribute("data-admin-js"));
  var D = window.CTO_REPLICA || { labels: {}, briefs: [], dates: [], glossary: { entries: [] } }, L = D.labels;
  var BUILTIN = {}; D.briefs.forEach(function (b) { BUILTIN[b.date] = b; });

  // ------------------------------------------------------------------ helpers (Python parity)
  function truthy(v) { return !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && !v.length)); }
  function esc(s) { // html.escape(str(s or ""), quote=True)
    return (truthy(s) ? String(s) : "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  }
  function safeUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u : null; }
  function isDate(d) { return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z")); }
  function ymd(d) { var p = d.split("-"); return { y: +p[0], m: +p[1], d: +p[2], wd: (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + 6) % 7 }; }
  function heDate(d, withDay) {
    var x = ymd(d), s = x.d + " ב" + L.months[x.m - 1] + " " + x.y;
    return withDay === false ? s : "יום " + L.days[x.wd] + ", " + s;
  }
  function heMonth(d) { var x = ymd(d); return L.months[x.m - 1] + " " + x.y; }
  function shortDate(d) { if (isDate(d)) { var x = ymd(d); return x.d + "." + x.m + "." + x.y; } return esc(d || "—"); }
  function has(o, k) { return o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k); }
  function get(o, k, dflt) { return has(o, k) ? o[k] : dflt; }
  function dayHref(date) { return BUILTIN[date] ? REL + date + "/index.html" : REL + "day/index.html?d=" + date; }

  function counts(b) {
    var c = { action: 0, watch: 0, background: 0 };
    b.items.forEach(function (it) { var t = get(it, "tag", "background"); c[t] = (c[t] || 0) + 1; });
    return c;
  }
  function pill(tag) { var t = has(L.tags, tag) ? L.tags[tag] : L.tags.background; return '<span class="pill ' + t[1] + '">' + t[0] + "</span>"; }
  function heatBadge(it) {
    var level = 0;
    if (it.heat !== null && it.heat !== undefined) { level = Math.trunc(Number(it.heat)); if (isNaN(level)) return ""; }
    if (!has(L.heat, String(level))) return "";
    var h = L.heat[String(level)], word = h[0], flames = h[1];
    var tipId = "heat-tip-" + esc(get(it, "id", "")), momentum = it.momentum || "";
    var inner = '<strong class="heat-lvl">' + esc(word) + "</strong>" + (momentum ? " " + esc(momentum) : "");
    return '<span class="heat" data-heat="' + level + '"><button type="button" class="heat-btn" aria-label="רמת תאוצה: ' + esc(word) +
      '" aria-describedby="' + tipId + '" aria-expanded="false"><span class="heat-flames" aria-hidden="true">' + flames + "</span></button>" +
      '<span id="' + tipId + '" class="heat-tip" role="tooltip"><span class="heat-tip-body">' + inner + "</span></span></span> ";
  }
  function itemAnchors(b) {
    var out = {}, seen = {};
    (b.items || []).forEach(function (it, i) {
      var raw = it.id, slug = (raw === null || raw === undefined || raw === "") ? "" :
        String(raw).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      var base = slug ? "item-" + slug : "item-n" + (i + 1), a = base, k = 2;
      while (seen[a]) { a = base + "-" + k; k++; }
      seen[a] = 1; out[i] = a;
    });
    return out;
  }
  function shortText(s, limit) {
    limit = limit || L.share_max;
    s = (truthy(s) ? String(s) : "").replace(/\s+/g, " ").trim();
    if (s.length <= limit) return s;
    var cut = s.slice(0, limit), i = cut.lastIndexOf(" ");
    if (i >= 0) cut = cut.slice(0, i);
    return cut.replace(/[ ,;:–-]+$/, "") + "…";
  }
  function shareBtn(url, title, text, describedby) {
    var db = describedby ? ' aria-describedby="' + esc(describedby) + '"' : "";
    return '<button type="button" class="share-btn" data-share data-share-url="' + esc(url) + '" data-share-title="' + esc(title) +
      '" data-share-text="' + esc(text) + '"' + db + ">" + L.share_icon + "<span>שיתוף</span></button>";
  }

  // ------------------------------------------------------------------ glossary matcher (glossary_lib.Matcher)
  var LAT = /[A-Za-z0-9_]/, HEB = /[\u05D0-\u05EA]/, PREFIX = "בהולמשכ";
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&"); }
  function ciPat(a) {
    return Array.from(a).map(function (c) { var u = c.toUpperCase(), l = c.toLowerCase(); return u !== l ? "[" + reEsc(l) + reEsc(u) + "]" : reEsc(c); }).join("");
  }
  function Matcher(entries) {
    var cs = Object.create(null), ci = Object.create(null), alts = [];
    entries.forEach(function (e) {
      var al = Array.isArray(e.aliases) && e.aliases.length ? e.aliases.slice() : [e.term];
      if (al.indexOf(e.term) < 0) al.unshift(e.term);
      al.forEach(function (a) {
        a = String(a || "").trim(); if (!a) return;
        if (e.category === "concept" && a === a.toLowerCase() && /[a-z]/.test(a)) { if (ci[a]) return; ci[a] = e; alts.push([a, true]); }
        else { if (cs[a]) return; cs[a] = e; alts.push([a, false]); }
      });
    });
    alts.sort(function (x, y) { return y[0].length - x[0].length; });
    var rx = alts.length ? new RegExp(alts.map(function (x) { return x[1] ? ciPat(x[0]) : reEsc(x[0]); }).join("|"), "g") : null;
    function entry(tok) { return cs[tok] || ci[tok.toLowerCase()] || null; }
    function ok(t, s, e, hebrew) {
      var prev = s > 0 ? t[s - 1] : "", nxt = e < t.length ? t[e] : "", nxt2 = e + 1 < t.length ? t[e + 1] : "";
      if (hebrew) {
        if (nxt && (HEB.test(nxt) || LAT.test(nxt))) return false;
        var i = s;
        while (i > 0 && s - i < 2 && PREFIX.indexOf(t[i - 1]) >= 0) i--;
        var before = i > 0 ? t[i - 1] : "";
        return !(before && (HEB.test(before) || LAT.test(before)));
      }
      if (prev) {
        if (LAT.test(prev) || "./@#\\".indexOf(prev) >= 0) return false;
        if (prev === "-" && !(s >= 2 && HEB.test(t[s - 2]))) return false;
      }
      if (nxt) {
        if (LAT.test(nxt)) return false;
        if ("-./@".indexOf(nxt) >= 0 && nxt2 && LAT.test(nxt2)) return false;
      }
      return true;
    }
    this.find = function (text) {
      var out = [], pos = 0, m;
      if (!rx || !text) return out;
      for (;;) {
        rx.lastIndex = pos; m = rx.exec(text); if (!m) break;
        var s = m.index, e = s + m[0].length, ent = entry(m[0]);
        if (ent && ok(text, s, e, HEB.test(m[0][0]))) { out.push([s, e, ent]); pos = e; } else pos = s + 1;
      }
      return out;
    };
    var self = this;
    this.itemKeys = function (it) {
      var used = [];
      L.item_fields.forEach(function (f) {
        self.find(truthy(it[f]) ? String(it[f]) : "").forEach(function (x) { if (used.indexOf(x[2].key) < 0) used.push(x[2].key); });
      });
      return used;
    };
  }
  var GL = null, GLOSSARY = D.glossary;
  function glHtml(text, ctx) {
    text = truthy(text) ? String(text) : "";
    if (!ctx) return esc(text);
    var out = [], pos = 0;
    GL.find(text).forEach(function (x) {
      var s = x[0], e = x[1], ent = x[2];
      if (ctx.used.indexOf(ent.key) >= 0 || s < pos) return;
      ctx.used.push(ent.key); ctx.n++;
      var nid = "gl-" + ctx.anchor + "-" + ctx.n;
      var lead = /[^\s]{0,4}$/.exec(text.slice(pos, s))[0];
      var tail = /^[)\]}.,;:!?"'»״׳…%]*/.exec(text.slice(e))[0];
      var mark = /[\u0590-\u05FF]/.test(text[s]) ? "\u200f" : "\u200e";
      out.push(esc(text.slice(pos, s - lead.length)));
      out.push('<span class="gl-nb">' + esc(lead) + mark + '<button type="button" class="term" data-gl="' + esc(ent.key) + '" popovertarget="' + nid +
        '" popovertargetaction="show" interestfor="' + nid + '" aria-expanded="false">' + esc(text.slice(s, e)) + "</button>" +
        '<span class="gl-note" id="' + nid + '" popover="hint" role="tooltip"><b class="gl-t" dir="auto">' + esc(ent.term) + "</b> " +
        '<span class="gl-d">' + esc(ent.definition_he) + "</span></span>" + mark + esc(tail) + "</span>");
      pos = e + tail.length;
    });
    out.push(esc(text.slice(pos)));
    return out.join("");
  }

  // ------------------------------------------------------------------ brief (render_item / day_nav / render_brief)
  function renderItem(it, anchor, date) {
    var srcs = (it.sources || []).filter(function (s) { return s && truthy(s.url) && safeUrl(s.url); }).map(function (s) {
      return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label || s.url) + "</a>";
    }).join(" · ");
    var hid = "h-" + anchor;
    var share = date ? shareBtn("/" + date + "/#" + anchor, it.headline || "", shortText(it.summary), hid) : "";
    var g = { anchor: anchor, used: [], n: 0 };
    var parts = ['<article class="item" data-tag="' + esc(get(it, "tag", "background")) + '" id="' + esc(anchor) + '">',
      '<div class="item-head"><h3>' + pill(it.tag) + " " + heatBadge(it) + '<span class="headline" id="' + esc(hid) + '">' + glHtml(it.headline, g) + "</span></h3>" + share + "</div>",
      '<p class="summary">' + glHtml(it.summary, g) + "</p>"];
    if (truthy(it.why_it_matters)) parts.push('<p class="why"><strong>למה זה חשוב לנו:</strong> ' + glHtml(it.why_it_matters, g) + "</p>");
    if (truthy(it.action)) parts.push('<p class="todo"><strong>מה כדאי לעשות:</strong> ' + glHtml(it.action, g) + "</p>");
    if (srcs) parts.push('<p class="sources"><strong>מקורות:</strong> ' + srcs + "</p>");
    parts.push("</article>");
    return parts.join("\n");
  }
  function dayNav(older, newer) {
    function link(x, cls, txt) {
      if (!x) return '<span class="dn ' + cls + ' off" aria-disabled="true">' + txt + "</span>";
      return '<a class="dn ' + cls + '" href="' + dayHref(x.date) + '" rel="' + (cls === "older" ? "prev" : "next") + '">' + txt +
        '<span class="dd">' + heDate(x.date, false) + "</span></a>";
    }
    return '<nav class="daynav" aria-label="ניווט בין סקירות">' + link(newer, "newer", "→ הסקירה הבאה (חדשה יותר)") +
      link(older, "older", "הסקירה הקודמת (ישנה יותר) ←") + "</nav>";
  }
  function renderBrief(b, older, newer) {
    var sections = {}, order = [], anchors = itemAnchors(b);
    b.items.forEach(function (it, n) {
      var s = get(it, "section", "כללי");
      if (!has(sections, s)) { sections[s] = []; order.push(s); }
      sections[s].push([anchors[n], it]);
    });
    var c = counts(b), date = b.date, nav = dayNav(older, newer);
    var out = ['<header class="brief-head"><p class="kicker">' + heDate(date) + "</p>", "<h1>" + esc(b.title) + "</h1>",
      '<p class="stats">' + pill("action") + " " + c.action + " &nbsp; " + pill("watch") + " " + c.watch + " &nbsp; " + pill("background") + " " + c.background +
      ' &nbsp;·&nbsp; <a class="dl" href="' + REL + date + '/brief.json" download="tech-brief-' + date + '.json">הורדת JSON</a>' +
      ' &nbsp;·&nbsp; <button type="button" class="print-btn" data-print>הדפסה</button>' +
      ' &nbsp;·&nbsp; <button type="button" class="print-btn" data-save-pdf data-date="' + esc(date) + '">שמירה כ-PDF</button></p>' + nav + "</header>"];
    if (truthy(b.exec_summary)) {
      out.push('<section class="mgmt" id="mgmt"><h2>להנהלה – בשורה התחתונה</h2>');
      b.exec_summary.forEach(function (p) { out.push("<p>" + esc(p) + "</p>"); });
      out.push("</section>");
    }
    out.push('<nav class="toc" aria-label="ניווט בסקירה">' + order.map(function (s, i) { return '<a href="#sec-' + i + '">' + esc(s) + "</a>"; }).join("") +
      '</nav><div class="filters" role="group" aria-label="סינון לפי תגית"><button class="on" data-f="all">הכל</button><button data-f="action">דורש פעולה</button>' +
      '<button data-f="watch">למעקב</button><button data-f="background">רקע</button></div>');
    order.forEach(function (s, i) {
      out.push('<section class="topic" id="sec-' + i + '"><h2>' + esc(s) + "</h2>");
      sections[s].forEach(function (x) { out.push(renderItem(x[1], x[0], date)); });
      out.push("</section>");
    });
    if (truthy(b.watchlist)) {
      out.push('<section class="watchlist" id="watchlist"><h2>שווה מעקב</h2><ul>');
      b.watchlist.forEach(function (w, i) {
        var n = i + 1, wid = "watch-" + n, u = truthy(w.url) && safeUrl(w.url);
        var link = u ? ' <a href="' + esc(w.url) + '" target="_blank" rel="noopener noreferrer">למקור</a>' : "";
        var share = shareBtn("/" + date + "/#" + wid, "שווה מעקב · " + heDate(date, false), shortText(w.text), wid + "-t");
        out.push('<li id="' + wid + '"><span id="' + wid + '-t">' + esc(w.text) + "</span>" + link + " " + share + "</li>");
      });
      out.push("</ul></section>");
    }
    out.push(nav.replace('class="daynav"', 'class="daynav bottom"'));
    var jumps = (truthy(b.exec_summary) ? [["mgmt", "להנהלה – בשורה התחתונה"]] : []).concat(order.map(function (s, i) { return ["sec-" + i, s]; }))
      .concat(truthy(b.watchlist) ? [["watchlist", "שווה מעקב"]] : []);
    out.push('<div class="read-progress" aria-hidden="true"></div><button type="button" class="jump-btn" data-jump-btn popovertarget="jump-menu" title="קפיצה לפרק בסקירה">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span>פרקים</span></button>' +
      '<nav id="jump-menu" class="jump-menu" popover aria-label="פרקים בסקירה"><p class="jump-h">קפיצה לפרק</p><ul>' +
      jumps.map(function (j) { return '<li><a href="#' + j[0] + '">' + esc(j[1]) + "</a></li>"; }).join("") + "</ul></nav>");
    return out.join("\n");
  }

  // ------------------------------------------------------------------ archive / actions
  function archiveRow(b, current) {
    var c = counts(b), cur = b.date === current ? ' aria-current="page" class="cur"' : "";
    return "<li" + cur + ' data-date="' + esc(b.date) + '"><a href="' + dayHref(b.date) + '"><span class="d">' + heDate(b.date) + "</span>" +
      '<span class="n">' + b.items.length + " ידיעות · " + c.action + " דורשות פעולה</span></a></li>";
  }
  function archiveList(briefs, current) { return '<ul class="archive">' + briefs.map(function (b) { return archiveRow(b, current); }).join("") + "</ul>"; }
  function archiveGrouped(briefs) {
    var groups = {}, order = [];
    briefs.forEach(function (b) { var m = b.date.slice(0, 7); if (!groups[m]) { groups[m] = []; order.push(m); } groups[m].push(b); });
    return order.map(function (m) {
      var n = groups[m].length;
      return '<section class="agroup" data-month="' + m + '"><h2>' + heMonth(m + "-01") + ' <span class="gc">(' + n + " " + (n !== 1 ? "סקירות" : "סקירה") + ")</span></h2>" +
        '<ul class="archive">' + groups[m].map(function (b) { return archiveRow(b); }).join("") + "</ul></section>";
    }).join("");
  }
  function searchIndex(briefs) {
    return briefs.map(function (b) {
      var a = itemAnchors(b);
      return { date: b.date, he: heDate(b.date), title: b.title, items: b.items.map(function (it, n) {
        return { id: it.id === undefined ? null : it.id, a: a[n], h: it.headline || "", s: it.summary || "", tag: it.tag || "background" }; }) };
    });
  }
  function renderArchive(briefs, indexUrl) {
    return '<header class="brief-head"><h1>ארכיון הסקירות</h1><p class="kicker">כל הסקירות היומיות, מהחדשה לישנה (' + briefs.length + " סקירות).</p></header>" +
      '<div class="asearch" role="search"><label class="fl q" for="aq"><span>חיפוש בארכיון</span><input id="aq" type="search" autocomplete="off" placeholder="תאריך, כותרת, ידיעה או תקציר"></label>' +
      '<span id="acnt" class="acnt" aria-live="polite"></span></div><div id="archive-groups" data-index="' + esc(indexUrl) + '">' + archiveGrouped(briefs) + "</div>" +
      '<p class="empty hidden" id="aempty">לא נמצאו סקירות שמתאימות לחיפוש.</p>';
  }
  function renderActions(briefs) {
    var groups = [];
    briefs.forEach(function (b) { var rows = b.items.filter(function (it) { return it.tag === "action"; }); if (rows.length) groups.push([b, rows]); });
    var total = groups.reduce(function (n, g) { return n + g[1].length; }, 0);
    var head = '<header class="brief-head"><p class="kicker">מעקב רוחבי מכל הסקירות</p><h1>דורש פעולה</h1><p class="stats">' + pill("action") + " " + total +
      " פריטים פתוחים מתוך " + groups.length + " " + (groups.length !== 1 ? "סקירות" : "סקירה") + " · מהחדש לישן. " +
      "זו תצוגה מצטברת של כל הידיעות שתויגו «דורש פעולה» בארכיון, ללא סימון ביצוע.</p></header>";
    if (!total) return head + '<p class="empty">אין כרגע פריטים שדורשים פעולה בארכיון.</p>';
    var out = [head];
    groups.forEach(function (g) {
      var b = g[0], x = ymd(b.date), short = x.d + "." + x.m + "." + x.y, anchors = itemAnchors(b);
      out.push('<section class="agroup actions-day"><h2><a href="' + dayHref(b.date) + '">' + heDate(b.date) + '</a> <span class="gc">(' + g[1].length + ')</span></h2><ol class="actions">');
      g[1].forEach(function (it) {
        var url = dayHref(b.date) + "#" + esc(anchors[b.items.indexOf(it)]);
        var sec = truthy(it.section) ? " · " + esc(it.section) : "";
        var todo = truthy(it.action) ? '<p class="todo"><strong>מה כדאי לעשות:</strong> ' + esc(it.action) + "</p>" : "";
        out.push('<li class="arow"><p class="ameta"><span class="ad">' + short + "</span>" + sec + "</p>" + '<h3><a href="' + url + '">' + esc(it.headline) + "</a></h3>" + todo +
          '<p class="ago"><a href="' + url + '">לידיעה המלאה בסקירה ←</a></p></li>');
      });
      out.push("</ol></section>");
    });
    return out.join("\n");
  }

  // ------------------------------------------------------------------ glossary page (render_glossary)
  function glNorm(s) {
    return (truthy(s) ? String(s) : "").replace(/[\u0591-\u05C7]/g, "").replace(/\u05f4/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
  }
  function renderGlossary(briefs) {
    var occ = {}, latest = briefs[0] || null, latestKeys = {};
    briefs.forEach(function (b) {
      var a = itemAnchors(b);
      b.items.forEach(function (it, n) { GL.itemKeys(it).forEach(function (k) { (occ[k] = occ[k] || []).push([b, a[n], it]); }); });
    });
    if (latest) latest.items.forEach(function (it) { GL.itemKeys(it).forEach(function (k) { latestKeys[k] = 1; }); });
    var entries = GLOSSARY.entries.filter(function (e) { return has(occ, e.key); });
    entries.sort(function (a, b) { var x = a.term.toLowerCase(), y = b.term.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
    var byCat = {}; entries.forEach(function (e) { (byCat[e.category] = byCat[e.category] || []).push(e); });
    var nLatest = entries.filter(function (e) { return latestKeys[e.key]; }).length;
    var out = ['<header class="brief-head"><p class="kicker">הסברים קצרים למושגים, לחברות ולמוצרים שמופיעים בסקירות</p><h1>מילון מושגים</h1>' +
      '<p class="stats">' + entries.length + " מושגים מתוך הסקירות" + (latest ? " · " + nLatest + " מופיעים בעדכון האחרון" : "") +
      ' &nbsp;·&nbsp; <a class="dl" href="' + REL + 'glossary.json" download="cto-review-glossary.json">הורדת JSON</a></p></header>'];
    if (latest && nLatest) {
      out.push('<section class="gl-latest" aria-labelledby="gl-latest-h"><h2 id="gl-latest-h">מופיעים בעדכון האחרון</h2><p class="kicker"><a href="' + dayHref(latest.date) + '">' +
        heDate(latest.date) + '</a></p><ul class="gl-chips">' + entries.filter(function (e) { return latestKeys[e.key]; }).map(function (e) {
          return '<li><a href="#g-' + esc(e.key) + '" dir="auto">' + esc(e.term) + "</a></li>"; }).join("") + "</ul></section>");
    }
    var cats = L.cat_order.filter(function (c) { return byCat[c]; });
    out.push('<div class="gl-tools" role="search" aria-label="חיפוש במילון"><label class="fl q" for="gq"><span>חיפוש במילון</span>' +
      '<input id="gq" type="search" autocomplete="off" placeholder="מושג, חברה, מוצר או מילה מההסבר"></label><div class="gl-cats" role="group" aria-label="סינון לפי סוג">' +
      '<button type="button" data-gc="all" aria-pressed="true">הכל</button>' + cats.map(function (c) { return '<button type="button" data-gc="' + c + '" aria-pressed="false">' + L.cat_he[c] + "</button>"; }).join("") +
      "</div>" + (latest ? '<label class="gl-only"><input type="checkbox" id="gl-latest-only"> רק מושגים מהעדכון האחרון</label>' : "") + '<span id="gcnt" class="acnt" aria-live="polite"></span></div>');
    out.push('<div id="gl-list">');
    cats.forEach(function (c) {
      out.push('<section class="gl-group" data-cat="' + c + '" aria-labelledby="gg-' + c + '"><h2 id="gg-' + c + '">' + L.cat_he[c] + ' <span class="gc">(' + byCat[c].length + ")</span></h2>");
      byCat[c].forEach(function (e) {
        var rows = occ[e.key], isLatest = !!latestKeys[e.key];
        var al = Array.isArray(e.aliases) ? e.aliases.slice() : [e.term]; if (al.indexOf(e.term) < 0) al.unshift(e.term);
        var q = glNorm([e.term].concat(al).concat([e.definition_he]).join(" "));
        function li(r) { var x = ymd(r[0].date); return '<li><a href="' + dayHref(r[0].date) + "#" + esc(r[1]) + '"><span class="ad">' + x.d + "." + x.m + "." + x.y + "</span> " + esc(r[2].headline) + "</a></li>"; }
        var occHtml = rows.slice(0, L.gl_show_occ).map(li).join(""), more = "";
        if (rows.length > L.gl_show_occ) more = '<details class="gl-more"><summary>ועוד ' + (rows.length - L.gl_show_occ) + ' ידיעות</summary><ul class="gl-occ">' + rows.slice(L.gl_show_occ).map(li).join("") + "</ul></details>";
        var link = truthy(e.url) && safeUrl(e.url) ? '<p class="gl-link"><a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">לאתר הרשמי ↗</a></p>' : "";
        var badge = isLatest ? '<span class="gl-badge">בעדכון האחרון</span>' : "", word = rows.length === 1 ? "ידיעה אחת" : rows.length + " ידיעות";
        out.push('<article class="gl-entry" id="g-' + esc(e.key) + '" data-cat="' + c + '" data-latest="' + (isLatest ? 1 : 0) + '" data-q="' + esc(q) + '"><h3><span class="gl-term" dir="auto">' +
          esc(e.term) + "</span>" + badge + '</h3><p class="gl-def">' + esc(e.definition_he) + "</p>" + link + '<p class="gl-occ-h">מופיע ב' + word + ':</p><ul class="gl-occ">' + occHtml + "</ul>" + more + "</article>");
      });
      out.push("</section>");
    });
    out.push('</div><p class="empty hidden" id="gempty">לא נמצאו מושגים שמתאימים לחיפוש.</p>');
    if (!entries.length) out.push('<p class="empty">עדיין אין מושגים מהמילון בסקירות.</p>');
    return out.join("\n");
  }

  // ------------------------------------------------------------------ sources mirror (build_admin / render_source)
  function counter(list) { var m = new Map(); list.forEach(function (v) { var k = String(v); m.set(k, (m.get(k) || 0) + 1); }); return m; }
  function cget(m, k) { return m.get(String(k)) || 0; }
  function lab(map, v) { return has(map, v) ? map[v] : v; }
  function alink(url, text, cls) {
    if (!safeUrl(url)) return esc(text || url);
    return "<a" + (cls ? ' class="' + cls + '"' : "") + ' href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(text || url) + "</a>";
  }
  function renderSource(s) {
    var topics = s.topics || [], rel = s.reliability || 0;
    var q = ["name", "id", "x_handle", "best_for", "url"].map(function (k) { return truthy(s[k]) ? String(s[k]) : ""; }).join(" ").toLowerCase();
    var attrs = 'data-q="' + esc(q) + '" data-topic="' + esc(topics.join(" ")) + '" data-rel="' + esc(rel || "0") + '" data-status="' + esc(s.status) + '" data-type="' + esc(s.type) +
      '" data-lang="' + esc(s.language) + '" data-access="' + esc(s.access) + '" data-name="' + esc((s.name || "").toLowerCase()) + '" data-used="' + esc(s.times_used || "0") + '" data-added="' + esc(s.added) + '"';
    var chips = ['<span class="rel r' + esc(rel || "0") + '" title="' + esc(get(L.rel, String(rel), "")) + '">אמינות ' + esc(rel || "0") + "</span>",
      '<span class="st st-' + esc(s.status) + '">' + esc(lab(L.status, s.status)) + "</span>", '<span class="chip">' + esc(lab(L.type, s.type)) + "</span>"];
    topics.forEach(function (t) { chips.push('<span class="chip tp">' + esc(lab(L.topic, t)) + "</span>"); });
    if (s.language === "he") chips.push('<span class="chip he">עברית</span>');
    if (truthy(s.access) && s.access !== "free") chips.push('<span class="chip acc">' + esc(lab(L.access, s.access)) + "</span>");
    var rows = [["סוג", lab(L.type, s.type)], ["נושאים", topics.map(function (t) { return lab(L.topic, t); }).join(", ")], ["אמינות", rel + " – " + get(L.rel, String(rel), "")],
      ["נימוק לדירוג", s.reliability_rationale], ["הטיות", s.bias_notes], ["סטטוס", lab(L.status, s.status)], ["שפה", lab(L.lang, s.language)], ["גישה", lab(L.access, s.access)]];
    var html = rows.filter(function (r) { return truthy(r[1]); }).map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>"; });
    if (truthy(s.x_handle)) { var h = String(s.x_handle).replace(/^@+/, ""); html.push('<dt>חשבון X</dt><dd class="ltr">' + alink("https://x.com/" + h, "@" + h) + "</dd>"); }
    if (truthy(s.feed_url)) html.push('<dt>פיד</dt><dd class="ltr">' + alink(s.feed_url) + "</dd>");
    html.push('<dt>כתובת</dt><dd class="ltr">' + alink(s.url) + "</dd>");
    var extra = [["תדירות", lab(L.freq, s.frequency)], ["קבלה", s.delivery], ["מנוי מאז", truthy(s.subscribed) ? shortDate(s.subscribed) : null],
      ["נוסף דרך", truthy(s.discovered_via) ? get(L.via, s.discovered_via, "אחר") : null], ["עדיפות", lab(L.prio, s.priority)], ["הערות", s.notes],
      ["סימני תאוצה (פנימי)", s.momentum], ["בדיקת תאוצה אחרונה", truthy(s.last_momentum_check) ? shortDate(s.last_momentum_check) : null]];
    extra.forEach(function (r) { if (truthy(r[1])) html.push("<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>"); });
    html.push("<dt>נוסף / אומת</dt><dd>" + shortDate(s.added) + " / " + shortDate(s.last_verified) + "</dd>");
    html.push("<dt>צוטט בסקירות</dt><dd>" + esc(s.times_used || "0") + " פעמים</dd>");
    var handle = truthy(s.x_handle) ? ' <span class="hdl" dir="ltr">@' + esc(String(s.x_handle).replace(/^@+/, "")) + "</span>" : "";
    return '<li class="src" ' + attrs + '><details><summary><span class="sn">' + esc(s.name) + "</span>" + handle + '<span class="chips">' + chips.join("") + "</span>" +
      '<span class="bf">' + esc(s.best_for) + '</span></summary><div class="sd"><p class="open">' + alink(s.url, "פתיחת המקור ↗", "go") + "</p><dl>" + html.join("") + "</dl></div></details></li>";
  }
  function optList(name, label, mapping, m) { // mapping: object, or [[key, label]] when the order matters (numeric keys)
    var pairs = Array.isArray(mapping) ? mapping : Object.keys(mapping).map(function (k) { return [k, mapping[k]]; });
    var opts = pairs.filter(function (p) { return cget(m, p[0]); }).map(function (p) { return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + " (" + cget(m, p[0]) + ")</option>"; }).join("");
    return '<label class="fl"><span>' + label + '</span><select data-k="' + name + '"><option value="">הכל</option>' + opts + "</select></label>";
  }
  function renderAdmin(reg, latestDate) {
    var S = reg.sources || [];
    var cRel = counter(S.map(function (s) { return s.reliability; })), cSt = counter(S.map(function (s) { return s.status; })),
      cLang = counter(S.map(function (s) { return s.language; })), cAcc = counter(S.map(function (s) { return s.access; })),
      cType = counter(S.map(function (s) { return s.type; })), cTop = counter([].concat.apply([], S.map(function (s) { return s.topics || []; })));
    function stat(n, label, cls) { return '<div class="stat ' + (cls || "") + '"><b>' + n + "</b><span>" + label + "</span></div>"; }
    var top = Array.from(cTop.entries()).sort(function (a, b) { return b[1] - a[1]; });
    var summary = '<section class="summary" aria-label="סיכום המאגר"><div class="srow">' + stat(S.length, "מקורות במאגר", "big") + stat(cget(cLang, "he"), "מקורות בעברית") +
      Object.keys(L.status).map(function (k) { return stat(cget(cSt, k), L.status[k], "st-" + k); }).join("") + '</div><div class="srow"><span class="sl">לפי אמינות</span>' +
      [5, 4, 3, 2].map(function (r) { return stat(cget(cRel, r), "אמינות " + r, "r" + r); }).join("") + '</div><div class="srow"><span class="sl">לפי נושא</span>' +
      top.map(function (t) { return stat(t[1], esc(lab(L.topic, t[0]))); }).join("") + "</div></section>";
    var relMap = [5, 4, 3, 2, 1].map(function (r) { return [String(r), r + " – " + L.rel[String(r)]]; });
    var filters = '<section class="afilters" aria-label="חיפוש וסינון"><label class="fl q"><span>חיפוש</span><input type="search" id="q" placeholder="שם, מזהה, חשבון X, שימוש או כתובת" autocomplete="off"></label>' +
      optList("topic", "נושא", L.topic, cTop) + optList("rel", "אמינות", relMap, cRel) + optList("status", "סטטוס", L.status, cSt) + optList("type", "סוג", L.type, cType) +
      optList("lang", "שפה", L.lang, cLang) + optList("access", "גישה", L.access, cAcc) +
      '<label class="fl"><span>מיון</span><select id="sort"><option value="rel">אמינות (גבוה לנמוך)</option><option value="name">שם (א–ת / A–Z)</option>' +
      '<option value="used">הכי מצוטטים</option><option value="added">נוספו לאחרונה</option></select></label><div class="fbar"><span id="cnt" aria-live="polite">מוצגים ' + S.length + " מתוך " + S.length +
      '</span><button type="button" id="reset">איפוס סינון</button><button type="button" id="expand">פתיחת הכל</button></div></section>';
    var order = S.slice().sort(function (a, b) {
      var d = (b.reliability || 0) - (a.reliability || 0); if (d) return d;
      var x = (a.name || "").toLowerCase(), y = (b.name || "").toLowerCase(); return x < y ? -1 : x > y ? 1 : 0;
    });
    var items = '<ol class="srcs" id="srcs">' + order.map(renderSource).join("") + "</ol>";
    var log = '<section class="changelog"><h2>יומן שינויים</h2><ul>' + (reg.changelog || []).map(function (c) {
      return '<li><span class="d">' + shortDate(c.date) + "</span> " + esc(c.change) + "</li>"; }).join("") + "</ul></section>";
    var head = '<header class="brief-head"><p class="kicker">אזור ניהול · רפליקה</p><h1>אזור ניהול · מאגר המקורות</h1><p class="stats">עודכן לאחרונה: ' +
      (isDate(reg.updated) ? heDate(reg.updated) : esc(reg.updated)) + " · גרסה " + esc(reg.version) + ' · <a class="dl" href="sources.json" download="cto-review-sources.json">הורדת JSON</a> · ' +
      (latestDate ? '<a class="dl" href="export.json" download="cto-review-export-' + latestDate + '.json" title="כל הסקירות, מילון המושגים ומאגר המקורות בקובץ אחד, לטעינה באתר הרפליקה">ייצוא מלא (JSON)</a> · ' : "") +
      '<a class="dl" href="#log">יומן שינויים</a> · <a class="dl" href="import/index.html">טעינת עדכון</a></p></header>';
    return head + summary + filters + items + '<p class="empty hidden" id="empty">לא נמצאו מקורות שמתאימים לסינון.</p><div id="log"></div>' + log;
  }

  // ------------------------------------------------------------------ data merge
  var merged = null;
  function ts(x) { var t = Date.parse(x || ""); return isNaN(t) ? 0 : t; }
  function emptyServer() { return { ok: false, files: [], errors: [] }; }
  function loadMerged() {
    var I = window.CTOImport;
    var base = { briefs: D.briefs, glossary: D.glossary, sources: window.CTO_REPLICA_SOURCES || null,
                 local: { briefs: [], glossary: null, sources: null }, server: emptyServer(), from: {} };
    if (!I) return Promise.resolve(base);
    I.setBaseline({
      brief: function (d) { return BUILTIN[d] ? { brief: BUILTIN[d], generated_at: D.generated_at } : null; },
      glossary: function () { return { data: D.glossary, generated_at: D.generated_at }; },
      sources: function () { return window.CTO_REPLICA_SOURCES ? { data: window.CTO_REPLICA_SOURCES, generated_at: D.generated_at } : null; }
    });
    var localP = window.indexedDB ? Promise.all([I.getBriefs(), I.getMeta("glossary"), I.getMeta("sources")]).catch(function () { return [[], null, null]; })
      : Promise.resolve([[], null, null]);
    var srvP = I.loadServer ? I.loadServer(REL).catch(emptyServer) : Promise.resolve(emptyServer());
    return Promise.all([localP, srvP]).then(function (x) { return combine(base, x[0], x[1] || emptyServer(), I); }, function () { return base; });
  }
  function combine(base, r, srv, I) {
    var locB = (r[0] || []).filter(function (rec) { return rec && rec.brief && isDate(rec.date); });
    var pick = {}; // date -> {brief, stamp, rank}; rank 2 = server, 1 = this browser (wins only when strictly newer)
    function offer(b, stamp, rank) {
      if (!b || !isDate(b.date)) return;
      var c = pick[b.date];
      if (!c || ts(stamp) > ts(c.stamp) || (ts(stamp) === ts(c.stamp) && rank > c.rank)) pick[b.date] = { brief: b, stamp: stamp, rank: rank };
    }
    locB.forEach(function (rec) { offer(rec.brief, rec.generated_at, 1); });
    srv.files.forEach(function (f) { (f.briefs || []).forEach(function (b) { offer(b, f.stamp, 2); }); });
    var map = {}; D.briefs.forEach(function (b) { map[b.date] = b; base.from[b.date] = "built"; });
    Object.keys(pick).forEach(function (d) { map[d] = pick[d].brief; base.from[d] = pick[d].rank === 2 ? "server" : "local"; });
    base.briefs = Object.keys(map).sort().reverse().map(function (k) { return map[k]; });
    // glossary: built-in, then every file glossary from oldest to newest (server after local on a tie), merged key by key
    var gl = [];
    if (r[1] && r[1].data) gl.push({ g: r[1].data, stamp: r[1].generated_at, rank: 1 });
    srv.files.forEach(function (f) { if (f.glossary) gl.push({ g: f.glossary, stamp: f.stamp, rank: 2 }); });
    gl.sort(function (a, b) { return (ts(a.stamp) - ts(b.stamp)) || (a.rank - b.rank); });
    var g = D.glossary;
    gl.forEach(function (x) { g = I.mergeGlossary(g, x.g, true).data; });
    base.glossary = g;
    // sources registry: the newest file replaces it whole (server wins a tie)
    var src = null;
    if (r[2] && r[2].data) src = { data: r[2].data, stamp: r[2].generated_at, rank: 1 };
    srv.files.forEach(function (f) {
      if (f.sources && (!src || ts(f.stamp) > ts(src.stamp) || (ts(f.stamp) === ts(src.stamp) && 2 > src.rank))) src = { data: f.sources, stamp: f.stamp, rank: 2 };
    });
    if (src) base.sources = src.data;
    base.local = { briefs: locB, glossary: r[1] || null, sources: r[2] || null };
    base.server = srv;
    return base;
  }
  function hasLocal(m) { return !!(m.local.briefs.length || m.local.glossary || m.local.sources || (m.server && m.server.files.length)); }

  // ------------------------------------------------------------------ page rendering
  function $(sel) { return document.querySelector(sel); }
  function setAside(html) { var a = $(".layout > aside.side"); if (a) a.innerHTML = "<h2>ארכיון</h2>" + html; }
  function setNav(key) { // "~home" | "~archive" on dated pages (visual only, like build.py)
    var links = document.querySelectorAll(".topnav a");
    links.forEach(function (a) { if (a.getAttribute("aria-current") !== "page") a.classList.remove("cur"); });
    var i = key === "home" ? 0 : 2; if (links[i] && !links[i].getAttribute("aria-current")) links[i].classList.add("cur");
  }
  function showDay(date, isView) {
    var list = merged.briefs, i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].date === date) { i = k; break; }
    var main = $("#main");
    if (i < 0) {
      main.innerHTML = '<header class="brief-head"><h1>הסקירה לא נמצאה</h1><p class="kicker">אין באתר הזה סקירה לתאריך ' + (isDate(date) ? heDate(date) : esc(date)) +
        '. אפשר לטעון אותה בעמוד <a href="' + REL + 'admin/import/index.html">טעינת עדכון</a>, או לחזור ל<a href="' + REL + 'archive/index.html">ארכיון</a>.</p></header>';
      document.title = "הסקירה לא נמצאה | " + L.site; return;
    }
    var b = list[i];
    main.innerHTML = renderBrief(b, list[i + 1] || null, list[i - 1] || null);
    setAside(archiveList(list, date));
    document.title = b.title + " | " + L.site + " | CTO-Review-" + b.date;
    setNav(i === 0 ? "home" : "archive");
  }
  var blobUrls = [];
  function blobUrl(text) { var u = URL.createObjectURL(new Blob([text], { type: "application/json" })); blobUrls.push(u); return u; }

  function render() {
    var m = merged, local = hasLocal(m), main = $("#main");
    if (!main) return;
    if (PAGE === "dayview") { var d = new URLSearchParams(location.search).get("d") || ""; showDay(d, true); return; }
    if (PAGE === "archive") { // always: the merged index also makes search work from file://
      main.innerHTML = renderArchive(m.briefs, blobUrl(JSON.stringify(searchIndex(m.briefs))));
      return;
    }
    if (PAGE === "import") { renderStatus(); return; }
    if (!local) return; // nothing imported: the static page already shows the built-in data
    if (PAGE === "home" && m.briefs.length) {
      var b = m.briefs[0];
      main.innerHTML = '<p class="latest-badge">הסקירה האחרונה</p>' + renderBrief(b, m.briefs[1] || null, null);
      setAside(archiveList(m.briefs, b.date));
      document.title = L.site + " – " + L.tagline + " | CTO-Review-" + b.date;
    } else if (PAGE === "day") showDay(DATE, false);
    else if (PAGE === "actions") main.innerHTML = renderActions(m.briefs);
    else if (PAGE === "glossary") main.innerHTML = renderGlossary(m.briefs);
    else if (PAGE === "admin" && m.sources) main.innerHTML = renderAdmin(m.sources, m.briefs.length ? m.briefs[0].date : null);
  }

  function renderStatus() {
    var box = document.getElementById("replica-status"); if (!box) return;
    var m = merged, latest = m.briefs[0], dl = [], li = function (t) { return "<li>" + t + "</li>"; };
    dl.push(li("הסקירה שמוצגת בעמוד הבית: " + (latest ? '<a href="' + dayHref(latest.date) + '">' + heDate(latest.date) + "</a>" : "אין")));
    dl.push(li("סקירות שנבנו עם האתר: " + D.briefs.length + (D.briefs.length ? " (" + heDate(D.briefs[D.briefs.length - 1].date, false) + " עד " + heDate(D.briefs[0].date, false) + ")" : "")));
    var loc = m.local.briefs.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    dl.push(li("סקירות שנטענו לדפדפן הזה: " + (loc.length ? loc.length + " – " + loc.map(function (r) {
      return '<a href="' + dayHref(r.date) + '">' + heDate(r.date, false) + "</a>" + (m.from[r.date] === "server" ? " (מוצגת גרסת השרת)" : BUILTIN[r.date] ? " (מחליפה את הגרסה שנבנתה)" : ""); }).join(", ") : "אין")));
    var sv = m.server || { files: [] }, svDates = [];
    sv.files.forEach(function (f) { (f.briefs || []).forEach(function (b) { if (svDates.indexOf(b.date) < 0) svDates.push(b.date); }); });
    svDates.sort().reverse();
    dl.push(li("תיקיית העדכונים בשרת (<span dir=\"ltr\">data/updates</span>, לכל המשתמשים): " + (sv.offline ? "לא נקראת כשהאתר נפתח מהדיסק (file://)"
      : !sv.ok ? "לא נמצא קובץ manifest.json בשרת" : sv.files.length + (sv.files.length === 1 ? " קובץ" : " קבצים") +
      (svDates.length ? " – " + svDates.map(function (d) { return '<a href="' + dayHref(d) + '">' + heDate(d, false) + "</a>" + (m.from[d] === "server" ? "" : " (מוצגת גרסה אחרת)"); }).join(", ") : ""))));
    if (sv.errors && sv.errors.length) dl.push(li("קבצים שנדחו בתיקיית העדכונים: " + sv.errors.map(esc).join(" ")));
    var anyFileGl = m.local.glossary || sv.files.some(function (f) { return f.glossary; });
    var anyFileSrc = m.local.sources || sv.files.some(function (f) { return f.sources; });
    dl.push(li("מילון מושגים: " + m.glossary.entries.length + " ערכים" + (anyFileGl ? " (כולל קבצים שנטענו)" : " (כפי שנבנה עם האתר)")));
    dl.push(li("מאגר מקורות: " + (m.sources ? m.sources.sources.length + " מקורות" + (anyFileSrc ? " (מקובץ שנטען)" : " (כפי שנבנה עם האתר)") : "לא נבנה עם האתר")));
    box.innerHTML = "<ul>" + dl.join("") + "</ul>";
  }

  // downloads on a.dl[download]: serve the merged data as a blob (no server needed, also from file://)
  function exportMerged() { return { briefs: merged.briefs.slice(), glossary: merged.glossary, sources: merged.sources, origin: "replica" }; }
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a.dl[download]"); if (!a || !merged) return;
    var name = a.getAttribute("download"), href = a.getAttribute("href") || "", text = null, mm;
    if ((mm = /^tech-brief-(\d{4}-\d{2}-\d{2})\.json$/.exec(name))) {
      var b = merged.briefs.filter(function (x) { return x.date === mm[1]; })[0]; if (b) text = JSON.stringify(b, null, 2);
    } else if (/glossary\.json$/.test(href)) text = JSON.stringify(merged.glossary, null, 2);
    else if (/sources\.json$/.test(href) && merged.sources) text = JSON.stringify(merged.sources, null, 2);
    else if (/export\.json$/.test(href) && window.CTOImport) { var r = window.CTOImport.exportData(merged.briefs, merged.glossary, merged.sources, "replica"); text = r.json; name = r.name; }
    if (text === null) return;
    ev.preventDefault();
    var t = document.createElement("a"); t.href = blobUrl(text); t.download = name; document.body.appendChild(t); t.click(); t.remove();
  }, true);

  function loadScript(src) {
    return new Promise(function (res) { var s = document.createElement("script"); s.src = src; s.onload = s.onerror = function () { res(); }; document.body.appendChild(s); });
  }
  function retarget() { // the item anchor did not exist at load time: navigate to it again so :target and scrolling apply
    var h = location.hash;
    if (!h || h.indexOf("=") >= 0 || (PAGE !== "day" && PAGE !== "dayview" && PAGE !== "home")) return;
    if (document.getElementById(decodeURIComponent(h.slice(1)))) { history.replaceState(null, "", location.pathname + location.search); location.hash = h; }
  }
  function wireImport() {
    var root = document.querySelector("[data-import-root][data-import-manual]");
    if (!root || !window.CTOImport) return;
    window.CTOImport.wire(root, {
      exportData: function () { return exportMerged(); },
      onDone: function () { loadMerged().then(function (m) { merged = m; GLOSSARY = m.glossary; GL = new Matcher(GLOSSARY.entries); renderStatus(); }); }
    });
  }

  loadMerged().then(function (m) {
    merged = m; GLOSSARY = m.glossary; GL = new Matcher(GLOSSARY.entries || []);
    try { render(); } catch (e) { if (window.console) console.error("replica render failed", e); }
    wireImport();
    return loadScript(REL + "assets/app.js").then(function () { return ADMIN_JS ? loadScript(REL + "assets/admin.js") : null; });
  }).then(retarget);

  // exposed for tests (pure string renderers; no DOM access)
  window.CTOReplica = { renderBrief: renderBrief, renderItem: renderItem, archiveList: archiveList, archiveGrouped: archiveGrouped, renderActions: renderActions,
    renderGlossary: renderGlossary, renderAdmin: renderAdmin, renderArchive: renderArchive, searchIndex: searchIndex, Matcher: Matcher,
    useGlossary: function (g) { GLOSSARY = g; GL = new Matcher(g.entries); }, merged: function () { return merged; } };
})();
