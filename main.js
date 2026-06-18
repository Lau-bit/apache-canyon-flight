import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildCanyon, WORLD } from './modules/canyon.js';
import { buildBases } from './modules/bases.js';
import { FlightPath } from './modules/flightpath.js';
import { Helicopter } from './modules/helicopter.js';

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
camera.position.set(WORLD.baseAx - 36, 30, 48);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.5;
controls.minDistance = 3;
controls.maxDistance = 320;
controls.maxPolarAngle = Math.PI * 0.495;

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
  const p = timeOfDay[key] ?? timeOfDay.noon;
  skyMat.uniforms.topColor.value.setHex(p.sky.top);
  skyMat.uniforms.midColor.value.setHex(p.sky.mid);
  skyMat.uniforms.bottomColor.value.setHex(p.sky.bottom);
  scene.fog = new THREE.Fog(p.fog.color, p.fog.near, p.fog.far);
  sun.color.setHex(p.sun.color);
  sun.intensity = p.sun.intensity;
  sunDir.copy(p.sun.dir).normalize();
  hemi.color.setHex(p.hemi.sky);
  hemi.groundColor.setHex(p.hemi.ground);
  hemi.intensity = p.hemi.intensity;
  ambient.intensity = p.ambient;
  renderer.toneMappingExposure = p.exposure;
  sunSprite.material.color.setHex(p.sunColor);
}

// --------------------------------------------------------------- post-fx ------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ----------------------------------------------------------------- world ------
const path = new FlightPath();
let worldRoot = new THREE.Group();
scene.add(worldRoot);
let canyonGroup = null;
let canyonState = null;
let beacons = [];
let helicopter = null;
let cinematicStations = [];

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

function buildCanyonGroup(detail) {
  if (canyonGroup) {
    worldRoot.remove(canyonGroup);
    disposeGroup(canyonGroup);
  }
  canyonGroup = new THREE.Group();
  worldRoot.add(canyonGroup);
  canyonState = buildCanyon(canyonGroup, { detail });
  syncShadowCasters();
}

function buildWorld(detail) {
  buildCanyonGroup(detail);

  const staticGroup = new THREE.Group();
  worldRoot.add(staticGroup);
  beacons = buildBases(staticGroup).beacons;

  helicopter = new Helicopter(path);
  helicopter.setCruiseSpeed(cruiseSpeed);
  helicopter.setAutoLoop(autoLoop);
  worldRoot.add(helicopter.group);

  buildCinematicStations();
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
  buildCanyonGroup(sceneDetail);
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
  if (cameraMode === 'orbit' && e.key.startsWith('Arrow')) {
    orbitPanKeys.add(e.key);
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => orbitPanKeys.delete(e.key));
window.addEventListener('blur', () => orbitPanKeys.clear());

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
const orbitOffset = new THREE.Vector3(-24, 13, 28);
const chaseDefaultRadius = 17.3;
const chaseDefaultPhi = 1.18; // ~22 deg above the horizon
const followTarget = new THREE.Vector3();
const desiredCamPos = new THREE.Vector3();
const camHeading = new THREE.Vector3();
const camDelta = new THREE.Vector3();
const tmpFwd = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const orbitAnchor = new THREE.Vector3();
const sph = new THREE.Spherical();
const offsetVec = new THREE.Vector3();

let interacting = false; // a mouse button / wheel drag is active
let recenter = true;

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
}
controls.addEventListener('start', () => { interacting = true; });
controls.addEventListener('end', () => { interacting = false; });

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
  // Track the heli, preserving the current offset so zoom + tilt persist.
  camDelta.copy(followTarget).sub(controls.target);
  camera.position.add(camDelta);
  controls.target.copy(followTarget);

  const behindTheta = Math.atan2(-camHeading.x, -camHeading.z);
  offsetVec.copy(camera.position).sub(controls.target);
  sph.setFromVector3(offsetVec);

  if (recenter) {
    sph.radius = THREE.MathUtils.damp(sph.radius, chaseDefaultRadius, 6, dt);
    sph.phi = THREE.MathUtils.damp(sph.phi, chaseDefaultPhi, 6, dt);
    sph.theta = dampAngle(sph.theta, behindTheta, 6, dt);
    if (Math.abs(sph.radius - chaseDefaultRadius) < 0.4
      && Math.abs(sph.phi - chaseDefaultPhi) < 0.02
      && Math.abs(shortestAngleTo(sph.theta, behindTheta)) < 0.02) recenter = false;
  } else if (!interacting) {
    // Ease only the azimuth back to behind; keep the user's zoom & tilt.
    sph.theta = dampAngle(sph.theta, behindTheta, 2.2, dt);
  }
  sph.makeSafe();
  offsetVec.setFromSpherical(sph);
  camera.position.copy(controls.target).add(offsetVec);
  controls.update();
}

function updateOrbit(dt) {
  if (recenter) {
    controls.target.copy(followTarget);
    orbitAnchor.copy(followTarget);
    camera.position.lerp(desiredCamPos, 1 - Math.exp(-6 * dt));
    if (camera.position.distanceTo(desiredCamPos) < 0.5) recenter = false;
  } else {
    // Shift the whole rig by the heli's movement; the user's view fully persists.
    camDelta.copy(followTarget).sub(orbitAnchor);
    orbitAnchor.copy(followTarget);
    camera.position.add(camDelta);
    controls.target.add(camDelta);
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
    orbitAnchor.add(d);
  }

  controls.update();
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
controls.enabled = true;
requestRecenter();
animate();
