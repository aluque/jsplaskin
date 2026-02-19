# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

ES modules require HTTP — the app cannot be opened as a `file://` URL.

```bash
./serve.sh          # starts python3 -m http.server on port 8080
./serve.sh 3000     # custom port
```

Then open `http://localhost:8080` in the browser. Test data lives in `~/projects/qtplaskin/erwanp/qtplaskin/test/data/01/` (directory with `qt_*.txt` files) and `~/projects/qtplaskin/*.h5` (HDF5 files).

There are no build steps, no npm, no bundler, and no test suite — this is a plain ES-module browser app.

## Architecture

All logic is split across three files; `index.html` contains only markup.

### `js/data.js` — data layer (ES module, no DOM)

Two concrete loaders both extend `ModelData`:

- **`HDF5Data`** — reads `.h5` files. Uses `h5wasm` (WebAssembly HDF5, loaded dynamically from jsDelivr CDN). Supports both the modern `main/` group structure and the legacy `zdplaskin/` group. Datasets inside each group are named `0001`, `0002`, … and carry a `name` attribute with the human-readable label.
- **`DirectoryData`** — reads a flat list of `File` objects (from `<input webkitdirectory>` or drag-and-drop). Auto-detects whether files use the `qt_` prefix (new) or legacy names (`out_density.txt`, etc.).

The base class `ModelData` holds:
- `species`, `reactions`, `conditions` — string arrays (0-indexed)
- `t` — time array
- `sourceMatrix` — `number[n_species][n_reactions]`, stoichiometric coefficients
- `sources(speciesIndex)` — computes `{ reactionIdx: rate * coeff }` from the matrix; positive = production, negative = consumption

All indices exposed to the UI are **1-based**; internal arrays are 0-based.

### `js/app.js` — UI and chart layer (ES module, imports data.js)

**Global state**: `data` (current `ModelData` instance), `logTimeScale`, `sharedXRange`, `isSyncing`.

**`populateTable(tableId, items, singleSelect)`** — renders a two-column list (`#`, name). Stores its click handler on `tbody._clickHandler` so it can be removed cleanly if data is reloaded. Multi-select: plain click = exclusive, Ctrl/Cmd+click = toggle, Shift+click = range.

**Chart flow**: each of the four plot buttons calls `update*Chart()` → `renderChart(divId, traces, layout)` → `Plotly.react(...)` → `registerSync(divId)`. `registerSync` attaches a `plotly_relayout` listener that propagates x-axis zoom/pan to all other rendered charts via `sharedXRange`; `isSyncing` prevents feedback loops.

**`filterRates(weightedMap, ids, delta, maxRates, minRates)`** — sensitivity analysis filter. Normalises each reaction's max contribution to `[0, 1]`, always keeps `minRates` top reactions, then includes up to `maxRates` reactions above `delta`, and any beyond that cap whose normalised max exceeds `1 - delta`.

Plotly is loaded as a plain `<script>` tag (global `Plotly`) before the ES module, so it is guaranteed available when `app.js` runs.

### `css/style.css`

Uses CSS custom properties (`--bg`, `--sel-bg`, etc.) defined on `:root`. Layout is pure flexbox: topbar → tab-bar → tab panes, each pane split into `.left-panel` (resizable, fixed width) and `.right-panel` (flex 1).

## Key conventions

- All data accessor keys (`density(key)`, `rate(key)`, `condition(key)`) are **1-based integers** matching the 1-based indices shown in the UI.
- Plotting thresholds: densities filtered at `1e-10`, rates at `1e-20` (values at or below are dropped from traces to avoid log-scale issues).
- `CONDITIONS_PRETTY` in `app.js` maps internal condition variable names (e.g. `reduced_field`) to display labels.
- `h5wasm` is imported dynamically inside `HDF5Data._load()` (not at module top-level) so that the app loads and runs without network access when only text-file data is used.
