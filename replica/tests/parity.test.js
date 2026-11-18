// Parity: the client renderer (assets/replica.js) must produce the same <main> (and archive aside) HTML as
// build.py --replica for every built-in page. Usage: node parity.test.js <replica dist folder>
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIST = path.resolve(process.argv[2] || 'dist');
function ctx(rel) {
  const doc = { currentScript: { getAttribute: k => (k === 'data-rel' ? rel : ''), hasAttribute: () => false },
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
    createElement: () => ({ remove() {} }), body: { appendChild(o) { if (o.onload) o.onload(); } } };
  const c = { document: doc, console, URLSearchParams, Promise, Blob: class {}, URL: { createObjectURL: () => 'blob:x' }, location: { hash: '', search: '', pathname: '/' }, history: { replaceState() {} } };
  c.window = c; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(DIST, 'assets/replica-data.js'), 'utf8'), c);
  const sp = path.join(DIST, 'assets/replica-sources.js'); if (fs.existsSync(sp)) vm.runInContext(fs.readFileSync(sp, 'utf8'), c);
  vm.runInContext(fs.readFileSync(path.join(DIST, 'assets/replica.js'), 'utf8'), c);
  c.CTOReplica.useGlossary(c.CTO_REPLICA.glossary);
  return c;
}
const main = h => h.split('<main id="main" tabindex="-1">')[1].split('</main>\n')[0];
const aside = h => { const m = h.match(/<aside class="side"><h2>ארכיון<\/h2>([\s\S]*?)<\/aside>/); return m ? m[1] : null; };
let pass = 0, fail = 0;
function eq(name, a, b) {
  if (a === b) { pass++; return; }
  fail++; let i = 0; while (i < a.length && a[i] === b[i]) i++;
  console.log('FAIL', name, '\n  static: ', JSON.stringify(a.slice(Math.max(0, i - 80), i + 120)), '\n  client: ', JSON.stringify(b.slice(Math.max(0, i - 80), i + 120)));
}
const c1 = ctx('../'), R = c1.CTOReplica, B = c1.CTO_REPLICA.briefs;
B.forEach((b, i) => {
  const html = fs.readFileSync(path.join(DIST, b.date, 'index.html'), 'utf8');
  eq('day ' + b.date + ' main', main(html), R.renderBrief(b, B[i + 1] || null, B[i - 1] || null));
  eq('day ' + b.date + ' aside', aside(html), R.archiveList(B, b.date));
});
eq('actions', main(fs.readFileSync(path.join(DIST, 'actions/index.html'), 'utf8')), R.renderActions(B));
eq('glossary', main(fs.readFileSync(path.join(DIST, 'glossary/index.html'), 'utf8')), R.renderGlossary(B));
eq('archive', main(fs.readFileSync(path.join(DIST, 'archive/index.html'), 'utf8')).replace('data-index="../search.json"', 'data-index="X"'), R.renderArchive(B, 'X'));
const si = JSON.parse(fs.readFileSync(path.join(DIST, 'search.json'), 'utf8'));
eq('search.json', JSON.stringify(si), JSON.stringify(R.searchIndex(B)));
if (c1.CTO_REPLICA_SOURCES) eq('admin', main(fs.readFileSync(path.join(DIST, 'admin/index.html'), 'utf8')), R.renderAdmin(c1.CTO_REPLICA_SOURCES, B[0].date));
const c0 = ctx(''), R0 = c0.CTOReplica, home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
eq('home main', main(home), '<p class="latest-badge">הסקירה האחרונה</p>' + R0.renderBrief(B[0], B[1] || null, null));
eq('home aside', aside(home), R0.archiveList(B, B[0].date));
// XSS: hostile imported values stay text, non-http links are dropped
const evil = { date: '2026-11-30', title: '<img src=x onerror=alert(1)>', format_version: '2-layered', exec_summary: ['<script>alert(1)</script>'],
  items: [{ id: '"><svg onload=alert(1)>', tag: 'action', headline: '<b>x</b>', summary: '" onmouseover="alert(1)', why_it_matters: "'><iframe>", action: '<a href=javascript:alert(1)>',
    sources: [{ label: 'bad', url: 'javascript:alert(1)' }, { label: '<i>ok</i>', url: 'https://example.org/?a="b"' }], heat: 2, momentum: '<img>' }],
  watchlist: [{ text: '<script>', url: 'data:text/html,<script>' }] };
const out = R.renderBrief(evil, null, null);
const bad = [/<img/i, /<script/i, /<svg onload/i, /<iframe/i, /<b>x/, /href="javascript:/i, /href="data:/i, /onerror=/i.test(out) && !/onerror=alert\(1\)&gt;/.test(out) ? /onerror=/ : /$^/];
bad.forEach(rx => { if (rx.test(out)) { fail++; console.log('FAIL xss', rx); } else pass++; });
if (!/href="https:\/\/example\.org\/\?a=&quot;b&quot;"/.test(out)) { fail++; console.log('FAIL https link kept + escaped'); } else pass++;
console.log(`parity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
