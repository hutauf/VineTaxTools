const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');
const DexieModule = require('dexie');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');

const RealDexie = DexieModule.default || DexieModule;
RealDexie.dependencies.indexedDB = indexedDB;
RealDexie.dependencies.IDBKeyRange = IDBKeyRange;

const userscriptPath = path.join(__dirname, '..', 'main_order_tax_cancellations_eval.user.js');
const userscriptSource = fs.readFileSync(userscriptPath, 'utf8');
const uiFixturePath = path.join(__dirname, 'fixtures', 'userscript-ui.html');
const uiFixtureSource = fs.readFileSync(uiFixturePath, 'utf8');

test('userscript metadata version is rendered in the generated box footer', () => {
  const metadataVersion = userscriptSource.match(/^\/\/ @version\s+(\S+)/m)?.[1];
  assert.equal(metadataVersion, '1.114200');
  assert.match(userscriptSource, /const VTT_SCRIPT_VERSION =/);
  assert.match(userscriptSource, /Vine Tax Tools v\$\{escapeHtml\(VTT_SCRIPT_VERSION\)\}/);
  assert.match(userscriptSource, /class="vtt-version-footer"/);
});

class FakeTable {
  constructor(owner, name) {
    this.owner = owner;
    this.name = name;
    this.records = new Map();
  }

  keyFor(recordOrKey) {
    if (Array.isArray(recordOrKey)) return JSON.stringify(recordOrKey);
    if (recordOrKey && typeof recordOrKey === 'object') {
      if (this.name === 'keyValuePairs') return String(recordOrKey.key);
      if (this.name === 'products') return JSON.stringify([recordOrKey.profileId, recordOrKey.asin]);
      if (this.name === 'shadows') return JSON.stringify([recordOrKey.profileId, recordOrKey.entityType, recordOrKey.entityId]);
      if (this.name === 'outbox') return String(recordOrKey.mutationId);
      if (this.name === 'syncState') return String(recordOrKey.profileId);
      if (this.name === 'syncLocks') return String(recordOrKey.profileId);
      if (this.name === 'conflicts' || this.name === 'profiles') return String(recordOrKey.id);
      if (this.name === 'migrationState') return String(recordOrKey.key);
    }
    return String(recordOrKey);
  }

  async ready() {
    await this.owner.ensureOpen();
  }

  async put(record) {
    await this.ready();
    this.records.set(this.keyFor(record), structuredClone(record));
  }

  async bulkPut(records) {
    for (const record of records) await this.put(record);
  }

  async get(key) {
    await this.ready();
    const value = this.records.get(this.keyFor(key));
    return value === undefined ? undefined : structuredClone(value);
  }

  async delete(key) {
    await this.ready();
    this.records.delete(this.keyFor(key));
  }

  async update(key, changes) {
    await this.ready();
    const serializedKey = this.keyFor(key);
    const current = this.records.get(serializedKey);
    if (!current) return 0;
    this.records.set(serializedKey, { ...current, ...structuredClone(changes) });
    return 1;
  }

  async toArray() {
    await this.ready();
    return Array.from(this.records.values(), value => structuredClone(value));
  }

  async count() {
    await this.ready();
    return this.records.size;
  }

  where(index) {
    const table = this;
    const matches = (record, expected) => {
      if (index.startsWith('[') && index.endsWith(']')) {
        const fields = index.slice(1, -1).split('+');
        return fields.every((field, position) => record[field] === expected[position]);
      }
      return record[index] === expected;
    };
    return {
      equals(expected) {
        const selected = async () => {
          await table.ready();
          return Array.from(table.records.entries()).filter(([, record]) => matches(record, expected));
        };
        return {
          toArray: async () => (await selected()).map(([, record]) => structuredClone(record)),
          count: async () => (await selected()).length,
          delete: async () => {
            const entries = await selected();
            entries.forEach(([key]) => table.records.delete(key));
            return entries.length;
          }
        };
      }
    };
  }

  toCollection() {
    return {
      primaryKeys: async () => {
        await this.ready();
        if (this.name === 'keyValuePairs') return Array.from(this.records.values(), record => record.key);
        return Array.from(this.records.keys());
      }
    };
  }
}

class FakeDexie {
  constructor() {
    this.tables = new Map();
    this.upgrades = [];
    this.opening = false;
    this.opened = false;
  }

  version(versionNumber) {
    return {
      stores: schema => {
        for (const name of Object.keys(schema)) {
          if (!this.tables.has(name)) {
            const table = new FakeTable(this, name);
            this.tables.set(name, table);
            this[name] = table;
          }
        }
        return {
          upgrade: callback => {
            this.upgrades.push({ versionNumber, callback });
            return this;
          }
        };
      }
    };
  }

  async ensureOpen() {
    if (this.opened || this.opening) return;
    this.opening = true;
    const transaction = { table: name => this.tables.get(name) };
    for (const upgrade of this.upgrades.sort((a, b) => a.versionNumber - b.versionNumber)) {
      await upgrade.callback(transaction);
    }
    this.opened = true;
    this.opening = false;
  }

  async transaction(_mode, ...args) {
    const callback = args.pop();
    await this.ensureOpen();
    return callback();
  }
}

async function loadUserscript({ DexieImpl = FakeDexie } = {}) {
  const testHook = {};
  const context = vm.createContext({
    __VINE_TAX_TOOLS_TEST_HOOK__: testHook,
    module: { exports: {} },
    Dexie: DexieImpl,
    GM_addStyle() {},
    GM_xmlhttpRequest() {
      throw new Error('Unexpected GM_xmlhttpRequest call');
    },
    GM_setClipboard() {},
    alert() {},
    confirm: () => true,
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    navigator: {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {}
    },
    window: {
      location: { href: 'about:blank', origin: 'https://www.amazon.de' },
      addEventListener() {}
    }
  });
  context.globalThis = context;
  await vm.runInContext(userscriptSource, context, { filename: userscriptPath });
  return { api: testHook, context };
}

test('the userscript has a single Promise-based GM request gateway', () => {
  assert.strictEqual((userscriptSource.match(/GM_xmlhttpRequest\s*\(/g) || []).length, 1);
  assert.strictEqual((userscriptSource.match(/^\/\/ @require /gm) || []).length, 7);
  assert.doesNotMatch(userscriptSource, /console\.log\(\s*['"`]POST /);
  assert.doesNotMatch(userscriptSource, /setFillWidth\(i\s*\*\s*10\)/);
  assert.doesNotMatch(userscriptSource, /toISOString\s*\(/);
  assert.doesNotMatch(userscriptSource, /new Date\s*\(\s*item\.date\s*\)/);
});

test('gmRequest resolves successful responses and propagates HTTP, timeout and invalid JSON errors', async () => {
  const { api, context } = await loadUserscript();

  context.GM_xmlhttpRequest = options => options.onload({ status: 200, responseText: '{"status":"success"}' });
  const response = await api.gmRequest({ method: 'GET', url: 'https://example.test' });
  assert.strictEqual(response.status, 200);

  context.GM_xmlhttpRequest = options => options.onload({ status: 503, responseText: '{}' });
  await assert.rejects(api.gmRequest({ method: 'GET', url: 'https://example.test' }), /HTTP 503/);

  context.GM_xmlhttpRequest = options => options.ontimeout({ status: 0 });
  await assert.rejects(api.gmRequest({ method: 'GET', url: 'https://example.test' }), /timed out/);

  context.GM_xmlhttpRequest = options => options.onload({ status: 200, responseText: 'not json' });
  await assert.rejects(api.postJson('https://example.test', {}), /invalid JSON/);
});

test('private download protects equal unchanged data and full-replaces changed equal or newer remote data', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'redacted-test-token');
  await api.setValue('pythonanywherebackend', 'hutaufvine');

  let remoteTimestamp = 100;
  let remoteValue = JSON.stringify({ name: 'remote-1', etv: 10, fieldRemovedLater: true });
  context.GM_xmlhttpRequest = options => options.onload({
    status: 200,
    responseText: JSON.stringify({
      status: 'success',
      data: [{ ASIN: 'B012345678', last_update_time: remoteTimestamp, value: remoteValue }]
    })
  });

  await handler.downloadDatabase();
  assert.deepStrictEqual(
    JSON.parse(await api.getValue('ASIN_B012345678')),
    { name: 'remote-1', etv: 10, fieldRemovedLater: true }
  );

  await api.setValue('ASIN_B012345678', JSON.stringify({ name: 'local-change', etv: 10, localOnly: true }));
  await handler.downloadDatabase();
  assert.deepStrictEqual(
    JSON.parse(await api.getValue('ASIN_B012345678')),
    { name: 'local-change', etv: 10, localOnly: true }
  );

  remoteValue = JSON.stringify({ name: 'remote-equal-but-changed', etv: 10 });
  await handler.downloadDatabase();
  assert.deepStrictEqual(
    JSON.parse(await api.getValue('ASIN_B012345678')),
    { name: 'remote-equal-but-changed', etv: 10 }
  );

  await api.setValue('ASIN_B012345678', JSON.stringify({ name: 'new-local-change', etv: 10 }));
  await handler.downloadDatabase();
  assert.deepStrictEqual(
    JSON.parse(await api.getValue('ASIN_B012345678')),
    { name: 'new-local-change', etv: 10 }
  );

  remoteTimestamp = 101;
  remoteValue = JSON.stringify({ name: 'remote-2', etv: 11 });
  await handler.downloadDatabase();
  assert.deepStrictEqual(
    JSON.parse(await api.getValue('ASIN_B012345678')),
    { name: 'remote-2', etv: 11 }
  );
});

test('deleting the private database protects local recovery and lets a manual timestamp-zero download win', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'redacted-test-token');
  await api.setValue('pythonanywherebackend', 'hutaufvine');
  await api.setValue('PRIVATE_BACKEND_TIMESTAMP_other_scope_B012345678', 123);

  const remoteValue = JSON.stringify({ name: 'remote-zero', etv: 10 });
  context.GM_xmlhttpRequest = options => {
    const request = JSON.parse(options.data).request;
    const response = request === 'get_all'
      ? {
          status: 'success',
          data: [{ ASIN: 'B012345678', last_update_time: 0, value: remoteValue }]
        }
      : { status: 'success' };
    options.onload({ status: 200, responseText: JSON.stringify(response) });
  };

  await handler.downloadDatabase();
  await api.updateStoredProduct('B012345678', () => ({ name: 'local-after-download', etv: 10 }));
  const config = await handler.getPrivateConfig();
  await api.db.syncState.put({ profileId: config.profileId, mode: 'v2', generationId: 'old', cursor: 1 });
  await api.db.shadows.put({
    profileId: config.profileId,
    entityType: 'product',
    entityId: 'B012345678',
    recordRevision: 1,
    data: { name: 'remote-zero', etv: 10 }
  });
  await api.db.conflicts.put({
    id: 'delete-test-conflict',
    profileId: config.profileId,
    entityType: 'product',
    entityId: 'B012345678',
    status: 'open'
  });
  await handler.deleteDatabase();
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).name, 'local-after-download');
  assert.strictEqual(await api.db.outbox.count(), 0);
  assert.strictEqual(await api.db.shadows.count(), 1);
  assert.strictEqual(await api.db.conflicts.count(), 0);
  const recoveryState = await api.db.syncState.get(config.profileId);
  assert.strictEqual(recoveryState.remoteDeleteRecovery, true);
  assert.strictEqual(recoveryState.snapshotRequired, true);
  assert.strictEqual(await api.getValue(handler.getV1UploadSuppressionKey(config)), true);
  await handler.downloadDatabase();

  assert.deepStrictEqual(
    JSON.parse(await api.getValue('ASIN_B012345678')),
    { name: 'remote-zero', etv: 10 }
  );
  assert.strictEqual(
    await api.getValue('PRIVATE_BACKEND_TIMESTAMP_other_scope_B012345678'),
    123
  );
});

