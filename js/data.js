// ============================================================
// data.js  –  Data models for JSPlaskin
// ============================================================

// --------------- Base class ---------------------------------

export class ModelData {
  constructor() {
    this.species    = [];   // string[]
    this.reactions  = [];   // string[]
    this.conditions = [];   // string[]
    this.t          = [];   // number[]  (time points)
    this.sourceMatrix = []; // number[][] [n_species][n_reactions]
  }

  // Override in subclasses
  density(key)   { throw new Error('Not implemented'); } // key: 1-based
  rate(key)      { throw new Error('Not implemented'); }
  condition(key) { throw new Error('Not implemented'); }

  /**
   * Returns { reactionIdx (1-based): number[] (rate * stoich coeff) }
   * Positive values = production, negative = consumption
   */
  sources(speciesIndex) {
    const result = {};
    const sIdx = speciesIndex - 1; // 0-based
    const sm = this.sourceMatrix;
    if (!sm || !sm[sIdx]) return result;

    for (let rIdx = 0; rIdx < this.reactions.length; rIdx++) {
      const coeff = sm[sIdx][rIdx];
      if (coeff !== 0) {
        const rateArr = this.rate(rIdx + 1);
        if (rateArr) {
          result[rIdx + 1] = rateArr.map(v => v * coeff);
        }
      }
    }
    return result;
  }
}

// --------------- HDF5 Data ----------------------------------

export class HDF5Data extends ModelData {
  constructor() {
    super();
    this._densities  = {}; // 1-based index -> number[]
    this._rates      = {};
    this._conditions = {};
  }

  static async fromFile(file) {
    const inst = new HDF5Data();
    await inst._load(file);
    return inst;
  }

  async _load(file) {
    // Dynamic import of h5wasm from CDN
    let hdf5;
    try {
      // Try specific version first, fall back to latest
      try {
        hdf5 = await import('https://cdn.jsdelivr.net/npm/h5wasm@0.7.2/dist/esm/hdf5_hl.js');
      } catch (_) {
        hdf5 = await import('https://cdn.jsdelivr.net/npm/h5wasm/dist/esm/hdf5_hl.js');
      }
      await hdf5.ready;
    } catch (e) {
      throw new Error('Failed to load HDF5 library. Check your internet connection. ' + e.message);
    }

    const buffer = await file.arrayBuffer();
    const fname = 'jsplaskin_tmp.h5';
    hdf5.FS.writeFile(fname, new Uint8Array(buffer));

    let f;
    try {
      f = new hdf5.File(fname, 'r');
      await this._parseH5(f);
    } finally {
      if (f) try { f.close(); } catch (_) {}
      try { hdf5.FS.unlink(fname); } catch (_) {}
    }
  }

  async _parseH5(f) {
    // Detect format: modern (main/) or legacy (zdplaskin/)
    let root = 'main';
    try {
      f.get('main/t');
    } catch (_) {
      try {
        f.get('zdplaskin/t');
        root = 'zdplaskin';
      } catch (_2) {
        throw new Error('Unrecognised HDF5 structure (expected main/ or zdplaskin/ group)');
      }
    }

    // Read time
    this.t = Array.from(f.get(root + '/t').value);

    // Read source matrix
    try {
      const smDs = f.get(root + '/source_matrix');
      const smVal = smDs.value;
      const [nSpec, nRxn] = smDs.shape;
      this.sourceMatrix = [];
      for (let i = 0; i < nSpec; i++) {
        this.sourceMatrix.push(Array.from(smVal.slice(i * nRxn, (i + 1) * nRxn)));
      }
    } catch (_) {
      this.sourceMatrix = [];
    }

    // Helper: read a numbered group (0001, 0002, …)
    const readGroup = (groupPath) => {
      const group = f.get(groupPath);
      const rawKeys = group.keys();
      // Sort numerically
      const keys = rawKeys.sort((a, b) => parseInt(a) - parseInt(b));
      const names = [];
      const dataMap = {};
      for (const key of keys) {
        const ds = f.get(groupPath + '/' + key);
        let name = key;
        try { name = String(ds.attrs['name'].value); } catch (_) {}
        const idx = names.length + 1; // 1-based
        names.push(name);
        dataMap[idx] = Array.from(ds.value);
      }
      return { names, dataMap };
    };

    const densGroup = readGroup(root + '/density');
    this.species    = densGroup.names;
    this._densities  = densGroup.dataMap;

    const rateGroup = readGroup(root + '/rate');
    this.reactions  = rateGroup.names;
    this._rates      = rateGroup.dataMap;

    try {
      const condGroup = readGroup(root + '/condition');
      this.conditions  = condGroup.names;
      this._conditions  = condGroup.dataMap;
    } catch (_) {
      this.conditions  = [];
      this._conditions  = {};
    }
  }

  density(key)   { return this._densities[key];  }
  rate(key)      { return this._rates[key];       }
  condition(key) { return this._conditions[key];  }
}

