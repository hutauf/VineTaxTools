// ==UserScript==
// @name        taxsummary
// @namespace   Violentmonkey Scripts
// @match       https://www.amazon.de/vine/account*
// @match       https://www.amazon.de/vine/orders*
// @require     https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.8.0/jszip.js
// @require     https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
// @require     https://unpkg.com/dexie@4.4.4/dist/dexie.js
// @require     https://d3js.org/d3.v5.min.js
// @require     https://cdn.plot.ly/plotly-1.58.5.min.js
// @require     https://code.jquery.com/jquery-3.5.1.js
// @require     https://cdn.datatables.net/1.11.5/js/jquery.dataTables.min.js
// @grant       GM_setValue
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_xmlhttpRequest
// @grant       GM_deleteValue
// @grant       GM_listValues
// @grant       GM_setClipboard
// @updateURL   https://raw.githubusercontent.com/hutauf/VineTaxTools/refs/heads/main/main_order_tax_cancellations_eval.user.js
// @downloadURL https://raw.githubusercontent.com/hutauf/VineTaxTools/refs/heads/main/main_order_tax_cancellations_eval.user.js
// @version     1.111116
// @author      -
// @description 16.08.2025
// ==/UserScript==

GM_addStyle(`
    @import url('https://cdn.datatables.net/1.11.5/css/jquery.dataTables.min.css');
  `);


  (async function() {
      'use strict';

            const db = new Dexie('myDatabase');
            db.version(1).stores({
              keyValuePairs: 'key'
            });

            async function setValue(key, value) {
              await db.keyValuePairs.put({ key, value });
            }

            async function getValue(key, defaultValue = null) {
              const result = await db.keyValuePairs.get(key);
              return result ? result.value : defaultValue;
            }

            async function getAllAsinValues() {
                try {
                    const allValues = await db.keyValuePairs.toArray();
                    const asinValues = allValues.filter(item => item.key.startsWith("ASIN_"));
                    const asinDict = asinValues.reduce((acc, item) => {
                        acc[item.key] = item.value;
                        return acc;
                    }, {});
                    return asinDict;
                } catch (error) {
                    console.error("Error getting ASIN values:", error);
                    return {};
                }
            }

            function updateStatusMessage(message, type = "info") {
                const statusEl = document.getElementById('status');
                if (!statusEl) return;
                statusEl.textContent = message;
                const statusColors = { info: '#0f1111', success: '#067d62', error: '#b12704' };
                statusEl.style.color = statusColors[type] || statusColors.info;
            }

            function updateBackendStatusText(message, type = "info") {
                const backendStatusEl = document.getElementById('backendStatus');
                if (!backendStatusEl) return;
                backendStatusEl.textContent = message;
                const statusColors = { info: '#555', success: '#067d62', error: '#b12704' };
                backendStatusEl.style.color = statusColors[type] || statusColors.info;
            }

            async function updateDefaultStatusSummary() {
                const keys = await listValues();
                const asinCount = keys.filter(key => key.startsWith("ASIN_")).length;
                const backendName = await getValue('pythonanywherebackend', 'hutaufvine');
                updateStatusMessage(`Bereit. Lokale Datenbank: ${asinCount} Einträge. Backend: ${backendName}.`);
            }

            function applyDisplayFilters(items, settings, cancellations = []) {
                return items.filter(item => {
                    const itemDate = new Date(item.date);
                    const itemYear = itemDate.getFullYear();
                    const itemMonth = itemDate.getMonth();
                    if (settings.yearFilter !== "show all years") {
                        if (settings.yearFilter === "show current year") {
                            const currentYear = new Date().getFullYear();
                            if (itemYear !== currentYear) return false;
                        } else if (settings.yearFilter === "only 2023" && settings.add2ndhalf2023to2024) {
                            if (!(itemYear === 2023 && itemMonth < 6)) return false;
                        } else if (settings.yearFilter === "only 2024" && settings.add2ndhalf2023to2024) {
                            if (!(itemYear === 2024 || (itemYear === 2023 && itemMonth >= 6))) return false;
                        } else if (settings.yearFilter !== `only ${itemYear}`) {
                            return false;
                        }
                    }
                    if ((!settings.cancellations) && cancellations.includes(item.ASIN)) return false;
                    if ((!settings.tax0) && item.etv == 0) return false;
                    return true;
                });
            }

            function ensureXlsxYearFallbackOption(selectEl) {
                if (!selectEl) return;
                if (selectEl.options.length === 0) {
                    const currentYear = String(new Date().getFullYear());
                    selectEl.innerHTML = `<option value="${currentYear}">${currentYear}</option>`;
                }
            }

            function readAmazonYearOptions() {
                return Array.from(document.querySelectorAll('select#vvp-tax-year-dropdown option'))
                    .map(option => ({
                        value: option.value.trim(),
                        label: option.textContent.trim(),
                        selected: option.selected
                    }))
                    .filter(option => option.value.length > 0);
            }

            function syncXlsxYearSelectFromAmazon(selectEl) {
                if (!selectEl) return false;
                const amazonOptions = readAmazonYearOptions();
                if (amazonOptions.length === 0) {
                    ensureXlsxYearFallbackOption(selectEl);
                    return false;
                }

                const previousValue = selectEl.value;
                selectEl.innerHTML = amazonOptions
                    .map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
                    .join('');

                const amazonSelected = amazonOptions.find(option => option.selected);
                const preferredValue = previousValue || (amazonSelected ? amazonSelected.value : amazonOptions[0].value);
                if (amazonOptions.some(option => option.value === preferredValue)) {
                    selectEl.value = preferredValue;
                } else {
                    selectEl.value = amazonSelected ? amazonSelected.value : amazonOptions[0].value;
                }
                return true;
            }

            async function initializeXlsxYearSelector(selectEl) {
                ensureXlsxYearFallbackOption(selectEl);
                if (syncXlsxYearSelectFromAmazon(selectEl)) return;

                // Amazon UI can render later; retry a few times.
                for (let attempt = 0; attempt < 20; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    if (syncXlsxYearSelectFromAmazon(selectEl)) return;
                }

                // Keep syncing in background if Amazon injects years later.
                const observer = new MutationObserver(() => {
                    if (syncXlsxYearSelectFromAmazon(selectEl)) {
                        observer.disconnect();
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
            }

            function deriveVineStartYear(defaultStartYear = 2023) {
                const currentYear = new Date().getFullYear();
                try {
                    const contextScript = document.querySelector('script[data-a-state*="vvp-context"]');
                    if (!contextScript || !contextScript.textContent) {
                        console.log(`[VineTaxTools] Could not find vvp-context script. Falling back to ${defaultStartYear}.`);
                        return defaultStartYear;
                    }

                    const context = JSON.parse(contextScript.textContent);
                    const acceptanceDateMs = context?.voiceDetails?.acceptanceDate;
                    if (!acceptanceDateMs) {
                        console.log(`[VineTaxTools] voiceDetails.acceptanceDate missing. Falling back to ${defaultStartYear}.`);
                        return defaultStartYear;
                    }

                    const acceptanceDate = new Date(Number(acceptanceDateMs));
                    if (Number.isNaN(acceptanceDate.getTime())) {
                        console.log(`[VineTaxTools] acceptanceDate invalid (${acceptanceDateMs}). Falling back to ${defaultStartYear}.`);
                        return defaultStartYear;
                    }

                    const derivedStartYear = acceptanceDate.getFullYear();
                    const normalizedStartYear = Math.min(derivedStartYear, currentYear);
                    console.log(`[VineTaxTools] Derived start year from voiceDetails.acceptanceDate (${acceptanceDateMs}): ${normalizedStartYear}.`);
                    return normalizedStartYear;
                } catch (error) {
                    console.log(`[VineTaxTools] Failed to parse vvp-context for acceptanceDate. Falling back to ${defaultStartYear}.`, error);
                    return defaultStartYear;
                }
            }

            function buildYearFilterOptionsHtml(settings) {
                const currentYear = new Date().getFullYear();
                const startYear = deriveVineStartYear(2023);
                const yearOptions = [];
                for (let year = startYear; year <= currentYear; year++) {
                    yearOptions.push(year);
                }

                const validValues = new Set(["show all years", "show current year", ...yearOptions.map(year => `only ${year}`)]);
                const selectedValue = validValues.has(settings.yearFilter) ? settings.yearFilter : "show all years";

                const optionsHtml = [
                    `<option value="show all years"${selectedValue === "show all years" ? " selected" : ""}>Show all years</option>`,
                    `<option value="show current year"${selectedValue === "show current year" ? " selected" : ""}>Show current year (${currentYear})</option>`,
                    ...yearOptions.map(year => `<option value="only ${year}"${selectedValue === `only ${year}` ? " selected" : ""}>Only ${year}</option>`)
                ];

                return optionsHtml.join('');
            }


            async function listValues() {
              try {
                return (await db.keyValuePairs.toCollection().primaryKeys());
              } catch (error) {
                console.error("Error listing values:", error);
                return [];
              }
            }

            async function validateAndFixDatabase() {
              try {
                const keys = await listValues();
                const asinKeys = keys.filter(key => key.startsWith("ASIN_"));
                const invalidAsins = [];

                for (const asinKey of asinKeys) {
                  const asin = asinKey.replace("ASIN_", "");
                  
                  // Valid ASIN must have length 10 and start with a number or 'B'
                  if (asin.length !== 10 || !/^[0-9B]/.test(asin)) {
                    invalidAsins.push(asin);
                    await db.keyValuePairs.delete(asinKey);
                    console.log(`Removed invalid ASIN: ${asin}`);
                  }
                }

                if (invalidAsins.length > 0) {
                  console.log(`Database cleanup complete. Removed ${invalidAsins.length} invalid ASIN(s): ${invalidAsins.join(', ')}`);
                } else {
                  console.log("Database validation complete. All ASINs are valid.");
                }
              } catch (error) {
                console.error("Error during database validation:", error);
              }
            }

            function getTeilwert(item, settings) {
                if (item.myteilwert != null) {
                    return item.myteilwert;
                }
                if (
                  !Object.prototype.hasOwnProperty.call(item, 'myteilwert')
                  && item.myTeilwert != null
                ) {
                    return item.myTeilwert;
                }
                if (settings.useTeilwertV2) {
                    return item.teilwert_v2;
                }
                return item.teilwert;
            }

            function getPDFLink(item, settings) {
                if (settings.useTeilwertV2) {
                    return `https://hutauf.org/oracle2/files/Teilwert_v2_${item.ASIN}.pdf`;
                }
                return item.pdf;
            }


            function calculateEuerValues(item, settings, avgTeilwertEtvRatio) {
                let use_teilwert = getTeilwert(item, settings) ?? (item.etv * avgTeilwertEtvRatio);
                if (item.storniert) return { einnahmen: 0, ausgaben: 0, entnahmen: 0, einnahmen_aus_anlagevermoegen: 0 };

                const itemDate = new Date(item.date);
                const cutoffDate = new Date(2024, 9, 1);

                let einnahmen = 0;
                let ausgaben = 0;
                let entnahmen = 0;
                let einnahmen_aus_anlagevermoegen = 0;

                if (settings.einnahmezumteilwert && itemDate < cutoffDate) {
                    einnahmen += use_teilwert;
                    ausgaben += use_teilwert;
                } else {
                    einnahmen += item.etv;
                    ausgaben += item.etv;
                }

                if (item.entsorgt || item.lager || item.betriebsausgabe) return { einnahmen, ausgaben, entnahmen, einnahmen_aus_anlagevermoegen };

                if (item.verkauft) {
                    einnahmen_aus_anlagevermoegen += use_teilwert;
                } else {
                    entnahmen += use_teilwert;
                }

                return { einnahmen, ausgaben, entnahmen, einnahmen_aus_anlagevermoegen };
            }

               function etvstrtofloat(etvString) {
                if (typeof etvString === 'number') {
                    return etvString;
                }
                  if (typeof etvString !== 'string') {
                    return NaN;
                  }
                  const cleanString = etvString.replace(/[€\s]/g, '');
                  if (cleanString === '') {
                    return NaN;
                  }
                  const cleanedValue = cleanString.replace(/[.,](?=\d{3})/g, '');
                  const etv = Number(cleanedValue.replace(',', '.'));
                  return etv;
              }

              function parseDateSafe(dateStr) {
                if (!dateStr) return null;
                if (dateStr instanceof Date) {
                  return Number.isNaN(dateStr.getTime()) ? null : new Date(dateStr.getTime());
                }
                if (typeof dateStr !== 'string') return null;
                let trimmed = dateStr.trim();
                if (!trimmed) return null;

                const createValidatedDate = (year, month, day) => {
                  const numericYear = Number(year);
                  const numericMonth = Number(month);
                  const numericDay = Number(day);
                  if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || !Number.isInteger(numericDay)) {
                    return null;
                  }
                  const parsed = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));
                  if (
                    parsed.getUTCFullYear() !== numericYear
                    || parsed.getUTCMonth() !== numericMonth - 1
                    || parsed.getUTCDate() !== numericDay
                  ) {
                    return null;
                  }
                  return parsed;
                };

                // if first 4 digits are a year, assume YYYY-MM-DD format
                if (/^\d{4}/.test(trimmed)) {
                    const isoDateParts = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
                    if (isoDateParts && !createValidatedDate(isoDateParts[1], isoDateParts[2], isoDateParts[3])) {
                      return null;
                    }
                    const parsed = new Date(trimmed);
                    if (!Number.isNaN(parsed.getTime())) return parsed;
                }

                // remove time or other trailing parts
                const fullDateText = trimmed;
                trimmed = trimmed.split(/[ ,]/)[0];

                // formats DD[./-]MM[./-]YYYY or DD[./-]MM[./-]YY
                let match = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
                if (match) {
                  let day = match[1].padStart(2, '0');
                  let month = match[2].padStart(2, '0');
                  let year = match[3];
                  if (year.length === 2) year = '20' + year;
                  const parsed = createValidatedDate(year, month, day);
                  if (parsed) return parsed;
                }

                // formats YYYY[./-]MM[./-]DD or YY[./-]MM[./-]DD
                match = trimmed.match(/^(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})$/);
                if (match) {
                  let year = match[1];
                  let month = match[2].padStart(2, '0');
                  let day = match[3].padStart(2, '0');
                  if (year.length === 2) year = '20' + year;
                  const parsed = createValidatedDate(year, month, day);
                  if (parsed) return parsed;
                }

                // textual month names e.g. 1. Januar 2024
                trimmed = fullDateText.replace(/\//g, '.').replace(/\s+/g, ' ').trim();

                const monthNames = {
                  'Januar':1,'Februar':2,'März':3,'Maerz':3,'April':4,'Mai':5,
                  'Juni':6,'Juli':7,'August':8,'September':9,'Oktober':10,'November':11,'Dezember':12
                };

                match = trimmed.match(/(\d{1,2})\.?\s*([A-Za-zäöüÄÖÜß]+)\s*(\d{2,4})/);
                if (match) {
                  const day = match[1].padStart(2, '0');
                  const monthIndex = monthNames[match[2]];
                  let year = match[3];
                  if (year.length === 2) year = '20' + year;
                  if (monthIndex) {
                    const parsed = createValidatedDate(year, monthIndex, day);
                    if (parsed) return parsed;
                  }
                }

                return null;
              }

              const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
              const BACKEND_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
              const REQUEST_TIMEOUT_MS = 30000;

              function normalizeAsin(value) {
                if (typeof value !== 'string') return null;
                const asin = value.trim().toUpperCase();
                return ASIN_PATTERN.test(asin) ? asin : null;
              }

              function parseStoredProduct(value, context = 'product') {
                const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                  throw new Error(`Invalid ${context}: expected a JSON object.`);
                }

                const hasLegacyMyTeilwert = Object.prototype.hasOwnProperty.call(parsed, 'myteilwert');
                const hasCanonicalMyTeilwert = Object.prototype.hasOwnProperty.call(parsed, 'myTeilwert');
                if (hasLegacyMyTeilwert) {
                  parsed.myTeilwert = parsed.myteilwert;
                } else if (hasCanonicalMyTeilwert) {
                  parsed.myteilwert = parsed.myTeilwert;
                }

                const usageStatus = Array.isArray(parsed.usageStatus)
                  ? [...parsed.usageStatus]
                  : [];
                const legacyUsageFields = [
                  ['verkauft', 'verkauft'],
                  ['lager', 'Lager'],
                  ['entsorgt', 'entsorgt'],
                  ['storniert', 'storniert'],
                  ['betriebsausgabe', 'betriebliche Nutzung']
                ];
                for (const [field, status] of legacyUsageFields) {
                  if (parsed[field] === true) {
                    if (!usageStatus.includes(status)) usageStatus.push(status);
                  } else if (parsed[field] === false) {
                    for (let index = usageStatus.length - 1; index >= 0; index--) {
                      if (usageStatus[index] === status) usageStatus.splice(index, 1);
                    }
                  } else {
                    parsed[field] = usageStatus.includes(status);
                  }
                }
                parsed.usageStatus = usageStatus;
                return parsed;
              }

              function validateDatabaseImport(value) {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                  throw new Error('Import muss ein JSON-Objekt sein.');
                }
                const records = [];
                for (const [key, storedValue] of Object.entries(value)) {
                  if (!key.startsWith('ASIN_')) {
                    throw new Error(`Nicht erlaubter Schlüssel im Import: ${key}`);
                  }
                  const asin = normalizeAsin(key.slice(5));
                  if (!asin || key !== `ASIN_${asin}`) {
                    throw new Error(`Ungültiger ASIN-Schlüssel im Import: ${key}`);
                  }
                  const product = parseStoredProduct(storedValue, `imported product ${asin}`);
                  records.push({ key, value: JSON.stringify(product) });
                }
                if (records.length === 0) {
                  throw new Error('Import enthält keine Produkte.');
                }
                return records;
              }

              function isValidBackendName(value) {
                return typeof value === 'string' && BACKEND_NAME_PATTERN.test(value.trim());
              }

              function getPrivateBackendUrl(backendName) {
                if (!isValidBackendName(backendName)) {
                  throw new Error('Invalid PythonAnywhere backend name.');
                }
                return `https://${backendName.trim().toLowerCase()}.pythonanywhere.com/data_operations`;
              }

              function getStringHash(value) {
                let hash = 2166136261;
                const text = String(value);
                for (const character of text) {
                  hash ^= character.charCodeAt(0);
                  hash = Math.imul(hash, 16777619);
                }
                return (hash >>> 0).toString(16).padStart(8, '0');
              }

              function getStringFingerprint(value) {
                const text = String(value);
                return `${text.length.toString(16)}-${getStringHash(text)}`;
              }

              function getTokenStorageScope(token) {
                return getStringHash(token);
              }

              function escapeHtml(value) {
                return String(value ?? '')
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
              }

              function getSafeHttpUrl(value) {
                if (typeof value !== 'string' || value.trim() === '') return null;
                try {
                  const url = new URL(value, window.location.origin);
                  return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
                } catch (_error) {
                  return null;
                }
              }

              let teilwertOutsideClickHandlerInstalled = false;

              function installTeilwertOutsideClickHandler() {
                if (teilwertOutsideClickHandlerInstalled) return;
                teilwertOutsideClickHandlerInstalled = true;
                document.addEventListener('click', function(event) {
                  const overlay = document.getElementById('teilwert-overlay');
                  if (overlay && !overlay.contains(event.target)) {
                    const spawnDate = Number(overlay.getAttribute('data-spawn-date'));
                    if (Date.now() - spawnDate > 300) {
                      overlay.remove();
                    }
                  }
                });
              }

              function setProgress(text, percentage = null) {
                const progressBar = window.progressBar;
                if (!progressBar) return;
                progressBar.show();
                progressBar.setText(text);
                if (percentage != null) {
                  progressBar.setFillWidth(Math.max(0, Math.min(100, percentage)));
                }
              }

              const AUTOMATIC_SYNC_TOTAL_STEPS = 7;

              function setAutomaticSyncStep(step, text, fraction = 1, type = "info") {
                const safeStep = Math.max(1, Math.min(AUTOMATIC_SYNC_TOTAL_STEPS, Number(step) || 1));
                const safeFraction = Math.max(0, Math.min(1, Number(fraction) || 0));
                const percentage = ((safeStep - 1 + safeFraction) / AUTOMATIC_SYNC_TOTAL_STEPS) * 100;
                const message = `Automatischer Sync – Schritt ${safeStep}/${AUTOMATIC_SYNC_TOTAL_STEPS}: ${text}`;
                setProgress(message, percentage);
              }

              function gmRequest(options) {
                return new Promise((resolve, reject) => {
                  let settled = false;
                  const finish = (callback, value) => {
                    if (settled) return;
                    settled = true;
                    callback(value);
                  };
                  const rejectWith = (message, response) => {
                    const error = new Error(message);
                    if (response && Number.isFinite(Number(response.status))) {
                      error.status = Number(response.status);
                    }
                    finish(reject, error);
                  };

                  try {
                    GM_xmlhttpRequest({
                      ...options,
                      timeout: options.timeout ?? REQUEST_TIMEOUT_MS,
                      onload: (response) => {
                        if (response.status >= 200 && response.status < 300) {
                          finish(resolve, response);
                        } else {
                          rejectWith(`HTTP ${response.status} while contacting the server.`, response);
                        }
                      },
                      onerror: (response) => rejectWith('Network error while contacting the server.', response),
                      onabort: (response) => rejectWith('Request was aborted.', response),
                      ontimeout: (response) => rejectWith('Request timed out.', response)
                    });
                  } catch (error) {
                    finish(reject, error);
                  }
                });
              }

              async function postJson(url, body) {
                const response = await gmRequest({
                  method: 'POST',
                  url,
                  headers: { 'Content-Type': 'application/json' },
                  data: JSON.stringify(body)
                });

                try {
                  return JSON.parse(response.responseText);
                } catch (_error) {
                  throw new Error('Server returned invalid JSON.');
                }
              }

              class PrivateBackendHandler {
                constructor() {
                  this.operationQueue = Promise.resolve();
                  this.pendingSyncProducts = new Map();
                  this.syncInFlight = null;
                }

                enqueue(operation) {
                  const next = this.operationQueue.catch(() => undefined).then(operation);
                  this.operationQueue = next.catch(() => undefined);
                  return next;
                }

                async getPrivateConfig() {
                  const token = await getValue("token");
                  if (!token) {
                    return null;
                  }
                  const pythonanywherebackend = await getValue("pythonanywherebackend", "hutaufvine");
                  return {
                    token: String(token),
                    backendName: String(pythonanywherebackend).trim().toLowerCase(),
                    storageScope: getTokenStorageScope(token),
                    url: getPrivateBackendUrl(String(pythonanywherebackend))
                  };
                }

                async postPrivate(config, request, payload) {
                  const body = { token: config.token, request };
                  if (payload !== undefined) body.payload = payload;
                  const result = await postJson(config.url, body);
                  if (!result || result.status !== 'success') {
                    throw new Error(result?.message || `Private backend rejected ${request}.`);
                  }
                  return result;
                }

                async clearPrivateSyncMarkers(config) {
                  const markerPrefixes = [
                    `PRIVATE_BACKEND_TIMESTAMP_${config.backendName}_${config.storageScope}_`,
                    `PRIVATE_BACKEND_FINGERPRINT_${config.backendName}_${config.storageScope}_`
                  ];
                  const keys = await db.keyValuePairs.toCollection().primaryKeys();
                  const markerKeys = keys.filter(
                    key => typeof key === 'string'
                      && markerPrefixes.some(prefix => key.startsWith(prefix))
                  );
                  for (const key of markerKeys) {
                    await db.keyValuePairs.delete(key);
                  }
                }

                deleteDatabase() {
                  return this.enqueue(async () => {
                    const config = await this.getPrivateConfig();
                    if (!config) {
                      updateBackendStatusText("Privates Backend: kein Token konfiguriert.", "info");
                      return { skipped: true };
                    }
                    setProgress('Privates Backend: Daten werden gelöscht ...', 0);
                    try {
                      await this.postPrivate(config, "delete_all");
                      await this.clearPrivateSyncMarkers(config);
                      setProgress('Privates Backend: Daten gelöscht.', 100);
                      updateBackendStatusText("Privates Backend: Daten gelöscht.", "success");
                      return { deleted: true };
                    } catch (error) {
                      updateBackendStatusText(`Privates Backend: Löschen fehlgeschlagen (${error.message}).`, "error");
                      throw error;
                    }
                  });
                }

                downloadDatabase() {
                  return this.enqueue(async () => {
                    const config = await this.getPrivateConfig();
                    if (!config) {
                      updateBackendStatusText("Privates Backend: kein Token konfiguriert.", "info");
                      return { skipped: true };
                    }

                    setProgress('Privates Backend: Serverdaten werden abgerufen ...', 0);
                    try {
                      const result = await this.postPrivate(config, "get_all");
                      if (!Array.isArray(result.data)) {
                        throw new Error('Private backend returned an invalid data list.');
                      }

                      const entries = result.data.map((entry) => {
                        const asin = normalizeAsin(entry?.ASIN);
                        if (!asin || typeof entry?.value !== 'string') {
                          throw new Error('Private backend returned an invalid product entry.');
                        }
                        const timestamp = Number(entry.last_update_time);
                        if (!Number.isInteger(timestamp) || timestamp < 0) {
                          throw new Error(`Private backend returned an invalid timestamp for ${asin}.`);
                        }
                        parseStoredProduct(entry.value, `server product ${asin}`);
                        return { asin, timestamp, value: entry.value };
                      });

                      let updated = 0;
                      let unchanged = 0;
                      for (let index = 0; index < entries.length; index++) {
                        const entry = entries[index];
                        setProgress(
                          `Privates Backend: ${index + 1}/${entries.length} Produkte werden geprüft ...`,
                          entries.length ? ((index + 1) / entries.length) * 100 : 100
                        );
                        const productKey = `ASIN_${entry.asin}`;
                        const timestampKey = `PRIVATE_BACKEND_TIMESTAMP_${config.backendName}_${config.storageScope}_${entry.asin}`;
                        const fingerprintKey = `PRIVATE_BACKEND_FINGERPRINT_${config.backendName}_${config.storageScope}_${entry.asin}`;
                        const remoteFingerprint = getStringFingerprint(entry.value);
                        const localValue = await getValue(productKey);
                        const lastSeenTimestamp = await getValue(timestampKey, null);
                        const lastSeenFingerprint = await getValue(fingerprintKey, null);
                        const hasComparableTimestamp = lastSeenTimestamp != null
                          && Number.isInteger(Number(lastSeenTimestamp));
                        const hasComparableFingerprint = typeof lastSeenFingerprint === 'string'
                          && lastSeenFingerprint.length > 0;
                        const isNewerRemote = hasComparableTimestamp
                          && entry.timestamp > Number(lastSeenTimestamp);
                        const isChangedEqualTimestamp = hasComparableTimestamp
                          && hasComparableFingerprint
                          && entry.timestamp === Number(lastSeenTimestamp)
                          && remoteFingerprint !== lastSeenFingerprint;

                        if (
                          !localValue
                          || !hasComparableTimestamp
                          || !hasComparableFingerprint
                          || isNewerRemote
                          || isChangedEqualTimestamp
                        ) {
                          await setValue(productKey, entry.value);
                          await setValue(timestampKey, entry.timestamp);
                          await setValue(fingerprintKey, remoteFingerprint);
                          updated++;
                        } else {
                          unchanged++;
                        }
                      }

                      setProgress(`Privates Backend: Download abgeschlossen (${updated} aktualisiert, ${unchanged} unverändert).`, 100);
                      updateBackendStatusText(`Privates Backend: Download erfolgreich (${updated} aktualisiert, ${unchanged} unverändert).`, "success");
                      return { updated, unchanged };
                    } catch (error) {
                      updateBackendStatusText(`Privates Backend: Download fehlgeschlagen (${error.message}).`, "error");
                      throw error;
                    }
                  });
                }

                uploadLocalDatabase() {
                  return this.enqueue(async () => {
                    const config = await this.getPrivateConfig();
                    if (!config) {
                      updateBackendStatusText("Privates Backend: kein Token konfiguriert.", "info");
                      return { skipped: true };
                    }

                    setProgress('Privates Backend: Lokale Daten werden vorbereitet ...', 0);
                    try {
                      const asinDataAll = await getAllAsinValues();
                      const asinKeys = Object.keys(asinDataAll).filter(key => key.startsWith("ASIN_"));
                      const payload = [];
                      const invalidDates = [];

                      for (let index = 0; index < asinKeys.length; index++) {
                        const asinKey = asinKeys[index];
                        const asin = normalizeAsin(asinKey.slice(5));
                        if (!asin) continue;
                        setProgress(
                          `Privates Backend: ${index + 1}/${asinKeys.length} Produkte werden vorbereitet ...`,
                          asinKeys.length ? ((index + 1) / asinKeys.length) * 100 : 100
                        );
                        const parsedData = parseStoredProduct(asinDataAll[asinKey], `local product ${asin}`);
                        const jsDate = parseDateSafe(parsedData.date);
                        if (!jsDate) {
                          invalidDates.push(parsedData.date);
                          continue;
                        }
                        parsedData.date = jsDate.toISOString();
                        payload.push({ ASIN: asin, timestamp: 0, value: JSON.stringify(parsedData) });
                      }

                      if (payload.length === 0) {
                        updateBackendStatusText("Privates Backend: keine gültigen lokalen Produkte zum Hochladen.", "info");
                        return { uploaded: 0, invalidDates };
                      }

                      setProgress(`Privates Backend: ${payload.length} Produkte werden hochgeladen ...`, 0);
                      await this.postPrivate(config, "update_asin", payload);
                      setProgress(`Privates Backend: ${payload.length} Produkte hochgeladen.`, 100);
                      updateBackendStatusText(`Privates Backend: Upload erfolgreich (${payload.length} Produkte).`, "success");
                      return { uploaded: payload.length, invalidDates };
                    } catch (error) {
                      updateBackendStatusText(`Privates Backend: Upload fehlgeschlagen (${error.message}).`, "error");
                      throw error;
                    }
                  });
                }

                async readAllProducts() {
                  const asinDataAll = await getAllAsinValues();
                  const products = [];
                  for (const [key, value] of Object.entries(asinDataAll)) {
                    const asin = normalizeAsin(key.slice(5));
                    if (!asin) continue;
                    products.push({ ...parseStoredProduct(value, `local product ${asin}`), ASIN: asin });
                  }
                  return products;
                }

                async syncProductsBatch(products) {
                  const lastFullSync = await getValue('last_full_sync', 0);
                  const needFullSync = Date.now() - Number(lastFullSync || 0) > 7 * 24 * 60 * 60 * 1000;
                  const sourceProducts = needFullSync ? await this.readAllProducts() : products;
                  const estimatorProducts = sourceProducts.filter(
                    product => needFullSync || !product.pdf || product.pdf === 'NaN' || product.teilwert_v2 == null
                  );
                  const anonPayload = estimatorProducts.map(product => ({
                    ASIN: product.ASIN,
                    name: product.name,
                    ETV: product.etv
                  }));

                  let estimatorError = null;
                  if (anonPayload.length > 0) {
                    setAutomaticSyncStep(
                      3,
                      `${anonPayload.length} Produkte werden an den Teilwertschätzer gesendet ...`,
                      0.35
                    );
                    try {
                      const responseData = await postJson(
                        'https://hutaufvine.pythonanywhere.com/upload_asins',
                        anonPayload
                      );
                      if (responseData?.status && responseData.status !== 'success') {
                        throw new Error(responseData.message || 'Teilwert backend rejected the request.');
                      }
                      const existingAsins = Array.isArray(responseData?.existing_asins)
                        ? responseData.existing_asins
                        : [];
                      setAutomaticSyncStep(
                        4,
                        existingAsins.length
                          ? `${existingAsins.length} Teilwert-Antworten werden lokal eingearbeitet ...`
                          : 'Die Teilwert-Antwort enthält keine lokalen Aktualisierungen.',
                        existingAsins.length ? 0 : 1
                      );
                      for (let index = 0; index < existingAsins.length; index++) {
                        const existingAsin = existingAsins[index];
                        setAutomaticSyncStep(
                          4,
                          `Teilwert-Antwort ${index + 1}/${existingAsins.length} wird lokal geprüft ...`,
                          (index + 1) / existingAsins.length
                        );
                        const asin = normalizeAsin(existingAsin?.asin);
                        if (!asin) continue;
                        const asinKey = `ASIN_${asin}`;
                        const localValue = await getValue(asinKey);
                        if (!localValue) continue;
                        const updated = {
                          ...parseStoredProduct(localValue, `local product ${asin}`),
                          keepa: existingAsin.keepa,
                          teilwert: existingAsin.teilwert,
                          teilwert_v2: existingAsin.teilwert_v2,
                          pdf: existingAsin.pdf
                        };
                        await setValue(asinKey, JSON.stringify(updated));
                      }
                      if (needFullSync) {
                        await setValue('last_full_sync', Date.now());
                      }
                    } catch (error) {
                      estimatorError = error;
                      setAutomaticSyncStep(
                        4,
                        `Teilwertschätzer fehlgeschlagen: ${error.message}`,
                        1,
                        "error"
                      );
                    }
                  } else {
                    setAutomaticSyncStep(3, 'Keine Teilwert-Anfrage erforderlich.', 1);
                    setAutomaticSyncStep(4, 'Keine Teilwert-Antwort zu verarbeiten.', 1);
                  }

                  let privateError = null;
                  const config = await this.getPrivateConfig();
                  if (config) {
                    setAutomaticSyncStep(
                      5,
                      'Produktdaten für das private Backend werden vorbereitet ...',
                      0.15
                    );
                    try {
                      const privatePayload = [];
                      const seenAsins = new Set();
                      for (const product of sourceProducts) {
                        const asin = normalizeAsin(product?.ASIN);
                        if (!asin || seenAsins.has(asin)) continue;
                        seenAsins.add(asin);
                        const localValue = await getValue(`ASIN_${asin}`);
                        if (!localValue) continue;
                        privatePayload.push({
                          ASIN: asin,
                          timestamp: 0,
                          value: JSON.stringify(parseStoredProduct(localValue, `local product ${asin}`))
                        });
                      }
                      if (privatePayload.length > 0) {
                        setAutomaticSyncStep(
                          5,
                          `${privatePayload.length} Produkte werden auf dem privaten Backend gesichert ...`,
                          0.5
                        );
                        await this.postPrivate(config, 'update_asin', privatePayload);
                        setAutomaticSyncStep(
                          5,
                          `${privatePayload.length} Produkte wurden auf dem privaten Backend gesichert.`,
                          1
                        );
                      } else {
                        setAutomaticSyncStep(5, 'Keine privaten Produktdaten zum Hochladen.', 1);
                      }
                    } catch (error) {
                      privateError = error;
                      setAutomaticSyncStep(
                        5,
                        `Privates Backend fehlgeschlagen: ${error.message}`,
                        1,
                        "error"
                      );
                    }
                  } else {
                    setAutomaticSyncStep(5, 'Kein privates Backend-Token – dieser Schritt wurde übersprungen.', 1);
                  }

                  if (estimatorError || privateError) {
                    const messages = [];
                    if (estimatorError) messages.push(`Teilwertschätzer: ${estimatorError.message}`);
                    if (privateError) messages.push(`Privates Backend: ${privateError.message}`);
                    throw new Error(messages.join('; '));
                  }

                  return { estimatorCount: anonPayload.length, privateSync: Boolean(config) };
                }

                syncProducts(products) {
                  if (Array.isArray(products)) {
                    for (const product of products) {
                      const asin = normalizeAsin(product?.ASIN);
                      if (asin) {
                        this.pendingSyncProducts.set(asin, { ...product, ASIN: asin });
                      }
                    }
                  }
                  if (this.pendingSyncProducts.size === 0 && !this.syncInFlight) {
                    setAutomaticSyncStep(3, 'Keine Produkte für den Teilwertschätzer vorhanden.', 1);
                    setAutomaticSyncStep(4, 'Keine Teilwert-Antwort zu verarbeiten.', 1);
                    setAutomaticSyncStep(5, 'Keine privaten Produktdaten zum Hochladen.', 1);
                    return Promise.resolve({ skipped: true });
                  }
                  if (!this.syncInFlight) {
                    this.syncInFlight = this.enqueue(async () => {
                      try {
                        let result = { skipped: true };
                        const errors = [];
                        while (this.pendingSyncProducts.size > 0) {
                          const batch = Array.from(this.pendingSyncProducts.values());
                          this.pendingSyncProducts.clear();
                          try {
                            result = await this.syncProductsBatch(batch);
                          } catch (error) {
                            errors.push(error instanceof Error ? error : new Error(String(error)));
                          }
                        }
                        if (errors.length === 1) throw errors[0];
                        if (errors.length > 1) {
                          const combinedError = new Error(
                            errors.map(error => error.message).join('; ')
                          );
                          combinedError.errors = errors;
                          throw combinedError;
                        }
                        return result;
                      } finally {
                        this.syncInFlight = null;
                      }
                    });
                  }
                  return this.syncInFlight;
                }

                async createButtons() {
                  const container = document.createElement('div');
                  container.innerHTML = `
                    <button id="setTokenButton" style="margin-top: 10px;">Set token</button>
                    <button id="setBackendButton" style="margin-top: 10px;">Set backend</button>
                    <button id="uploadButton" style="margin-top: 10px;">Upload data</button>
                    <button id="downloadButton" style="margin-top: 10px;">Download data</button>
                    <button id="deleteButton" style="margin-top: 10px;">Delete data</button>
                  `;
                    const backendName = await getValue('pythonanywherebackend', 'hutaufvine');
                    const backendLabel = document.createElement('span');
                    backendLabel.id = 'backendLabel';
                    backendLabel.style.marginLeft = '10px';
                    backendLabel.style.fontWeight = 'bold';
                    backendLabel.textContent = `Backend: ${backendName}`;
                    container.appendChild(backendLabel);
                    const backendStatus = document.createElement('span');
                    backendStatus.id = 'backendStatus';
                    backendStatus.style.marginLeft = '8px';
                    backendStatus.style.fontSize = '12px';
                    backendStatus.textContent = '';
                    container.appendChild(backendStatus);

                  container.querySelector('#setTokenButton').addEventListener('click', async () => {
                    const token = prompt('Enter token:');
                    if (token === null) return;
                    const normalizedToken = token.trim();
                    if (!normalizedToken) {
                      alert('Token darf nicht leer sein.');
                      return;
                    }
                    await setValue('token', normalizedToken);
                    updateBackendStatusText('Status: Token gespeichert.', 'success');
                  });
                  container.querySelector('#setBackendButton').addEventListener('click', async () => {
                    const pythonanywherebackend = prompt('Enter pythonanywhere backend name (pythonanywhere user account name):');
                    if (pythonanywherebackend === null) return;
                    const normalizedBackend = pythonanywherebackend.trim().toLowerCase();
                    if (!isValidBackendName(normalizedBackend)) {
                      alert('Ungültiger PythonAnywhere-Benutzername.');
                      return;
                    }
                    await setValue('pythonanywherebackend', normalizedBackend);
                    document.getElementById('backendLabel').textContent = `Backend: ${normalizedBackend}`;
                    updateBackendStatusText('Status: Backend geändert.', 'success');
                  });

                  container.querySelector('#uploadButton').addEventListener('click', async () => {
                    try {
                      await this.uploadLocalDatabase();
                    } catch (error) {
                      console.error('Private backend upload failed:', error.message);
                    }
                  });

                  container.querySelector('#downloadButton').addEventListener('click', async () => {
                    try {
                      await this.downloadDatabase();
                    } catch (error) {
                      console.error('Private backend download failed:', error.message);
                    }
                  });

                  container.querySelector('#deleteButton').addEventListener('click', async () => {
                    if (!confirm('Wirklich alle Daten auf dem privaten Backend löschen?')) return;
                    try {
                      await this.deleteDatabase();
                    } catch (error) {
                      console.error('Private backend delete failed:', error.message);
                    }
                  });

                  return container;
                }
              }

              const backendHandler = new PrivateBackendHandler();




              async function load_all_asin_etv_values_from_storage(progressOptions = null) {
                  const automaticSyncStep = progressOptions?.automaticSyncStep;
                  const updateLocalLoadProgress = (text, fraction) => {
                    if (automaticSyncStep) {
                      setAutomaticSyncStep(automaticSyncStep, text, fraction);
                    } else {
                      setProgress(text, fraction * 100);
                    }
                  };
                  updateLocalLoadProgress('Lokale Produktdaten werden geöffnet ...', 0);
                  let keys = await listValues();
                  let asinKeys = keys.filter(key => key.startsWith("ASIN_"));

                  let asinDataAll = await getAllAsinValues();

                  let asinData = [];
                  let errorDates = [];

                  for (let index = 0; index < asinKeys.length; index++) {
                      const asinKey = asinKeys[index];
                      let asin = asinKey.replace("ASIN_", "");
                      updateLocalLoadProgress(
                        `Lokale Produktdaten ${index + 1}/${asinKeys.length} werden geladen ...`,
                        asinKeys.length ? ((index + 1) / asinKeys.length) : 1
                      );

                      let jsonData = asinDataAll[asinKey]; //await getValue(asinKey);

                      let parsedData = parseStoredProduct(jsonData, `local product ${asin}`);
                      let jsDate = parseDateSafe(parsedData.date);
                      if (!jsDate) {
                        errorDates.push(parsedData.date);
                        continue;
                      }
                      parsedData.date = jsDate.toISOString();

                      asinData.push({
                          ...parsedData,
                          ASIN: asin
                      });
                  };

                  if (errorDates.length > 0) {
                    alert('Fehler beim Lesen folgender Datumsangaben: ' + errorDates.join(', '));
                  }

                  updateLocalLoadProgress(
                    asinKeys.length
                      ? `${asinData.length} lokale Produkte wurden geladen.`
                      : 'Die lokale Produktdatenbank ist leer.',
                    1
                  );
                  return asinData;
              }

              function createSimpleProgressBar(container, appendImmediately = true) {
                const progressBarContainer = document.createElement('div');
                progressBarContainer.id = 'simpleProgressBarContainer';
                progressBarContainer.setAttribute('role', 'progressbar');
                progressBarContainer.setAttribute('aria-valuemin', '0');
                progressBarContainer.setAttribute('aria-valuemax', '100');
                progressBarContainer.setAttribute('aria-valuenow', '0');
                progressBarContainer.style.border = '1px solid #6f8fbd';
                progressBarContainer.style.borderRadius = '6px';
                progressBarContainer.style.display = 'flex';
                progressBarContainer.style.alignItems = 'center';
                progressBarContainer.style.marginTop = '8px';
                progressBarContainer.style.marginBottom = '5px';
                progressBarContainer.style.width = '100%';
                progressBarContainer.style.maxWidth = '720px';
                progressBarContainer.style.minHeight = '34px';
                progressBarContainer.style.position = 'relative';
                progressBarContainer.style.overflow = 'hidden';
                progressBarContainer.style.backgroundColor = '#eef3f8';

                const progressBarFill = document.createElement('div');
                progressBarFill.id = 'simpleProgressBarFill';
                progressBarFill.style.position = 'absolute';
                progressBarFill.style.inset = '0 auto 0 0';
                progressBarFill.style.backgroundColor = '#a9cdf5';
                progressBarFill.style.width = '0%';
                progressBarFill.style.transition = 'width 180ms ease-out';

                const progressText = document.createElement('span');
                progressText.id = 'simpleProgressText';
                progressText.setAttribute('aria-live', 'polite');
                progressText.style.position = 'relative';
                progressText.style.zIndex = '1';
                progressText.style.padding = '7px 10px';
                progressText.style.fontSize = '12px';
                progressText.style.fontWeight = '600';
                progressText.style.color = '#17365d';
                progressText.innerText = 'Automatischer Sync – Schritt 1/7: Vorbereitung läuft ...';

                progressBarContainer.appendChild(progressBarFill);
                progressBarContainer.appendChild(progressText);
                if (appendImmediately) {
                  container.appendChild(progressBarContainer);
                }

                return {
                  element: progressBarContainer,
                  setFillWidth: (percentage) => {
                    const safePercentage = Math.max(0, Math.min(100, Number(percentage) || 0));
                    progressBarFill.style.width = `${safePercentage}%`;
                    progressBarContainer.setAttribute('aria-valuenow', String(Math.round(safePercentage)));
                  },
                  setText: (text) => {
                    progressText.innerText = text;
                  },
                  hide: () => {
                    progressBarContainer.style.display = 'none';
                  },
                  show: () => {
                    progressBarContainer.style.display = 'flex';
                  }
                };
              }

              async function createUI_taxextractor() {
                  const container = document.querySelector('#vvp-tax-information-container');
                  if (!container) {
                      setTimeout(createUI_taxextractor, 500);
                      return;
                  }
                  const progressBar = createSimpleProgressBar(container, false);
                  window.progressBar = progressBar;
                  const div = document.createElement('div');
                  div.innerHTML = `
                    <div id="vine-data-extractor" style="margin: 12px 0 20px 0; border: 2px solid #1a73e8; border-radius: 10px; padding: 12px; background: linear-gradient(180deg, #f7faff 0%, #eef5ff 100%);">
                        <div style="font-weight:700; margin-bottom: 4px; color:#1a2b4a;">VineTaxTools</div>
                        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom: 8px;">
                            <label for="load-xlsx-year" style="font-size:12px; color:#333;">Jahr:</label>
                            <select id="load-xlsx-year"></select>
                            <button id="load-xlsx-info" class="">Load XLSX Info</button>
                            <button id="show-all-data">Show All Data</button>
                            <button id="export-db">Export DB</button>
                            <button id="import-db">Import DB</button>
                             <button id="export-xlsx">Export XLSX</button>
                             <button id="copy-pdf-list">Copy PDF link list</button>
                        </div>
                        <div id="status" style="margin-top: 10px; font-size: 13px;"></div>
                        <div id="sync-progress-slot"></div>
                    </div>
                `;
                        const settings = await getValue("settings", {
                            cancellations: false,
                            tax0: false,
                            yearFilter: "show all years",
                            streuartikelregelung: true,
                            streuartikelregelungTeilwert: true,
                            add2ndhalf2023to2024: true,
                            einnahmezumteilwert: true,
                            useTeilwertV2: false
                        });

                        const settingsDiv = document.createElement('div');
                        settingsDiv.innerHTML = `
                            <div style="margin-top: 8px; border: 1px solid #9ab6e8; border-radius: 8px; padding: 10px; background: #ffffff;">
                                <label><input type="checkbox" id="cancellations" ${settings.cancellations ? 'checked' : ''}> Cancellations berücksichtigen</label>
                                <label><input type="checkbox" id="tax0" ${settings.tax0 ? 'checked' : ''}> tax0 berücksichtigen</label>
                                <label><input type="checkbox" id="streuartikelregelung" ${settings.streuartikelregelung ? 'checked' : ''}> Streuartikelregelung anwenden</label>
                                <label><input type="checkbox" id="streuartikelregelungTeilwert" ${settings.streuartikelregelungTeilwert ? 'checked' : ''}> Streuartikelregelung auf Teilwert vor 10/2024</label>
                                <label><input type="checkbox" id="add2ndhalf2023to2024" ${settings.add2ndhalf2023to2024 ? 'checked' : ''}> 2. Jahreshälfte 2023 in 2024 versteuern</label>
                                <label><input type="checkbox" id="einnahmezumteilwert" ${settings.einnahmezumteilwert ? 'checked' : ''}> EÜR: Einnahme zum Teilwert vor 10/2024</label>
                                <label><input type="checkbox" id="useTeilwertV2" ${settings.useTeilwertV2 ? 'checked' : ''}> Teilwert V2 verwenden</label>
                                <select id="yearFilter">
                                    ${buildYearFilterOptionsHtml(settings)}
                                </select>

                            </div>
                        `;

                        settingsDiv.appendChild(await backendHandler.createButtons());
                        div.appendChild(settingsDiv);
                        container.appendChild(div);
                        const progressSlot = div.querySelector('#sync-progress-slot');
                        if (progressSlot) {
                          progressSlot.appendChild(progressBar.element);
                        } else {
                          container.appendChild(progressBar.element);
                        }
                        setAutomaticSyncStep(1, 'Oberfläche und Sync-Einstellungen werden vorbereitet ...', 0.25);
                        const xlsxYearSelect = document.getElementById('load-xlsx-year');
                        initializeXlsxYearSelector(xlsxYearSelect).catch(error => {
                          console.warn('Amazon year selector initialization failed:', error);
                        });
                        setAutomaticSyncStep(
                          1,
                          'Vorbereitung abgeschlossen; die Jahresauswahl wird parallel aktualisiert.',
                          1
                        );

                        const waitForElement = (selector) => {
                            return new Promise((resolve) => {
                                const interval = setInterval(() => {
                                    if (document.querySelector(selector)) {
                                        clearInterval(interval);
                                        resolve(document.querySelector(selector));
                                    }
                                }, 100);
                            });
                        };

                        await waitForElement('#cancellations');

                        document.getElementById('cancellations').addEventListener('change', async (event) => {
                            settings.cancellations = event.target.checked;
                            await setValue("settings", settings);
                        });

                        document.getElementById('tax0').addEventListener('change', async (event) => {
                            settings.tax0 = event.target.checked;
                            await setValue("settings", settings);
                        });

                        document.getElementById('streuartikelregelung').addEventListener('change', async (event) => {
                            settings.streuartikelregelung = event.target.checked;
                            await setValue("settings", settings);
                        });

                        document.getElementById('streuartikelregelungTeilwert').addEventListener('change', async (event) => {
                            settings.streuartikelregelungTeilwert = event.target.checked;
                            await setValue("settings", settings);
                        });

                        document.getElementById('yearFilter').addEventListener('change', async (event) => {
                            settings.yearFilter = event.target.value;
                            await setValue("settings", settings);
                        });

                        document.getElementById('add2ndhalf2023to2024').addEventListener('change', async (event) => {
                            settings.add2ndhalf2023to2024 = event.target.checked;
                            await setValue("settings", settings);
                        });

                        document.getElementById('einnahmezumteilwert').addEventListener('change', async (event) => {
                            settings.einnahmezumteilwert = event.target.checked;
                            await setValue("settings", settings);
                        });

                        document.getElementById('useTeilwertV2').addEventListener('change', async (event) => {
                            settings.useTeilwertV2 = event.target.checked;
                            await setValue("settings", settings);
                        });



                document.getElementById('export-db').addEventListener('click', async () => {
                    let asinDataAll = await getAllAsinValues();
                    const json = JSON.stringify(asinDataAll, null, 2);
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'database.json';
                    a.click();
                    URL.revokeObjectURL(url);
                });

                document.getElementById('export-xlsx').addEventListener('click', async () => {
                    let asinData = await load_all_asin_etv_values_from_storage(false);


                    const settings = await getValue("settings", {
                        cancellations: false,
                        tax0: false,
                        yearFilter: "show all years",
                        add2ndhalf2023to2024: true
                    });

                    let cancellations = await getValue('cancellations', []);
                    const filteredData = applyDisplayFilters(asinData, settings, cancellations);

                    asinData = filteredData;

                    const columnNames = Array.from(new Set(asinData.flatMap(item => Object.keys(item))));
                    console.log("Column Names:", columnNames);
                    const workbook = XLSX.utils.book_new();
                    const worksheetData = [columnNames];

                    asinData.forEach(item => {
                        const row = columnNames.map(column => item.hasOwnProperty(column) ? item[column] : '');
                        worksheetData.push(row);
                    });

                    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
                    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

                    const xlsxBlob = new Blob([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' });
                    const xlsxUrl = URL.createObjectURL(xlsxBlob);
                    const downloadLink = document.createElement('a');
                    downloadLink.href = xlsxUrl;
                    downloadLink.download = 'exported_data.xlsx';
                    downloadLink.click();
                    URL.revokeObjectURL(xlsxUrl);
                });


                document.getElementById('import-db').addEventListener('click', () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'application/json';
                    input.addEventListener('change', async (event) => {
                        const file = event.target.files[0];
                        if (file) {
                            if (file.size > 50 * 1024 * 1024) {
                                alert('Import abgebrochen: Die Datei ist größer als 50 MB.');
                                return;
                            }
                            const reader = new FileReader();
                            reader.onload = async (e) => {
                                try {
                                    const json = JSON.parse(e.target.result);
                                    const records = validateDatabaseImport(json);
                                    if (!confirm(`${records.length} Produkte aus dieser Datei importieren und gleichnamige lokale Produkte überschreiben?`)) {
                                      return;
                                    }
                                    await db.keyValuePairs.bulkPut(records);
                                    alert(`Database imported successfully (${records.length} products).`);
                                    await updateDefaultStatusSummary();
                                } catch (error) {
                                    console.error('Error importing database:', error.message);
                                    alert(`Failed to import database: ${error.message}`);
                                }
                            };
                            reader.readAsText(file);
                        }
                    });
                    input.click();
                });


                  const containerfordata = document.getElementById('vvp-tax-information-container');
                const divdata = document.createElement('div');
                divdata.innerHTML = `
                <div id="data-table" style="margin-top: 20px;"></div>
                `;
                containerfordata.appendChild(divdata);

                  setTimeout(async () => {
                    try {
                      document.getElementById('load-xlsx-info').addEventListener('click', loadXLSXInfo);
                      document.getElementById('show-all-data').addEventListener('click', showAllData);
                      document.getElementById('copy-pdf-list').addEventListener('click', copyPDFList);

                      setAutomaticSyncStep(2, 'Lokale Produktdaten werden geladen ...', 0);
                      const list = await load_all_asin_etv_values_from_storage({
                        automaticSyncStep: 2
                      });

                      let syncError = null;
                      try {
                        await backendHandler.syncProducts(list);
                      } catch (error) {
                        syncError = error;
                        console.error('Automatic account sync failed:', error);
                      }

                      setAutomaticSyncStep(6, 'Jahresauswertung und Diagramme werden aufgebaut ...', 0);
                      await createYearlyBreakdown(list);
                      setAutomaticSyncStep(6, 'Lokale Auswertung wurde aufgebaut.', 1);

                      if (syncError) {
                        const message = `Lokale Auswertung bereit, aber der Server-Sync ist fehlgeschlagen: ${syncError.message}`;
                        setAutomaticSyncStep(7, message, 1, "error");
                      } else {
                        setAutomaticSyncStep(
                          7,
                          `Abgeschlossen. ${list.length} lokale Produkte sind bereit.`,
                          1,
                          "success"
                        );
                      }
                    } catch (error) {
                      const message = `Initialisierung abgebrochen: ${error.message}`;
                      console.error('Automatic account initialization failed:', error);
                      setAutomaticSyncStep(7, message, 1, "error");
                    }
                  }, 200);
              }

  async function createYearlyBreakdown(list) {
      const sortedItems = list.map(item => ({
          ...item,
          date: new Date(item.date)
      })).sort((a, b) => a.date - b.date);

      const years = [...new Set(sortedItems.map(item => item.date.getFullYear()))];

      const container = document.getElementById('vvp-tax-information-container');

      for (const year of years) {

        const settings = await getValue("settings", {
            yearFilter: "show all years",
            streuartikelregelung: true,
            streuartikelregelungTeilwert: true,
            add2ndhalf2023to2024: true
        });

        if (settings.yearFilter === "show current year" && year !== new Date().getFullYear()) {
            continue;
        }

        if (settings.yearFilter !== "show all years" && settings.yearFilter !== "show current year" && settings.yearFilter !== `only ${year}`) {
            continue;
        }

          const yearContainer = document.createElement('div');
          yearContainer.id = `year-container-${year}`;
          yearContainer.style.border = '1px solid #ccc';
          yearContainer.style.padding = '10px';
          yearContainer.style.marginBottom = '20px';

          const title = document.createElement('h3');
          title.textContent = `Year ${year}`;
          yearContainer.appendChild(title);
          container.appendChild(yearContainer);

          let yearlyItems;
          if (settings.add2ndhalf2023to2024) {
              if (year === 2023) {
                  yearlyItems = sortedItems.filter(item => item.date.getFullYear() === year && item.date.getMonth() < 6);
              } else if (year === 2024) {
                  yearlyItems = sortedItems.filter(item => (item.date.getFullYear() === year) || (item.date.getFullYear() === 2023 && item.date.getMonth() >= 6));
              } else {
                  yearlyItems = sortedItems.filter(item => item.date.getFullYear() === year);
              }
          } else {
              yearlyItems = sortedItems.filter(item => item.date.getFullYear() === year);
          }
          await createPieChart(yearlyItems, yearContainer);
          let target_date = new Date(year, 11, 31);
          if (year === 2023 && settings.add2ndhalf2023to2024) {
              target_date = new Date(year, 5, 30);
          }
          await createETVPlot(year, yearlyItems, target_date, yearContainer); // Assuming end of year for plot
          await createCancellationRatioTable(yearlyItems, yearContainer);
          await createTeilwertSummaryTable(yearlyItems, yearContainer);
      }
  }

  async function createETVPlot(taxYear, items, endDate, parentElement) {
    const cancelledAsins = await getValue("cancellations", []);
    const settings = await getValue("settings", {});
    // Filter out items with etv === 0
    const filteredItems = items.filter(item => !cancelledAsins.includes(item.ASIN) && item.etv > 0);

    if (filteredItems.length === 0) {
        console.log("No filtered items to plot.");
        return;
    }

    const width = 600, height = 400;
    const dataByDateMap = new Map();
    let currentEtv = 0;
    filteredItems.forEach(d => {
        const dateKey = d.date.toISOString().split('T')[0];
        currentEtv += d.etv;
        dataByDateMap.set(dateKey, currentEtv);
    });

    const dataByDate = Array.from(dataByDateMap, ([date, etv]) => ({ date: new Date(date), etv }));

    const historicalTrace = {
        x: dataByDate.map(d => d.date),
        y: dataByDate.map(d => d.etv),
        mode: 'lines',
        type: 'scatter',
        name: 'Historical ETV',
        line: { color: 'steelblue' }
    };

    const firstPoint = dataByDate[0];
    const lastPoint = dataByDate[dataByDate.length - 1];
    const projectedEtv = lastPoint.etv + (lastPoint.etv - firstPoint.etv) * ((endDate - lastPoint.date) / (lastPoint.date - firstPoint.date));

    const projectionData = [
        { date: firstPoint.date, etv: firstPoint.etv },
        { date: endDate, etv: projectedEtv }
    ];

    const projectionTrace = {
        x: projectionData.map(d => d.date),
        y: projectionData.map(d => d.etv),
        mode: 'lines',
        type: 'scatter',
        name: 'Projected ETV',
        line: { color: 'orange', dash: 'dash' }
    };

    const data = [historicalTrace, projectionTrace];

    // Add teilwert curves
    const itemsWithTeilwert = filteredItems.filter(item => getTeilwert(item, settings) != null);
    if (itemsWithTeilwert.length >= 10) {
        const teilwertEtvRatios = itemsWithTeilwert.map(item => {
            let use_teilwert = getTeilwert(item, settings);
            if (use_teilwert === null || isNaN(use_teilwert) || use_teilwert < 0) {
                console.warn("Invalid teilwert found for ASIN:", item.ASIN);
            }
            if (item.etv <= 0 || isNaN(item.etv)) {
                console.warn("Invalid etv found for ASIN:", item.ASIN);
            }
            return use_teilwert / item.etv;
        });
        const validRatios = teilwertEtvRatios.filter(ratio => !isNaN(ratio)); // Filter out NaN values
        if (validRatios.length > 0) {
            const avgTeilwertEtvRatio = validRatios.reduce((sum, ratio) => sum + ratio, 0) / validRatios.length;

            if (avgTeilwertEtvRatio >= 0.01 && avgTeilwertEtvRatio <= 0.5) {
                const teilwertDataMap = new Map();
                let currentTeilwert = 0;
                filteredItems.forEach(d => {
                    const dateKey = d.date.toISOString().split('T')[0];
                    let use_teilwert = getTeilwert(d, settings);
                    currentTeilwert += (use_teilwert != null ? use_teilwert : (d.etv * avgTeilwertEtvRatio));
                    teilwertDataMap.set(dateKey, currentTeilwert);
                });
                const teilwertData = Array.from(teilwertDataMap, ([date, teilwert]) => ({ date: new Date(date), teilwert }));

                const teilwertTrace = {
                    x: teilwertData.map(d => d.date),
                    y: teilwertData.map(d => d.teilwert),
                    mode: 'lines',
                    type: 'scatter',
                    name: 'Historical + Estimated Teilwert',
                    line: { color: 'green' }
                };
                data.push(teilwertTrace);
            }
        }
    }

    const layout = {
        title: `ETV and Teilwert over Time`,
        xaxis: {
            title: 'Date',
            tickformat: '%b %d',
            range: [firstPoint.date, endDate],
            tickangle: -45
        },
        yaxis: {
            title: 'Value',
            autorange: true
        },
        margin: {
            t: 40,
            r: 30,
            b: 80,
            l: 60
        },
        width: "80%",
        height: "30%"
    };

    const containerId = `plot-container-${taxYear}`;
    const newDiv = document.createElement('div');
    newDiv.id = containerId;
    parentElement.appendChild(newDiv);

    Plotly.newPlot(containerId, data, layout);
}

async function createPieChart(list, parentElement) {
    const cancelledAsins = await getValue("cancellations", []);
    const settings = await getValue("settings", {});

    const counts = list.reduce((acc, item) => {
        let use_teilwert = getTeilwert(item, settings);
        if (cancelledAsins.includes(item.ASIN)) {
            acc.cancellations += 1;
        } else if (item.etv === 0) {
            acc.tax0 += 1;
        } else if (use_teilwert != null) {
            acc.teilwertAvailable += 1;
        } else {
            acc.teilwertMissing += 1;
        }
        return acc;
    }, { cancellations: 0, tax0: 0, teilwertAvailable: 0, teilwertMissing: 0 });

    const data = [
        { category: 'Cancellations', count: counts.cancellations },
        { category: 'tax0', count: counts.tax0 },
        { category: 'Teilwert Available', count: counts.teilwertAvailable },
        { category: 'Teilwert Missing', count: counts.teilwertMissing }
    ];

    const width = 600, height = 300, margin = 40;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(parentElement).append('svg')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', `translate(${width / 2}, ${height / 2})`);

    const pie = d3.pie().value(d => d.count);
    const arc = d3.arc().outerRadius(radius).innerRadius(0);
    const outerArc = d3.arc().innerRadius(radius * 0.8).outerRadius(radius * 0.8); // Adjusted inner radius

    const color = d3.scaleOrdinal()
        .domain(data.map(d => d.category))
        .range(['#808080', '#ff9999', '#66b3ff', '#99ff99']);

    svg.selectAll('slices')
        .data(pie(data))
        .enter().append('path')
        .attr('d', arc)
        .attr('fill', d => color(d.data.category))
        .attr('stroke', 'white')
        .style('stroke-width', '2px');

    // Add labels with connecting lines
    const labelPositions = [
        { x: radius + 20, y: -radius + 20 },
        { x: radius + 20, y: -radius + 40 },
        { x: radius + 20, y: -radius + 60 },
        { x: radius + 20, y: -radius + 80 }
    ];
    svg.selectAll('labels')
        .data(pie(data))
        .enter()
        .append('text')
        .attr('dy', '.35em')
        .attr('transform', (d, i) => `translate(${labelPositions[i].x + 20}, ${labelPositions[i].y})`)
        .style('text-anchor', 'start')
        .text(d => `${d.data.category}: ${d.data.count}`);

    svg.selectAll('squares')
        .data(pie(data))
        .enter()
        .append('rect')
        .attr('x', (d, i) => labelPositions[i].x)
        .attr('y', (d, i) => labelPositions[i].y - 7)
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', d => color(d.data.category));

    function midAngle(d) {
        return d.startAngle + (d.endAngle - d.startAngle) / 2;
    }
}
  async function createTeilwertSummaryTable(list, parentElement) {
      const cancelledAsins = await getValue("cancellations", []);
      let filteredList = list.filter(item => !cancelledAsins.includes(item.ASIN));

    const settings = await getValue("settings", {
        streuartikelregelung: true,
        streuartikelregelungTeilwert: true,
        einnahmezumteilwert: true
    });

    if (settings.streuartikelregelung) {
        filteredList = filteredList.filter(item => item.etv > 11.90);
    }

    if (settings.streuartikelregelungTeilwert) {
        filteredList = filteredList.filter(item => {
            const orderDate = new Date(item.date);
            let use_teilwert = getTeilwert(item, settings);
            return (orderDate >= new Date(2024, 9, 1) || use_teilwert > 11.90);
        });
    }


      const itemsWithTeilwert = filteredList.filter(item => getTeilwert(item, settings) != null);
      const itemsWithoutTeilwert = filteredList.filter(item => getTeilwert(item, settings) == null && item.etv > 0);

      if (itemsWithTeilwert.length >= 10) {
          const teilwertEtvRatios = itemsWithTeilwert.map(item => {
              let use_teilwert = getTeilwert(item, settings);
              if (use_teilwert === null || isNaN(use_teilwert) || use_teilwert < 0) {
                  console.warn("Invalid teilwert found in createTeilwertSummaryTable for ASIN:", item.ASIN);
              }
              if (item.etv <= 0 || isNaN(item.etv)) {
                  console.warn("Invalid etv found in createTeilwertSummaryTable for ASIN:", item.ASIN);
              }
              return use_teilwert / item.etv;
          });
          const validRatios = teilwertEtvRatios.filter(ratio => !isNaN(ratio));
          if (validRatios.length > 0) {
              const avgTeilwertEtvRatio = validRatios.reduce((sum, ratio) => sum + ratio, 0) / validRatios.length;

              if (avgTeilwertEtvRatio >= 0.01 && avgTeilwertEtvRatio <= 0.5 && itemsWithoutTeilwert.length > 0) {
                  const totalTeilwert = itemsWithTeilwert.reduce((sum, item) => sum + getTeilwert(item, settings), 0);
                  const estimatedTeilwert = itemsWithoutTeilwert.reduce((sum, item) => sum + (item.etv * avgTeilwertEtvRatio), 0);
                  const overallTeilwert = totalTeilwert + estimatedTeilwert;

                  const table = d3.select(parentElement).append('table').attr('class', 'teilwert-summary-table');
                  const thead = table.append('thead');
                  thead.append('tr').selectAll('th')
                      .data(['', 'Value'])
                      .enter().append('th').text(d => d);

                  const tbody = table.append('tbody');
                  const rows = [
                      { label: 'Total Teilwert (Known)', value: totalTeilwert.toFixed(2) },
                      { label: 'Estimated Teilwert (Missing)', value: estimatedTeilwert.toFixed(2) },
                      { label: 'Overall Estimated Teilwert', value: overallTeilwert.toFixed(2) }
                  ];
                  rows.forEach(row => {
                      const tr = tbody.append('tr');
                      tr.append('td').text(row.label);
                      tr.append('td').text(row.value);
                  });

                  const tableStyles = `
                      <style>
                          .teilwert-summary-table {
                              width: 80%;
                              border-collapse: collapse;
                              margin-top: 10px;
                          }
                          .teilwert-summary-table th, .teilwert-summary-table td {
                              border: 1px solid #ddd;
                              padding: 8px;
                              text-align: left;
                          }
                          .teilwert-summary-table th {
                              background-color: #f2f2f2;
                              font-weight: bold;
                          }
                      </style>
                  `;
                  d3.select(parentElement).append('div').html(tableStyles);

              } else if (itemsWithoutTeilwert.length === 0) {
                  const totalTeilwert = itemsWithTeilwert.reduce((sum, item) => sum + getTeilwert(item, settings), 0);
                  const table = d3.select(parentElement).append('table').attr('class', 'teilwert-summary-table');
                  const thead = table.append('thead');
                  thead.append('tr').selectAll('th')
                      .data(['', 'Value'])
                      .enter().append('th').text(d => d);

                  const tbody = table.append('tbody');
                  const rows = [
                      { label: 'Total Teilwert', value: totalTeilwert.toFixed(2) }
                  ];
                  rows.forEach(row => {
                      const tr = tbody.append('tr');
                      tr.append('td').text(row.label);
                      tr.append('td').text(row.value);
                  });

                  const tableStyles = `
                      <style>
                          .teilwert-summary-table {
                              width: 80%;
                              border-collapse: collapse;
                              margin-top: 10px;
                          }
                          .teilwert-summary-table th, .teilwert-summary-table td {
                              border: 1px solid #ddd;
                              padding: 8px;
                              text-align: left;
                          }
                          .teilwert-summary-table th {
                              background-color: #f2f2f2;
                              font-weight: bold;
                          }
                      </style>
                  `;
                  d3.select(parentElement).append('div').html(tableStyles);

                const euerData = {
                    einnahmen: 0,
                    ausgaben: 0,
                    entnahmen: 0,
                    einnahmen_aus_anlagevermoegen: 0
                };

                const teilwertEtvRatios = itemsWithTeilwert.map(item => {
                    let use_teilwert = getTeilwert(item, settings);
                    return use_teilwert / item.etv;
                });
                const avgTeilwertEtvRatio = teilwertEtvRatios.reduce((sum, ratio) => sum + ratio, 0) / teilwertEtvRatios.length;

                itemsWithTeilwert.forEach(item => {
                    const { einnahmen, ausgaben, entnahmen, einnahmen_aus_anlagevermoegen } = calculateEuerValues(item, settings, avgTeilwertEtvRatio);
                    euerData.einnahmen += einnahmen;
                    euerData.ausgaben += ausgaben;
                    euerData.entnahmen += entnahmen;
                    euerData.einnahmen_aus_anlagevermoegen += einnahmen_aus_anlagevermoegen;
                });

                const gewinn = euerData.einnahmen + euerData.einnahmen_aus_anlagevermoegen - euerData.ausgaben + euerData.entnahmen;

                const euerTable = d3.select(parentElement).append('table').attr('class', 'euer-summary-table');
                const euerThead = euerTable.append('thead');
                euerThead.append('tr').selectAll('th')
                    .data(['EÜR', 'Euro'])
                    .enter().append('th').text(d => d);

                const euerTbody = euerTable.append('tbody');
                const euerRows = [
                    { label: 'Einnahmen', value: (euerData.einnahmen + euerData.einnahmen_aus_anlagevermoegen).toFixed(2) },
                    { label: 'Einnahmen nach §19 UStG (Kleinunternehmerregelung)', value: euerData.einnahmen.toFixed(2) },
                    { label: 'Ausgaben', value: euerData.ausgaben.toFixed(2) },
                    { label: 'Entnahmen', value: euerData.entnahmen.toFixed(2) },
                    { label: 'Gewinn', value: gewinn.toFixed(2) }
                ];
                euerRows.forEach(row => {
                    const tr = euerTbody.append('tr');
                    tr.append('td').text(row.label);
                    tr.append('td').text(row.value);
                });

                const euerTableStyles = `
                    <style>
                        .euer-summary-table {
                            width: 80%;
                            border-collapse: collapse;
                            margin-top: 10px;
                        }
                        .euer-summary-table th, .euer-summary-table td {
                            border: 1px solid #ddd;
                            padding: 8px;
                            text-align: left;
                        }
                        .euer-summary-table th {
                            background-color: #f2f2f2;
                            font-weight: bold;
                        }
                    </style>
                `;
                d3.select(parentElement).append('div').html(euerTableStyles);

              } else {
                  parentElement.append(document.createTextNode("Not enough data to reliably estimate total Teilwert."));
              }
          } else {
              parentElement.append(document.createTextNode("Not enough valid items with Teilwert to estimate."));
          }
      } else {
          parentElement.append(document.createTextNode("Not enough items with Teilwert to estimate."));
      }
  }

              async function fetchData(year) {
                  userlog("trying to fetch tax data from amazon")
                  const url = `https://www.amazon.de/vine/api/get-tax-report?year=${year}&fileType=XLSX`;
                  console.log('GET ' + url);
                  const response = await fetch(url);
                  console.log('Response from fetchData:', response.status);
                  if (!response.ok) {
                    throw new Error(`Amazon tax report request failed with HTTP ${response.status}.`);
                  }
                  const data = await response.json();
                  if (typeof data?.result?.bytes !== 'string' || data.result.bytes.length === 0) {
                    throw new Error('Amazon tax report response did not contain XLSX data.');
                  }
                  userlog("successfully received tax data")
                  return data.result.bytes;
              }

              async function parseExcel(data) {
                  const binary = atob(data);
                  const binaryLength = binary.length;
                  const bytesArray = new Uint8Array(binaryLength);

                  for (let i = 0; i < binaryLength; i++) {
                      bytesArray[i] = binary.charCodeAt(i);
                  }

                  const workbook = XLSX.read(bytesArray, { type: 'array' });
                  const sheetName = workbook.SheetNames[0];
                  if (!sheetName || !workbook.Sheets[sheetName]) {
                      throw new Error('Ungültige XLSX-Datei: Tabellenblatt fehlt.');
                  }
                  const worksheet = workbook.Sheets[sheetName];
                  const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                  const {data: extractedData, errors} = await extractData(json);
                  await saveData(extractedData, true);
                  return errors;
              }

                function parseOrdersTable() {
                    const orders = document.querySelectorAll(".vvp-orders-table--row");
                    const data = {};
                    const errors = [];

                    for (const order of orders) {
                        const orderElement = order.querySelector(".vvp-orders-table--text-col[data-order-timestamp]");
                        const productNameElement = order.querySelector('span.a-truncate-full');
                        const etvElement = order.querySelector(".vvp-orders-table--text-col.vvp-text-align-right");
                        if (!orderElement || !productNameElement || !etvElement) {
                          errors.push('Unvollständige Bestellzeile');
                          continue;
                        }
                        const orderDate = orderElement.textContent.trim();
                        const parsedDate = parseDateSafe(orderDate);
                        const asinElement = order.querySelector("a[href^='https://www.amazon.de/dp/']");
                        const productName = productNameElement.textContent.trim();
                        const etv = etvstrtofloat(etvElement.textContent.trim());
                        const orderLink = order.querySelector("a[href*='orderID=']");
                        const orderIdMatch = orderLink?.getAttribute('href')?.match(/[?&]orderID=([^&#"]+)/i)
                          || order.innerHTML.match(/[?&]orderID=([^&#"]+)/i);
                        const orderNumber = orderIdMatch ? decodeURIComponent(orderIdMatch[1]) : '';
                        let asin = normalizeAsin(
                          asinElement?.getAttribute("href")?.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]
                        );
                        if (!asin) {
                            const alternativeAsinElement = order.querySelector(".vvp-orders-table--text-col");
                            if (alternativeAsinElement) {
                                asin = normalizeAsin(alternativeAsinElement.textContent.trim().split(/\s+/)[0]);
                            }
                        }
                        if (!asin || !orderNumber || !parsedDate || !Number.isFinite(etv)) {
                            errors.push(orderDate || 'Unlesbare Bestellzeile');
                            continue;
                        }
                        data[asin] = {
                            name: productName,
                            ordernumber: orderNumber,
                            date: parsedDate.toISOString(),
                            etv
                        };
                    }

                    return {data, errors};
                }

              async function extractData(json) {
                  const data = {};
                  const errors = [];
                  const headerRowIndex = 2;
                  const header = json[headerRowIndex];
                  if (!Array.isArray(header)) {
                      throw new Error('Ungültige XLSX-Datei: Kopfzeile fehlt.');
                  }

                  let cancellations = await getValue('cancellations', []);
                  if (!Array.isArray(cancellations)) cancellations = [];
                  let cancellationsChanged = false;

                  for (let i = headerRowIndex + 1; i < json.length; i++) {
                      const row = json[i];
                      if (!Array.isArray(row) || row.length < header.length) {
                          continue;
                      }

                      const orderNumber = row[0];
                      const asin = normalizeAsin(String(row[1] ?? ''));
                      const name = row[2];
                      const orderType = row[3];
                      const orderDate = row[4];
                      const parsedDate = parseDateSafe(orderDate);
                      const etvString = row[row.length - 1];
                      const etv = etvstrtofloat(etvString);
                      if (!asin) continue;

                      if (orderType === 'CANCELLATION') {
                          if (!cancellations.includes(asin)) {
                              cancellations.push(asin);
                              cancellationsChanged = true;
                          }
                          continue;
                      }

                      if (!data[asin] && Number.isFinite(etv)) {
                          data[asin] = {
                              name: String(name ?? ''),
                              ordernumber: String(orderNumber ?? ''),
                              date: parsedDate ? parsedDate.toISOString() : orderDate,
                              etv: etv
                          };
                          if (!parsedDate) {
                              errors.push(orderDate);
                          }
                      }
                  }
                  if (cancellationsChanged) {
                      await setValue('cancellations', cancellations);
                  }

                  return {data, errors};
              }

              async function saveData(data, sync = false) {
                  const products = [];
                  if (!data || typeof data !== 'object' || Array.isArray(data)) {
                      throw new Error('Ungültige Produktdaten.');
                  }
                  for (const [rawAsin, value] of Object.entries(data)) {
                      const asin = normalizeAsin(rawAsin);
                      if (!asin || !value || typeof value !== 'object' || Array.isArray(value)) continue;
                      const key = `ASIN_${asin}`;
                      const existingData = await getValue(key);
                      const updatedData = existingData
                        ? { ...parseStoredProduct(existingData, `local product ${asin}`), ...value }
                        : value;
                      await setValue(key, JSON.stringify(updatedData));
                      products.push({ ...updatedData, ASIN: asin });
                  }
                  if (sync) {
                      try {
                          await backendHandler.syncProducts(products);
                      } catch (error) {
                          error.localDataSaved = true;
                          throw error;
                      }
                  }
              }

              async function loadXLSXInfo() {
                  try {
                      setAutomaticSyncStep(1, 'Amazon-XLSX-Import wird vorbereitet ...', 0.25);
                      const yearElement = document.getElementById('load-xlsx-year');
                      const amazonSelectedYear = document.querySelector('select#vvp-tax-year-dropdown option:checked')?.value?.trim();
                      const year = (yearElement && yearElement.value ? yearElement.value.trim() : "") || amazonSelectedYear || String(new Date().getFullYear());
                      setAutomaticSyncStep(1, `Amazon-XLSX für ${year} wurde ausgewählt.`, 1);
                      setAutomaticSyncStep(2, `Amazon-XLSX für ${year} wird geladen und lokal gespeichert ...`, 0.1);
                      const blobData = await fetchData(year);
                      const errors = await parseExcel(blobData);
                      setAutomaticSyncStep(6, 'XLSX-Ergebnis und lokale Daten werden geprüft ...', 1);
                      if (errors.length > 0) {
                          alert('Fehler beim Erkennen des Datums bei ' + errors.length + ' Bestellung(en).');
                      }
                      setAutomaticSyncStep(
                        7,
                        `XLSX für ${year} wurde lokal gespeichert und synchronisiert.`,
                        1,
                        "success"
                      );
                  } catch (error) {
                      console.error('Error loading XLSX info:', error);
                      setAutomaticSyncStep(
                        7,
                        error.localDataSaved
                          ? `XLSX lokal gespeichert, aber Synchronisierung fehlgeschlagen: ${error.message}`
                          : 'Fehler beim Laden der XLSX-Informationen.',
                        1,
                        "error"
                      );
                  }
              }

                async function loadOrdersInfo() {
                    try {
                        setAutomaticSyncStep(1, 'Amazon-Bestellimport wird vorbereitet ...', 1);
                        setAutomaticSyncStep(2, 'Bestellzeilen werden gelesen und lokal gespeichert ...', 0.15);
                        const {data, errors} = parseOrdersTable();
                        await saveData(data, true);

                        setAutomaticSyncStep(
                          6,
                          `${Object.keys(data).length} erkannte Bestellungen werden abschließend geprüft ...`,
                          1
                        );
                        if (errors.length > 0) {
                            alert('Fehler beim Erkennen des Datums bei ' + errors.length + ' Bestellung(en).');
                        }
                        setAutomaticSyncStep(
                          7,
                          `Abgeschlossen. ${Object.keys(data).length} Bestellungen wurden lokal gespeichert und synchronisiert.`,
                          1,
                          "success"
                        );
                    } catch (error) {
                        console.error('Error loading order info:', error);
                        setAutomaticSyncStep(
                          7,
                          error.localDataSaved
                            ? `Bestellungen lokal gespeichert, aber Synchronisierung fehlgeschlagen: ${error.message}`
                            : `Bestellimport fehlgeschlagen: ${error.message}`,
                          1,
                          "error"
                        );
                    }
                }

  function createUIorderpage() {
      const container = document.querySelector('.a-normal.vvp-orders-table');
        if (!container) {
            setTimeout(createUIorderpage, 1000);
            return;
        }
      const progressBar = createSimpleProgressBar(container.parentNode);
      window.progressBar = progressBar;
      const div = document.createElement('div');
      div.innerHTML = `
          <div id="vine-data-extractor" style="margin-top: 20px;">
              <button id="load-orders-info" class="">Load Orders Info</button>
              <button id="show-all-data" style="margin-left: 10px;">Show All Data</button>
              <div id="status" style="margin-top: 10px;"></div>
              <div id="data-table" style="margin-top: 20px;"></div>
          </div>
      `;
      container.parentNode.insertBefore(div, container.nextSibling);
      setAutomaticSyncStep(1, 'Amazon-Bestellimport wird vorbereitet ...', 0.25);

      setTimeout(async () => {
          document.getElementById('load-orders-info').addEventListener('click', loadOrdersInfo);
          document.getElementById('show-all-data').addEventListener('click', showAllData);
          await loadOrdersInfo();
      }, 200);
  }

  async function copyPDFList() {
        const asinData = await load_all_asin_etv_values_from_storage();
        const settings = await getValue("settings", {
            cancellations: false,
            tax0: false,
            yearFilter: "show all years",
            add2ndhalf2023to2024: true
        });
        const cancellations = await getValue('cancellations', []);
        const filteredData = applyDisplayFilters(asinData, settings, cancellations);
        const pdfList = filteredData
          .map(item => getSafeHttpUrl(getPDFLink(item, settings)))
          .filter(url => {
            if (!url) return false;
            try {
              return new URL(url).pathname.toLowerCase().endsWith('.pdf');
            } catch (_error) {
              return false;
            }
          });
        const pdfListText = pdfList.join('\n');
        GM_setClipboard(pdfListText);
        alert(`PDF-Liste kopiert (${pdfList.length} Links).`);
  }

  async function showAllData() {
    installTeilwertOutsideClickHandler();

      const dataTableDiv = document.getElementById('data-table');
      if (!dataTableDiv) return;
      dataTableDiv.innerHTML = '<p>Loading data...</p>';

      try {
          let asinData = await load_all_asin_etv_values_from_storage(false);

        const settings = await getValue("settings", {
            cancellations: false,
            tax0: false,
            yearFilter: "show all years",
            add2ndhalf2023to2024: true
        });

        let cancellations = await getValue('cancellations', []);
        const filteredData = applyDisplayFilters(asinData, settings, cancellations);

        asinData = filteredData;

          if (asinData.length === 0) {
              dataTableDiv.innerHTML = '<p>No data found.</p>';
              return;
          }

          let table = `<table id="asin-table" class="display" cellspacing="0" cellpadding="5">
                          <thead>
                              <tr>
                                  <th>ASIN</th>
                                  <th>Date</th>
                                  <th>Name</th>
                                  <th>ETV</th>
                                  <th>Keepa</th>
                                  <th>Teilwert</th>
                                  <th>PDF Report</th>
                                  <th>Product Link</th>
                                  <th>Review Link</th>
                              </tr>
                          </thead>
                          <tbody>`;

          asinData.forEach(item => {
              const asin = normalizeAsin(item.ASIN);
              if (!asin) return;
              const pdfLink = getSafeHttpUrl(getPDFLink({ ...item, ASIN: asin }, settings));
              let teilwertDisplay;
              if (item.myteilwert != null) {
                  teilwertDisplay = `${escapeHtml(item.myteilwert)}<sup>m</sup>`;
              } else {
                  const teilwert = settings.useTeilwertV2 ? item.teilwert_v2 : item.teilwert;
                  teilwertDisplay = teilwert != null ? escapeHtml(teilwert) : 'N/A';
              }

              table += `<tr>
                          <td>${escapeHtml(asin)}</td>
                          <td style="white-space: nowrap;">${escapeHtml(item.date ? String(item.date).split('T')[0] : 'N/A')}</td>
                          <td>${escapeHtml(item.name || 'N/A')}</td>
                          <td>${escapeHtml(item.etv)}</td>
                          <td>${item.keepa != null ? `<a href="https://keepa.com/#!product/3-${asin}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.keepa)}</a>` : 'N/A'}</td>
                          <td id="teilwert_for_asin_${asin}" data-order="${escapeHtml(getTeilwert(item, settings) ?? 0)}">
                              <a href="javascript:void(0);">
                                  ${teilwertDisplay}
                              </a>
                          </td>
                          <td>${pdfLink ? `<a href="${escapeHtml(pdfLink)}" target="_blank" rel="noopener noreferrer">PDF Link</a>` : 'N/A'}</td>
                          <td><a href="https://www.amazon.de/dp/${asin}" target="_blank" rel="noopener noreferrer">Product Link</a></td>
                          <td><a href="https://www.amazon.de/review/create-review?encoding=UTF&amp;asin=${asin}" target="_blank" rel="noopener noreferrer">Review Link</a></td>
                      </tr>`;
          });

          table += `</tbody>
                  </table>`;

          dataTableDiv.innerHTML = table;
            $(document).ready(function() {
               $('#asin-table').DataTable({
                   lengthMenu: [10, 25, 50, 100, 1000000]
               });
            });

        window.progressBar.hide();


        async function showTeilwertPopup(item) {

            let existingOverlay = document.getElementById('teilwert-overlay');
            if (existingOverlay) {
                existingOverlay.remove();
            }

            const asin = item.ASIN;
            const settings = await getValue("settings", {});
            const pdfLink = getSafeHttpUrl(getPDFLink(item, settings));

            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.top = '50%';
            overlay.style.left = '50%';
            overlay.style.transform = 'translate(-50%, -50%)';
            overlay.style.backgroundColor = 'white';
            overlay.style.border = '1px solid black';
            overlay.style.padding = '20px';
            overlay.style.zIndex = '1000';
            overlay.style.width = '300px';
            overlay.id = 'teilwert-overlay';
            overlay.setAttribute('data-spawn-date', new Date().getTime());


            const info = `
                <p>Name: ${escapeHtml(item.name)}</p>
                <p>ASIN: ${escapeHtml(asin)}</p>
                <p>Date: ${escapeHtml(item.date ? String(item.date).split('T')[0] : 'N/A')}</p>
                <p>ETV: ${escapeHtml(item.etv)}</p>
                <p>Keepa: ${item.keepa != null ? `<a href="https://keepa.com/#!product/3-${asin}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.keepa)}</a>` : 'N/A'}</p>
                <p>Teilwert v1: ${item.teilwert != null ? escapeHtml(item.teilwert) : 'N/A'}</p>
                <p>Teilwert v2: ${item.teilwert_v2 != null ? escapeHtml(item.teilwert_v2) : 'N/A'}</p>
                <p>Product Link: <a href="https://www.amazon.de/dp/${asin}" target="_blank" rel="noopener noreferrer">Link</a></p>
                <p>PDF Link: ${pdfLink ? `<a href="${escapeHtml(pdfLink)}" target="_blank" rel="noopener noreferrer">Link</a>` : 'N/A'}</p>
                <p>Angepasster Teilwert: <input type="text" id="angepasster-teilwert" value="${escapeHtml(item.myteilwert != null ? item.myteilwert : '')}"></p>
            `;
            overlay.innerHTML += info;

            document.body.appendChild(overlay);

            const checkboxes = [
                { id: 'verkauft', label: 'Verkauft' },
                { id: 'lager', label: 'Lager' },
                { id: 'entsorgt', label: 'Entsorgt' },
                { id: 'storniert', label: 'Storniert' },
                { id: 'betriebsausgabe', label: 'Betriebsausgabe' }
            ];

            checkboxes.forEach(checkbox => {
                const isChecked = item[checkbox.id] === true;
                const checkboxElement = document.createElement('div');
                checkboxElement.innerHTML = `
                    <label>
                        <input type="checkbox" id="${checkbox.id}" ${isChecked ? 'checked' : ''}> ${checkbox.label}
                    </label>
                `;
                overlay.appendChild(checkboxElement);

                document.getElementById(checkbox.id).addEventListener('change', async (event) => {
                    const updatedItem = parseStoredProduct(
                      await getValue(`ASIN_${asin}`),
                      `local product ${asin}`
                    );
                    updatedItem[checkbox.id] = event.target.checked;
                    await setValue(
                      `ASIN_${asin}`,
                      JSON.stringify(parseStoredProduct(updatedItem, `local product ${asin}`))
                    );
                });
            });

            document.getElementById('angepasster-teilwert').addEventListener('change', async (event) => {
                const input = event.target.value.trim().replace(',', '.');
                const updatedItem = parseStoredProduct(await getValue(`ASIN_${asin}`), `local product ${asin}`);
                if (input === '') {
                    updatedItem.myteilwert = null;
                    updatedItem.myTeilwert = null;
                    await setValue(`ASIN_${asin}`, JSON.stringify(updatedItem));
                    return;
                }
                const value = Number(input);
                if (Number.isFinite(value) && value >= 0) {
                    updatedItem.myteilwert = value;
                    updatedItem.myTeilwert = value;
                    await setValue(`ASIN_${asin}`, JSON.stringify(updatedItem));
                } else {
                    alert('Bitte einen gültigen, nicht negativen Teilwert eingeben.');
                    event.target.value = updatedItem.myteilwert ?? '';
                }
            });

        }

        asinData.forEach(item => {
            const element = document.getElementById(`teilwert_for_asin_${item.ASIN}`);
            if (element) {
                element.addEventListener('click', () => showTeilwertPopup(item));
            }
        });

      } catch (error) {
          dataTableDiv.textContent = `Error loading data: ${error.message}`;
      }
  }



  async function createCancellationRatioTable(list, parentElement) {
      const yearlyData = {};
      const cancelledAsins = await getValue("cancellations", []);

      list.forEach(item => {

          const year = item.date.getFullYear();

          if (!yearlyData[year]) {
              yearlyData[year] = { orders: 0, cancellations: 0 };
          }

          yearlyData[year].orders++;

          if (cancelledAsins.includes(item.ASIN)) {
              yearlyData[year].cancellations++;
          }
      });

      const tableData = Object.keys(yearlyData).map(year => {
          const data = yearlyData[year];
          const cancellationRatio = (data.cancellations / data.orders) * 100;
          return {
              year,
              orders: data.orders,
              cancellations: data.cancellations,
              cancellationRatio: cancellationRatio.toFixed(2) + '%'
          };
      });

      tableData.sort((a, b) => a.year - b.year);

      const table = d3.select(parentElement).append('table').attr('class', 'cancellation-ratio-table');
      const thead = table.append('thead');
      thead.append('tr')
          .selectAll('th')
          .data(['Year', 'Orders', 'Cancellations', 'Cancellation Ratio'])
          .enter()
          .append('th')
          .text(d => d);

      const tbody = table.append('tbody');
      tableData.forEach(yearlyRecord => {
          const row = tbody.append('tr');
          row.append('td').text(yearlyRecord.year);
          row.append('td').text(yearlyRecord.orders);
          row.append('td').text(yearlyRecord.cancellations);
          row.append('td').text(yearlyRecord.cancellationRatio);
      });

      const tableStyles = `
          <style>
              .cancellation-ratio-table {
                  width: 100%;
                  border-collapse: collapse;
              }
              .cancellation-ratio-table th, .cancellation-ratio-table td {
                  border: 1px solid #ddd;
                  padding: 8px;
                  text-align: center;
              }
              .cancellation-ratio-table th {
                  background-color: #f2f2f2;
                  font-weight: bold;
              }
          </style>
      `;

      d3.select(parentElement).append('div').html(tableStyles);

  }

              function userlog(txt) {
                  console.log(txt);
              }

              if (
                typeof module !== 'undefined'
                && module.exports
                && globalThis.__VINE_TAX_TOOLS_TEST_HOOK__
              ) {
                  Object.assign(globalThis.__VINE_TAX_TOOLS_TEST_HOOK__, {
                      PrivateBackendHandler,
                      backendHandler,
                      calculateEuerValues,
                      escapeHtml,
                      etvstrtofloat,
                      extractData,
                      getPrivateBackendUrl,
                      getTeilwert,
                      gmRequest,
                      isValidBackendName,
                      normalizeAsin,
                      parseDateSafe,
                      parseStoredProduct,
                      postJson,
                      saveData,
                      setAutomaticSyncStep,
                      setValue,
                      getValue,
                      validateDatabaseImport
                  });
              }

              var currentPageURL = window.location.href;

              if (currentPageURL.includes("https://www.amazon.de/vine/account")) {
                  window.addEventListener('load', async function() {
                    await validateAndFixDatabase();
                    setTimeout(createUI_taxextractor, 1000);
                    });
              } else if (currentPageURL.includes("https://www.amazon.de/vine/orders")) {
                    window.addEventListener('load', async function() {
                        await validateAndFixDatabase();
                        setTimeout(createUIorderpage, 500);
                    });
              }

  })();
