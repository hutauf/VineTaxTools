const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const userscriptPath = path.join(__dirname, '..', 'main_order_tax_cancellations_eval.user.js');
const userscriptSource = fs.readFileSync(userscriptPath, 'utf8');

class FakeTable {
  constructor() {
    this.records = new Map();
  }

  async put(record) {
    this.records.set(record.key, { ...record });
  }

  async bulkPut(records) {
    for (const record of records) await this.put(record);
  }

  async get(key) {
    return this.records.get(key);
  }

  async delete(key) {
    this.records.delete(key);
  }

  async toArray() {
    return Array.from(this.records.values());
  }

  toCollection() {
    return {
      primaryKeys: async () => Array.from(this.records.keys())
    };
  }
}

class FakeDexie {
  constructor() {
    this.keyValuePairs = new FakeTable();
  }

  version() {
    return { stores: () => this };
  }
}

async function loadUserscript() {
  const testHook = {};
  const context = vm.createContext({
    __VINE_TAX_TOOLS_TEST_HOOK__: testHook,
    module: { exports: {} },
    Dexie: FakeDexie,
    GM_addStyle() {},
    GM_xmlhttpRequest() {
      throw new Error('Unexpected GM_xmlhttpRequest call');
    },
    GM_setClipboard() {},
    alert() {},
    confirm: () => true,
    console,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
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
  assert.doesNotMatch(userscriptSource, /console\.log\(\s*['"`]POST /);
  assert.doesNotMatch(userscriptSource, /setFillWidth\(i\s*\*\s*10\)/);
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

test('deleting the private database clears scoped markers so recreated timestamp-zero data downloads again', async () => {
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
  await api.setValue('ASIN_B012345678', JSON.stringify({ name: 'local-after-download', etv: 10 }));
  await handler.deleteDatabase();
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
  context.GM_xmlhttpRequest = options => {
    requests.push({ url: options.url, body: JSON.parse(options.data) });
    options.onload({ status: 200, responseText: '{"status":"success","existing_asins":[]}' });
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

  assert.deepStrictEqual(Object.keys(requests[0].body).sort(), ['payload', 'request', 'token']);
  assert.strictEqual(requests[0].body.request, 'update_asin');
  assert.deepStrictEqual(Object.keys(requests[0].body.payload[0]).sort(), ['ASIN', 'timestamp', 'value']);
  assert.strictEqual(requests[0].body.payload[0].timestamp, 0);
  const privateValue = JSON.parse(requests[0].body.payload[0].value);
  assert.strictEqual(Object.hasOwn(privateValue, 'ASIN'), false);
  assert.strictEqual(privateValue.myteilwert, null);
  assert.strictEqual(privateValue.myTeilwert, null);
  assert.strictEqual(privateValue.verkauft, true);
  assert.strictEqual(privateValue.usageStatus.includes('verkauft'), true);
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
  assert.strictEqual(explicitLegacy.usageStatus.includes('verkauft'), false);
  assert.strictEqual(explicitLegacy.usageStatus.includes('Lager'), true);
  assert.strictEqual(explicitLegacy.usageStatus.includes('entsorgt'), true);
  assert.strictEqual(
    Object.hasOwn(JSON.parse(JSON.stringify(explicitLegacy)), 'myteilwert'),
    true
  );
});

test('account startup sync and orders autoload are explicit while the storage loader stays read-only', () => {
  const accountStart = userscriptSource.slice(
    userscriptSource.indexOf('async function createUI_taxextractor'),
    userscriptSource.indexOf('async function createYearlyBreakdown')
  );
  const progressAttachedAt = accountStart.indexOf("progressSlot.appendChild(progressBar.element)");
  const localLoadAt = accountStart.indexOf('await load_all_asin_etv_values_from_storage');
  const syncAt = accountStart.indexOf('await backendHandler.syncProducts(list)');
  const yearlyBreakdownAt = accountStart.indexOf('await createYearlyBreakdown(list)');
  const completedAt = accountStart.indexOf('Abgeschlossen. ${list.length} lokale Produkte sind bereit.');

  assert.ok(progressAttachedAt >= 0);
  assert.ok(progressAttachedAt < localLoadAt);
  assert.ok(localLoadAt < syncAt);
  assert.ok(syncAt < yearlyBreakdownAt);
  assert.ok(yearlyBreakdownAt < completedAt);
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
    show() {
      this.shown = true;
    },
    setText(text) {
      this.text = text;
    },
    setFillWidth(percentage) {
      this.percentage = percentage;
    }
  };
  context.document.getElementById = id => id === 'status' ? status : null;
  context.window.progressBar = progress;

  api.setAutomaticSyncStep(4, 'Teilwert-Antwort wird verarbeitet ...', 0.5);

  assert.strictEqual(progress.shown, true);
  assert.match(progress.text, /Schritt 4\/7/);
  assert.match(progress.text, /Teilwert-Antwort/);
  assert.strictEqual(progress.percentage, 50);
  assert.strictEqual(status.textContent, '');
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