// --------------- Directory / text-file Data -----------------

export class DirectoryData extends ModelData {
  constructor() {
    super();
    this._densities  = {};
    this._rates      = {};
    this._conditions = {};
  }

  static async fromFiles(fileList) {
    const inst = new DirectoryData();
    await inst._load(fileList);
    return inst;
  }

  // ---- helpers ----

  _findFile(fileList, names) {
    for (const name of (Array.isArray(names) ? names : [names])) {
      for (const file of fileList) {
        // file.name is just the basename; webkitRelativePath has full path
        const basename = file.name;
        if (basename === name) return file;
      }
    }
    return null;
  }

  _readText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read ' + file.name));
      reader.readAsText(file);
    });
  }

  /**
   * Parse a list file like qt_species_list.txt
   * Each line: "  1 Name" → returns ["Name", …]
   */
  _parseListFile(text) {
    return text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Strip leading index number
        const m = line.match(/^\d+\s+(.*)/);
        return m ? m[1].trim() : line;
      });
  }

  /**
   * Parse a data file (densities / rates / conditions).
   * First line is header (skipped).
   * Returns { t: number[], cols: number[][] }  where cols[j][i] = value of column j at timestep i
   */
  _parseDataFile(text) {
    const lines = text.trim().split('\n');
    const tArr = [];
    const rowBuffer = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const vals = line.split(/\s+/).map(Number);
      if (!vals.length || isNaN(vals[0])) continue;
      tArr.push(vals[0]);
      rowBuffer.push(vals.slice(1));
    }

    if (rowBuffer.length === 0) return { t: [], cols: [] };
    const nCols = rowBuffer[0].length;
    const cols = [];
    for (let j = 0; j < nCols; j++) {
      cols.push(rowBuffer.map(row => row[j] !== undefined ? row[j] : 0));
    }
    return { t: tArr, cols };
  }

  /**
   * Parse source matrix file (space-separated integers, one row per species)
   */
  _parseMatrix(text) {
    return text.trim().split('\n')
      .filter(line => line.trim())
      .map(line => line.trim().split(/\s+/).map(Number));
  }

  async _load(fileList) {
    const files = Array.from(fileList);

    // Detect file prefix: qt_ (new) or legacy names
    const hasQT = files.some(f => f.name === 'qt_species_list.txt');
    const prefix = hasQT ? 'qt_' : '';

    const names = {
      speciesList:    prefix ? 'qt_species_list.txt'    : 'species_list.txt',
      reactionsList:  prefix ? 'qt_reactions_list.txt'  : 'reactions_list.txt',
      conditionsList: prefix ? 'qt_conditions_list.txt' : 'conditions_list.txt',
      densities:      prefix ? 'qt_densities.txt'       : 'out_density.txt',
      rates:          prefix ? 'qt_rates.txt'           : 'out_rate.txt',
      matrix:         prefix ? 'qt_matrix.txt'          : 'source_matrix.txt',
      conditions:     prefix ? 'qt_conditions.txt'      : 'out_temperatures.txt',
    };

    const getFile = (key) => this._findFile(files, names[key]);
    const readOrNull = async (key) => {
      const f = getFile(key);
      return f ? this._readText(f) : null;
    };

    const [speciesText, reactionsText, conditionsListText,
           densitiesText, ratesText, matrixText, conditionsDataText] =
      await Promise.all([
        readOrNull('speciesList'),
        readOrNull('reactionsList'),
        readOrNull('conditionsList'),
        readOrNull('densities'),
        readOrNull('rates'),
        readOrNull('matrix'),
        readOrNull('conditions'),
      ]);

    if (!speciesText)   throw new Error('Species list file not found');
    if (!densitiesText) throw new Error('Densities file not found');

    this.species    = this._parseListFile(speciesText);
    this.reactions  = reactionsText      ? this._parseListFile(reactionsText)     : [];
    this.conditions = conditionsListText ? this._parseListFile(conditionsListText) : [];

    const densData = this._parseDataFile(densitiesText);
    this.t = densData.t;

    for (let j = 0; j < this.species.length; j++) {
      this._densities[j + 1] = densData.cols[j] || new Array(this.t.length).fill(0);
    }

    if (ratesText) {
      const rateData = this._parseDataFile(ratesText);
      for (let j = 0; j < this.reactions.length; j++) {
        this._rates[j + 1] = rateData.cols[j] || new Array(this.t.length).fill(0);
      }
    }

    if (conditionsDataText) {
      const condData = this._parseDataFile(conditionsDataText);
      for (let j = 0; j < this.conditions.length; j++) {
        this._conditions[j + 1] = condData.cols[j] || new Array(this.t.length).fill(0);
      }
    }

    this.sourceMatrix = matrixText ? this._parseMatrix(matrixText) :
      this.species.map(() => new Array(this.reactions.length).fill(0));
  }

  density(key)   { return this._densities[key];  }
  rate(key)      { return this._rates[key];       }
  condition(key) { return this._conditions[key];  }
}
