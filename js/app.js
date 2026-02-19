// ============================================================
// app.js  –  Main application logic for JSPlaskin
// ============================================================

import { HDF5Data, DirectoryData } from './data.js';

// ---- Constants ----

const COLOR_SERIES = [
  '#5555ff', '#ff5555', '#909090', '#ff55ff', '#008800',
  '#8d0ade', '#33bbcc', '#cc6600', '#444400', '#7777ff', '#77ff77'
];
const LINE_WIDTH   = 1.7;
const DENS_THRESHOLD = 1e-10;
const RATE_THRESHOLD = 1e-20;

const CONDITIONS_PRETTY = {
  gas_temperature:         'Gas temperature [K]',
  Tgas_K:                  'Gas temperature [K]',
  reduced_field:           'Reduced field E/N [Td]',
  'E/N_Td':               'Reduced field E/N [Td]',
  elec_temperature:        'Electron temperature [K]',
  Telec_K:                 'Electron temperature [K]',
  elec_drift_velocity:     'Electron drift velocity [cm/s]',
  elec_diff_coeff:         'Electron diffusion coeff. [cm² s⁻¹]',
  elec_frequency_n:        'Electron collision freq. [cm³ s⁻¹]',
  elec_power_n:            'Electron power [eV cm³ s⁻¹]',
  elec_power_elastic_n:    'Electron elastic power [eV cm³ s⁻¹]',
  elec_power_inelastic_n:  'Electron inelastic power [eV cm³ s⁻¹]',
};

// ---- App state ----

let data        = null;
let logTimeScale = false;
let lightTheme  = false;
let sharedXRange = null;  // null = autorange, [min, max] = locked range
let isSyncing   = false;
const chartIds  = ['cond-chart', 'dens-chart', 'react-chart', 'creation-chart', 'removal-chart'];

// ============================================================
// UTILITIES
// ============================================================

function colorCycler() {
  let i = 0;
  return () => COLOR_SERIES[i++ % COLOR_SERIES.length];
}

function chartTheme() {
  if (lightTheme) return {
    paper:        '#ffffff',
    plot:         '#ffffff',
    grid:         '#e8e8e8',
    axisColor:    '#555555',
    lineColor:    '#cccccc',
    fontColor:    '#333333',
    legendBg:     'rgba(255,255,255,0.85)',
    legendBorder: '#cccccc',
    titleColor:   '#333333',
  };
  return {
    paper:        '#0c1120',
    plot:         '#0d1828',
    grid:         '#1a2d45',
    axisColor:    '#7a92c4',
    lineColor:    '#253550',
    fontColor:    '#ccd8f0',
    legendBg:     'rgba(11,17,30,0.92)',
    legendBorder: '#253550',
    titleColor:   '#ccd8f0',
  };
}

/** Format a time value with appropriate SI prefix */
function fmtTime(t) {
  if (t === 0) return '0';
  const a = Math.abs(t);
  if (a < 1e-9) return (t * 1e12).toFixed(2) + ' ps';
  if (a < 1e-6) return (t * 1e9).toFixed(2) + ' ns';
  if (a < 1e-3) return (t * 1e6).toFixed(2) + ' µs';
  if (a < 1)    return (t * 1e3).toFixed(2) + ' ms';
  return t.toFixed(3) + ' s';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setStatus(msg) {
  document.getElementById('status-bar').textContent = msg;
}

function showLoading(msg) {
  document.getElementById('loading-msg').textContent = msg || 'Loading…';
  document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// ============================================================
// TABLE / LIST MANAGEMENT
// ============================================================

function populateTable(tableId, items, singleSelect = false) {
  const tbody = document.querySelector('#' + tableId + ' tbody');

  // Remove any previously attached click handler to avoid accumulation
  // on repeated data loads
  if (tbody._clickHandler) {
    tbody.removeEventListener('click', tbody._clickHandler);
    tbody._clickHandler = null;
  }

  tbody.innerHTML = '';
  items.forEach((name, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + escHtml(name) + '</td>';
    tr.dataset.idx = i + 1;
    tbody.appendChild(tr);
  });

  let lastSelectedRow = null;

  tbody._clickHandler = (e) => {
    const row = e.target.closest('tr');
    if (!row) return;

    if (singleSelect) {
      tbody.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click: toggle individual item
      row.classList.toggle('selected');
    } else if (e.shiftKey && lastSelectedRow) {
      // Shift+click: extend range
      const rows  = Array.from(tbody.querySelectorAll('tr'));
      const a = rows.indexOf(lastSelectedRow);
      const b = rows.indexOf(row);
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      rows.slice(lo, hi + 1).forEach(r => r.classList.add('selected'));
    } else {
      // Plain click: select only this row
      tbody.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
    }
    lastSelectedRow = row;
  };

  tbody.addEventListener('click', tbody._clickHandler);
  tbody.addEventListener('mousedown', (e) => { if (e.shiftKey) e.preventDefault(); });
}

function getSelected(tableId) {
  return Array.from(
    document.querySelectorAll('#' + tableId + ' tbody tr.selected')
  ).map(tr => ({ index: parseInt(tr.dataset.idx), name: tr.cells[1].textContent }));
}

function populateAll() {
  if (!data) return;
  populateTable('cond-table',   data.conditions, false);
  populateTable('spec-table',   data.species,    false);
  populateTable('react-table',  data.reactions,  false);
  populateTable('src-table',    data.species,    true);

  // Clear all charts
  sharedXRange = null;
  chartIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) Plotly.purge(el);
  });
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadH5File(file) {
  showLoading('Loading ' + file.name + '…');
  try {
    data = await HDF5Data.fromFile(file);
    populateAll();
    setStatus(
      'Loaded: ' + file.name +
      '  |  ' + data.species.length + ' species' +
      '  |  ' + data.reactions.length + ' reactions' +
      '  |  ' + data.t.length + ' timesteps'
    );
  } catch (e) {
    setStatus('Error: ' + e.message);
    console.error(e);
    alert('Failed to load HDF5 file:\n' + e.message);
  } finally {
    hideLoading();
  }
}

