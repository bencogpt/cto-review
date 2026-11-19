/* CTO Review replica – reference implementation of «טעינת קובץ JSON» (SPEC section 9).
 *
 * Classic script (no ES module), so it also runs from file:// . No external URLs. Files are read with Blob.text(),
 * stored in IndexedDB, and every text value is later rendered with textContent only (this file never uses innerHTML).
 * The only network request is same-origin and read-only: loadServer() reads the shared server folder
 * data/updates/ (manifest.json + the files it lists, SPEC 9.10) over http(s). From file:// it does nothing.
 *
 * Accepted file types (auto-detected by structure, never by file name):
 *   brief     – daily tech-brief-YYYY-MM-DD.json   {format_version:"2-layered", date, items:[...]}
 *   update    – daily full update cto-review-update-YYYY-MM-DD.json
 *               {format:"cto-review-update", format_version:1, generated_at, brief, glossary, sources}
 *   export    – full export cto-review-export-YYYY-MM-DD.json
 *               {format:"cto-review-export", format_version:1, generated_at, briefs, glossary, sources}
 *   glossary  – glossary.json                      {entries:[{key, term, category, definition_he, ...}]}
 *   sources   – admin/sources.json                 {sources:[{id, name, url, ...}], changelog?}
 *   (legacy)  – an older local backup: an array of briefs, or {briefs:[...], sources?, exported_at}
 *
 * Public API (window.CTOImport, or module.exports under Node for tests):
 *   detect(obj) -> "brief" | "update" | "export" | "glossary" | "sources" | "legacy" | null
 *   setBaseline({brief(date), glossary(), sources()})  data built into the site (replica build): conflicts and
 *                                                  merges also compare against it, not only against IndexedDB
 *   clearAll() -> Promise                          «איפוס הנתונים המקומיים»
 *   validate(kind, obj) -> [hebrew error strings]  (empty = valid)
 *   importFiles(files, ui) -> Promise<summary>     files: FileList / array of File|{name,text()}
 *   exportAll() -> Promise<{name, json}>           full export of the local store, re-importable
 *   idbStore() / memoryStore()                     storage adapters (IndexedDB / in-memory for tests)
 *   wire(root)                                     binds the picker, drop zone, summary and export button
 *   loadServer(rel) -> Promise<{ok, files, errors}> reads data/updates/manifest.json and the files it lists (no-store),
 *                                                  validates each file exactly like a manual import, caches the parsed
 *                                                  result in IndexedDB (meta key "srv:<name>", signature size|sha256|
 *                                                  generated_at from the manifest, else the ETag) and never writes it
 *                                                  into the local store: a file removed from the manifest disappears.
 *
 * ui (all optional, each returns a Promise):
 *   confirm(messageHe) -> boolean                  e.g. a native <dialog> (never window.confirm)
 *   glossaryMode(fileName) -> "merge" | "replace" | null (null = cancel)
 */
