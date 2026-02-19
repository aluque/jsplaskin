# JSPlaskin

A browser-based viewer for plasma kinetics simulation output, inspired by [QtPlaskin](https://github.com/aluque/qtplaskin).

**Live app: https://aluque.github.io/jsplaskin/**

## Features

- **Overview** — plot plasma conditions (reduced field, gas temperature, electron density, etc.) over time
- **Densities** — plot species number densities; select one or more species from the list
- **Reactions** — plot reaction speeds for selected reactions
- **Sensitivity analysis** — for a chosen species, show the top production and removal reactions, with a configurable contribution threshold

All charts share a synchronised x-axis: zooming or panning one chart moves the others. Time axis can be toggled to log scale. Dark/light theme toggle included.

## Input formats

| Format | How to open |
|--------|-------------|
| HDF5 file (`.h5`) | File → Open HDF5 |
| ZIP archive containing `qt_*.txt` files | File → Open ZIP archive |
| Folder with `qt_*.txt` files | File → Import from directory |

You can also drag and drop any of the above onto the app window.

HDF5 files may use either the modern `main/` group layout or the legacy `zdplaskin/` group layout.

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