async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    script.onload  = () => resolve(window.JSZip);
    script.onerror = () => reject(new Error('Failed to load JSZip. Check your internet connection.'));
    document.head.appendChild(script);
  });
}

async function loadZipFile(file) {
  showLoading('Loading ' + file.name + '…');
  try {
    const JSZip = await loadJSZip();
    const zip   = await JSZip.loadAsync(file);

    // Collect all .txt entries (skip directories)
    const entries = [];
    zip.forEach((path, entry) => {
      if (!entry.dir && /\.txt$/i.test(entry.name)) entries.push(entry);
    });

    if (!entries.length) throw new Error('No .txt files found in the ZIP archive.');

    // Extract as File objects using the basename so DirectoryData can match by name
    const files = await Promise.all(entries.map(async entry => {
      const bytes    = await entry.async('uint8array');
      const basename = entry.name.split('/').pop();
      return new File([bytes], basename, { type: 'text/plain' });
    }));

    data = await DirectoryData.fromFiles(files);
    populateAll();
    setStatus(
      'Loaded: ' + file.name +
      '  |  ' + data.species.length   + ' species' +
      '  |  ' + data.reactions.length + ' reactions' +
      '  |  ' + data.t.length         + ' timesteps'
    );
  } catch (e) {
    setStatus('Error: ' + e.message);
    console.error(e);
    alert('Failed to load ZIP file:\n' + e.message);
  } finally {
    hideLoading();
  }
}

async function loadDirectory(fileList) {
  showLoading('Loading directory…');
  try {
    data = await DirectoryData.fromFiles(fileList);
    populateAll();
    setStatus(
      'Loaded directory' +
      '  |  ' + data.species.length + ' species' +
      '  |  ' + data.reactions.length + ' reactions' +
      '  |  ' + data.t.length + ' timesteps'
    );
  } catch (e) {
    setStatus('Error: ' + e.message);
    console.error(e);
    alert('Failed to load directory:\n' + e.message);
  } finally {
    hideLoading();
  }
}

// ============================================================
// PLOTLY HELPERS
// ============================================================

const PLOTLY_CFG = {
  responsive: true,
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
  toImageButtonOptions: { format: 'svg', filename: 'jsplaskin' },
};

const PLOTLY_LAYOUT_DEFAULTS = {
  hoverlabel: { namelength: -1 },
};

function xAxisLayout() {
  const th = chartTheme();
  const cfg = {
    title: { text: 'Time [s]', font: { size: 12 } },
    type: logTimeScale ? 'log' : 'linear',
    exponentformat: 'power',
    tickfont: { size: 11 },
    showgrid: true,
    gridcolor: th.grid,
    zeroline: false,
    showline: true,
    linecolor: th.lineColor,
    mirror: true,
    color: th.axisColor,
    hoverformat: '.3g',
  };
  if (sharedXRange) cfg.range = sharedXRange;
  return cfg;
}