test('private download normalizes a backend ISO date locally without writing it back', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'redacted-test-token');
  await api.setValue('pythonanywherebackend', 'hutaufvine');

  const requests = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body.request);
    options.onload({
      status: 200,
      responseText: JSON.stringify({
        status: 'success',
        data: [{
          ASIN: 'B012345678',
          last_update_time: 42,
          value: JSON.stringify({ name: 'Product', date: '2025-03-30T23:00:00.000Z', etv: 10 })
        }]
      })
    });
  };

  await handler.downloadDatabase();

  assert.deepStrictEqual(requests, ['get_all']);
  assert.strictEqual(
    JSON.parse(await api.getValue('ASIN_B012345678')).date,
    '30/03/2025'
  );
});

test('private download merges ASIN case variants and writes one canonical correction', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'redacted-test-token');
  await api.setValue('pythonanywherebackend', 'hutaufvine');

  const requests = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body);
    const response = body.request === 'get_all'
      ? {
          status: 'success',
          data: [
            {
              ASIN: 'b012345678',
              last_update_time: 10,
              value: JSON.stringify({
                name: 'older',
                date: '2025-05-04T23:00:00.000Z',
                olderUnknown: true
              })
            },
            {
              ASIN: 'B012345678',
              last_update_time: 20,
              value: JSON.stringify({ name: 'newer', newerUnknown: true })
            }
          ]
        }
      : { status: 'success', inserted: 0, updated: 1, skipped: 0 };
    options.onload({ status: 200, responseText: JSON.stringify(response) });
  };

  const result = await handler.downloadDatabase();
  const localProduct = JSON.parse(await api.getValue('ASIN_B012345678'));
  const correction = requests[1].payload[0];
  const correctedValue = JSON.parse(correction.value);

  assert.strictEqual(result.canonicalized, 1);
  assert.deepStrictEqual(requests.map(request => request.request), ['get_all', 'update_asin']);
  assert.strictEqual(correction.ASIN, 'B012345678');
  assert.strictEqual(correction.timestamp, 0);
  assert.strictEqual(correctedValue.name, 'newer');
  assert.strictEqual(correctedValue.olderUnknown, true);
  assert.strictEqual(correctedValue.newerUnknown, true);
  assert.strictEqual(correctedValue.date, '04/05/2025');
  assert.deepStrictEqual(localProduct, correctedValue);
});

test('local startup validation merges lowercase ASIN keys into the canonical key', async () => {
  const { api } = await loadUserscript();
  api.db.keyValuePairs.records.set('ASIN_b012345678', {
    key: 'ASIN_b012345678',
    value: JSON.stringify({
    name: 'lowercase',
    olderUnknown: true,
    last_update_time: 10
    })
  });
  api.db.keyValuePairs.records.set('ASIN_B012345678', {
    key: 'ASIN_B012345678',
    value: JSON.stringify({
    name: 'canonical',
    newerUnknown: true,
    last_update_time: 20
    })
  });

  await api.validateAndFixDatabase();

  const canonical = JSON.parse(await api.getValue('ASIN_B012345678'));
  assert.strictEqual(api.db.keyValuePairs.records.has('ASIN_b012345678'), false);
  assert.strictEqual(canonical.name, 'canonical');
  assert.strictEqual(canonical.olderUnknown, true);
  assert.strictEqual(canonical.newerUnknown, true);
});

test('Dexie v2 migration preserves config and unknown fields while quarantining corrupt legacy rows', async () => {
  const { api } = await loadUserscript();
  api.db.keyValuePairs.records.set('token', { key: 'token', value: 'migration-token' });
  api.db.keyValuePairs.records.set('pythonanywherebackend', {
    key: 'pythonanywherebackend',
    value: 'hutaufvine'
  });
  api.db.keyValuePairs.records.set('settings', {
    key: 'settings',
    value: { tax0: true, customSetting: 'keep' }
  });
  api.db.keyValuePairs.records.set('ASIN_b012345678', {
    key: 'ASIN_b012345678',
    value: JSON.stringify({ name: 'older', last_update_time: 1, unknown_old: { keep: true } })
  });
  api.db.keyValuePairs.records.set('ASIN_B012345678', {
    key: 'ASIN_B012345678',
    value: JSON.stringify({ name: 'newer', last_update_time: 2, unknown_new: ['keep'] })
  });
  api.db.keyValuePairs.records.set('ASIN_B087654321', {
    key: 'ASIN_B087654321',
    value: '{broken-json'
  });

  const migration = await api.db.migrationState.get('legacy-products-v2');
  const profileId = api.buildLocalProfileId('migration-token', 'hutaufvine');
  const migrated = await api.db.products.get([profileId, 'B012345678']);

  assert.strictEqual(migration.migrated, 1);
  assert.strictEqual(migration.quarantined.length, 1);
  assert.match(migration.quarantined[0].reason, /JSON|position/i);
  assert.strictEqual(migrated.data.name, 'newer');
  assert.deepStrictEqual(migrated.data.unknown_old, { keep: true });
  assert.deepStrictEqual(migrated.data.unknown_new, ['keep']);
  assert.strictEqual(api.db.keyValuePairs.records.has('ASIN_b012345678'), false);
  assert.strictEqual(api.db.keyValuePairs.records.has('ASIN_B012345678'), false);
  assert.strictEqual(api.db.keyValuePairs.records.has('ASIN_B087654321'), true);
  assert.strictEqual(await api.getValue('token'), 'migration-token');
  assert.deepStrictEqual(await api.getValue('settings'), { tax0: true, customSetting: 'keep' });
  assert.strictEqual(await api.db.outbox.count(), 1);

  await api.db.ensureOpen();
  assert.strictEqual((await api.db.products.where('profileId').equals(profileId).toArray()).length, 1);
  assert.strictEqual(await api.db.outbox.count(), 1);
});

test('the production Dexie 4 schema upgrades a real fake-indexeddb v1 database atomically', async () => {
  await RealDexie.delete('myDatabase');
  const legacy = new RealDexie('myDatabase');
  legacy.version(1).stores({ keyValuePairs: 'key' });
  await legacy.open();
  await legacy.table('keyValuePairs').bulkPut([
    { key: 'token', value: 'real-dexie-token' },
    { key: 'pythonanywherebackend', value: 'hutaufvine' },
    {
      key: 'ASIN_B012345678',
      value: JSON.stringify({ name: 'Real migration', etv: 9, unknown_real_field: { nested: true } })
    }
  ]);
  legacy.close();

  let api;
  try {
    ({ api } = await loadUserscript({ DexieImpl: RealDexie }));
    await api.db.open();
    const profileId = api.buildLocalProfileId('real-dexie-token', 'hutaufvine');
    const product = await api.db.products.get([profileId, 'B012345678']);
    const migration = await api.db.migrationState.get('legacy-products-v2');

    assert.strictEqual(product.data.name, 'Real migration');
    assert.deepStrictEqual(product.data.unknown_real_field, { nested: true });
    assert.strictEqual(migration.migrated, 1);
    assert.strictEqual(await api.db.keyValuePairs.get('ASIN_B012345678'), undefined);
    assert.strictEqual((await api.db.outbox.toArray()).length, 1);
    assert.deepStrictEqual(api.db.tables.map(table => table.name).sort(), [
      'conflicts',
      'keyValuePairs',
      'migrationState',
      'outbox',
      'products',
      'profiles',
      'shadows',
      'syncLocks',
      'syncState'
    ]);
  } finally {
    api?.db?.close();
    await RealDexie.delete('myDatabase');
  }
});

test('local-only and private backend profiles never silently share mutable product rows', async () => {
  const { api } = await loadUserscript();
  await api.setValue('ASIN_B012345678', JSON.stringify({ name: 'Local original', etv: 1 }));
  const binding = await api.bindLocalProfileToPrivateProfile(
    'local-only',
    'isolated-profile-token',
    'hutaufvine'
  );
  await api.setValue('pythonanywherebackend', 'hutaufvine');
  await api.setValue('token', 'isolated-profile-token');
  assert.strictEqual(binding.copied, 1);
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).name, 'Local original');

  await api.updateStoredProduct('B012345678', current => ({ ...current, name: 'Private edit' }));
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).name, 'Private edit');

  await api.setValue('token', '');
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).name, 'Local original');
  assert.notStrictEqual(binding.profileId, 'local-only');
});

test('switching between two private backends never copies or merges account data', async () => {
  const { api } = await loadUserscript();
  await api.setValue('token', 'private-account-a');
  await api.setValue('pythonanywherebackend', 'backend-a');
  const profileA = await api.getActiveProfileId();
  await api.setValue('ASIN_B012345678', JSON.stringify({ name: 'Account A only', secretProbe: true }));

  const binding = await api.bindLocalProfileToPrivateProfile(
    profileA,
    'private-account-b',
    'backend-b'
  );
  assert.strictEqual(binding.copied, 0);
  assert.strictEqual(binding.switched, true);
  assert.notStrictEqual(binding.profileId, profileA);
  assert.strictEqual(
    await api.db.products.where('profileId').equals(binding.profileId).count(),
    0
  );
  assert.strictEqual(
    (await api.db.products.get([profileA, 'B012345678'])).data.name,
    'Account A only'
  );
  assert.strictEqual(
    await api.db.outbox.where('profileId').equals(binding.profileId).count(),
    0
  );
});

test('binding local-only data refuses to merge into an already populated private profile', async () => {
  const { api } = await loadUserscript();
  await api.setValue('ASIN_B012345678', JSON.stringify({ name: 'Local original' }));
  const targetProfileId = api.buildLocalProfileId(
    'already-populated-token',
    'hutaufvine'
  );
  await api.db.products.put(api.createProductRow(
    targetProfileId,
    'B087654321',
    { name: 'Existing remote-profile product' },
    7
  ));

  await assert.rejects(
    api.bindLocalProfileToPrivateProfile(
      'local-only',
      'already-populated-token',
      'hutaufvine'
    ),
    /automatisches Vermischen wurde verhindert/
  );

  assert.strictEqual(
    await api.db.products.where('profileId').equals(targetProfileId).count(),
    1
  );
  assert.strictEqual(
    await api.db.outbox.where('profileId').equals(targetProfileId).count(),
    0
  );
});

test('syncProducts serializes overlapping runs and coalesces pending values per ASIN', async () => {
  const { api } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  const batches = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });

  handler.syncProductsBatch = async products => {
    batches.push(products.map(product => ({ ...product })));
    if (batches.length === 1) await firstGate;
    return { count: products.length };
  };

  const first = handler.syncProducts([{ ASIN: 'B012345678', name: 'first' }]);
  await new Promise(resolve => setTimeout(resolve, 0));
  const second = handler.syncProducts([{ ASIN: 'B012345678', name: 'second' }]);
  releaseFirst();
  await Promise.all([first, second]);

  assert.strictEqual(batches.length, 2);
  assert.strictEqual(batches[0][0].name, 'first');
  assert.strictEqual(batches[1][0].name, 'second');
});

test('syncProducts drains pending batches after a failure and rejects only after the drain completes', async () => {
  const { api } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  const batches = [];
  let releaseFirst;
  let releaseSecond;
  let signalSecondStarted;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise(resolve => {
    releaseSecond = resolve;
  });
  const secondStarted = new Promise(resolve => {
    signalSecondStarted = resolve;
  });

  handler.syncProductsBatch = async products => {
    batches.push(products.map(product => ({ ...product })));
    if (batches.length === 1) {
      await firstGate;
      throw new Error('first batch failed');
    }
    signalSecondStarted();
    await secondGate;
    return { count: products.length };
  };

  const first = handler.syncProducts([{ ASIN: 'B012345678', name: 'first' }]);
  let settled = false;
  const observed = first.then(
    value => {
      settled = true;
      return { value };
    },
    error => {
      settled = true;
      return { error };
    }
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  const second = handler.syncProducts([{ ASIN: 'B087654321', name: 'second' }]);
  assert.strictEqual(second, first);

  releaseFirst();
  await secondStarted;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(settled, false);

  releaseSecond();
  const outcome = await observed;
  assert.match(outcome.error.message, /first batch failed/);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(batches.map(batch => batch.map(product => product.name)))),
    [['first'], ['second']]
  );

  const recovery = await handler.syncProducts([{ ASIN: 'B000000001', name: 'recovery' }]);
  assert.deepStrictEqual(recovery, { count: 1 });
});

