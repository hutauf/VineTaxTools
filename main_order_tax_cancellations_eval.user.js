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
// @version     1.114100
// @author      -
// @description Vine-Steuerdaten lokal verwalten, synchronisieren und auswerten
// ==/UserScript==

GM_addStyle(`
    @import url('https://cdn.datatables.net/1.11.5/css/jquery.dataTables.min.css');

    #vine-data-extractor.vtt-shell {
      --vtt-navy: #172554;
      --vtt-blue: #2563eb;
      --vtt-blue-dark: #1d4ed8;
      --vtt-blue-soft: #eff6ff;
      --vtt-border: #dbe4f0;
      --vtt-muted: #64748b;
      --vtt-surface: #ffffff;
      --vtt-page: #f8fafc;
      --vtt-success: #047857;
      --vtt-success-soft: #ecfdf5;
      --vtt-warning: #b45309;
      --vtt-warning-soft: #fffbeb;
      --vtt-danger: #b42318;
      --vtt-danger-soft: #fff1f2;
      box-sizing: border-box;
      margin: 14px 0 24px;
      border: 1px solid #bfd3ed;
      border-radius: 16px;
      overflow: hidden;
      color: #172033;
      background: var(--vtt-surface);
      box-shadow: 0 10px 30px rgba(30, 64, 175, 0.10);
      font-family: Arial, sans-serif;
    }

    #vine-data-extractor *,
    #vine-data-extractor *::before,
    #vine-data-extractor *::after,
    .vtt-dialog,
    .vtt-dialog *,
    .vtt-dialog *::before,
    .vtt-dialog *::after {
      box-sizing: border-box;
    }

    #vine-data-extractor .vtt-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 20px 22px;
      color: #ffffff;
      background:
        radial-gradient(circle at top right, rgba(255, 255, 255, 0.18), transparent 42%),
        linear-gradient(135deg, #172554 0%, #1d4ed8 100%);
    }

    #vine-data-extractor .vtt-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    #vine-data-extractor .vtt-brand-mark {
      display: grid;
      flex: 0 0 42px;
      width: 42px;
      height: 42px;
      place-items: center;
      border: 1px solid rgba(255, 255, 255, 0.34);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.14);
      font-weight: 800;
      letter-spacing: -1px;
    }

    #vine-data-extractor .vtt-title {
      margin: 0;
      color: #ffffff;
      font-size: 20px;
      line-height: 1.2;
    }

    #vine-data-extractor .vtt-subtitle {
      margin: 4px 0 0;
      color: #dbeafe;
      font-size: 12px;
      line-height: 1.45;
    }

    #vine-data-extractor .vtt-header-actions,
    #vine-data-extractor .vtt-action-row,
    #vine-data-extractor .vtt-button-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    #vine-data-extractor .vtt-btn,
    #vine-data-extractor button.vtt-btn,
    .vtt-dialog .vtt-btn,
    .vtt-dialog button.vtt-btn {
      min-height: 36px;
      margin: 0;
      border: 1px solid #cbd5e1;
      border-radius: 9px;
      padding: 7px 12px;
      color: #1e293b;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      font: inherit;
      font-size: 13px;
      font-weight: 650;
      line-height: 1.2;
      cursor: pointer;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }

    #vine-data-extractor .vtt-btn:hover,
    #vine-data-extractor .vtt-btn:focus-visible,
    .vtt-dialog .vtt-btn:hover,
    .vtt-dialog .vtt-btn:focus-visible {
      border-color: #7aa7e8;
      background: #f8fbff;
    }

    #vine-data-extractor .vtt-btn:active,
    .vtt-dialog .vtt-btn:active {
      transform: translateY(1px);
    }

    #vine-data-extractor .vtt-btn:disabled,
    .vtt-dialog .vtt-btn:disabled {
      opacity: .5;
      cursor: not-allowed;
      transform: none;
    }

    #vine-data-extractor .vtt-btn:focus-visible,
    #vine-data-extractor input:focus-visible,
    #vine-data-extractor select:focus-visible,
    #vine-data-extractor summary:focus-visible,
    .vtt-dialog .vtt-btn:focus-visible,
    .vtt-dialog select:focus-visible,
    .vtt-dialog input:focus-visible {
      outline: 3px solid rgba(37, 99, 235, 0.28);
      outline-offset: 2px;
    }

    #vine-data-extractor .vtt-btn-primary,
    .vtt-dialog .vtt-btn-primary {
      border-color: var(--vtt-blue);
      color: #ffffff;
      background: var(--vtt-blue);
    }

    #vine-data-extractor .vtt-btn-primary:hover,
    #vine-data-extractor .vtt-btn-primary:focus-visible,
    .vtt-dialog .vtt-btn-primary:hover,
    .vtt-dialog .vtt-btn-primary:focus-visible {
      border-color: var(--vtt-blue-dark);
      color: #ffffff;
      background: var(--vtt-blue-dark);
    }

    #vine-data-extractor .vtt-btn-danger,
    .vtt-dialog .vtt-btn-danger {
      border-color: #fecaca;
      color: var(--vtt-danger);
      background: #ffffff;
    }

    #vine-data-extractor .vtt-btn-danger:hover,
    #vine-data-extractor .vtt-btn-danger:focus-visible,
    .vtt-dialog .vtt-btn-danger:hover,
    .vtt-dialog .vtt-btn-danger:focus-visible {
      border-color: #fda4af;
      background: var(--vtt-danger-soft);
    }

    #vine-data-extractor .vtt-header .vtt-btn {
      border-color: rgba(255, 255, 255, 0.42);
      color: #ffffff;
      background: rgba(255, 255, 255, 0.12);
      box-shadow: none;
    }

    #vine-data-extractor .vtt-header .vtt-btn:hover,
    #vine-data-extractor .vtt-header .vtt-btn:focus-visible {
      border-color: rgba(255, 255, 255, 0.75);
      background: rgba(255, 255, 255, 0.22);
    }

    #vine-data-extractor .vtt-body {
      display: grid;
      gap: 14px;
      padding: 18px 20px 22px;
      background: var(--vtt-page);
    }

    #vine-data-extractor .vtt-status-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    #vine-data-extractor .vtt-status-card {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      border: 1px solid var(--vtt-border);
      border-radius: 11px;
      padding: 11px 13px;
      color: inherit;
      background: #ffffff;
      text-align: left;
    }

    #vine-data-extractor button.vtt-status-card {
      width: 100%;
      font: inherit;
      cursor: pointer;
    }

    #vine-data-extractor button.vtt-status-card:hover,
    #vine-data-extractor button.vtt-status-card:focus-visible {
      border-color: #93b4e5;
      background: #f8fbff;
    }

    #vine-data-extractor .vtt-status-icon {
      display: grid;
      flex: 0 0 34px;
      width: 34px;
      height: 34px;
      place-items: center;
      border-radius: 10px;
      color: var(--vtt-blue-dark);
      background: var(--vtt-blue-soft);
      font-weight: 800;
    }

    #vine-data-extractor .vtt-status-copy {
      min-width: 0;
    }

    #vine-data-extractor .vtt-status-label {
      display: block;
      margin-bottom: 2px;
      color: var(--vtt-muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    #vine-data-extractor .vtt-status-value {
      display: block;
      overflow: hidden;
      color: #1e293b;
      font-size: 13px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #vine-data-extractor .vtt-status-detail {
      display: block;
      margin-top: 2px;
      color: var(--vtt-muted);
      font-size: 11px;
      line-height: 1.35;
    }

    #vine-data-extractor .vtt-dot,
    .vtt-dialog .vtt-dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      margin-right: 5px;
      border-radius: 999px;
      background: #94a3b8;
      box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.16);
    }

    #vine-data-extractor [data-backend-state="configured"] .vtt-dot,
    .vtt-dialog [data-backend-state="configured"] .vtt-dot {
      background: var(--vtt-success);
      box-shadow: 0 0 0 3px rgba(4, 120, 87, 0.14);
    }

    #vine-data-extractor [data-backend-state="local-only"] .vtt-dot,
    .vtt-dialog [data-backend-state="local-only"] .vtt-dot {
      background: #d97706;
      box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.14);
    }

    #vine-data-extractor [data-backend-state="invalid"] .vtt-dot,
    .vtt-dialog [data-backend-state="invalid"] .vtt-dot {
      background: var(--vtt-danger);
      box-shadow: 0 0 0 3px rgba(180, 35, 24, 0.14);
    }

    #vine-data-extractor .vtt-panel {
      border: 1px solid var(--vtt-border);
      border-radius: 12px;
      padding: 14px;
      background: #ffffff;
    }

    #vine-data-extractor .vtt-panel-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 12px;
    }

    #vine-data-extractor .vtt-panel-title,
    .vtt-dialog .vtt-section-title {
      margin: 0;
      color: var(--vtt-navy);
      font-size: 14px;
      line-height: 1.35;
    }

    #vine-data-extractor .vtt-panel-description,
    .vtt-dialog .vtt-help-text {
      margin: 3px 0 0;
      color: var(--vtt-muted);
      font-size: 12px;
      line-height: 1.45;
    }

    #vine-data-extractor .vtt-import-grid {
      display: grid;
      grid-template-columns: minmax(110px, 170px) minmax(180px, auto) 1fr;
      gap: 10px;
      align-items: end;
    }

    #vine-data-extractor .vtt-field,
    .vtt-dialog .vtt-field {
      display: grid;
      gap: 5px;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
    }

    #vine-data-extractor .vtt-field > select,
    #vine-data-extractor .vtt-field > input[type="text"],
    #vine-data-extractor .vtt-field > input[type="password"],
    .vtt-dialog select,
    .vtt-dialog input[type="text"],
    .vtt-dialog input[type="password"] {
      width: 100%;
      min-height: 36px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 7px 9px;
      color: #172033;
      background: #ffffff;
      font: inherit;
      font-size: 13px;
    }

    #vine-data-extractor .vtt-info-wrap {
      position: relative;
      display: inline-flex;
      vertical-align: middle;
    }

    #vine-data-extractor .vtt-info {
      display: inline-grid;
      width: 19px;
      height: 19px;
      margin: 0 2px;
      place-items: center;
      border: 1px solid #9db7da;
      border-radius: 999px;
      padding: 0;
      color: #315d99;
      background: #ffffff;
      font-size: 11px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
    }

    #vine-data-extractor .vtt-info-popover {
      position: absolute;
      z-index: 40;
      right: -8px;
      bottom: calc(100% + 8px);
      width: min(290px, 75vw);
      border-radius: 8px;
      padding: 9px 10px;
      color: #ffffff;
      background: #172554;
      box-shadow: 0 7px 22px rgba(15, 23, 42, .24);
      font-size: 11px;
      font-weight: 500;
      line-height: 1.45;
      opacity: 0;
      pointer-events: none;
      transform: translateY(4px);
      transition: opacity 120ms ease, transform 120ms ease;
    }

    #vine-data-extractor .vtt-info-popover:not([hidden]) {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }

    #vine-data-extractor .vtt-callout,
    .vtt-dialog .vtt-callout {
      border: 1px solid #bfdbfe;
      border-left: 4px solid var(--vtt-blue);
      border-radius: 9px;
      padding: 10px 12px;
      color: #1e3a5f;
      background: var(--vtt-blue-soft);
      font-size: 12px;
      line-height: 1.5;
    }

    #vine-data-extractor .vtt-callout-warning,
    .vtt-dialog .vtt-callout-warning {
      border-color: #fde68a;
      border-left-color: #d97706;
      color: #78350f;
      background: var(--vtt-warning-soft);
    }

    #vine-data-extractor .vtt-callout[hidden],
    .vtt-dialog [hidden] {
      display: none !important;
    }

    #vine-data-extractor #status:empty,
    #vine-data-extractor #backendStatus:empty {
      display: none;
    }

    #vine-data-extractor #status,
    .vtt-dialog #backendStatus {
      border-radius: 8px;
      padding: 9px 11px;
      background: #f8fafc;
      font-size: 12px;
      line-height: 1.4;
    }

    #vine-data-extractor #simpleProgressBarContainer {
      width: 100% !important;
      max-width: none !important;
      min-height: 38px !important;
      margin: 0 !important;
      border-color: #a8c4e8 !important;
      border-radius: 10px !important;
      background: #eaf2fc !important;
    }

    #vine-data-extractor #simpleProgressText {
      padding: 9px 12px !important;
      font-size: 12px !important;
    }

    #vine-data-extractor #simpleProgressBarContainer[data-state="success"] {
      border-color: #6ee7b7 !important;
      background: #ecfdf5 !important;
    }

    #vine-data-extractor #simpleProgressBarContainer[data-state="success"] #simpleProgressBarFill {
      background: #a7f3d0 !important;
    }

    #vine-data-extractor #simpleProgressBarContainer[data-state="success"] #simpleProgressText {
      color: #065f46 !important;
    }

    #vine-data-extractor #simpleProgressBarContainer[data-state="error"] {
      border-color: #fda4af !important;
      background: #fff1f2 !important;
    }

    #vine-data-extractor #simpleProgressBarContainer[data-state="error"] #simpleProgressBarFill {
      background: #fecdd3 !important;
    }

    #vine-data-extractor #simpleProgressBarContainer[data-state="error"] #simpleProgressText {
      color: #9f1239 !important;
    }

    #vine-data-extractor #simpleProgressBarContainer[data-state="pending"] {
      border-color: #f59e0b !important;
      background: #fffbeb !important;
    }

    #vine-data-extractor #simpleProgressBarContainer[data-state="pending"] #simpleProgressBarFill {
      background: #fde68a !important;
    }

    #vine-data-extractor #simpleProgressBarContainer[data-state="pending"] #simpleProgressText {
      color: #92400e !important;
    }

    #vine-data-extractor .vtt-disclosure {
      overflow: hidden;
      border: 1px solid var(--vtt-border);
      border-radius: 12px;
      background: #ffffff;
    }

    #vine-data-extractor .vtt-disclosure + .vtt-disclosure {
      margin-top: 10px;
    }

    #vine-data-extractor .vtt-disclosure > summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 46px;
      padding: 12px 14px;
      color: var(--vtt-navy);
      background: #ffffff;
      font-size: 13px;
      font-weight: 750;
      list-style: none;
      cursor: pointer;
      user-select: none;
    }

    #vine-data-extractor .vtt-disclosure > summary::-webkit-details-marker {
      display: none;
    }

    #vine-data-extractor .vtt-disclosure > summary::after {
      flex: 0 0 auto;
      content: "›";
      color: #5b7da9;
      font-size: 22px;
      font-weight: 500;
      transform: rotate(90deg);
      transition: transform 150ms ease;
    }

    #vine-data-extractor .vtt-disclosure[open] > summary::after {
      transform: rotate(270deg);
    }

    #vine-data-extractor .vtt-disclosure[open] > summary {
      border-bottom: 1px solid var(--vtt-border);
      background: #f8fbff;
    }

    #vine-data-extractor .vtt-disclosure-body {
      padding: 14px;
    }

    #vine-data-extractor .vtt-year-card {
      border-color: #bfd3ed;
    }

    #vine-data-extractor .vtt-year-card > summary {
      font-size: 15px;
    }

    #vine-data-extractor .vtt-summary-meta {
      margin-left: auto;
      color: var(--vtt-muted);
      font-size: 11px;
      font-weight: 600;
    }

    #vine-data-extractor .vtt-analysis-section {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #ffffff;
    }

    #vine-data-extractor .vtt-analysis-section + .vtt-analysis-section {
      margin-top: 8px;
    }

    #vine-data-extractor .vtt-analysis-section > summary {
      min-height: 42px;
      padding: 10px 12px;
    }

    #vine-data-extractor .vtt-chart-content {
      min-width: 0;
      overflow-x: auto;
      padding: 12px;
    }

    #vine-data-extractor .vtt-chart-content svg {
      max-width: 100%;
      height: auto;
    }

    #vine-data-extractor .vtt-empty-state {
      border: 1px dashed #cbd5e1;
      border-radius: 9px;
      padding: 18px;
      color: var(--vtt-muted);
      background: #f8fafc;
      text-align: center;
      font-size: 12px;
    }

    #vine-data-extractor .vtt-filter-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }

    #vine-data-extractor .vtt-filter-chip {
      display: inline-flex;
      align-items: center;
      min-height: 25px;
      border: 1px solid #c9dcf5;
      border-radius: 999px;
      padding: 4px 9px;
      color: #244f85;
      background: #eff6ff;
      font-size: 11px;
      font-weight: 650;
    }

    #vine-data-extractor .vtt-filter-count {
      flex-basis: 100%;
      margin: 3px 0 0;
      color: var(--vtt-muted);
      font-size: 11px;
    }

    #vine-data-extractor #data-table {
      min-width: 0;
      overflow-x: auto;
    }

    #vine-data-extractor .vtt-table-link {
      border: 0;
      padding: 2px 0;
      color: #1d4ed8;
      background: transparent;
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }

    #vine-data-extractor table {
      width: 100%;
      border-collapse: collapse;
    }

    #vine-data-extractor .teilwert-summary-table,
    #vine-data-extractor .euer-summary-table {
      width: 100% !important;
    }

    #vine-data-extractor .teilwert-summary-table th,
    #vine-data-extractor .teilwert-summary-table td,
    #vine-data-extractor .euer-summary-table th,
    #vine-data-extractor .euer-summary-table td,
    #vine-data-extractor .cancellation-ratio-table th,
    #vine-data-extractor .cancellation-ratio-table td {
      border-color: #dbe4f0 !important;
    }

    #vine-data-extractor .teilwert-summary-table th,
    #vine-data-extractor .euer-summary-table th,
    #vine-data-extractor .cancellation-ratio-table th {
      color: #334155;
      background: #eff6ff !important;
    }

    .vtt-dialog {
      --vtt-navy: #172554;
      --vtt-blue: #2563eb;
      --vtt-blue-dark: #1d4ed8;
      --vtt-blue-soft: #eff6ff;
      --vtt-border: #dbe4f0;
      --vtt-muted: #64748b;
      --vtt-success: #047857;
      --vtt-success-soft: #ecfdf5;
      --vtt-warning-soft: #fffbeb;
      --vtt-danger: #b42318;
      --vtt-danger-soft: #fff1f2;
      width: min(680px, calc(100vw - 28px));
      max-height: min(82vh, 760px);
      margin: auto;
      border: 0;
      border-radius: 15px;
      padding: 0;
      color: #172033;
      background: #ffffff;
      box-shadow: 0 24px 80px rgba(15, 23, 42, .35);
      font-family: Arial, sans-serif;
    }

    .vtt-dialog::backdrop {
      background: rgba(15, 23, 42, .58);
      backdrop-filter: blur(2px);
    }

    .vtt-dialog-backdrop {
      position: fixed;
      z-index: 2147483645;
      inset: 0;
      background: rgba(15, 23, 42, .58);
      backdrop-filter: blur(2px);
    }

    .vtt-dialog.vtt-dialog-fallback[open] {
      position: fixed;
      z-index: 2147483646;
      inset: 50% auto auto 50%;
      transform: translate(-50%, -50%);
    }

    .vtt-dialog[open] {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }

    .vtt-dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid #e2e8f0;
      padding: 16px 18px;
    }

    .vtt-dialog-title {
      margin: 0;
      color: #172554;
      font-size: 18px;
    }

    .vtt-dialog-subtitle {
      margin: 4px 0 0;
      color: #64748b;
      font-size: 12px;
      line-height: 1.45;
    }

    .vtt-dialog-close {
      display: grid;
      flex: 0 0 34px;
      width: 34px;
      height: 34px;
      place-items: center;
      border: 1px solid #d8e0eb;
      border-radius: 9px;
      color: #475569;
      background: #ffffff;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }

    .vtt-dialog-body {
      display: grid;
      gap: 14px;
      overflow-y: auto;
      padding: 17px 18px 20px;
    }

    .vtt-settings-list {
      display: grid;
      gap: 8px;
    }

    .vtt-setting-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      align-items: flex-start;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 11px;
      background: #ffffff;
    }

    .vtt-setting-row input[type="checkbox"] {
      width: 17px;
      height: 17px;
      margin: 2px 0 0;
      accent-color: #2563eb;
    }

    .vtt-setting-label {
      display: block;
      color: #1e293b;
      font-size: 13px;
      font-weight: 700;
    }

    .vtt-setting-description {
      display: block;
      margin-top: 3px;
      color: #64748b;
      font-size: 11px;
      line-height: 1.4;
    }

    .vtt-dialog-section {
      display: grid;
      gap: 9px;
    }

    .vtt-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .vtt-backend-state {
      display: flex;
      align-items: center;
      border: 1px solid #dbe4f0;
      border-radius: 10px;
      padding: 10px 11px;
      color: #334155;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 700;
    }

    .vtt-danger-zone {
      display: grid;
      gap: 9px;
      border: 1px solid #fecdd3;
      border-radius: 11px;
      padding: 12px;
      color: #881337;
      background: #fff7f8;
    }

    .vtt-danger-zone h4 {
      margin: 0;
      color: #9f1239;
      font-size: 13px;
    }

    .vtt-danger-zone p {
      margin: 0;
      font-size: 11px;
      line-height: 1.45;
    }

    .vtt-dialog a,
    #vine-data-extractor a {
      color: #1d4ed8;
    }

    @media (max-width: 720px) {
      #vine-data-extractor .vtt-header {
        align-items: stretch;
        flex-direction: column;
      }

      #vine-data-extractor .vtt-status-grid,
      #vine-data-extractor .vtt-import-grid,
      .vtt-dialog .vtt-form-grid {
        grid-template-columns: 1fr;
      }

      #vine-data-extractor .vtt-body {
        padding: 13px;
      }

      #vine-data-extractor .vtt-header-actions .vtt-btn {
        flex: 1 1 auto;
      }
    }
  `);


  (async function() {
      'use strict';

            const db = new Dexie('myDatabase');
            db.version(1).stores({
              keyValuePairs: 'key'
            });
            db.version(2).stores({
              keyValuePairs: 'key',
              products: '&[profileId+asin], profileId, asin, date, etv, recordRevision',
              profiles: '&id, backendUrl, tokenFingerprint, kind',
              shadows: '&[profileId+entityType+entityId], profileId, [profileId+entityType], recordRevision',
              outbox: '&mutationId, profileId, [profileId+status], [profileId+entityType+entityId], createdAt',
              syncState: '&profileId, mode, generationId, cursor',
              syncLocks: '&profileId, ownerId, expiresAt',
              conflicts: '&id, profileId, [profileId+status], [profileId+entityType+entityId], createdAt',
              migrationState: '&key'
            }).upgrade(async transaction => {
              const legacyTable = transaction.table('keyValuePairs');
              const productTable = transaction.table('products');
              const profileTable = transaction.table('profiles');
              const outboxTable = transaction.table('outbox');
              const migrationTable = transaction.table('migrationState');
              const legacyRecords = await legacyTable.toArray();
              const tokenRecord = legacyRecords.find(record => record.key === 'token');
              const backendRecord = legacyRecords.find(record => record.key === 'pythonanywherebackend');
              const token = typeof tokenRecord?.value === 'string' ? tokenRecord.value.trim() : '';
              const backendName = String(backendRecord?.value || 'hutaufvine').trim().toLowerCase();
              const profileId = buildLocalProfileId(token, backendName);
              const backendUrl = token && isValidBackendName(backendName)
                ? getPrivateBackendUrl(backendName)
                : null;
              await profileTable.put({
                id: profileId,
                kind: token ? 'private-backend' : 'local-only',
                backendUrl,
                backendName,
                tokenFingerprint: token ? getTokenProfileFingerprint(token) : null,
                createdAt: Date.now(),
                migratedFromLegacy: true
              });

              let migrated = 0;
              const quarantined = [];
              const legacyGroups = new Map();
              for (const record of legacyRecords) {
                if (typeof record?.key !== 'string' || !record.key.startsWith('ASIN_')) continue;
                const asin = normalizeAsin(record.key.slice(5));
                if (!asin) {
                  quarantined.push({ key: record.key, reason: 'invalid-asin', value: record.value });
                  continue;
                }
                try {
                  const data = parseStoredProductDate(record.value, `legacy product ${asin}`);
                  const variants = legacyGroups.get(asin) || [];
                  variants.push({
                    record,
                    data,
                    sourceAsin: record.key.slice(5),
                    timestamp: Number(data.last_update_time) || 0
                  });
                  legacyGroups.set(asin, variants);
                } catch (error) {
                  quarantined.push({
                    key: record.key,
                    reason: error instanceof Error ? error.message : String(error),
                    value: record.value
                  });
                }
              }
              for (const [asin, variants] of legacyGroups) {
                try {
                  variants.sort((left, right) => (
                    left.timestamp - right.timestamp
                    || Number(left.sourceAsin === asin) - Number(right.sourceAsin === asin)
                    || left.sourceAsin.localeCompare(right.sourceAsin)
                  ));
                  const data = variants.reduce((merged, variant) => (
                    Object.assign(merged, variant.data)
                  ), {});
                  await productTable.put(createProductRow(profileId, asin, data, 0));
                  if (token) {
                   await outboxTable.put(createOutboxMutation({
                      profileId,
                      entityType: 'product',
                      entityId: asin,
                      baseRevision: 0,
                      set: data,
                      unset: [],
                      source: 'legacy-migration',
                      legacyTimestamp: Number.isSafeInteger(Number(data.last_update_time))
                        ? Number(data.last_update_time)
                        : 0
                    }));
                  }
                  for (const variant of variants) await legacyTable.delete(variant.record.key);
                  migrated++;
                } catch (error) {
                  quarantined.push({
                    key: variants.map(variant => variant.record.key).join(','),
                    reason: error instanceof Error ? error.message : String(error),
                    value: variants.map(variant => variant.record.value)
                  });
                }
              }
              await migrationTable.put({
                key: 'legacy-products-v2',
                completedAt: Date.now(),
                profileId,
                migrated,
                quarantined
              });
            });

            const VINE_PRODUCT_MANAGER_URL = 'https://hutauf.github.io/vine-produkt-manager/';
            const DEFAULT_SETTINGS = Object.freeze({
              cancellations: false,
              tax0: false,
              yearFilter: "show all years",
              streuartikelregelung: true,
              streuartikelregelungTeilwert: true,
              add2ndhalf2023to2024: true,
              einnahmezumteilwert: true,
              useTeilwertV2: false
            });
            const LEGACY_PARTIAL_SETTINGS_DEFAULTS = Object.freeze({
              cancellations: false,
              tax0: false,
              yearFilter: "show all years",
              streuartikelregelung: false,
              streuartikelregelungTeilwert: false,
              add2ndhalf2023to2024: false,
              einnahmezumteilwert: false,
              useTeilwertV2: false
            });
            let settingsWriteQueue = Promise.resolve();
            let dashboardRefreshQueue = Promise.resolve();
            let dashboardRefreshRevision = 0;
            let dashboardStatusRevision = 0;
            let analysisRenderRevision = 0;
            let tableRenderRevision = 0;
            let backendUiBusy = false;
            const productUpdateQueues = new Map();
            let progressBarController = null;

            function normalizeSettings(value) {
              const hasStoredSettings = Boolean(
                value
                && typeof value === 'object'
                && !Array.isArray(value)
              );
              return {
                ...(hasStoredSettings ? LEGACY_PARTIAL_SETTINGS_DEFAULTS : DEFAULT_SETTINGS),
                ...(hasStoredSettings ? value : {})
              };
            }

            async function getSettings() {
              return normalizeSettings(await getValue("settings", null));
            }

            function getUtf8ByteLength(value) {
              let bytes = 0;
              for (const character of String(value ?? '')) {
                const codePoint = character.codePointAt(0);
                if (codePoint <= 0x7f) bytes += 1;
                else if (codePoint <= 0x7ff) bytes += 2;
                else if (codePoint <= 0xffff) bytes += 3;
                else bytes += 4;
              }
              return bytes;
            }

            function formatByteSize(bytes) {
              const safeBytes = Math.max(0, Number(bytes) || 0);
              if (safeBytes < 1024) return `${Math.round(safeBytes)} B`;
              if (safeBytes < 1024 ** 2) return `${(safeBytes / 1024).toFixed(safeBytes < 10 * 1024 ? 1 : 0)} KB`;
              return `${(safeBytes / (1024 ** 2)).toFixed(safeBytes < 10 * 1024 ** 2 ? 2 : 1)} MB`;
            }

            async function getLocalProductDatabaseStats() {
              const profileId = await getActiveProfileId();
              const productRecords = await db.products.where('profileId').equals(profileId).toArray();
              const bytes = productRecords.reduce(
                (sum, record) => sum
                  + getUtf8ByteLength(`ASIN_${record.asin}`)
                  + getUtf8ByteLength(JSON.stringify(record.data)),
                0
              );
              return {
                productCount: productRecords.length,
                bytes,
                formattedSize: formatByteSize(bytes)
              };
            }

            function getBackendUiModel(token, backendName) {
              const hasToken = typeof token === 'string' && token.trim().length > 0;
              const normalizedBackendName = String(backendName || 'hutaufvine').trim().toLowerCase();
              if (hasToken && !isValidBackendName(normalizedBackendName)) {
                return {
                  state: 'invalid',
                  configured: false,
                  backendName: normalizedBackendName,
                  title: 'Konfiguration prüfen',
                  detail: 'Ein Token ist vorhanden, aber der Backendname ist ungültig.'
                };
              }
              if (hasToken) {
                return {
                  state: 'configured',
                  configured: true,
                  backendName: normalizedBackendName,
                  title: 'Privates Backend eingerichtet',
                  detail: `Automatische Datensynchronisation über ${normalizedBackendName}.`
                };
              }
              return {
                state: 'local-only',
                configured: false,
                backendName: normalizedBackendName,
                title: 'Nur lokal gespeichert',
                detail: 'Kein privates Backend-Token hinterlegt.'
              };
            }

            function getYearFilterLabel(settings) {
              if (settings.yearFilter === 'show current year') {
                return `Jahr: ${new Date().getFullYear()}`;
              }
              const onlyYear = /^only (\d{4})$/.exec(settings.yearFilter || '');
              if (onlyYear) {
                if (onlyYear[1] === '2024' && settings.add2ndhalf2023to2024) {
                  return 'Steuerjahr: 2024 inkl. 2. HJ 2023';
                }
                if (onlyYear[1] === '2023' && settings.add2ndhalf2023to2024) {
                  return 'Steuerjahr: 1. HJ 2023';
                }
                return `Jahr: ${onlyYear[1]}`;
              }
              return 'Jahr: alle';
            }

            function getTableFilterLabels(settingsValue) {
              const settings = normalizeSettings(settingsValue);
              return [
                getYearFilterLabel(settings),
                settings.cancellations ? 'Stornierungen: enthalten' : 'Stornierungen: ausgeblendet',
                settings.tax0 ? '0-€-ETV: enthalten' : '0-€-ETV: ausgeblendet',
                settings.useTeilwertV2 ? 'Teilwert: V2' : 'Teilwert: V1'
              ];
            }

            function getEvaluationRuleLabels(settingsValue) {
              const settings = normalizeSettings(settingsValue);
              return [
                settings.streuartikelregelung ? 'Streuartikelregel nach ETV aktiv' : 'Streuartikelregel nach ETV aus',
                settings.streuartikelregelungTeilwert ? 'Streuartikelregel nach Teilwert aktiv' : 'Streuartikelregel nach Teilwert aus',
                settings.add2ndhalf2023to2024 ? '2. HJ 2023 wird 2024 zugerechnet' : 'Keine Verschiebung aus 2023',
                settings.einnahmezumteilwert ? 'EÜR vor 10/2024 zum Teilwert' : 'EÜR vor 10/2024 zum ETV'
              ];
            }

            function renderTableFilterSummary(settings, inputCount, outputCount) {
              const summary = document.getElementById('vtt-table-filter-summary');
              if (!summary) return;
              const labels = getTableFilterLabels(settings);
              summary.innerHTML = labels
                .map(label => `<span class="vtt-filter-chip">${escapeHtml(label)}</span>`)
                .join('');
              const count = document.createElement('p');
              count.className = 'vtt-filter-count';
              count.textContent = `Tabelle mit ${outputCount} von ${inputCount} Produkten erstellt · ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
              summary.appendChild(count);
            }

            function renderSettingsSummary(settings) {
              const summary = document.getElementById('vtt-settings-summary');
              if (!summary) return;
              summary.textContent = [
                ...getTableFilterLabels(settings),
                ...getEvaluationRuleLabels(settings)
              ].join(' · ');
            }

            async function refreshDashboardStatusCards() {
              const requestedRevision = ++dashboardStatusRevision;
              const [stats, token, backendName] = await Promise.all([
                getLocalProductDatabaseStats(),
                getValue('token'),
                getValue('pythonanywherebackend', 'hutaufvine')
              ]);
              const model = getBackendUiModel(token, backendName);
              let syncInfo = null;
              if (model.configured) {
                const profileId = buildLocalProfileId(token, backendName);
                const [state, pending, inflight, blocked, openConflicts, uploadSuppressed] = await Promise.all([
                  db.syncState.get(profileId),
                  db.outbox.where('[profileId+status]').equals([profileId, 'pending']).count(),
                  db.outbox.where('[profileId+status]').equals([profileId, 'inflight']).count(),
                  db.outbox.where('[profileId+status]').equals([profileId, 'blocked']).count(),
                  db.conflicts.where('[profileId+status]').equals([profileId, 'open']).count(),
                  getValue(
                    `PRIVATE_BACKEND_V1_UPLOAD_SUPPRESSED_${model.backendName}_${getTokenStorageScope(token.trim())}`,
                    false
                  )
                ]);
                syncInfo = {
                  state,
                  queued: pending + inflight + blocked,
                  openConflicts,
                  uploadSuppressed: Boolean(uploadSuppressed)
                };
              }
              if (requestedRevision !== dashboardStatusRevision) {
                return { stats, model, syncInfo, skipped: true };
              }

              const storageValue = document.getElementById('vtt-storage-value');
              const storageDetail = document.getElementById('vtt-storage-detail');
              if (storageValue) {
                storageValue.textContent = `${stats.productCount.toLocaleString('de-DE')} Produkte`;
              }
              if (storageDetail) {
                storageDetail.textContent = `ca. ${stats.formattedSize} lokale Produktdaten`;
              }

              const backendSummary = document.getElementById('vtt-backend-summary');
              if (backendSummary) backendSummary.dataset.backendState = model.state;
              const backendValue = document.getElementById('vtt-backend-value');
              if (backendValue) {
                backendValue.innerHTML = `<span class="vtt-dot" aria-hidden="true"></span>${escapeHtml(model.title)}`;
              }
              const backendDetail = document.getElementById('vtt-backend-detail');
              if (backendDetail) {
                if (syncInfo?.state?.remoteDeleteRecovery) {
                  backendDetail.textContent = [
                    'Serverdaten gelöscht · lokale Wiederherstellungskopie geschützt',
                    `${syncInfo.queued} ausdrücklich neu vorgemerkte Änderung(en)`,
                    `${syncInfo.openConflicts} Konflikt(e)`
                  ].join(' · ');
                } else if (syncInfo?.uploadSuppressed && syncInfo?.state?.mode === 'v1') {
                  backendDetail.textContent = 'V1 · Auto-Upload nach Löschung gesperrt · lokale Sicherung vorhanden';
                } else if (syncInfo?.state?.mode === 'v2') {
                  backendDetail.textContent = [
                    `V2 inkrementell · Server-Revision ${Number(syncInfo.state.cursor || 0)}`,
                    `${syncInfo.queued} ausstehend`,
                    `${syncInfo.openConflicts} Konflikt(e)`
                  ].join(' · ');
                } else if (syncInfo?.state?.mode === 'v1') {
                  backendDetail.textContent = [
                    'V1-kompatibler Voll-Sync · Serverupdate für V2 verfügbar',
                    `${syncInfo.queued} ausstehend`
                  ].join(' · ');
                } else if (syncInfo) {
                  backendDetail.textContent = [
                    'Protokoll wird beim nächsten Sync geprüft',
                    `${syncInfo.queued} lokale Änderung(en) vorgemerkt`
                  ].join(' · ');
                } else {
                  backendDetail.textContent = model.detail;
                }
              }

              const configurationState = document.getElementById('backendConfigurationState');
              if (configurationState) {
                configurationState.dataset.backendState = model.state;
                configurationState.innerHTML = `<span class="vtt-dot" aria-hidden="true"></span>${escapeHtml(model.title)}`;
              }
              const backendLabel = document.getElementById('backendLabel');
              if (backendLabel) backendLabel.textContent = `Backend: ${model.backendName}`;
              const tokenInput = document.getElementById('backendTokenInput');
              if (tokenInput) {
                tokenInput.placeholder = model.configured
                  ? 'Token ist hinterlegt – leer lassen, um ihn beizubehalten'
                  : 'Persönlichen Token einfügen';
              }
              const localWarning = document.getElementById('vtt-local-only-warning');
              if (localWarning) localWarning.hidden = model.configured;
              for (const id of ['uploadButton', 'downloadButton', 'deleteButton']) {
                const button = document.getElementById(id);
                if (button) button.disabled = backendUiBusy || !model.configured;
              }
              for (const id of ['saveBackendButton', 'backendNameInput', 'backendTokenInput']) {
                const control = document.getElementById(id);
                if (control) control.disabled = backendUiBusy;
              }
              return { stats, model, syncInfo };
            }

            function openVttDialog(dialogId, trigger = null) {
              const dialog = document.getElementById(dialogId);
              if (!dialog) return;
              dialog.__vttReturnFocus = trigger || document.activeElement;
              dialog.setAttribute('role', 'dialog');
              dialog.setAttribute('aria-modal', 'true');
              if (typeof dialog.showModal === 'function') {
                if (!dialog.open) dialog.showModal();
              } else {
                if (dialog.hasAttribute('open')) return;
                const placeholder = document.createComment(`restore ${dialogId}`);
                dialog.parentNode.insertBefore(placeholder, dialog);
                const backdrop = document.createElement('div');
                backdrop.className = 'vtt-dialog-backdrop';
                backdrop.addEventListener('click', () => closeVttDialog(dialog));
                dialog.__vttFallbackPlaceholder = placeholder;
                dialog.__vttFallbackBackdrop = backdrop;
                document.body.append(backdrop, dialog);
                dialog.classList.add('vtt-dialog-fallback');
                dialog.setAttribute('open', '');
              }
              const focusTarget = dialog.querySelector(
                '[autofocus], .vtt-dialog-body input:not([disabled]), .vtt-dialog-body select:not([disabled]), '
                + '.vtt-dialog-body button:not([disabled]), .vtt-dialog-body a[href], .vtt-dialog-close'
              );
              if (focusTarget && typeof focusTarget.focus === 'function') {
                setTimeout(() => focusTarget.focus(), 0);
              }
            }

            function closeVttDialog(dialog) {
              if (!dialog) return;
              if (typeof dialog.close === 'function' && dialog.open) {
                dialog.close();
              } else {
                dialog.removeAttribute('open');
                dialog.classList.remove('vtt-dialog-fallback');
                dialog.__vttFallbackBackdrop?.remove();
                dialog.__vttFallbackBackdrop = null;
                const placeholder = dialog.__vttFallbackPlaceholder;
                if (placeholder?.parentNode) {
                  placeholder.parentNode.insertBefore(dialog, placeholder);
                  placeholder.remove();
                }
                dialog.__vttFallbackPlaceholder = null;
                const returnFocus = dialog.__vttReturnFocus;
                dialog.__vttReturnFocus = null;
                if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
              }
            }

            function getVttDialogFocusableElements(dialog) {
              return Array.from(dialog.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
                + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
              )).filter(element => !element.hidden);
            }

            function initializeDialogInteractions(root) {
              root.querySelectorAll('[data-vtt-open-dialog]').forEach(button => {
                button.addEventListener('click', () => openVttDialog(button.dataset.vttOpenDialog, button));
              });
              root.querySelectorAll('.vtt-dialog').forEach(dialog => {
                dialog.querySelectorAll('[data-vtt-close-dialog]').forEach(button => {
                  button.addEventListener('click', () => closeVttDialog(dialog));
                });
                dialog.addEventListener('close', () => {
                  const returnFocus = dialog.__vttReturnFocus;
                  dialog.__vttReturnFocus = null;
                  if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
                });
                dialog.addEventListener('click', event => {
                  if (event.target !== dialog) return;
                  const bounds = dialog.getBoundingClientRect();
                  const inside = event.clientX >= bounds.left
                    && event.clientX <= bounds.right
                    && event.clientY >= bounds.top
                    && event.clientY <= bounds.bottom;
                  if (!inside) closeVttDialog(dialog);
                });
                dialog.addEventListener('keydown', event => {
                  if (event.key === 'Escape' && typeof dialog.showModal !== 'function') {
                    event.preventDefault();
                    closeVttDialog(dialog);
                    return;
                  }
                  if (event.key === 'Tab' && dialog.classList.contains('vtt-dialog-fallback')) {
                    const focusable = getVttDialogFocusableElements(dialog);
                    if (focusable.length === 0) {
                      event.preventDefault();
                      return;
                    }
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (event.shiftKey && document.activeElement === first) {
                      event.preventDefault();
                      last.focus();
                    } else if (!event.shiftKey && document.activeElement === last) {
                      event.preventDefault();
                      first.focus();
                    }
                  }
                });
              });
            }

            function initializeInfoInteractions(root) {
              const closeAll = (except = null) => {
                root.querySelectorAll('.vtt-info[aria-expanded="true"]').forEach(button => {
                  if (button === except) return;
                  button.setAttribute('aria-expanded', 'false');
                  const popover = document.getElementById(button.getAttribute('aria-controls'));
                  if (popover) popover.hidden = true;
                });
              };

              root.querySelectorAll('.vtt-info[data-help]').forEach((button, index) => {
                const wrapper = document.createElement('span');
                wrapper.className = 'vtt-info-wrap';
                const popover = document.createElement('span');
                popover.id = `vtt-info-popover-${index + 1}`;
                popover.className = 'vtt-info-popover';
                popover.setAttribute('role', 'note');
                popover.textContent = button.dataset.help;
                popover.hidden = true;
                button.before(wrapper);
                wrapper.append(button, popover);
                button.setAttribute('aria-controls', popover.id);
                button.setAttribute('aria-expanded', 'false');
                button.addEventListener('click', event => {
                  event.stopPropagation();
                  const willOpen = button.getAttribute('aria-expanded') !== 'true';
                  closeAll(button);
                  button.setAttribute('aria-expanded', String(willOpen));
                  popover.hidden = !willOpen;
                });
                button.addEventListener('keydown', event => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    button.setAttribute('aria-expanded', 'false');
                    popover.hidden = true;
                  }
                });
              });
              root.addEventListener('click', event => {
                if (!event.target.closest('.vtt-info-wrap')) closeAll();
              });
            }

            async function persistSettingAndRefresh(key, value) {
              settingsWriteQueue = settingsWriteQueue
                .catch(() => undefined)
                .then(async () => {
                  const settings = await getSettings();
                  settings[key] = value;
                  await setValue("settings", settings);
                  renderSettingsSummary(settings);
                  return settings;
                });
              const savedSettings = await settingsWriteQueue;
              await requestDashboardRefresh();
              return savedSettings;
            }

            function requestDashboardRefresh() {
              const requestedRevision = ++dashboardRefreshRevision;
              dashboardRefreshQueue = dashboardRefreshQueue
                .catch(error => {
                  console.error('Previous dashboard refresh failed:', error);
                })
                .then(async () => {
                  if (requestedRevision !== dashboardRefreshRevision) return { skipped: true };
                  const list = await load_all_asin_etv_values_from_storage(false);
                  if (requestedRevision !== dashboardRefreshRevision) return { skipped: true };
                  const dataTable = document.getElementById('data-table');
                  if (dataTable?.dataset.rendered === 'true') {
                    await showAllData({ openSection: false, sourceData: list });
                  }
                  if (document.getElementById('vtt-analysis-content')) {
                    await createYearlyBreakdown(list);
                  }
                  await refreshDashboardStatusCards();
                  return { refreshed: true };
                });
              return dashboardRefreshQueue;
            }

            async function waitForDashboardRefreshIdle() {
              let observedQueue;
              do {
                observedQueue = dashboardRefreshQueue;
                await observedQueue;
              } while (observedQueue !== dashboardRefreshQueue);
            }

            async function setValue(key, value) {
              if (typeof key === 'string' && key.startsWith('ASIN_')) {
                const asin = normalizeAsin(key.slice(5));
                if (!asin) throw new Error(`Invalid product key: ${key}`);
                const profileId = await getActiveProfileId();
                const parsed = parseStoredProductDate(value, `local product ${asin}`);
                const existing = await db.products.get([profileId, asin]);
                await db.products.put(createProductRow(
                  profileId,
                  asin,
                  parsed,
                  existing?.recordRevision || 0
                ));
                return;
              }
              await db.keyValuePairs.put({ key, value });
            }

            async function getValue(key, defaultValue = null) {
              if (typeof key === 'string' && key.startsWith('ASIN_')) {
                const asin = normalizeAsin(key.slice(5));
                if (!asin) return defaultValue;
                const profileId = await getActiveProfileId();
                const row = await db.products.get([profileId, asin]);
                return row ? JSON.stringify(row.data) : defaultValue;
              }
              const result = await db.keyValuePairs.get(key);
              return result ? result.value : defaultValue;
            }

            async function getActiveProfileId() {
              const [tokenRecord, backendRecord] = await Promise.all([
                db.keyValuePairs.get('token'),
                db.keyValuePairs.get('pythonanywherebackend')
              ]);
              const token = typeof tokenRecord?.value === 'string' ? tokenRecord.value.trim() : '';
              const backendName = String(backendRecord?.value || 'hutaufvine').trim().toLowerCase();
              const profileId = buildLocalProfileId(token, backendName);
              if (!await db.profiles.get(profileId)) {
                await db.profiles.put({
                  id: profileId,
                  kind: token ? 'private-backend' : 'local-only',
                  backendName,
                  backendUrl: token && isValidBackendName(backendName)
                    ? getPrivateBackendUrl(backendName)
                    : null,
                  tokenFingerprint: token ? getTokenProfileFingerprint(token) : null,
                  createdAt: Date.now()
                });
              }
              return profileId;
            }

            async function deleteStoredProduct(asinValue, profileId = null) {
              const asin = normalizeAsin(asinValue);
              if (!asin) return false;
              const resolvedProfileId = profileId || await getActiveProfileId();
              await db.products.delete([resolvedProfileId, asin]);
              return true;
            }

            async function bindLocalProfileToPrivateProfile(
              sourceProfileId,
              token,
              backendName,
              options = {}
            ) {
              const targetProfileId = buildLocalProfileId(token, backendName);
              if (sourceProfileId === targetProfileId) return { profileId: targetProfileId, copied: 0 };
              const copyProducts = options.copyProducts ?? sourceProfileId === 'local-only';
              if (copyProducts && sourceProfileId !== 'local-only') {
                throw new Error('Produktdaten aus einem privaten Profil dürfen nicht automatisch kopiert werden.');
              }
              let copied = 0;
              await db.transaction('rw', db.profiles, db.products, db.outbox, async () => {
                const sourceProducts = copyProducts
                  ? await db.products.where('profileId').equals(sourceProfileId).toArray()
                  : [];
                const existingTargetCount = await db.products.where('profileId').equals(targetProfileId).count();
                if (copyProducts && sourceProducts.length > 0 && existingTargetCount > 0) {
                  throw new Error(
                    'Das Zielprofil enthält bereits lokale Daten. Ein automatisches Vermischen wurde verhindert.'
                  );
                }
                const existingProfile = await db.profiles.get(targetProfileId);
                await db.profiles.put({
                  ...(existingProfile || {}),
                  id: targetProfileId,
                  kind: 'private-backend',
                  backendName,
                  backendUrl: getPrivateBackendUrl(backendName),
                  tokenFingerprint: getTokenProfileFingerprint(token),
                  createdAt: existingProfile?.createdAt || Date.now(),
                  ...(copyProducts ? { boundFromProfileId: sourceProfileId } : {})
                });
                for (const row of sourceProducts) {
                  await db.products.put(createProductRow(targetProfileId, row.asin, row.data, 0));
                   await db.outbox.put(createOutboxMutation({
                     profileId: targetProfileId,
                     entityType: 'product',
                     entityId: row.asin,
                     baseRevision: 0,
                     set: row.data,
                     unset: [],
                     source: 'profile-binding',
                     legacyTimestamp: Number.isSafeInteger(Number(row.data?.last_update_time))
                       ? Number(row.data.last_update_time)
                       : 0
                   }));
                }
                copied = sourceProducts.length;
              });
              return {
                profileId: targetProfileId,
                copied,
                switched: !copyProducts
              };
            }

            function enqueueProductOperation(asinValue, operation) {
              const asin = normalizeAsin(asinValue);
              if (!asin) return Promise.reject(new Error('Ungültige ASIN für Produktänderung.'));
              const previous = productUpdateQueues.get(asin) || Promise.resolve();
              const queued = previous
                .catch(() => undefined)
                .then(() => operation(asin));
              productUpdateQueues.set(asin, queued);
              return queued.finally(() => {
                if (productUpdateQueues.get(asin) === queued) {
                  productUpdateQueues.delete(asin);
                }
              });
            }

            function updateStoredProduct(asinValue, updater, options = {}) {
              return enqueueProductOperation(asinValue, async asin => {
                const profileId = await getActiveProfileId();
                return db.transaction('rw', db.products, db.shadows, db.outbox, db.conflicts, async () => {
                  const existingRow = await db.products.get([profileId, asin]);
                  if (!existingRow && options.createIfMissing !== true) return null;
                  const current = existingRow
                    ? parseStoredProduct(structuredCloneSafe(existingRow.data), `local product ${asin}`)
                    : {};
                  const candidate = await updater(current, asin);
                  const updated = candidate === undefined ? current : candidate;
                  if (!updated || typeof updated !== 'object' || Array.isArray(updated)) {
                    throw new Error(`Ungültige Produktänderung für ${asin}.`);
                  }
                  const normalized = parseStoredProduct(updated, `local product ${asin}`);
                  await db.products.put(createProductRow(
                    profileId,
                    asin,
                    normalized,
                    existingRow?.recordRevision || 0
                  ));

                  const directDiff = diffTopLevelFields(existingRow?.data || {}, normalized);
                  if (
                    options.queueOutbox !== false
                    && profileId !== 'local-only'
                    && (Object.keys(directDiff.set).length > 0 || directDiff.unset.length > 0)
                  ) {
                    const shadow = await db.shadows.get([profileId, 'product', asin]);
                    const entityMutations = (await db.outbox
                      .where('[profileId+entityType+entityId]')
                      .equals([profileId, 'product', asin])
                      .toArray())
                      .sort(compareOutboxMutationOrder);
                    const openConflicts = (await db.conflicts
                      .where('[profileId+entityType+entityId]')
                      .equals([profileId, 'product', asin])
                      .toArray())
                      .filter(conflict => conflict.status === 'open');
                    if (openConflicts.length > 0) {
                      for (const conflict of openConflicts) {
                        const localFollowupMutations = [
                          ...(Array.isArray(conflict.localFollowupMutations)
                            ? conflict.localFollowupMutations
                            : [])
                        ];
                        if (Object.keys(directDiff.set).length > 0 || directDiff.unset.length > 0) {
                          localFollowupMutations.push({
                            operation: 'patch',
                            set: structuredCloneSafe(directDiff.set),
                            unset: [...directDiff.unset],
                            createdAt: Date.now()
                          });
                        }
                        await db.conflicts.update(conflict.id, {
                          localRecord: structuredCloneSafe(normalized),
                          localFollowupMutations,
                          localUpdatedAt: Date.now()
                        });
                      }
                    } else {
                      const immutableMutations = entityMutations.filter(item => (
                        item.status === 'inflight'
                        || item.status === 'sending'
                        || (item.status === 'pending' && Number(item.attempts || 0) > 0)
                      ));
                      const replaceablePending = entityMutations.filter(item => (
                        item.status === 'pending' && Number(item.attempts || 0) === 0
                      ));
                      const anticipatedServer = structuredCloneSafe(shadow?.data || {});
                      for (const immutable of immutableMutations) {
                        if (immutable.operation === 'delete') {
                          for (const key of Object.keys(anticipatedServer)) delete anticipatedServer[key];
                        } else {
                          for (const [field, value] of Object.entries(immutable.set || {})) {
                            anticipatedServer[field] = structuredCloneSafe(value);
                          }
                          for (const field of immutable.unset || []) delete anticipatedServer[field];
                        }
                      }
                      const desiredDiff = diffTopLevelFields(anticipatedServer, normalized);
                      if (Object.keys(desiredDiff.set).length === 0 && desiredDiff.unset.length === 0) {
                        for (const mutation of replaceablePending) {
                          await db.outbox.delete(mutation.mutationId);
                        }
                      } else if (replaceablePending.length > 0) {
                        const [firstPending, ...duplicates] = replaceablePending;
                        await db.outbox.update(firstPending.mutationId, {
                          set: desiredDiff.set,
                          unset: desiredDiff.unset,
                          source: options.source || 'local-edit',
                          createdAt: Date.now(),
                          updatedAt: Date.now()
                        });
                        for (const duplicate of duplicates) await db.outbox.delete(duplicate.mutationId);
                      } else {
                        await db.outbox.put(createOutboxMutation({
                          profileId,
                          entityType: 'product',
                          entityId: asin,
                          baseRevision: shadow?.recordRevision || existingRow?.recordRevision || 0,
                          set: desiredDiff.set,
                          unset: desiredDiff.unset,
                          source: options.source || 'local-edit'
                        }));
                      }
                    }
                  }
                  return normalized;
                });
              });
            }

            async function getAllAsinValues() {
                try {
                    const profileId = await getActiveProfileId();
                    const rows = await db.products.where('profileId').equals(profileId).toArray();
                    const asinDict = rows.reduce((acc, row) => {
                        acc[`ASIN_${row.asin}`] = JSON.stringify(row.data);
                        return acc;
                    }, {});
                    return asinDict;
                } catch (error) {
                    console.error("Error getting ASIN values:", error);
                    return {};
                }
            }

            function updateStatusMessage(message, type = "info") {
                const statusEl = document.querySelector('#vine-data-extractor #status')
                  || document.getElementById('status');
                if (!statusEl) return;
                statusEl.textContent = message;
                const statusColors = { info: '#0f1111', success: '#067d62', error: '#b12704' };
                statusEl.style.color = statusColors[type] || statusColors.info;
            }

            function updateBackendStatusText(message, type = "info") {
                const backendStatusEl = document.querySelector('#vine-data-extractor #backendStatus')
                  || document.getElementById('backendStatus');
                if (!backendStatusEl) return;
                backendStatusEl.textContent = message;
                const statusColors = { info: '#555', success: '#067d62', error: '#b12704' };
                backendStatusEl.style.color = statusColors[type] || statusColors.info;
            }

            async function updateDefaultStatusSummary() {
                let statusSnapshot = await refreshDashboardStatusCards();
                if (statusSnapshot.skipped) {
                  statusSnapshot = await refreshDashboardStatusCards();
                }
                const { stats, model } = statusSnapshot;
                updateStatusMessage(
                  `Bereit. ${stats.productCount} lokale Produkte; Synchronisation: ${model.configured ? 'eingerichtet' : 'nur lokal'}.`,
                  "success"
                );
            }

            function applyDisplayFilters(items, settings, cancellations = []) {
                return items.filter(item => {
                    const itemDate = parseDateSafe(item.date);
                    if (!itemDate) return false;
                    const itemYear = itemDate.getUTCFullYear();
                    const itemMonth = itemDate.getUTCMonth();
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
                const storedYearMatch = /^only (\d{4})$/.exec(settings.yearFilter || '');
                if (storedYearMatch) {
                    const storedYear = Number(storedYearMatch[1]);
                    if (!yearOptions.includes(storedYear)) {
                        yearOptions.push(storedYear);
                        yearOptions.sort((a, b) => a - b);
                    }
                }

                const validValues = new Set(["show all years", "show current year", ...yearOptions.map(year => `only ${year}`)]);
                const selectedValue = validValues.has(settings.yearFilter) ? settings.yearFilter : "show all years";

                const optionsHtml = [
                    `<option value="show all years"${selectedValue === "show all years" ? " selected" : ""}>Alle Jahre anzeigen</option>`,
                    `<option value="show current year"${selectedValue === "show current year" ? " selected" : ""}>Aktuelles Jahr (${currentYear})</option>`,
                    ...yearOptions.map(year => `<option value="only ${year}"${selectedValue === `only ${year}` ? " selected" : ""}>Nur ${year}</option>`)
                ];

                return optionsHtml.join('');
            }


            async function listValues() {
              try {
                const profileId = await getActiveProfileId();
                const [keys, products] = await Promise.all([
                  db.keyValuePairs.toCollection().primaryKeys(),
                  db.products.where('profileId').equals(profileId).toArray()
                ]);
                return [
                  ...keys,
                  ...products.map(product => `ASIN_${product.asin}`)
                ];
              } catch (error) {
                console.error("Error listing values:", error);
                return [];
              }
            }

            async function validateAndFixDatabase() {
              try {
                // Version 1.112001 briefly stored upload receipts that could suppress
                // estimator polling. They are intentionally unused and removed again.
                await db.keyValuePairs.delete('teilwert_estimator_acknowledgements_v1');
                const keys = await listValues();
                const asinKeys = keys.filter(key => key.startsWith("ASIN_"));
                const invalidAsins = [];
                const records = [];

                for (const asinKey of asinKeys) {
                  const sourceAsin = asinKey.slice(5);
                  const asin = normalizeAsin(sourceAsin);
                  if (!asin) {
                    invalidAsins.push(sourceAsin);
                    await deleteStoredProduct(sourceAsin);
                    console.log(`Removed invalid ASIN: ${sourceAsin}`);
                    continue;
                  }
                  const stored = await getValue(asinKey);
                  const valueObject = parseStoredProductDate(stored, `local product ${sourceAsin}`);
                  records.push({
                    asin,
                    sourceAsin,
                    sourceKey: asinKey,
                    timestamp: Number(valueObject.last_update_time) || 0,
                    valueObject
                  });
                }

                const canonicalEntries = mergeCanonicalProductRecords(records);
                let correctedAsins = 0;
                for (const entry of canonicalEntries) {
                  const needsCorrection = entry.variants.length > 1
                    || entry.variants.some(variant => variant.sourceAsin !== entry.asin);
                  if (!needsCorrection) continue;
                  await setValue(`ASIN_${entry.asin}`, JSON.stringify(entry.valueObject));
                  for (const variant of entry.variants) {
                    if (variant.sourceKey !== `ASIN_${entry.asin}`) {
                      await deleteStoredProduct(variant.sourceAsin);
                    }
                  }
                  correctedAsins++;
                }

                console.log(
                  `Database validation complete. Removed ${invalidAsins.length} invalid ASIN(s); `
                  + `canonicalized ${correctedAsins} ASIN group(s).`
                );
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

                const itemDate = parseDateSafe(item.date);
                const cutoffDate = new Date(Date.UTC(2024, 9, 1));

                let einnahmen = 0;
                let ausgaben = 0;
                let entnahmen = 0;
                let einnahmen_aus_anlagevermoegen = 0;

                if (settings.einnahmezumteilwert && itemDate && itemDate < cutoffDate) {
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

              function createCalendarDateParts(year, month, day) {
                const numericYear = Number(year);
                const numericMonth = Number(month);
                const numericDay = Number(day);
                if (
                  !Number.isInteger(numericYear)
                  || !Number.isInteger(numericMonth)
                  || !Number.isInteger(numericDay)
                  || numericYear < 1000
                  || numericYear > 9999
                  || numericMonth < 1
                  || numericMonth > 12
                ) {
                  return null;
                }
                const leapYear = numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0);
                const daysPerMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
                if (numericDay < 1 || numericDay > daysPerMonth[numericMonth - 1]) {
                  return null;
                }
                return { year: numericYear, month: numericMonth, day: numericDay };
              }

              function parseOrderDateParts(dateValue) {
                if (!dateValue) return null;
                if (dateValue instanceof Date) {
                  if (Number.isNaN(dateValue.getTime())) return null;
                  return createCalendarDateParts(
                    dateValue.getUTCFullYear(),
                    dateValue.getUTCMonth() + 1,
                    dateValue.getUTCDate()
                  );
                }
                if (typeof dateValue !== 'string') return null;
                const fullDateText = dateValue.trim();
                if (!fullDateText) return null;

                // Backend compatibility: accept ISO timestamps, but retain only their calendar-date prefix.
                let match = fullDateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
                if (match) {
                  return createCalendarDateParts(match[1], match[2], match[3]);
                }

                const numericDateText = fullDateText.split(/[ ,]/)[0];
                match = numericDateText.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
                if (match) {
                  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
                  return createCalendarDateParts(year, match[2], match[1]);
                }

                match = numericDateText.match(/^(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})$/);
                if (match) {
                  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
                  return createCalendarDateParts(year, match[2], match[3]);
                }

                const monthNames = {
                  'Januar':1,'Februar':2,'März':3,'Maerz':3,'April':4,'Mai':5,
                  'Juni':6,'Juli':7,'August':8,'September':9,'Oktober':10,'November':11,'Dezember':12
                };
                const textualDate = fullDateText.replace(/\//g, '.').replace(/\s+/g, ' ').trim();
                match = textualDate.match(/(\d{1,2})\.?\s*([A-Za-zäöüÄÖÜß]+)\s*(\d{2,4})/);
                if (match) {
                  const month = monthNames[match[2]];
                  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
                  if (month) return createCalendarDateParts(year, month, match[1]);
                }
                return null;
              }

              function formatOrderDate(parts) {
                if (!parts) return null;
                return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
              }

              function normalizeOrderDate(dateValue) {
                return formatOrderDate(parseOrderDateParts(dateValue));
              }

              function parseDateSafe(dateValue) {
                const parts = parseOrderDateParts(dateValue);
                return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : null;
              }

              const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
              const BACKEND_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
              const REQUEST_TIMEOUT_MS = 30000;

              function normalizeAsin(value) {
                if (typeof value !== 'string') return null;
                const asin = value.trim().toUpperCase();
                return ASIN_PATTERN.test(asin) ? asin : null;
              }

              function parseStoredProductDate(value, context = 'product') {
                const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                  throw new Error(`Invalid ${context}: expected a JSON object.`);
                }

                if (Object.prototype.hasOwnProperty.call(parsed, 'date')) {
                  const normalizedDate = normalizeOrderDate(parsed.date);
                  if (normalizedDate) parsed.date = normalizedDate;
                }
                return parsed;
              }

              function mergeCanonicalProductRecords(records) {
                const grouped = new Map();
                for (const record of records) {
                  const variants = grouped.get(record.asin) || [];
                  variants.push(record);
                  grouped.set(record.asin, variants);
                }
                return Array.from(grouped, ([asin, variants]) => {
                  const orderedVariants = [...variants].sort((left, right) => {
                    const timestampDifference = left.timestamp - right.timestamp;
                    if (timestampDifference !== 0) return timestampDifference;
                    const canonicalDifference = Number(left.sourceAsin === asin)
                      - Number(right.sourceAsin === asin);
                    if (canonicalDifference !== 0) return canonicalDifference;
                    return left.sourceAsin.localeCompare(right.sourceAsin);
                  });
                  const valueObject = {};
                  for (const variant of orderedVariants) {
                    Object.assign(valueObject, variant.valueObject);
                  }
                  return {
                    asin,
                    timestamp: Math.max(...orderedVariants.map(variant => variant.timestamp)),
                    valueObject,
                    variants: orderedVariants
                  };
                });
              }

              function parseStoredProduct(value, context = 'product') {
                const parsed = parseStoredProductDate(value, context);

                const hasLegacyMyTeilwert = Object.prototype.hasOwnProperty.call(parsed, 'myteilwert');
                const hasCanonicalMyTeilwert = Object.prototype.hasOwnProperty.call(parsed, 'myTeilwert');
                if (hasLegacyMyTeilwert) {
                  parsed.myTeilwert = parsed.myteilwert;
                } else if (hasCanonicalMyTeilwert) {
                  parsed.myteilwert = parsed.myTeilwert;
                }

                const legacyUsageFields = [
                  ['verkauft', 'verkauft'],
                  ['lager', 'Lager'],
                  ['entsorgt', 'entsorgt'],
                  ['storniert', 'storniert'],
                  ['betriebsausgabe', 'betriebliche Nutzung']
                ];

                let usageStatus = Array.isArray(parsed.usageStatus)
                  ? [...new Set(parsed.usageStatus)]
                  : [];

                // Eine nichtleere usageStatus-Liste ist die neuere,
                // maßgebliche Darstellung.
                if (usageStatus.length === 0) {
                  // Nur wenn die Liste fehlt oder leer ist, werden alte
                  // true-Booleans in die Liste migriert.
                  for (const [field, status] of legacyUsageFields) {
                    if (parsed[field] === true && !usageStatus.includes(status)) {
                      usageStatus.push(status);
                    }
                  }
                }

                // Anschließend werden die Legacy-Booleans immer aus der
                // maßgeblichen Liste neu erzeugt.
                for (const [field, status] of legacyUsageFields) {
                  parsed[field] = usageStatus.includes(status);
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

              function getTokenProfileFingerprint(token) {
                const value = String(token);
                return [
                  value.length.toString(16),
                  getStringHash(`profile-a\0${value}`),
                  getStringHash(`profile-b\0${[...value].reverse().join('')}`),
                  getStringHash(`profile-c\0${value}\0${value.length}`),
                  getStringHash(`profile-d\0${value.slice(1)}${value.slice(0, 1)}`)
                ].join('-');
              }

              function createUuid() {
                if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
                  return globalThis.crypto.randomUUID();
                }
                const randomPart = () => Math.floor(Math.random() * 0x100000000)
                  .toString(16)
                  .padStart(8, '0');
                return `${Date.now().toString(16)}-${randomPart()}-${randomPart()}-${randomPart()}`;
              }

              function buildLocalProfileId(token, backendName = 'hutaufvine') {
                const normalizedToken = typeof token === 'string' ? token.trim() : '';
                if (!normalizedToken) return 'local-only';
                const normalizedBackend = String(backendName || 'hutaufvine').trim().toLowerCase();
                return `private:${normalizedBackend}:${getTokenProfileFingerprint(normalizedToken)}`;
              }

              function createProductRow(profileId, asin, data, recordRevision = 0, legacyTimestamp = null) {
                const normalizedAsin = normalizeAsin(asin);
                if (!normalizedAsin) throw new Error('Invalid ASIN for product row.');
                const product = parseStoredProductDate(data, `product ${normalizedAsin}`);
                if (
                  legacyTimestamp != null
                  && !Object.prototype.hasOwnProperty.call(product, 'last_update_time')
                ) {
                  product.last_update_time = getLegacyProductTimestamp(product, legacyTimestamp);
                }
                return {
                  profileId,
                  asin: normalizedAsin,
                  data: product,
                  date: normalizeOrderDate(product.date) || null,
                  etv: Number.isFinite(Number(product.etv)) ? Number(product.etv) : null,
                  recordRevision: Math.max(0, Number(recordRevision) || 0),
                  updatedAt: Date.now()
                };
              }

              function compareOutboxMutationOrder(left, right) {
                const timeDifference = Number(left?.createdAt || 0) - Number(right?.createdAt || 0);
                if (timeDifference !== 0) return timeDifference;
                return String(left?.mutationId || '').localeCompare(String(right?.mutationId || ''));
              }

              function getLegacyProductTimestamp(value, fallback = 0) {
                const candidate = Number(value?.last_update_time ?? fallback);
                return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
              }

              function withLegacyProductTimestamp(value, timestamp) {
                const result = structuredCloneSafe(value && typeof value === 'object' ? value : {});
                if (!Object.prototype.hasOwnProperty.call(result, 'last_update_time')) {
                  result.last_update_time = getLegacyProductTimestamp(result, timestamp);
                }
                return result;
              }

              function createOutboxMutation({
                profileId,
                entityType,
                entityId,
                baseRevision = 0,
                operation = 'patch',
                set = {},
                unset = [],
                source = 'local-edit',
                legacyTimestamp = null
              }) {
                const mutation = {
                  mutationId: createUuid(),
                  profileId,
                  entityType,
                  entityId,
                  baseRevision: Math.max(0, Number(baseRevision) || 0),
                  operation,
                  set: structuredCloneSafe(set),
                  unset: [...new Set(Array.isArray(unset) ? unset : [])].sort(),
                  source,
                  status: 'pending',
                  attempts: 0,
                  createdAt: Date.now(),
                  nextAttemptAt: 0
                };
                if (legacyTimestamp != null) {
                  mutation.legacyTimestamp = Number.isSafeInteger(Number(legacyTimestamp))
                    ? Number(legacyTimestamp)
                    : 0;
                }
                return mutation;
              }

              function structuredCloneSafe(value) {
                if (value === undefined) return undefined;
                if (typeof globalThis.structuredClone === 'function') {
                  try {
                    return globalThis.structuredClone(value);
                  } catch (_error) {
                    // JSON-compatible product data is cloned below.
                  }
                }
                return JSON.parse(JSON.stringify(value));
              }

              function diffTopLevelFields(previousValue, nextValue) {
                const previous = previousValue && typeof previousValue === 'object' ? previousValue : {};
                const next = nextValue && typeof nextValue === 'object' ? nextValue : {};
                const set = {};
                const unset = [];
                for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
                  if (!Object.prototype.hasOwnProperty.call(next, key)) {
                    unset.push(key);
                  } else if (
                    !Object.prototype.hasOwnProperty.call(previous, key)
                    || canonicalizeJson(previous[key]) !== canonicalizeJson(next[key])
                  ) {
                    set[key] = structuredCloneSafe(next[key]);
                  }
                }
                return { set, unset: unset.sort() };
              }

              function applyOutboxMutation(baseValue, mutation) {
                if (mutation?.operation === 'delete') return null;
                const result = structuredCloneSafe(
                  baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
                    ? baseValue
                    : {}
                );
                for (const [field, value] of Object.entries(mutation?.set || {})) {
                  result[field] = structuredCloneSafe(value);
                }
                for (const field of mutation?.unset || []) delete result[field];
                return result;
              }

              async function getV2RecordDatasetHash(records) {
                const canonicalRecords = records
                  .filter(record => !record.deleted)
                  .map(record => ({
                    entity_type: record.entityType,
                    entity_id: record.entityId,
                    data: record.data
                  }))
                  .sort((left, right) => (
                    compareUtf16Strings(left.entity_type, right.entity_type)
                    || compareUtf16Strings(left.entity_id, right.entity_id)
                  ));
                return sha256Hex(canonicalizeJson(canonicalRecords));
              }

              function canonicalizeJson(value) {
                if (value === null) return 'null';
                if (typeof value === 'boolean') return value ? 'true' : 'false';
                if (typeof value === 'string') return JSON.stringify(value);
                if (typeof value === 'number') {
                  if (!Number.isFinite(value)) throw new Error('Canonical JSON does not support non-finite numbers.');
                  return JSON.stringify(Object.is(value, -0) ? 0 : value);
                }
                if (Array.isArray(value)) {
                  return `[${value.map(item => canonicalizeJson(item)).join(',')}]`;
                }
                if (value && typeof value === 'object') {
                  const keys = Object.keys(value).sort();
                  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(',')}}`;
                }
                throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
              }

              function compareUtf16Strings(leftValue, rightValue) {
                const left = String(leftValue);
                const right = String(rightValue);
                return left < right ? -1 : left > right ? 1 : 0;
              }

              async function sha256Hex(value) {
                if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
                  throw new Error('SHA-256 is not available in this browser.');
                }
                const digest = await globalThis.crypto.subtle.digest(
                  'SHA-256',
                  new TextEncoder().encode(String(value))
                );
                return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
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

              function setProgress(text, percentage = null, state = "info") {
                const progressBar = progressBarController || window.progressBar;
                if (!progressBar) return;
                progressBar.show();
                if (typeof progressBar.setState === 'function') progressBar.setState(state);
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
                setProgress(message, percentage, type);
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
                    if (response && typeof response.responseText === 'string') {
                      error.responseText = response.responseText;
                      try {
                        error.responseData = JSON.parse(response.responseText);
                      } catch (_parseError) {
                        // Keep the raw body for diagnostics without changing the network error.
                      }
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
                  this.syncRequestRevision = 0;
                  this.syncLockOwnerId = createUuid();
                  this.integritySnapshotScheduled = new Set();
                }

                enqueue(operation) {
                  const next = this.operationQueue.catch(() => undefined).then(operation);
                  this.operationQueue = next.catch(() => undefined);
                  return next;
                }

                async withCrossTabSyncLock(profileId, operation, webLockHeld = false) {
                  const browserLockManager = globalThis.navigator?.locks;
                  if (!webLockHeld && browserLockManager?.request) {
                    return browserLockManager.request(
                      `vine-tax-tools-sync:${profileId}`,
                      { mode: 'exclusive' },
                      () => this.withCrossTabSyncLock(profileId, operation, true)
                    );
                  }
                  const leaseDurationMs = 30 * 1000;
                  const waitDeadline = Date.now() + 60 * 1000;
                  let acquired = false;
                  while (!acquired) {
                    acquired = await db.transaction('rw', db.syncLocks, async () => {
                      const current = await db.syncLocks.get(profileId);
                      const now = Date.now();
                      if (
                        current
                        && current.ownerId !== this.syncLockOwnerId
                        && Number(current.expiresAt || 0) > now
                      ) {
                        return false;
                      }
                      await db.syncLocks.put({
                        profileId,
                        ownerId: this.syncLockOwnerId,
                        acquiredAt: now,
                        expiresAt: now + leaseDurationMs
                      });
                      return true;
                    });
                    if (acquired) break;
                    if (Date.now() >= waitDeadline) {
                      throw new Error('Ein privater Sync läuft bereits in einem anderen Browser-Tab.');
                    }
                    await new Promise(resolve => setTimeout(resolve, 100 + Math.floor(Math.random() * 150)));
                  }

                  const heartbeat = setInterval(() => {
                    db.transaction('rw', db.syncLocks, async () => {
                      const current = await db.syncLocks.get(profileId);
                      if (current?.ownerId === this.syncLockOwnerId) {
                        await db.syncLocks.put({
                          ...current,
                          expiresAt: Date.now() + leaseDurationMs
                        });
                      }
                    }).catch(error => console.warn('VineTaxTools sync lease heartbeat failed.', error));
                  }, Math.floor(leaseDurationMs / 3));

                  try {
                    return await operation();
                  } finally {
                    clearInterval(heartbeat);
                    await db.transaction('rw', db.syncLocks, async () => {
                      const current = await db.syncLocks.get(profileId);
                      if (current?.ownerId === this.syncLockOwnerId) {
                        await db.syncLocks.delete(profileId);
                      }
                    });
                  }
                }

                async getPrivateConfig() {
                  const token = await getValue("token");
                  const normalizedToken = typeof token === 'string' ? token.trim() : '';
                  if (!normalizedToken) {
                    return null;
                  }
                  const pythonanywherebackend = await getValue("pythonanywherebackend", "hutaufvine");
                  return {
                    token: normalizedToken,
                    backendName: String(pythonanywherebackend).trim().toLowerCase(),
                    storageScope: getTokenStorageScope(normalizedToken),
                    profileId: buildLocalProfileId(normalizedToken, pythonanywherebackend),
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

                async detectPrivateProtocol(config, force = false) {
                  const cached = await db.syncState.get(config.profileId);
                  if (
                    !force
                    && cached?.mode
                    && cached.capabilityClientVersion === '1.114000'
                    && Date.now() - Number(cached.capabilityCheckedAt || 0) < 24 * 60 * 60 * 1000
                  ) {
                    return { mode: cached.mode, capabilities: cached.capabilities || null };
                  }
                  try {
                    const response = await this.postPrivate(config, 'get_capabilities_v2', {
                      client: { name: 'VineTaxTools', version: '1.114000' },
                      supported_protocols: [2, 1],
                      entity_types: ['product']
                    });
                    const capabilities = response.data || response.capabilities || response;
                    if (Number(capabilities.protocol_version || capabilities.protocolVersion) !== 2) {
                      throw new Error('Server capability response does not advertise protocol 2.');
                    }
                    const previous = cached || { profileId: config.profileId, cursor: 0 };
                    await db.syncState.put({
                      ...previous,
                      profileId: config.profileId,
                      mode: 'v2',
                      capabilities,
                      generationId: previous.generationId || capabilities.generation_id || capabilities.generationId,
                      capabilityCheckedAt: Date.now(),
                      capabilityClientVersion: '1.114000'
                    });
                    return { mode: 'v2', capabilities };
                  } catch (error) {
                    const message = String(error.responseData?.message || error.message || '');
                    const isLegacyServer = Number(error.status) === 400
                      && /unknown request type/i.test(message);
                    if (!isLegacyServer) throw error;
                    await db.syncState.put({
                      ...(cached || {}),
                      profileId: config.profileId,
                      mode: 'v1',
                      capabilityCheckedAt: Date.now(),
                      capabilityClientVersion: '1.114000',
                      legacyNoticePending: true
                    });
                    return { mode: 'v1', capabilities: null };
                  }
                }

                async getShadowDatasetHash(profileId, entityTypes = ['product']) {
                  const records = [];
                  for (const entityType of entityTypes) {
                    const rows = await db.shadows
                      .where('[profileId+entityType]')
                      .equals([profileId, entityType])
                      .toArray();
                    for (const row of rows) {
                      if (row.deleted) continue;
                      records.push({
                        entity_type: entityType,
                        entity_id: row.entityId,
                        data: row.data
                      });
                    }
                  }
                  records.sort((left, right) => (
                    compareUtf16Strings(left.entity_type, right.entity_type)
                    || compareUtf16Strings(left.entity_id, right.entity_id)
                  ));
                  return sha256Hex(canonicalizeJson(records));
                }

                async restoreStaleInflightOutbox(profileId) {
                  const staleInflight = await db.outbox
                    .where('[profileId+status]')
                    .equals([profileId, 'inflight'])
                    .toArray();
                  if (staleInflight.length === 0) return 0;
                  await db.transaction('rw', db.outbox, async () => {
                    for (const mutation of staleInflight) {
                      await db.outbox.update(mutation.mutationId, {
                        status: 'pending',
                        inflightAt: null
                      });
                    }
                  });
                  return staleInflight.length;
                }

                async rebaseAheadOutbox(config, currentRevision) {
                  const normalizedCurrentRevision = Number(currentRevision);
                  if (
                    !Number.isSafeInteger(normalizedCurrentRevision)
                    || normalizedCurrentRevision < 0
                  ) {
                    throw new Error('V2 server returned an invalid current revision for base-revision repair.');
                  }
                  await db.transaction(
                    'rw',
                    db.outbox,
                    db.products,
                    db.shadows,
                    async () => {
                      const pending = await db.outbox
                        .where('[profileId+status]')
                        .equals([config.profileId, 'pending'])
                        .toArray();
                      for (const mutation of pending) {
                        const baseRevision = Number(mutation.baseRevision || 0);
                        const shadow = await db.shadows.get([
                          config.profileId,
                          mutation.entityType,
                          mutation.entityId
                        ]);
                        const serverRevision = Math.min(
                          normalizedCurrentRevision,
                          Math.max(0, Number(shadow?.recordRevision || 0))
                        );
                        const changes = {
                          nextAttemptAt: 0,
                          inflightAt: null
                        };
                        if (baseRevision > normalizedCurrentRevision) {
                          changes.baseRevision = serverRevision;
                          if (mutation.entityType === 'product') {
                            const product = await db.products.get([
                              config.profileId,
                              mutation.entityId
                            ]);
                            if (product) {
                              await db.products.put({
                                ...product,
                                recordRevision: serverRevision,
                                updatedAt: Date.now()
                              });
                            }
                          }
                        }
                        await db.outbox.update(mutation.mutationId, changes);
                      }
                    }
                  );
                }

                async pushV2Outbox(config, generationId, capabilities = {}) {
                  await this.restoreStaleInflightOutbox(config.profileId);

                  let pushed = 0;
                  let rejected = 0;
                  let exchanged = false;
                  const supportsExchange = capabilities.features?.push_pull_exchange === true;
                  while (true) {
                    const allPending = (await db.outbox
                      .where('[profileId+status]')
                      .equals([config.profileId, 'pending'])
                      .toArray())
                      .sort(compareOutboxMutationOrder);
                    if (allPending.length === 0) break;
                    const seenEntities = new Set();
                    const batch = [];
                    for (const mutation of allPending) {
                      const entityKey = `${mutation.entityType}:${mutation.entityId}`;
                      if (seenEntities.has(entityKey)) continue;
                      seenEntities.add(entityKey);
                      // A request whose response was lost may already have committed.
                      // Never let a later compensation overtake that immutable retry.
                      if (Number(mutation.nextAttemptAt || 0) > Date.now()) continue;
                      batch.push(mutation);
                      if (batch.length >= 100) break;
                    }
                    if (batch.length === 0) break;
                    await db.transaction('rw', db.outbox, async () => {
                      for (const mutation of batch) {
                        await db.outbox.update(mutation.mutationId, {
                          status: 'inflight',
                          inflightAt: Date.now()
                        });
                      }
                    });
                    const clientId = await this.getClientId(config.profileId);
                    const stateBeforeExchange = await db.syncState.get(config.profileId) || {
                      profileId: config.profileId,
                      cursor: 0,
                      generationId
                    };
                    let response;
                    try {
                      response = await this.postPrivate(config, 'sync_v2_push', {
                        generation_id: generationId,
                        client_id: clientId,
                        ...(supportsExchange ? {
                          pull_since: Number(stateBeforeExchange.cursor || 0),
                          pull_limit: Number(capabilities.limits?.pull_changes || 500),
                          entity_types: ['product']
                        } : {}),
                        mutations: batch.map(mutation => {
                          const authoritativeStatusFields = new Set([
                            'usageStatus', 'verkauft', 'lager', 'entsorgt',
                            'storniert', 'betriebsausgabe'
                          ]);
                          const authoritativeFields = capabilities.features?.authoritative_status_fields === true
                            && mutation.entityType === 'product'
                            ? [...new Set([
                                ...Object.keys(mutation.set || {}),
                                ...(mutation.unset || [])
                              ])].filter(field => authoritativeStatusFields.has(field))
                            : [];
                          return {
                            mutation_id: mutation.mutationId,
                            client_id: clientId,
                            entity_type: mutation.entityType,
                            entity_id: mutation.entityId,
                            base_revision: mutation.baseRevision,
                            operation: mutation.operation,
                            intent_age_ms: Math.max(
                              0,
                              Date.now() - Number(mutation.createdAt || Date.now())
                            ),
                            set: mutation.set,
                            unset: mutation.unset,
                            ...(authoritativeFields.length > 0
                              ? { authoritative_fields: authoritativeFields }
                              : {})
                          };
                        })
                      });
                    } catch (error) {
                      if (error.responseData?.code === 'generation_mismatch') {
                        await db.transaction('rw', db.outbox, async () => {
                          for (const mutation of batch) {
                            await db.outbox.update(mutation.mutationId, {
                              status: 'pending',
                              inflightAt: null
                            });
                          }
                        });
                        throw error;
                      }
                      const baseDelay = Math.min(
                        5 * 60 * 1000,
                        2000 * (2 ** Math.min(8, Math.max(...batch.map(item => item.attempts || 0))))
                      );
                      const jitter = 0.8 + Math.random() * 0.4;
                      const nextAttemptAt = Date.now() + Math.round(baseDelay * jitter);
                      await db.transaction('rw', db.outbox, async () => {
                        for (const mutation of batch) {
                          await db.outbox.update(mutation.mutationId, {
                            status: 'pending',
                            inflightAt: null,
                            attempts: Number(mutation.attempts || 0) + 1,
                            nextAttemptAt
                          });
                        }
                      });
                      throw error;
                    }

                    const results = response.data?.results || response.results || [];
                    const resultsById = new Map(results.map(result => [
                      result.mutation_id || result.mutationId,
                      result
                    ]));
                    let incompleteResponse = false;
                    await db.transaction(
                      'rw',
                      db.outbox,
                      db.conflicts,
                      db.products,
                      db.shadows,
                      async () => {
                      for (const mutation of batch) {
                        const result = resultsById.get(mutation.mutationId);
                        if (!result) {
                          await db.outbox.update(mutation.mutationId, {
                            status: 'pending',
                            inflightAt: null,
                            attempts: Number(mutation.attempts || 0) + 1,
                            nextAttemptAt: Date.now() + 2000
                          });
                          incompleteResponse = true;
                          continue;
                        }
                        if (result.status === 'applied' || result.status === 'noop') {
                          const confirmedRevision = Number(
                            result.revision || result.record_revision || result.recordRevision || 0
                          );
                          const previousShadow = await db.shadows.get([
                            config.profileId,
                            mutation.entityType,
                            mutation.entityId
                          ]);
                          const previousRevision = Number(previousShadow?.recordRevision || 0);
                          const keepNewerShadow = Boolean(
                            previousShadow
                            && confirmedRevision > 0
                            && previousRevision >= confirmedRevision
                          );
                          const resultHasData = Object.prototype.hasOwnProperty.call(result, 'data')
                            || Object.prototype.hasOwnProperty.call(result, 'server_record')
                            || Object.prototype.hasOwnProperty.call(result, 'serverRecord');
                          let confirmedData = result.data ?? result.server_record ?? result.serverRecord;
                          if (mutation.operation === 'delete') {
                            confirmedData = null;
                          } else if (!resultHasData || confirmedData == null) {
                            confirmedData = applyOutboxMutation(previousShadow?.data || {}, mutation);
                          } else if (typeof confirmedData === 'string') {
                            confirmedData = parseStoredProductDate(
                              confirmedData,
                              `V2 acknowledgement product ${mutation.entityId}`
                            );
                          } else {
                            confirmedData = structuredCloneSafe(confirmedData);
                          }

                          const effectiveRevision = keepNewerShadow
                            ? previousRevision
                            : confirmedRevision;
                          const effectiveData = keepNewerShadow
                            ? structuredCloneSafe(previousShadow.data)
                            : confirmedData;

                          await db.outbox.delete(mutation.mutationId);
                          const laterMutations = (await db.outbox
                            .where('[profileId+entityType+entityId]')
                            .equals([config.profileId, mutation.entityType, mutation.entityId])
                            .toArray())
                            .sort(compareOutboxMutationOrder);
                          if (effectiveRevision > 0) {
                            for (const later of laterMutations.filter(item => (
                              item.status === 'pending' || item.status === 'inflight'
                            ))) {
                              await db.outbox.update(later.mutationId, {
                                baseRevision: effectiveRevision
                              });
                            }
                          }

                          if (!keepNewerShadow) {
                            if (effectiveData == null) {
                              await db.shadows.delete([
                                config.profileId,
                                mutation.entityType,
                                mutation.entityId
                              ]);
                            } else {
                              await db.shadows.put({
                                profileId: config.profileId,
                                entityType: mutation.entityType,
                                entityId: mutation.entityId,
                                recordRevision: effectiveRevision,
                                data: effectiveData,
                                updatedAt: Date.now()
                              });
                            }
                          }
                          if (mutation.entityType === 'product') {
                            let workingData = structuredCloneSafe(effectiveData);
                            for (const later of laterMutations) {
                              workingData = applyOutboxMutation(workingData || {}, later);
                            }
                            if (workingData == null) {
                              await db.products.delete([config.profileId, mutation.entityId]);
                            } else {
                              await db.products.put(createProductRow(
                                config.profileId,
                                mutation.entityId,
                                workingData,
                                effectiveRevision,
                                effectiveData?.last_update_time
                              ));
                            }
                          }
                          pushed++;
                        } else if (result.status === 'conflict') {
                          // A current V2.1 server never conflicts product
                          // patches. For an older server, discard this stale
                          // intent and replace local state from a verified
                          // server snapshot after the remaining outbox drains.
                          await db.outbox.delete(mutation.mutationId);
                          rejected++;
                        } else {
                          await db.outbox.update(mutation.mutationId, {
                            status: 'pending',
                            inflightAt: null,
                            attempts: Number(mutation.attempts || 0) + 1,
                            nextAttemptAt: Date.now() + 2000
                          });
                          incompleteResponse = true;
                        }
                      }
                    });
                    if (incompleteResponse) {
                      throw new Error('V2 server returned an incomplete mutation acknowledgement.');
                    }
                    if (supportsExchange) {
                      const data = response.data || response;
                      if (
                        !Array.isArray(data.changes)
                        || !Number.isSafeInteger(Number(data.next_cursor ?? data.nextCursor))
                        || typeof (data.has_more ?? data.hasMore) !== 'boolean'
                      ) {
                        throw new Error('V2.1 server advertised exchange support but returned no valid change page.');
                      }
                      const applied = await this.applyV2PullPage(
                        config,
                        generationId,
                        stateBeforeExchange,
                        data
                      );
                      exchanged = true;
                      if (applied.hasMore) await this.pullV2Changes(config, generationId);
                    }
                  }
                  return { pushed, rejected, exchanged };
                }

                async getClientId(profileId) {
                  const state = await db.syncState.get(profileId);
                  if (state?.clientId) return state.clientId;
                  const clientId = createUuid();
                  await db.syncState.put({
                    ...(state || {}),
                    profileId,
                    clientId,
                    cursor: Number(state?.cursor || 0)
                  });
                  return clientId;
                }

                async verifyAndAcknowledgeV1Outbox(config, asins) {
                  if (!Array.isArray(asins) || asins.length === 0) return { acknowledged: 0 };
                  const response = await this.postPrivate(config, 'get_asin', [...new Set(asins)]);
                  const serverRecords = new Map();
                  for (const entry of response.data || []) {
                    const asin = normalizeAsin(entry?.ASIN);
                    if (!asin || typeof entry?.value !== 'string') continue;
                    try {
                      serverRecords.set(asin, parseStoredProduct(entry.value, `V1 server product ${asin}`));
                    } catch (_error) {
                      // An invalid server record cannot acknowledge a durable mutation.
                    }
                  }
                  const pending = await db.outbox
                    .where('[profileId+status]')
                    .equals([config.profileId, 'pending'])
                    .toArray();
                  let acknowledged = 0;
                  await db.transaction('rw', db.outbox, async () => {
                    for (const mutation of pending) {
                      const serverData = serverRecords.get(mutation.entityId);
                      if (!serverData || mutation.operation !== 'patch') continue;
                      const setMatches = Object.entries(mutation.set || {}).every(
                        ([field, value]) => Object.prototype.hasOwnProperty.call(serverData, field)
                          && canonicalizeJson(serverData[field]) === canonicalizeJson(value)
                      );
                      const unsetMatches = (mutation.unset || []).every(
                        field => !Object.prototype.hasOwnProperty.call(serverData, field)
                      );
                      if (setMatches && unsetMatches) {
                        await db.outbox.delete(mutation.mutationId);
                        acknowledged++;
                      }
                    }
                  });
                  return { acknowledged };
                }

                async applyV2Change(profileId, change) {
                  const entityType = change.entity_type || change.entityType;
                  const entityId = entityType === 'product'
                    ? normalizeAsin(change.entity_id || change.entityId)
                    : String(change.entity_id || change.entityId || '');
                  if (!entityId || entityType !== 'product') return;
                  const operation = change.operation;
                  await db.transaction(
                    'rw',
                    db.outbox,
                    db.shadows,
                    db.products,
                    db.conflicts,
                    async () => {
                      const pending = (await db.outbox
                        .where('[profileId+entityType+entityId]')
                        .equals([profileId, entityType, entityId])
                        .toArray())
                        .sort(compareOutboxMutationOrder);
                      const openConflicts = (await db.conflicts
                        .where('[profileId+entityType+entityId]')
                        .equals([profileId, entityType, entityId])
                        .toArray())
                        .filter(conflict => conflict.status === 'open');
                      const recordRevision = Number(
                        change.record_revision || change.recordRevision || change.revision || 0
                      );

                      if (operation === 'delete') {
                      await db.shadows.delete([profileId, entityType, entityId]);
                      if (openConflicts.length > 0) {
                        const preserved = openConflicts.find(conflict => (
                          Object.prototype.hasOwnProperty.call(conflict, 'localRecord')
                        ));
                        const localRecord = preserved
                          ? structuredCloneSafe(preserved.localRecord)
                          : (await db.products.get([profileId, entityId]))?.data || null;
                        for (const conflict of openConflicts) {
                          await db.conflicts.update(conflict.id, {
                            serverRecord: null,
                            serverRevision: recordRevision,
                            serverDeleted: true,
                            serverUpdatedAt: Date.now()
                          });
                        }
                        if (localRecord == null) {
                          await db.products.delete([profileId, entityId]);
                        } else {
                          await db.products.put(createProductRow(
                            profileId,
                            entityId,
                            localRecord,
                            recordRevision
                          ));
                        }
                      } else if (pending.length === 0) {
                        await db.products.delete([profileId, entityId]);
                      } else {
                        await db.conflicts.put({
                          id: `${profileId}:${entityType}:${entityId}:remote-delete`,
                          profileId,
                          entityType,
                          entityId,
                          status: 'open',
                          kind: 'remote-delete-with-local-change',
                          createdAt: Date.now(),
                          serverRevision: recordRevision,
                          serverDeleted: true,
                          serverRecord: null,
                          localRecord: (await db.products.get([profileId, entityId]))?.data || null
                        });
                      }
                      return;
                    }

                    const previousShadow = await db.shadows.get([profileId, entityType, entityId]);
                    const remoteData = structuredCloneSafe(
                      change.data || change.server_record || change.serverRecord || previousShadow?.data || {}
                    );
                    for (const [field, value] of Object.entries(change.set || {})) {
                      remoteData[field] = structuredCloneSafe(value);
                    }
                    for (const field of change.unset || []) delete remoteData[field];
                    let workingData = structuredCloneSafe(remoteData);
                    for (const mutation of pending) {
                      workingData = applyOutboxMutation(workingData || {}, mutation);
                    }
                    const preserved = openConflicts.find(conflict => (
                      Object.prototype.hasOwnProperty.call(conflict, 'localRecord')
                    ));
                    if (preserved) workingData = structuredCloneSafe(preserved.localRecord);

                    await db.shadows.put({
                      profileId,
                      entityType,
                      entityId,
                      recordRevision,
                      data: remoteData,
                      updatedAt: Date.now()
                    });
                    if (workingData == null) {
                      await db.products.delete([profileId, entityId]);
                    } else {
                      await db.products.put(createProductRow(
                        profileId,
                        entityId,
                        workingData,
                        recordRevision,
                        change.legacy_last_update_time ?? change.legacyLastUpdateTime
                      ));
                    }
                    for (const conflict of openConflicts) {
                      await db.conflicts.update(conflict.id, {
                        serverRecord: structuredCloneSafe(remoteData),
                        serverRevision: recordRevision,
                        serverDeleted: false,
                        serverUpdatedAt: Date.now()
                      });
                    }
                  });
                }

                async applyV2PullPage(config, generationId, previousState, data) {
                  const responseGeneration = data.generation_id || data.generationId;
                  if (responseGeneration && responseGeneration !== generationId) {
                    const error = new Error('V2 change page belongs to a different server generation.');
                    error.responseData = {
                      code: 'generation_mismatch',
                      snapshot_required: true,
                      generation_id: responseGeneration
                    };
                    throw error;
                  }
                  const previousCursor = Number(previousState?.cursor || 0);
                  const nextCursor = Number(data.next_cursor ?? data.nextCursor ?? previousCursor);
                  const hasMore = Boolean(data.has_more ?? data.hasMore);
                  if (
                    !Number.isSafeInteger(nextCursor)
                    || nextCursor < previousCursor
                    || (hasMore && nextCursor <= previousCursor)
                  ) {
                    const error = new Error('V2 change page did not advance its cursor safely.');
                    error.responseData = { code: 'cursor_ahead', snapshot_required: true };
                    throw error;
                  }
                  if ((data.changes || []).some(change => change.operation === 'dataset_reset')) {
                    const error = new Error('V2 dataset was reset.');
                    error.responseData = {
                      code: 'generation_mismatch',
                      snapshot_required: true,
                      generation_id: responseGeneration || generationId
                    };
                    throw error;
                  }
                  for (const change of data.changes || []) {
                    await this.applyV2Change(config.profileId, change);
                  }
                  const state = {
                    ...(previousState || {}),
                    profileId: config.profileId,
                    mode: 'v2',
                    generationId,
                    cursor: nextCursor,
                    lastPullAt: Date.now()
                  };
                  await db.syncState.put(state);
                  return {
                    state,
                    hasMore,
                    expectedHash: data.dataset_hash || data.datasetHash || null
                  };
                }

                async replaceFromV2Snapshot(
                  config,
                  generationId,
                  reason = 'snapshot',
                  sessionRestartAttempt = 0,
                  integrityRetryAttempt = 0
                ) {
                  await this.restoreStaleInflightOutbox(config.profileId);
                  const recordMap = new Map();
                  let sessionId = null;
                  let offset = 0;
                  let expectedHash = null;
                  let snapshotRevision = null;
                  const seenPageCursors = new Set();
                  do {
                    const requestPayload = sessionId
                      ? { session_id: sessionId, offset, limit: 500 }
                      : { generation_id: generationId, entity_types: ['product'], limit: 500 };
                    let response;
                    try {
                      response = await this.postPrivate(config, 'sync_v2_snapshot', requestPayload);
                    } catch (error) {
                      if (
                        sessionId
                        && error.responseData?.code === 'snapshot_expired'
                        && sessionRestartAttempt < 1
                      ) {
                        console.warn('VineTaxTools V2 snapshot session expired; restarting once.');
                        return this.replaceFromV2Snapshot(
                          config,
                          error.responseData?.generation_id || generationId,
                          reason,
                          sessionRestartAttempt + 1,
                          integrityRetryAttempt
                        );
                      }
                      throw error;
                    }
                    const data = response.data || response;
                    const responseGenerationId = data.generation_id || data.generationId;
                    if (responseGenerationId && responseGenerationId !== generationId) {
                      const error = new Error('V2 snapshot belongs to a different server generation.');
                      error.responseData = {
                        code: 'generation_mismatch',
                        generation_id: responseGenerationId,
                        snapshot_required: true
                      };
                      throw error;
                    }
                    const responseSessionId = data.session_id
                      || data.sessionId
                      || data.snapshot_id
                      || data.snapshotId;
                    if (sessionId && responseSessionId && responseSessionId !== sessionId) {
                      throw new Error('V2 snapshot pagination changed its session ID.');
                    }
                    sessionId = responseSessionId || sessionId;
                    const responseRevision = Number(
                      data.snapshot_revision ?? data.snapshotRevision ?? data.current_revision ?? 0
                    );
                    if (snapshotRevision != null && responseRevision !== snapshotRevision) {
                      throw new Error('V2 snapshot pagination changed its snapshot revision.');
                    }
                    snapshotRevision = responseRevision;
                    const responseHash = data.dataset_hash || data.datasetHash || null;
                    if (expectedHash && responseHash && responseHash !== expectedHash) {
                      throw new Error('V2 snapshot pagination changed its dataset hash.');
                    }
                    expectedHash = responseHash || expectedHash;
                    for (const record of data.records || []) {
                      const entityType = record.entity_type || record.entityType || 'product';
                      const entityId = normalizeAsin(record.entity_id || record.entityId || record.ASIN);
                      if (entityType !== 'product' || !entityId) continue;
                      let recordData = record.data ?? record.value ?? {};
                      if (typeof recordData === 'string') {
                        recordData = parseStoredProductDate(recordData, `V2 snapshot product ${entityId}`);
                      }
                      if (!recordData || typeof recordData !== 'object' || Array.isArray(recordData)) {
                        throw new Error(`V2 snapshot returned invalid product data for ${entityId}.`);
                      }
                      recordMap.set(`${entityType}:${entityId}`, {
                        entityType,
                        entityId,
                        recordRevision: Number(record.record_revision || record.recordRevision || 0),
                        legacyLastUpdateTime: getLegacyProductTimestamp(
                          recordData,
                          record.legacy_last_update_time ?? record.legacyLastUpdateTime ?? 0
                        ),
                        data: structuredCloneSafe(recordData)
                      });
                    }
                    if (!data.has_more && !data.hasMore) break;
                    const nextOffset = data.next_offset
                      ?? data.nextOffset
                      ?? data.next_after
                      ?? data.nextAfter;
                    if (!sessionId || nextOffset == null) {
                      throw new Error('V2 snapshot pagination response is incomplete.');
                    }
                    const pageCursor = `${sessionId}:${nextOffset}`;
                    if (seenPageCursors.has(pageCursor)) {
                      throw new Error('V2 snapshot pagination did not advance.');
                    }
                    seenPageCursors.add(pageCursor);
                    offset = nextOffset;
                  } while (true);

                  const records = Array.from(recordMap.values()).sort((left, right) => (
                    compareUtf16Strings(left.entityType, right.entityType)
                    || compareUtf16Strings(left.entityId, right.entityId)
                  ));
                  if (!expectedHash) {
                    throw new Error('V2 snapshot did not provide a dataset hash.');
                  }
                  const stagedHash = await getV2RecordDatasetHash(records);
                  if (stagedHash !== expectedHash) {
                    console.error('VineTaxTools V2 snapshot hash mismatch before import.', {
                      reason,
                      expectedHash,
                      actualHash: stagedHash,
                      generationId,
                      snapshotRevision
                    });
                    if (integrityRetryAttempt < 1) {
                      updateBackendStatusText(
                        'Integritätsabweichung im Snapshot erkannt; ein frischer Volldownload läuft …',
                        'error'
                      );
                      return this.replaceFromV2Snapshot(
                        config,
                        generationId,
                        reason,
                        sessionRestartAttempt,
                        integrityRetryAttempt + 1
                      );
                    }
                    throw new Error(
                      'Integritätsprüfung des vollständigen Server-Snapshots blieb nach einem frischen Wiederholungsversuch fehlerhaft.'
                    );
                  }

                  const previousState = await db.syncState.get(config.profileId) || {};
                  // The deliberate Danger-Zone delete is the sole exception:
                  // it keeps a local recovery copy until the user edits again.
                  const preserveLocalRecovery = previousState.remoteDeleteRecovery === true;
                  await db.transaction(
                    'rw',
                    db.shadows,
                    db.products,
                    db.outbox,
                    db.conflicts,
                    db.syncState,
                    async () => {
                      const existingProducts = await db.products
                        .where('profileId')
                        .equals(config.profileId)
                        .toArray();
                      const existingByAsin = new Map(existingProducts.map(row => [row.asin, row]));
                      let pending = (await db.outbox
                        .where('[profileId+status]')
                        .equals([config.profileId, 'pending'])
                        .toArray())
                        .sort(compareOutboxMutationOrder);
                      if (reason === 'generation-reset') {
                        await db.outbox.where('profileId').equals(config.profileId).delete();
                        await db.conflicts.where('profileId').equals(config.profileId).delete();
                        pending = [];
                      }
                      const snapshotByAsin = new Map(
                        records
                          .filter(record => record.entityType === 'product')
                          .map(record => [record.entityId, record])
                      );
                      const isInitialBootstrap = reason === 'initial-bootstrap'
                        && (
                          previousState.generationId == null
                          || previousState.generationId === generationId
                        )
                        && previousState.lastSnapshotAt == null
                        && previousState.lastHash == null
                        && previousState.lastHashVerifiedAt == null;

                      if (isInitialBootstrap) {
                        const existingOpenConflicts = new Set(
                          (await db.conflicts
                            .where('[profileId+status]')
                            .equals([config.profileId, 'open'])
                            .toArray())
                            .filter(conflict => conflict.entityType === 'product')
                            .map(conflict => conflict.entityId)
                        );
                        const replaceBootstrapIntent = async (
                          asin,
                          set,
                          baseRevision,
                          legacyTimestamp,
                          forceMutation = false
                        ) => {
                          const entityMutations = pending.filter(mutation => (
                            mutation.entityType === 'product' && mutation.entityId === asin
                          ));
                          // A mutation which may have reached the server is an
                          // immutable prefix. Bootstrap must never rewrite or
                          // delete it based on a client timestamp.
                          if (entityMutations.some(mutation => (
                            mutation.status !== 'pending' || Number(mutation.attempts || 0) > 0
                          ))) return;
                          const replaceable = entityMutations.filter(mutation => (
                            mutation.status === 'pending' && Number(mutation.attempts || 0) === 0
                          ));
                          for (const mutation of replaceable) {
                            await db.outbox.delete(mutation.mutationId);
                          }
                          if (replaceable.length > 0) {
                            const replaceableIds = new Set(replaceable.map(mutation => mutation.mutationId));
                            pending = pending.filter(mutation => !replaceableIds.has(mutation.mutationId));
                          }
                          if (Object.keys(set).length === 0 && !forceMutation) return;
                          const mutation = createOutboxMutation({
                            profileId: config.profileId,
                            entityType: 'product',
                            entityId: asin,
                            baseRevision,
                            set,
                            source: 'legacy-bootstrap',
                            legacyTimestamp
                          });
                          mutation.createdAt = Math.max(
                            Number(mutation.createdAt || 0),
                            ...pending
                              .filter(item => item.entityType === 'product' && item.entityId === asin)
                              .map(item => Number(item.createdAt || 0) + 1)
                          );
                          await db.outbox.put(mutation);
                          pending.push(mutation);
                          pending.sort(compareOutboxMutationOrder);
                        };

                        for (const existing of existingProducts) {
                          if (existingOpenConflicts.has(existing.asin)) continue;
                          const entityMutations = pending.filter(mutation => (
                            mutation.entityType === 'product' && mutation.entityId === existing.asin
                          ));
                          if (entityMutations.some(mutation => (
                            mutation.status !== 'pending' || Number(mutation.attempts || 0) > 0
                          ))) continue;
                          const serverRecord = snapshotByAsin.get(existing.asin);
                          const localValue = structuredCloneSafe(existing.data || {});
                          const localTimestamp = getLegacyProductTimestamp(localValue);
                          if (!serverRecord) {
                            const localSet = {};
                            for (const [field, value] of Object.entries(localValue)) {
                              if (field !== 'ASIN' && field !== 'last_update_time') {
                                localSet[field] = structuredCloneSafe(value);
                              }
                            }
                            await replaceBootstrapIntent(
                              existing.asin,
                              localSet,
                              0,
                              localTimestamp,
                              true
                            );
                            continue;
                          }

                          const serverValue = structuredCloneSafe(serverRecord.data || {});
                          const serverTimestamp = getLegacyProductTimestamp(
                            serverValue,
                            serverRecord.legacyLastUpdateTime
                          );
                          // Legacy timestamps are used only for this one-time
                          // import. Equal timestamps deliberately let the
                          // server win; all later decisions use revisions.
                          if (localTimestamp <= serverTimestamp) {
                            await replaceBootstrapIntent(
                              existing.asin,
                              {},
                              serverRecord.recordRevision,
                              localTimestamp
                            );
                            continue;
                          }

                          const localSet = {};
                          for (const [field, value] of Object.entries(localValue)) {
                            if (field === 'ASIN' || field === 'last_update_time') continue;
                            if (
                              !Object.prototype.hasOwnProperty.call(serverValue, field)
                              || canonicalizeJson(serverValue[field]) !== canonicalizeJson(value)
                            ) {
                              localSet[field] = structuredCloneSafe(value);
                            }
                          }
                          await replaceBootstrapIntent(
                            existing.asin,
                            localSet,
                            serverRecord.recordRevision,
                            localTimestamp
                          );
                        }
                      }

                      const openConflicts = (await db.conflicts
                        .where('[profileId+status]')
                        .equals([config.profileId, 'open'])
                        .toArray())
                        .filter(conflict => conflict.entityType === 'product');
                      const conflictsByAsin = new Map();
                      for (const conflict of openConflicts) {
                        const group = conflictsByAsin.get(conflict.entityId) || [];
                        group.push(conflict);
                        conflictsByAsin.set(conflict.entityId, group);
                      }
                      const pendingByAsin = new Map();
                      for (const mutation of pending.filter(item => item.entityType === 'product')) {
                        const group = pendingByAsin.get(mutation.entityId) || [];
                        group.push(mutation);
                        pendingByAsin.set(mutation.entityId, group);
                      }
                      await db.shadows
                        .where('[profileId+entityType]')
                        .equals([config.profileId, 'product'])
                        .delete();
                      for (const record of records) {
                        await db.shadows.put({
                          profileId: config.profileId,
                          entityType: record.entityType,
                          entityId: record.entityId,
                          recordRevision: record.recordRevision,
                          data: structuredCloneSafe(record.data),
                          updatedAt: Date.now()
                        });
                      }

                      const allAsins = new Set([
                        ...existingByAsin.keys(),
                        ...snapshotByAsin.keys(),
                        ...pendingByAsin.keys(),
                        ...conflictsByAsin.keys()
                      ]);
                      for (const asin of allAsins) {
                        const serverRecord = snapshotByAsin.get(asin);
                        const existing = existingByAsin.get(asin);
                        const conflicts = conflictsByAsin.get(asin) || [];
                        const applicable = (pendingByAsin.get(asin) || [])
                          .sort(compareOutboxMutationOrder);

                        if (conflicts.length > 0) {
                          const preserved = [...conflicts]
                            .sort((left, right) => (
                              Number(right.localUpdatedAt || right.createdAt || 0)
                              - Number(left.localUpdatedAt || left.createdAt || 0)
                            ))
                            .find(conflict => Object.prototype.hasOwnProperty.call(conflict, 'localRecord'));
                          const localRecord = preserved
                            ? structuredCloneSafe(preserved.localRecord)
                            : structuredCloneSafe(existing?.data ?? null);
                          for (const conflict of conflicts) {
                            await db.conflicts.update(conflict.id, {
                              serverRecord: serverRecord ? structuredCloneSafe(serverRecord.data) : null,
                              serverRevision: serverRecord?.recordRevision || 0,
                              serverDeleted: !serverRecord,
                              serverUpdatedAt: Date.now()
                            });
                          }
                          if (localRecord == null) {
                            await db.products.delete([config.profileId, asin]);
                          } else {
                            await db.products.put(createProductRow(
                              config.profileId,
                              asin,
                              localRecord,
                              serverRecord?.recordRevision || existing?.recordRevision || 0,
                              serverRecord?.legacyLastUpdateTime ?? existing?.data?.last_update_time
                            ));
                          }
                          continue;
                        }

                        if (preserveLocalRecovery && existing) {
                          const recoveryRevision = Number(serverRecord?.recordRevision || 0);
                          if (Number(existing.recordRevision || 0) !== recoveryRevision) {
                            await db.products.put(createProductRow(
                              config.profileId,
                              asin,
                              existing.data,
                              recoveryRevision,
                              serverRecord?.legacyLastUpdateTime ?? existing.data?.last_update_time
                            ));
                          }
                          continue;
                        }

                        let workingData = serverRecord
                          ? structuredCloneSafe(serverRecord.data)
                          : null;
                        for (const mutation of applicable) {
                          workingData = applyOutboxMutation(workingData || {}, mutation);
                        }
                        if (workingData == null) {
                          await db.products.delete([config.profileId, asin]);
                        } else {
                          await db.products.put(createProductRow(
                            config.profileId,
                            asin,
                            workingData,
                            serverRecord?.recordRevision || existing?.recordRevision || 0,
                            serverRecord?.legacyLastUpdateTime ?? existing?.data?.last_update_time
                          ));
                        }
                      }

                      await db.syncState.put({
                        ...previousState,
                        profileId: config.profileId,
                        mode: 'v2',
                        generationId,
                        cursor: snapshotRevision,
                        lastHash: stagedHash,
                        lastSnapshotAt: Date.now(),
                        lastHashVerifiedAt: Date.now(),
                        snapshotRequired: false,
                        repairReason: reason
                      });
                    }
                  );
                  return { records: records.length, hash: stagedHash, revision: snapshotRevision };
                }

                async pullV2Changes(config, generationId) {
                  let state = await db.syncState.get(config.profileId) || {
                    profileId: config.profileId,
                    mode: 'v2',
                    cursor: 0,
                    generationId
                  };
                  if (state.generationId && state.generationId !== generationId) {
                    return this.replaceFromV2Snapshot(config, generationId, 'generation-reset');
                  }
                  let expectedHash = null;
                  while (true) {
                    let response;
                    try {
                      response = await this.postPrivate(config, 'sync_v2_pull', {
                        generation_id: generationId,
                        cursor: Number(state.cursor || 0),
                        limit: 500,
                        entity_types: ['product']
                      });
                    } catch (error) {
                      const code = error.responseData?.code;
                      if (code === 'generation_mismatch') throw error;
                      if (error.responseData?.snapshot_required) {
                        return this.replaceFromV2Snapshot(
                          config,
                          error.responseData.generation_id || generationId,
                          code || 'cursor-reset'
                        );
                      }
                      throw error;
                    }
                    const data = response.data || response;
                    if (data.snapshot_required || data.snapshotRequired) {
                      return this.replaceFromV2Snapshot(config, generationId, data.reason || 'cursor-reset');
                    }
                    const applied = await this.applyV2PullPage(config, generationId, state, data);
                    state = applied.state;
                    expectedHash = applied.expectedHash || expectedHash;
                    if (!applied.hasMore) break;
                  }
                  if (expectedHash) {
                    const actualHash = await this.getShadowDatasetHash(config.profileId);
                    if (actualHash === expectedHash) {
                      await db.syncState.put({
                        ...state,
                        lastHash: actualHash,
                        lastHashVerifiedAt: Date.now()
                      });
                      return { cursor: state.cursor, hash: actualHash };
                    }
                    console.warn('VineTaxTools V2 incremental hash mismatch; starting repair snapshot.', {
                      expectedHash,
                      actualHash,
                      generationId,
                      cursor: state.cursor
                    });
                    updateBackendStatusText('Integritätsabweichung erkannt; vollständige Reparatur läuft …', 'error');
                    return this.replaceFromV2Snapshot(config, generationId, 'hash-mismatch');
                  }
                  return { cursor: state.cursor, hash: null };
                }

                async syncPrivateV2(config, capabilities) {
                  return this.withCrossTabSyncLock(config.profileId, async () => {
                    let activeCapabilities = capabilities;
                    for (let attempt = 0; attempt < 2; attempt++) {
                      const generationId = activeCapabilities.generation_id || activeCapabilities.generationId;
                      if (!generationId) throw new Error('V2 server did not provide a generation ID.');
                      try {
                        const state = await db.syncState.get(config.profileId);
                        if (state?.generationId && state.generationId !== generationId) {
                          await this.replaceFromV2Snapshot(config, generationId, 'generation-reset');
                        } else if (
                          !state?.lastHash
                          && !state?.lastSnapshotAt
                          && !state?.lastHashVerifiedAt
                        ) {
                          await this.replaceFromV2Snapshot(config, generationId, 'initial-bootstrap');
                        } else if (!state?.generationId) {
                          await db.syncState.put({
                            ...(state || {}),
                            profileId: config.profileId,
                            mode: 'v2',
                            generationId,
                            cursor: Number(state?.cursor || 0)
                          });
                        }
                        const pushResult = await this.pushV2Outbox(
                          config,
                          generationId,
                          activeCapabilities
                        );
                        if (pushResult.rejected > 0) {
                          const rejectedState = await db.syncState.get(config.profileId) || {};
                          await db.syncState.put({
                            ...rejectedState,
                            profileId: config.profileId,
                            serverRepairRequired: true
                          });
                        }
                        if (pushResult.pushed > 0) {
                          const refreshedState = await db.syncState.get(config.profileId) || {};
                          await db.syncState.put({
                            ...refreshedState,
                            profileId: config.profileId,
                            remoteDeleteRecovery: false,
                            recoveryReleasedAt: Date.now()
                          });
                        }
                        let pullResult = pushResult.exchanged
                          ? { cursor: (await db.syncState.get(config.profileId))?.cursor || 0, hash: null }
                          : await this.pullV2Changes(config, generationId);
                        const repairState = await db.syncState.get(config.profileId) || {};
                        const oldConflictCount = await db.conflicts
                          .where('[profileId+status]')
                          .equals([config.profileId, 'open'])
                          .count();
                        if (oldConflictCount > 0) {
                          // Pre-2.1 conflicts used to block every later local
                          // mutation for the same product. Server state wins:
                          // discard those obsolete intents before repairing.
                          await db.transaction('rw', db.outbox, db.conflicts, async () => {
                            const conflicts = await db.conflicts
                              .where('[profileId+status]')
                              .equals([config.profileId, 'open'])
                              .toArray();
                            const blockedEntities = new Set(conflicts.map(conflict => (
                              `${conflict.entityType}\u0000${conflict.entityId}`
                            )));
                            const queued = await db.outbox
                              .where('profileId')
                              .equals(config.profileId)
                              .toArray();
                            for (const mutation of queued) {
                              if (blockedEntities.has(`${mutation.entityType}\u0000${mutation.entityId}`)) {
                                await db.outbox.delete(mutation.mutationId);
                              }
                            }
                          });
                        }
                        const remainingOutbox = await db.outbox
                          .where('profileId')
                          .equals(config.profileId)
                          .count();
                        if (
                          remainingOutbox === 0
                          && (repairState.serverRepairRequired || oldConflictCount > 0)
                        ) {
                          await db.conflicts.where('profileId').equals(config.profileId).delete();
                          await this.replaceFromV2Snapshot(
                            config,
                            generationId,
                            'server-rejected-auto-repair'
                          );
                          pullResult = await this.pullV2Changes(config, generationId);
                          const repairedState = await db.syncState.get(config.profileId) || {};
                          await db.syncState.put({
                            ...repairedState,
                            profileId: config.profileId,
                            serverRepairRequired: false
                          });
                        }
                        void this.scheduleDailyIntegritySnapshot(config, generationId).catch(error => {
                          console.warn('V2.1-Integritäts-Snapshot konnte nicht geplant werden:', error);
                        });
                        return { ...pushResult, pull: pullResult };
                      } catch (error) {
                        const code = error.responseData?.code;
                        if (attempt > 0) throw error;
                        if (code === 'base_revision_ahead') {
                          console.warn('VineTaxTools V2 mutation base is ahead of the server; repairing the local baseline.', {
                            currentRevision: error.responseData?.current_revision,
                            generationId
                          });
                          await this.replaceFromV2Snapshot(
                            config,
                            generationId,
                            'base-revision-ahead'
                          );
                          await this.rebaseAheadOutbox(
                            config,
                            error.responseData?.current_revision
                          );
                          continue;
                        }
                        if (error.responseData?.snapshot_required && code !== 'generation_mismatch') {
                          await this.replaceFromV2Snapshot(
                            config,
                            error.responseData?.generation_id || generationId,
                            code || 'cursor-reset'
                          );
                          continue;
                        }
                        if (code !== 'generation_mismatch') throw error;
                        console.warn('VineTaxTools server generation changed; refreshing capabilities.', {
                          previousGenerationId: generationId,
                          serverGenerationId: error.responseData?.generation_id || null
                        });
                        const refreshed = await this.detectPrivateProtocol(config, true);
                        if (refreshed.mode !== 'v2') throw error;
                        activeCapabilities = refreshed.capabilities;
                      }
                    }
                    throw new Error('V2 sync could not recover from a server generation change.');
                  });
                }

                async scheduleDailyIntegritySnapshot(config, generationId) {
                  const oneDay = 24 * 60 * 60 * 1000;
                  const state = await db.syncState.get(config.profileId);
                  if (
                    Date.now() - Number(state?.lastSnapshotAt || 0) < oneDay
                    || this.integritySnapshotScheduled.has(config.profileId)
                  ) return;
                  this.integritySnapshotScheduled.add(config.profileId);
                  const timer = setTimeout(() => {
                    void this.enqueue(() => this.withCrossTabSyncLock(config.profileId, async () => {
                      const currentState = await db.syncState.get(config.profileId);
                      if (Date.now() - Number(currentState?.lastSnapshotAt || 0) < oneDay) return;
                      const outboxCount = await db.outbox
                        .where('profileId')
                        .equals(config.profileId)
                        .count();
                      if (outboxCount > 0) return;
                      setProgress(
                        'Hintergrund-Synchronisierung läuft · Server-Vollstand wird geprüft …',
                        null,
                        'info'
                      );
                      await this.replaceFromV2Snapshot(
                        config,
                        currentState?.generationId || generationId,
                        'daily-integrity'
                      );
                      await this.pullV2Changes(
                        config,
                        (await db.syncState.get(config.profileId))?.generationId || generationId
                      );
                      setProgress('Alles synchronisiert · Hintergrundprüfung abgeschlossen.', 100, 'success');
                    })).catch(error => {
                      console.warn('Täglicher V2.1-Integritäts-Snapshot wurde verschoben:', error);
                      setProgress(
                        'Hintergrundprüfung verschoben · normale Änderungen bleiben lokal gespeichert.',
                        100,
                        'pending'
                      );
                    }).finally(() => {
                      this.integritySnapshotScheduled.delete(config.profileId);
                    });
                  }, 10_000);
                  if (typeof timer?.unref === 'function') timer.unref();
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

                getV1UploadSuppressionKey(config) {
                  return `PRIVATE_BACKEND_V1_UPLOAD_SUPPRESSED_${config.backendName}_${config.storageScope}`;
                }

                deleteDatabase(configSnapshot = null) {
                  return this.enqueue(async () => {
                    const config = configSnapshot || await this.getPrivateConfig();
                    if (!config) {
                      updateBackendStatusText("Privates Backend: kein Token konfiguriert.", "info");
                      return { skipped: true };
                    }
                    setProgress('Privates Backend: Daten werden gelöscht ...', 0);
                    return this.withCrossTabSyncLock(config.profileId, async () => {
                      try {
                        await this.postPrivate(config, "delete_all");
                        await this.clearPrivateSyncMarkers(config);
                        await db.transaction(
                          'rw',
                          db.syncState,
                          db.shadows,
                          db.outbox,
                          db.conflicts,
                          async () => {
                            const previousState = await db.syncState.get(config.profileId) || {};
                            await db.syncState.put({
                              ...previousState,
                              profileId: config.profileId,
                              capabilityCheckedAt: 0,
                              snapshotRequired: true,
                              remoteDeleteRecovery: true,
                              remoteDeletedAt: Date.now(),
                              lastError: null
                            });
                            await db.outbox.where('profileId').equals(config.profileId).delete();
                            await db.conflicts.where('profileId').equals(config.profileId).delete();
                          }
                        );
                        await setValue(this.getV1UploadSuppressionKey(config), true);
                        setProgress('Privates Backend: Daten gelöscht; lokale Sicherung bleibt erhalten.', 100, "success");
                        updateBackendStatusText(
                          "Privates Backend: Daten gelöscht. Die lokale Sicherung wird nicht automatisch erneut hochgeladen.",
                          "success"
                        );
                        return { deleted: true, localProductsPreserved: true };
                      } catch (error) {
                        setProgress(`Privates Backend: Löschen fehlgeschlagen (${error.message}).`, 100, "error");
                        updateBackendStatusText(`Privates Backend: Löschen fehlgeschlagen (${error.message}).`, "error");
                        throw error;
                      }
                    });
                  });
                }

                downloadDatabase(configSnapshot = null) {
                  return this.enqueue(async () => {
                    const config = configSnapshot || await this.getPrivateConfig();
                    if (!config) {
                      updateBackendStatusText("Privates Backend: kein Token konfiguriert.", "info");
                      return { skipped: true };
                    }

                    setProgress('Privates Backend: Serverdaten werden abgerufen ...', 0);
                    return this.withCrossTabSyncLock(config.profileId, async () => {
                      try {
                      const result = await this.postPrivate(config, "get_all");
                      if (!Array.isArray(result.data)) {
                        throw new Error('Private backend returned an invalid data list.');
                      }

                      const serverRecords = result.data.map((entry) => {
                        const asin = normalizeAsin(entry?.ASIN);
                        if (!asin || typeof entry?.value !== 'string') {
                          throw new Error('Private backend returned an invalid product entry.');
                        }
                        const timestamp = Number(entry.last_update_time);
                        if (!Number.isInteger(timestamp) || timestamp < 0) {
                          throw new Error(`Private backend returned an invalid timestamp for ${asin}.`);
                        }
                        const parsedProduct = parseStoredProductDate(entry.value, `server product ${asin}`);
                        return {
                          asin,
                          sourceAsin: entry.ASIN,
                          timestamp,
                          remoteValue: entry.value,
                          valueObject: parsedProduct
                        };
                      });
                      const entries = mergeCanonicalProductRecords(serverRecords).map(entry => ({
                        ...entry,
                        value: JSON.stringify(entry.valueObject),
                        remoteValue: JSON.stringify(entry.variants.map(variant => ({
                          ASIN: variant.sourceAsin,
                          timestamp: variant.timestamp,
                          value: variant.remoteValue
                        })))
                      }));
                      const corrections = entries.filter(entry => (
                        entry.variants.length > 1
                        || entry.variants.some(variant => variant.sourceAsin !== entry.asin)
                      ));
                      if (corrections.length > 0) {
                        await this.postPrivate(
                          config,
                          "update_asin",
                          corrections.map(entry => ({
                            ASIN: entry.asin,
                            timestamp: 0,
                            value: entry.value
                          }))
                        );
                      }

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
                        const remoteFingerprint = getStringFingerprint(entry.remoteValue);
                        const wasUpdated = await enqueueProductOperation(entry.asin, async () => {
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
                            return true;
                          }
                          return false;
                        });
                        if (wasUpdated) updated++;
                        else unchanged++;
                      }

                      setProgress(`Privates Backend: Download abgeschlossen (${updated} aktualisiert, ${unchanged} unverändert).`, 100, "success");
                      updateBackendStatusText(`Privates Backend: Download erfolgreich (${updated} aktualisiert, ${unchanged} unverändert).`, "success");
                      return { updated, unchanged, canonicalized: corrections.length };
                      } catch (error) {
                        setProgress(`Privates Backend: Download fehlgeschlagen (${error.message}).`, 100, "error");
                        updateBackendStatusText(`Privates Backend: Download fehlgeschlagen (${error.message}).`, "error");
                        throw error;
                      }
                    });
                  });
                }

                uploadLocalDatabase(configSnapshot = null) {
                  return this.enqueue(async () => {
                    const config = configSnapshot || await this.getPrivateConfig();
                    if (!config) {
                      updateBackendStatusText("Privates Backend: kein Token konfiguriert.", "info");
                      return { skipped: true };
                    }

                    setProgress('Privates Backend: Lokale Daten werden vorbereitet ...', 0);
                    return this.withCrossTabSyncLock(config.profileId, async () => {
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
                        const normalizedDate = normalizeOrderDate(parsedData.date);
                        if (!normalizedDate) {
                          invalidDates.push(parsedData.date);
                          continue;
                        }
                        parsedData.date = normalizedDate;
                        payload.push({ ASIN: asin, timestamp: 0, value: JSON.stringify(parsedData) });
                      }

                      if (payload.length === 0) {
                        updateBackendStatusText("Privates Backend: keine gültigen lokalen Produkte zum Hochladen.", "info");
                        return { uploaded: 0, invalidDates };
                      }

                      setProgress(`Privates Backend: ${payload.length} Produkte werden hochgeladen ...`, 0);
                      await this.postPrivate(config, "update_asin", payload);
                      await setValue(this.getV1UploadSuppressionKey(config), false);
                      const recoveryState = await db.syncState.get(config.profileId);
                      if (recoveryState?.remoteDeleteRecovery) {
                        await db.syncState.put({
                          ...recoveryState,
                          remoteDeleteRecovery: false,
                          recoveryReleasedAt: Date.now()
                        });
                      }
                      setProgress(`Privates Backend: ${payload.length} Produkte hochgeladen.`, 100, "success");
                      updateBackendStatusText(`Privates Backend: Upload erfolgreich (${payload.length} Produkte).`, "success");
                      return { uploaded: payload.length, invalidDates };
                      } catch (error) {
                        setProgress(`Privates Backend: Upload fehlgeschlagen (${error.message}).`, 100, "error");
                        updateBackendStatusText(`Privates Backend: Upload fehlgeschlagen (${error.message}).`, "error");
                        throw error;
                      }
                    });
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
                      if (responseData?.status !== 'success') {
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
                        await updateStoredProduct(asin, current => ({
                          ...current,
                          keepa: existingAsin.keepa,
                          teilwert: existingAsin.teilwert,
                          teilwert_v2: existingAsin.teilwert_v2,
                          pdf: existingAsin.pdf
                        }));
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
                      const protocol = await this.detectPrivateProtocol(config);
                      if (protocol.mode === 'v2') {
                        const result = await this.syncPrivateV2(config, protocol.capabilities);
                        const openConflictCount = await db.conflicts
                          .where('[profileId+status]')
                          .equals([config.profileId, 'open'])
                          .count();
                        setAutomaticSyncStep(
                          5,
                          openConflictCount > 0
                            ? `V2-Sync abgeschlossen; ${openConflictCount} Feldkonflikt(e) warten auf eine Entscheidung.`
                            : `V2-Sync abgeschlossen (${result.pushed} lokale Änderung(en) bestätigt).`,
                          1,
                          openConflictCount > 0 ? 'error' : 'info'
                        );
                        updateBackendStatusText(
                          openConflictCount > 0
                            ? `Privates Backend: V2 aktiv, ${openConflictCount} Konflikt(e).`
                            : 'Privates Backend: inkrementeller V2-Sync erfolgreich.',
                          openConflictCount > 0 ? 'error' : 'success'
                        );
                      } else if (await getValue(this.getV1UploadSuppressionKey(config), false)) {
                        setAutomaticSyncStep(
                          5,
                          'V1-Auto-Upload bleibt nach dem Löschen gesperrt; die lokale Sicherung liegt unverändert bereit.',
                          1
                        );
                        updateBackendStatusText(
                          'Privates Backend: lokale Sicherung vorhanden. Ein erneuter V1-Upload erfolgt nur manuell.',
                          'info'
                        );
                      } else {
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
                          await this.verifyAndAcknowledgeV1Outbox(
                            config,
                            privatePayload.map(entry => entry.ASIN)
                          );
                          setAutomaticSyncStep(
                            5,
                            `${privatePayload.length} Produkte wurden per kompatiblem V1-Full-Sync gesichert. Serverupdate für V2 verfügbar.`,
                            1
                          );
                        } else {
                          setAutomaticSyncStep(5, 'Keine privaten Produktdaten zum Hochladen.', 1);
                        }
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
                  this.syncRequestRevision++;
                  setProgress(
                    'Server-Synchronisierung läuft … Bitte diese Vine-Seite noch geöffnet lassen.',
                    null,
                    'info'
                  );
                  if (Array.isArray(products)) {
                    for (const product of products) {
                      const asin = normalizeAsin(product?.ASIN);
                      if (asin) {
                        this.pendingSyncProducts.set(asin, { ...product, ASIN: asin });
                      }
                    }
                  }
                  if (!this.syncInFlight) {
                    this.syncInFlight = this.enqueue(async () => {
                      try {
                        let result = { skipped: true };
                        const errors = [];
                        let handledRevision = -1;
                        do {
                          handledRevision = this.syncRequestRevision;
                          const batch = Array.from(this.pendingSyncProducts.values());
                          this.pendingSyncProducts.clear();
                          try {
                            result = await this.syncProductsBatch(batch);
                          } catch (error) {
                            errors.push(error instanceof Error ? error : new Error(String(error)));
                          }
                          await Promise.resolve();
                        } while (
                          this.pendingSyncProducts.size > 0
                          || handledRevision !== this.syncRequestRevision
                        );
                        if (errors.length === 1) throw errors[0];
                        if (errors.length > 1) {
                          const combinedError = new Error(
                            errors.map(error => error.message).join('; ')
                          );
                          combinedError.errors = errors;
                          throw combinedError;
                        }
                        const config = await this.getPrivateConfig();
                        if (config) {
                          const queued = await db.outbox
                            .where('profileId')
                            .equals(config.profileId)
                            .count();
                          if (queued > 0) {
                            setProgress(
                              `${queued} Änderung(en) sind noch lokal vorgemerkt. Die Synchronisierung wird erneut versucht.`,
                              100,
                              'pending'
                            );
                          } else {
                            const state = await db.syncState.get(config.profileId);
                            setProgress(
                              `Alles synchronisiert · Server-Revision ${Number(state?.cursor || 0)}.`,
                              100,
                              'success'
                            );
                          }
                        } else {
                          setProgress(
                            'Lokale Verarbeitung abgeschlossen · kein privates Backend eingerichtet.',
                            100,
                            'pending'
                          );
                        }
                        return result;
                      } catch (error) {
                        const config = await this.getPrivateConfig();
                        const queued = config
                          ? await db.outbox.where('profileId').equals(config.profileId).count()
                          : 0;
                        setProgress(
                          `Synchronisierung fehlgeschlagen · ${queued} Änderung(en) bleiben sicher lokal gespeichert.`,
                          100,
                          'error'
                        );
                        throw error;
                      } finally {
                        this.syncInFlight = null;
                      }
                    });
                  }
                  return this.syncInFlight;
                }

                async resolveV2Conflict(conflictId, resolution) {
                  let conflict = await db.conflicts.get(conflictId);
                  if (!conflict || conflict.status !== 'open') return { skipped: true };
                  const profileId = conflict.profileId;
                  const asin = normalizeAsin(conflict.entityId);
                  if (!asin) throw new Error('Konflikt enthält keine gültige ASIN.');
                  let skipped = false;
                  await db.transaction('rw', db.conflicts, db.products, db.shadows, db.outbox, async () => {
                    // Pulls and repair snapshots can refresh the server side of an
                    // open conflict. Re-read it under the same transaction that
                    // applies the user's decision so a stale dialog cannot win.
                    conflict = await db.conflicts.get(conflictId);
                    if (!conflict || conflict.status !== 'open') {
                      skipped = true;
                      return;
                    }
                    const relatedOutbox = (await db.outbox
                      .where('[profileId+entityType+entityId]')
                      .equals([profileId, 'product', asin])
                      .toArray())
                      .sort(compareOutboxMutationOrder);
                    for (const mutation of relatedOutbox) {
                      await db.outbox.delete(mutation.mutationId);
                    }
                    if (resolution === 'server') {
                      if (conflict.serverDeleted || conflict.serverRecord == null) {
                        await db.shadows.delete([profileId, 'product', asin]);
                        await db.products.delete([profileId, asin]);
                      } else {
                        const serverData = structuredCloneSafe(conflict.serverRecord);
                        await db.shadows.put({
                          profileId,
                          entityType: 'product',
                          entityId: asin,
                          recordRevision: Number(conflict.serverRevision || 0),
                          data: serverData,
                          updatedAt: Date.now()
                        });
                        await db.products.put(createProductRow(
                          profileId,
                          asin,
                          serverData,
                          Number(conflict.serverRevision || 0)
                        ));
                      }
                    } else if (resolution === 'local') {
                      const localRow = await db.products.get([profileId, asin]);
                      const hasPreservedLocalRecord = Object.prototype.hasOwnProperty.call(
                        conflict,
                        'localRecord'
                      );
                      const serverData = conflict.serverDeleted || conflict.serverRecord == null
                        ? {}
                        : structuredCloneSafe(conflict.serverRecord);
                      const intentMutations = [
                        ...(Array.isArray(conflict.mutations)
                          ? conflict.mutations
                          : conflict.mutation
                            ? [conflict.mutation]
                            : []),
                        ...(Array.isArray(conflict.localFollowupMutations)
                          ? conflict.localFollowupMutations
                          : []),
                        ...relatedOutbox
                      ];
                      let localData;
                      if (intentMutations.length > 0) {
                        localData = structuredCloneSafe(serverData);
                        for (const mutation of intentMutations) {
                          localData = applyOutboxMutation(localData || {}, mutation);
                        }
                      } else {
                        localData = hasPreservedLocalRecord
                          ? structuredCloneSafe(conflict.localRecord)
                          : structuredCloneSafe(localRow?.data ?? null);
                      }
                      if (conflict.serverDeleted || conflict.serverRecord == null) {
                        await db.shadows.delete([profileId, 'product', asin]);
                      } else {
                        await db.shadows.put({
                          profileId,
                          entityType: 'product',
                          entityId: asin,
                          recordRevision: Number(conflict.serverRevision || 0),
                          data: serverData,
                          updatedAt: Date.now()
                        });
                      }
                      const localDiff = localData == null
                        ? { set: {}, unset: [] }
                        : diffTopLevelFields(serverData, localData);
                      const needsMutation = localData == null
                        ? !conflict.serverDeleted
                        : Object.keys(localDiff.set).length > 0 || localDiff.unset.length > 0;
                      if (needsMutation) {
                        await db.outbox.put(createOutboxMutation({
                          profileId,
                          entityType: 'product',
                          entityId: asin,
                          baseRevision: Number(conflict.serverRevision || 0),
                          operation: localData == null ? 'delete' : 'patch',
                          set: localDiff.set,
                          unset: localDiff.unset,
                          source: 'conflict-resolution'
                        }));
                      }
                      if (localData == null) {
                        await db.products.delete([profileId, asin]);
                      } else {
                        await db.products.put(createProductRow(
                          profileId,
                          asin,
                          localData,
                          Number(conflict.serverRevision || 0)
                        ));
                      }
                    } else {
                      throw new Error('Unbekannte Konfliktentscheidung.');
                    }
                    await db.conflicts.update(conflictId, {
                      status: 'resolved',
                      resolution,
                      resolvedAt: Date.now()
                    });
                  });
                  if (skipped) return { skipped: true };
                  return { resolved: true, resolution };
                }

                async renderConflictPanel(container, config = null) {
                  const panel = container?.querySelector?.('#vtt-conflict-panel');
                  if (!panel) return;
                  const resolvedConfig = config || await this.getPrivateConfig();
                  if (!resolvedConfig) {
                    panel.hidden = true;
                    panel.replaceChildren();
                    return;
                  }
                  const conflicts = await db.conflicts
                    .where('[profileId+status]')
                    .equals([resolvedConfig.profileId, 'open'])
                    .toArray();
                  panel.hidden = conflicts.length === 0;
                  panel.replaceChildren();
                  if (conflicts.length === 0) return;
                  const title = document.createElement('h3');
                  title.className = 'vtt-section-title';
                  title.textContent = `Feldkonflikte (${conflicts.length})`;
                  panel.appendChild(title);
                  const help = document.createElement('p');
                  help.className = 'vtt-help-text';
                  help.textContent = 'Nicht kollidierende Felder wurden bereits zusammengeführt. Entscheide hier nur über dieselben parallel geänderten Felder.';
                  panel.appendChild(help);
                  for (const conflict of conflicts) {
                    const row = document.createElement('div');
                    row.className = 'vtt-callout';
                    const fields = Array.isArray(conflict.conflictFields)
                      ? conflict.conflictFields.join(', ')
                      : '';
                    row.innerHTML = `
                      <strong>${escapeHtml(conflict.entityId)}</strong>
                      <span class="vtt-help-text">Feld(er): ${escapeHtml(fields || 'Datensatz/Löschung')}</span>
                      <div class="vtt-button-group">
                        <button type="button" class="vtt-btn" data-resolution="server">Serverwert übernehmen</button>
                        <button type="button" class="vtt-btn vtt-btn-primary" data-resolution="local">Lokalen Wert erneut senden</button>
                      </div>
                    `;
                    row.querySelectorAll('[data-resolution]').forEach(button => {
                      button.addEventListener('click', async () => {
                        row.querySelectorAll('button').forEach(item => { item.disabled = true; });
                        try {
                          await this.resolveV2Conflict(conflict.id, button.dataset.resolution);
                          await this.renderConflictPanel(container, resolvedConfig);
                          await requestDashboardRefresh();
                        } catch (error) {
                          updateBackendStatusText(`Konflikt konnte nicht aufgelöst werden: ${error.message}`, 'error');
                          row.querySelectorAll('button').forEach(item => { item.disabled = false; });
                        }
                      });
                    });
                    panel.appendChild(row);
                  }
                }

                async createButtons() {
                  const container = document.createElement('div');
                  const token = await getValue('token');
                  const backendName = await getValue('pythonanywherebackend', 'hutaufvine');
                  const initialModel = getBackendUiModel(token, backendName);
                  container.className = 'vtt-dialog-section';
                  container.innerHTML = `
                    <div
                      id="backendConfigurationState"
                      class="vtt-backend-state"
                      data-backend-state="${escapeHtml(initialModel.state)}"
                    >
                      <span class="vtt-dot" aria-hidden="true"></span>${escapeHtml(initialModel.title)}
                    </div>

                    <div class="vtt-callout">
                      Das private Backend überträgt deine vollständigen Produktdaten automatisch an den
                      <a href="${VINE_PRODUCT_MANAGER_URL}" target="_blank" rel="noopener noreferrer"><strong>Vine-Produkt-Manager öffnen</strong></a>.
                      Der öffentliche Teilwertschätzer erhält weiterhin nur ASIN, Titel und ETV.
                    </div>

                    <div class="vtt-form-grid">
                      <label class="vtt-field" for="backendNameInput">
                        Backendname
                        <input
                          id="backendNameInput"
                          type="text"
                          value="${escapeHtml(initialModel.backendName)}"
                          autocomplete="off"
                          spellcheck="false"
                        >
                        <span class="vtt-help-text">PythonAnywhere-Benutzername; Standard ist hutaufvine.</span>
                      </label>
                      <label class="vtt-field" for="backendTokenInput">
                        Persönlicher Token
                        <input
                          id="backendTokenInput"
                          type="password"
                          value=""
                          autocomplete="new-password"
                          placeholder="${initialModel.configured ? 'Token ist hinterlegt – leer lassen, um ihn beizubehalten' : 'Persönlichen Token einfügen'}"
                        >
                        <span class="vtt-help-text">Der gespeicherte Token wird aus Sicherheitsgründen niemals angezeigt.</span>
                      </label>
                    </div>

                    <div class="vtt-button-group">
                      <button id="saveBackendButton" class="vtt-btn vtt-btn-primary" type="button">Konfiguration speichern</button>
                      <span id="backendLabel" class="vtt-help-text">Backend: ${escapeHtml(initialModel.backendName)}</span>
                    </div>

                    <div class="vtt-dialog-section">
                      <h3 class="vtt-section-title">Manuelle Synchronisation</h3>
                      <p class="vtt-help-text">
                        Normalerweise läuft der Voll-Sync automatisch. Diese Aktionen helfen bei einem Gerätewechsel oder zur Fehlerbehebung.
                      </p>
                      <div class="vtt-button-group">
                        <button id="uploadButton" class="vtt-btn" type="button"${initialModel.configured ? '' : ' disabled'}>Lokale Daten hochladen</button>
                        <button id="downloadButton" class="vtt-btn" type="button"${initialModel.configured ? '' : ' disabled'}>Serverdaten herunterladen</button>
                      </div>
                    </div>

                    <div id="backendStatus" role="status" aria-live="polite"></div>

                    <section id="vtt-conflict-panel" class="vtt-dialog-section" hidden></section>

                    <section class="vtt-danger-zone" aria-labelledby="vtt-danger-title">
                      <h4 id="vtt-danger-title">Danger Zone</h4>
                      <p>
                        Löscht alle Produktdaten auf deinem privaten Backend. Die lokalen Daten in diesem Browser bleiben erhalten.
                      </p>
                      <div>
                        <button id="deleteButton" class="vtt-btn vtt-btn-danger" type="button"${initialModel.configured ? '' : ' disabled'}>
                          Serverdaten unwiderruflich löschen
                        </button>
                      </div>
                    </section>
                  `;

                  await this.renderConflictPanel(container);

                  const actionButtons = Array.from(
                    container.querySelectorAll('#uploadButton, #downloadButton, #deleteButton')
                  );
                  let lastKnownConfigured = initialModel.configured;
                  const setBackendActionsBusy = (busy, configured = lastKnownConfigured) => {
                    backendUiBusy = busy;
                    if (!busy) lastKnownConfigured = Boolean(configured);
                    actionButtons.forEach(button => {
                      button.disabled = busy || !lastKnownConfigured;
                    });
                    for (const id of ['saveBackendButton', 'backendNameInput', 'backendTokenInput']) {
                      const control = container.querySelector(`#${id}`);
                      if (control) control.disabled = busy;
                    }
                  };
                  const refreshBackendStatusSafely = async () => {
                    try {
                      await refreshDashboardStatusCards();
                    } catch (error) {
                      console.error('Could not refresh private backend status:', error);
                      updateBackendStatusText(
                        `Backendstatus konnte nicht aktualisiert werden: ${error.message}`,
                        'error'
                      );
                    }
                  };

                  container.querySelector('#saveBackendButton').addEventListener('click', async () => {
                    const normalizedBackend = container.querySelector('#backendNameInput').value.trim().toLowerCase();
                    const newToken = container.querySelector('#backendTokenInput').value.trim();
                    if (!isValidBackendName(normalizedBackend)) {
                      alert('Ungültiger PythonAnywhere-Benutzername.');
                      return;
                    }
                    let configuredAfterSave = lastKnownConfigured;
                    setBackendActionsBusy(true);
                    try {
                      const existingToken = await getValue('token');
                      if (!newToken && !(typeof existingToken === 'string' && existingToken.trim())) {
                        updateBackendStatusText('Bitte zuerst einen persönlichen Token eintragen.', 'error');
                        container.querySelector('#backendTokenInput').focus();
                        return;
                      }
                      const effectiveToken = newToken || existingToken.trim();
                      const sourceProfileId = await getActiveProfileId();
                      const sourceProductCount = await db.products.where('profileId').equals(sourceProfileId).count();
                      if (
                        sourceProfileId === 'local-only'
                        && sourceProductCount > 0
                        && !confirm(
                          `${sourceProductCount} lokale Produkte werden in ein getrenntes Backendprofil kopiert. `
                          + 'Das lokale Ursprungsprofil bleibt als Sicherung erhalten. Fortfahren?'
                        )
                      ) {
                        return;
                      }
                      const binding = await bindLocalProfileToPrivateProfile(
                        sourceProfileId,
                        effectiveToken,
                        normalizedBackend
                      );
                      await this.enqueue(async () => {
                          await setValue('pythonanywherebackend', normalizedBackend);
                          if (newToken) await setValue('token', newToken);
                      });
                      configuredAfterSave = true;
                      container.querySelector('#backendNameInput').value = normalizedBackend;
                      container.querySelector('#backendTokenInput').value = '';
                      updateBackendStatusText(
                        binding.copied > 0
                          ? `Konfiguration gespeichert; ${binding.copied} lokale Produkte wurden sicher in das neue Profil kopiert.`
                          : 'Konfiguration gespeichert. Der nächste Sync verwendet diese Verbindung.',
                        'success'
                      );
                      await requestDashboardRefresh();
                      await this.renderConflictPanel(container);
                    } catch (error) {
                      console.error('Could not save private backend configuration:', error);
                      updateBackendStatusText(`Konfiguration konnte nicht gespeichert werden: ${error.message}`, 'error');
                    } finally {
                      setBackendActionsBusy(false, configuredAfterSave);
                      await refreshBackendStatusSafely();
                    }
                  });

                  container.querySelector('#uploadButton').addEventListener('click', async () => {
                    let config = null;
                    setBackendActionsBusy(true);
                    try {
                      config = await this.getPrivateConfig();
                      if (!config) {
                        updateBackendStatusText('Privates Backend: kein Token konfiguriert.', 'info');
                        return;
                      }
                      await this.uploadLocalDatabase(config);
                    } catch (error) {
                      console.error('Private backend upload failed:', error.message);
                    } finally {
                      setBackendActionsBusy(false, Boolean(config));
                      await refreshBackendStatusSafely();
                    }
                  });

                  container.querySelector('#downloadButton').addEventListener('click', async () => {
                    let config = null;
                    setBackendActionsBusy(true);
                    try {
                      config = await this.getPrivateConfig();
                      if (!config) {
                        updateBackendStatusText('Privates Backend: kein Token konfiguriert.', 'info');
                        return;
                      }
                      await this.downloadDatabase(config);
                      await requestDashboardRefresh();
                    } catch (error) {
                      console.error('Private backend download failed:', error.message);
                    } finally {
                      setBackendActionsBusy(false, Boolean(config));
                      await refreshBackendStatusSafely();
                    }
                  });

                  container.querySelector('#deleteButton').addEventListener('click', async () => {
                    let config = null;
                    setBackendActionsBusy(true);
                    try {
                      config = await this.getPrivateConfig();
                      if (!config) {
                        updateBackendStatusText('Privates Backend: kein Token konfiguriert.', 'info');
                        return;
                      }
                      if (!confirm(
                        `Danger Zone: Wirklich alle Produktdaten bei „${config.backendName}“ unwiderruflich löschen? `
                        + 'Die lokalen Daten in diesem Browser bleiben erhalten.'
                      )) return;
                      await this.deleteDatabase(config);
                    } catch (error) {
                      console.error('Private backend delete failed:', error.message);
                    } finally {
                      setBackendActionsBusy(false, Boolean(config));
                      await refreshBackendStatusSafely();
                    }
                  });

                  return container;
                }
              }

              const backendHandler = new PrivateBackendHandler();




              async function load_all_asin_etv_values_from_storage(progressOptions = null) {
                  const automaticSyncStep = progressOptions?.automaticSyncStep;
                  const shouldReportProgress = progressOptions !== false;
                  const updateLocalLoadProgress = (text, fraction) => {
                    if (!shouldReportProgress) return;
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
                      const normalizedDate = normalizeOrderDate(parsedData.date);
                      if (!normalizedDate) {
                        errorDates.push(parsedData.date);
                        continue;
                      }
                      parsedData.date = normalizedDate;

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
                progressBarContainer.setAttribute('aria-label', 'Fortschritt von VineTaxTools');
                progressBarContainer.setAttribute('aria-valuemin', '0');
                progressBarContainer.setAttribute('aria-valuemax', '100');
                progressBarContainer.setAttribute('aria-valuenow', '0');
                progressBarContainer.setAttribute('aria-valuetext', 'Vorbereitung läuft');
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
                    progressBarContainer.setAttribute('aria-valuetext', text);
                  },
                  setState: (state) => {
                    const safeState = ['info', 'success', 'pending', 'error'].includes(state) ? state : 'info';
                    progressBarContainer.dataset.state = safeState;
                    const palettes = {
                      info: ['#6f8fbd', '#eef3f8', '#a9cdf5', '#17365d'],
                      success: ['#86b89b', '#edf8f1', '#bfe3cc', '#175c35'],
                      pending: ['#d5a72e', '#fff8df', '#f3d87a', '#6f4b00'],
                      error: ['#d99a9a', '#fff1f1', '#efb3b3', '#8a1f1f']
                    };
                    const [border, background, fill, text] = palettes[safeState];
                    progressBarContainer.style.borderColor = border;
                    progressBarContainer.style.backgroundColor = background;
                    progressBarFill.style.backgroundColor = fill;
                    progressText.style.color = text;
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
                  if (document.getElementById('vine-data-extractor')) return;
                  const container = document.querySelector('#vvp-tax-information-container');
                  if (!container) {
                      setTimeout(createUI_taxextractor, 500);
                      return;
                  }
                  const progressBar = createSimpleProgressBar(container, true);
                  progressBarController = progressBar;
                  window.progressBar = progressBar;
                  const div = document.createElement('div');
                  setAutomaticSyncStep(1, 'Oberfläche wird aufgebaut ...', 0.1);
                  const settings = await getSettings();
                  div.innerHTML = `
                    <div id="vine-data-extractor" class="vtt-shell">
                      <header class="vtt-header">
                        <div class="vtt-brand">
                          <div class="vtt-brand-mark" aria-hidden="true">VT</div>
                          <div>
                            <h2 class="vtt-title">VineTaxTools</h2>
                            <p class="vtt-subtitle">Amazon-Vine-Daten sichern, synchronisieren und steuerlich auswerten.</p>
                          </div>
                        </div>
                        <nav class="vtt-header-actions" aria-label="VineTaxTools-Menü">
                          <button class="vtt-btn" type="button" data-vtt-open-dialog="vtt-data-dialog">Daten &amp; Backup</button>
                          <button class="vtt-btn" type="button" data-vtt-open-dialog="vtt-settings-dialog">Einstellungen</button>
                          <button class="vtt-btn" type="button" data-vtt-open-dialog="vtt-backend-dialog">Synchronisation</button>
                        </nav>
                      </header>

                      <div class="vtt-body">
                        <section class="vtt-status-grid" aria-label="Datenstatus">
                          <div class="vtt-status-card">
                            <span class="vtt-status-icon" aria-hidden="true">DB</span>
                            <span class="vtt-status-copy">
                              <span class="vtt-status-label">Lokaler Datenbestand</span>
                              <span id="vtt-storage-value" class="vtt-status-value">Wird ermittelt …</span>
                              <span id="vtt-storage-detail" class="vtt-status-detail">Dexie / IndexedDB in diesem Browser</span>
                            </span>
                          </div>
                          <button
                            id="vtt-backend-summary"
                            class="vtt-status-card"
                            type="button"
                            data-backend-state="local-only"
                            data-vtt-open-dialog="vtt-backend-dialog"
                          >
                            <span class="vtt-status-icon" aria-hidden="true">↕</span>
                            <span class="vtt-status-copy">
                              <span class="vtt-status-label">Privates Backend</span>
                              <span id="vtt-backend-value" class="vtt-status-value"><span class="vtt-dot" aria-hidden="true"></span>Status wird geprüft …</span>
                              <span id="vtt-backend-detail" class="vtt-status-detail">Konfiguration wird geladen.</span>
                            </span>
                          </button>
                        </section>

                        <aside id="vtt-local-only-warning" class="vtt-callout vtt-callout-warning">
                          <strong>Deine Produktdaten liegen derzeit nur in diesem Browser.</strong>
                          Exportiere regelmäßig ein Produktdaten-Backup oder richte die Synchronisation mit dem
                          <a href="${VINE_PRODUCT_MANAGER_URL}" target="_blank" rel="noopener noreferrer">Vine-Produkt-Manager</a> ein.
                          <button id="vtt-warning-export-db" class="vtt-btn" type="button">Jetzt Backup exportieren</button>
                        </aside>

                        <section class="vtt-panel" aria-labelledby="vtt-import-title">
                          <div class="vtt-panel-heading">
                            <div>
                              <h3 id="vtt-import-title" class="vtt-panel-title">
                                Amazon-Steuerdaten einlesen
                                <button
                                  class="vtt-info"
                                  type="button"
                                  aria-label="Hilfe zum Amazon-Import"
                                  data-help="Lädt den offiziellen Vine-Steuerbericht für das gewählte Jahr, ergänzt lokale Produkte und erkennt Stornierungen."
                                >i</button>
                              </h3>
                              <p class="vtt-panel-description">Wähle ein Jahr und aktualisiere deinen lokalen Datenbestand mit dem offiziellen XLSX-Bericht.</p>
                            </div>
                          </div>
                          <div class="vtt-import-grid">
                            <label class="vtt-field" for="load-xlsx-year">
                              Berichtsjahr
                              <select id="load-xlsx-year"></select>
                            </label>
                            <button id="load-xlsx-info" class="vtt-btn vtt-btn-primary" type="button">Amazon-Daten importieren</button>
                            <div class="vtt-action-row">
                              <button id="show-all-data" class="vtt-btn" type="button">Datentabelle anzeigen</button>
                              <button class="vtt-btn" type="button" data-vtt-open-dialog="vtt-data-dialog">Exporte öffnen</button>
                            </div>
                          </div>
                        </section>

                        <div id="sync-progress-slot"></div>
                        <div id="status" role="status" aria-live="polite"></div>

                        <details id="vtt-results-section" class="vtt-disclosure" open>
                          <summary>
                            <span>Auswertungen &amp; Diagramme</span>
                            <span class="vtt-summary-meta">Jahre und Ansichten einzeln aufklappbar</span>
                          </summary>
                          <div id="vtt-analysis-content" class="vtt-disclosure-body">
                            <div class="vtt-empty-state">Die Auswertung wird vorbereitet …</div>
                          </div>
                        </details>

                        <details id="vtt-data-section" class="vtt-disclosure">
                          <summary>
                            <span>Produktdatentabelle</span>
                            <span class="vtt-summary-meta">mit den aktuell gespeicherten Tabellenfiltern</span>
                          </summary>
                          <div class="vtt-disclosure-body">
                            <div id="vtt-table-filter-summary" class="vtt-filter-summary" aria-live="polite"></div>
                            <div id="data-table"></div>
                          </div>
                        </details>
                      </div>

                      <dialog id="vtt-settings-dialog" class="vtt-dialog" role="dialog" aria-modal="true" aria-labelledby="vtt-settings-title">
                        <header class="vtt-dialog-header">
                          <div>
                            <h2 id="vtt-settings-title" class="vtt-dialog-title">Filter &amp; Steuerregeln</h2>
                            <p class="vtt-dialog-subtitle">Änderungen werden gespeichert und offene Ansichten automatisch aktualisiert.</p>
                          </div>
                          <button class="vtt-dialog-close" type="button" data-vtt-close-dialog aria-label="Dialog schließen">×</button>
                        </header>
                        <div class="vtt-dialog-body">
                          <section class="vtt-dialog-section" aria-labelledby="vtt-table-filter-title">
                            <h3 id="vtt-table-filter-title" class="vtt-section-title">Tabellenfilter</h3>
                            <label class="vtt-field" for="yearFilter">
                              Angezeigtes Steuerjahr
                              <select id="yearFilter">${buildYearFilterOptionsHtml(settings)}</select>
                            </label>
                            <div class="vtt-settings-list">
                              <label class="vtt-setting-row">
                                <input type="checkbox" id="cancellations" ${settings.cancellations ? 'checked' : ''}>
                                <span>
                                  <span class="vtt-setting-label">Stornierungen in Tabelle und Exporten berücksichtigen</span>
                                  <span class="vtt-setting-description">Ausgeschaltet werden ASINs ausgeblendet, die der Amazon-Bericht als storniert erkannt hat.</span>
                                </span>
                              </label>
                              <label class="vtt-setting-row">
                                <input type="checkbox" id="tax0" ${settings.tax0 ? 'checked' : ''}>
                                <span>
                                  <span class="vtt-setting-label">Produkte mit 0 € ETV berücksichtigen</span>
                                  <span class="vtt-setting-description">Steuert Tabellenzeilen und gefilterte Exporte; Übersichtsdiagramme können 0-€-Produkte weiterhin separat zählen.</span>
                                </span>
                              </label>
                              <label class="vtt-setting-row">
                                <input type="checkbox" id="useTeilwertV2" ${settings.useTeilwertV2 ? 'checked' : ''}>
                                <span>
                                  <span class="vtt-setting-label">Teilwert V2 verwenden</span>
                                  <span class="vtt-setting-description">Nutzt den neueren Teilwert und dessen PDF-Nachweis, sofern vorhanden; manuelle Werte haben weiterhin Vorrang.</span>
                                </span>
                              </label>
                            </div>
                          </section>

                          <section class="vtt-dialog-section" aria-labelledby="vtt-evaluation-rules-title">
                            <h3 id="vtt-evaluation-rules-title" class="vtt-section-title">Auswertungsregeln</h3>
                            <p class="vtt-help-text">Diese Regeln verändern Berechnungen und Jahresauswertungen, aber nicht zwingend die Tabellenzeilen.</p>
                            <div class="vtt-settings-list">
                              <label class="vtt-setting-row">
                                <input type="checkbox" id="streuartikelregelung" ${settings.streuartikelregelung ? 'checked' : ''}>
                                <span>
                                  <span class="vtt-setting-label">Streuartikelregelung nach ETV anwenden</span>
                                  <span class="vtt-setting-description">Produkte mit einem ETV bis 11,90 € werden aus der Teilwert-/EÜR-Zusammenfassung ausgeschlossen.</span>
                                </span>
                              </label>
                              <label class="vtt-setting-row">
                                <input type="checkbox" id="streuartikelregelungTeilwert" ${settings.streuartikelregelungTeilwert ? 'checked' : ''}>
                                <span>
                                  <span class="vtt-setting-label">Streuartikelregelung auf Teilwert vor Oktober 2024</span>
                                  <span class="vtt-setting-description">Vor dem 01.10.2024 bleiben dort nur Produkte mit einem Teilwert über 11,90 € in der Zusammenfassung.</span>
                                </span>
                              </label>
                              <label class="vtt-setting-row">
                                <input type="checkbox" id="add2ndhalf2023to2024" ${settings.add2ndhalf2023to2024 ? 'checked' : ''}>
                                <span>
                                  <span class="vtt-setting-label">2. Jahreshälfte 2023 dem Steuerjahr 2024 zurechnen</span>
                                  <span class="vtt-setting-description">Juli bis Dezember 2023 werden in Tabellenfilter und Jahresauswertung dem Jahr 2024 zugeordnet.</span>
                                </span>
                              </label>
                              <label class="vtt-setting-row">
                                <input type="checkbox" id="einnahmezumteilwert" ${settings.einnahmezumteilwert ? 'checked' : ''}>
                                <span>
                                  <span class="vtt-setting-label">EÜR: Einnahme vor Oktober 2024 zum Teilwert</span>
                                  <span class="vtt-setting-description">Verwendet für die historische EÜR-Berechnung den Teilwert anstelle des ursprünglichen ETV.</span>
                                </span>
                              </label>
                            </div>
                          </section>
                          <p id="vtt-settings-summary" class="vtt-help-text"></p>
                        </div>
                      </dialog>

                      <dialog id="vtt-backend-dialog" class="vtt-dialog" role="dialog" aria-modal="true" aria-labelledby="vtt-backend-title">
                        <header class="vtt-dialog-header">
                          <div>
                            <h2 id="vtt-backend-title" class="vtt-dialog-title">Synchronisation &amp; Vine-Produkt-Manager</h2>
                            <p class="vtt-dialog-subtitle">Richte dein privates Backend ein oder führe eine manuelle Synchronisation aus.</p>
                          </div>
                          <button class="vtt-dialog-close" type="button" data-vtt-close-dialog aria-label="Dialog schließen">×</button>
                        </header>
                        <div id="vtt-backend-panel-slot" class="vtt-dialog-body"></div>
                      </dialog>

                      <dialog id="vtt-data-dialog" class="vtt-dialog" role="dialog" aria-modal="true" aria-labelledby="vtt-data-title">
                        <header class="vtt-dialog-header">
                          <div>
                            <h2 id="vtt-data-title" class="vtt-dialog-title">Daten, Backup &amp; Exporte</h2>
                            <p class="vtt-dialog-subtitle">Sichere lokale Produktdaten oder exportiere die aktuell gefilterte Ansicht.</p>
                          </div>
                          <button class="vtt-dialog-close" type="button" data-vtt-close-dialog aria-label="Dialog schließen">×</button>
                        </header>
                        <div class="vtt-dialog-body">
                          <section class="vtt-dialog-section">
                            <h3 class="vtt-section-title">Lokales Produktdaten-Backup</h3>
                            <p class="vtt-help-text">Das JSON-Backup enthält die gespeicherten ASIN-Produktobjekte. Token, Einstellungen und Sync-Metadaten werden nicht exportiert.</p>
                            <div class="vtt-button-group">
                              <button id="export-db" class="vtt-btn vtt-btn-primary" type="button">Produktdaten exportieren</button>
                              <button id="import-db" class="vtt-btn" type="button">Produktdaten importieren</button>
                            </div>
                          </section>
                          <section class="vtt-dialog-section">
                            <h3 class="vtt-section-title">Gefilterte Daten weiterverwenden</h3>
                            <p class="vtt-help-text">Diese Exporte verwenden die aktuell gespeicherten Tabellenfilter aus den Einstellungen.</p>
                            <div class="vtt-button-group">
                              <button id="export-xlsx" class="vtt-btn" type="button">Gefilterte XLSX exportieren</button>
                              <button id="copy-pdf-list" class="vtt-btn" type="button">PDF-Linkliste kopieren</button>
                            </div>
                          </section>
                        </div>
                      </dialog>
                    </div>
                `;
                        container.appendChild(div);
                        const progressSlot = div.querySelector('#sync-progress-slot');
                        if (progressSlot) {
                          progressSlot.appendChild(progressBar.element);
                        } else {
                          container.appendChild(progressBar.element);
                        }
                        setAutomaticSyncStep(1, 'Oberfläche und Sync-Einstellungen werden vorbereitet ...', 0.25);
                        const backendPanelSlot = div.querySelector('#vtt-backend-panel-slot');
                        backendPanelSlot.appendChild(await backendHandler.createButtons());
                        initializeDialogInteractions(div);
                        initializeInfoInteractions(div);
                        const dataSection = div.querySelector('#vtt-data-section');
                        dataSection?.addEventListener('toggle', () => {
                          if (!dataSection.open) return;
                          const dataTable = div.querySelector('#data-table');
                          if (dataTable?.dataset.rendered !== 'true') {
                            showAllData({ openSection: false }).catch(error => {
                              console.error('Could not render the product table after opening it:', error);
                              updateStatusMessage(
                                `Produktdatentabelle konnte nicht geladen werden: ${error.message}`,
                                'error'
                              );
                            });
                            return;
                          }
                          setTimeout(adjustExistingAsinDataTable, 0);
                        });
                        renderSettingsSummary(settings);
                        await refreshDashboardStatusCards();
                        const xlsxYearSelect = document.getElementById('load-xlsx-year');
                        initializeXlsxYearSelector(xlsxYearSelect).catch(error => {
                          console.warn('Amazon year selector initialization failed:', error);
                        });
                        setAutomaticSyncStep(
                          1,
                          'Vorbereitung abgeschlossen; die Jahresauswahl wird parallel aktualisiert.',
                          1
                        );

                        const booleanSettingIds = [
                          'cancellations',
                          'tax0',
                          'streuartikelregelung',
                          'streuartikelregelungTeilwert',
                          'add2ndhalf2023to2024',
                          'einnahmezumteilwert',
                          'useTeilwertV2'
                        ];
                        booleanSettingIds.forEach(settingId => {
                          document.getElementById(settingId).addEventListener('change', event => {
                            persistSettingAndRefresh(settingId, event.target.checked).catch(error => {
                              console.error(`Could not update setting ${settingId}:`, error);
                              updateStatusMessage(`Einstellung konnte nicht gespeichert werden: ${error.message}`, 'error');
                            });
                          });
                        });
                        document.getElementById('yearFilter').addEventListener('change', event => {
                          persistSettingAndRefresh('yearFilter', event.target.value).catch(error => {
                            console.error('Could not update year filter:', error);
                            updateStatusMessage(`Jahresfilter konnte nicht gespeichert werden: ${error.message}`, 'error');
                          });
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
                    updateStatusMessage(`Produktdaten-Backup exportiert (${Object.keys(asinDataAll).length} Produkte).`, 'success');
                });
                document.getElementById('vtt-warning-export-db').addEventListener('click', () => {
                  document.getElementById('export-db').click();
                });

                document.getElementById('export-xlsx').addEventListener('click', async () => {
                    let asinData = await load_all_asin_etv_values_from_storage(false);

                    const settings = await getSettings();

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
                    updateStatusMessage(`Gefilterte XLSX exportiert (${asinData.length} Produkte).`, 'success');
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
                                    await Promise.all(records.map(record => updateStoredProduct(
                                      record.key.slice(5),
                                      () => parseStoredProduct(record.value, `imported product ${record.key.slice(5)}`),
                                      { createIfMissing: true, source: 'json-import' }
                                    )));
                                    alert(`Produktdaten erfolgreich importiert (${records.length} Produkte).`);
                                    await requestDashboardRefresh();
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


                  setTimeout(async () => {
                    try {
                      document.getElementById('load-xlsx-info').addEventListener('click', loadXLSXInfo);
                      document.getElementById('show-all-data').addEventListener('click', showAllData);
                      document.getElementById('copy-pdf-list').addEventListener('click', copyPDFList);

                      setAutomaticSyncStep(2, 'Lokale Produktdaten werden geladen ...', 0);
                      let list = await load_all_asin_etv_values_from_storage({
                        automaticSyncStep: 2
                      });
                      // IndexedDB is the primary UI source. Render it immediately;
                      // the private backend refresh continues without blocking the dashboard.
                      requestDashboardRefresh();

                      let syncError = null;
                      try {
                        await backendHandler.syncProducts(list);
                      } catch (error) {
                        syncError = error;
                        console.error('Automatic account sync failed:', error);
                      }

                      // The estimator may have updated Teilwerte in IndexedDB. Re-read before rendering
                      // so the first dashboard already reflects the response from this sync.
                      list = await load_all_asin_etv_values_from_storage(false);
                      setAutomaticSyncStep(6, 'Jahresauswertungen und aufklappbare Ansichten werden vorbereitet ...', 0);
                      requestDashboardRefresh();
                      await waitForDashboardRefreshIdle();
                      setAutomaticSyncStep(6, 'Lokale Auswertungen sind bereit; Diagramme laden beim Aufklappen.', 1);

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

  async function createLazyAnalysisSection(parentElement, options) {
      const details = document.createElement('details');
      details.className = 'vtt-disclosure vtt-analysis-section';
      details.id = options.id;
      details.open = Boolean(options.open);

      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.textContent = options.title;
      summary.appendChild(title);
      details.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'vtt-chart-content';
      if (options.description) {
          const description = document.createElement('p');
          description.className = 'vtt-panel-description';
          description.textContent = options.description;
          content.appendChild(description);
      }
      details.appendChild(content);
      parentElement.appendChild(details);

      let renderPromise = null;
      const renderOnce = () => {
          if (typeof options.isCurrent === 'function' && !options.isCurrent()) {
              details.dataset.renderState = 'stale';
              return Promise.resolve({ stale: true });
          }
          if (renderPromise) {
              renderPromise.then(() => {
                  const plot = content.querySelector('.js-plotly-plot');
                  if (plot && globalThis.Plotly?.Plots?.resize) Plotly.Plots.resize(plot);
              }).catch(() => undefined);
              return renderPromise;
          }
          details.dataset.renderState = 'loading';
          const loading = document.createElement('div');
          loading.className = 'vtt-empty-state';
          loading.textContent = 'Ansicht wird geladen …';
          content.appendChild(loading);
          renderPromise = Promise.resolve()
              .then(() => options.render(content))
              .then(() => {
                  loading.remove();
                  if (typeof options.isCurrent === 'function' && !options.isCurrent()) {
                      if (globalThis.Plotly?.purge) {
                          content.querySelectorAll('.js-plotly-plot').forEach(plot => Plotly.purge(plot));
                      }
                      details.dataset.renderState = 'stale';
                      return { stale: true };
                  }
                  details.dataset.renderState = 'ready';
                  return { rendered: true };
              })
              .catch(error => {
                  console.error(`Could not render ${options.title}:`, error);
                  loading.textContent = `Diese Ansicht konnte nicht aufgebaut werden: ${error.message}`;
                  details.dataset.renderState = 'error';
                  throw error;
              });
          return renderPromise;
      };

      details.addEventListener('toggle', () => {
          if (details.open) renderOnce().catch(() => undefined);
      });
      if (details.open) await renderOnce().catch(() => undefined);
      return details;
  }

  async function createYearlyBreakdown(list) {
      const container = document.getElementById('vtt-analysis-content');
      if (!container) return;
      const renderRevision = ++analysisRenderRevision;
      const isCurrent = () => (
          renderRevision === analysisRenderRevision
          && document.getElementById('vtt-analysis-content') === container
      );
      const nextContent = document.createDocumentFragment();
      const settings = await getSettings();
      if (!isCurrent()) return { stale: true };
      const sortedItems = list.map(item => ({
          ...item,
          date: parseDateSafe(item.date)
      })).filter(item => item.date).sort((a, b) => a.date - b.date);

      const yearSet = new Set(sortedItems.map(item => item.date.getUTCFullYear()));
      if (
          settings.add2ndhalf2023to2024
          && sortedItems.some(item => item.date.getUTCFullYear() === 2023 && item.date.getUTCMonth() >= 6)
      ) {
          yearSet.add(2024);
      }
      const years = [...yearSet]
          .filter(year => {
              if (settings.yearFilter === 'show current year') {
                  return year === new Date().getFullYear();
              }
              if (settings.yearFilter === 'show all years') return true;
              return settings.yearFilter === `only ${year}`;
          })
          .sort((a, b) => a - b);

      const yearEntries = years.map(year => {
          let items;
          if (settings.add2ndhalf2023to2024) {
              if (year === 2023) {
                  items = sortedItems.filter(item => (
                      item.date.getUTCFullYear() === 2023
                      && item.date.getUTCMonth() < 6
                  ));
              } else if (year === 2024) {
                  items = sortedItems.filter(item => (
                      item.date.getUTCFullYear() === 2024
                      || (item.date.getUTCFullYear() === 2023 && item.date.getUTCMonth() >= 6)
                  ));
              } else {
                  items = sortedItems.filter(item => item.date.getUTCFullYear() === year);
              }
          } else {
              items = sortedItems.filter(item => item.date.getUTCFullYear() === year);
          }
          return { year, items };
      }).filter(entry => entry.items.length > 0);

      if (yearEntries.length === 0) {
          const emptyState = document.createElement('div');
          emptyState.className = 'vtt-empty-state';
          emptyState.textContent = 'Für den gewählten Jahresfilter sind noch keine Produktdaten vorhanden.';
          nextContent.appendChild(emptyState);
          if (!isCurrent()) return { stale: true };
          if (globalThis.Plotly?.purge) {
              container.querySelectorAll('.js-plotly-plot').forEach(plot => Plotly.purge(plot));
          }
          container.replaceChildren(nextContent);
          return { rendered: true };
      }

      const latestVisibleYear = yearEntries[yearEntries.length - 1].year;
      for (const { year, items: yearlyItems } of yearEntries) {
          if (!isCurrent()) return { stale: true };
          const yearContainer = document.createElement('details');
          yearContainer.id = `year-container-${year}`;
          yearContainer.className = 'vtt-disclosure vtt-year-card';
          yearContainer.open = year === latestVisibleYear;

          const yearSummary = document.createElement('summary');
          const yearTitle = document.createElement('span');
          yearTitle.textContent = `Steuerjahr ${year}`;
          const yearMeta = document.createElement('span');
          yearMeta.className = 'vtt-summary-meta';
          yearMeta.textContent = `${yearlyItems.length.toLocaleString('de-DE')} ${yearlyItems.length === 1 ? 'Produkt' : 'Produkte'}`;
          yearSummary.append(yearTitle, yearMeta);
          yearContainer.appendChild(yearSummary);

          const yearBody = document.createElement('div');
          yearBody.className = 'vtt-disclosure-body';
          yearContainer.appendChild(yearBody);
          nextContent.appendChild(yearContainer);

          const summaryOpen = year === latestVisibleYear;
          await createLazyAnalysisSection(yearBody, {
              id: `vtt-tax-summary-${year}`,
              title: 'Teilwert- und EÜR-Zusammenfassung',
              description: 'Berechnet Teilwerte und die EÜR-Werte mit den aktuell gespeicherten Auswertungsregeln.',
              open: summaryOpen,
              isCurrent,
              render: target => createTeilwertSummaryTable(yearlyItems, target)
          });
          await createLazyAnalysisSection(yearBody, {
              id: `vtt-product-distribution-${year}`,
              title: 'Produktverteilung',
              description: 'Zeigt Stornierungen, 0-€-ETV sowie vorhandene und fehlende Teilwerte.',
              isCurrent,
              render: target => createPieChart(yearlyItems, target)
          });
          let targetDate = new Date(Date.UTC(year, 11, 31));
          if (year === 2023 && settings.add2ndhalf2023to2024) {
              targetDate = new Date(Date.UTC(year, 5, 30));
          }
          await createLazyAnalysisSection(yearBody, {
              id: `vtt-etv-plot-${year}`,
              title: 'ETV- und Teilwertverlauf',
              description: 'Kumulierte Entwicklung im Steuerjahr mit einer einfachen Hochrechnung bis zum Jahresende.',
              isCurrent,
              render: target => createETVPlot(year, yearlyItems, targetDate, target)
          });
          await createLazyAnalysisSection(yearBody, {
              id: `vtt-cancellation-ratio-${year}`,
              title: 'Stornoquote',
              description: 'Vergleicht erkannte Stornierungen mit allen Bestellungen dieses Auswertungszeitraums.',
              isCurrent,
              render: target => createCancellationRatioTable(yearlyItems, target)
          });
      }
      if (!isCurrent()) return { stale: true };
      if (globalThis.Plotly?.purge) {
          container.querySelectorAll('.js-plotly-plot').forEach(plot => Plotly.purge(plot));
      }
      container.replaceChildren(nextContent);
      return { rendered: true };
  }

  async function createETVPlot(taxYear, items, endDate, parentElement) {
    const cancelledAsins = await getValue("cancellations", []);
    const settings = await getSettings();
    // Filter out items with etv === 0
    const filteredItems = items.filter(item => !cancelledAsins.includes(item.ASIN) && item.etv > 0);

    if (filteredItems.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'vtt-empty-state';
        emptyState.textContent = 'Für diesen Zeitraum sind keine nicht stornierten Produkte mit positivem ETV vorhanden.';
        parentElement.appendChild(emptyState);
        return;
    }

    const dataByDateMap = new Map();
    let currentEtv = 0;
    filteredItems.forEach(d => {
        const dateKey = normalizeOrderDate(d.date);
        currentEtv += d.etv;
        dataByDateMap.set(dateKey, currentEtv);
    });

    const dataByDate = Array.from(dataByDateMap, ([date, etv]) => ({ date: parseDateSafe(date), etv }));

    const historicalTrace = {
        x: dataByDate.map(d => d.date),
        y: dataByDate.map(d => d.etv),
        mode: 'lines',
        type: 'scatter',
        name: 'Bisheriger ETV',
        line: { color: 'steelblue' }
    };

    const firstPoint = dataByDate[0];
    const lastPoint = dataByDate[dataByDate.length - 1];
    const observedDuration = lastPoint.date - firstPoint.date;
    const remainingDuration = Math.max(0, endDate - lastPoint.date);
    const projectedEtv = observedDuration > 0
      ? lastPoint.etv + (lastPoint.etv - firstPoint.etv) * (remainingDuration / observedDuration)
      : lastPoint.etv;

    const projectionData = [
        { date: lastPoint.date, etv: lastPoint.etv },
        { date: endDate, etv: projectedEtv }
    ];

    const projectionTrace = {
        x: projectionData.map(d => d.date),
        y: projectionData.map(d => d.etv),
        mode: 'lines',
        type: 'scatter',
        name: 'ETV-Hochrechnung',
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
        const validRatios = teilwertEtvRatios.filter(ratio => Number.isFinite(ratio));
        if (validRatios.length > 0) {
            const avgTeilwertEtvRatio = validRatios.reduce((sum, ratio) => sum + ratio, 0) / validRatios.length;

            if (avgTeilwertEtvRatio >= 0.01 && avgTeilwertEtvRatio <= 0.5) {
                const teilwertDataMap = new Map();
                let currentTeilwert = 0;
                filteredItems.forEach(d => {
                    const dateKey = normalizeOrderDate(d.date);
                    let use_teilwert = getTeilwert(d, settings);
                    currentTeilwert += (use_teilwert != null ? use_teilwert : (d.etv * avgTeilwertEtvRatio));
                    teilwertDataMap.set(dateKey, currentTeilwert);
                });
                const teilwertData = Array.from(teilwertDataMap, ([date, teilwert]) => ({ date: parseDateSafe(date), teilwert }));

                const teilwertTrace = {
                    x: teilwertData.map(d => d.date),
                    y: teilwertData.map(d => d.teilwert),
                    mode: 'lines',
                    type: 'scatter',
                    name: 'Bisheriger + geschätzter Teilwert',
                    line: { color: 'green' }
                };
                data.push(teilwertTrace);
            }
        }
    }

    const layout = {
        title: `ETV- und Teilwertverlauf ${taxYear}`,
        autosize: true,
        height: 380,
        xaxis: {
            title: 'Datum',
            tickformat: '%b %d',
            range: [firstPoint.date, endDate],
            tickangle: -45
        },
        yaxis: {
            title: 'Wert in Euro',
            autorange: true
        },
        margin: {
            t: 40,
            r: 30,
            b: 80,
            l: 60
        },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: '#ffffff'
    };

    const containerId = `plot-container-${taxYear}`;
    const newDiv = document.createElement('div');
    newDiv.id = containerId;
    newDiv.style.width = '100%';
    newDiv.style.minHeight = '380px';
    parentElement.appendChild(newDiv);

    await Plotly.newPlot(newDiv, data, layout, {
      responsive: true,
      displaylogo: false
    });
}

async function createPieChart(list, parentElement) {
    const cancelledAsins = await getValue("cancellations", []);
    const settings = await getSettings();

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
        { category: 'Stornierungen', count: counts.cancellations },
        { category: 'ETV 0 €', count: counts.tax0 },
        { category: 'Teilwert vorhanden', count: counts.teilwertAvailable },
        { category: 'Teilwert fehlt', count: counts.teilwertMissing }
    ];

    const width = 600, height = 300, margin = 40;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(parentElement).append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('role', 'img')
        .attr('aria-label', 'Verteilung der Produkte nach Stornierung, ETV und Teilwert')
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

    const settings = await getSettings();

    if (settings.streuartikelregelung) {
        filteredList = filteredList.filter(item => item.etv > 11.90);
    }

    if (settings.streuartikelregelungTeilwert) {
        filteredList = filteredList.filter(item => {
            const orderDate = parseDateSafe(item.date);
            let use_teilwert = getTeilwert(item, settings);
            return (orderDate && orderDate >= new Date(Date.UTC(2024, 9, 1))) || use_teilwert > 11.90;
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
                      { label: 'Bekannter Teilwert gesamt', value: totalTeilwert.toFixed(2) },
                      { label: 'Geschätzter fehlender Teilwert', value: estimatedTeilwert.toFixed(2) },
                      { label: 'Geschätzter Teilwert gesamt', value: overallTeilwert.toFixed(2) }
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
                  const notice = document.createElement('div');
                  notice.className = 'vtt-empty-state';
                  notice.textContent = 'Die vorhandenen Teilwertdaten reichen noch nicht für eine verlässliche Gesamtschätzung.';
                  parentElement.appendChild(notice);
              }
          } else {
              const notice = document.createElement('div');
              notice.className = 'vtt-empty-state';
              notice.textContent = 'Es sind noch nicht genügend gültige Teilwerte für eine Schätzung vorhanden.';
              parentElement.appendChild(notice);
          }
      } else {
          const notice = document.createElement('div');
          notice.className = 'vtt-empty-state';
          notice.textContent = `Für eine belastbare Schätzung werden mindestens 10 Produkte mit Teilwert benötigt; aktuell sind es ${itemsWithTeilwert.length}.`;
          parentElement.appendChild(notice);
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
                        const normalizedDate = normalizeOrderDate(orderDate);
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
                        if (!asin || !orderNumber || !normalizedDate || !Number.isFinite(etv)) {
                            errors.push(orderDate || 'Unlesbare Bestellzeile');
                            continue;
                        }
                        data[asin] = {
                            name: productName,
                            ordernumber: orderNumber,
                            date: normalizedDate,
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
                      const normalizedDate = normalizeOrderDate(orderDate);
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
                              date: normalizedDate || orderDate,
                              etv: etv
                          };
                          if (!normalizedDate) {
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
                      const updatedData = await updateStoredProduct(
                        asin,
                        current => ({ ...current, ...value }),
                        { createIfMissing: true }
                      );
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
                   } finally {
                       requestDashboardRefresh().catch(refreshError => {
                         console.error('Could not refresh the dashboard after XLSX import:', refreshError);
                       });
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
                    } finally {
                        requestDashboardRefresh().catch(refreshError => {
                          console.error('Could not refresh the dashboard after order import:', refreshError);
                        });
                    }
                }

  function createUIorderpage() {
      const container = document.querySelector('.a-normal.vvp-orders-table');
        if (!container) {
            setTimeout(createUIorderpage, 1000);
            return;
        }
      const progressBar = createSimpleProgressBar(container.parentNode);
      progressBarController = progressBar;
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
        const asinData = await load_all_asin_etv_values_from_storage(false);
        const settings = await getSettings();
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
        updateStatusMessage(`PDF-Linkliste kopiert (${pdfList.length} Links).`, 'success');
  }

  function destroyExistingAsinDataTable() {
      if (
          typeof $ === 'function'
          && $.fn?.DataTable
          && typeof $.fn.DataTable.isDataTable === 'function'
          && $.fn.DataTable.isDataTable('#asin-table')
      ) {
          $('#asin-table').DataTable().destroy();
      }
  }

  function adjustExistingAsinDataTable() {
      if (
          typeof $ === 'function'
          && $.fn?.DataTable
          && typeof $.fn.DataTable.isDataTable === 'function'
          && $.fn.DataTable.isDataTable('#asin-table')
      ) {
          $('#asin-table').DataTable().columns.adjust().draw(false);
      }
  }

  async function showAllData(options = {}) {
    installTeilwertOutsideClickHandler();

      const dataTableDiv = document.getElementById('data-table');
      if (!dataTableDiv) return;
      const renderRevision = ++tableRenderRevision;
      const isCurrent = () => (
        renderRevision === tableRenderRevision
        && document.getElementById('data-table') === dataTableDiv
      );
      if (options.openSection !== false) {
          const dataSection = document.getElementById('vtt-data-section');
          if (dataSection) dataSection.open = true;
      }
      const hadRenderedTable = dataTableDiv.dataset.rendered === 'true';
      dataTableDiv.dataset.rendered = 'true';
      dataTableDiv.setAttribute('aria-busy', 'true');
      if (!hadRenderedTable) {
          dataTableDiv.innerHTML = '<div class="vtt-empty-state">Produktdaten werden geladen …</div>';
      }

      try {
          const allAsinData = Array.isArray(options.sourceData)
            ? options.sourceData
            : await load_all_asin_etv_values_from_storage(false);
          if (!isCurrent()) return { stale: true };
          const settings = await getSettings();
          if (!isCurrent()) return { stale: true };

        let cancellations = await getValue('cancellations', []);
        if (!isCurrent()) return { stale: true };
        const asinData = applyDisplayFilters(allAsinData, settings, cancellations);

          if (asinData.length === 0) {
              destroyExistingAsinDataTable();
              renderTableFilterSummary(settings, allAsinData.length, asinData.length);
              dataTableDiv.innerHTML = '<div class="vtt-empty-state">Mit diesen Tabellenfiltern wurden keine Produkte gefunden.</div>';
              return { rendered: true };
          }

          let table = `<table id="asin-table" class="display" cellspacing="0" cellpadding="5">
                          <thead>
                              <tr>
                                  <th>ASIN</th>
                                  <th>Datum</th>
                                  <th>Produkt</th>
                                  <th>ETV</th>
                                  <th>Keepa</th>
                                  <th>Teilwert</th>
                                  <th>PDF-Nachweis</th>
                                  <th>Amazon</th>
                                  <th>Rezension</th>
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
                          <td style="white-space: nowrap;">${escapeHtml(item.date || 'N/A')}</td>
                          <td>${escapeHtml(item.name || 'N/A')}</td>
                          <td>${escapeHtml(item.etv)}</td>
                          <td>${item.keepa != null ? `<a href="https://keepa.com/#!product/3-${asin}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.keepa)}</a>` : 'N/A'}</td>
                          <td id="teilwert_for_asin_${asin}" data-order="${escapeHtml(getTeilwert(item, settings) ?? 0)}">
                              <button type="button" class="vtt-table-link" aria-label="Teilwert für ${asin} bearbeiten">
                                  ${teilwertDisplay}
                              </button>
                          </td>
                          <td>${pdfLink ? `<a href="${escapeHtml(pdfLink)}" target="_blank" rel="noopener noreferrer">PDF öffnen</a>` : 'N/A'}</td>
                          <td><a href="https://www.amazon.de/dp/${asin}" target="_blank" rel="noopener noreferrer">Produkt öffnen</a></td>
                          <td><a href="https://www.amazon.de/review/create-review?encoding=UTF&amp;asin=${asin}" target="_blank" rel="noopener noreferrer">Rezension öffnen</a></td>
                      </tr>`;
          });

          table += `</tbody>
                  </table>`;

          if (!isCurrent()) return { stale: true };
          destroyExistingAsinDataTable();
          renderTableFilterSummary(settings, allAsinData.length, asinData.length);
          dataTableDiv.innerHTML = table;
          if (typeof $ === 'function' && $.fn?.DataTable) {
              $('#asin-table').DataTable({
                  lengthMenu: [10, 25, 50, 100, 1000000],
                  language: {
                      search: 'Tabelle durchsuchen:',
                      lengthMenu: '_MENU_ Einträge pro Seite',
                      info: '_START_–_END_ von _TOTAL_ Produkten',
                      infoEmpty: 'Keine Produkte',
                      zeroRecords: 'Keine passenden Produkte gefunden',
                      paginate: { previous: 'Zurück', next: 'Weiter' }
                  }
              });
          }


        async function showTeilwertPopup(item) {

            let existingOverlay = document.getElementById('teilwert-overlay');
            if (existingOverlay) {
                existingOverlay.remove();
            }

            const asin = item.ASIN;
            const settings = await getSettings();
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
                <p>Date: ${escapeHtml(item.date || 'N/A')}</p>
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
                { id: 'verkauft', label: 'Verkauft', status: 'verkauft' },
                { id: 'lager', label: 'Lager', status: 'Lager' },
                { id: 'entsorgt', label: 'Entsorgt', status: 'entsorgt' },
                { id: 'storniert', label: 'Storniert', status: 'storniert' },
                { id: 'betriebsausgabe', label: 'Betriebsausgabe', status: 'betriebliche Nutzung' }
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
                    const checked = event.target.checked;
                    const updatedProduct = await updateStoredProduct(asin, current => {
                      const hasDefekt = current.usageStatus.includes('defekt');
                      current.usageStatus = checked
                        ? [checkbox.status, ...(hasDefekt ? ['defekt'] : [])]
                        : (hasDefekt ? ['defekt'] : []);
                    });
                    if (checked) {
                      for (const other of checkboxes) {
                        if (other.id !== checkbox.id) {
                          document.getElementById(other.id).checked = false;
                        }
                      }
                    }
                    if (updatedProduct) {
                      try {
                        await backendHandler.syncProducts([{ ...updatedProduct, ASIN: asin }]);
                      } catch (error) {
                        console.error('Immediate status sync failed; outbox remains durable:', error);
                      }
                    }
                    await requestDashboardRefresh();
                });
            });

            document.getElementById('angepasster-teilwert').addEventListener('change', async (event) => {
                const input = event.target.value.trim().replace(',', '.');
                if (input === '') {
                    const updatedProduct = await updateStoredProduct(asin, current => {
                      current.myteilwert = null;
                      current.myTeilwert = null;
                    });
                    if (updatedProduct) {
                      try {
                        await backendHandler.syncProducts([{ ...updatedProduct, ASIN: asin }]);
                      } catch (error) {
                        console.error('Immediate valuation sync failed; outbox remains durable:', error);
                      }
                    }
                    await requestDashboardRefresh();
                    return;
                }
                const value = Number(input);
                if (Number.isFinite(value) && value >= 0) {
                    const updatedProduct = await updateStoredProduct(asin, current => {
                      current.myteilwert = value;
                      current.myTeilwert = value;
                    });
                    if (updatedProduct) {
                      try {
                        await backendHandler.syncProducts([{ ...updatedProduct, ASIN: asin }]);
                      } catch (error) {
                        console.error('Immediate valuation sync failed; outbox remains durable:', error);
                      }
                    }
                    await requestDashboardRefresh();
                } else {
                    alert('Bitte einen gültigen, nicht negativen Teilwert eingeben.');
                    const latest = parseStoredProduct(
                      await getValue(`ASIN_${asin}`),
                      `local product ${asin}`
                    );
                    event.target.value = latest.myteilwert ?? '';
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
          if (isCurrent()) {
              if (!hadRenderedTable) {
                  dataTableDiv.textContent = `Produktdaten konnten nicht geladen werden: ${error.message}`;
              }
              updateStatusMessage(`Produktdatentabelle konnte nicht aktualisiert werden: ${error.message}`, 'error');
          }
      } finally {
          if (isCurrent()) dataTableDiv.removeAttribute('aria-busy');
      }
  }



  async function createCancellationRatioTable(list, parentElement) {
      const yearlyData = {};
      const cancelledAsins = await getValue("cancellations", []);

      list.forEach(item => {

          const year = item.date.getUTCFullYear();

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
          .data(['Jahr', 'Bestellungen', 'Stornierungen', 'Stornoquote'])
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
                      db,
                      bindLocalProfileToPrivateProfile,
                      buildYearFilterOptionsHtml,
                      buildLocalProfileId,
                      calculateEuerValues,
                      canonicalizeJson,
                      createOutboxMutation,
                      createProductRow,
                      createUI_taxextractor,
                      escapeHtml,
                      etvstrtofloat,
                      extractData,
                      formatByteSize,
                      getBackendUiModel,
                      getActiveProfileId,
                      getEvaluationRuleLabels,
                      getLocalProductDatabaseStats,
                      getPrivateBackendUrl,
                      getSettings,
                      getTableFilterLabels,
                      getTeilwert,
                      getUtf8ByteLength,
                      gmRequest,
                      isValidBackendName,
                      normalizeAsin,
                      normalizeOrderDate,
                      normalizeSettings,
                      parseOrderDateParts,
                      parseDateSafe,
                      parseStoredProduct,
                      postJson,
                      refreshDashboardStatusCards,
                      saveData,
                      sha256Hex,
                      setAutomaticSyncStep,
                      setValue,
                      showAllData,
                      updateStoredProduct,
                      getValue,
                      validateAndFixDatabase,
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