function yAxisLayout(title = '', scale = 'log') {
  const th = chartTheme();
  return {
    title: { text: title, font: { size: 12 } },
    type: scale,
    exponentformat: 'power',
    tickfont: { size: 11 },
    showgrid: true,
    gridcolor: th.grid,
    zeroline: false,
    showline: true,
    linecolor: th.lineColor,
    mirror: true,
    autorange: true,
    color: th.axisColor,
    hoverformat: '.3g',
  };
}

function baseLayout(yTitle = '', yScale = 'log', margin = null) {
  const th = chartTheme();
  return {
    margin: margin || { l: 70, r: 180, t: 20, b: 60 },
    xaxis: xAxisLayout(),
    yaxis: yAxisLayout(yTitle, yScale),
    legend: {
      x: 1.02, y: 0, xanchor: 'left', yanchor: 'bottom',
      font: { size: 11, color: th.fontColor },
      bgcolor: th.legendBg,
      bordercolor: th.legendBorder,
      borderwidth: 1,
    },
    showlegend: true,
    plot_bgcolor:  th.plot,
    paper_bgcolor: th.paper,
    autosize: true,
    font: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', size: 12, color: th.fontColor },
  };
}

/**
 * Build a Plotly trace from parallel time/value arrays, applying a filter.
 */
function makeTrace(t, y, label, color, threshold = null) {
  const tF = [], yF = [];
  for (let i = 0; i < t.length; i++) {
    const v = y[i];
    if (!isFinite(v) || isNaN(v)) continue;
    if (threshold !== null && v <= threshold) continue;
    tF.push(t[i]);
    yF.push(v);
  }
  return {
    x: tF, y: yF,
    mode: 'lines',
    name: label,
    line: { color, width: LINE_WIDTH },
    type: 'scatter',
  };
}

/** Register x-axis synchronisation on a freshly-rendered chart div */
function registerSync(divId) {
  const div = document.getElementById(divId);
  if (!div || div._syncRegistered) return;
  div._syncRegistered = true;

  div.on('plotly_relayout', (ev) => {
    if (isSyncing) return;
    let newRange = null;
    if (ev['xaxis.range[0]'] !== undefined) {
      newRange = [ev['xaxis.range[0]'], ev['xaxis.range[1]']];
    } else if (ev['xaxis.autorange'] === true) {
      newRange = null;
    } else {
      return;
    }
    sharedXRange = newRange;
    isSyncing = true;
    Promise.all(
      chartIds
        .filter(id => id !== divId)
        .map(id => {
          const other = document.getElementById(id);
          if (!other || !other._fullLayout) return Promise.resolve();
          return Plotly.relayout(other, newRange
            ? { 'xaxis.range': newRange }
            : { 'xaxis.autorange': true }
          ).catch(() => {});
        })
    ).then(() => { isSyncing = false; });
  });
}

async function renderChart(divId, traces, layout) {
  const div = document.getElementById(divId);
  div._syncRegistered = false; // re-register after each full re-render
  await Plotly.react(div, traces, { ...PLOTLY_LAYOUT_DEFAULTS, ...layout }, PLOTLY_CFG);
  registerSync(divId);
}

// ============================================================
// CHART UPDATE FUNCTIONS
// ============================================================

async function updateCondChart() {
  if (!data) { setStatus('No data loaded.'); return; }
  const sel = getSelected('cond-table');
  if (!sel.length) { setStatus('Select at least one condition.'); return; }

  const cc = colorCycler();
  const traces = sel.map(({ index, name }) => {
    const y = data.condition(index);
    if (!y) return null;
    const label = CONDITIONS_PRETTY[name] || name;
    return makeTrace(data.t, y, label, cc(), null);
  }).filter(Boolean);

  const layout = baseLayout('', 'linear');
  await renderChart('cond-chart', traces, layout);
}

async function updateDensChart() {
  if (!data) { setStatus('No data loaded.'); return; }
  const sel = getSelected('spec-table');
  if (!sel.length) { setStatus('Select at least one species.'); return; }

  const cc = colorCycler();
  const traces = sel.map(({ index, name }) => {
    const y = data.density(index);
    if (!y) return null;
    return makeTrace(data.t, y, name, cc(), DENS_THRESHOLD);
  }).filter(Boolean);

  const layout = baseLayout('Density [cm⁻³]', 'log');
  await renderChart('dens-chart', traces, layout);
}