(function (global) {
  "use strict";

  var DB_NAME = "cto-review", DB_VERSION = 1;
  var EXPORT_FORMAT = "cto-review-export", EXPORT_VERSION = 1;
  var UPDATE_FORMAT = "cto-review-update", UPDATE_VERSION = 1;
  var baseline = { brief: function () { return null; }, glossary: function () { return null; }, sources: function () { return null; } };
  var TAGS = ["action", "watch", "background"];
  var CATS = ["company", "product", "concept", "standard", "org"];
  var MAX_BYTES = 25 * 1024 * 1024; // refuse absurdly large files before parsing

  // ---------------------------------------------------------------- helpers
  function isObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function isISODate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")); }
  function okUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u.trim()); }
  function ts(s) { var t = Date.parse(s || ""); return isNaN(t) ? 0 : t; }
  function nowISO() { return new Date().toISOString(); }
  var HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  function heDate(d) { var p = String(d).split("-"); return Number(p[2]) + " ב" + HE_MONTHS[Number(p[1]) - 1] + " " + p[0]; }
  function itemRef(it, n) { return (it && it.id !== undefined && it.id !== null) ? String(it.id) : "מספר " + (n + 1); }

  // ---------------------------------------------------------------- detection
  function detect(o) {
    if (Array.isArray(o)) return o.length && o.every(function (b) { return isObj(b) && b.format_version === "2-layered"; }) ? "legacy" : null;
    if (!isObj(o)) return null;
    if (o.format === EXPORT_FORMAT) return "export";
    if (o.format === UPDATE_FORMAT) return "update";
    if (o.format_version === "2-layered" && "date" in o) return "brief";
    if (Array.isArray(o.briefs) && !("format" in o)) return "legacy";
    if (Array.isArray(o.entries) && !("sources" in o)) return "glossary";
    if (Array.isArray(o.sources) && !("entries" in o) && !("briefs" in o)) return "sources";
    return null;
  }

  // ---------------------------------------------------------------- validation (Hebrew messages, SPEC 9.3)
  function validateBrief(b, where) {
    var e = [], pre = where ? where + ": " : "";
    if (!isObj(b)) return [pre + "הסקירה אינה אובייקט JSON."];
    if (b.format_version !== "2-layered") e.push(pre + "שדה format_version אינו \"2-layered\".");
    if (!isISODate(b.date)) e.push(pre + "חסר תאריך תקין בשדה date (נדרש YYYY-MM-DD).");
    if (!Array.isArray(b.items) || !b.items.length) { e.push(pre + "חסר מערך items, או שהוא ריק."); return e; }
    b.items.forEach(function (it, n) {
      var id = itemRef(it, n);
      if (!isObj(it)) { e.push(pre + "הידיעה " + id + " אינה אובייקט."); return; }
      if (!it.headline) e.push(pre + "בידיעה מספר " + (n + 1) + " חסרה כותרת (headline).");
      if (TAGS.indexOf(it.tag) < 0) e.push(pre + "השדה tag בידיעה " + id + " אינו אחד מהערכים action, watch או background.");
      if (it.heat !== undefined && it.heat !== null && [1, 2, 3].indexOf(it.heat) < 0) e.push(pre + "השדה heat בידיעה " + id + " חייב להיות 1, 2, 3 או ריק.");
      (Array.isArray(it.sources) ? it.sources : []).forEach(function (s) {
        if (isObj(s) && s.url && !okUrl(s.url)) e.push(pre + "נמצא קישור שאינו http או https בידיעה " + id + ", והקובץ נדחה.");
      });
      if (it.glossary !== undefined && !Array.isArray(it.glossary)) e.push(pre + "השדה glossary בידיעה " + id + " חייב להיות מערך מפתחות.");
    });
    (Array.isArray(b.watchlist) ? b.watchlist : []).forEach(function (w, n) {
      if (isObj(w) && w.url && !okUrl(w.url)) e.push(pre + "נמצא קישור שאינו http או https בשורה " + (n + 1) + " של «שווה מעקב», והקובץ נדחה.");
    });
    return e;
  }

  function validateGlossary(g, where) {
    var e = [], pre = where ? where + ": " : "", seenKey = {}, seenAlias = {};
    if (!isObj(g) || !Array.isArray(g.entries)) return [pre + "קובץ המילון חייב לכלול מערך entries."];
    g.entries.forEach(function (x, n) {
      var ref = isObj(x) && x.key ? x.key : "מספר " + (n + 1);
      if (!isObj(x)) { e.push(pre + "ערך המילון " + ref + " אינו אובייקט."); return; }
      ["key", "term", "category", "definition_he"].forEach(function (f) {
        if (!x[f] || typeof x[f] !== "string") e.push(pre + "בערך המילון " + ref + " חסר השדה " + f + ".");
      });
      if (x.key && !/^[a-z0-9][a-z0-9-]*$/.test(x.key)) e.push(pre + "המפתח " + ref + " במילון חייב להכיל אותיות לטיניות קטנות, ספרות ומקפים בלבד.");
      if (x.key && seenKey[x.key]) e.push(pre + "המפתח " + x.key + " מופיע במילון יותר מפעם אחת.");
      seenKey[x.key] = 1;
      if (x.category && CATS.indexOf(x.category) < 0) e.push(pre + "הסוג " + x.category + " בערך " + ref + " אינו מוכר (company, product, concept, standard, org).");
      if (x.url && !okUrl(x.url)) e.push(pre + "נמצא קישור שאינו http או https בערך המילון " + ref + ", והקובץ נדחה.");
      if (x.aliases !== undefined && !Array.isArray(x.aliases)) e.push(pre + "השדה aliases בערך " + ref + " חייב להיות מערך.");
      (Array.isArray(x.aliases) ? x.aliases : []).forEach(function (a) {
        if (seenAlias[a] && seenAlias[a] !== x.key) e.push(pre + "הכינוי «" + a + "» מופיע גם ב-" + seenAlias[a] + " וגם ב-" + ref + ".");
        seenAlias[a] = x.key;
      });
    });
    return e;
  }

  function validateSources(r, where) {
    var e = [], pre = where ? where + ": " : "", seen = {};
    if (!isObj(r) || !Array.isArray(r.sources)) return [pre + "קובץ מאגר המקורות חייב לכלול מערך sources."];
    r.sources.forEach(function (s, n) {
      var ref = isObj(s) && s.id ? s.id : "מספר " + (n + 1);
      if (!isObj(s) || !s.id) { e.push(pre + "למקור " + ref + " חסר מזהה (id)."); return; }
      if (seen[s.id]) e.push(pre + "המזהה " + s.id + " מופיע במאגר יותר מפעם אחת.");
      seen[s.id] = 1;
      if (!okUrl(s.url)) e.push(pre + "למקור " + ref + " חסרה כתובת http או https תקינה, והקובץ נדחה.");
      if (s.feed_url && !okUrl(s.feed_url)) e.push(pre + "כתובת הפיד של המקור " + ref + " אינה http או https, והקובץ נדחה.");
    });
    if (r.changelog !== undefined && !Array.isArray(r.changelog)) e.push(pre + "השדה changelog במאגר חייב להיות מערך.");
    return e;
  }

  function validateExport(x) {
    var e = [];
    if (x.format_version !== EXPORT_VERSION) return ["גרסת הפורמט " + x.format_version + " של קובץ הייצוא אינה נתמכת (נתמכת גרסה " + EXPORT_VERSION + ")."];
    if (!ts(x.generated_at)) e.push("בקובץ הייצוא חסר מועד יצירה תקין (generated_at).");
    if (!Array.isArray(x.briefs)) e.push("בקובץ הייצוא חסר מערך briefs.");
    else {
      var dates = {};
      x.briefs.forEach(function (b, n) {
        var w = "סקירה " + (isObj(b) && b.date ? b.date : "מספר " + (n + 1));
        e = e.concat(validateBrief(b, w));
        if (isObj(b) && b.date) { if (dates[b.date]) e.push("התאריך " + b.date + " מופיע בקובץ הייצוא יותר מפעם אחת."); dates[b.date] = 1; }
      });
    }
    if (x.glossary !== undefined && x.glossary !== null) e = e.concat(validateGlossary(x.glossary, "המילון"));
    if (x.sources !== undefined && x.sources !== null) e = e.concat(validateSources(x.sources, "מאגר המקורות"));
    return e;
  }

  function validateUpdate(x) {
    if (x.format_version !== UPDATE_VERSION) return ["גרסת הפורמט " + x.format_version + " של קובץ העדכון היומי אינה נתמכת (נתמכת גרסה " + UPDATE_VERSION + ")."];
    var e = [];
    if (!ts(x.generated_at)) e.push("בקובץ העדכון היומי חסר מועד יצירה תקין (generated_at).");
    if (!isObj(x.brief)) e.push("בקובץ העדכון היומי חסרה הסקירה (brief).");
    else e = e.concat(validateBrief(x.brief, "הסקירה"));
    if (x.glossary !== undefined && x.glossary !== null) e = e.concat(validateGlossary(x.glossary, "המילון"));
    if (x.sources !== undefined && x.sources !== null) e = e.concat(validateSources(x.sources, "מאגר המקורות"));
    return e;
  }

  function validate(kind, o) {
    if (kind === "update") return validateUpdate(o);
    if (kind === "brief") return validateBrief(o);
    if (kind === "export") return validateExport(o);
    if (kind === "glossary") return validateGlossary(o);
    if (kind === "sources") return validateSources(o);
    if (kind === "legacy") return validateExport(toExport(o));
    return ["הקובץ אינו נראה כסקירה יומית, כעדכון יומי מלא, כקובץ ייצוא מלא, כמילון מושגים או כמאגר מקורות."];
  }

  function stripBrief(b) { var c = {}; Object.keys(b).forEach(function (k) { if (k !== "notes") c[k] = b[k]; }); return c; }
  function briefStamp(b, file) { // a daily brief has no generated_at: use it if present, else period.to, else the file time
    return (b.generated_at && ts(b.generated_at) && b.generated_at) || (b.period && ts(b.period.to) && b.period.to) ||
      (file && file.lastModified ? new Date(file.lastModified).toISOString() : nowISO());
  }
  function toExport(o) { // legacy backup -> export shape
    var arr = Array.isArray(o) ? o : o.briefs;
    return { format: EXPORT_FORMAT, format_version: EXPORT_VERSION, generated_at: (!Array.isArray(o) && o.exported_at) || nowISO(),
             briefs: arr, glossary: Array.isArray(o) ? null : (o.glossary || null), sources: Array.isArray(o) ? null : (o.sources || null) };
  }

  // ---------------------------------------------------------------- storage adapters
  function idbStore() {
    var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var rq = global.indexedDB.open(DB_NAME, DB_VERSION);
        rq.onupgradeneeded = function () {
          var d = rq.result;
          if (!d.objectStoreNames.contains("briefs")) d.createObjectStore("briefs", { keyPath: "date" });
          if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
        };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
      return dbp;
    }
    function run(store, mode, fn) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          var tx = d.transaction(store, mode), out = fn(tx.objectStore(store));
          tx.oncomplete = function () { res(out && "result" in out ? out.result : undefined); };
          tx.onerror = tx.onabort = function () { rej(tx.error); };
        });
      });
    }
    return {
      getBrief: function (date) { return run("briefs", "readonly", function (s) { return s.get(date); }); },
      putBrief: function (rec) { return run("briefs", "readwrite", function (s) { s.put(rec); }); },
      deleteBrief: function (date) { return run("briefs", "readwrite", function (s) { s.delete(date); }); },
      allBriefs: function () { return run("briefs", "readonly", function (s) { return s.getAll(); }); },
      getMeta: function (key) { return run("meta", "readonly", function (s) { return s.get(key); }); },
      putMeta: function (rec) { return run("meta", "readwrite", function (s) { s.put(rec); }); },
      deleteMeta: function (key) { return run("meta", "readwrite", function (s) { s.delete(key); }); },
      metaKeys: function () { return run("meta", "readonly", function (s) { return s.getAllKeys(); }); },
      clear: function () {
        return run("briefs", "readwrite", function (s) { s.clear(); }).then(function () { return run("meta", "readwrite", function (s) { s.clear(); }); });
      }
    };
  }
  function memoryStore() {
    var B = {}, M = {};
    function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
    return {
      getBrief: function (d) { return Promise.resolve(clone(B[d])); },
      putBrief: function (r) { B[r.date] = clone(r); return Promise.resolve(); },
      deleteBrief: function (d) { delete B[d]; return Promise.resolve(); },
      allBriefs: function () { return Promise.resolve(Object.keys(B).map(function (k) { return clone(B[k]); })); },
      getMeta: function (k) { return Promise.resolve(clone(M[k])); },
      putMeta: function (r) { M[r.key] = clone(r); return Promise.resolve(); },
      deleteMeta: function (k) { delete M[k]; return Promise.resolve(); },
      metaKeys: function () { return Promise.resolve(Object.keys(M)); },
      clear: function () { B = {}; M = {}; return Promise.resolve(); }
    };
  }
  var store = null;
  function S() { return store || (store = idbStore()); }
  function quotaMsg(err) {
    return err && (err.name === "QuotaExceededError" || /quota/i.test(String(err.message)))
      ? "אין מספיק מקום לשמור את הקובץ בדפדפן. מחקו סקירות ישנות או ייצאו גיבוי."
      : "שמירת הנתונים בדפדפן נכשלה: " + (err && err.message ? err.message : String(err));
  }

  // ---------------------------------------------------------------- merge rules (SPEC 9.4)
  function mergeGlossary(oldG, newG, incomingWins) {
    if (!oldG) return { data: newG, added: newG.entries.length, replaced: 0 };
    var byKey = {}, order = [], added = 0, replaced = 0;
    oldG.entries.forEach(function (e) { byKey[e.key] = e; order.push(e.key); });
    newG.entries.forEach(function (e) {
      if (!byKey[e.key]) { byKey[e.key] = e; order.push(e.key); added++; }
      else if (incomingWins && JSON.stringify(byKey[e.key]) !== JSON.stringify(e)) { byKey[e.key] = e; replaced++; }
    });
    var meta = incomingWins ? newG : oldG, out = {};
    Object.keys(meta).forEach(function (k) { if (k !== "entries") out[k] = meta[k]; });
    out.entries = order.map(function (k) { return byKey[k]; });
    // an alias may not belong to two entries: on a clash keep the entry that came first in the merged list
    var seen = {};
    out.entries = out.entries.map(function (e) {
      var al = (e.aliases || []).filter(function (a) { if (seen[a]) return false; seen[a] = 1; return true; });
      return al.length === (e.aliases || []).length ? e : Object.assign({}, e, { aliases: al });
    });
    return { data: out, added: added, replaced: replaced };
  }

  function newSummary() {
    return { files: [], briefsAdded: [], briefsReplaced: [], briefsKept: [], briefsSame: [], glossary: null, sources: null, errors: [] };
  }

  function putBriefs(list, stamp, origin, ui, sum, askOnConflict) {
    var chain = Promise.resolve();
    list.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (b) {
      chain = chain.then(function () { return S().getBrief(b.date); }).then(function (old) {
        var rec = { date: b.date, brief: stripBrief(b), generated_at: stamp, imported_at: nowISO(), origin: origin };
        old = old || baseline.brief(b.date); // a day built into the site counts as existing
        if (!old) return S().putBrief(rec).then(function () { sum.briefsAdded.push(b.date); });
        if (JSON.stringify(stripBrief(old.brief)) === JSON.stringify(rec.brief)) { sum.briefsSame.push(b.date); return; }
        if (askOnConflict) { // daily file: never overwrite silently
          return (ui.confirm ? ui.confirm("כבר יש סקירה ל-" + heDate(b.date) + ". להחליף אותה בקובץ החדש?") : Promise.resolve(false))
            .then(function (yes) {
              if (!yes) { sum.briefsKept.push(b.date); return; }
              return S().putBrief(rec).then(function () { sum.briefsReplaced.push(b.date); });
            });
        }
        if (ts(stamp) > ts(old.generated_at)) return S().putBrief(rec).then(function () { sum.briefsReplaced.push(b.date); });
        sum.briefsKept.push(b.date); // same age or older: the stored copy stays
      });
    });
    return chain;
  }

  function putGlossary(g, stamp, mode, sum) {
    return S().getMeta("glossary").then(function (old) {
      old = old || baseline.glossary();
      var res = mode === "replace" || !old ? { data: g, added: g.entries.length, replaced: 0, all: true }
        : mergeGlossary(old.data, g, mode === "merge" || ts(stamp) > ts(old.generated_at));
      if (mode === "replace" && old) res = { data: g, added: g.entries.length, replaced: old.data.entries.length, all: true };
      return S().putMeta({ key: "glossary", data: res.data, generated_at: stamp, imported_at: nowISO() }).then(function () {
        sum.glossary = { mode: mode === "replace" && old ? "replace" : old ? "merge" : "new", added: res.added, replaced: res.replaced, total: res.data.entries.length };
      });
    });
  }

  function putSources(r, stamp, ui, sum, ask) {
    return S().getMeta("sources").then(function (old) {
      old = old || baseline.sources();
      if (old && JSON.stringify(old.data.sources) === JSON.stringify(r.sources) &&
          JSON.stringify(old.data.changelog || []) === JSON.stringify(r.changelog || [])) {
        sum.sources = { kept: true, same: true, total: r.sources.length }; return;
      }
      var go = !old ? Promise.resolve(true)
        : ask ? (ui.confirm ? ui.confirm("להחליף את מאגר המקורות השמור במאגר שבקובץ?") : Promise.resolve(false))
        : Promise.resolve(ts(stamp) > ts(old.generated_at));
      return go.then(function (yes) {
        if (!yes) { sum.sources = { kept: true, total: old.data.sources.length }; return; }
        var data = Object.assign({}, r, { count: r.sources.length });
        return S().putMeta({ key: "sources", data: data, generated_at: stamp, imported_at: nowISO() }).then(function () {
          sum.sources = { kept: false, replaced: !!old, total: r.sources.length };
        });
      });
    });
  }

  // ---------------------------------------------------------------- one file
  function readFile(f) {
    if (f.size !== undefined && f.size > MAX_BYTES) return Promise.reject(new Error("big"));
    return typeof f.text === "function" ? f.text() : new Promise(function (res, rej) {
      var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsText(f);
    });
  }

  function importOne(f, ui, sum) {
    var name = f.name || "ללא שם";
    return readFile(f).then(function (text) {
      var o;
      try { o = JSON.parse(String(text).replace(/^\uFEFF/, "")); }
      catch (e) { sum.errors.push("לא הצלחנו לקרוא את הקובץ " + name + ": זה אינו JSON תקין."); return; }
      var kind = detect(o), errs = validate(kind, o);
      if (errs.length) {
        sum.errors.push("הקובץ " + name + " נדחה: " + errs.slice(0, 5).join(" ") + (errs.length > 5 ? " (ועוד " + (errs.length - 5) + " שגיאות)" : ""));
        return;
      }
      sum.files.push({ name: name, kind: kind });
      if (kind === "brief") return putBriefs([o], briefStamp(o, f), "brief-file", ui, sum, true);
      if (kind === "glossary") {
        return (ui.glossaryMode ? ui.glossaryMode(name) : Promise.resolve("merge")).then(function (mode) {
          if (!mode) { sum.errors.push("טעינת המילון מהקובץ " + name + " בוטלה."); return; }
          return putGlossary(o, nowISO(), mode, sum);
        });
      }
      if (kind === "update") { // daily full update: the brief asks on a date conflict, glossary/sources follow generated_at
        return putBriefs([o.brief], o.generated_at, "update", ui, sum, true)
          .then(function () { return o.glossary ? putGlossary(o.glossary, o.generated_at, "auto", sum) : null; })
          .then(function () { return o.sources ? putSources(o.sources, o.generated_at, ui, sum, false) : null; });
      }
      if (kind === "sources") return putSources(o, ts(o.updated) ? new Date(ts(o.updated)).toISOString() : nowISO(), ui, sum, true);
      var x = kind === "legacy" ? toExport(o) : o; // export: everything at once, newer generated_at wins per date
      return putBriefs(x.briefs, x.generated_at, "export", ui, sum, false)
        .then(function () { return x.glossary ? putGlossary(x.glossary, x.generated_at, "auto", sum) : null; })
        .then(function () { return x.sources ? putSources(x.sources, x.generated_at, ui, sum, false) : null; });
    }, function (e) {
      sum.errors.push(e && e.message === "big" ? "הקובץ " + name + " גדול מדי (מעל 25 מגה-בתים) ולא נטען." : "לא הצלחנו לקרוא את הקובץ " + name + ".");
    });
  }

  function importFiles(files, ui) {
    ui = ui || {};
    var sum = newSummary(), list = Array.prototype.slice.call(files || []), chain = Promise.resolve();
    // order inside one batch: exports first, then daily briefs, glossary, sources (so a daily file can still win by confirmation)
    var rank = function (f) { return /export/i.test(f.name || "") ? 0 : 1; };
    list.sort(function (a, b) { return rank(a) - rank(b); });
    list.forEach(function (f) { chain = chain.then(function () { return importOne(f, ui, sum); }); });
    return chain.then(function () { sum.text = summaryText(sum); return sum; }, function (err) {
      sum.errors.push(quotaMsg(err)); sum.text = summaryText(sum); return sum;
    });
  }

  function summaryText(s) {
    var lines = [];
    function dates(a) { return a.map(heDate).join(", "); }
    if (s.briefsAdded.length) lines.push((s.briefsAdded.length === 1 ? "נוספה סקירה אחת: " : "נוספו " + s.briefsAdded.length + " סקירות: ") + dates(s.briefsAdded) + ".");
    if (s.briefsReplaced.length) lines.push((s.briefsReplaced.length === 1 ? "הוחלפה סקירה אחת בגרסה חדשה יותר: " : "הוחלפו " + s.briefsReplaced.length + " סקירות בגרסה חדשה יותר: ") + dates(s.briefsReplaced) + ".");
    if (s.briefsSame.length) lines.push((s.briefsSame.length === 1 ? "סקירה אחת כבר קיימת בדיוק באותו נוסח" : s.briefsSame.length + " סקירות כבר קיימות בדיוק באותו נוסח") + (s.briefsSame.length === 1 ? ", ולא שונתה: " : ", ולא שונו: ") + dates(s.briefsSame) + ".");
    if (s.briefsKept.length) lines.push((s.briefsKept.length === 1 ? "נשמרה סקירה קיימת אחת" : "נשמרו " + s.briefsKept.length + " סקירות קיימות") + " (העותק השמור חדש יותר או זהה, או שההחלפה בוטלה): " + dates(s.briefsKept) + ".");
    if (s.glossary) lines.push("מילון המושגים " + (s.glossary.mode === "replace" ? "הוחלף" : s.glossary.mode === "new" ? "נטען" : "מוזג") + ": " + s.glossary.added + " מושגים חדשים, " +
      s.glossary.replaced + " עודכנו, " + s.glossary.total + " בסך הכול.");
    if (s.sources) lines.push(s.sources.same ? "מאגר המקורות זהה לשמור (" + s.sources.total + " מקורות)." : s.sources.kept ? "מאגר המקורות השמור נשאר (" + s.sources.total + " מקורות)."
      : "מאגר המקורות " + (s.sources.replaced ? "הוחלף" : "נטען") + ": " + s.sources.total + " מקורות.");
    if (s.errors.length) lines.push((s.errors.length === 1 ? "קובץ אחד נדחה: " : s.errors.length + " קבצים נדחו: ") + s.errors.join(" "));
    if (!lines.length) lines.push("לא נטען אף קובץ.");
    return lines;
  }

  // ---------------------------------------------------------------- export back (SPEC 9.6)
  function exportAll(merged) {
    if (merged && typeof merged === "function") return Promise.resolve(merged()).then(function (m) { return exportData(m.briefs, m.glossary, m.sources, m.origin); });
    return Promise.all([S().allBriefs(), S().getMeta("glossary"), S().getMeta("sources")]).then(function (r) {
      var briefs = r[0].map(function (x) { return x.brief; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var latest = briefs.length ? briefs[briefs.length - 1].date : new Date().toISOString().slice(0, 10);
      var data = { format: EXPORT_FORMAT, format_version: EXPORT_VERSION, generated_at: nowISO(), origin: "replica", latest: latest,
                   counts: { briefs: briefs.length, glossary: r[1] ? r[1].data.entries.length : 0, sources: r[2] ? r[2].data.sources.length : 0 },
                   briefs: briefs, glossary: r[1] ? r[1].data : null, sources: r[2] ? r[2].data : null };
      return { name: "cto-review-export-" + latest + ".json", json: JSON.stringify(data, null, 1) };
    });
  }

  function exportData(briefs, glossary, sources, origin) { // same file shape as the live site's export.json
    briefs = briefs.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var latest = briefs.length ? briefs[briefs.length - 1].date : new Date().toISOString().slice(0, 10);
    var data = { format: EXPORT_FORMAT, format_version: EXPORT_VERSION, generated_at: nowISO(), origin: origin || "replica", latest: latest,
                 counts: { briefs: briefs.length, glossary: glossary ? glossary.entries.length : 0, sources: sources ? sources.sources.length : 0 },
                 briefs: briefs, glossary: glossary || null, sources: sources || null };
    return { name: "cto-review-export-" + latest + ".json", json: JSON.stringify(data, null, 1) };
  }

  // ---------------------------------------------------------------- UI wiring (textContent only, no inline handlers)
  function dialogConfirm(dlg, msg) {
    return new Promise(function (res) {
      if (!dlg || typeof dlg.showModal !== "function") { res(false); return; }
      dlg.querySelector("[data-msg]").textContent = msg;
      dlg.returnValue = "";
      dlg.addEventListener("close", function h() { dlg.removeEventListener("close", h); res(dlg.returnValue === "yes"); });
      dlg.showModal();
    });
  }
  function dialogGlossary(dlg, name) {
    return new Promise(function (res) {
      if (!dlg || typeof dlg.showModal !== "function") { res("merge"); return; }
      dlg.querySelector("[data-msg]").textContent = "הקובץ " + name + " הוא מילון מושגים. למזג אותו עם המילון השמור (מושגים חדשים נוספים, מושגים קיימים מתעדכנים) או להחליף את המילון כולו?";
      dlg.returnValue = "";
      dlg.addEventListener("close", function h() { dlg.removeEventListener("close", h); res(dlg.returnValue === "merge" || dlg.returnValue === "replace" ? dlg.returnValue : null); });
      dlg.showModal();
    });
  }
  function showSummary(el, sum) {
    if (!el) return;
    el.textContent = "";
    sum.text.forEach(function (line) { var p = document.createElement("p"); p.textContent = line; el.appendChild(p); });
    el.classList.toggle("has-errors", sum.errors.length > 0);
  }
  function wire(root, opts) {
    root = root || document; opts = opts || {};
    var input = root.querySelector("[data-import-input]"), drop = root.querySelector("[data-import-drop]");
    var out = root.querySelector("[data-import-summary]"), exp = root.querySelector("[data-import-export]");
    var ui = { confirm: function (m) { return dialogConfirm(document.querySelector("dialog[data-import-confirm]"), m); },
               glossaryMode: function (n) { return dialogGlossary(document.querySelector("dialog[data-import-glossary]"), n); } };
    function run(files) {
      if (!files || !files.length) return;
      if (out) out.textContent = "טוען…";
      importFiles(files, ui).then(function (sum) {
        showSummary(out, sum);
        document.dispatchEvent(new CustomEvent("cto-review:data-changed", { detail: sum })); // renderers refresh home, day, archive, search, actions, glossary, admin
        if (input) input.value = "";
        if (opts.onDone) opts.onDone(sum);
      });
    }
    if (input) input.addEventListener("change", function () { run(input.files); });
    if (drop) {
      ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
      ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove("is-over"); }); });
      drop.addEventListener("drop", function (e) { e.preventDefault(); run(e.dataTransfer && e.dataTransfer.files); });
    }
    var rst = root.querySelector("[data-import-reset]");
    if (rst) rst.addEventListener("click", function () {
      var dlg = document.querySelector("dialog[data-import-reset-dlg]");
      var go = dlg && typeof dlg.showModal === "function" ? new Promise(function (res) {
        dlg.returnValue = ""; dlg.addEventListener("close", function h() { dlg.removeEventListener("close", h); res(dlg.returnValue === "yes"); }); dlg.showModal();
      }) : Promise.resolve(false);
      go.then(function (yes) {
        if (!yes) return;
        clearAll().then(function () {
          if (out) { out.textContent = ""; var p = document.createElement("p"); p.textContent = "הנתונים המקומיים נמחקו. האתר מציג שוב רק את הסקירות שנבנו איתו."; out.appendChild(p); }
          document.dispatchEvent(new CustomEvent("cto-review:data-changed", { detail: null }));
          if (opts.onDone) opts.onDone(null);
        });
      });
    });
    if (exp) exp.addEventListener("click", function () {
      exportAll(opts.exportData).then(function (r) {
        var url = URL.createObjectURL(new Blob([r.json], { type: "application/json" }));
        var a = document.createElement("a"); a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      });
    });
  }


  // ---------------------------------------------------------------- shared server folder data/updates/ (SPEC 9.10)
  // The admin publishes files for every visitor with tools/add-update.ps1 (or tools/add_update.py), which copies the file
  // into data/updates/ and rewrites data/updates/manifest.json. IIS does not list folders, so the manifest is the index.
  var SERVER_DIR = "data/updates/", MANIFEST_FORMAT = "cto-review-updates-manifest", SRV_PREFIX = "srv:";
  var SERVER_KINDS = ["update", "brief", "export", "glossary", "sources"], MAX_SERVER_FILES = 400;
  var SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$/;
  function canFetch() {
    return typeof fetch === "function" && typeof location !== "undefined" && /^https?:$/.test(location.protocol);
  }
  function fetchText(url, ms) { // same-origin GET, never cached by the browser; rejects on 404, timeout or a huge body
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 8000) : null;
    var done = function () { if (timer) clearTimeout(timer); };
    return fetch(url, { cache: "no-store", credentials: "same-origin", signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      if (Number(r.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("big");
      return r.text().then(function (t) {
        if (t.length > MAX_BYTES) throw new Error("big");
        return { text: t, etag: r.headers.get("etag") || r.headers.get("last-modified") || "" };
      });
    }).then(function (x) { done(); return x; }, function (e) { done(); throw e; });
  }
  function parseManifest(text) {
    var o = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    if (!isObj(o) || o.format !== MANIFEST_FORMAT || !Array.isArray(o.files)) throw new Error("manifest");
    var meta = {}, seen = {}, out = [];
    (Array.isArray(o.entries) ? o.entries : []).forEach(function (e) { if (isObj(e) && typeof e.name === "string") meta[e.name] = e; });
    o.files.forEach(function (n) {
      if (typeof n !== "string" || !SAFE_NAME.test(n) || n.toLowerCase() === "manifest.json" || seen[n]) return;
      seen[n] = 1;
      var m = meta[n] || {}, sig = (m.size || m.sha256) ? [m.size || "", m.sha256 || "", m.generated_at || ""].join("|") : "";
      out.push({ name: n, sig: sig, generated_at: ts(m.generated_at) ? m.generated_at : "" });
    });
    return { generated_at: ts(o.generated_at) ? o.generated_at : "", files: out.slice(0, MAX_SERVER_FILES) };
  }
  function serverRecord(f, kind, o, etag) { // validated file -> one layer (briefs / glossary / sources + its stamp)
    var rec = { key: SRV_PREFIX + f.name, name: f.name, kind: kind, sig: f.sig, etag: etag || "", fetched_at: nowISO(),
                stamp: "", briefs: [], glossary: null, sources: null };
    var srcStamp = function (r) { return ts(r.updated) ? new Date(ts(r.updated)).toISOString() : ""; };
    if (kind === "brief") {
      rec.briefs = [stripBrief(o)];
      rec.stamp = (o.generated_at && ts(o.generated_at) && o.generated_at) || (o.period && ts(o.period.to) && o.period.to) || f.generated_at;
    } else if (kind === "update" || kind === "export") {
      rec.stamp = o.generated_at;
      rec.briefs = (kind === "update" ? [o.brief] : o.briefs).map(stripBrief);
      rec.glossary = o.glossary || null;
      rec.sources = o.sources ? Object.assign({}, o.sources, { count: o.sources.sources.length }) : null;
    } else if (kind === "glossary") {
      rec.glossary = o; rec.stamp = (ts(o.generated_at) && o.generated_at) || (ts(o.updated) && o.updated) || f.generated_at;
    } else if (kind === "sources") {
      rec.sources = Object.assign({}, o, { count: o.sources.length }); rec.stamp = srcStamp(o) || f.generated_at;
    }
    return rec;
  }
  function quiet(p, dflt) { try { return Promise.resolve(p()).catch(function () { return dflt; }); } catch (e) { return Promise.resolve(dflt); } }
  function loadServer(rel) {
    var res = { ok: false, files: [], errors: [], manifest: null };
    if (!canFetch()) { res.offline = true; return Promise.resolve(res); } // file:// : built-in + local data only
    var base = (rel || "") + SERVER_DIR;
    return fetchText(base + "manifest.json?t=" + Date.now()).then(function (x) {
      var man = parseManifest(x.text);
      res.ok = true; res.manifest = man;
      return Promise.all(man.files.map(function (f) {
        return quiet(function () { return S().getMeta(SRV_PREFIX + f.name); }, null).then(function (cached) {
          if (cached && f.sig && cached.sig === f.sig) return cached; // unchanged since the last visit: no download
          return fetchText(base + encodeURIComponent(f.name) + "?v=" + encodeURIComponent(f.sig || String(Date.now()))).then(function (y) {
            if (cached && !f.sig && y.etag && cached.etag === y.etag) return cached;
            var o;
            try { o = JSON.parse(y.text.replace(/^\uFEFF/, "")); } catch (e) { res.errors.push("הקובץ " + f.name + " בתיקיית העדכונים אינו JSON תקין."); return null; }
            var kind = detect(o), errs = SERVER_KINDS.indexOf(kind) < 0 ? validate(null, o) : validate(kind, o);
            if (errs.length) { res.errors.push("הקובץ " + f.name + " בתיקיית העדכונים נדחה: " + errs.slice(0, 3).join(" ")); return null; }
            var rec = serverRecord(f, kind, o, y.etag);
            return quiet(function () { return S().putMeta(rec); }, null).then(function () { return rec; });
          }, function () { res.errors.push("לא הצלחנו להוריד את הקובץ " + f.name + " מתיקיית העדכונים."); return null; });
        });
      })).then(function (recs) {
        res.files = recs.filter(Boolean);
        var keep = {}; man.files.forEach(function (f) { keep[SRV_PREFIX + f.name] = 1; });
        return quiet(function () { // forget cached copies of files that are no longer in the manifest
          return S().metaKeys().then(function (keys) {
            return Promise.all(keys.filter(function (k) { return typeof k === "string" && k.indexOf(SRV_PREFIX) === 0 && !keep[k]; })
              .map(function (k) { return S().deleteMeta(k); }));
          });
        }, null).then(function () { return res; });
      });
    }).catch(function () { return res; }); // no manifest (404), bad manifest, offline: the site keeps its built-in content
  }

  function clearAll() { return S().clear(); }

  var api = { detect: detect, setBaseline: function (b) { baseline = Object.assign(baseline, b || {}); }, clearAll: clearAll, exportData: exportData, validate: validate, importFiles: importFiles, exportAll: exportAll, summaryText: summaryText,
              mergeGlossary: mergeGlossary, idbStore: idbStore, memoryStore: memoryStore, wire: wire,
              useStore: function (s) { store = s; }, loadServer: loadServer, parseManifest: parseManifest,
              getBriefs: function () { return S().allBriefs(); }, getMeta: function (k) { return S().getMeta(k); },
              deleteBrief: function (d) { return S().deleteBrief(d); } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    global.CTOImport = api;
    if (typeof document !== "undefined") {
      var boot = function () { document.querySelectorAll("[data-import-root]:not([data-import-manual])").forEach(function (r) { wire(r); }); };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
