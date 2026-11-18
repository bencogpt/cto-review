// Usage (repo): python build.py && node replica/tests/import.test.js   (env CTO_DIST = a live dist folder, default ../../dist)
const path = require('path'); const HERE = __dirname, DIST = process.env.CTO_DIST || path.join(HERE, '..', '..', 'dist');
const I = require(path.join(HERE, '..', 'assets', 'import.js'));
const fs = require('fs'), assert = require('assert');
const file = (name, text, lastModified) => ({ name, size: Buffer.byteLength(text), lastModified, text: async () => text });
const exp = fs.readFileSync(path.join(HERE, '..', 'cto-review-export-2026-11-18.json'), 'utf8');
const dailyObj = JSON.parse(fs.readFileSync(path.join(DIST, '2026-11-18', 'brief.json'), 'utf8')); dailyObj.title += ' (גרסה מתוקנת)'; const daily = JSON.stringify(dailyObj);
const gl = fs.readFileSync(path.join(DIST, 'glossary.json'), 'utf8');
const src = fs.readFileSync(path.join(DIST, 'admin', 'sources.json'), 'utf8');
(async () => {
  const E = JSON.parse(exp);
  assert.equal(I.detect(E), 'export'); assert.equal(I.detect(JSON.parse(daily)), 'brief');
  assert.equal(I.detect(JSON.parse(gl)), 'glossary'); assert.equal(I.detect(JSON.parse(src)), 'sources');
  assert.equal(I.detect({ foo: 1 }), null);
  for (const k of ['export']) assert.deepEqual(I.validate(k, E), []);
  assert.deepEqual(I.validate('glossary', JSON.parse(gl)), []); assert.deepEqual(I.validate('sources', JSON.parse(src)), []);
  // 1. full export into empty store
  I.useStore(I.memoryStore());
  let s = await I.importFiles([file('cto-review-export-2026-11-18.json', exp)], {});
  console.log('T1', s.text.join(' | '));
  assert.equal(s.briefsAdded.length, E.briefs.length); assert.equal(s.glossary.total, E.glossary.entries.length); assert.equal(s.sources.total, E.sources.sources.length);
  // 2. same export again -> everything kept
  s = await I.importFiles([file('x.json', exp)], {});
  assert.equal(s.briefsSame.length, E.briefs.length); assert.equal(s.briefsAdded.length, 0); console.log('T2', s.text.join(' | '));
  // 3. newer export with a changed brief + extra glossary entry -> replaced
  const E2 = JSON.parse(exp); E2.generated_at = '2026-11-19T07:30:00+02:00'; E2.briefs[0].title += ' (עודכן)'; E2.sources.sources[0].name += ' (חדש)';
  E2.glossary.entries.push({ key: 'zz-test', term: 'ZZTest', aliases: ['ZZTest'], category: 'concept', definition_he: 'מושג בדיקה.' });
  s = await I.importFiles([file('e2.json', JSON.stringify(E2))], {});
  assert.equal(s.briefsReplaced.length, 1); assert.equal(s.briefsSame.length, E.briefs.length - 1); assert.equal(s.glossary.added, 1); assert.equal(s.sources.replaced, true);
  console.log('T3', s.text.join(' | '));
  // 4. older export -> kept
  const E3 = JSON.parse(exp); E3.generated_at = '2026-11-01T00:00:00+02:00'; E3.briefs.forEach(b => b.title += ' (ישן)'); E3.sources.sources[0].name += ' x';
  s = await I.importFiles([file('e3.json', JSON.stringify(E3))], {}); assert.equal(s.briefsKept.length, E.briefs.length); assert.equal(s.sources.kept, true);
  // 5. daily brief on an existing date asks; declined -> kept, accepted -> replaced
  let asked = 0;
  s = await I.importFiles([file('tech-brief-2026-11-18.json', daily)], { confirm: async m => { asked++; console.log('ASK', m); return false; } });
  assert.equal(asked, 1); assert.deepEqual(s.briefsKept, ['2026-11-18']);
  s = await I.importFiles([file('tech-brief-2026-11-18.json', daily)], { confirm: async () => true }); assert.deepEqual(s.briefsReplaced, ['2026-11-18']);
  // 6. multi-file batch with errors
  const bad = JSON.parse(daily); bad.items[0].sources[0].url = 'javascript:alert(1)';
  const nobrief = JSON.parse(daily); nobrief.format_version = '1';
  s = await I.importFiles([file('a.json', '{oops'), file('b.json', JSON.stringify(bad)), file('c.json', JSON.stringify({ a: 1 })),
                           file('tech-brief-2026-11-12.json', JSON.stringify(Object.assign(JSON.parse(daily), { date: '2026-11-12' }))),
                           file('d.json', JSON.stringify({format:'cto-review-export', format_version: 2}))], {});
  console.log('T6', s.text.join('\n   '));
  assert.equal(s.errors.length, 4); assert.deepEqual(s.briefsAdded, ['2026-11-12']);
  // 7. glossary alone: merge vs replace
  const G = JSON.parse(gl); G.entries = G.entries.slice(0, 10);
  s = await I.importFiles([file('glossary.json', JSON.stringify(G))], { glossaryMode: async () => 'replace' }); assert.equal(s.glossary.total, 10);
  s = await I.importFiles([file('glossary.json', gl)], { glossaryMode: async () => 'merge' }); assert.equal(s.glossary.total, JSON.parse(gl).entries.length);
  s = await I.importFiles([file('glossary.json', gl)], { glossaryMode: async () => null }); assert.equal(s.errors.length, 1);
  // 8. sources alone asks before replacing
  s = await I.importFiles([file('sources.json', src)], { confirm: async () => true }); assert.equal(s.sources.replaced, true);
  // 8b. update file: new date added, then same again -> same, then changed -> asks
  const U = { format: 'cto-review-update', format_version: 1, generated_at: '2026-11-20T07:30:00+02:00', brief: Object.assign(JSON.parse(daily), { date: '2026-11-20' }), glossary: JSON.parse(gl), sources: JSON.parse(src) };
  assert.equal(I.detect(U), 'update'); assert.deepEqual(I.validate('update', U), []);
  s = await I.importFiles([file('cto-review-update-2026-11-20.json', JSON.stringify(U))], {}); assert.deepEqual(s.briefsAdded, ['2026-11-20']); console.log('T8b', s.text.join(' | '));
  s = await I.importFiles([file('u.json', JSON.stringify(U))], {}); assert.deepEqual(s.briefsSame, ['2026-11-20']);
  U.brief.title += '!'; let asked2 = 0;
  s = await I.importFiles([file('u.json', JSON.stringify(U))], { confirm: async () => { asked2++; return true; } }); assert.equal(asked2, 1); assert.deepEqual(s.briefsReplaced, ['2026-11-20']);
  // 8c. baseline (built-in day) counts as existing
  I.useStore(I.memoryStore()); I.setBaseline({ brief: d => d === '2026-11-18' ? { brief: JSON.parse(daily), generated_at: '2026-11-18T08:00:00+02:00' } : null });
  s = await I.importFiles([file('tech-brief-2026-11-18.json', daily)], {}); assert.deepEqual(s.briefsSame, ['2026-11-18']);
  let asked3 = 0; s = await I.importFiles([file('t.json', JSON.stringify(Object.assign(JSON.parse(daily), { title: 'אחר' })))], { confirm: async () => { asked3++; return false; } });
  assert.equal(asked3, 1); assert.deepEqual(s.briefsKept, ['2026-11-18']);
  I.setBaseline({ brief: () => null });
  await I.clearAll(); assert.equal((await I.getBriefs()).length, 0);
  // 9. export back and re-import into a fresh store
  const out = await I.exportAll(); console.log('T9', out.name, out.json.length);
  const O = JSON.parse(out.json); assert.equal(I.detect(O), 'export'); assert.deepEqual(I.validate('export', O), []);
  I.useStore(I.memoryStore()); s = await I.importFiles([file(out.name, out.json)], {}); assert.equal(s.briefsAdded.length, O.briefs.length);
  // 10. legacy backup array
  I.useStore(I.memoryStore()); s = await I.importFiles([file('old.json', JSON.stringify([JSON.parse(daily)]))], {}); assert.deepEqual(s.briefsAdded, ['2026-11-18']);
  // 11. notes stripped
  const withNotes = Object.assign(JSON.parse(daily), { notes: ['x'] }); I.useStore(I.memoryStore());
  await I.importFiles([file('n.json', JSON.stringify(withNotes))], {}); const all = await I.getBriefs(); assert.ok(!('notes' in all[0].brief));
  console.log('ALL TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
