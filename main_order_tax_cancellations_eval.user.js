// ==UserScript==
// @name        taxsummary
// @namespace   Violentmonkey Scripts
// @match       https://www.amazon.de/vine/account*
// @match       https://www.amazon.de/vine/orders*
// @require     https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.8.0/jszip.js
// @require     https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js
// @require     https://unpkg.com/dexie@latest/dist/dexie.js
// @require     https://d3js.org/d3.v5.min.js
// @require     https://cdn.plot.ly/plotly-latest.min.js
// @require     https://code.jquery.com/jquery-3.5.1.js
// @require     https://cdn.datatables.net/1.11.5/js/jquery.dataTables.min.js
// @require     https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js
// @grant       GM_setValue
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_xmlhttpRequest
// @grant       GM_deleteValue
// @grant       GM_listValues
// @grant       GM_setClipboard
// @updateURL   https://raw.githubusercontent.com/hutauf/VineTaxTools/refs/heads/main/main_order_tax_cancellations_eval.user.js
// @downloadURL https://raw.githubusercontent.com/hutauf/VineTaxTools/refs/heads/main/main_order_tax_cancellations_eval.user.js
// @version     1.111112
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
                    console.log(asinDict);
                    return asinDict;
                } catch (error) {
                    console.error("Error getting ASIN values:", error);
                    return [];
                }
            }


            async function listValues() {
              try {
                return (await db.keyValuePairs.toCollection().primaryKeys());
              } catch (error) {
                console.error("Error listing values:", error);
                return [];
              }
            }

            function getTeilwert(item, settings) {
                if (item.myteilwert != null) {
                    return item.myteilwert;
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
                let use_teilwert = getTeilwert(item, settings) || (item.etv * avgTeilwertEtvRatio);
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
                  const cleanString = etvString.replace(/[€ ]/g, '');
                  const cleanedValue = cleanString.replace(/[.,](?=\d{3})/g, '');
                  const etv = parseFloat(cleanedValue.replace(',', '.'));
                  return etv;
              }

              function parseDateSafe(dateStr) {
                if (!dateStr) return null;
                let trimmed = dateStr.trim();

                // if first 4 digits are a year, assume YYYY-MM-DD format
                if (/^\d{4}/.test(trimmed)) {
                    const parsed = new Date(trimmed);
                    if (!isNaN(parsed)) return parsed;
                }

                // remove time or other trailing parts
                trimmed = trimmed.split(/[ ,]/)[0];

                // formats DD[./-]MM[./-]YYYY or DD[./-]MM[./-]YY
                let match = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
                if (match) {
                  let day = match[1].padStart(2, '0');
                  let month = match[2].padStart(2, '0');
                  let year = match[3];
                  if (year.length === 2) year = '20' + year;
                  const parsed = new Date(`${year}-${month}-${day}`);
                  if (!isNaN(parsed)) return parsed;
                }

                // formats YYYY[./-]MM[./-]DD or YY[./-]MM[./-]DD
                match = trimmed.match(/^(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})$/);
                if (match) {
                  let year = match[1];
                  let month = match[2].padStart(2, '0');
                  let day = match[3].padStart(2, '0');
                  if (year.length === 2) year = '20' + year;
                  const parsed = new Date(`${year}-${month}-${day}`);
                  if (!isNaN(parsed)) return parsed;
                }

                // textual month names e.g. 1. Januar 2024
                trimmed = trimmed.replace(/\//g, '.').replace(/\s+/g, ' ').trim();

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
                    const parsed = new Date(`${year}-${String(monthIndex).padStart(2,'0')}-${day}`);
                    if (!isNaN(parsed)) return parsed;
                  }
                }

                return null;
              }

              class PrivateBackendHandler {
                async deleteDatabase() {
                  const token = await getValue("token");
                  if (!token) {
                    console.log("No token found");
                    return;
                  }
                  const data = { token, request: "delete_all" };
                  const endpoint = "data_operations";
                  console.log("POST https://hutaufvine.pythonanywhere.com/" + endpoint, data);
                  GM_xmlhttpRequest({
                    method: "POST",
                    url: "https://hutaufvine.pythonanywhere.com/" + endpoint,
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify(data),
                    onload: function(response) {
                      console.log("Response from " + endpoint + ":", response.status);
                      const result = JSON.parse(response.responseText);
                      if (result.status === "success") {
                        console.log("Database deleted successfully");
                      } else {
                        console.log("Failed to delete database");
                      }
                    },
                    onerror: function(error) {
                      console.error("Network error while contacting " + endpoint + ":", error);
                    }
                  });
                }

                async downloadDatabase() {
                  const token = await getValue("token");
                  if (!token) {
                    console.log("No token found");
                    return;
                  }
                  window.progressBar.setText('Pulling database from server now...');
                  const data = { token, request: "get_all" };
                  const endpoint = "data_operations";
                  console.log("POST https://hutaufvine.pythonanywhere.com/" + endpoint, data);
                  GM_xmlhttpRequest({
                    method: "POST",
                    url: "https://hutaufvine.pythonanywhere.com/" + endpoint,
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify(data),
                    onload: async (response) => {
                      console.log("Response from " + endpoint + ":", response.status);
                      if (response.status >= 200 && response.status < 300) {
                        const result = JSON.parse(response.responseText);
                        if (result.status === "success") {
                          const asinData = result.data;
                          for (const asin of asinData) {
                            const local_data = await getValue("ASIN_" + asin.ASIN);
                            if (local_data) {
                              const local_timestamp = local_data.timestamp ? local_data.timestamp : 0;
                              const remote_timestamp = asin.timestamp ? asin.timestamp : 0;
                              if (remote_timestamp > local_timestamp) {
                                await setValue("ASIN_" + asin.ASIN, asin.value);
                              }
                            } else {
                              await setValue("ASIN_" + asin.ASIN, asin.value);
                            }
                          }
                          console.log("Database downloaded successfully");
                        } else {
                          console.log("Failed to download database");
                        }
                      } else {
                        console.error("Failed to send data to the server.");
                      }
                    },
                    onerror: function(error) {
                      console.error("Network error while contacting " + endpoint + ":", error);
                    }
                  });
                }

                async uploadLocalDatabase() {
                  const token = await getValue("token");
                  if (!token) {
                    console.log("No token found");
                    return;
                  }
                  window.progressBar.setText('Pushing database to server now...');
                  const keys = await listValues();
                  const asinKeys = keys.filter(key => key.startsWith("ASIN_"));

                  const asinDataAll = await getAllAsinValues();
                  const asinData = [];

                  for (const asinKey of asinKeys) {
                    const asin = asinKey.replace("ASIN_", "");
                    window.progressBar.setText(`Loading data for ASIN ${asin}... (${asinKeys.indexOf(asinKey) + 1}/${asinKeys.length})`);
                    window.progressBar.setFillWidth(((asinKeys.indexOf(asinKey) + 1) / asinKeys.length) * 100);

                    const jsonData = asinDataAll[asinKey];
                    const parsedData = jsonData ? JSON.parse(jsonData) : {};
                    const jsDate = parseDateSafe(parsedData.date);
                    try {
                      parsedData.date = jsDate.toISOString();
                    } catch (error) {
                      console.log("error loading date, probably page not fully loaded");
                      continue;
                    }
                    asinData.push({
                      ASIN: asin,
                      timestamp: 0,
                      value: JSON.stringify(parsedData)
                    });
                  }

                  const data = { token, request: "update_asin", payload: asinData };
                  const endpoint = "data_operations";

                  console.log("POST https://hutaufvine.pythonanywhere.com/" + endpoint, data);
                  GM_xmlhttpRequest({
                    method: "POST",
                    url: "https://hutaufvine.pythonanywhere.com/" + endpoint,
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify(data),
                    onload: function(response) {
                      console.log("Response from " + endpoint + ":", response.status);
                      if (response.status >= 200 && response.status < 300) {
                        console.log("Data successfully sent to the server.");
                      } else {
                        console.log(response.text);
                        console.error("Failed to send data to the server.");
                      }
                    },
                    onerror: function(error) {
                      console.error("Network error while contacting " + endpoint + ":", error);
                    }
                  });
                }

                async syncProducts(products) {
                  if (!Array.isArray(products) || products.length === 0) return;

                  const lastFullSync = await getValue('last_full_sync', 0);
                  const needFullSync = Date.now() - lastFullSync > 7 * 24 * 60 * 60 * 1000;

                  const anonPayload = products
                    .filter(p => needFullSync || !p.pdf || p.pdf === 'NaN' || p.teilwert_v2 == null)
                    .map(p => ({ ASIN: p.ASIN, name: p.name, ETV: p.etv }));
                  if (anonPayload.length > 0) {
                    console.log('POST https://hutaufvine.pythonanywhere.com/upload_asins', anonPayload);
                    GM_xmlhttpRequest({
                      method: 'POST',
                      url: 'https://hutaufvine.pythonanywhere.com/upload_asins',
                      headers: { 'Content-Type': 'application/json' },
                      data: JSON.stringify(anonPayload),
                      onload: async (response) => {
                        console.log('Response from upload_asins:', response.status);
                        if (response.status >= 200 && response.status < 300) {
                          try {
                            const responseData = JSON.parse(response.responseText);
                            if (responseData.existing_asins) {
                              const payloadForPrivate = [];
                              for (const existingAsin of responseData.existing_asins) {
                                const asinKey = `ASIN_${existingAsin.asin}`;
                                const updated = {
                                  ...JSON.parse(await getValue(asinKey) || '{}'),
                                  keepa: existingAsin.keepa,
                                  teilwert: existingAsin.teilwert,
                                  teilwert_v2: existingAsin.teilwert_v2,
                                  pdf: existingAsin.pdf
                                };
                                await setValue(asinKey, JSON.stringify(updated));
                                payloadForPrivate.push({ ASIN: existingAsin.asin, timestamp: 0, value: JSON.stringify(updated) });
                              }
                              const token = await getValue('token');
                              if (token && payloadForPrivate.length > 0) {
                                const data = { token, request: 'update_asin', payload: payloadForPrivate };
                                const endpoint = 'data_operations';
                                console.log('POST https://hutaufvine.pythonanywhere.com/' + endpoint, data);
                                GM_xmlhttpRequest({
                                  method: 'POST',
                                  url: 'https://hutaufvine.pythonanywhere.com/' + endpoint,
                                  headers: { 'Content-Type': 'application/json' },
                                  data: JSON.stringify(data),
                                  onload: (resp) => {
                                    console.log('Response from ' + endpoint + ':', resp.status);
                                  },
                                  onerror: (err) => {
                                    console.error('Network error while contacting ' + endpoint + ':', err);
                                  }
                                });
                              }
                            }
                          } catch (e) {
                            console.log(e);
                          }
                          if (needFullSync) {
                            await setValue('last_full_sync', Date.now());
                          }
                        }
                      },
                      onerror: (err) => {
                        console.error('Network error while contacting upload_asins:', err);
                      }
                    });
                  }

                  const token = await getValue("token");
                  if (!token) {
                    console.log("No token found");
                    return;
                  }
                  const payload = products.map(p => ({ ASIN: p.ASIN, timestamp: 0, value: JSON.stringify(p) }));
                  const data = { token, request: 'update_asin', payload };
                  const endpoint = 'data_operations';
                  console.log('POST https://hutaufvine.pythonanywhere.com/' + endpoint, data);
                  GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://hutaufvine.pythonanywhere.com/' + endpoint,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify(data),
                    onload: (response) => {
                      console.log('Response from ' + endpoint + ':', response.status);
                    },
                    onerror: (err) => {
                      console.error('Network error while contacting ' + endpoint + ':', err);
                    }
                  });
                }

                createButtons() {
                  const container = document.createElement('div');
                  container.innerHTML = `
                    <button id="setTokenButton" style="margin-top: 10px;">Set token</button>
                    <button id="uploadButton" style="margin-top: 10px;">Upload data</button>
                    <button id="downloadButton" style="margin-top: 10px;">Download data</button>
                    <button id="deleteButton" style="margin-top: 10px;">Delete data</button>
                  `;

                  container.querySelector('#setTokenButton').addEventListener('click', async () => {
                    const token = prompt('Enter token:');
                    await setValue('token', token);
                  });

                  container.querySelector('#uploadButton').addEventListener('click', async () => {
                    await this.uploadLocalDatabase();
                  });

                  container.querySelector('#downloadButton').addEventListener('click', async () => {
                    await this.downloadDatabase();
                  });

                  container.querySelector('#deleteButton').addEventListener('click', async () => {
                    await this.deleteDatabase();
                  });

                  return container;
                }
              }

              const backendHandler = new PrivateBackendHandler();




              async function load_all_asin_etv_values_from_storage(upload = true) {
                  window.progressBar.setText('Loading data from storage...');
                  let keys = await listValues();
                  let asinKeys = keys.filter(key => key.startsWith("ASIN_"));
                  console.log(asinKeys.length)

                  const lastFullSync = await getValue('last_full_sync', 0);
                  const needFullSync = Date.now() - lastFullSync > 7 * 24 * 60 * 60 * 1000;

                  let asinDataAll = await getAllAsinValues();

                  let asinData = [];
                  let tempDataToSend = [];
                  let errorDates = [];

                  for (let asinKey of asinKeys) {
                      let asin = asinKey.replace("ASIN_", "");
                      window.progressBar.setText(`Loading data for ASIN ${asin}... (${asinKeys.indexOf(asinKey) + 1}/${asinKeys.length})`);
                      window.progressBar.setFillWidth(((asinKeys.indexOf(asinKey) + 1) / asinKeys.length) * 100);

                      let jsonData = asinDataAll[asinKey]; //await getValue(asinKey);

                      let parsedData = jsonData ? JSON.parse(jsonData) : {};
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


                    if (needFullSync || !parsedData.pdf || parsedData.pdf === 'NaN' || parsedData.teilwert_v2 == null) {
                        tempDataToSend.push({
                            ASIN: asin,
                            name: parsedData.name,
                            ETV: parsedData.etv
                        });
                    }

                  };

                  if (upload) {
                    window.progressBar.setText("uploading anonymized data to server now");
                    window.progressBar.setFillWidth(0);
                    for (let i = 1; i < 10; i++) {
                        setTimeout(() => {
                            window.progressBar.setFillWidth(i*10);
                        }, 300*i);
                    }
                    console.log('POST https://hutaufvine.pythonanywhere.com/upload_asins', tempDataToSend);
                  GM_xmlhttpRequest({
                      method: 'POST',
                      url: 'https://hutaufvine.pythonanywhere.com/upload_asins',
                      headers: { 'Content-Type': 'application/json' },
                      data: JSON.stringify(tempDataToSend),
                      onload: async function(response) {
                              console.log('Response from upload_asins:', response.status);
                              if (response.status >= 200 && response.status < 300) {
                                  console.log("Data successfully sent to the server.");
                                  if (needFullSync) {
                                      await setValue('last_full_sync', Date.now());
                                  }

                                    try {
                                      const responseData = JSON.parse(response.responseText);
                                      if (responseData.existing_asins) {
                                          const payloadForPrivate = [];
                                          for (const existingAsin of responseData.existing_asins) {
                                            window.progressBar.setText("upload successful, updating local data now (" + (responseData.existing_asins.indexOf(existingAsin) + 1) + "/" + responseData.existing_asins.length + ")");
                                            window.progressBar.setFillWidth(((responseData.existing_asins.indexOf(existingAsin) + 1) / responseData.existing_asins.length) * 100);
                                            const asinKey = `ASIN_${existingAsin.asin}`;
                                            const updated = {
                                                  ...JSON.parse(await getValue(asinKey) || '{}') ,
                                                  keepa: existingAsin.keepa,
                                                  teilwert: existingAsin.teilwert,
                                                  teilwert_v2: existingAsin.teilwert_v2,
                                                  pdf: existingAsin.pdf
                                            };
                                            await setValue(asinKey, JSON.stringify(updated));
                                            payloadForPrivate.push({ ASIN: existingAsin.asin, timestamp: 0, value: JSON.stringify(updated) });
                                          }

                                          const token = await getValue('token');
                                          if (token && payloadForPrivate.length > 0) {
                                            const data = { token, request: 'update_asin', payload: payloadForPrivate };
                                            const endpoint = 'data_operations';
                                            console.log('POST https://hutaufvine.pythonanywhere.com/' + endpoint, data);
                                            GM_xmlhttpRequest({
                                              method: 'POST',
                                              url: 'https://hutaufvine.pythonanywhere.com/' + endpoint,
                                              headers: { 'Content-Type': 'application/json' },
                                              data: JSON.stringify(data),
                                              onload: (resp) => {
                                                console.log('Response from ' + endpoint + ':', resp.status);
                                              },
                                              onerror: (err) => {
                                                console.error('Network error while contacting ' + endpoint + ':', err);
                                              }
                                            });
                                          }
                                      }
                                    }
                                  catch(e){
                                    console.log(e);
                                  }

                              } else {
                                  console.error("Failed to send data to the server:", response.statusText);
                              }
                              window.progressBar.hide();
                          },
                      onerror: function(error) {
                          console.error("Network error while contacting upload_asins:", error);
                      }
                  });
                  }

                  if (errorDates.length > 0) {
                    alert('Fehler beim Lesen folgender Datumsangaben: ' + errorDates.join(', '));
                  }

                  return asinData;
              }

                async function loadXLSXInfo() {
                    userlog("starting xlsx export");
                    try {
                        const yearElement = document.querySelector('select#vvp-tax-year-dropdown option:checked');
                        const year = yearElement.value.trim();
                        userlog("found year to be " + year);
                        const blobData = await fetchData(year);
                        const errors = await parseExcel(blobData);

                        const status = document.getElementById('status');
                        status.textContent = `Extraction successful. Data synced and stored locally.`;
                        if (errors.length > 0) {
                            alert('Fehler beim Erkennen des Datums bei ' + errors.length + ' Bestellung(en).');
                        }
                    } catch (error) {
                        console.error('Error loading XLSX info:', error);
                        const status = document.getElementById('status');
                        status.textContent = 'Error loading XLSX info';
                    }
                }

              function createSimpleProgressBar(container) {
                const progressBarContainer = document.createElement('div');
                progressBarContainer.id = 'simpleProgressBarContainer';
                progressBarContainer.style.border = '1px solid black';
                progressBarContainer.style.display = 'flex';
                progressBarContainer.style.alignItems = 'center';
                progressBarContainer.style.marginBottom = '5px'; // Add a little space
                progressBarContainer.style.width = '500px'; // Full width

                const progressBarFill = document.createElement('div');
                progressBarFill.id = 'simpleProgressBarFill';
                progressBarFill.style.height = '15px';
                progressBarFill.style.backgroundColor = 'lightblue';
                progressBarFill.style.width = '0%'; // Initial width

                const progressText = document.createElement('span');
                progressText.id = 'simpleProgressText';
                progressText.style.marginLeft = '5px';
                progressText.innerText = 'Loading...';
                progressText.style.position = 'absolute';

                progressBarContainer.appendChild(progressBarFill);
                progressBarContainer.appendChild(progressText);
                container.appendChild(progressBarContainer);

                return {
                  setFillWidth: (percentage) => {
                    progressBarFill.style.width = `${percentage}%`;
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
                  const container = document.querySelector('#vvp-tax-information-responsive-container');
                  const progressBar = createSimpleProgressBar(container);
                  window.progressBar = progressBar;
                  progressBar.setText('Loading...');
                  const div = document.createElement('div');
                  div.innerHTML = `
                    <div id="vine-data-extractor" style="margin-top: 20px; width: fit-content;">
                        <button id="load-xlsx-info" class="">Load XLSX Info</button>
                        <button id="show-all-data">Show All Data</button>
                        <button id="export-db">Export DB</button>
                        <button id="import-db">Import DB</button>
                        <button id="export-xlsx">Export XLSX</button>
                        <button id="create-pdf">Create large PDF</button>
                        <button id="copy-pdf-list">CopyPDF link list</button>


                         <div id="status" style="margin-top: 10px;">nothing loaded yet</div>
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
                            teilwertschaetzungenzurpdf: true,
                            useTeilwertV2: false
                        });

                        const settingsDiv = document.createElement('div');
                        settingsDiv.innerHTML = `
                            <div style="margin-top: 10px; width: fit-content; border: 1px solid black; padding: 10px;">
                                <label><input type="checkbox" id="cancellations" ${settings.cancellations ? 'checked' : ''}> Cancellations</label>
                                <label><input type="checkbox" id="tax0" ${settings.tax0 ? 'checked' : ''}> Tax0</label>
                                <label><input type="checkbox" id="streuartikelregelung" ${settings.streuartikelregelung ? 'checked' : ''}> Streuartikelregelung anwenden</label>
                                <label><input type="checkbox" id="streuartikelregelungTeilwert" ${settings.streuartikelregelungTeilwert ? 'checked' : ''}> Streuartikelregelung auf Teilwert vor 10/2024</label>
                                <label><input type="checkbox" id="add2ndhalf2023to2024" ${settings.add2ndhalf2023to2024 ? 'checked' : ''}> 2. Jahreshälfte 2023 in 2024 versteuern</label>
                                <label><input type="checkbox" id="einnahmezumteilwert" ${settings.einnahmezumteilwert ? 'checked' : ''}> EÜR: Einnahme zum Teilwert vor 10/2024</label>
                                <label><input type="checkbox" id="teilwertschaetzungenzurpdf" ${settings.teilwertschaetzungenzurpdf ? 'checked' : ''}> Teilwertschätzungen der PDF hinzufügen</label>
                                <label><input type="checkbox" id="useTeilwertV2" ${settings.useTeilwertV2 ? 'checked' : ''}> Teilwert V2 verwenden</label>
                                <select id="yearFilter">
                                    <option value="show all years" ${settings.yearFilter === "show all years" ? 'selected' : ''}>Show all years</option>
                                    <option value="only 2023" ${settings.yearFilter === "only 2023" ? 'selected' : ''}>Only 2023</option>
                                    <option value="only 2024" ${settings.yearFilter === "only 2024" ? 'selected' : ''}>Only 2024</option>
                                    <option value="only 2025" ${settings.yearFilter === "only 2025" ? 'selected' : ''}>Only 2025</option>
                                </select>

                            </div>
                        `;

                        settingsDiv.appendChild(backendHandler.createButtons());
                        div.appendChild(settingsDiv);
                        container.appendChild(div);

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

                        document.getElementById('teilwertschaetzungenzurpdf').addEventListener('change', async (event) => {
                            settings.teilwertschaetzungenzurpdf = event.target.checked;
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
                    const filteredData = asinData.filter(item => {
                        const itemYear = new Date(item.date).getFullYear();
                        const itemMonth = new Date(item.date).getMonth();
                        if (settings.yearFilter !== "show all years") {
                        if (settings.yearFilter === "only 2023" && settings.add2ndhalf2023to2024) {
                            if (!(itemYear === 2023 && itemMonth < 6)) {
                            return false;
                            }
                        } else if (settings.yearFilter === "only 2024" && settings.add2ndhalf2023to2024) {
                            if (!(itemYear === 2024 || (itemYear === 2023 && itemMonth >= 6))) {
                            return false;
                            }
                        } else if (settings.yearFilter !== `only ${itemYear}`) {
                            return false;
                        }
                        }
                        if ((!settings.cancellations) && cancellations.includes(item.ASIN)) {
                        return false;
                        }
                        if ((!settings.tax0) && item.etv == 0) {
                        return false;
                        }
                        return true;
                    });

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
                            const reader = new FileReader();
                            reader.onload = async (e) => {
                                try {
                                    const json = JSON.parse(e.target.result);
                                    for (const key in json) {
                                        await setValue(key, json[key]);
                                    }
                                    alert('Database imported successfully.');
                                } catch (error) {
                                    console.error('Error importing database:', error);
                                    alert('Failed to import database.');
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
                      document.getElementById('load-xlsx-info').addEventListener('click', loadXLSXInfo);
                      document.getElementById('show-all-data').addEventListener('click', showAllData);
                      document.getElementById('create-pdf').addEventListener('click', createPDF);
                      document.getElementById('copy-pdf-list').addEventListener('click', copyPDFList);
                      const list = await load_all_asin_etv_values_from_storage();
                      userlog(`nothing loaded yet. ${list.length} items in database`);
                      createYearlyBreakdown(list);

                  }, 200);
              }

  async function createYearlyBreakdown(list) {
      const sortedItems = list.map(item => ({
          ...item,
          date: new Date(item.date)
      })).sort((a, b) => a.date - b.date);

      const years = [...new Set(sortedItems.map(item => item.date.getFullYear()))];

      const container = document.getElementById('vvp-tax-information-container');

      years.forEach(async year => {

        const settings = await getValue("settings", {
            yearFilter: "show all years",
            streuartikelregelung: true,
            streuartikelregelungTeilwert: true,
            add2ndhalf2023to2024: true
        });

        if (settings.yearFilter !== "show all years" && settings.yearFilter !== `only ${year}`) {
            return;
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
      });
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
                console.log("Invalid teilwert found:", item);
            }
            if (item.etv <= 0 || isNaN(item.etv)) {
                console.log("Invalid etv found:", item);
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
                  console.log("Invalid teilwert found in createTeilwertSummaryTable:", item);
              }
              if (item.etv <= 0 || isNaN(item.etv)) {
                  console.log("Invalid etv found in createTeilwertSummaryTable:", item);
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

              function userlog(txt) {
                  console.log(txt);
                  document.getElementById('status').textContent = txt;
              }

              async function fetchData(year) {
                  userlog("trying to fetch tax data from amazon")
                  const url = `https://www.amazon.de/vine/api/get-tax-report?year=${year}&fileType=XLSX`;
                  console.log('GET ' + url);
                  const response = await fetch(url);
                  console.log('Response from fetchData:', response.status);
                  const data = await response.json();
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
                  const worksheet = workbook.Sheets[sheetName];
                  const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                  console.log(json);
                  const {data: extractedData, errors} = await extractData(json);
                  await saveData(extractedData, true);
                  return errors;
              }

                function parseOrdersTable() {
                    const orders = document.querySelectorAll(".vvp-orders-table--row");
                    const data = {};
                    const errors = [];

                    orders.forEach((order) => {
                        const orderDate = order.querySelector(".vvp-orders-table--text-col[data-order-timestamp]").textContent.trim();
                        const elements = order.querySelectorAll(".vvp-orders-table--text-col");
                        const orderElement = Array.from(elements).find(el => el.hasAttribute("data-order-timestamp"));
                        if (orderElement) {
                          console.log(orderElement);
                        } else {
                          console.log('Element with data-order-timestamp not found');
                        }
                        const parsedDate = parseDateSafe(orderDate);
                        const asinElement = order.querySelector("a[href^='https://www.amazon.de/dp/']");
                        const productName = order.querySelector('span.a-truncate-full').textContent.trim();
                        let etv = order.querySelector(".vvp-orders-table--text-col.vvp-text-align-right").textContent.trim();
                        etv = etvstrtofloat(etv);
                        const orderNumber = order.innerHTML.match(/orderID=([^&]+)/)[1].split('"')[0];
                        console.log(orderDate, asinElement, etv);
                        if (asinElement) {
                            const asin = asinElement.getAttribute("href").split("/")[4];
                            data[asin] = {
                                name: productName,
                                ordernumber: orderNumber,
                                date: parsedDate ? parsedDate.toISOString() : orderDate,
                                etv: etv
                            };
                        } else {
                            const alternativeAsinElement = order.querySelector(".vvp-orders-table--text-col");
                            if (alternativeAsinElement) {
                                const alternativeAsin = alternativeAsinElement.textContent.trim().split(" ")[0];
                                data[alternativeAsin] = {
                                    name: productName,
                                    ordernumber: orderNumber,
                                    date: parsedDate ? parsedDate.toISOString() : orderDate,
                                    etv: etv
                                };
                            }
                        }
                        if (!parsedDate) {
                            errors.push(orderDate);
                        }
                    });

                    return {data, errors};
                }

              async function extractData(json) {
                  const data = {};
                  const errors = [];
                  const headerRowIndex = 2;
                  const header = json[headerRowIndex];

                  let cancellations = await getValue('cancellations', []);

                  for (let i = headerRowIndex + 1; i < json.length; i++) {
                      const row = json[i];
                      if (row.length < header.length) {
                          continue;
                      }

                      const orderNumber = row[0];
                      const asin = row[1];
                      const name = row[2];
                      const orderType = row[3];
                      const orderDate = row[4];
                      const parsedDate = parseDateSafe(orderDate);
                      const etvString = row[row.length - 1];
                      const etv = etvstrtofloat(etvString);

                      if (orderType === 'CANCELLATION') {
                          if (!cancellations.includes(asin)) {
                              cancellations.push(asin);
                              setValue('cancellations', cancellations);
                              continue;
                          }
                      }

                      if (!data[asin]) {
                          data[asin] = {
                              name: name,
                              ordernumber: orderNumber,
                              date: parsedDate ? parsedDate.toISOString() : orderDate,
                              etv: etv
                          };
                          if (!parsedDate) {
                              errors.push(orderDate);
                          }
                      }
                  }

                  return {data, errors};
              }

              async function saveData(data, sync = false) {
                  const products = [];
                  for (const asin in data) {
                      const key = `ASIN_${asin}`;
                      const existingData = await getValue(key);
                      const updatedData = existingData ? { ...JSON.parse(existingData), ...data[asin] } : data[asin];
                      await setValue(key, JSON.stringify(updatedData));
                      products.push({ ...updatedData, ASIN: asin });
                  }
                  if (sync) {
                      backendHandler.syncProducts(products);
                  }
              }

              async function loadXLSXInfo() {
                  userlog("starting xlsx export");
                  try {
                      const yearElement = document.querySelector('select#vvp-tax-year-dropdown option:checked');
                      const year = yearElement.value.trim();
                      userlog("found year to be " + year);
                      const blobData = await fetchData(year);
                      const errors = await parseExcel(blobData);

                      const status = document.getElementById('status');
                      status.textContent = `Extraction successful. Data synced and stored locally.`;
                      if (errors.length > 0) {
                          alert('Fehler beim Erkennen des Datums bei ' + errors.length + ' Bestellung(en).');
                      }
                  } catch (error) {
                      console.error('Error loading XLSX info:', error);
                      const status = document.getElementById('status');
                      status.textContent = 'Error loading XLSX info';
                  }
              }

                async function loadOrdersInfo() {
                    userlog("Starting order info extraction");

                    try {
                        const {data, errors} = parseOrdersTable();
                        await saveData(data, true);

                        const status = document.getElementById('status');
                        status.textContent = `Extraction successful. Number of items: ${Object.keys(data).length}`;
                        if (errors.length > 0) {
                            alert('Fehler beim Erkennen des Datums bei ' + errors.length + ' Bestellung(en).');
                        }
                        window.progressBar.hide();
                    } catch (error) {
                        console.error('Error loading order info:', error);
                        const status = document.getElementById('status');
                        status.textContent = 'Error loading order info';
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
              <div id="status" style="margin-top: 10px;">nothing loaded yet</div>
              <div id="data-table" style="margin-top: 20px;"></div>
          </div>
      `;
      container.parentNode.insertBefore(div, container.nextSibling);

      setTimeout(() => {
          document.getElementById('load-orders-info').addEventListener('click', loadOrdersInfo);
          document.getElementById('show-all-data').addEventListener('click', showAllData);
          loadOrdersInfo();
      }, 200);
  }


    // Fetch a PDF using GM_xmlHttpRequest
    function fetchPDF(url) {
        if (url && url.endsWith('.pdf')) {
            return new Promise((resolve, reject) => {
            console.log('GET ' + url);
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                onload: (response) => {
                    console.log('Response from fetchPDF:', response.status);
                    resolve(new Uint8Array(response.response));
                },
                onerror: (err) => {
                    console.error('Network error while fetching PDF:', err);
                    reject(err);
                },
            });
            });
        } else {
            return Promise.reject(new Error('Invalid URL or URL does not point to a PDF file.'));
        }
    }

    function loadScript(url) {
        return new Promise((resolve, reject) => {
            console.log('GET ' + url);
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
                    console.log('Response from loadScript:', response.status);
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            // Execute the script in a new function scope to avoid polluting the global scope
                            let module = { exports: {} };
                            let exports = module.exports; // For compatibility with some UMD modules
                            eval(response.responseText);
                            resolve(module.exports); // Resolve with the module's exports
                        } catch (error) {
                            reject("Error evaluating script: " + error);
                        }
                    } else {
                        reject("Error loading script: " + response.status + " " + response.statusText);
                    }
                },
                onerror: function(error) {
                    console.error('Network error while loading script:', error);
                    reject("Network error: " + error);
                }
            });
        });
    }


  async function copyPDFList() {
        const asinData = await load_all_asin_etv_values_from_storage();
        const settings = await getValue("settings", {});
        const pdfList = asinData.map(item => getPDFLink(item, settings)).filter(url => url && url.endsWith('.pdf'));
        const pdfListText = pdfList.join('\n');
        GM_setClipboard(pdfListText);
        alert('PDF list copied to clipboard.');
    }


  async function createPDF() {
      const pdfLib = await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');

      // Now you can use pdfLib
      const { PDFDocument, rgb, StandardFonts } = pdfLib;

    let asinData = await load_all_asin_etv_values_from_storage(false);

    const settings = await getValue("settings", {
        cancellations: false,
        tax0: false,
        yearFilter: "show all years",
        teilwertschaetzungenzurpdf: true,
        streuartikelregelung: true,
        streuartikelregelungTeilwert: true
    });

    let cancellations = await getValue('cancellations', []);

    const filteredData = asinData.filter(item => {
        const itemYear = new Date(item.date).getFullYear();
        if (settings.yearFilter !== "show all years" && settings.yearFilter !== `only ${itemYear}`) {
            return false;
        }
        if ((!settings.cancellations) && cancellations.includes(item.ASIN)) {
            return false;
        }
        if ((!settings.tax0) && item.etv == 0) {
            return false;
        }
        return true;
    });



    //TODO remove slicing
    asinData = filteredData

    // Create a new PDF document
        const newPdf = await PDFDocument.create();

        // Add a placeholder page
        const deckblattPage = newPdf.addPage([600, 800]);
        const { width, height } = deckblattPage.getSize();
        const fontSize = 12;
        const margin = 50;

        let text = `
            Einleitung zur Versteuerung von Amazon Vine
            ------------------------------------------
            Amazon Vine ist ein Produkttestprogramm, bei dem ausgewählte Tester Produkte kostenlos erhalten, um diese zu bewerten. Die erhaltenen Produkte dürfen behalten werden und sind daher als Betriebsausgaben zu sehen, da Amazon Erfahrungen aus erster Hand fordert.

            Referenzen:
            1. Finanzministerium des Landes Schleswig-Holstein v. 02.07.2024 - VI 3010 - S 2240 - 190 / Ertragsteuerrechtliche Behandlung von digital agierenden Steuerpflichtigen (Influencer) https://datenbank.nwb.de/Dokument/1051855/
            2. Bundesfinanzhof Urteil vom 21. April 2010, X R 43/08 https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/STRE201050388/
            3. Bundesfinanzhof Urteil vom 18. 8. 2005 – VI R 32/03 https://lexetius.com/2005,2218

            `;


            if (settings.add2ndhalf2023to2024) {
                text += `
                Die Produkte aus der 2. Jahreshälfte 2023 sind erst in 2024 zu versteuern, da das wirtschaftliche Eigentum dann erst auf den Produkttester übergegangen ist (§39 AO).
                `;
            }
            if (settings.einnahmezumteilwert) {
                text += `
                Da sich Amazon bis Oktober 2024 ein Rückforderungsrecht vorgehalten hat, erfolgte der wirtschaftliche Eigentumsübergang erst nach 6 Monaten nach Erhalt des Produkts, dann zum Zeitwert des Produkts (gemeiner Wert). Die Einnahme des Produkts wurde daher entsprechend bewertet (§9 und §10 BewG, §39 AO, §8 EStG).
                `;
            }
            if (settings.streuartikelregelung) {
                text += `
                Sogenannte Streuwerbeartikel bzw. geringwertige Warenproben werden auf Basis des BMF-Schreibens vom 19.5.2015 (Az. IV C 6 -S 2297-b/14/10001) nicht in die Berechnung mit einbezogen.
                `;
            }


        deckblattPage.drawText(text, {
            x: margin,
            y: height - margin - fontSize,
            size: fontSize,
            lineHeight: 1.5*fontSize,
            maxWidth: width - 2 * margin
        });

        // add a new page with the EÜR calculation:
        const euerPage = newPdf.addPage([600, 800]);
        const euerText = `
        Einnahmenüberschussrechnung
        ---------------------------
        `
        euerData = {
            einnahmen: 0,
            ausgaben: 0,
            entnahmen: 0,
            einnahmen_aus_anlagevermoegen: 0
        };
        // calculate the EÜR values
        const teilwertEtvRatios = 0.2; // for the PDF, we will just set this constant until we have the actual data

        const itemsWithTeilwert = asinData.filter(item => getTeilwert(item, settings) != null);
        const avgTeilwertEtvRatio = itemsWithTeilwert.map(item => getTeilwert(item, settings) / item.etv).reduce((sum, ratio) => sum + ratio, 0) / itemsWithTeilwert.length;


        itemsWithTeilwert.forEach(item => {
            const { einnahmen, ausgaben, entnahmen, einnahmen_aus_anlagevermoegen } = calculateEuerValues(item, settings, avgTeilwertEtvRatio);
            euerData.einnahmen += einnahmen;
            euerData.ausgaben += ausgaben;
            euerData.entnahmen += entnahmen;
            euerData.einnahmen_aus_anlagevermoegen += einnahmen_aus_anlagevermoegen;
        });


        // Fetch and merge PDFs
        if (settings.teilwertschaetzungenzurpdf) {
            window.progressBar.show()
            window.progressBar.setText("downloading pdfs...")
            window.progressBar.setFillWidth(0)
            for (const item of asinData) {
                try {
                    const pdfUrl = getPDFLink(item, settings);
                    const pdfBytes = await fetchPDF(pdfUrl);
                    const externalPdf = await PDFDocument.load(pdfBytes);
                    const externalPages = await newPdf.copyPages(externalPdf, externalPdf.getPageIndices());
                    externalPages.forEach((page) => newPdf.addPage(page));
                    window.progressBar.setText(`downloading pdfs... ${asinData.indexOf(item) + 1} / ${asinData.length}`)
                    window.progressBar.setFillWidth(asinData.indexOf(item) / asinData.length * 100)
                } catch (err) {
                    console.error(`Failed to fetch or merge PDF from ${getPDFLink(item, settings)}:`, err);
                }
            }
        }

        // Serialize and download the merged PDF
        const finalPdfBytes = await newPdf.save();
        const blob = new Blob([finalPdfBytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'vine-tax-report.pdf';
        window.progressBar.hide()
        link.click();

  }

  async function showAllData() {
    document.addEventListener('click', function(event) {
        console.log("click detected");
        const overlay = document.getElementById('teilwert-overlay');
        if (overlay && !overlay.contains(event.target)) {
            const spawnDate = overlay.getAttribute('data-spawn-date');
            const currentTime = new Date().getTime();
            if (currentTime - spawnDate > 300) {
                overlay.remove();
            }
        }
    });


      const dataTableDiv = document.getElementById('data-table');
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
        const filteredData = asinData.filter(item => {
            const itemYear = new Date(item.date).getFullYear();
            const itemMonth = new Date(item.date).getMonth();
            if (settings.yearFilter !== "show all years") {
            if (settings.yearFilter === "only 2023" && settings.add2ndhalf2023to2024) {
                if (!(itemYear === 2023 && itemMonth < 6)) {
                return false;
                }
            } else if (settings.yearFilter === "only 2024" && settings.add2ndhalf2023to2024) {
                if (!(itemYear === 2024 || (itemYear === 2023 && itemMonth >= 6))) {
                return false;
                }
            } else if (settings.yearFilter !== `only ${itemYear}`) {
                return false;
            }
            }
            if ((!settings.cancellations) && cancellations.includes(item.ASIN)) {
            return false;
            }
            if ((!settings.tax0) && item.etv == 0) {
            return false;
            }
            return true;
        });

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
              const pdfLink = getPDFLink(item, settings);
              let teilwertDisplay;
              if (item.myteilwert != null) {
                  teilwertDisplay = `${item.myteilwert}<sup>m</sup>`;
              } else {
                  const teilwert = settings.useTeilwertV2 ? item.teilwert_v2 : item.teilwert;
                  teilwertDisplay = teilwert != null ? teilwert : 'N/A';
              }

              table += `<tr>
                          <td>${item.ASIN}</td>
                          <td style="white-space: nowrap;">${item.date ? item.date.split('T')[0] : 'N/A'}</td>
                          <td>${item.name || 'N/A'}</td>
                          <td>${item.etv}</td>
                          <td>${item.keepa != null ? `<a href="https://keepa.com/#!product/3-${item.ASIN}" target="_blank">${item.keepa}</a>` : 'N/A'}</td>
                          <td id="teilwert_for_asin_${item.ASIN}" data-order="${getTeilwert(item, settings) || 0}">
                              <a href="javascript:void(0);">
                                  ${teilwertDisplay}
                              </a>
                          </td>
                          <td>${pdfLink ? `<a href="${pdfLink}" target="_blank">PDF Link</a>` : 'N/A'}</td>
                          <td><a href="https://www.amazon.de/dp/${item.ASIN}" target="_blank">Product Link</a></td>
                          <td><a href="https://www.amazon.de/review/create-review?encoding=UTF&asin=${item.ASIN}" target="_blank">Review Link</a></td>
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
            const pdfLink = getPDFLink(item, settings);

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
                <p>Name: ${item.name}</p>
                <p>ASIN: ${item.ASIN}</p>
                <p>Date: ${item.date.split('T')[0]}</p>
                <p>ETV: ${item.etv}</p>
                <p>Keepa: ${item.keepa != null ? `<a href="https://keepa.com/#!product/3-${item.ASIN}" target="_blank">${item.keepa}</a>` : 'N/A'}</p>
                <p>Teilwert v1: ${item.teilwert != null ? item.teilwert : 'N/A'}</p>
                <p>Teilwert v2: ${item.teilwert_v2 != null ? item.teilwert_v2 : 'N/A'}</p>
                <p>Product Link: <a href="https://www.amazon.de/dp/${item.ASIN}" target="_blank">Link</a></p>
                <p>PDF Link: ${pdfLink ? `<a href="${pdfLink}" target="_blank">Link</a>` : 'N/A'}</p>
                <p>Angepasster Teilwert: <input type="text" id="angepasster-teilwert" value="${item.myteilwert != null ? item.myteilwert : ''}"></p>
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
                    const updatedItem = JSON.parse(await getValue(`ASIN_${asin}`));
                    updatedItem[checkbox.id] = event.target.checked;
                    await setValue(`ASIN_${asin}`, JSON.stringify(updatedItem));
                });
            });

            document.getElementById('angepasster-teilwert').addEventListener('change', async (event) => {
                const value = parseFloat(event.target.value.replace(',', '.'));
                if (!isNaN(value)) {
                    const updatedItem = JSON.parse(await getValue(`ASIN_${asin}`));
                    updatedItem.myteilwert = value;
                    await setValue(`ASIN_${asin}`, JSON.stringify(updatedItem));
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
          dataTableDiv.innerHTML = `<p>Error loading data: ${error.message}</p>`;
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
                  document.getElementById('status').textContent = txt;
              }

              var currentPageURL = window.location.href;

              if (currentPageURL.includes("https://www.amazon.de/vine/account")) {
                  window.addEventListener('load', async function() {
                    createUI_taxextractor();
                    });
              } else if (currentPageURL.includes("https://www.amazon.de/vine/orders")) {
                    window.addEventListener('load', async function() {
                        createUIorderpage();
                    });
              }


  })();