test('public estimator and private v1 DTOs retain their existing shapes', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('last_full_sync', Date.now());
  await api.setValue('ASIN_B012345678', JSON.stringify({
    name: 'Product',
    ordernumber: '123',
    date: '2025-01-01T00:00:00.000Z',
    etv: 12.34
  }));

  const requests = [];
  const legacyServer = new Map();
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push({ url: options.url, body });
    if (body?.request === 'get_capabilities_v2') {
      options.onload({
        status: 400,
        responseText: '{"status":"error","message":"Unknown request type: get_capabilities_v2"}'
      });
    } else if (body?.request === 'update_asin') {
      body.payload.forEach(entry => legacyServer.set(entry.ASIN, entry));
      options.onload({ status: 200, responseText: '{"status":"success","updated":1}' });
    } else if (body?.request === 'get_asin') {
      options.onload({
        status: 200,
        responseText: JSON.stringify({
          status: 'success',
          data: body.payload.map(asin => legacyServer.get(asin)).filter(Boolean)
        })
      });
    } else {
      options.onload({ status: 200, responseText: '{"status":"success","existing_asins":[]}' });
    }
  };
  await handler.syncProducts([{ ASIN: 'B012345678', name: 'Product', etv: 12.34 }]);
  assert.deepStrictEqual(Object.keys(requests[0].body[0]).sort(), ['ASIN', 'ETV', 'name']);

  requests.length = 0;
  await api.setValue('token', 'redacted-test-token');
  await api.setValue('pythonanywherebackend', 'hutaufvine');
  await api.setValue('ASIN_B012345678', JSON.stringify({
    name: 'Product',
    ordernumber: '123',
    date: '2025-01-01T00:00:00.000Z',
    etv: 12.34,
    pdf: 'https://example.test/report.pdf',
    teilwert_v2: 5,
    myTeilwert: 99,
    myteilwert: null,
    usageStatus: [],
    verkauft: true
  }));
  await handler.syncProducts([{
    ASIN: 'B012345678',
    name: 'Product',
    etv: 12.34,
    pdf: 'https://example.test/report.pdf',
    teilwert_v2: 5
  }]);

  const updateRequest = requests.find(request => request.body?.request === 'update_asin');
  assert.deepStrictEqual(Object.keys(updateRequest.body).sort(), ['payload', 'request', 'token']);
  assert.strictEqual(updateRequest.body.request, 'update_asin');
  assert.deepStrictEqual(Object.keys(updateRequest.body.payload[0]).sort(), ['ASIN', 'timestamp', 'value']);
  assert.strictEqual(updateRequest.body.payload[0].timestamp, 0);
  const privateValue = JSON.parse(updateRequest.body.payload[0].value);
  assert.strictEqual(Object.hasOwn(privateValue, 'ASIN'), false);
  assert.strictEqual(privateValue.myteilwert, null);
  assert.strictEqual(privateValue.myTeilwert, null);
  assert.strictEqual(privateValue.date, '01/01/2025');
  assert.strictEqual(privateValue.verkauft, true);
  assert.strictEqual(privateValue.usageStatus.includes('verkauft'), true);
});

test('legacy V1 auto-upload remains suppressed after a deliberate remote delete', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'suppressed-v1-token');
  await api.setValue('pythonanywherebackend', 'hutaufvine');
  await api.setValue('last_full_sync', Date.now());
  await api.setValue('ASIN_B012345678', JSON.stringify({
    name: 'Local recovery',
    etv: 1,
    pdf: 'https://example.test/done.pdf',
    teilwert_v2: 1
  }));
  const config = await handler.getPrivateConfig();
  await api.setValue(handler.getV1UploadSuppressionKey(config), true);
  const requests = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body.request || 'public-estimator');
    options.onload({
      status: 400,
      responseText: '{"status":"error","message":"Unknown request type: get_capabilities_v2"}'
    });
  };

  await handler.syncProducts([{
    ASIN: 'B012345678',
    name: 'Local recovery',
    etv: 1,
    pdf: 'https://example.test/done.pdf',
    teilwert_v2: 1
  }]);

  assert.deepStrictEqual(requests, ['get_capabilities_v2']);
  assert.strictEqual(await api.getValue('ASIN_B012345678') !== null, true);
});

test('V2 danger-zone delete preserves recovery and gives explicit edits a fresh baseline', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'v2-delete-recovery-token');
  await api.setValue('ASIN_B012345678', JSON.stringify({
    name: 'Protected local recovery', etv: 4, unknown_local_backup: true
  }));
  const config = await handler.getPrivateConfig();
  await api.db.outbox.where('profileId').equals(config.profileId).delete();
  await api.db.shadows.put({
    profileId: config.profileId,
    entityType: 'product',
    entityId: 'B012345678',
    recordRevision: 7,
    data: { name: 'Previously confirmed', etv: 4 }
  });
  await api.db.syncState.put({
    profileId: config.profileId,
    mode: 'v2',
    generationId: 'generation-before-delete',
    cursor: 7,
    lastHash: 'old-hash',
    capabilityCheckedAt: Date.now()
  });
  const emptyHash = await api.sha256Hex(api.canonicalizeJson([]));
  const requests = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body.request);
    const response = body.request === 'sync_v2_snapshot'
      ? {
          status: 'success', session_id: 'after-delete', generation_id: 'generation-after-delete',
          snapshot_revision: 0, records: [], next_offset: 0, has_more: false,
          dataset_hash: emptyHash
        }
      : body.request === 'sync_v2_pull'
        ? {
            status: 'success', generation_id: 'generation-after-delete', changes: [],
            next_cursor: 0, current_revision: 0, min_available_revision: 0,
            has_more: false, dataset_hash: emptyHash
          }
        : { status: 'success' };
    options.onload({ status: 200, responseText: JSON.stringify(response) });
  };

  await handler.deleteDatabase(config);
  await handler.syncPrivateV2(config, { generation_id: 'generation-after-delete' });

  assert.deepStrictEqual(requests, ['delete_all', 'sync_v2_snapshot', 'sync_v2_pull']);
  const recovery = JSON.parse(await api.getValue('ASIN_B012345678'));
  assert.strictEqual(recovery.name, 'Protected local recovery');
  assert.strictEqual(recovery.unknown_local_backup, true);
  const recoveryRow = await api.db.products.get([config.profileId, 'B012345678']);
  assert.strictEqual(recoveryRow.recordRevision, 0);
  assert.strictEqual(await api.db.outbox.count(), 0);
  assert.strictEqual(await api.db.shadows.count(), 0);
  const state = await api.db.syncState.get(config.profileId);
  assert.strictEqual(state.generationId, 'generation-after-delete');
  assert.strictEqual(state.remoteDeleteRecovery, true);
  assert.strictEqual(state.lastHash, emptyHash);

  await api.updateStoredProduct('B012345678', current => ({
    ...current,
    name: 'Explicitly recreate locally'
  }));
  const explicitMutation = (await api.db.outbox.toArray())[0];
  assert.strictEqual(explicitMutation.baseRevision, 0);
});

test('V2 repairs an already stuck base-revision-ahead recovery mutation', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'v2-base-repair-token');
  const config = await handler.getPrivateConfig();
  const localData = {
    name: 'Local recovery copy',
    etv: 4,
    unknown_local_backup: true
  };
  const serverData = {
    ...localData,
    name: 'Recreated after repair'
  };
  const emptyHash = await api.sha256Hex(api.canonicalizeJson([]));
  const serverHash = await api.sha256Hex(api.canonicalizeJson([{
    entity_type: 'product',
    entity_id: 'B012345678',
    data: serverData
  }]));
  await api.db.products.put(api.createProductRow(
    config.profileId,
    'B012345678',
    localData,
    7
  ));
  const mutation = api.createOutboxMutation({
    profileId: config.profileId,
    entityType: 'product',
    entityId: 'B012345678',
    baseRevision: 7,
    set: serverData,
    source: 'local-edit'
  });
  mutation.attempts = 1;
  await api.db.outbox.put(mutation);
  await api.db.syncState.put({
    profileId: config.profileId,
    mode: 'v2',
    generationId: 'new-generation',
    cursor: 1,
    lastHash: emptyHash,
    lastSnapshotAt: Date.now(),
    lastHashVerifiedAt: Date.now(),
    remoteDeleteRecovery: true
  });

  const requests = [];
  const pushedBases = [];
  const pushedMutationIds = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body.request);
    let status = 200;
    let response;
    if (body.request === 'sync_v2_push') {
      const pushed = body.payload.mutations[0];
      pushedBases.push(pushed.base_revision);
      pushedMutationIds.push(pushed.mutation_id);
      if (pushedBases.length === 1) {
        status = 409;
        response = {
          status: 'error',
          code: 'base_revision_ahead',
          message: 'A mutation base revision is ahead of the server.',
          generation_id: 'new-generation',
          current_revision: 1,
          min_available_revision: 0
        };
      } else {
        response = {
          status: 'success',
          generation_id: 'new-generation',
          current_revision: 2,
          results: [{
            mutation_id: pushed.mutation_id,
            status: 'applied',
            revision: 2,
            data: serverData
          }]
        };
      }
    } else if (body.request === 'sync_v2_snapshot') {
      response = {
        status: 'success',
        session_id: 'base-repair-snapshot',
        generation_id: 'new-generation',
        snapshot_revision: 1,
        records: [],
        next_offset: 0,
        has_more: false,
        dataset_hash: emptyHash
      };
    } else if (body.request === 'sync_v2_pull') {
      response = {
        status: 'success',
        generation_id: 'new-generation',
        changes: [],
        next_cursor: 2,
        current_revision: 2,
        min_available_revision: 0,
        has_more: false,
        dataset_hash: serverHash
      };
    } else {
      throw new Error(`Unexpected request ${body.request}`);
    }
    options.onload({ status, responseText: JSON.stringify(response) });
  };

  await handler.syncPrivateV2(config, { generation_id: 'new-generation' });

  assert.deepStrictEqual(requests, [
    'sync_v2_push',
    'sync_v2_snapshot',
    'sync_v2_push',
    'sync_v2_pull'
  ]);
  assert.deepStrictEqual(pushedBases, [7, 0]);
  assert.strictEqual(pushedMutationIds[0], mutation.mutationId);
  assert.strictEqual(pushedMutationIds[1], mutation.mutationId);
  assert.strictEqual(await api.db.outbox.count(), 0);
  assert.strictEqual(
    (await api.db.shadows.get([config.profileId, 'product', 'B012345678'])).recordRevision,
    2
  );
  assert.strictEqual(
    (await api.db.products.get([config.profileId, 'B012345678'])).recordRevision,
    2
  );
  assert.strictEqual((await api.db.syncState.get(config.profileId)).remoteDeleteRecovery, false);
});

