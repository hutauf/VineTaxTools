// ==UserScript==
// @name        taxsummary
// @namespace   Violentmonkey Scripts
// @match       https://www.amazon.de/vine/account*
// @match       https://www.amazon.de/vine/orders*
// @require     https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.8.0/jszip.js
// @require     https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.8.0/xlsx.js
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
// @version     1.0
// @author      -
// @description 30.6.2024, 18:20:31
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

            async function listValues() {
              try {
                return (await db.keyValuePairs.toCollection().primaryKeys());
              } catch (error) {
                console.error("Error listing values:", error);
                return [];
              }
            }

              function etvstrtofloat(etvString) {
                  const cleanString = etvString.replace(/[€ ]/g, '');
                  const cleanedValue = cleanString.replace(/[.,](?=\d{3})/g, '');
                  const etv = parseFloat(cleanedValue.replace(',', '.'));
                  return etv;
              }

              async function load_all_asin_etv_values_from_storage(upload = true) {
                  window.progressBar.setText('Loading data from storage...');
                  let keys = await listValues();
                  let asinKeys = keys.filter(key => key.startsWith("ASIN_"));
                  console.log(asinKeys.length)

                  let asinData = [];
                  let tempDataToSend = [];

                  for (let asinKey of asinKeys) {
                      let asin = asinKey.replace("ASIN_", "");
                      window.progressBar.setText(`Loading data for ASIN ${asin}... (${asinKeys.indexOf(asinKey) + 1}/${asinKeys.length})`);
                      window.progressBar.setFillWidth(((asinKeys.indexOf(asinKey) + 1) / asinKeys.length) * 100);
                      let jsonData = await getValue(asinKey);

                      let parsedData = jsonData ? JSON.parse(jsonData) : {};
                      let [day, month, year] = parsedData.date.replace(/\//g, '.').split('.');
                      let jsDate = new Date(`${year}-${month}-${day}`);
                      try {
                          parsedData.date = jsDate.toISOString();
                      } catch (error) {
                        console.log("error loading date, probably page not fully loaded");
                          continue;
                      }

                      asinData.push({
                          ...parsedData,
                          ASIN: asin
                      });
                      tempDataToSend.push({
                          ASIN: asin,
                          name: parsedData.name,
                          ETV: parsedData.etv
                      });
                  };

                  if (upload) {
                    window.progressBar.setText("uploading anonymized data to server now");
                    window.progressBar.setFillWidth(0);
                    for (let i = 1; i < 10; i++) {
                        setTimeout(() => {
                            window.progressBar.setFillWidth(i*10);
                        }, 300*i);
                    }
                    GM_xmlhttpRequest({
                      method: 'POST',
                      url: 'https://hutaufvine.pythonanywhere.com/upload_asins',
                      headers: { 'Content-Type': 'application/json' },
                      data: JSON.stringify(tempDataToSend),
                        onload: async function(response) {
                              if (response.status >= 200 && response.status < 300) {
                                  console.log("Data successfully sent to the server.");

                                    try {
                                      const responseData = JSON.parse(response.responseText);
                                      if (responseData.existing_asins) {
                                          for (const existingAsin of responseData.existing_asins) {
                                            window.progressBar.setText("upload successful, updating local data now (" + (responseData.existing_asins.indexOf(existingAsin) + 1) + "/" + responseData.existing_asins.length + ")");
                                            window.progressBar.setFillWidth(((responseData.existing_asins.indexOf(existingAsin) + 1) / responseData.existing_asins.length) * 100);
                                            const asinKey = `ASIN_${existingAsin.asin}`;
                                               await setValue(asinKey, JSON.stringify({
                                                  ...JSON.parse(await getValue(asinKey) || '{}') ,
                                                  keepa: existingAsin.keepa,
                                                  teilwert: existingAsin.teilwert,
                                                  pdf: existingAsin.pdf
                                                  }));
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
                          console.error("Error sending data to the server:", error);
                      }
                  });
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
                      await parseExcel(blobData);

                      const status = document.getElementById('status');
                      status.textContent = `Extraction successful. Data is stored locally.`;
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
                        <button id="create-pdf">Create PDF</button>

                         <div id="status" style="margin-top: 10px;">nothing loaded yet</div>
                    </div>
                `;
                        const settings = await getValue("settings", {
                            cancellations: false,
                            tax0: false,
                            yearFilter: "show all years",
                            streuartikelregelung: true,
                            streuartikelregelungTeilwert: true,
                            add2ndhalf2023to2024: true
                        });

                        const settingsDiv = document.createElement('div');
                        settingsDiv.innerHTML = `
                            <div style="margin-top: 10px; width: fit-content; border: 1px solid black; padding: 10px;">
                                <label><input type="checkbox" id="cancellations" ${settings.cancellations ? 'checked' : ''}> Cancellations</label>
                                <label><input type="checkbox" id="tax0" ${settings.tax0 ? 'checked' : ''}> Tax0</label>
                                <label><input type="checkbox" id="streuartikelregelung" ${settings.streuartikelregelung ? 'checked' : ''}> Streuartikelregelung anwenden</label>
                                <label><input type="checkbox" id="streuartikelregelungTeilwert" ${settings.streuartikelregelungTeilwert ? 'checked' : ''}> Streuartikelregelung auf Teilwert vor 10/2024</label>
                                <label><input type="checkbox" id="add2ndhalf2023to2024" ${settings.add2ndhalf2023to2024 ? 'checked' : ''}> 2. Jahreshälfte 2023 in 2024 versteuern</label>
                                <select id="yearFilter">
                                    <option value="show all years" ${settings.yearFilter === "show all years" ? 'selected' : ''}>Show all years</option>
                                    <option value="only 2023" ${settings.yearFilter === "only 2023" ? 'selected' : ''}>Only 2023</option>
                                    <option value="only 2024" ${settings.yearFilter === "only 2024" ? 'selected' : ''}>Only 2024</option>
                                    <option value="only 2025" ${settings.yearFilter === "only 2025" ? 'selected' : ''}>Only 2025</option>
                                </select>
                            </div>
                        `;

                        div.appendChild(settingsDiv);
                        container.appendChild(div);

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
                        



                document.getElementById('export-db').addEventListener('click', async () => {
                    const keys = await listValues();
                    const data = {};
                    for (const key of keys) {
                        data[key] = await getValue(key);
                    }
                    const json = JSON.stringify(data, null, 2);
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'database.json';
                    a.click();
                    URL.revokeObjectURL(url);
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
          if (year === 2023) {
              target_date = new Date(year, 5, 30);
          }
          await createETVPlot(year, yearlyItems, target_date, yearContainer); // Assuming end of year for plot
          await createCancellationRatioTable(yearlyItems, yearContainer);
          await createTeilwertSummaryTable(yearlyItems, yearContainer);
      });
  }

  async function createETVPlot(taxYear, items, endDate, parentElement) {
    const cancelledAsins = await getValue("cancellations", []);
    // Filter out items with etv === 0
    const filteredItems = items.filter(item => !cancelledAsins.includes(item.ASIN) && item.etv > 0);

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
    const itemsWithTeilwert = filteredItems.filter(item => item.teilwert != null);
    if (itemsWithTeilwert.length >= 10) {
        const teilwertEtvRatios = itemsWithTeilwert.map(item => {
            if (item.teilwert === null || isNaN(item.teilwert) || item.teilwert < 0) {
                console.log("Invalid teilwert found:", item);
            }
            if (item.etv <= 0 || isNaN(item.etv)) {
                console.log("Invalid etv found:", item);
            }
            return item.teilwert / item.etv;
        });
        const validRatios = teilwertEtvRatios.filter(ratio => !isNaN(ratio)); // Filter out NaN values
        if (validRatios.length > 0) {
            const avgTeilwertEtvRatio = validRatios.reduce((sum, ratio) => sum + ratio, 0) / validRatios.length;

            if (avgTeilwertEtvRatio >= 0.01 && avgTeilwertEtvRatio <= 0.5) {
                const teilwertDataMap = new Map();
                let currentTeilwert = 0;
                filteredItems.forEach(d => {
                    const dateKey = d.date.toISOString().split('T')[0];
                    currentTeilwert += (d.teilwert != null ? d.teilwert : (d.etv * avgTeilwertEtvRatio));
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

    const counts = list.reduce((acc, item) => {
        if (cancelledAsins.includes(item.ASIN)) {
            acc.cancellations += 1;
        } else if (item.etv === 0) {
            acc.tax0 += 1;
        } else if (item.teilwert != null) {
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
    svg.selectAll('labels')
        .data(pie(data))
        .enter()
        .append('text')
        .attr('dy', '.35em')
        .attr('transform', d => {
            const pos = outerArc.centroid(d);
            const midAngleValue = midAngle(d);
            pos[0] = radius * (midAngleValue < Math.PI ? 1 : -1);
            return `translate(${pos})`;
        })
        .style('text-anchor', d => (midAngle(d)) < Math.PI ? 'start' : 'end')
        .text(d => `${d.data.category}: ${d.data.count}`);

    // Add polylines between chart and labels
    svg.selectAll('lines')
        .data(pie(data))
        .enter()
        .append('polyline')
        .attr('stroke', 'black')
        .style('fill', 'none')
        .attr('stroke-width', 1)
        .attr('points', d => {
            const posA = arc.centroid(d);
            const posB = outerArc.centroid(d);
            const midAngleValue = midAngle(d);
            const posC = outerArc.centroid(d);
            posC[0] = radius * 0.9 * (midAngleValue < Math.PI ? 1 : -1);
            return [posA, posB, posC];
        });

    function midAngle(d) {
        return d.startAngle + (d.endAngle - d.startAngle) / 2;
    }
}
  async function createTeilwertSummaryTable(list, parentElement) {
      const cancelledAsins = await getValue("cancellations", []);
      let filteredList = list.filter(item => !cancelledAsins.includes(item.ASIN));

    const settings = await getValue("settings", {
        streuartikelregelung: true,
        streuartikelregelungTeilwert: true
    });

    if (settings.streuartikelregelung) {
        filteredList = filteredList.filter(item => item.etv > 11.90);
    }

    if (settings.streuartikelregelungTeilwert) {
        filteredList = filteredList.filter(item => {
            const orderDate = new Date(item.date);
            return (orderDate >= new Date(2024, 9, 1) || item.teilwert > 11.90);
        });
    }


      const itemsWithTeilwert = filteredList.filter(item => item.teilwert != null);
      const itemsWithoutTeilwert = filteredList.filter(item => item.teilwert == null && item.etv > 0);

      if (itemsWithTeilwert.length >= 10) {
          const teilwertEtvRatios = itemsWithTeilwert.map(item => {
              if (item.teilwert === null || isNaN(item.teilwert) || item.teilwert < 0) {
                  console.log("Invalid teilwert found in createTeilwertSummaryTable:", item);
              }
              if (item.etv <= 0 || isNaN(item.etv)) {
                  console.log("Invalid etv found in createTeilwertSummaryTable:", item);
              }
              return item.teilwert / item.etv;
          });
          const validRatios = teilwertEtvRatios.filter(ratio => !isNaN(ratio));
          if (validRatios.length > 0) {
              const avgTeilwertEtvRatio = validRatios.reduce((sum, ratio) => sum + ratio, 0) / validRatios.length;

              if (avgTeilwertEtvRatio >= 0.01 && avgTeilwertEtvRatio <= 0.5 && itemsWithoutTeilwert.length > 0) {
                  const totalTeilwert = itemsWithTeilwert.reduce((sum, item) => sum + item.teilwert, 0);
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
                  const totalTeilwert = itemsWithTeilwert.reduce((sum, item) => sum + item.teilwert, 0);
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
                  userlog(url);
                  const response = await fetch(url);
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
                  const extractedData = await extractData(json);
                  saveData(extractedData);
              }

              function parseOrdersTable() {
                  const orders = document.querySelectorAll(".vvp-orders-table--row");
                  const data = {};

                  orders.forEach((order) => {
                      const orderDate = order.querySelector(".vvp-orders-table--text-col[data-order-timestamp]").textContent;
                      const elements = order.querySelectorAll(".vvp-orders-table--text-col");
                      const orderElement = Array.from(elements).find(el => el.hasAttribute("data-order-timestamp"));
                      if (orderElement) {
                        console.log(orderElement);
                      } else {
                        console.log('Element with data-order-timestamp not found');
                      }
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
                              date: orderDate,
                              etv: etv
                          };
                      } else {
                          const alternativeAsinElement = order.querySelector(".vvp-orders-table--text-col");
                          if (alternativeAsinElement) {
                              const alternativeAsin = alternativeAsinElement.textContent.trim().split(" ")[0];
                              data[alternativeAsin] = {
                                  name: productName,
                                  ordernumber: orderNumber,
                                  date: orderDate,
                                  etv: etv
                              };
                          }
                      }
                  });

                  return data;
              }

              async function extractData(json) {
                  const data = {};
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
                              date: orderDate,
                              etv: etv
                          };
                      }
                  }

                  return data;
              }

              function saveData(data) {
                  for (const asin in data) {
                      const key = `ASIN_${asin}`;
                      setValue(key, JSON.stringify(data[asin]));
                  }
              }

              async function loadXLSXInfo() {
                  userlog("starting xlsx export");
                  try {
                      const yearElement = document.querySelector('select#vvp-tax-year-dropdown option:checked');
                      const year = yearElement.value.trim();
                      userlog("found year to be " + year);
                      const blobData = await fetchData(year);
                      await parseExcel(blobData);

                      const status = document.getElementById('status');
                      status.textContent = `Extraction successful. Data is stored locally.`;
                  } catch (error) {
                      console.error('Error loading XLSX info:', error);
                      const status = document.getElementById('status');
                      status.textContent = 'Error loading XLSX info';
                  }
              }

              async function loadOrdersInfo() {
                  userlog("Starting order info extraction");

                  try {
                      const jsonData = parseOrdersTable();
                      saveData(jsonData);

                      const status = document.getElementById('status');
                      status.textContent = `Extraction successful. Number of items: ${Object.keys(jsonData).length}`;
                  } catch (error) {
                      console.error('Error loading order info:', error);
                      const status = document.getElementById('status');
                      status.textContent = 'Error loading order info';
                  }
              }

  function createUIorderpage() {
      const container = document.querySelector('.a-normal.vvp-orders-table');

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
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                onload: (response) => resolve(new Uint8Array(response.response)),
                onerror: (err) => reject(err),
            });
        });
    }

    function loadScript(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
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
                    reject("Network error: " + error);
                }
            });
        });
    }


  async function createPDF() {
      const pdfLib = await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');

      // Now you can use pdfLib
      const { PDFDocument, rgb, StandardFonts } = pdfLib;

    let asinData = await load_all_asin_etv_values_from_storage(false);

    const settings = await getValue("settings", {
        cancellations: false,
        tax0: false,
        yearFilter: "show all years"
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
    asinData = filteredData.slice(0, 15); // Modify as needed to control behavior

        // Create a new PDF document
        const newPdf = await PDFDocument.create();

        // Add a placeholder page
        const placeholderPage = newPdf.addPage([600, 400]);
        placeholderPage.drawText('Placeholder Page', { x: 50, y: 350, size: 20 });


        // Fetch and merge PDFs
        window.progressBar.show()
        window.progressBar.setText("downloading pdfs...")
        window.progressBar.setFillWidth(0)
        for (const item of asinData) {
            try {
                const pdfBytes = await fetchPDF(item.pdf);
                const externalPdf = await PDFDocument.load(pdfBytes);
                const externalPages = await newPdf.copyPages(externalPdf, externalPdf.getPageIndices());
                externalPages.forEach((page) => newPdf.addPage(page));
                window.progressBar.setText("downloading pdfs... ${asinData.indexOf(item) + 1} / ${asinData.length}")
                window.progressBar.setFillWidth(asinData.indexOf(item) / asinData.length * 100)
            } catch (err) {
                console.error(`Failed to fetch or merge PDF from ${item.pdf}:`, err);
            }
        }
        
        // Serialize and download the merged PDF
        const finalPdfBytes = await newPdf.save();
        const blob = new Blob([finalPdfBytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'merged-document.pdf';
        window.progressBar.hide()
        link.click();

  }

  async function showAllData() {
      const dataTableDiv = document.getElementById('data-table');
      dataTableDiv.innerHTML = '<p>Loading data...</p>';

      try {
          let asinData = await load_all_asin_etv_values_from_storage(false);

        const settings = await getValue("settings", {
            cancellations: false,
            tax0: false,
            yearFilter: "show all years"
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
              table += `<tr>
                          <td>${item.ASIN}</td>
                          <td>${item.date || 'N/A'}</td>
                          <td>${item.name || 'N/A'}</td>
                          <td>${item.etv}</td>
                          <td>${item.keepa != null ? `<a href="https://keepa.com/#!product/3-${item.ASIN}" target="_blank">${item.keepa}</a>` : 'N/A'}</td>
                          <td data-order="${item.teilwert != null ? item.teilwert : 0}">${item.teilwert != null ? item.teilwert : 'N/A'}</td>
                          <td>${item.pdf ? `<a href="${item.pdf}" target="_blank">PDF Link</a>` : 'N/A'}</td>
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

              if (currentPageURL === "https://www.amazon.de/vine/account") {
                  window.addEventListener('load', async function() {
                    createUI_taxextractor();
                    });
              } else if (currentPageURL.includes("https://www.amazon.de/vine/orders")) {
                window.addEventListener('load', function() {
                  createUIorderpage();
                });
              }
      }
  )();
