// Shared server folder (SPEC 9.9): manifest parsing, validation, cache by signature, pruning, silent failures.
// Usage (repo): python build.py && node replica/tests/server.test.js   (env CTO_DIST = a live dist folder, default ../../dist)
const path = require('path'), fs = require('fs'), assert = require('assert');
const HERE = __dirname, DIST = process.env.CTO_DIST || path.join(HERE, '..', '..', 'dist');
const I = require(path.join(HERE, '..', 'assets', 'import.js'));
const upd = fs.readFileSync(path.join(DIST, 'admin', 'update.json'), 'utf8');
const U = JSON.parse(upd), name = 'cto-review-update-' + U.brief.date + '.json';
let files = {}, hits = [];
global.location = { protocol: 'http:' };
global.fetch = async (url) => {
  hits.push(url); const key = url.replace(/^.*data\/updates\//, '').replace(/\?.*$/, '');
  const body = files[decodeURIComponent(key)];
  if (body === undefined) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
  return { ok: true, status: 200, headers: { get: h => h === 'content-length' ? String(Buffer.byteLength(body)) : null }, text: async () => body };
};
const man = (list, sig) => JSON.stringify({ format: 'cto-review-updates-manifest', format_version: 1, files: list,
  entries: list.map(n => ({ name: n, size: (files[n] || '').length, sha256: sig || 'a', generated_at: '2026-11-19T07:00:00+02:00' })) });
(async () => {
  I.useStore(I.memoryStore());
  // 1. no manifest -> silent, empty
  let r = await I.loadServer('');
  assert.equal(r.ok, false); assert.equal(r.files.length, 0);
  // 2. one valid update + one bad file + an unsafe name
  const bad = JSON.parse(upd); bad.brief.items[0].sources = [{ label: 'x', url: 'javascript:alert(1)' }];
  files[name] = upd; files['bad.json'] = JSON.stringify(bad);
  files['manifest.json'] = man([name, 'bad.json', '../secret.json', 'manifest.json']);
  hits = []; r = await I.loadServer('');
  assert.equal(r.ok, true); assert.equal(r.files.length, 1); assert.equal(r.files[0].kind, 'update');
  assert.equal(r.files[0].briefs[0].date, U.brief.date); assert.ok(r.files[0].glossary.entries.length > 0);
  assert.equal(r.errors.length, 1); assert.ok(/bad\.json/.test(r.errors[0]));
  assert.ok(!hits.some(u => /secret/.test(u)), 'unsafe names are never fetched');
  assert.ok(/manifest\.json\?t=\d+/.test(hits[0]), 'manifest is cache-busted');
  // 3. same signature -> served from the cache, no download
  hits = []; r = await I.loadServer('');
  assert.equal(r.files.length, 1); assert.ok(!hits.some(u => u.includes(name)), 'cached file not re-downloaded');
  // 4. changed signature -> downloaded again
  files['manifest.json'] = man([name], 'b'); hits = []; r = await I.loadServer('');
  assert.ok(hits.some(u => u.includes(name)));
  // 5. removed from the manifest -> gone, cache pruned
  files['manifest.json'] = man([]); r = await I.loadServer('');
  assert.equal(r.files.length, 0); assert.equal(await I.getMeta('srv:' + name), undefined);
  // 6. broken manifest and file:// -> silent
  files['manifest.json'] = '{nope'; r = await I.loadServer(''); assert.equal(r.ok, false);
  global.location = { protocol: 'file:' }; hits = []; r = await I.loadServer(''); assert.equal(r.offline, true); assert.equal(hits.length, 0);
  console.log('server.test.js: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