test('canonical V2 dataset hashing is deterministic and excludes revisions', async () => {
  const { api } = await loadUserscript();
  const dataset = [{
    entity_type: 'product',
    entity_id: 'B000000001',
    data: {
      text: 'line\n"x"',
      nested: { '😀': -0, 'ä': 'Grüße', z: 1.0 },
      array: [null, true, false, 0.000001, 1e-7, 1e21]
    }
  }];
  const canonical = api.canonicalizeJson(dataset);
  const expected = createHash('sha256').update(canonical, 'utf8').digest('hex');

  assert.strictEqual(
    canonical,
    '[{"data":{"array":[null,true,false,0.000001,1e-7,1e+21],"nested":{"z":1,"ä":"Grüße","😀":0},"text":"line\\n\\"x\\""},"entity_id":"B000000001","entity_type":"product"}]'
  );
  assert.strictEqual(await api.sha256Hex(canonical), expected);
  assert.strictEqual(expected, '8d181042a53c24f744c7fbb6a64ff54ee4b1119c1cbec6295a0ee5b67d689d58');
  assert.strictEqual(canonical.includes('record_revision'), false);
});

test('V2 sync pushes a durable outbox and pulls even when startup has no product list', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'v2-test-token');
  await api.setValue('pythonanywherebackend', 'hutaufvine');
  await api.setValue('last_full_sync', Date.now());
  await api.updateStoredProduct('B012345678', () => ({
    name: 'Offline edit',
    etv: 12.5,
    usageStatus: ['verkauft'],
    unknown_client_field: { kept: true }
  }), { createIfMissing: true });

  const config = await handler.getPrivateConfig();
  const queued = await api.db.outbox.where('[profileId+status]').equals([config.profileId, 'pending']).toArray();
  assert.strictEqual(queued.length, 1);
  const serverData = JSON.parse(JSON.stringify(queued[0].set));
  const datasetHash = await api.sha256Hex(api.canonicalizeJson([{
    entity_type: 'product',
    entity_id: 'B012345678',
    data: serverData
  }]));
  const emptyHash = await api.sha256Hex(api.canonicalizeJson([]));
  const requests = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body);
    let response;
    if (body.request === 'get_capabilities_v2') {
      response = {
        status: 'success',
        protocol_version: 2,
        generation_id: 'generation-1',
        current_revision: 0,
        dataset_hash: emptyHash,
        features: { push_pull_exchange: true, authoritative_status_fields: true },
        limits: { pull_changes: 500 }
      };
    } else if (body.request === 'sync_v2_snapshot') {
      response = {
        status: 'success',
        session_id: 'initial-empty-snapshot',
        generation_id: 'generation-1',
        snapshot_revision: 0,
        records: [],
        next_offset: 0,
        has_more: false,
        dataset_hash: emptyHash
      };
    } else if (body.request === 'sync_v2_push') {
      response = {
        status: 'success',
        generation_id: 'generation-1',
        current_revision: 1,
        results: body.payload.mutations.map(mutation => ({
          mutation_id: mutation.mutation_id,
          status: 'applied',
          revision: 1,
          data: serverData
        })),
        changes: [{
          revision: 1,
          entity_type: 'product',
          entity_id: 'B012345678',
          operation: 'upsert',
          set: serverData,
          unset: [],
          data: serverData,
          record_revision: 1
        }],
        next_cursor: 1,
        min_available_revision: 0,
        has_more: false,
        dataset_hash: null
      };
    } else {
      throw new Error(`Unexpected request ${body.request}`);
    }
    options.onload({ status: 200, responseText: JSON.stringify(response) });
  };

  const result = await handler.syncProducts([]);
  const shadow = await api.db.shadows.get([config.profileId, 'product', 'B012345678']);

  assert.deepStrictEqual(requests.map(item => item.request), [
    'get_capabilities_v2',
    'sync_v2_snapshot',
    'sync_v2_push'
  ]);
  const pushRequest = requests.find(item => item.request === 'sync_v2_push');
  assert.strictEqual(pushRequest.payload.pull_since, 0);
  assert.strictEqual(pushRequest.payload.mutations[0].authoritative_fields.includes('usageStatus'), true);
  assert.strictEqual(pushRequest.payload.mutations[0].authoritative_fields.includes('verkauft'), true);
  assert.strictEqual(result.privateSync, true);
  assert.strictEqual(await api.db.outbox.count(), 0);
  assert.strictEqual(shadow.recordRevision, 1);
  assert.deepStrictEqual(shadow.data.unknown_client_field, { kept: true });
});

test('V2 initial bootstrap reconciles legacy timestamps without overwriting newer server data', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'bootstrap-timestamp-token');
  const config = await handler.getPrivateConfig();

  const staleLocal = {
    name: 'stale local',
    etv: 1,
    last_update_time: 10
  };
  const newerLocal = {
    name: 'newer local',
    etv: 2,
    localUnknown: true,
    last_update_time: 30
  };
  const localOnly = {
    name: 'local only',
    etv: 3,
    last_update_time: 5
  };
  for (const [asin, value] of [
    ['B000000101', staleLocal],
    ['B000000102', newerLocal],
    ['B000000103', localOnly]
  ]) {
    await api.db.products.put(api.createProductRow(config.profileId, asin, value, 0));
    await api.db.outbox.put(api.createOutboxMutation({
      profileId: config.profileId,
      entityType: 'product',
      entityId: asin,
      set: value,
      source: 'legacy-migration',
      legacyTimestamp: value.last_update_time
    }));
  }

  const serverStaleLocal = {
    name: 'newer server',
    etv: 1,
    serverUnknown: 'preserve'
  };
  const serverOlderLocal = {
    name: 'older server',
    etv: 2,
    serverUnknown: 'must survive'
  };
  const records = [
    {
      entity_type: 'product',
      entity_id: 'B000000101',
      record_revision: 4,
      legacy_last_update_time: 20,
      data: serverStaleLocal
    },
    {
      entity_type: 'product',
      entity_id: 'B000000102',
      record_revision: 5,
      legacy_last_update_time: 20,
      data: serverOlderLocal
    }
  ];
  const expectedHash = await api.sha256Hex(api.canonicalizeJson(records.map(record => ({
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    data: record.data
  }))));
  // Capability detection persists the current generation before the first
  // snapshot; this must still count as the one-time legacy bootstrap.
  await api.db.syncState.put({
    profileId: config.profileId,
    mode: 'v2',
    generationId: 'bootstrap-generation',
    cursor: 0
  });
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    assert.strictEqual(body.request, 'sync_v2_snapshot');
    options.onload({
      status: 200,
      responseText: JSON.stringify({
        status: 'success',
        session_id: 'bootstrap-timestamp-session',
        generation_id: 'bootstrap-generation',
        snapshot_revision: 5,
        records,
        next_offset: records.length,
        has_more: false,
        dataset_hash: expectedHash
      })
    });
  };

  await handler.replaceFromV2Snapshot(config, 'bootstrap-generation', 'initial-bootstrap');

  const pending = await api.db.outbox.where('profileId').equals(config.profileId).toArray();
  assert.deepStrictEqual(pending.map(mutation => mutation.entityId).sort(), [
    'B000000102',
    'B000000103'
  ]);
  assert.deepStrictEqual(
    pending.find(mutation => mutation.entityId === 'B000000102').set,
    { name: 'newer local', localUnknown: true }
  );
  assert.deepStrictEqual(
    pending.find(mutation => mutation.entityId === 'B000000103').set,
    { name: 'local only', etv: 3 }
  );

  const staleProduct = await api.db.products.get([config.profileId, 'B000000101']);
  assert.strictEqual(staleProduct.data.name, 'newer server');
  assert.strictEqual(staleProduct.data.serverUnknown, 'preserve');
  assert.strictEqual(staleProduct.data.last_update_time, 20);
  const newerProduct = await api.db.products.get([config.profileId, 'B000000102']);
  assert.strictEqual(newerProduct.data.name, 'newer local');
  assert.strictEqual(newerProduct.data.serverUnknown, 'must survive');
  const localOnlyProduct = await api.db.products.get([config.profileId, 'B000000103']);
  assert.strictEqual(localOnlyProduct.data.name, 'local only');
  assert.strictEqual(localOnlyProduct.data.last_update_time, 5);
});

test('V2 retries preserve the mutation ID after a network failure following a possible commit', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'retry-test-token');
  await api.updateStoredProduct('B012345678', () => ({ name: 'Retry me', etv: 1 }), {
    createIfMissing: true
  });
  const config = await handler.getPrivateConfig();
  const original = (await api.db.outbox.toArray())[0];
  const sentMutationIds = [];

  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    sentMutationIds.push(body.payload.mutations[0].mutation_id);
    options.onerror({ status: 0 });
  };
  await assert.rejects(handler.pushV2Outbox(config, 'generation-1'), /Network error/);
  const afterFailure = await api.db.outbox.get(original.mutationId);
  assert.strictEqual(afterFailure.attempts, 1);
  assert.ok(afterFailure.nextAttemptAt > Date.now());

  await api.db.outbox.update(original.mutationId, { nextAttemptAt: 0 });
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    sentMutationIds.push(body.payload.mutations[0].mutation_id);
    options.onload({
      status: 200,
      responseText: JSON.stringify({
        status: 'success',
        results: [{ mutation_id: original.mutationId, status: 'noop', revision: 1 }]
      })
    });
  };
  const result = await handler.pushV2Outbox(config, 'generation-1');

  assert.deepStrictEqual(sentMutationIds, [original.mutationId, original.mutationId]);
  assert.strictEqual(result.pushed, 1);
  assert.strictEqual(await api.db.outbox.count(), 0);
});

test('a stale V2 acknowledgement cannot roll back a newer shadow revision', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'stale-ack-token');
  const config = await handler.getPrivateConfig();
  const asin = 'B012345678';
  const base = { name: 'revision 5', etv: 5 };
  await api.db.shadows.put({
    profileId: config.profileId,
    entityType: 'product',
    entityId: asin,
    recordRevision: 5,
    data: base
  });
  await api.db.products.put(api.createProductRow(config.profileId, asin, base, 5));
  await api.updateStoredProduct(asin, current => ({ ...current, name: 'local edit' }));

  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    assert.strictEqual(body.request, 'sync_v2_push');
    void (async () => {
      const newer = { name: 'revision 7', etv: 5 };
      await api.db.shadows.put({
        profileId: config.profileId,
        entityType: 'product',
        entityId: asin,
        recordRevision: 7,
        data: newer
      });
      await api.db.products.put(api.createProductRow(config.profileId, asin, newer, 7));
      options.onload({
        status: 200,
        responseText: JSON.stringify({
          status: 'success',
          generation_id: 'generation-1',
          current_revision: 7,
          results: body.payload.mutations.map(mutation => ({
            mutation_id: mutation.mutation_id,
            status: 'applied',
            revision: 6,
            data: { name: 'stale acknowledgement', etv: 5 }
          }))
        })
      });
    })();
  };

  await handler.pushV2Outbox(config, 'generation-1');
  const shadow = await api.db.shadows.get([config.profileId, 'product', asin]);
  const product = await api.db.products.get([config.profileId, asin]);
  assert.strictEqual(shadow.recordRevision, 7);
  assert.strictEqual(shadow.data.name, 'revision 7');
  assert.strictEqual(product.recordRevision, 7);
  assert.strictEqual(product.data.name, 'revision 7');
  assert.strictEqual(await api.db.outbox.count(), 0);
});

test('V2 serializes two edits of one ASIN without creating a self-conflict', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'same-asin-race-token');
  await api.updateStoredProduct('B012345678', () => ({ name: 'First local edit', etv: 1 }), {
    createIfMissing: true
  });
  const firstMutation = (await api.db.outbox.toArray())[0];
  await api.updateStoredProduct('B012345678', current => ({
    ...current,
    name: 'Second local edit'
  }));
  const coalesced = await api.db.outbox.toArray();

  assert.strictEqual(coalesced.length, 1);
  assert.strictEqual(coalesced[0].mutationId, firstMutation.mutationId);
  assert.strictEqual(coalesced[0].set.name, 'Second local edit');
  // Even a corrupt/future local creation time must never produce a negative
  // age on the wire.
  await api.db.outbox.update(coalesced[0].mutationId, { createdAt: Date.now() + 60_000 });

  const config = await handler.getPrivateConfig();
  const wireMutations = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    wireMutations.push(body.payload.mutations[0]);
    options.onload({
      status: 200,
      responseText: JSON.stringify({
        status: 'success',
        results: [{
          mutation_id: body.payload.mutations[0].mutation_id,
          status: 'applied',
          revision: 1
        }]
      })
    });
  };
  const result = await handler.pushV2Outbox(config, 'generation-1');

  assert.strictEqual(result.pushed, 1);
  assert.strictEqual(wireMutations.length, 1);
  assert.strictEqual(wireMutations[0].set.name, 'Second local edit');
  assert.strictEqual(Number.isSafeInteger(wireMutations[0].intent_age_ms), true);
  assert.strictEqual(wireMutations[0].intent_age_ms, 0);
});