async function updateReactChart() {
  if (!data) { setStatus('No data loaded.'); return; }
  const sel = getSelected('react-table');
  if (!sel.length) { setStatus('Select at least one reaction.'); return; }

  const cc = colorCycler();
  const traces = sel.map(({ index, name }) => {
    const y = data.rate(index);
    if (!y) return null;
    return makeTrace(data.t, y, '[' + index + '] ' + name, cc(), RATE_THRESHOLD);
  }).filter(Boolean);

  const layout = baseLayout('Rate [cm⁻³ s⁻¹]', 'log');
  await renderChart('react-chart', traces, layout);
}

async function updateSourceChart() {
  if (!data) { setStatus('No data loaded.'); return; }
  const sel = getSelected('src-table');
  if (!sel.length) { setStatus('Select a species.'); return; }

  const { index: spIdx, name: spName } = sel[0];
  const delta = parseFloat(document.getElementById('src-filter').value);

  const sourcesDict = data.sources(spIdx);
  const rxnIds = Object.keys(sourcesDict).map(Number);
  if (!rxnIds.length) {
    setStatus('No reactions affect ' + spName + ' (check source matrix).');
    return;
  }

  // Separate creation/removal using weighted rates
  const creationIds = [], removalIds = [];
  const posWeighted = {}, negWeighted = {};

  for (const rId of rxnIds) {
    const w = sourcesDict[rId];
    const hasPos = w.some(v => v > 0);
    const hasNeg = w.some(v => v < 0);
    if (hasPos) { creationIds.push(rId); posWeighted[rId] = w.map(v => Math.max(v, 0)); }
    if (hasNeg) { removalIds.push(rId);  negWeighted[rId] = w.map(v => Math.max(-v, 0)); }
  }

  const filtCreation = filterRates(posWeighted, creationIds, delta);
  const filtRemoval  = filterRates(negWeighted, removalIds,  delta);

  const cc = colorCycler();

  // Plot creation
  const creationTraces = buildReactionTraces(filtCreation, cc);
  const removalTraces  = buildReactionTraces(filtRemoval,  cc);

  const titleFont = { size: 13, color: chartTheme().titleColor };
  const createLayout = {
    ...baseLayout('Rate [cm⁻³ s⁻¹]', 'log', { l: 70, r: 180, t: 30, b: 40 }),
    title: { text: spName + '  –  Creation', font: titleFont },
  };
  const removeLayout = {
    ...baseLayout('Rate [cm⁻³ s⁻¹]', 'log', { l: 70, r: 180, t: 30, b: 50 }),
    title: { text: spName + '  –  Removal', font: titleFont },
  };

  await Promise.all([
    renderChart('creation-chart', creationTraces, createLayout),
    renderChart('removal-chart',  removalTraces,  removeLayout),
  ]);
}

/** Build traces using actual (raw) reaction rates, not weighted */
function buildReactionTraces(rxnIds, colorFn) {
  return rxnIds.map(rId => {
    const y = data.rate(rId);
    if (!y) return null;
    const name = '[' + rId + '] ' + (data.reactions[rId - 1] || '?');
    return makeTrace(data.t, y, name, colorFn(), RATE_THRESHOLD);
  }).filter(Boolean);
}

// ============================================================
// SENSITIVITY FILTER
// ============================================================

/**
 * Select reactions to display.
 * weightedMap: { rxnId: number[] }  (all values ≥ 0)
 * Returns array of rxnIds sorted by importance.
 */
function filterRates(weightedMap, ids, delta, maxRates = 8, minRates = 1) {
  if (!ids.length) return [];

  // Max contribution over all timesteps for each reaction
  const maxVal = ids.map(id => Math.max(...weightedMap[id]));
  const globalMax = Math.max(...maxVal);
  if (globalMax === 0) return [];

  const normMax = maxVal.map(v => v / globalMax); // [0..1]

  // Sort descending
  const sorted = ids.map((id, i) => ({ id, norm: normMax[i] }))
                    .sort((a, b) => b.norm - a.norm);

  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    const { id, norm } = sorted[i];
    if (i < minRates) {
      result.push(id);
    } else if (i < maxRates) {
      if (delta === 0 || norm > delta) result.push(id);
    } else {
      // Still include very dominant reactions above max cap
      if (delta > 0 && norm > (1 - delta)) result.push(id);
    }
  }
  return result;
}

// ============================================================
// REFRESH ALL CHARTS (after log/linear toggle or theme change)
// ============================================================

