# Apache Canyon Flight

A real-time 3D flight visualization of an AH-64 Apache running a tactical route through a procedurally generated canyon, from Base A to Base B. Built with [Three.js](https://threejs.org/) and vanilla JavaScript — no build step.

## Features

- Two selectable scenes: the procedural **Canyon corridor** and a wide, near-flat **Open plains** with its own ground texture, base layout, and cooler lighting (Menu → Flight → Scene)
- Procedural canyon terrain and helipads (`modules/`)
- Two selectable **airframe models** (Menu -> Flight -> Airframe model), swapped live
  without rebuilding the world: **AH-64A (three-view)** — the default, a lofted hull
  traced off the general-arrangement drawing, with a scissor tail rotor and a bare
  rotor head — and **AH-64D Longbow (original)**, the earlier box-built airframe with
  the mast-mounted radome
- Animated helicopter with a flight path between two bases
- Multiple camera modes: chase, cockpit, free orbit, and cinematic flyby
- Adjustable time of day (harsh noon, golden hour, cold dawn)
- Tunable cruise speed and an optional A ⇄ B auto-loop
- Rendering controls: frame-rate cap, scene detail, shadow quality, performance mode, and renderer stats
- Tactical HUD with airspeed, altitude AGL, heading, and range readouts

## Running

ES modules and the import map require the page to be served over HTTP (opening
`index.html` via `file://` won't work). A tiny zero-dependency static server is
included:

```bash
node launch.js
```

This serves the app at <http://localhost:8771> and opens it in your default
browser.

## Controls

- `1` / `2` / `3` / `4` — switch cameras
- Left drag — rotate any view
- Middle / right drag — pan while wheel zoom remains active
- `C` — recenter the camera
- Arrows — pan in orbit
- Space — fire the main gun when the crosshair setting is enabled
- `Shift+Q` — hide the UI

## Project layout

- `index.html` — markup, HUD, and the Three.js import map
- `main.js` — scene setup, render loop, cameras, and UI wiring
- `modules/` — canyon, bases, flight path, helicopter, and noise helpers
- `modules/helicopter.js` — flight model + the airframe **model registry**
  (`HELI_MODELS`); every builder returns the same parts contract, so adding a model
  never touches an existing one
- `modules/heli-model-ah64a.js` — the AH-64A airframe (lofted cross-sections +
  extruded planforms)
- `style.css` — HUD and menu styling
- `launch.js` — static file server for local development