test('an edit made during an in-flight V2 request is sent later with the confirmed base revision', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'inflight-edit-token');
  await api.updateStoredProduct('B012345678', () => ({ name: 'First', etv: 1 }), {
    createIfMissing: true
  });
  const config = await handler.getPrivateConfig();
  const wireMutations = [];
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });

  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    const mutation = body.payload.mutations[0];
    wireMutations.push(mutation);
    if (wireMutations.length === 1) {
      releaseFirst = () => options.onload({
        status: 200,
        responseText: JSON.stringify({
          status: 'success',
          results: [{ mutation_id: mutation.mutation_id, status: 'applied', revision: 1 }]
        })
      });
      markFirstStarted();
      return;
    }
    options.onload({
      status: 200,
      responseText: JSON.stringify({
        status: 'success',
        results: [{ mutation_id: mutation.mutation_id, status: 'applied', revision: 2 }]
      })
    });
  };

  const sync = handler.pushV2Outbox(config, 'generation-1');
  await firstStarted;
  await api.updateStoredProduct('B012345678', current => ({ ...current, name: 'Second' }));
  releaseFirst();
  const result = await sync;

  assert.strictEqual(result.pushed, 2);
  assert.strictEqual(wireMutations.length, 2);
  assert.notStrictEqual(wireMutations[0].mutation_id, wireMutations[1].mutation_id);
  assert.strictEqual(wireMutations[0].base_revision, 0);
  assert.strictEqual(wireMutations[1].base_revision, 1);
  assert.strictEqual(wireMutations[1].set.name, 'Second');
  assert.strictEqual(await api.db.outbox.count(), 0);
});

test('a committed push acknowledgement advances shadow and base revision even when the following pull fails', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'ack-before-pull-token');
  const config = await handler.getPrivateConfig();
  const base = api.parseStoredProduct({ name: 'Confirmed base', etv: 3, unknown_base: true });
  await api.db.shadows.put({
    profileId: config.profileId,
    entityType: 'product',
    entityId: 'B012345678',
    recordRevision: 1,
    data: base
  });
  await api.db.products.put(api.createProductRow(config.profileId, 'B012345678', base, 1));
  await api.db.syncState.put({
    profileId: config.profileId,
    mode: 'v2',
    generationId: 'generation-1',
    cursor: 1,
    lastHash: 'previously-verified'
  });
  await api.updateStoredProduct('B012345678', current => ({ ...current, name: 'First local edit' }));
  const firstMutation = (await api.db.outbox.toArray())[0];
  const confirmed = { ...base, name: 'First local edit', server_ack_field: 'kept' };
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    if (body.request === 'sync_v2_push') {
      options.onload({
        status: 200,
        responseText: JSON.stringify({
          status: 'success',
          results: [{
            mutation_id: firstMutation.mutationId,
            status: 'applied',
            revision: 2,
            data: confirmed
          }]
        })
      });
      return;
    }
    options.onerror({ message: 'synthetic pull outage' });
  };

  await assert.rejects(
    handler.syncPrivateV2(config, { generation_id: 'generation-1' }),
    /Network error/
  );
  assert.strictEqual(await api.db.outbox.count(), 0);
  const shadow = await api.db.shadows.get([config.profileId, 'product', 'B012345678']);
  assert.strictEqual(shadow.recordRevision, 2);
  assert.strictEqual(shadow.data.server_ack_field, 'kept');
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).server_ack_field, 'kept');

  await api.updateStoredProduct('B012345678', current => ({ ...current, name: 'Second local edit' }));
  const [secondMutation] = await api.db.outbox.toArray();
  assert.strictEqual(secondMutation.baseRevision, 2);
  assert.deepStrictEqual(secondMutation.set, { name: 'Second local edit' });
});

test('V2 rejected mutations are discarded without creating unresolved conflicts', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'conflict-test-token');
  await api.updateStoredProduct('B012345678', () => ({ name: 'Local name', etv: 10 }), {
    createIfMissing: true
  });
  const config = await handler.getPrivateConfig();
  const mutation = (await api.db.outbox.toArray())[0];
  context.GM_xmlhttpRequest = options => options.onload({
    status: 200,
    responseText: JSON.stringify({
      status: 'success',
      results: [{
        mutation_id: mutation.mutationId,
        status: 'conflict',
        conflict: {
          fields: {
            name: {
              reason: 'same_field_changed',
              server_revision: 7,
              server_value: 'Server name',
              client_value: 'Local name'
            }
          },
          server_revision: 7,
          server_data: { name: 'Server name', etv: 10, unknown_server_field: 42 }
        }
      }]
    })
  });

  const pushResult = await handler.pushV2Outbox(config, 'generation-1');
  const conflicts = await api.db.conflicts.where('[profileId+status]').equals([config.profileId, 'open']).toArray();

  assert.strictEqual(pushResult.rejected, 1);
  assert.strictEqual(await api.db.outbox.count(), 0);
  assert.strictEqual(conflicts.length, 0);
  assert.strictEqual((await api.getValue('ASIN_B012345678')).includes('Local name'), true);
});

test('a repair snapshot after rejection replaces the local intent with server state', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'conflict-snapshot-token');
  const config = await handler.getPrivateConfig();
  const base = api.parseStoredProduct({ name: 'Base name', etv: 10, stable_unknown: 'base' });
  await api.db.shadows.put({
    profileId: config.profileId,
    entityType: 'product',
    entityId: 'B012345678',
    recordRevision: 5,
    data: base
  });
  await api.db.products.put(api.createProductRow(config.profileId, 'B012345678', base, 5));
  await api.updateStoredProduct('B012345678', current => ({ ...current, name: 'Local choice' }));
  const mutation = (await api.db.outbox.toArray())[0];
  const conflictedServer = {
    name: 'Server choice', etv: 10, stable_unknown: 'base', server_after_conflict: true
  };
  context.GM_xmlhttpRequest = options => options.onload({
    status: 200,
    responseText: JSON.stringify({
      status: 'success',
      results: [{
        mutation_id: mutation.mutationId,
        status: 'conflict',
        conflict: {
          fields: { name: { server_revision: 6 } },
          server_revision: 6,
          server_data: conflictedServer
        }
      }]
    })
  });
  await handler.pushV2Outbox(config, 'generation-1');
  const snapshotData = { ...conflictedServer, server_after_snapshot: 'preserve me' };
  const snapshotHash = await api.sha256Hex(api.canonicalizeJson([{
    entity_type: 'product', entity_id: 'B012345678', data: snapshotData
  }]));
  context.GM_xmlhttpRequest = options => options.onload({
    status: 200,
    responseText: JSON.stringify({
      status: 'success', session_id: 'conflict-repair', generation_id: 'generation-1',
      snapshot_revision: 7,
      records: [{
        entity_type: 'product', entity_id: 'B012345678', record_revision: 7, data: snapshotData
      }],
      next_offset: 1, has_more: false, dataset_hash: snapshotHash
    })
  });
  await handler.replaceFromV2Snapshot(config, 'generation-1', 'hash-mismatch');
  const local = JSON.parse(await api.getValue('ASIN_B012345678'));
  assert.strictEqual(local.name, 'Server choice');
  assert.strictEqual(local.server_after_snapshot, 'preserve me');
  assert.strictEqual(await api.db.conflicts.count(), 0);
  assert.strictEqual(await api.db.outbox.count(), 0);
});

test('V2 tombstone rejections are discarded without offering a local recreate conflict', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'tombstone-conflict-token');
  await api.updateStoredProduct('B012345678', () => ({ name: 'Recreate locally', etv: 5 }), {
    createIfMissing: true
  });
  const config = await handler.getPrivateConfig();
  const mutation = (await api.db.outbox.toArray())[0];
  context.GM_xmlhttpRequest = options => options.onload({
    status: 200,
    responseText: JSON.stringify({
      status: 'success',
      results: [{
        mutation_id: mutation.mutationId,
        status: 'conflict',
        conflict: {
          fields: { __record__: { reason: 'deleted_since_base', server_revision: 6 } },
          server_revision: null,
          server_data: null
        }
      }]
    })
  });

  await handler.pushV2Outbox(config, 'generation-1');
  assert.strictEqual(await api.db.conflicts.count(), 0);
  assert.strictEqual(await api.db.outbox.count(), 0);
});

test('a pulled remote delete with a pending local edit becomes a revision-safe conflict', async () => {
  const { api } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'remote-delete-token');
  const config = await handler.getPrivateConfig();
  const serverData = { name: 'Before delete', etv: 2 };
  await api.db.shadows.put({
    profileId: config.profileId,
    entityType: 'product',
    entityId: 'B012345678',
    recordRevision: 3,
    data: serverData
  });
  await api.db.products.put(api.createProductRow(config.profileId, 'B012345678', serverData, 3));
  await api.updateStoredProduct('B012345678', current => ({ ...current, name: 'Offline local edit' }));

  await handler.applyV2Change(config.profileId, {
    revision: 6,
    entity_type: 'product',
    entity_id: 'B012345678',
    operation: 'delete',
    set: {},
    unset: ['name', 'etv'],
    data: null
  });
  const conflict = (await api.db.conflicts.toArray())[0];

  assert.strictEqual(conflict.serverRevision, 6);
  assert.strictEqual(conflict.serverDeleted, true);
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).name, 'Offline local edit');

  await handler.resolveV2Conflict(conflict.id, 'local');
  const recreate = (await api.db.outbox.toArray())[0];
  assert.strictEqual(recreate.baseRevision, 6);
  assert.strictEqual(recreate.set.name, 'Offline local edit');
});

test('a concurrent V2 pull and local edit preserve both disjoint changes atomically', async () => {
  await RealDexie.delete('myDatabase');
  let api;
  try {
    ({ api } = await loadUserscript({ DexieImpl: RealDexie }));
    await api.db.open();
    const handler = new api.PrivateBackendHandler();
    await api.setValue('token', 'concurrent-pull-token');
    const config = await handler.getPrivateConfig();
    const base = api.parseStoredProduct({ name: 'Base name', etv: 1 });
    await api.db.shadows.put({
      profileId: config.profileId,
      entityType: 'product',
      entityId: 'B012345678',
      recordRevision: 1,
      data: base
    });
    await api.db.products.put(api.createProductRow(config.profileId, 'B012345678', base, 1));

    await Promise.all([
      handler.applyV2Change(config.profileId, {
        revision: 2,
        entity_type: 'product',
        entity_id: 'B012345678',
        operation: 'upsert',
        set: { remote_field: 'preserved' },
        unset: [],
        data: { ...base, remote_field: 'preserved' }
      }),
      api.updateStoredProduct('B012345678', current => ({
        ...current,
        name: 'Local name'
      }))
    ]);

    const local = JSON.parse(await api.getValue('ASIN_B012345678'));
    const shadow = await api.db.shadows.get([config.profileId, 'product', 'B012345678']);
    const pending = await api.db.outbox
      .where('[profileId+entityType+entityId]')
      .equals([config.profileId, 'product', 'B012345678'])
      .toArray();
    assert.strictEqual(local.name, 'Local name');
    assert.strictEqual(local.remote_field, 'preserved');
    assert.strictEqual(shadow.data.name, 'Base name');
    assert.strictEqual(shadow.data.remote_field, 'preserved');
    assert.strictEqual(pending.length, 1);
    assert.deepStrictEqual(pending[0].set, { name: 'Local name' });
  } finally {
    api?.db?.close();
    await RealDexie.delete('myDatabase');
  }
});

