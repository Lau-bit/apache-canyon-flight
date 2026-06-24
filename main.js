import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildBases } from './modules/bases.js';
import { Helicopter } from './modules/helicopter.js';
import { SCENES, getScene } from './modules/scenes.js';

// ---------------------------------------------------------------- renderer ---
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  logarithmicDepthBuffer: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
const maxPixelRatio = 1.75;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 2200);
camera.position.set(-336, 30, 48); // reframed onto the active base at boot

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.enableZoom = false;
controls.rotateSpeed = 0.5;
controls.minDistance = 3;
controls.maxDistance = 320;
controls.maxPolarAngle = Math.PI * 0.495;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.PAN,
};

const wheelZoomOffset = new THREE.Vector3();
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
  const modeScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 600 : 1;
  const zoomScale = Math.exp(e.deltaY * modeScale * 0.001);
  wheelZoomOffset.copy(camera.position).sub(controls.target);
  const nextRadius = THREE.MathUtils.clamp(
    wheelZoomOffset.length() * zoomScale,
    controls.minDistance,
    controls.maxDistance,
  );
  wheelZoomOffset.setLength(nextRadius);
  camera.position.copy(controls.target).add(wheelZoomOffset);
  controls.update();
}, { passive: false, capture: true });

// ------------------------------------------------------------------- sky ------
const skyGeo = new THREE.SphereGeometry(1600, 32, 16);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    topColor: { value: new THREE.Color(0x3a78c2) },
    midColor: { value: new THREE.Color(0x9fc1e0) },
    bottomColor: { value: new THREE.Color(0xe7d6b6) },
    offset: { value: 120 },
    exponent: { value: 0.7 },
  },
  vertexShader: `
    varying vec3 vWorld;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 topColor; uniform vec3 midColor; uniform vec3 bottomColor;
    uniform float offset; uniform float exponent;
    varying vec3 vWorld;
    void main() {
      float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
      float t = max(pow(max(h, 0.0), exponent), 0.0);
      vec3 col = h < 0.06 ? mix(bottomColor, midColor, smoothstep(-0.1, 0.06, h))
                          : mix(midColor, topColor, t);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
scene.add(new THREE.Mesh(skyGeo, skyMat));

// Sun glow sprite.
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,240,205,0.9)');
  g.addColorStop(1, 'rgba(255,240,205,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture(),
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
}));
sunSprite.scale.set(260, 260, 1);
scene.add(sunSprite);

// ----------------------------------------------------------------- lights -----
const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x6b4a32, 0.9);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(3072, 3072);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
const shadowCam = sun.shadow.camera;
const shadowRadius = 78;
shadowCam.left = -shadowRadius;
shadowCam.right = shadowRadius;
shadowCam.top = shadowRadius;
shadowCam.bottom = -shadowRadius;
shadowCam.near = 1;
shadowCam.far = 460;
shadowCam.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

const sunDir = new THREE.Vector3();

// Time-of-day presets.
const timeOfDay = {
  noon: {
    sky: { top: 0x2f6fc0, mid: 0x9cc0e6, bottom: 0xdfe2d2 },
    fog: { color: 0xcfd6cf, near: 120, far: 900 },
    sun: { color: 0xfff4dc, intensity: 2.6, dir: new THREE.Vector3(-0.35, 0.92, 0.2) },
    hemi: { sky: 0xbfe0ff, ground: 0x7a5638, intensity: 0.95 },
    ambient: 0.28,
    exposure: 1.04,
    sunColor: 0xfff3d0,
  },
  golden: {
    sky: { top: 0x355b95, mid: 0xd9923f, bottom: 0xf0c07a },
    fog: { color: 0xe0a667, near: 90, far: 760 },
    sun: { color: 0xffb15a, intensity: 2.7, dir: new THREE.Vector3(-0.86, 0.32, 0.4) },
    hemi: { sky: 0xd8a368, ground: 0x5a3826, intensity: 0.8 },
    ambient: 0.22,
    exposure: 1.12,
    sunColor: 0xffb968,
  },
  dawn: {
    sky: { top: 0x243a66, mid: 0x6f7fa6, bottom: 0xc9b8c0 },
    fog: { color: 0x9aa3bf, near: 80, far: 680 },
    sun: { color: 0xcdd6f0, intensity: 1.7, dir: new THREE.Vector3(0.8, 0.28, -0.4) },
    hemi: { sky: 0x8fa3cc, ground: 0x4a4036, intensity: 0.75 },
    ambient: 0.3,
    exposure: 1.0,
    sunColor: 0xdfe6ff,
  },
};

function applyTimeOfDay(key) {
  const preset = timeOfDay[key] ?? timeOfDay.noon;
  // Build a mutable working copy so the active scene can layer its own lighting
  // character on top without corrupting the shared preset.
  const L = {
    sky: { ...preset.sky },
    fog: { ...preset.fog },
    sun: { color: preset.sun.color, intensity: preset.sun.intensity, dir: preset.sun.dir.clone() },
    hemi: { ...preset.hemi },
    ambient: preset.ambient,
    exposure: preset.exposure,
    sunColor: preset.sunColor,
  };
  currentScene?.tuneLighting?.(L);

  skyMat.uniforms.topColor.value.setHex(L.sky.top);
  skyMat.uniforms.midColor.value.setHex(L.sky.mid);
  skyMat.uniforms.bottomColor.value.setHex(L.sky.bottom);
  scene.fog = new THREE.Fog(L.fog.color, L.fog.near, L.fog.far);
  sun.color.setHex(L.sun.color);
  sun.intensity = L.sun.intensity;
  sunDir.copy(L.sun.dir).normalize();
  hemi.color.setHex(L.hemi.sky);
  hemi.groundColor.setHex(L.hemi.ground);
  hemi.intensity = L.hemi.intensity;
  ambient.intensity = L.ambient;
  renderer.toneMappingExposure = L.exposure;
  sunSprite.material.color.setHex(L.sunColor);
}

// --------------------------------------------------------------- post-fx ------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ----------------------------------------------------------------- world ------
let currentScene = getScene(window.localStorage.getItem('apache-canyon.scene') || 'canyon');
let path = currentScene.makePath();
let worldRoot = new THREE.Group();
scene.add(worldRoot);
let terrainGroup = null;
let staticGroup = null;
let canyonState = null;
let beacons = [];
let helicopter = null;
let cinematicStations = [];
let destructiblePlanes = [];

function disposeGroup(root) {
  root.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose();
      }
    }
  });
}

function buildCinematicStations() {
  cinematicStations = [];
  const n = 9;
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const frame = path.getFrameAtDistance(f * path.totalLength);
    const side = i % 2 ? 1 : -1;
    const pos = frame.point.clone()
      .addScaledVector(frame.lateral, side * (34 + (i % 3) * 10))
      .add(new THREE.Vector3(0, 8 + (i % 3) * 6, 0));
    cinematicStations.push(pos);
  }
}

// Rebuildable terrain group — the only part torn down on a scene-detail change.
function buildTerrainGroup(detail) {
  if (terrainGroup) {
    worldRoot.remove(terrainGroup);
    disposeGroup(terrainGroup);
  }
  terrainGroup = new THREE.Group();
  worldRoot.add(terrainGroup);
  canyonState = currentScene.buildTerrain(terrainGroup, detail);
  syncShadowCasters();
}

function buildWorld(detail) {
  buildTerrainGroup(detail);

  // Static scenery (surrounding back-country, if any) + the two bases. Rebuilt
  // only on a scene change, not on detail changes.
  staticGroup = new THREE.Group();
  worldRoot.add(staticGroup);
  currentScene.buildStatic(staticGroup);
  // A scene may supply its own base builder (e.g. the sea's carrier + island);
  // otherwise fall back to the generic land bases at the scene's placements.
  beacons = (currentScene.buildBases
    ? currentScene.buildBases(staticGroup)
    : buildBases(staticGroup, currentScene.basePlacements())).beacons;

  helicopter = new Helicopter(path, currentScene.height);
  helicopter.setCruiseSpeed(cruiseSpeed);
  helicopter.setAutoLoop(autoLoop);
  helicopter.setManualControl(manualControl);
  worldRoot.add(helicopter.group);

  buildCinematicStations();
  applyLabelVisibility();
  collectDestructiblePlanes();
}

// Full teardown + rebuild when switching scenes.
function setScene(id) {
  const next = getScene(id);
  if (next === currentScene && terrainGroup) return;
  currentScene = next;
  window.localStorage.setItem(lsKey('scene'), currentScene.id);

  for (const g of [terrainGroup, staticGroup, helicopter?.group]) {
    if (!g) continue;
    worldRoot.remove(g);
    disposeGroup(g);
  }
  terrainGroup = null;
  staticGroup = null;
  helicopter = null;
  destructiblePlanes = [];

  path = currentScene.makePath();
  buildWorld(sceneDetail);
  applyTimeOfDay(timeKey); // scene-specific lighting tweak
  applyShadowQuality();
  requestRecenter();
}

// ----------------------------------------------------------------- state ------
const lsKey = (k) => `apache-canyon.${k}`;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

let cameraMode = window.localStorage.getItem(lsKey('camera')) || 'chase';
let cruiseSpeed = num(window.localStorage.getItem(lsKey('cruise')), 28);
let autoLoop = window.localStorage.getItem(lsKey('loop')) !== 'false';
let timeKey = window.localStorage.getItem(lsKey('time')) || 'golden';
let frameRateMode = window.localStorage.getItem(lsKey('fps')) || '60';
let sceneDetail = window.localStorage.getItem(lsKey('detail')) || 'high';
let shadowQuality = window.localStorage.getItem(lsKey('shadow')) || 'high';
let performanceMode = window.localStorage.getItem(lsKey('perf')) === 'true';
let rendererStats = window.localStorage.getItem(lsKey('stats')) === 'true';
let showLabels = window.localStorage.getItem(lsKey('labels')) !== 'false';
let manualControl = window.localStorage.getItem(lsKey('manual')) === 'true';
let lookOnlyCamera = window.localStorage.getItem(lsKey('lookOnlyCamera')) !== 'false';
let weaponOverlay = window.localStorage.getItem(lsKey('weaponOverlay')) === 'true';
let weaponAimLift = num(window.localStorage.getItem(lsKey('weaponAimLift')), 14);

const frameRateIntervals = { native: 0, 60: 1000 / 60, 30: 1000 / 30 };
const shadowModes = {
  high: { mapSize: 3072 },
  balanced: { mapSize: 2048 },
  performance: { mapSize: 1024 },
  off: { mapSize: 0 },
};

function syncShadowCasters() {
  const highOn = shadowQuality === 'high';
  for (const obj of canyonState?.highShadowObjects ?? []) obj.castShadow = highOn;
}

function applyShadowQuality() {
  if (shadowQuality === 'off') {
    renderer.shadowMap.enabled = false;
    sun.castShadow = false;
    return;
  }
  renderer.shadowMap.enabled = true;
  sun.castShadow = true;
  const mode = shadowModes[shadowQuality] ?? shadowModes.high;
  if (sun.shadow.mapSize.x !== mode.mapSize) {
    sun.shadow.mapSize.set(mode.mapSize, mode.mapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  syncShadowCasters();
}

// Show/hide every in-world text sprite (base names tagged with isWorldLabel).
function applyLabelVisibility() {
  worldRoot.traverse((obj) => {
    if (obj.userData?.isWorldLabel) obj.visible = showLabels;
  });
}

function collectDestructiblePlanes() {
  destructiblePlanes = [];
  worldRoot.traverse((obj) => {
    const cfg = obj.userData?.destructiblePlane;
    if (!cfg) return;
    cfg.hits = cfg.hits ?? 0;
    cfg.destroyed = Boolean(cfg.destroyed);
    destructiblePlanes.push({
      object: obj,
      center: cfg.center?.clone?.() ?? new THREE.Vector3(),
      radius: cfg.radius ?? 5,
      maxHits: cfg.hp ?? 5,
      hits: cfg.hits,
      destroyed: cfg.destroyed,
      burnTimer: 0,
    });
  });
}

function applyRenderQuality() {
  const pr = performanceMode ? 1.0 : Math.min(window.devicePixelRatio, maxPixelRatio);
  renderer.setPixelRatio(pr);
  composer.setPixelRatio?.(pr);
  composer.setSize(window.innerWidth, window.innerHeight);
}

// ------------------------------------------------------------- DOM wiring -----
const $ = (id) => document.getElementById(id);
const menuButton = $('menu-button');
const menuPanel = $('menu-panel');
menuButton.addEventListener('click', () => {
  const open = menuPanel.hidden;
  menuPanel.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
});

const cameraInputs = [...document.querySelectorAll('input[name="camera-mode"]')];
function syncCameraInputs() {
  for (const i of cameraInputs) i.checked = i.value === cameraMode;
  document.body.classList.toggle('cockpit-view', cameraMode === 'cockpit');
}
function setCameraMode(mode) {
  if (!['chase', 'cockpit', 'orbit', 'cinematic'].includes(mode)) return;
  cameraMode = mode;
  interacting = false;
  // Chase/cockpit frame themselves on entry; orbit starts free from the current
  // view (no snap) and only reframes on C; cinematic auto-drives.
  recenter = mode === 'chase' || mode === 'cockpit';
  if (mode === 'orbit' && helicopter) orbitAnchor.copy(helicopter.group.position);
  window.localStorage.setItem(lsKey('camera'), mode);
  syncCameraInputs();
}
cameraInputs.forEach((i) => i.addEventListener('change', () => setCameraMode(i.value)));

const lookOnlyInput = $('look-only-camera');
lookOnlyInput.checked = lookOnlyCamera;
lookOnlyInput.addEventListener('change', () => {
  lookOnlyCamera = lookOnlyInput.checked;
  window.localStorage.setItem(lsKey('lookOnlyCamera'), String(lookOnlyCamera));
  requestRecenter();
});

const sceneSelect = $('scene-select');
sceneSelect.value = currentScene.id;
sceneSelect.addEventListener('change', () => setScene(sceneSelect.value));

const routeSelect = $('route-select');
routeSelect.value = timeKey;
routeSelect.addEventListener('change', () => {
  timeKey = routeSelect.value;
  window.localStorage.setItem(lsKey('time'), timeKey);
  applyTimeOfDay(timeKey);
});

const cruiseInput = $('cruise-speed');
const cruiseValue = $('cruise-speed-value');
cruiseInput.value = String(cruiseSpeed);
cruiseValue.textContent = String(cruiseSpeed);
cruiseInput.addEventListener('input', () => {
  cruiseSpeed = num(cruiseInput.value, 28);
  cruiseValue.textContent = String(cruiseSpeed);
  window.localStorage.setItem(lsKey('cruise'), String(cruiseSpeed));
  helicopter?.setCruiseSpeed(cruiseSpeed);
});

const loopInput = $('auto-loop');
loopInput.checked = autoLoop;
loopInput.addEventListener('change', () => {
  autoLoop = loopInput.checked;
  window.localStorage.setItem(lsKey('loop'), String(autoLoop));
  helicopter?.setAutoLoop(autoLoop);
});

const frameRateSelect = $('frame-rate-select');
frameRateSelect.value = frameRateMode;
frameRateSelect.addEventListener('change', () => {
  frameRateMode = frameRateIntervals[frameRateSelect.value] !== undefined ? frameRateSelect.value : '60';
  lastFrameMs = 0;
  window.localStorage.setItem(lsKey('fps'), frameRateMode);
});

const sceneDetailSelect = $('scene-detail-select');
sceneDetailSelect.value = sceneDetail;
sceneDetailSelect.addEventListener('change', () => {
  sceneDetail = sceneDetailSelect.value;
  window.localStorage.setItem(lsKey('detail'), sceneDetail);
  buildTerrainGroup(sceneDetail);
});

const shadowSelect = $('shadow-quality-select');
shadowSelect.value = shadowQuality;
shadowSelect.addEventListener('change', () => {
  shadowQuality = shadowSelect.value;
  window.localStorage.setItem(lsKey('shadow'), shadowQuality);
  applyShadowQuality();
});

const perfInput = $('performance-mode');
perfInput.checked = performanceMode;
perfInput.addEventListener('change', () => {
  performanceMode = perfInput.checked;
  window.localStorage.setItem(lsKey('perf'), String(performanceMode));
  applyRenderQuality();
});

const labelsInput = $('world-labels');
labelsInput.checked = showLabels;
labelsInput.addEventListener('change', () => {
  showLabels = labelsInput.checked;
  window.localStorage.setItem(lsKey('labels'), String(showLabels));
  applyLabelVisibility();
});

const manualInput = $('manual-control');
manualInput.checked = manualControl;
manualInput.addEventListener('change', () => {
  manualControl = manualInput.checked;
  window.localStorage.setItem(lsKey('manual'), String(manualControl));
  flightKeys.clear();
  helicopter?.setManualControl(manualControl);
  document.body.classList.toggle('manual-control', manualControl);
});

const weaponInput = $('weapon-overlay');
const weaponCrosshair = $('weapon-crosshair');
const hitmarkerEl = $('hitmarker');
function syncWeaponOverlay() {
  document.body.classList.toggle('weapon-overlay', weaponOverlay);
}
weaponInput.checked = weaponOverlay;
weaponInput.addEventListener('change', () => {
  weaponOverlay = weaponInput.checked;
  gunKeyDown = false;
  hitmarkerTimer = 0;
  document.body.classList.remove('hitmarker');
  window.localStorage.setItem(lsKey('weaponOverlay'), String(weaponOverlay));
  syncWeaponOverlay();
});

const weaponAimLiftInput = $('weapon-aim-lift');
const weaponAimLiftValue = $('weapon-aim-lift-value');
weaponAimLift = THREE.MathUtils.clamp(weaponAimLift, Number(weaponAimLiftInput.min), Number(weaponAimLiftInput.max));
weaponAimLiftInput.value = String(weaponAimLift);
weaponAimLiftValue.textContent = String(weaponAimLift);
weaponAimLiftInput.addEventListener('input', () => {
  weaponAimLift = THREE.MathUtils.clamp(num(weaponAimLiftInput.value, 14), Number(weaponAimLiftInput.min), Number(weaponAimLiftInput.max));
  weaponAimLiftValue.textContent = String(weaponAimLift);
  window.localStorage.setItem(lsKey('weaponAimLift'), String(weaponAimLift));
});

const statsInput = $('renderer-stats');
const statsPanel = document.createElement('div');
statsPanel.id = 'renderer-stats-panel';
document.body.appendChild(statsPanel);
statsInput.checked = rendererStats;
statsPanel.hidden = !rendererStats;
statsInput.addEventListener('change', () => {
  rendererStats = statsInput.checked;
  window.localStorage.setItem(lsKey('stats'), String(rendererStats));
  statsPanel.hidden = !rendererStats;
});

// HUD elements.
const hudSpeed = $('hud-speed');
const hudAlt = $('hud-alt');
const hudHdg = $('hud-hdg');
const hudRange = $('hud-range');
const phaseEl = $('phase');
const routeFill = $('route-fill');
const routeHeli = $('route-heli');

// ------------------------------------------------------------- keyboard -------
const orbitPanKeys = new Set();
const flightKeys = new Set();
const FLIGHT_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
let gunKeyDown = false;

// Build the helicopter's manual-control input from the held flight keys.
// W/S cyclic pitch (forward/back), ↑/↓ collective (climb/descend), A/D cyclic
// roll (bank), ←/→ pedals (yaw).
function manualInputFromKeys() {
  const k = flightKeys;
  return {
    collective: (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0),
    pitch: (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0),
    roll: (k.has('a') ? 1 : 0) - (k.has('d') ? 1 : 0),
    yaw: (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0),
  };
}

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (e.shiftKey && key === 'q') {
    document.body.classList.toggle('ui-hidden');
    return;
  }
  if (['1', '2', '3', '4'].includes(e.key)) {
    setCameraMode(['chase', 'cockpit', 'orbit', 'cinematic'][Number(e.key) - 1]);
    return;
  }
  if (key === 'c') {
    requestRecenter();
    return;
  }
  if (e.code === 'Space' && weaponOverlay) {
    gunKeyDown = true;
    e.preventDefault();
    return;
  }
  // While hand-flying, the flight keys drive the helicopter (and override the
  // orbit arrow-pan, so arrows steer the aircraft instead of the camera).
  if (manualControl && FLIGHT_KEYS.has(key)) {
    flightKeys.add(key);
    e.preventDefault();
    return;
  }
  if (cameraMode === 'orbit' && e.key.startsWith('Arrow')) {
    orbitPanKeys.add(e.key);
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  orbitPanKeys.delete(e.key);
  flightKeys.delete(e.key.toLowerCase());
  if (e.code === 'Space') gunKeyDown = false;
});
window.addEventListener('blur', () => {
  orbitPanKeys.clear();
  flightKeys.clear();
  gunKeyDown = false;
  hitmarkerTimer = 0;
  document.body.classList.remove('hitmarker');
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------- cameras --------
// Chase: auto-follows from behind; the azimuth eases back to behind when idle,
//   but the user's zoom (distance) and forward/back tilt (pitch) stick until C.
// Orbit: a free orbit that tracks the heli and never auto-reframes — only C snaps.
// Cockpit: re-aims forward from the seat when idle; you can glance around.
// Cinematic: auto-cuts between canyon-rim stations.
// Heli phases where the orbit camera lets go of its follow-lock (vertical
// takeoff and landing), so the aircraft moves freely within a held frame.
const padTransitionPhases = new Set(['DEPART', 'LAND']);
const orbitOffset = new THREE.Vector3(-24, 13, 28);
const chaseDefaultRadius = 17.3;
const chaseDefaultPhi = 1.18; // ~22 deg above the horizon
const chaseTurnLookahead = 0.16; // subtle yaw preview while hand-flying
const chaseTurnExtraLeadMax = 0.18;
const chaseTurnExtraLeadRate = 0.55;
const followTarget = new THREE.Vector3();
const effectiveFollowTarget = new THREE.Vector3();
const targetWithPan = new THREE.Vector3();
const desiredCamPos = new THREE.Vector3();
const camHeading = new THREE.Vector3();
const effectiveCamHeading = new THREE.Vector3();
const camDelta = new THREE.Vector3();
const cameraPanOffset = new THREE.Vector3();
const tmpFwd = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const orbitAnchor = new THREE.Vector3();
const lookOnlyAnchor = new THREE.Vector3();
const lookOnlyHeading = new THREE.Vector3();
const sph = new THREE.Spherical();
const offsetVec = new THREE.Vector3();

let interacting = false; // a mouse button / wheel drag is active
let recenter = true;
let chaseTurnExtraLead = 0;
let lastChaseYawInput = 0;
let lookOnlyAnchorActive = false;
let chaseYawReleaseHold = false;
let chaseYawReleaseTheta = 0;
let chaseYawReleaseTime = 0;

function shortestAngleTo(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function dampAngle(cur, target, lambda, dt) {
  return cur + shortestAngleTo(cur, target) * (1 - Math.exp(-lambda * dt));
}

function requestRecenter() {
  recenter = true;
  cameraPanOffset.set(0, 0, 0);
  lookOnlyAnchorActive = false;
}
controls.addEventListener('start', () => { interacting = true; });
controls.addEventListener('end', () => { interacting = false; });

function hasDirectionalFlightInput() {
  const k = flightKeys;
  return k.has('w') || k.has('s') || k.has('a') || k.has('d')
    || k.has('arrowleft') || k.has('arrowright');
}

function shouldHoldFollowTarget(mode) {
  if (!lookOnlyCamera || mode === 'cockpit' || mode === 'cinematic') return false;
  if (manualControl && hasDirectionalFlightInput()) return false;
  return helicopter.currentSpeed < 1.0;
}

function resolveFollowTarget(mode) {
  const holdFollow = shouldHoldFollowTarget(mode);
  if (holdFollow && !lookOnlyAnchorActive) {
    lookOnlyAnchor.copy(followTarget);
    lookOnlyHeading.copy(camHeading);
    if (recenter) cameraPanOffset.set(0, 0, 0);
    else cameraPanOffset.copy(controls.target).sub(lookOnlyAnchor);
  } else if (!holdFollow && lookOnlyAnchorActive) {
    if (recenter) cameraPanOffset.set(0, 0, 0);
    else cameraPanOffset.copy(controls.target).sub(followTarget);
  }

  lookOnlyAnchorActive = holdFollow;
  if (holdFollow) {
    lookOnlyAnchor.y = followTarget.y;
    cameraPanOffset.y = 0;
  }
  effectiveFollowTarget.copy(holdFollow ? lookOnlyAnchor : followTarget);
  effectiveCamHeading.copy(holdFollow ? lookOnlyHeading : camHeading);
}

function computeFraming(mode) {
  const lead = helicopter.getLeadFrame();
  camHeading.copy(lead.headingVec);
  if (mode === 'cockpit') {
    const pose = helicopter.getCockpitPose('forward');
    tmpFwd.copy(pose.lookAt).sub(pose.eye).normalize();
    followTarget.copy(pose.eye).addScaledVector(tmpFwd, 9);
    desiredCamPos.copy(pose.eye);
  } else if (mode === 'cinematic') {
    followTarget.copy(lead.point);
    const idx = Math.min(cinematicStations.length - 1, Math.floor(helicopter.progress01 * cinematicStations.length));
    desiredCamPos.copy(cinematicStations[idx] ?? lead.point);
  } else if (mode === 'orbit') {
    followTarget.copy(lead.point);
    desiredCamPos.copy(lead.point).add(orbitOffset);
  } else { // chase
    followTarget.copy(lead.point).addScaledVector(camHeading, 3).addScaledVector(worldUp, 1.6);
  }
}

function updateChase(dt) {
  // Track the viewed point, preserving user pan as a target offset so pan and
  // wheel zoom can be used together instead of being erased by follow motion.
  targetWithPan.copy(effectiveFollowTarget).add(cameraPanOffset);
  camDelta.copy(targetWithPan).sub(controls.target);
  camera.position.add(camDelta);
  controls.target.copy(targetWithPan);

  const yawInput = manualControl
    ? (flightKeys.has('arrowleft') ? 1 : 0) - (flightKeys.has('arrowright') ? 1 : 0)
    : 0;
  const previousYawInput = lastChaseYawInput;
  if (yawInput && yawInput === previousYawInput) {
    chaseTurnExtraLead = Math.min(chaseTurnExtraLeadMax, chaseTurnExtraLead + chaseTurnExtraLeadRate * dt);
  } else {
    chaseTurnExtraLead = 0;
  }
  if (yawInput) chaseYawReleaseHold = false;

  const chaseYaw = yawInput
    ? helicopter.yaw + yawInput * (chaseTurnLookahead + chaseTurnExtraLead) + helicopter.yawVel * 0.1
    : helicopter.yaw;
  const caughtUpTheta = Math.atan2(-effectiveCamHeading.x, -effectiveCamHeading.z);
  const behindTheta = yawInput
    ? Math.atan2(-Math.sin(chaseYaw), -Math.cos(chaseYaw))
    : caughtUpTheta;
  offsetVec.copy(camera.position).sub(controls.target);
  sph.setFromVector3(offsetVec);
  if (!yawInput && previousYawInput) {
    chaseYawReleaseHold = true;
    chaseYawReleaseTheta = sph.theta;
    chaseYawReleaseTime = 0;
  }

  if (recenter) {
    sph.radius = THREE.MathUtils.damp(sph.radius, chaseDefaultRadius, 6, dt);
    sph.phi = THREE.MathUtils.damp(sph.phi, chaseDefaultPhi, 6, dt);
    sph.theta = dampAngle(sph.theta, behindTheta, 6, dt);
    if (Math.abs(sph.radius - chaseDefaultRadius) < 0.4
      && Math.abs(sph.phi - chaseDefaultPhi) < 0.02
      && Math.abs(shortestAngleTo(sph.theta, behindTheta)) < 0.02) recenter = false;
  } else if (!interacting) {
    // Lead the nose slightly on arrow-yaw. Holding the turn adds a little more
    // lead slowly, so the view anticipates sustained turns without snapping.
    if (yawInput) {
      sph.theta = dampAngle(sph.theta, behindTheta, 5, dt);
    } else if (chaseYawReleaseHold) {
      chaseYawReleaseTime += dt;
      const catchDistance = Math.abs(shortestAngleTo(chaseYawReleaseTheta, caughtUpTheta));
      const catchBlend = 1 - THREE.MathUtils.clamp(catchDistance / 0.34, 0, 1);
      const catchLambda = THREE.MathUtils.lerp(0.35, 2.2, catchBlend);
      sph.theta = dampAngle(sph.theta, caughtUpTheta, catchLambda, dt);
      const caught = Math.abs(shortestAngleTo(sph.theta, caughtUpTheta)) < 0.035;
      if (caught || chaseYawReleaseTime > 1.2) chaseYawReleaseHold = false;
    } else if (lookOnlyAnchorActive) {
      // In look-only idle, let the viewer keep whatever direction they panned
      // or orbited to instead of quietly pulling the chase cam back behind.
    } else {
      sph.theta = dampAngle(sph.theta, behindTheta, 2.2, dt);
    }
  }
  lastChaseYawInput = yawInput;
  sph.makeSafe();
  offsetVec.setFromSpherical(sph);
  camera.position.copy(controls.target).add(offsetVec);
  controls.update();
  cameraPanOffset.copy(controls.target).sub(effectiveFollowTarget);
  if (lookOnlyAnchorActive) cameraPanOffset.y = 0;
}

function updateOrbit(dt) {
  targetWithPan.copy(effectiveFollowTarget).add(cameraPanOffset);
  if (recenter) {
    controls.target.copy(effectiveFollowTarget);
    orbitAnchor.copy(effectiveFollowTarget);
    camera.position.lerp(desiredCamPos, 1 - Math.exp(-6 * dt));
    if (camera.position.distanceTo(desiredCamPos) < 0.5) recenter = false;
  } else {
    // Shift the whole rig by the heli's movement; the user's view fully persists.
    camDelta.copy(targetWithPan).sub(controls.target);
    orbitAnchor.copy(effectiveFollowTarget);
    if (padTransitionPhases.has(helicopter.phase)) {
      // Release the position lock during pad transitions, but keep the camera
      // AIMED at the heli so it stays centred while it lifts off / settles.
      // Leaving camera.position untouched frees the framing (and arrow pan), and
      // re-syncing the anchor + target means no offset is carried into cruise.
      controls.target.copy(targetWithPan);
    } else {
      camera.position.add(camDelta);
      controls.target.copy(targetWithPan);
    }
  }

  if (orbitPanKeys.size) {
    camera.getWorldDirection(tmpFwd);
    tmpFwd.y = 0;
    tmpFwd.normalize();
    const right = new THREE.Vector3().crossVectors(tmpFwd, camera.up).normalize();
    const d = new THREE.Vector3();
    if (orbitPanKeys.has('ArrowUp')) d.add(tmpFwd);
    if (orbitPanKeys.has('ArrowDown')) d.addScaledVector(tmpFwd, -1);
    if (orbitPanKeys.has('ArrowRight')) d.add(right);
    if (orbitPanKeys.has('ArrowLeft')) d.addScaledVector(right, -1);
    d.multiplyScalar(40 * dt);
    camera.position.add(d);
    controls.target.add(d);
    cameraPanOffset.copy(controls.target).sub(effectiveFollowTarget);
  }

  controls.update();
  cameraPanOffset.copy(controls.target).sub(effectiveFollowTarget);
  if (lookOnlyAnchorActive) cameraPanOffset.y = 0;
}

function updateCockpit(dt) {
  // Re-aim forward from the seat when idle; allow glancing around while dragging.
  if (recenter || !interacting) {
    camera.position.lerp(desiredCamPos, 1 - Math.exp(-16 * dt));
    controls.target.copy(followTarget);
    if (recenter && camera.position.distanceTo(desiredCamPos) < 0.4) recenter = false;
  }
  controls.update();
}

function updateCinematic(dt) {
  controls.target.copy(followTarget);
  camera.position.lerp(desiredCamPos, 1 - Math.exp(-2.5 * dt));
  recenter = false;
  controls.update();
}

function updateCamera(dt) {
  computeFraming(cameraMode);
  resolveFollowTarget(cameraMode);
  if (cameraMode === 'chase') updateChase(dt);
  else if (cameraMode === 'orbit') updateOrbit(dt);
  else if (cameraMode === 'cockpit') updateCockpit(dt);
  else updateCinematic(dt);
}

// ------------------------------------------------------------- culling --------
const cullOrigin = new THREE.Vector3();
function updateCulling() {
  const cullables = canyonState?.cullables;
  if (!cullables?.length) return;
  cullOrigin.copy(camera.position);
  const maxD = 520 * 520;
  for (const obj of cullables) {
    const r = obj.userData?.cullRadius ?? 60;
    obj.visible = obj.position.distanceToSquared(cullOrigin) <= maxD + r * r;
  }
}

// ------------------------------------------------------------- weapons -------
const gunMuzzle = new THREE.Vector3();
const cameraAimDir = new THREE.Vector3();
const noseAimDir = new THREE.Vector3();
const targetAimDir = new THREE.Vector3();
const gunDir = new THREE.Vector3();
const gunAimPoint = new THREE.Vector3();
const aimProbe = new THREE.Vector3();
const projectileDir = new THREE.Vector3();
const projectileVel = new THREE.Vector3();
const projectilePrev = new THREE.Vector3();
const hitboxCenter = new THREE.Vector3();
const hitSeg = new THREE.Vector3();
const hitToCenter = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const gunProjectiles = [];
const impactParticles = [];
const projectileGeo = new THREE.SphereGeometry(0.08, 8, 6);
const flameGeo = new THREE.SphereGeometry(1, 8, 6);
const smokeGeo = new THREE.SphereGeometry(1, 10, 8);
const projectileMat = new THREE.MeshBasicMaterial({ color: 0xfff2b5 });
const flameBaseMat = new THREE.MeshBasicMaterial({
  color: 0xffa22e,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const smokeBaseMat = new THREE.MeshBasicMaterial({
  color: 0x4e514d,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
});
let lastGunShotAt = -Infinity;
let hitmarkerTimer = 0;
let aimScreenX = window.innerWidth / 2;
let aimScreenY = window.innerHeight / 2;
let aimDirReady = false;
const gunShotInterval = 0.08;
const projectileSpeed = 430;
const projectileLife = 1.35;
const aimMaxDistance = 560;
const weaponNoseLeadMax = 0.18;
const weaponAimLiftScale = 0.01;
const planeEffectStep = 1 / 30;

function findAimImpact(origin, dir, out) {
  let lastD = 0;
  for (let i = 1; i <= 80; i++) {
    const d = (i / 80) * aimMaxDistance;
    aimProbe.copy(origin).addScaledVector(dir, d);
    const groundY = currentScene.height(aimProbe.x, aimProbe.z) + 0.18;
    if (aimProbe.y <= groundY) {
      let lo = lastD;
      let hi = d;
      for (let j = 0; j < 7; j++) {
        const mid = (lo + hi) * 0.5;
        aimProbe.copy(origin).addScaledVector(dir, mid);
        if (aimProbe.y <= currentScene.height(aimProbe.x, aimProbe.z) + 0.18) hi = mid;
        else lo = mid;
      }
      out.copy(origin).addScaledVector(dir, hi);
      out.y = currentScene.height(out.x, out.z) + 0.22;
      return true;
    }
    lastD = d;
  }

  out.copy(origin).addScaledVector(dir, aimMaxDistance);
  return false;
}

function updateWeaponAim(dt) {
  camera.getWorldDirection(cameraAimDir);
  noseAimDir.set(0, 0, 1).applyQuaternion(helicopter.group.quaternion).normalize();
  const yawInput = manualControl
    ? (flightKeys.has('arrowleft') ? 1 : 0) - (flightKeys.has('arrowright') ? 1 : 0)
    : 0;
  const noseLead = THREE.MathUtils.clamp(helicopter.yawVel * 0.24 + yawInput * 0.08, -weaponNoseLeadMax, weaponNoseLeadMax);
  noseAimDir.applyAxisAngle(worldUp, noseLead).normalize();
  const cameraY = THREE.MathUtils.clamp(cameraAimDir.y, -0.98, 0.98);
  const cameraHorizontal = Math.sqrt(Math.max(1 - cameraY * cameraY, 0.0001));
  targetAimDir.set(
    cameraAimDir.x * 0.72 + noseAimDir.x * 0.28,
    0,
    cameraAimDir.z * 0.72 + noseAimDir.z * 0.28,
  );
  if (targetAimDir.lengthSq() < 1e-5) targetAimDir.set(cameraAimDir.x, 0, cameraAimDir.z);
  targetAimDir.normalize().multiplyScalar(cameraHorizontal);
  targetAimDir.y = cameraY;
  targetAimDir.y += weaponAimLift * weaponAimLiftScale * cameraHorizontal;
  targetAimDir.normalize();
  if (!aimDirReady) {
    gunDir.copy(targetAimDir);
    aimDirReady = true;
  } else {
    gunDir.lerp(targetAimDir, 1 - Math.exp(-7 * dt)).normalize();
  }

  findAimImpact(camera.position, gunDir, gunAimPoint);
  aimProbe.copy(gunAimPoint).project(camera);
  if (Number.isFinite(aimProbe.x) && Number.isFinite(aimProbe.y) && aimProbe.z < 1) {
    const nextX = THREE.MathUtils.clamp((aimProbe.x * 0.5 + 0.5) * window.innerWidth, 18, window.innerWidth - 18);
    const nextY = THREE.MathUtils.clamp((-aimProbe.y * 0.5 + 0.5) * window.innerHeight, 18, window.innerHeight - 18);
    const a = 1 - Math.exp(-10 * dt);
    aimScreenX += (nextX - aimScreenX) * a;
    aimScreenY += (nextY - aimScreenY) * a;
  }
  weaponCrosshair.style.left = `${aimScreenX}px`;
  weaponCrosshair.style.top = `${aimScreenY}px`;
  hitmarkerEl.style.left = `${aimScreenX}px`;
  hitmarkerEl.style.top = `${aimScreenY}px`;
}

function emitImpact(pos) {
  const flameCount = 10;
  const smokeCount = 14;
  for (let i = 0; i < flameCount; i++) {
    const mat = flameBaseMat.clone();
    const mesh = new THREE.Mesh(flameGeo, mat);
    mesh.position.copy(pos);
    const s = 0.45 + Math.random() * 0.9;
    mesh.scale.setScalar(s);
    scene.add(mesh);
    impactParticles.push({
      mesh,
      mat,
      kind: 'impact',
      age: 0,
      life: 0.22 + Math.random() * 0.18,
      grow: 3.8,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        7 + Math.random() * 15,
        (Math.random() - 0.5) * 18,
      ),
    });
  }

  for (let i = 0; i < smokeCount; i++) {
    const mat = smokeBaseMat.clone();
    const mesh = new THREE.Mesh(smokeGeo, mat);
    mesh.position.copy(pos);
    const s = 0.7 + Math.random() * 1.3;
    mesh.scale.setScalar(s);
    scene.add(mesh);
    impactParticles.push({
      mesh,
      mat,
      kind: 'impact',
      age: 0,
      life: 1.0 + Math.random() * 0.65,
      grow: 1.6,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        2 + Math.random() * 7,
        (Math.random() - 0.5) * 8,
      ),
    });
  }
}

function emitPlaneHitEffect(pos, phase = 'hit') {
  const exploding = phase === 'explode';
  const burning = phase === 'burn';
  const flameCount = exploding ? 20 : burning ? 3 : 5;
  const smokeCount = exploding ? 24 : burning ? 5 : 4;
  for (let i = 0; i < flameCount; i++) {
    const mat = flameBaseMat.clone();
    const mesh = new THREE.Mesh(flameGeo, mat);
    mesh.position.copy(pos);
    const flameScale = exploding ? 0.55 + Math.random() * 1.2
      : burning ? 0.2 + Math.random() * 0.2
        : 0.25 + Math.random() * 0.45;
    mesh.scale.setScalar(flameScale);
    scene.add(mesh);
    impactParticles.push({
      mesh,
      mat,
      kind: exploding || burning ? 'plane' : 'impact',
      age: 0,
      tick: 0,
      life: exploding ? 0.3 + Math.random() * 0.25
        : burning ? 0.7 + Math.random() * 0.35
          : 0.14 + Math.random() * 0.25,
      grow: exploding ? 4.2 : burning ? 0.18 : 2.2,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * (exploding ? 18 : burning ? 0.8 : 8),
        (exploding ? 5 : burning ? 0.35 : 2) + Math.random() * (exploding ? 16 : burning ? 0.75 : 6),
        (Math.random() - 0.5) * (exploding ? 18 : burning ? 0.8 : 8),
      ),
    });
  }

  for (let i = 0; i < smokeCount; i++) {
    const mat = smokeBaseMat.clone();
    const mesh = new THREE.Mesh(smokeGeo, mat);
    mesh.position.copy(pos);
    if (burning) {
      mesh.position.y += 0.25 + Math.random() * 0.8;
      const smokeScale = 0.28 + Math.random() * 0.22;
      mesh.scale.setScalar(smokeScale);
    } else {
      mesh.scale.setScalar(exploding ? 0.8 + Math.random() * 1.6 : 0.35 + Math.random() * 0.55);
    }
    scene.add(mesh);
    impactParticles.push({
      mesh,
      mat,
      kind: exploding || burning ? 'plane' : 'impact',
      age: 0,
      tick: 0,
      life: exploding ? 1.2 + Math.random() * 0.9
        : burning ? 4.4 + Math.random() * 2.3
          : 0.45 + Math.random() * 0.9,
      grow: exploding ? 1.8 : burning ? 0.22 : 1.0,
      growCap: burning ? 2.0 + Math.random() * 1.0 : null,
      gravity: burning ? 0.15 : 5.5,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * (exploding ? 8 : burning ? 0.35 : 4),
        (exploding ? 3 : burning ? 1.32 : 1) + Math.random() * (exploding ? 8 : burning ? 0.9 : 3),
        (Math.random() - 0.5) * (exploding ? 8 : burning ? 0.35 : 4),
      ),
    });
  }
}

function triggerHitmarker() {
  hitmarkerTimer = 0.11;
  document.body.classList.add('hitmarker');
}

function markPlaneDestroyed(target, pos) {
  target.destroyed = true;
  target.object.userData.destructiblePlane.destroyed = true;
  target.object.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    child.material = child.material.clone();
    child.material.color?.multiplyScalar(0.28);
    child.material.emissive?.setHex?.(0x220600);
    if ('emissiveIntensity' in child.material) child.material.emissiveIntensity = 0.5;
    child.castShadow = true;
  });
  target.object.rotation.z += (Math.random() - 0.5) * 0.22;
  target.object.rotation.x += (Math.random() - 0.5) * 0.12;
  emitPlaneHitEffect(pos, 'explode');
}

function damagePlane(target, pos) {
  if (target.destroyed) return;
  target.hits += 1;
  target.object.userData.destructiblePlane.hits = target.hits;
  triggerHitmarker();
  emitPlaneHitEffect(pos, 'hit');
  if (target.hits >= target.maxHits) markPlaneDestroyed(target, pos);
}

function projectilePlaneHit(start, end) {
  hitSeg.copy(end).sub(start);
  const lenSq = hitSeg.lengthSq();
  if (lenSq < 1e-6) return null;

  let best = null;
  let bestT = Infinity;
  for (const target of destructiblePlanes) {
    if (target.destroyed) continue;
    target.object.localToWorld(hitboxCenter.copy(target.center));
    hitToCenter.copy(hitboxCenter).sub(start);
    const t = THREE.MathUtils.clamp(hitToCenter.dot(hitSeg) / lenSq, 0, 1);
    hitPoint.copy(start).addScaledVector(hitSeg, t);
    if (hitPoint.distanceToSquared(hitboxCenter) <= target.radius * target.radius && t < bestT) {
      bestT = t;
      best = { target, point: hitPoint.clone() };
    }
  }
  return best;
}

function emitGunProjectile() {
  gunMuzzle.set(0, -0.95, 4.65).applyQuaternion(helicopter.group.quaternion).add(helicopter.group.position);
  projectileDir.copy(gunAimPoint).sub(gunMuzzle);
  if (projectileDir.lengthSq() < 1e-4) projectileDir.copy(gunDir);
  else projectileDir.normalize();

  const mesh = new THREE.Mesh(projectileGeo, projectileMat);
  mesh.position.copy(gunMuzzle);
  mesh.scale.set(1, 1, 4.5);
  mesh.quaternion.setFromUnitVectors(worldUp, projectileDir);
  mesh.renderOrder = 10;
  scene.add(mesh);
  projectileVel.copy(projectileDir).multiplyScalar(projectileSpeed);
  gunProjectiles.push({ mesh, vel: projectileVel.clone(), age: 0 });
}

function updateWeapons(dt, t) {
  updateWeaponAim(dt);
  if (weaponOverlay && gunKeyDown && t - lastGunShotAt >= gunShotInterval) {
    emitGunProjectile();
    lastGunShotAt = t;
  }

  for (let i = gunProjectiles.length - 1; i >= 0; i--) {
    const p = gunProjectiles[i];
    p.age += dt;
    projectilePrev.copy(p.mesh.position);
    p.mesh.position.addScaledVector(p.vel, dt);
    const planeHit = projectilePlaneHit(projectilePrev, p.mesh.position);
    if (planeHit) {
      damagePlane(planeHit.target, planeHit.point);
      scene.remove(p.mesh);
      gunProjectiles.splice(i, 1);
      continue;
    }
    const groundY = currentScene.height(p.mesh.position.x, p.mesh.position.z) + 0.2;
    if (p.mesh.position.y <= groundY || p.age >= projectileLife) {
      if (p.mesh.position.y <= groundY) {
        p.mesh.position.y = groundY;
        emitImpact(p.mesh.position);
      }
      scene.remove(p.mesh);
      gunProjectiles.splice(i, 1);
    }
  }

  for (const target of destructiblePlanes) {
    if (!target.destroyed) continue;
    target.burnTimer -= dt;
    if (target.burnTimer <= 0) {
      target.object.localToWorld(hitboxCenter.copy(target.center));
      hitboxCenter.y += 0.8 + Math.random() * 0.8;
      emitPlaneHitEffect(hitboxCenter, 'burn');
      target.burnTimer = 0.28 + Math.random() * 0.16;
    }
  }

  if (hitmarkerTimer > 0) {
    hitmarkerTimer -= dt;
    if (hitmarkerTimer <= 0) document.body.classList.remove('hitmarker');
  }

  for (let i = impactParticles.length - 1; i >= 0; i--) {
    const p = impactParticles[i];
    p.age += dt;
    const stepDt = p.kind === 'plane'
      ? (() => {
          p.tick = (p.tick ?? 0) + dt;
          if (p.tick < planeEffectStep && p.age < p.life) return 0;
          const stepped = p.tick;
          p.tick = 0;
          return stepped;
        })()
      : dt;
    if (stepDt > 0) {
      p.mesh.position.addScaledVector(p.vel, stepDt);
      p.vel.y -= (p.gravity ?? 5.5) * stepDt;
      if (p.growCap) {
        const nextScale = Math.min(p.growCap, p.mesh.scale.x + p.grow * stepDt);
        p.mesh.scale.setScalar(nextScale);
      }
      else if (p.growVec) p.mesh.scale.addScaledVector(p.growVec, stepDt);
      else p.mesh.scale.addScalar(p.grow * stepDt);
    }
    p.mat.opacity = Math.max(0, p.mat.opacity * (1 - dt / Math.max(p.life - p.age + dt, 0.05)));
    if (p.age >= p.life) {
      scene.remove(p.mesh);
      p.mat.dispose();
      impactParticles.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------- HUD update -----
let lastHudMs = 0;
function updateHud(now) {
  if (now - lastHudMs < 90) return;
  lastHudMs = now;
  const kt = Math.round(helicopter.currentSpeed * 3.5);
  const ft = Math.round(helicopter.altitudeAGL * 3.3);
  const hdg = Math.round(helicopter.headingDeg).toString().padStart(3, '0');
  const nm = (helicopter.rangeToDestNm / 60).toFixed(1);
  hudSpeed.textContent = String(kt);
  hudAlt.textContent = String(ft);
  hudHdg.textContent = hdg;
  hudRange.textContent = nm;
  phaseEl.textContent = helicopter.phase === 'LANDED'
    ? `LANDED · ${helicopter.destName}`
    : `${helicopter.phase} → ${helicopter.destName}`;

  const pct = helicopter.progress01 * 100;
  routeFill.style.width = `${pct}%`;
  routeHeli.style.left = `${pct}%`;
}

function updateStats(now) {
  if (!rendererStats || now - lastStatsMs < 250) return;
  lastStatsMs = now;
  const r = renderer.info.render;
  statsPanel.textContent = `calls ${r.calls} / tri ${r.triangles} / ${renderer.getPixelRatio().toFixed(2)}x`;
}
let lastStatsMs = 0;

// --------------------------------------------------------------- loop ---------
const clock = new THREE.Clock();
let lastFrameMs = 0;
function shouldRender(now) {
  const interval = frameRateIntervals[frameRateMode] ?? frameRateIntervals['60'];
  if (interval <= 0) return true;
  if (lastFrameMs === 0) { lastFrameMs = now; return true; }
  const elapsed = now - lastFrameMs;
  if (elapsed < interval - 0.5) return false;
  lastFrameMs = now - (elapsed % interval);
  return true;
}

function animate(now = 0) {
  requestAnimationFrame(animate);
  if (!shouldRender(now)) return;

  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (manualControl) helicopter.manualInput = manualInputFromKeys();
  helicopter.update(dt, t);

  // Sun + shadow follow the helicopter.
  const heliPos = helicopter.group.position;
  sun.target.position.copy(heliPos);
  sun.position.copy(heliPos).addScaledVector(sunDir, 240);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 1400);

  // Blinking base beacons.
  const blink = (t % 1.4) < 0.12 ? 2.4 : 0.5;
  for (const m of beacons) m.emissiveIntensity = blink;

  updateCamera(dt);
  updateWeapons(dt, t);

  updateCulling();
  updateHud(now);

  if (performanceMode) renderer.render(scene, camera);
  else composer.render();
  updateStats(now);
}

// --------------------------------------------------------------- boot ---------
applyTimeOfDay(timeKey);
applyShadowQuality();
applyRenderQuality();
buildWorld(sceneDetail);
syncCameraInputs();
document.body.classList.toggle('manual-control', manualControl);
syncWeaponOverlay();
controls.enabled = true;
requestRecenter();
animate();