function refreshChartColors() {
  const th = chartTheme();
  const update = {
    plot_bgcolor:         th.plot,
    paper_bgcolor:        th.paper,
    'font.color':         th.fontColor,
    'xaxis.gridcolor':    th.grid,
    'xaxis.linecolor':    th.lineColor,
    'xaxis.color':        th.axisColor,
    'yaxis.gridcolor':    th.grid,
    'yaxis.linecolor':    th.lineColor,
    'yaxis.color':        th.axisColor,
    'legend.bgcolor':     th.legendBg,
    'legend.bordercolor': th.legendBorder,
    'legend.font.color':  th.fontColor,
    'title.font.color':   th.titleColor,
  };
  chartIds.forEach(id => {
    const div = document.getElementById(id);
    if (div && div._fullLayout) {
      Plotly.relayout(div, update).catch(() => {});
    }
  });
}

function refreshXScale() {
  chartIds.forEach(id => {
    const div = document.getElementById(id);
    if (div && div._fullLayout) {
      Plotly.relayout(div, {
        'xaxis.type': logTimeScale ? 'log' : 'linear',
        ...(sharedXRange ? { 'xaxis.range': sharedXRange } : { 'xaxis.autorange': true }),
      }).catch(() => {});
    }
  });
}

// ============================================================
// EXPORT
// ============================================================

