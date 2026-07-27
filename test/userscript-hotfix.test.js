const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const userscriptPath = path.join(__dirname, '..', 'main_order_tax_cancellations_eval.user.js');
const userscriptSource = fs.readFileSync(userscriptPath, 'utf8');
const uiFixturePath = path.join(__dirname, 'fixtures', 'userscript-ui.html');
const uiFixtureSource = fs.readFileSync(uiFixturePath, 'utf8');

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
  assert.strictEqual((userscriptSource.match(/^\/\/ @require /gm) || []).length, 7);
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
  assert.strictEqual(explicitLegacy.usageStatus.includes('verkauft'), false);
  assert.strictEqual(explicitLegacy.usageStatus.includes('Lager'), true);
  assert.strictEqual(explicitLegacy.usageStatus.includes('entsorgt'), true);
  assert.strictEqual(
    Object.hasOwn(JSON.parse(JSON.stringify(explicitLegacy)), 'myteilwert'),
    true
  );
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
    current.verkauft = true;
  });
  await firstStarted;
  const secondUpdate = api.updateStoredProduct('B000000001', current => {
    current.lager = true;
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
  await api.setValue('ASIN_B000000001', firstValue);
  await api.setValue('ASIN_B000000002', secondValue);
  await api.setValue('token', 'must-never-count-or-render');
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
  assert.match(uiFixtureSource, /src="\.\.\/\.\.\/main_order_tax_cancellations_eval\.user\.js"/);
  assert.match(uiFixtureSource, /https:\/\/d3js\.org\/d3\.v5\.min\.js/);
  assert.match(uiFixtureSource, /jquery\.dataTables\.min\.js/);
  assert.match(uiFixtureSource, /\['success', 'error'\]\.includes\(progress\.dataset\.state\)/);
  assert.match(uiFixtureSource, /window\.__VTT_FIXTURE_READY__ = true/);
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
