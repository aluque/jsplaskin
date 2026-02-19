# JSPlaskin

A browser-based viewer for plasma kinetics simulation output, inspired by [QtPlaskin](https://github.com/aluque/qtplaskin).

**Live app: https://aluque.github.io/jsplaskin/**

## Features

- **Overview** — plot plasma conditions (reduced field, gas temperature, electron density, etc.) over time
- **Densities** — plot species number densities; select one or more species from the list
- **Reactions** — plot reaction speeds for selected reactions
- **Sensitivity analysis** — for a chosen species, show the top production and removal reactions, with a configurable contribution threshold

All charts share a synchronised x-axis: zooming or panning one chart moves the others. Time axis can be toggled to log scale. Dark/light theme toggle included.

Charts can be printed (or saved as PDF) via File → Print current plot, and the underlying data can be exported as a CSV file via File → Export plot data.

## Input formats

| Format | How to open |
|--------|-------------|
| HDF5 file (`.h5`) | File → Open HDF5 |
| ZIP archive containing `qt_*.txt` files | File → Open ZIP archive |
| Folder with `qt_*.txt` files | File → Import from directory |

You can also drag and drop any of the above onto the app window.

HDF5 files may use either the modern `main/` group layout or the legacy `zdplaskin/` group layout.

## Text-file format

If your simulation code does not produce HDF5 output, you can write a small set of plain text files and load them as a folder or ZIP archive. The files use a simple whitespace-separated format described below.

### File names

All files must use the `qt_` prefix:

| File | Required | Contents |
|------|----------|----------|
| `qt_species_list.txt` | yes | species names |
| `qt_densities.txt` | yes | species number densities vs. time |
| `qt_reactions_list.txt` | no | reaction labels |
| `qt_rates.txt` | no | reaction speeds vs. time |
| `qt_conditions_list.txt` | no | condition variable names |
| `qt_conditions.txt` | no | condition variables vs. time |
| `qt_matrix.txt` | no | stoichiometric matrix |

### List files (`qt_species_list.txt`, `qt_reactions_list.txt`, `qt_conditions_list.txt`)

One entry per line: an integer index followed by the name, separated by whitespace.

```
1 O
2 O2
3 O3
4 O(1D)
```

### Data files (`qt_densities.txt`, `qt_rates.txt`, `qt_conditions.txt`)

The first line is a header and is ignored. Each subsequent line contains one time point followed by the values for all species (or reactions, or conditions) in the same order as the corresponding list file, all separated by whitespace. Scientific notation (`1.5e-10`) is accepted.

```
# time  species_1  species_2  species_3  ...
0.0     1.0e16     2.5e18     0.0
1.0e-9  9.8e15     2.5e18     1.2e13
2.0e-9  9.5e15     2.5e18     2.1e13
```

### Stoichiometric matrix (`qt_matrix.txt`)

One row per species, one column per reaction. Each entry is an integer indicating the net stoichiometric coefficient of that species in that reaction: positive if the species is produced, negative if consumed, zero otherwise. Values are separated by whitespace.

```
-1  0  1
 0 -2  0
 1  1 -1
```

### Packaging as a ZIP

The folder containing these files can be compressed into a ZIP archive and loaded directly via File → Open ZIP archive, without having to unzip it first.

## Selection

In the species and reactions lists, multi-selection works as follows:

- **Click** — select one item exclusively
- **Ctrl/Cmd + click** — toggle an item
- **Shift + click** — extend the selection to a range

## Code overview

The project runs entirely in the browser with no installation required. The source is split across a few files:

| File | Role |
|------|------|
| `index.html` | Page structure |
| `js/data.js` | Data loading |
| `js/app.js` | UI and chart rendering |
| `css/style.css` | Visual styling |

## About

This project is an experiment built using [Claude Code](https://claude.ai/code), Anthropic's AI coding assistant. The code was developed interactively through conversation, with Claude writing and refining the implementation.