test('V2 hash mismatch performs an exact session/offset repair snapshot', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'repair-test-token');
  const config = await handler.getPrivateConfig();
  const firstData = { name: 'First', etv: 1, unknown_a: true };
  const secondData = { name: 'Second', etv: 2, unknown_b: ['kept'] };
  const expectedHash = await api.sha256Hex(api.canonicalizeJson([
    { entity_type: 'product', entity_id: 'B012345678', data: firstData },
    { entity_type: 'product', entity_id: 'B087654321', data: secondData }
  ]));
  await api.db.shadows.put({
    profileId: config.profileId,
    entityType: 'product',
    entityId: 'B000000001',
    recordRevision: 2,
    data: { name: 'stale' }
  });
  await api.db.products.put(api.createProductRow(config.profileId, 'B000000001', { name: 'stale' }, 2));
  await api.db.syncState.put({
    profileId: config.profileId,
    mode: 'v2',
    generationId: 'generation-1',
    cursor: 2
  });

  const requests = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body);
    let response;
    if (body.request === 'sync_v2_pull') {
      response = {
        status: 'success',
        changes: [],
        next_cursor: 2,
        has_more: false,
        dataset_hash: expectedHash
      };
    } else if (body.request === 'sync_v2_snapshot' && !body.payload.session_id) {
      response = {
        status: 'success',
        session_id: 'snapshot-session',
        generation_id: 'generation-1',
        snapshot_revision: 5,
        records: [{
          entity_type: 'product',
          entity_id: 'B012345678',
          record_revision: 4,
          data: firstData
        }],
        next_offset: 1,
        has_more: true,
        dataset_hash: expectedHash
      };
    } else if (body.request === 'sync_v2_snapshot') {
      response = {
        status: 'success',
        session_id: 'snapshot-session',
        generation_id: 'generation-1',
        snapshot_revision: 5,
        records: [{
          entity_type: 'product',
          entity_id: 'B087654321',
          record_revision: 5,
          data: secondData
        }],
        next_offset: 2,
        has_more: false,
        dataset_hash: expectedHash
      };
    } else {
      throw new Error(`Unexpected request ${body.request}`);
    }
    options.onload({ status: 200, responseText: JSON.stringify(response) });
  };

  const result = await handler.pullV2Changes(config, 'generation-1');
  const snapshotRequests = requests.filter(item => item.request === 'sync_v2_snapshot');

  assert.strictEqual(result.records, 2);
  assert.deepStrictEqual(snapshotRequests[0].payload, {
    generation_id: 'generation-1',
    entity_types: ['product'],
    limit: 500
  });
  assert.deepStrictEqual(snapshotRequests[1].payload, {
    session_id: 'snapshot-session',
    offset: 1,
    limit: 500
  });
  assert.strictEqual(await api.getValue('ASIN_B000000001'), null);
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).unknown_a, true);
  assert.deepStrictEqual(JSON.parse(await api.getValue('ASIN_B087654321')).unknown_b, ['kept']);
  assert.strictEqual((await api.db.syncState.get(config.profileId)).cursor, 5);
});

test('two corrupt snapshots are rejected before replacing the last verified local database', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'corrupt-snapshot-token');
  const config = await handler.getPrivateConfig();
  const verifiedData = { name: 'Last verified local record', etv: 7, durable: true };
  const advertisedData = { name: 'Expected server record', etv: 8 };
  const advertisedHash = await api.sha256Hex(api.canonicalizeJson([{
    entity_type: 'product',
    entity_id: 'B087654321',
    data: advertisedData
  }]));
  const previousState = {
    profileId: config.profileId,
    mode: 'v2',
    generationId: 'generation-1',
    cursor: 9,
    lastHash: 'last-verified-hash'
  };
  await api.db.shadows.put({
    profileId: config.profileId,
    entityType: 'product',
    entityId: 'B012345678',
    recordRevision: 9,
    data: verifiedData
  });
  await api.db.products.put(api.createProductRow(
    config.profileId,
    'B012345678',
    verifiedData,
    9
  ));
  await api.db.syncState.put(previousState);

  const requests = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body);
    options.onload({
      status: 200,
      responseText: JSON.stringify({
        status: 'success',
        session_id: `corrupt-session-${requests.length}`,
        generation_id: 'generation-1',
        snapshot_revision: 10,
        records: [{
          entity_type: 'product',
          entity_id: 'B087654321',
          record_revision: 10,
          data: { ...advertisedData, silently_corrupted: requests.length }
        }],
        next_offset: 1,
        has_more: false,
        dataset_hash: advertisedHash
      })
    });
  };

  await assert.rejects(
    handler.replaceFromV2Snapshot(config, 'generation-1', 'hash-mismatch'),
    /Server-Snapshots/
  );

  assert.strictEqual(requests.length, 2);
  assert.strictEqual(Object.hasOwn(requests[0].payload, 'session_id'), false);
  assert.strictEqual(Object.hasOwn(requests[1].payload, 'session_id'), false);
  assert.deepStrictEqual(
    (await api.db.products.get([config.profileId, 'B012345678'])).data,
    verifiedData
  );
  assert.deepStrictEqual(
    (await api.db.shadows.get([config.profileId, 'product', 'B012345678'])).data,
    verifiedData
  );
  assert.deepStrictEqual(await api.db.syncState.get(config.profileId), previousState);
  assert.strictEqual(await api.db.products.get([config.profileId, 'B087654321']), undefined);
});

test('HTTP 409 cursor expiry repairs by snapshot and restarts one expired snapshot session', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'cursor-expiry-token');
  const config = await handler.getPrivateConfig();
  await api.db.syncState.put({
    profileId: config.profileId,
    mode: 'v2',
    generationId: 'generation-1',
    cursor: 5
  });
  const serverData = { name: 'Recovered', etv: 4, unknown_after_expiry: true };
  const serverHash = await api.sha256Hex(api.canonicalizeJson([{
    entity_type: 'product',
    entity_id: 'B012345678',
    data: serverData
  }]));
  const requests = [];
  let snapshotStarts = 0;
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body);
    let status = 200;
    let response;
    if (body.request === 'sync_v2_pull') {
      status = 409;
      response = {
        status: 'error',
        code: 'cursor_expired',
        message: 'Cursor is no longer available.',
        generation_id: 'generation-1',
        snapshot_required: true
      };
    } else if (body.request === 'sync_v2_snapshot' && !body.payload.session_id) {
      snapshotStarts++;
      response = snapshotStarts === 1
        ? {
            status: 'success',
            session_id: 'expired-session',
            generation_id: 'generation-1',
            snapshot_revision: 8,
            records: [],
            next_offset: 1,
            has_more: true,
            dataset_hash: serverHash
          }
        : {
            status: 'success',
            session_id: 'replacement-session',
            generation_id: 'generation-1',
            snapshot_revision: 8,
            records: [{
              entity_type: 'product',
              entity_id: 'B012345678',
              record_revision: 8,
              data: serverData
            }],
            next_offset: 1,
            has_more: false,
            dataset_hash: serverHash
          };
    } else if (body.request === 'sync_v2_snapshot' && body.payload.session_id === 'expired-session') {
      status = 409;
      response = {
        status: 'error',
        code: 'snapshot_expired',
        message: 'Snapshot expired.',
        generation_id: 'generation-1',
        snapshot_required: true
      };
    } else {
      throw new Error(`Unexpected request ${body.request}`);
    }
    options.onload({ status, responseText: JSON.stringify(response) });
  };

  const result = await handler.pullV2Changes(config, 'generation-1');

  assert.deepStrictEqual(requests.map(item => item.request), [
    'sync_v2_pull',
    'sync_v2_snapshot',
    'sync_v2_snapshot',
    'sync_v2_snapshot'
  ]);
  assert.strictEqual(snapshotStarts, 2);
  assert.strictEqual(result.records, 1);
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).unknown_after_expiry, true);
});

test('generation reset exactly replaces local recovery data with server state', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'generation-reset-token');
  const config = await handler.getPrivateConfig();
  await api.setValue('ASIN_B012345678', JSON.stringify({ name: 'Local recovery copy', etv: 3 }));
  await api.db.syncState.put({
    profileId: config.profileId,
    mode: 'v2',
    generationId: 'old-generation',
    cursor: 99
  });
  const emptyHash = await api.sha256Hex(api.canonicalizeJson([]));
  const requests = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body.request);
    const response = body.request === 'sync_v2_snapshot'
      ? {
          status: 'success',
          session_id: 'empty-snapshot',
          generation_id: 'new-generation',
          snapshot_revision: 0,
          records: [],
          next_offset: 0,
          has_more: false,
          dataset_hash: emptyHash
        }
      : {
          status: 'success',
          changes: [],
          next_cursor: 0,
          has_more: false,
          dataset_hash: emptyHash
        };
    options.onload({ status: 200, responseText: JSON.stringify(response) });
  };

  await handler.syncPrivateV2(config, { generation_id: 'new-generation' });

  assert.deepStrictEqual(requests, ['sync_v2_snapshot', 'sync_v2_pull']);
  assert.strictEqual(await api.getValue('ASIN_B012345678'), null);
  assert.strictEqual(await api.db.outbox.count(), 0);
  assert.strictEqual(await api.db.conflicts.count(), 0);
  assert.strictEqual((await api.db.syncState.get(config.profileId)).generationId, 'new-generation');
});

test('stale cached generation refreshes immediately and lets the server snapshot win', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  await api.setValue('token', 'stale-generation-token');
  await api.updateStoredProduct('B012345678', () => ({
    name: 'Unsynced local name',
    etv: 8,
    unknown_local: true
  }), { createIfMissing: true });
  const config = await handler.getPrivateConfig();
  const originalMutation = (await api.db.outbox.toArray())[0];
  await api.db.outbox.update(originalMutation.mutationId, {
    status: 'inflight',
    attempts: 1,
    inflightAt: Date.now() - 60_000
  });
  await api.db.syncState.put({
    profileId: config.profileId,
    mode: 'v2',
    generationId: 'old-generation',
    cursor: 9,
    lastHash: 'previously-verified-hash',
    capabilityCheckedAt: Date.now(),
    capabilities: { protocol_version: 2, generation_id: 'old-generation' }
  });
  const serverData = { name: 'Restored server name', etv: 7, unknown_server: true };
  const serverHash = await api.sha256Hex(api.canonicalizeJson([{
    entity_type: 'product',
    entity_id: 'B012345678',
    data: serverData
  }]));
  const requests = [];
  context.GM_xmlhttpRequest = options => {
    const body = JSON.parse(options.data);
    requests.push(body);
    let status = 200;
    let response;
    if (body.request === 'sync_v2_push' && body.payload.generation_id === 'old-generation') {
      status = 409;
      response = {
        status: 'error',
        code: 'generation_mismatch',
        message: 'The client generation does not match this dataset.',
        generation_id: 'new-generation',
        snapshot_required: true
      };
    } else if (body.request === 'get_capabilities_v2') {
      response = {
        status: 'success',
        protocol_version: 2,
        generation_id: 'new-generation',
        current_revision: 1,
        dataset_hash: serverHash
      };
    } else if (body.request === 'sync_v2_snapshot') {
      response = {
        status: 'success',
        session_id: 'restored-snapshot',
        generation_id: 'new-generation',
        snapshot_revision: 1,
        records: [{
          entity_type: 'product',
          entity_id: 'B012345678',
          record_revision: 1,
          data: serverData
        }],
        next_offset: 1,
        has_more: false,
        dataset_hash: serverHash
      };
    } else if (body.request === 'sync_v2_pull') {
      response = {
        status: 'success',
        changes: [],
        next_cursor: 1,
        has_more: false,
        dataset_hash: serverHash
      };
    } else {
      throw new Error(`Unexpected request ${body.request}`);
    }
    options.onload({ status, responseText: JSON.stringify(response) });
  };

  await handler.syncPrivateV2(config, { protocol_version: 2, generation_id: 'old-generation' });
  const conflicts = await api.db.conflicts.where('[profileId+status]').equals([config.profileId, 'open']).toArray();

  assert.deepStrictEqual(requests.map(item => item.request), [
    'sync_v2_push',
    'get_capabilities_v2',
    'sync_v2_snapshot',
    'sync_v2_pull'
  ]);
  assert.strictEqual(conflicts.length, 0);
  assert.strictEqual(await api.db.outbox.count(), 0);
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).name, 'Restored server name');
  assert.strictEqual(JSON.parse(await api.getValue('ASIN_B012345678')).unknown_server, true);
});

