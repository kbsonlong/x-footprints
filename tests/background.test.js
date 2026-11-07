const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
function setup() {
  let listener; let data = {};
  const api = { storage: { local: {
    get: async () => structuredClone(data),
    set: async value => { await new Promise(resolve => setTimeout(resolve, 1)); data = { ...data, ...structuredClone(value) }; }
  } }, runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), { browser: api, URL, Date, Promise, console, TextEncoder, setTimeout, clearTimeout });
  return { send: message => new Promise(resolve => listener(message, {}, resolve)), get: () => data };
}
function rec(id, time, extra = {}) { return { id: String(id), url: `https://x.com/alice/status/${id}`, author: 'alice', visitedAt: time, ...extra }; }
test('concurrent writes, dedup, oldest eviction and first visit', async () => {
  const { send, get } = setup();
  const t1 = '2026-01-01T00:00:00.000Z', t2 = '2026-01-02T00:00:00.000Z';
  await send({ type: 'settings', settings: { limit: 50 } });
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) => send({ type: 'upsert', record: rec(i + 1, t1, {text: `text ${i}`}) })));
  assert.ok(results.every(r => r.ok)); assert.equal(get().records.length, 50);
  await send({ type: 'upsert', record: rec(1, t2, {text: ''}) });
  let one = get().records.find(r => r.id === '1');
  assert.equal(one.text, 'text 0'); assert.equal(one.firstVisitedAt, t1); assert.equal(one.visitedAt, t2);
  await send({type:'upsert', record:rec(51, t2)});
  assert.equal(get().records.length, 50); assert.ok(get().records.some(r => r.id === '1')); assert.ok(get().records.some(r => r.id === '51'));
});
test('pause, clear, delete and reject invalid URL', async () => {
  const {send, get} = setup(); const t = '2026-01-01T00:00:00.000Z';
  assert.equal((await send({type:'upsert',record:rec(1,t)})).ok,true);
  await send({type:'settings',settings:{paused:true}});
  await send({type:'upsert',record:rec(2,t)}); assert.equal(get().records.length,1);
  await send({type:'clear'}); assert.equal(get().records.length,0); assert.equal(get().settings.paused,true);
  await send({type:'settings',settings:{paused:false}});
  assert.equal((await send({type:'upsert',record:{...rec(3,t),url:'https://example.com/a/status/3'}})).ok,false);
  await send({type:'upsert',record:rec(4,t)}); await send({type:'delete',id:'4'}); assert.equal(get().records.length,0);
});
test('sync retries concurrent updates and merges remote deletions', async () => {
  let listener, data = {}, writes = 0;
  const api = { storage: { local: { get: async () => structuredClone(data), set: async value => { data = { ...data, ...structuredClone(value) }; } } }, runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  const remote = { version: 1, records: [rec(2, '2026-01-02T00:00:00.000Z')], tombstones: { '1': '2026-01-03T00:00:00.000Z' } };
  const fetch = async (url, options) => {
    assert.match(url, /^https:\/\/storage\.example\/bucket\/history\.json$/);
    assert.match(options.headers.Authorization, /^AWS4-HMAC-SHA256 /);
    if (options.method === 'GET') return { ok: true, headers: { get: () => '"version"' }, json: async () => remote };
    assert.equal(options.headers['If-Match'], '"version"');
    writes++;
    if (writes === 1) return { ok: false, status: 412 };
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.records.map(r => r.id), ['2']);
    return { ok: true, status: 200 };
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), { browser: api, URL, Date, Promise, console, TextEncoder, crypto: webcrypto, fetch });
  const send = message => new Promise(resolve => listener(message, {}, resolve));
  await send({ type: 'upsert', record: rec(1, '2026-01-01T00:00:00.000Z') });
  await send({ type: 'config', key: 'syncConfig', value: { endpoint: 'https://storage.example', bucket: 'bucket', objectKey: 'history.json', accessKey: 'key', secretKey: 'secret' } });
  const result = await send({ type: 'sync' });
  assert.equal(result.ok, true);
  assert.equal(writes, 2);
  assert.equal(data.records[0].id, '2');
  assert.equal(result.syncConfig, undefined);
});
test('automatic sync coalesces changes and schedules periodic checks', async () => {
  let listener, data = {};
  const alarms = new Map();
  const timers = [];
  const api = { storage: { local: { get: async () => structuredClone(data), set: async value => { data = { ...data, ...structuredClone(value) }; } } }, runtime: { onMessage: { addListener: fn => { listener = fn; } } }, alarms: { create: (name, options) => alarms.set(name, options), onAlarm: { addListener() {} } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), { browser: api, URL, Date, Promise, console, TextEncoder, setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {} });
  const send = message => new Promise(resolve => listener(message, {}, resolve));
  assert.equal(alarms.get('x-footprints-sync-poll').periodInMinutes, 15);
  await send({ type: 'config', key: 'syncConfig', value: { autoSync: true } });
  await send({ type: 'upsert', record: rec(1, '2026-01-01T00:00:00.000Z') });
  await send({ type: 'upsert', record: rec(2, '2026-01-01T00:00:00.000Z') });
  assert.equal(alarms.get('x-footprints-auto-sync').delayInMinutes, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 10000);
  assert.equal(alarms.size, 2);
});
