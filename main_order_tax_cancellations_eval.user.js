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
              console.log(`Stored ${key}: ${value}`);
            }
  
            async function getValue(key, defaultValue = null) {
              const result = await db.keyValuePairs.get(key);
              return result ? result.value : defaultValue;
            }
  
            async function listValues() {
              try {
                return (await db.keyValuePairs.toCollection().primaryKeys())
                const allItems = await db.keyValuePairs.toArray();
                return allItems.map(pair => pair.key);
              } catch (error) {
                console.error("Error listing values:", error);
                return [];
              }
            }
  
              async function deleteValue(key) {
              try {
                await db.keyValuePairs.delete(key);
                console.log(`Deleted ${key}`);
              } catch (error) {
                console.error(`Error deleting ${key}:`, error);
              }
            }
  
              function etvstrtofloat(etvString) {
                  const cleanString = etvString.replace(/[€ ]/g, '');
                  const cleanedValue = cleanString.replace(/[.,](?=\d{3})/g, '');
                  const etv = parseFloat(cleanedValue.replace(',', '.'));
                  return etv;
              }
  
              async function load_all_asin_etv_values_from_storage() {
                  let keys = await listValues();
                  let asinKeys = keys.filter(key => key.startsWith("ASIN_"));
                  console.log(asinKeys.length)
  
                  let asinData = [];
                  let tempDataToSend = [];
  
                  for (let asinKey of asinKeys) {
                      let asin = asinKey.replace("ASIN_", "");
                      let jsonData = await getValue(asinKey);
  
                      let parsedData = jsonData ? JSON.parse(jsonData) : {};
                      let [day, month, year] = parsedData.date.replace(/\//g, '.').split('.');
                      let jsDate = new Date(`${year}-${month}-${day}`);
                      console.log(day, month, year, asin, jsDate, parsedData.date);
                      try {
                          parsedData.date = jsDate.toISOString();
                      } catch (error) {
                          parsedData.date = "xxx";
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
                                              const asinKey = `ASIN_${existingAsin.asin}`;
                                               await setValue(asinKey, JSON.stringify({
                                                  ...JSON.parse(await getValue(asinKey) || '{}') ,
                                                  keepa: existingAsin.keepa,
                                                  teilwert: existingAsin.teilwert,
                                                  pdf: existingAsin.pdf
                                                  }));
                                                 console.log(`Updated local DB for ASIN: ${existingAsin.asin} with data:`, existingAsin);
                                              }
                                          }
                                      }
                                  catch(e){
                                    console.log(e);
                                  }
  
                              } else {
                                  console.error("Failed to send data to the server:", response.statusText);
                              }
                          },
                      onerror: function(error) {
                          console.error("Error sending data to the server:", error);
                      }
                  });
  
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
  
              function createUI_taxextractor() {
                  const container = document.querySelector('#vvp-tax-information-responsive-container');
  
                  const div = document.createElement('div');
                  div.innerHTML = `
          <div id="vine-data-extractor" style="margin-top: 20px;">
              <button id="load-xlsx-info" class="">Load XLSX Info</button>
              <div id="status" style="margin-top: 10px;">nothing loaded yet</div>
          </div>
      `;
                  container.appendChild(div);
  
                  setTimeout(async () => {
                      document.getElementById('load-xlsx-info').addEventListener('click', loadXLSXInfo);
                      const list = await load_all_asin_etv_values_from_storage();
                      userlog(`nothing loaded yet. ${list.length} items in database`);
  
                      createPieChart(list);
                      createETVplots(list);
                      createCancellationRatioTable(list);
  
                  }, 200);
              }
  
  async function createETVplots(list) {
      const sortedItems = list.map(item => ({
          ...item,
          date: new Date(item.date)
      })).sort((a, b) => a.date - b.date);
  
      const taxYears = new Set();
  
      sortedItems.forEach(item => {
          const sixMonthsLater = new Date(item.date);
          sixMonthsLater.setMonth(item.date.getMonth());
          const taxYear = sixMonthsLater.getFullYear();
          taxYears.add(taxYear);
      });
  
      const sortedTaxYears = Array.from(taxYears).sort((a, b) => a - b);
      const last5TaxYears = sortedTaxYears.slice(-5);
  
      last5TaxYears.forEach(year => {
          const { start, end } = getTaxYearRange(year);
          const filteredItems = sortedItems.filter(item => {
              return item.date.getFullYear() == year;
          });
        console.log("now createing plot for", year);
        createETVPlot(year, filteredItems, end);
      });
  }
  
  function getTaxYearRange(year) {
      return {
          start: new Date(year, 0, 0),
          end: new Date(year, 11, 30)
      };
  }
  
  async function createETVPlot(taxYear, items, endDate) {
      const width = 600, height = 400;
      const dataByDateMap = new Map();
      let currentEtv = 0;
      items.forEach(d => {
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
  
      const layout = {
          title: `Tax Year ${taxYear}`,
          xaxis: {
              title: 'Date',
              tickformat: '%b %d',
              range: [new Date(taxYear, 1, 1), endDate],
              tickangle: -45
          },
          yaxis: {
              title: 'ETV',
              autorange: true
          },
          margin: {
              t: 40,
              r: 30,
              b: 80,
              l: 60
          },
        width: "30%",
        height: "30%"
      };
  
      const containerId = `plot-container-${taxYear}`;
      const newDiv = document.createElement('div');
      newDiv.id = containerId;
      newDiv.className = 'plot-container';
      document.getElementById('vvp-tax-information-container').appendChild(newDiv);
  
      Plotly.newPlot(containerId, data, layout);
  }
  
  function createPieChart(list) {
          const priceCounts = list.reduce((acc, item) => {
              if (item.etv === 0) {
                  acc.zero += 1;
              } else {
                  acc.nonZero += 1;
              }
              return acc;
          }, { zero: 0, nonZero: 0 });
  
          const data = [
              { category: 'tax0', count: priceCounts.zero },
              { category: 'TAX', count: priceCounts.nonZero }
          ];
  
          const width = 400, height = 400, margin = 40;
          const radius = Math.min(width, height) / 2 - margin;
  
          const svg = d3.select('#vvp-tax-information-container').append('svg')
              .attr('width', width)
              .attr('height', height)
              .append('g')
              .attr('transform', `translate(${width / 2}, ${height / 2})`);
  
          const pie = d3.pie().value(d => d.count);
          const arc = d3.arc().outerRadius(radius).innerRadius(0);
  
          const color = d3.scaleOrdinal()
              .domain(data.map(d => d.category))
              .range(['#ff9999', '#66b3ff']);
  
          svg.selectAll('slice')
              .data(pie(data))
              .enter().append('path')
              .attr('d', arc)
              .attr('fill', d => color(d.data.category))
              .attr('stroke', 'white')
              .style('stroke-width', '2px');
  
          svg.selectAll('label')
              .data(pie(data))
              .enter().append('text')
              .attr('transform', d => `translate(${arc.centroid(d)})`)
              .attr('dy', '0.35em')
              .style('text-anchor', 'middle')
              .text(d => `${d.data.category}: ${d.data.count}`);
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
                        const orderDate2 = orderElement.innerHTML.trim();
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
                          }
                      }
  
                      if (!data[asin]) {
                          data[asin] = {
                              name: name,
                              ordernumber: orderNumber,
                              date: orderDate,
                              etv: etv
                          };
                      } else {
                          data[asin].etv += etv;
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
  
  async function showAllData() {
      const dataTableDiv = document.getElementById('data-table');
      dataTableDiv.innerHTML = '<p>Loading data...</p>';
  
      try {
          const asinData = await load_all_asin_etv_values_from_storage();
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
                          <td>${item.etv || 'N/A'}</td>
                          <td>${item.keepa != null ? item.keepa : 'N/A'}</td>
                          <td>${item.teilwert != null ? item.teilwert : 'N/A'}</td>
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
               });
            });
  
      } catch (error) {
          dataTableDiv.innerHTML = `<p>Error loading data: ${error.message}</p>`;
      }
  }
  
  async function createCancellationRatioTable(list) {
      const yearlyData = {};
      const cancelledAsins = await getValue("cancellations", []);
  console.log(cancelledAsins);
      list.forEach(item => {
  
          const year = item.date.slice(0, 4);
  
          if (year==="xxx"){
            console.log(item);
          }
  
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
  
      const container = d3.select('#vvp-tax-information-container');
      container.select('table').remove();
  
      const table = container.append('table').attr('class', 'cancellation-ratio-table');
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
  
      container.append('div').html(tableStyles);
  
  }
  
              function userlog(txt) {
                  console.log(txt);
                  document.getElementById('status').textContent = txt;
              }
  
              var currentPageURL = window.location.href;
  
              if (currentPageURL === "https://www.amazon.de/vine/account") {
                  window.addEventListener('load', function() {
                    createUI_taxextractor();
                    });
              } else if (currentPageURL.includes("https://www.amazon.de/vine/orders")) {
                window.addEventListener('load', function() {
                  createUIorderpage();
                });
              }
      }
  )();