test('cross-tab lease serializes two handler instances', async () => {
  const { api, context } = await loadUserscript();
  const browserLockNames = [];
  let browserLockTail = Promise.resolve();
  let activeBrowserLocks = 0;
  let maximumActiveBrowserLocks = 0;
  context.navigator.locks = {
    request(name, options, callback) {
      assert.strictEqual(options.mode, 'exclusive');
      assert.deepStrictEqual(Object.keys(options), ['mode']);
      browserLockNames.push(name);
      const operation = browserLockTail.then(async () => {
        activeBrowserLocks++;
        maximumActiveBrowserLocks = Math.max(maximumActiveBrowserLocks, activeBrowserLocks);
        try {
          return await callback();
        } finally {
          activeBrowserLocks--;
        }
      });
      browserLockTail = operation.then(() => undefined, () => undefined);
      return operation;
    }
  };
  const firstHandler = new api.PrivateBackendHandler();
  const secondHandler = new api.PrivateBackendHandler();
  const events = [];
  let releaseFirst;
  let markFirstStarted;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });

  const first = firstHandler.withCrossTabSyncLock('shared-profile', async () => {
    events.push('first-start');
    markFirstStarted();
    await firstGate;
    events.push('first-end');
  });
  await firstStarted;
  const second = secondHandler.withCrossTabSyncLock('shared-profile', async () => {
    events.push('second-start');
    events.push('second-end');
  });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepStrictEqual(events, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepStrictEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);
  assert.strictEqual(maximumActiveBrowserLocks, 1);
  assert.deepStrictEqual(browserLockNames, [
    'vine-tax-tools-sync:shared-profile',
    'vine-tax-tools-sync:shared-profile'
  ]);
  assert.strictEqual(await api.db.syncLocks.count(), 0);
});

test('incomplete tax0 products keep polling the estimator for later results', async () => {
  const { api, context } = await loadUserscript();
  const handler = new api.PrivateBackendHandler();
  const product = {
    ASIN: 'B012345678',
    name: 'Tax-0 product still processing',
    etv: 0,
    pdf: null,
    teilwert_v2: null
  };
  await api.setValue('last_full_sync', Date.now());

  let estimatorRequests = 0;
  context.GM_xmlhttpRequest = options => {
    estimatorRequests++;
    options.onload({
      status: 200,
      responseText: JSON.stringify({ status: 'success' })
    });
  };

  await handler.syncProducts([product]);
  await handler.syncProducts([product]);
  assert.strictEqual(estimatorRequests, 2);
});

test('stored product compatibility mirrors manual value and usage fields in both directions', async () => {
  const { api } = await loadUserscript();

  const canonicalOnly = api.parseStoredProduct({
    myTeilwert: 7.5,
    usageStatus: ['Lager', 'entsorgt', 'betriebliche Nutzung']
  });
  assert.strictEqual(canonicalOnly.myteilwert, 7.5);
  assert.strictEqual(canonicalOnly.lager, true);
  assert.strictEqual(canonicalOnly.entsorgt, true);
  assert.strictEqual(canonicalOnly.betriebsausgabe, true);
  assert.strictEqual(canonicalOnly.verkauft, false);
  assert.strictEqual(api.getTeilwert(canonicalOnly, { useTeilwertV2: false }), 7.5);

  const explicitLegacy = api.parseStoredProduct({
    myTeilwert: 99,
    myteilwert: null,
    usageStatus: ['verkauft', 'Lager'],
    verkauft: false,
    lager: true,
    entsorgt: true
  });
  assert.strictEqual(explicitLegacy.myTeilwert, null);
  assert.strictEqual(explicitLegacy.myteilwert, null);
  explicitLegacy.teilwert = 4;
  assert.strictEqual(api.getTeilwert(explicitLegacy, { useTeilwertV2: false }), 4);
  assert.strictEqual(explicitLegacy.usageStatus.includes('verkauft'), true);
  assert.strictEqual(explicitLegacy.verkauft, true);
  assert.strictEqual(explicitLegacy.usageStatus.includes('Lager'), true);
  assert.strictEqual(explicitLegacy.usageStatus.includes('entsorgt'), false);
  assert.strictEqual(
    Object.hasOwn(JSON.parse(JSON.stringify(explicitLegacy)), 'myteilwert'),
    true
  );
});

test('non-empty usageStatus wins over stale legacy booleans', async () => {
  const { api } = await loadUserscript();

  const product = api.parseStoredProduct({
    usageStatus: ['verkauft', 'Lager'],
    verkauft: false,
    lager: false,
    entsorgt: true
  });

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(product.usageStatus)),
    ['verkauft', 'Lager']
  );
  assert.strictEqual(product.verkauft, true);
  assert.strictEqual(product.lager, true);
  assert.strictEqual(product.entsorgt, false);
});

test('empty usageStatus is reconstructed from true legacy booleans', async () => {
  const { api } = await loadUserscript();

  const product = api.parseStoredProduct({
    usageStatus: [],
    verkauft: true,
    lager: true,
    entsorgt: false
  });

  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(product.usageStatus)),
    ['verkauft', 'Lager']
  );
  assert.strictEqual(product.verkauft, true);
  assert.strictEqual(product.lager, true);
  assert.strictEqual(product.entsorgt, false);
});

test('per-ASIN product updates serialize read-modify-write operations', async () => {
  const { api } = await loadUserscript();
  await api.setValue('ASIN_B000000001', JSON.stringify({
    name: 'Concurrent product',
    etv: 12,
    verkauft: false,
    lager: false
  }));

  let releaseFirst;
  let markFirstStarted;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise(resolve => {
    markFirstStarted = resolve;
  });
  const firstUpdate = api.updateStoredProduct('B000000001', async current => {
    markFirstStarted();
    await firstGate;
    current.usageStatus = [...new Set([...current.usageStatus, 'verkauft'])];
  });
  await firstStarted;
  const secondUpdate = api.updateStoredProduct('B000000001', current => {
    current.usageStatus = [...new Set([...current.usageStatus, 'Lager'])];
  });
  releaseFirst();
  await Promise.all([firstUpdate, secondUpdate]);

  const stored = JSON.parse(await api.getValue('ASIN_B000000001'));
  assert.strictEqual(stored.verkauft, true);
  assert.strictEqual(stored.lager, true);
});

test('UI settings keep backwards-compatible defaults for older partial records', async () => {
  const { api } = await loadUserscript();
  const settings = api.normalizeSettings({ tax0: true, yearFilter: 'only 2025' });

  assert.strictEqual(settings.tax0, true);
  assert.strictEqual(settings.yearFilter, 'only 2025');
  assert.strictEqual(settings.cancellations, false);
  assert.strictEqual(settings.streuartikelregelung, false);
  assert.strictEqual(settings.streuartikelregelungTeilwert, false);
  assert.strictEqual(settings.add2ndhalf2023to2024, false);
  assert.strictEqual(settings.einnahmezumteilwert, false);
  assert.strictEqual(settings.useTeilwertV2, false);

  const firstRunDefaults = api.normalizeSettings(null);
  assert.strictEqual(firstRunDefaults.streuartikelregelung, true);
  assert.strictEqual(firstRunDefaults.add2ndhalf2023to2024, true);

  const legacyYearOptions = api.buildYearFilterOptionsHtml(
    api.normalizeSettings({ yearFilter: 'only 2022' })
  );
  assert.match(legacyYearOptions, /value="only 2022" selected/);
  assert.doesNotMatch(legacyYearOptions, /value="show all years" selected/);
});

test('local product size is UTF-8 aware and excludes token/configuration records', async () => {
  const { api } = await loadUserscript();
  assert.strictEqual(api.getUtf8ByteLength('abc'), 3);
  assert.strictEqual(api.getUtf8ByteLength('ä'), 2);
  assert.strictEqual(api.getUtf8ByteLength('😀'), 4);
  assert.strictEqual(api.formatByteSize(0), '0 B');
  assert.strictEqual(api.formatByteSize(1024), '1.0 KB');
  assert.strictEqual(api.formatByteSize(1024 ** 2), '1.00 MB');

  const firstValue = JSON.stringify({ name: 'Küchenhelfer', etv: 12.5 });
  const secondValue = JSON.stringify({ name: '😀', etv: 0 });
  await api.setValue('token', 'must-never-count-or-render');
  await api.setValue('ASIN_B000000001', firstValue);
  await api.setValue('ASIN_B000000002', secondValue);
  const stats = await api.getLocalProductDatabaseStats();

  assert.strictEqual(stats.productCount, 2);
  assert.strictEqual(
    stats.bytes,
    api.getUtf8ByteLength('ASIN_B000000001')
      + api.getUtf8ByteLength(firstValue)
      + api.getUtf8ByteLength('ASIN_B000000002')
      + api.getUtf8ByteLength(secondValue)
  );
  assert.strictEqual(JSON.stringify(stats).includes('must-never-count-or-render'), false);
});

test('backend UI model distinguishes local-only, configured and invalid states without exposing tokens', async () => {
  const { api } = await loadUserscript();
  const localOnly = api.getBackendUiModel('', 'hutaufvine');
  const configured = api.getBackendUiModel('super-secret', 'hutaufvine');
  const invalid = api.getBackendUiModel('super-secret', 'invalid/backend');

  assert.strictEqual(localOnly.state, 'local-only');
  assert.strictEqual(localOnly.configured, false);
  assert.strictEqual(configured.state, 'configured');
  assert.strictEqual(configured.configured, true);
  assert.strictEqual(invalid.state, 'invalid');
  assert.strictEqual(invalid.configured, false);
  assert.strictEqual(JSON.stringify({ localOnly, configured, invalid }).includes('super-secret'), false);

  await api.setValue('token', '   ');
  assert.strictEqual(await new api.PrivateBackendHandler().getPrivateConfig(), null);
});

test('table filters and evaluation rules are described separately', async () => {
  const { api } = await loadUserscript();
  const settings = api.normalizeSettings({
    cancellations: true,
    tax0: false,
    yearFilter: 'only 2024',
    add2ndhalf2023to2024: true,
    useTeilwertV2: true,
    streuartikelregelung: false
  });
  const tableLabels = Array.from(api.getTableFilterLabels(settings));
  const evaluationLabels = Array.from(api.getEvaluationRuleLabels(settings));

  assert.deepStrictEqual(tableLabels, [
    'Steuerjahr: 2024 inkl. 2. HJ 2023',
    'Stornierungen: enthalten',
    '0-€-ETV: ausgeblendet',
    'Teilwert: V2'
  ]);
  assert.match(evaluationLabels.join(' · '), /Streuartikelregel nach ETV aus/);
  assert.match(evaluationLabels.join(' · '), /2\. HJ 2023 wird 2024 zugerechnet/);
});

