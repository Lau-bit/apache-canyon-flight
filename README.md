# Apache Canyon Flight

A real-time 3D flight visualization of an AH-64 Apache running a tactical route through a procedurally generated canyon, from Base A to Base B. Built with [Three.js](https://threejs.org/) and vanilla JavaScript — no build step.

## Features

- Two selectable scenes: the procedural **Canyon corridor** and a wide, near-flat **Open plains** with its own ground texture, base layout, and cooler lighting (Menu → Flight → Scene)
- Procedural canyon terrain and helipads (`modules/`)
- Animated AH-64 helicopter with a flight path between two bases
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
- `style.css` — HUD and menu styling
- `launch.js` — static file server for local development