function csvEscape(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCurrentPlot() {
  // Find the active tab's first rendered chart
  const activeTab = document.querySelector('.tab-pane.active');
  if (!activeTab) return;
  // Try .chart-area first, then .source-charts (sensitivity tab)
  const chartDiv = activeTab.querySelector('.chart-area > div[id], .source-charts > div[id]');
  if (!chartDiv || !chartDiv._fullLayout) {
    alert('No plot to export. Render a chart first.');
    return;
  }

  const traces = chartDiv.data;
  if (!traces || !traces.length) { alert('No data to export.'); return; }

  // Header row
  const header = ['time', ...traces.map(tr => tr.name || '?')].map(csvEscape).join(',');

  // Data rows — each trace may have a different x array; use the union of all x values
  const nPts = Math.max(...traces.map(tr => (tr.x || []).length));
  const rows = [];
  for (let i = 0; i < nPts; i++) {
    const t = traces[0].x ? traces[0].x[i] : '';
    const cols = [t, ...traces.map(tr => (tr.y && tr.y[i] !== undefined ? tr.y[i] : ''))];
    rows.push(cols.map(csvEscape).join(','));
  }

  const csv  = [header, ...rows].join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'jsplaskin_export.csv'; a.click();
  URL.revokeObjectURL(url);
}

async function downloadPlotAsPDF() {
  const activeTab = document.querySelector('.tab-pane.active');
  if (!activeTab) return;
  const chartDiv = activeTab.querySelector('.chart-area > div[id], .source-charts > div[id]');
  if (!chartDiv || !chartDiv._fullLayout) {
    alert('No plot to export. Render a chart first.');
    return;
  }

  const svgData = await Plotly.toImage(chartDiv, { format: 'svg' });
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><style>
    body { margin: 0; }
    img { display: block; width: 100%; }
    @media print { @page { margin: 1cm; } }
  </style></head><body><img src="${svgData}"></body></html>`);
  win.document.close();
  win.addEventListener('load', () => win.print());
}

// ============================================================
// DRAG-AND-DROP: read folder entries recursively
// ============================================================

async function readDroppedEntries(items) {
  const files = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry && entry.isDirectory) {
      const dirFiles = await readDirEntry(entry);
      files.push(...dirFiles);
    } else {
      const file = item.getAsFile ? item.getAsFile() : null;
      if (file) files.push(file);
    }
  }
  return files;
}

function readDirEntry(dirEntry) {
  return new Promise((resolve) => {
    const result = [];
    const reader = dirEntry.createReader();
    const readBatch = () => {
      reader.readEntries(entries => {
        if (!entries.length) { resolve(result); return; }
        let pending = entries.length;
        const done = () => { if (--pending === 0) readBatch(); };
        entries.forEach(entry => {
          if (entry.isFile) {
            entry.file(f => { result.push(f); done(); }, done);
          } else { done(); }
        });
      }, () => resolve(result));
    };
    readBatch();
  });
}

// ============================================================
// WIRE UP UI
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // ---- Tabs ----
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      // Trigger resize so Plotly redraws correctly after tab switch
      window.dispatchEvent(new Event('resize'));
    });
  });

  // ---- Menu: File ----
  document.getElementById('menu-open-h5').addEventListener('click', () =>
    document.getElementById('input-h5').click()
  );
  document.getElementById('menu-open-zip').addEventListener('click', () =>
    document.getElementById('input-zip').click()
  );
  document.getElementById('menu-open-dir').addEventListener('click', () =>
    document.getElementById('input-dir').click()
  );
  document.getElementById('menu-export').addEventListener('click', exportCurrentPlot);
  document.getElementById('menu-download-pdf').addEventListener('click', downloadPlotAsPDF);

  // ---- Menu: Options ----
  document.getElementById('menu-logtime').addEventListener('click', (e) => {
    logTimeScale = !logTimeScale;
    e.currentTarget.classList.toggle('checked', logTimeScale);
    refreshXScale();
  });

  document.getElementById('menu-theme').addEventListener('click', (e) => {
    lightTheme = !lightTheme;
    document.documentElement.dataset.theme = lightTheme ? 'light' : 'dark';
    e.currentTarget.classList.toggle('checked', lightTheme);
    refreshChartColors();
  });

  // ---- Menu: Help ----
  document.getElementById('menu-github').addEventListener('click', () => {
    window.open('https://github.com/aluque/jsplaskin', '_blank');
  });

  document.getElementById('menu-about').addEventListener('click', () => {
    alert(
      'JSPlaskin\n\n' +
      'Browser-based viewer for plasma kinetics simulation data.\n' +
      'Supports .h5 (HDF5) files and directories with qt_*.txt files.\n\n' +
      'Translated from the Python/Qt qtplaskin tool.'
    );
  });

  // ---- File inputs ----
  document.getElementById('input-h5').addEventListener('change', async (e) => {
    if (e.target.files[0]) await loadH5File(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('input-zip').addEventListener('change', async (e) => {
    if (e.target.files[0]) await loadZipFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('input-dir').addEventListener('change', async (e) => {
    if (e.target.files.length) await loadDirectory(e.target.files);
    e.target.value = '';
  });

  // ---- Plot buttons ----
  document.getElementById('btn-plot-cond').addEventListener('click',   updateCondChart);
  document.getElementById('btn-plot-dens').addEventListener('click',   updateDensChart);
  document.getElementById('btn-plot-react').addEventListener('click',  updateReactChart);
  document.getElementById('btn-plot-src').addEventListener('click',    updateSourceChart);

  // ---- Drag-and-drop ----
  const overlay = document.getElementById('drop-overlay');

  document.body.addEventListener('dragenter', (e) => {
    e.preventDefault();
    overlay.classList.remove('hidden');
  });
  overlay.addEventListener('dragover', (e) => e.preventDefault());
  overlay.addEventListener('dragleave', () => overlay.classList.add('hidden'));
  overlay.addEventListener('drop', async (e) => {
    e.preventDefault();
    overlay.classList.add('hidden');
    const files = await readDroppedEntries(Array.from(e.dataTransfer.items));
    if (!files.length) return;

    // Detect type: h5 > zip > directory
    const h5  = files.find(f => /\.(h5|hdf5)$/i.test(f.name));
    const zip = files.find(f => /\.zip$/i.test(f.name));
    const hasQtFiles = files.some(f => /qt_.*\.txt$/i.test(f.name));
    if (h5 && !hasQtFiles) {
      await loadH5File(h5);
    } else if (zip && !hasQtFiles) {
      await loadZipFile(zip);
    } else {
      await loadDirectory(files);
    }
  });

  // ---- Menu open/close ----
  document.querySelectorAll('.menu-label').forEach(label => {
    label.addEventListener('click', (e) => {
      const wasOpen = label.classList.contains('open');
      document.querySelectorAll('.menu-label.open').forEach(l => l.classList.remove('open'));
      if (!wasOpen) label.classList.add('open');
      e.stopPropagation();
    });
  });
  // Close menus when clicking menu items or anywhere outside
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      document.querySelectorAll('.menu-label.open').forEach(l => l.classList.remove('open'));
      e.stopPropagation();
    });
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.menu-label.open').forEach(l => l.classList.remove('open'));
  });

  setStatus('Ready — drop a .h5 file, a .zip archive, or a folder with qt_*.txt files to load data');

  // ---- Platform-aware multi-select hint ----
  const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  document.querySelectorAll('.list-hint').forEach(el => {
    el.textContent = `Click · ${modKey}+click · Shift+click`;
  });
});