test('account UI is one shell with dialogs, status cards, filtered table and lazy analyses', () => {
  const accountUi = userscriptSource.slice(
    userscriptSource.indexOf('async function createUI_taxextractor'),
    userscriptSource.indexOf('async function createLazyAnalysisSection')
  );
  const yearlyUi = userscriptSource.slice(
    userscriptSource.indexOf('async function createLazyAnalysisSection'),
    userscriptSource.indexOf('async function createETVPlot')
  );

  assert.match(accountUi, /id="vine-data-extractor" class="vtt-shell"/);
  assert.match(accountUi, /id="vtt-settings-dialog"/);
  assert.match(accountUi, /id="vtt-backend-dialog"/);
  assert.match(accountUi, /id="vtt-data-dialog"/);
  assert.match(accountUi, /id="vtt-storage-value"/);
  assert.match(accountUi, /id="vtt-backend-summary"/);
  assert.match(accountUi, /id="vtt-local-only-warning"/);
  assert.match(accountUi, /id="vtt-analysis-content"/);
  assert.match(accountUi, /id="vtt-table-filter-summary"/);
  assert.match(accountUi, /\$\{VINE_PRODUCT_MANAGER_URL\}/);
  assert.match(userscriptSource, /https:\/\/hutauf\.github\.io\/vine-produkt-manager\//);
  assert.match(userscriptSource, /class="vtt-danger-zone"/);
  assert.doesNotMatch(accountUi, /const settingsDiv/);
  assert.doesNotMatch(accountUi, /prompt\('Enter token/);

  assert.match(yearlyUi, /const renderRevision = \+\+analysisRenderRevision/);
  assert.match(yearlyUi, /document\.createDocumentFragment\(\)/);
  assert.match(yearlyUi, /container\.replaceChildren\(nextContent\)/);
  assert.match(yearlyUi, /\.filter\(entry => entry\.items\.length > 0\)/);
  assert.match(yearlyUi, /yearSet\.add\(2024\)/);
  assert.match(yearlyUi, /createLazyAnalysisSection\(yearBody/);
  assert.match(yearlyUi, /render: target => createETVPlot/);
  assert.match(yearlyUi, /render: target => createPieChart/);
});

test('local UI fixture loads the production userscript and waits for initialization to finish', () => {
  assert.match(uiFixtureSource, /script\.src = '\.\.\/\.\.\/main_order_tax_cancellations_eval\.user\.js'/);
  assert.match(uiFixtureSource, /node_modules\/dexie\/dist\/dexie\.min\.js/);
  assert.match(uiFixtureSource, /Dexie\.delete\('myDatabase'\)/);
  assert.doesNotMatch(uiFixtureSource, /class FixtureDexie/);
  assert.match(uiFixtureSource, /https:\/\/d3js\.org\/d3\.v5\.min\.js/);
  assert.match(uiFixtureSource, /jquery\.dataTables\.min\.js/);
  assert.match(uiFixtureSource, /\['success', 'error'\]\.includes\(progress\.dataset\.state\)/);
  assert.match(uiFixtureSource, /window\.__VTT_FIXTURE_READY__ = true/);
  assert.match(uiFixtureSource, /dataset\.vttFixtureReady = 'true'/);
});

test('setting changes refresh an open table and destroy DataTables before rebuilding it', () => {
  assert.match(userscriptSource, /persistSettingAndRefresh\(settingId, event\.target\.checked\)/);
  assert.match(userscriptSource, /dataTable\?\.dataset\.rendered === 'true'/);
  assert.match(userscriptSource, /showAllData\(\{ openSection: false, sourceData: list \}\)/);
  assert.match(
    userscriptSource,
    /dataTable\?\.dataset\.rendered !== 'true'[\s\S]*showAllData\(\{ openSection: false \}\)/
  );

  const tableRenderer = userscriptSource.slice(
    userscriptSource.indexOf('function destroyExistingAsinDataTable'),
    userscriptSource.indexOf('async function showTeilwertPopup')
  );
  assert.match(tableRenderer, /const renderRevision = \+\+tableRenderRevision/);
  assert.match(tableRenderer, /if \(!isCurrent\(\)\) return \{ stale: true \}/);
  assert.match(tableRenderer, /destroyExistingAsinDataTable\(\);\s+renderTableFilterSummary/);
  assert.doesNotMatch(tableRenderer, /window\.progressBar\.hide\(\)/);
  assert.doesNotMatch(tableRenderer, /\$\(document\)\.ready/);
});

test('account startup sync and orders autoload are explicit while the storage loader stays read-only', () => {
  const accountStart = userscriptSource.slice(
    userscriptSource.indexOf('async function createUI_taxextractor'),
    userscriptSource.indexOf('async function createYearlyBreakdown')
  );
  const progressCreatedAt = accountStart.indexOf('createSimpleProgressBar(container, true)');
  const settingsReadAt = accountStart.indexOf('const settings = await getSettings()');
  const progressAttachedAt = accountStart.indexOf("progressSlot.appendChild(progressBar.element)");
  const localLoadAt = accountStart.indexOf('await load_all_asin_etv_values_from_storage');
  const syncAt = accountStart.indexOf('await backendHandler.syncProducts(list)');
  const yearlyBreakdownAt = accountStart.indexOf('requestDashboardRefresh()', syncAt);
  const completedAt = accountStart.indexOf('Abgeschlossen. ${list.length} lokale Produkte sind bereit.');

  assert.ok(progressCreatedAt >= 0);
  assert.ok(progressCreatedAt < settingsReadAt);
  assert.ok(progressAttachedAt >= 0);
  assert.ok(progressAttachedAt < localLoadAt);
  assert.ok(localLoadAt < syncAt);
  assert.ok(syncAt < yearlyBreakdownAt);
  assert.ok(yearlyBreakdownAt < completedAt);
  assert.match(accountStart, /await waitForDashboardRefreshIdle\(\)/);
  assert.match(accountStart, /await backendHandler\.syncProducts\(list\)/);
  assert.match(accountStart, /setAutomaticSyncStep\(1, 'Oberfläche und Sync-Einstellungen/);
  assert.match(accountStart, /Automatic account initialization failed/);
  assert.match(accountStart, /initializeXlsxYearSelector\(xlsxYearSelect\)\.catch/);
  assert.doesNotMatch(accountStart, /await initializeXlsxYearSelector/);
  assert.doesNotMatch(accountStart.slice(syncAt), /appendChild\(progressBar\.element\)/);
  assert.doesNotMatch(accountStart, /Status: noch kein Sync/);
  assert.doesNotMatch(accountStart, /<div id="status"[^>]*>Automatischer Sync/);
  assert.doesNotMatch(accountStart, /updateBackendStatusText\(\s*['"`]Automatischer Sync/);

  for (let step = 1; step <= 7; step++) {
    assert.match(userscriptSource, new RegExp(`setAutomaticSyncStep\\(\\s*${step},`));
  }

  const storageLoader = userscriptSource.slice(
    userscriptSource.indexOf('async function load_all_asin_etv_values_from_storage'),
    userscriptSource.indexOf('async function createUI_taxextractor')
  );
  assert.doesNotMatch(storageLoader, /syncProducts|postJson|GM_xmlhttpRequest/);
  assert.match(storageLoader, /const shouldReportProgress = progressOptions !== false/);
  assert.match(storageLoader, /if \(!shouldReportProgress\) return/);

  const ordersUi = userscriptSource.slice(
    userscriptSource.indexOf('function createUIorderpage'),
    userscriptSource.indexOf('async function copyPDFList')
  );
  assert.match(ordersUi, /setAutomaticSyncStep\(1, 'Amazon-Bestellimport wird vorbereitet/);
  assert.doesNotMatch(ordersUi, /progressBar\.hide\(\)/);
  assert.match(ordersUi, /await loadOrdersInfo\(\)/);
});

test('seven-step sync feedback stays inside the progress bar', async () => {
  const { api, context } = await loadUserscript();
  const status = { textContent: '', style: {} };
  const progress = {
    shown: false,
    text: '',
    percentage: -1,
    state: '',
    show() {
      this.shown = true;
    },
    setText(text) {
      this.text = text;
    },
    setFillWidth(percentage) {
      this.percentage = percentage;
    },
    setState(state) {
      this.state = state;
    }
  };
  context.document.getElementById = id => id === 'status' ? status : null;
  context.window.progressBar = progress;

  api.setAutomaticSyncStep(4, 'Teilwert-Antwort wird verarbeitet ...', 0.5);

  assert.strictEqual(progress.shown, true);
  assert.match(progress.text, /Schritt 4\/7/);
  assert.match(progress.text, /Teilwert-Antwort/);
  assert.strictEqual(progress.percentage, 50);
  assert.strictEqual(progress.state, 'info');
  assert.strictEqual(status.textContent, '');

  api.setAutomaticSyncStep(7, 'Server nicht erreichbar.', 1, 'error');
  assert.strictEqual(progress.percentage, 100);
  assert.strictEqual(progress.state, 'error');

  assert.match(userscriptSource, /Server-Synchronisierung läuft .*Bitte diese Vine-Seite noch geöffnet lassen/);
  assert.match(userscriptSource, /Alles synchronisiert .*Server-Revision/);
  assert.match(userscriptSource, /Hintergrund-Synchronisierung läuft .*Server-Vollstand wird geprüft/);
  assert.match(userscriptSource, /pending: \['#d5a72e'/);
});

test('validation rejects unsafe backend names/import keys and HTML is escaped', async () => {
  const { api } = await loadUserscript();
  assert.strictEqual(api.isValidBackendName('hutaufvine'), true);
  assert.strictEqual(api.isValidBackendName('evil.example/path'), false);
  assert.throws(
    () => api.validateDatabaseImport({ token: 'must-not-be-imported' }),
    /Nicht erlaubter Schlüssel/
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(api.validateDatabaseImport({ ASIN_B012345678: '{"name":"ok"}' }))),
    [{
      key: 'ASIN_B012345678',
      value: JSON.stringify({
        name: 'ok',
        verkauft: false,
        lager: false,
        entsorgt: false,
        storniert: false,
        betriebsausgabe: false,
        usageStatus: []
      })
    }]
  );
  assert.strictEqual(api.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('date parsing validates calendar dates and supports German month names', async () => {
  const { api } = await loadUserscript();
  assert.strictEqual(api.parseDateSafe('1. Januar 2024').toISOString(), '2024-01-01T00:00:00.000Z');
  assert.strictEqual(api.normalizeOrderDate('2024-07-31T23:59:59.000Z'), '31/07/2024');
  assert.strictEqual(api.normalizeOrderDate('31.07.2024'), '31/07/2024');
  assert.strictEqual(api.normalizeOrderDate(''), null);
  assert.strictEqual(api.normalizeOrderDate('31/02/2024'), null);
  assert.strictEqual(api.parseDateSafe('31.02.2024'), null);
  assert.strictEqual(api.parseDateSafe('2024-02-31'), null);
  assert.strictEqual(api.parseDateSafe({}), null);
});

test('blank ETV cells are invalid rather than silently becoming zero', async () => {
  const { api } = await loadUserscript();
  assert.strictEqual(Number.isNaN(api.etvstrtofloat('')), true);
  assert.strictEqual(Number.isNaN(api.etvstrtofloat('€')), true);
});

test('known cancellation rows never fall through into product data', async () => {
  const { api } = await loadUserscript();
  await api.setValue('cancellations', ['B012345678']);
  const rows = [
    [],
    [],
    ['Order', 'ASIN', 'Name', 'Type', 'Date', 'ETV'],
    ['123', 'B012345678', 'Cancelled', 'CANCELLATION', '01.01.2025', '12,34 €'],
    ['124', 'B087654321', 'Active', 'ORDER', '02.01.2025', '5,00 €']
  ];
  const result = await api.extractData(rows);
  assert.strictEqual(Object.hasOwn(result.data, 'B012345678'), false);
  assert.strictEqual(Object.hasOwn(result.data, 'B087654321'), true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await api.getValue('cancellations'))), ['B012345678']);
});
