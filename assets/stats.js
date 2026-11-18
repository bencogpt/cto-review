/* /admin/stats/ – login statistics. Data: same-origin data.json (admin role only, served by the worker). */
(function () {
  var st = document.getElementById("st-status");
  if (!st) return;
  var TZ = "Asia/Jerusalem";
  var OUT = { success: "הצליחה", fail: "נכשלה" };
  var ROLE = { reader: "קורא", admin: "מנהל", "": "לא ידוע" };
  var DEV = { desktop: "מחשב", mobile: "נייד", tablet: "טאבלט", other: "אחר" };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function dayKey(iso) { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); }
  function heDay(key) { var p = key.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)).toLocaleDateString("he-IL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "numeric" }); }
  function when(iso) { return new Date(iso).toLocaleString("he-IL", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  var region = null; try { region = new Intl.DisplayNames(["he"], { type: "region" }); } catch (e) {}
  function country(c) { if (!c) return "לא ידוע"; try { return (region && region.of(c.toUpperCase())) || c; } catch (e) { return c; } }
  function show(id) { document.getElementById(id).classList.remove("hidden"); }
  function card(n, label, cls) { var d = el("div", "stat " + (cls || "")); d.appendChild(el("b", null, String(n))); d.appendChild(el("span", null, label)); return d; }
  function tally(list, fn) { var m = {}; list.forEach(function (e) { var k = fn(e); m[k] = (m[k] || 0) + 1; }); return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); }
  function fillList(id, rows) {
    var ul = document.getElementById(id), max = rows.length ? rows[0][1] : 1;
    if (!rows.length) { ul.appendChild(el("li", "st-empty", "אין נתונים")); return; }
    rows.slice(0, 12).forEach(function (r) {
      var li = el("li"); li.appendChild(el("span", "st-k", r[0])); var p = el("progress"); p.max = max; p.value = r[1];
      p.setAttribute("aria-hidden", "true"); li.appendChild(p); li.appendChild(el("span", "st-n", String(r[1]))); ul.appendChild(li);
    });
  }
  fetch("data.json", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      var ev = d.events || [], ok = ev.filter(function (e) { return e.o === "success"; }), bad = ev.filter(function (e) { return e.o === "fail"; });
      var now = Date.now(), d30 = ev.filter(function (e) { return now - Date.parse(e.t) < 30 * 864e5; });
      var uniq = function (l) { var s = {}; l.forEach(function (e) { if (e.v) s[e.v] = 1; }); return Object.keys(s).length; };
      st.textContent = ev.length ? "נכון ל-" + when(d.generated) + " (שעון ישראל). הנתונים נשמרים 400 יום." : "עדיין לא נרשמו כניסות.";
      var cards = document.getElementById("st-cards");
      cards.appendChild(card(ok.filter(function (e) { return now - Date.parse(e.t) < 30 * 864e5; }).length, "כניסות מוצלחות · 30 יום", "big"));
      cards.appendChild(card(bad.filter(function (e) { return now - Date.parse(e.t) < 30 * 864e5; }).length, "ניסיונות כושלים · 30 יום", "r2"));
      cards.appendChild(card(uniq(d30.filter(function (e) { return e.o === "success"; })), "מבקרים ייחודיים (בקירוב) · 30 יום"));
      cards.appendChild(card(ok.length, "כניסות מוצלחות · סה״כ"));
      cards.appendChild(card(bad.length, "ניסיונות כושלים · סה״כ"));
      cards.appendChild(card(ok.filter(function (e) { return e.r === "admin"; }).length, "כניסות מנהל · סה״כ"));
      show("st-summary");
      // per day, last 30 days (Israel time), newest first
      var days = {}, order = [];
      for (var i = 0; i < 30; i++) { var k = dayKey(new Date(now - i * 864e5).toISOString()); if (!days[k]) { days[k] = { s: 0, f: 0, v: {} }; order.push(k); } }
      d30.forEach(function (e) { var k = dayKey(e.t), x = days[k]; if (!x) return; if (e.o === "success") { x.s++; if (e.v) x.v[e.v] = 1; } else x.f++; });
      var max = 1; order.forEach(function (k) { max = Math.max(max, days[k].s + days[k].f); });
      var tb = document.getElementById("st-days");
      order.forEach(function (k) {
        var x = days[k], tr = el("tr", x.s + x.f ? "" : "st-zero");
        tr.appendChild(el("td", null, heDay(k))); tr.appendChild(el("td", null, String(x.s))); tr.appendChild(el("td", x.f ? "st-bad" : null, String(x.f)));
        tr.appendChild(el("td", null, String(Object.keys(x.v).length)));
        var td = el("td", "st-bar"), p = el("progress"); p.max = max; p.value = x.s + x.f; p.setAttribute("aria-hidden", "true"); td.appendChild(p); tr.appendChild(td);
        tb.appendChild(tr);
      });
      show("st-days-wrap");
      fillList("st-countries", tally(ev, function (e) { return country(e.c) + (e.ci ? "" : ""); }));
      fillList("st-browsers", tally(ev, function (e) { return e.browser || "Other"; }));
      fillList("st-os", tally(ev, function (e) { return e.os || "Other"; }));
      fillList("st-devices", tally(ev, function (e) { return DEV[e.device] || e.device || "אחר"; }));
      fillList("st-roles", tally(ev, function (e) { return (ROLE[e.r] || e.r) + " · " + (OUT[e.o] || e.o); }));
      show("st-grid");
      var lt = document.getElementById("st-latest");
      ev.slice(0, 50).forEach(function (e) {
        var tr = el("tr");
        tr.appendChild(el("td", null, when(e.t)));
        tr.appendChild(el("td", e.o === "success" ? "st-ok" : "st-bad", OUT[e.o] || e.o));
        tr.appendChild(el("td", null, ROLE[e.r] || e.r));
        tr.appendChild(el("td", null, country(e.c) + (e.ci ? " · " + e.ci : "")));
        tr.appendChild(el("td", null, e.browser || "")); tr.appendChild(el("td", null, e.os || ""));
        tr.appendChild(el("td", null, DEV[e.device] || e.device || ""));
        var v = el("td", "st-v", (e.v || "").slice(0, 6)); v.dir = "ltr"; tr.appendChild(v);
        lt.appendChild(tr);
      });
      if (ev.length) show("st-latest-wrap");
    })
    .catch(function (err) { st.textContent = "לא ניתן לטעון את הנתונים (" + err.message + "). ייתכן שצריך להתחבר מחדש כמנהל."; });
})();
