import * as THREE from 'three';
import { buildCanyon, terrainHeight, canyonCenterZ, canyonHalfWidth, WORLD } from './canyon.js';
import { buildBases } from './bases.js';
import { makeStrikeJet } from './sea.js';
import { CollisionWorld } from './collision.js';

// ---------------------------------------------------------------------------
// "Canyon assault" — the first real gunning gameplay level. The player runs the
// canyon corridor from the friendly FOB (ALPHA) toward the enemy HQ (BRAVO),
// shooting up a string of ground targets: anti-air turrets, watchtowers, a
// bunker, a captured airfield with hangar + parked strike jets (the same plane
// the sea scene parks on its carrier), the enemy command base, and a column of
// tanks advancing up the wadi to meet you.
//
// Every installation is a destructible target (the sea scene's destruction
// pipeline picks them up via userData.destructiblePlane). A small collision
// world walls the player out of the structures and keeps the tank column from
// driving through the terrain, the buildings, or each other.
// ---------------------------------------------------------------------------

// Shared military palette.
function mats() {
  return {
    olive: new THREE.MeshStandardMaterial({ color: 0x4a512f, roughness: 0.85 }),
    oliveDk: new THREE.MeshStandardMaterial({ color: 0x363b22, roughness: 0.85 }),
    sand: new THREE.MeshStandardMaterial({ color: 0x8f7c52, roughness: 0.92 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 0.96 }),
    concreteDk: new THREE.MeshStandardMaterial({ color: 0x3f4039, roughness: 0.96 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5a5f63, roughness: 0.5, metalness: 0.6 }),
    steelDk: new THREE.MeshStandardMaterial({ color: 0x2c2f31, roughness: 0.6, metalness: 0.5 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x7a4a30, roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1c2a2c, roughness: 0.3, metalness: 0.4 }),
    track: new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.92 }),
  };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Smallest signed delta from angle a to angle b (radians), wrapped to (-pi, pi].
function angDelta(a, b) {
  return ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

// ---------------------------------------------------------------------------
// Enemy fire patterns. Each enemy type aims at a PREDICTED point in 3D space
// (target position led by its velocity) with a per-shot spread cone, then fires
// a dumb tracer toward that fixed point. The round does NOT home on the
// helicopter, so a jinking pilot can be missed — the enemy is shooting at where
// it thinks you'll be, not at you.
//
// The OVERALL rate is driven by a per-type "rounds per minute" budget (the
// Combat sliders), but each type keeps its own SHAPE of fire: bursts, burst
// spacing, spread, lead, speed and damage. Salvo spacing is derived from the
// rpm so that (burst rounds) * (salvos per minute) = the requested rpm.
//   type     : key into the live per-type rpm table
//   range    : max engagement distance (m)
//   burst    : rounds per salvo; burstGap : seconds between them
//   lead     : 0..1+ how much target velocity is led (1 = full intercept guess)
//   spread   : base aim scatter (m); cone : extra scatter per metre of range
//   speed    : tracer speed (m/s); damage : hp per hit on the helicopter
//   color/size/radius : tracer look (size = length scale, radius = thickness m)
// ---------------------------------------------------------------------------
const FIRE = {
  turret: {
    type: 'turret', range: 330, burst: 2, burstGap: 0.13,
    lead: 0.85, spread: 1.8, cone: 0.012, speed: 210, damage: 5,
    color: 0xffcaa0, size: 3.0, radius: 0.12,
  },
  tank: {
    type: 'tank', range: 380, burst: 1, burstGap: 0,
    lead: 1.0, spread: 1.4, cone: 0.005, speed: 155, damage: 22,
    color: 0xffe07a, size: 5.0, radius: 0.26,
  },
  tower: {
    type: 'tower', range: 235, burst: 7, burstGap: 0.09,
    lead: 0.5, spread: 4.5, cone: 0.03, speed: 235, damage: 2,
    color: 0xfff0b0, size: 2.3, radius: 0.09,
  },
  bunker: {
    type: 'bunker', range: 300, burst: 3, burstGap: 0.11,
    lead: 0.8, spread: 1.1, cone: 0.008, speed: 220, damage: 6,
    color: 0xffd2a0, size: 3.2, radius: 0.14,
  },
};

// Default rounds-per-minute per type, chosen so the derived salvo spacing
// reproduces the hand-tuned cadence above. The live values live on the world
// returned by buildAssault and are driven by the Combat sliders.
const DEFAULT_RPM = { turret: 80, tank: 16, tower: 190, bunker: 190 };

// Default tracer speed (m/s) per type — a touch slower than before so rounds
// are a little easier to read and dodge. Live values are driven by the Combat
// "projectile speed" sliders through setProjectileSpeed.
const DEFAULT_SPEED = { turret: 210, tank: 155, tower: 235, bunker: 220 };

// Fresh fire-control state for a shooter (desynced first salvo so a line of
// emplacements doesn't volley in lockstep).
function makeFireState() {
  return { fireTimer: 0.3 + Math.random() * 2, burstLeft: 0, burstTimer: 0 };
}

// Mark a group as a destructible target the weapon system can find + destroy.
// `center` is a local-space point; `radius` the hit sphere; `hp` shots to kill.
function destructible(group, { hp, radius, center }) {
  group.userData.destructiblePlane = { hp, radius, center: center.clone() };
  return group;
}

function makeLabel(text, y) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 28px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd0c0';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  sprite.position.set(0, y, 0);
  sprite.scale.set(12, 3, 1);
  sprite.userData.isWorldLabel = true;
  return sprite;
}

// --- Individual installations ----------------------------------------------

// Anti-air gun: a fixed base with a rotating head and an elevating twin barrel.
// Returns the pivots so the level updater can track the player with them.
function makeTurret(M) {
  const group = new THREE.Group();
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.4, 1.6, 14), M.concrete);
  ped.position.y = 0.8;
  ped.castShadow = true; ped.receiveShadow = true;
  group.add(ped);

  // Sandbag ring around the emplacement.
  const bagGeo = new THREE.BoxGeometry(1.0, 0.5, 0.7);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const bag = new THREE.Mesh(bagGeo, M.sand);
    bag.position.set(Math.cos(a) * 3.0, 0.3, Math.sin(a) * 3.0);
    bag.rotation.y = a;
    bag.castShadow = true;
    group.add(bag);
  }

  const headPivot = new THREE.Group();
  headPivot.position.y = 1.7;
  group.add(headPivot);
  const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 2.2), M.olive);
  head.position.y = 0.4;
  head.castShadow = true;
  headPivot.add(head);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.6, 0.25), M.oliveDk);
  shield.position.set(0, 0.6, 1.1);
  headPivot.add(shield);

  const barrelPivot = new THREE.Group();
  barrelPivot.position.set(0, 0.6, 1.1);
  headPivot.add(barrelPivot);
  for (const bx of [-0.35, 0.35]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.2, 8), M.steelDk);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(bx, 0, 2.1);
    barrel.castShadow = true;
    barrelPivot.add(barrel);
  }
  // Muzzle flash sprite at the barrel tips (pulsed on fire).
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), flashMat);
  flash.position.set(0, 0, 4.3);
  barrelPivot.add(flash);

  destructible(group, { hp: 4, radius: 4.0, center: new THREE.Vector3(0, 1.8, 0) });
  return { group, headPivot, barrelPivot, flashMat };
}

// Guard tower: four legs, a railed cabin, and a roof.
function makeWatchtower(M) {
  const group = new THREE.Group();
  const h = 14;
  const legGeo = new THREE.BoxGeometry(0.5, h, 0.5);
  for (const lx of [-2.2, 2.2]) for (const lz of [-2.2, 2.2]) {
    const leg = new THREE.Mesh(legGeo, M.steel);
    leg.position.set(lx, h / 2, lz);
    leg.castShadow = true;
    group.add(leg);
    // X-braces.
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 6.3), M.steelDk);
    brace.position.set(lx, h * 0.5, 0);
    brace.rotation.x = Math.atan2(h * 0.6, 4.4);
    group.add(brace);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 6), M.concrete);
  deck.position.y = h;
  deck.castShadow = true; deck.receiveShadow = true;
  group.add(deck);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 5), M.olive);
  cabin.position.y = h + 1.5;
  cabin.castShadow = true;
  group.add(cabin);
  const win = new THREE.Mesh(new THREE.BoxGeometry(5.05, 1.1, 5.05), M.glass);
  win.position.y = h + 1.9;
  group.add(win);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 6), M.concreteDk);
  roof.position.y = h + 3;
  roof.castShadow = true;
  group.add(roof);
  // Searchlight on the rail.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a261a, emissive: 0xfff0c0, emissiveIntensity: 1.0 });
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.6, 12), lampMat);
  lamp.rotation.z = Math.PI / 2;
  lamp.position.set(2.6, h + 0.6, 0);
  group.add(lamp);

  destructible(group, { hp: 5, radius: 4.5, center: new THREE.Vector3(0, h + 1, 0) });
  return { group };
}

// Hardened bunker: a low sloped concrete block with a dark firing slit.
function makeBunker(M) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 8), M.concrete);
  body.position.y = 2;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);
  // Sloped glacis at the front.
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(10, 2.4, 3), M.concreteDk);
  glacis.position.set(0, 3, 4.6);
  glacis.rotation.x = 0.5;
  group.add(glacis);
  const slit = new THREE.Mesh(new THREE.BoxGeometry(6, 0.7, 0.4), M.glass);
  slit.position.set(0, 2.6, 4.0);
  group.add(slit);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.0, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.concrete);
  dome.position.set(0, 4, -1);
  dome.castShadow = true;
  group.add(dome);
  // Sandbags piled against the side.
  const bagGeo = new THREE.BoxGeometry(1.1, 0.5, 0.8);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) {
    const bag = new THREE.Mesh(bagGeo, M.sand);
    bag.position.set(-5.6, 0.25 + r * 0.5, -3 + i * 1.05 + (r % 2) * 0.5);
    bag.castShadow = true;
    group.add(bag);
  }

  destructible(group, { hp: 7, radius: 6.5, center: new THREE.Vector3(0, 2.4, 0) });
  return { group };
}

// Arched aircraft hangar — a half-cylinder shell open at the front.
function makeHangar(M) {
  const group = new THREE.Group();
  const w = 22, len = 26, r = 11;
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, len, 24, 1, true, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x6b6f63, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide }),
  );
  shell.rotation.z = Math.PI / 2;
  shell.rotation.y = Math.PI / 2;
  shell.position.y = 0.2;
  shell.castShadow = true; shell.receiveShadow = true;
  group.add(shell);
  // Back wall.
  const back = new THREE.Mesh(new THREE.CircleGeometry(r, 24, 0, Math.PI), M.concreteDk);
  back.rotation.y = Math.PI;
  back.position.set(0, 0.2, -len / 2);
  group.add(back);
  // Tarmac apron in front.
  const apron = new THREE.Mesh(new THREE.BoxGeometry(w + 10, 0.16, len + 24), M.concreteDk);
  apron.position.set(0, 0.08, len * 0.35);
  apron.receiveShadow = true;
  group.add(apron);

  destructible(group, { hp: 9, radius: 12, center: new THREE.Vector3(0, 5, 0) });
  return { group, apronHalfLen: (len + 24) / 2 };
}

// Enemy command compound: a two-storey HQ, a radar dish, antennas, vehicles.
function makeCommandBase(M) {
  const group = new THREE.Group();
  const hq = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 11), M.concrete);
  hq.position.y = 4.5;
  hq.castShadow = true; hq.receiveShadow = true;
  group.add(hq);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 8), M.concreteDk);
  upper.position.set(2, 11, 0);
  upper.castShadow = true;
  group.add(upper);
  const band = new THREE.Mesh(new THREE.BoxGeometry(14.1, 1.4, 11.1), M.glass);
  band.position.y = 6.5;
  group.add(band);
  // Rotating radar dish on the roof.
  const radarPivot = new THREE.Group();
  radarPivot.position.set(-3.5, 13.5, 0);
  group.add(radarPivot);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2),
    new THREE.MeshStandardMaterial({ color: 0xb9bcae, roughness: 0.6, metalness: 0.3 }));
  dish.rotation.x = -1.0;
  dish.position.y = 1.0;
  radarPivot.add(dish);
  const radarMast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2, 8), M.steel);
  radarMast.position.y = 0.4;
  radarPivot.add(radarMast);
  // Antenna with a blinking obstruction light (returned as a beacon).
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 16, 8), M.steel);
  mast.position.set(5, 8, -4);
  group.add(mast);
  const obsMat = new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0xff2010, emissiveIntensity: 2.0 });
  const obs = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), obsMat);
  obs.position.set(5, 16.2, -4);
  group.add(obs);
  // Jersey barriers + a flag mast out front.
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 0.95 });
  for (let i = -2; i <= 2; i++) {
    const j = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.1, 0.7), barrierMat);
    j.position.set(i * 3.2, 0.55, 8);
    j.castShadow = true;
    group.add(j);
  }

  destructible(group, { hp: 12, radius: 9.5, center: new THREE.Vector3(0, 5, 0) });
  return { group, radarPivot, beacons: [obsMat] };
}

// A tracked tank: hull, tracks, a tracking turret + gun. Returns pivots so the
// level updater can drive + aim it.
function makeTank(M) {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.6, 3.6), M.olive);
  hull.position.y = 1.5;
  hull.castShadow = true; hull.receiveShadow = true;
  group.add(hull);
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 3.6), M.oliveDk);
  glacis.position.set(3.4, 1.4, 0);
  glacis.rotation.z = 0.6;
  group.add(glacis);
  for (const tz of [-1.9, 1.9]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.1, 1.1), M.track);
    track.position.set(0, 0.55, tz);
    track.castShadow = true;
    group.add(track);
    for (let i = -3; i <= 3; i++) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.0, 10), M.steelDk);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(i * 1.05, 0.55, tz);
      group.add(wheel);
    }
  }
  const turretPivot = new THREE.Group();
  turretPivot.position.set(-0.4, 2.3, 0);
  group.add(turretPivot);
  const turret = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.3, 2.8), M.olive);
  turret.castShadow = true;
  turretPivot.add(turret);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 5, 8), M.steelDk);
  gun.rotation.z = Math.PI / 2;
  gun.position.set(3.2, 0.1, 0);
  gun.castShadow = true;
  turretPivot.add(gun);
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.6, 10), M.oliveDk);
  cupola.position.set(-1.0, 0.9, 0.6);
  turretPivot.add(cupola);
  // Muzzle flash at the gun's mouth (pulsed on fire). The tank's forward is +X,
  // so the gun and its flash sit out along +X from the turret pivot.
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffe6a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), flashMat);
  flash.position.set(5.9, 0.1, 0);
  turretPivot.add(flash);

  destructible(group, { hp: 6, radius: 4.2, center: new THREE.Vector3(0, 2, 0) });
  return { group, turretPivot, flashMat };
}

// --- Level assembly ---------------------------------------------------------

// Place a structure sitting on the canyon floor at (x, centre+zOff).
function placeOnFloor(obj, x, zOff = 0, sink = 0.2) {
  const z = canyonCenterZ(x) + zOff;
  obj.position.set(x, terrainHeight(x, z) - sink, z);
  return obj;
}

export function buildAssault(root) {
  const M = mats();
  const beacons = [];
  const collision = new CollisionWorld(terrainHeight);

  // Friendly FOB at ALPHA + the objective field at BRAVO give the helicopter
  // its landing pads at each end of the run (the generic base builder).
  const endpoints = buildBases(root, [
    { name: 'FOB ALPHA', x: WORLD.baseAx, z: canyonCenterZ(WORLD.baseAx), rotationY: 0 },
    { name: 'OBJ BRAVO', x: WORLD.baseBx, z: canyonCenterZ(WORLD.baseBx), rotationY: Math.PI },
  ]);
  beacons.push(...endpoints.beacons);

  // Safe zones: a generous bubble around each helipad. While the helicopter is
  // inside one, no enemy fires at it — the bases and their approaches stay
  // calm so the player can stage, rearm mentally, and take off unharassed.
  const SAFE_RADIUS = 90;
  const safeZones = [
    { x: WORLD.baseAx, z: canyonCenterZ(WORLD.baseAx), r: SAFE_RADIUS },
    { x: WORLD.baseBx, z: canyonCenterZ(WORLD.baseBx), r: SAFE_RADIUS },
  ];
  function playerInSafeZone(pos) {
    for (const s of safeZones) {
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      if (dx * dx + dz * dz <= s.r * s.r) return true;
    }
    return false;
  }

  // Live rounds-per-minute budget per enemy type (driven by the Combat sliders
  // through setFireRate). Salvo spacing is derived from these each time a shooter
  // schedules its next salvo, so a slider change takes effect within one cycle.
  const rates = { ...DEFAULT_RPM };
  function setFireRate(type, rpm) {
    if (type in rates && Number.isFinite(rpm)) rates[type] = Math.max(0, rpm);
  }

  // Live tracer speed (m/s) per type, driven by the Combat projectile-speed
  // sliders. Clamped to a sane floor so the lead-time maths never blows up.
  const speeds = { ...DEFAULT_SPEED };
  function setProjectileSpeed(type, v) {
    if (type in speeds && Number.isFinite(v)) speeds[type] = Math.max(30, v);
  }

  const installations = new THREE.Group();
  installations.name = 'AssaultInstallations';
  root.add(installations);

  const turrets = [];
  const tanks = [];
  // Fixed emplacements that fire from a static muzzle (watchtowers, bunker).
  const gunners = [];

  // Convenience: drop a turret on the floor + register a (short) collider.
  function addTurret(x, zOff) {
    const tur = makeTurret(M);
    placeOnFloor(tur.group, x, zOff);
    installations.add(tur.group);
    const wp = tur.group.position;
    collision.addCylinder(wp.x, wp.z, 3.2, -1e6, wp.y + 4.0);
    turrets.push({ ...tur, dead: false, fire: makeFireState() });
    return tur;
  }
  function addStructureCollider(group, radius, height) {
    const wp = group.position;
    collision.addCylinder(wp.x, wp.z, radius, -1e6, wp.y + height);
  }

  // Watchtowers guarding the approaches — each cabin mounts a machine gun.
  for (const [x, zOff] of [[-150, -20], [40, 22], [200, -22]]) {
    const tw = makeWatchtower(M);
    placeOnFloor(tw.group, x, zOff);
    installations.add(tw.group);
    addStructureCollider(tw.group, 4.5, 18);
    gunners.push({
      group: tw.group, pattern: FIRE.tower, fire: makeFireState(),
      localMuzzle: new THREE.Vector3(1.6, 15, 2.6),
    });
  }

  // Anti-air turret line down the corridor.
  addTurret(-200, 16);
  addTurret(-90, -16);
  addTurret(10, 18);
  addTurret(150, -18);
  addTurret(225, 16);

  // Bunker — an autocannon fires from the firing slit.
  {
    const bk = makeBunker(M);
    placeOnFloor(bk.group, -30, -14);
    bk.group.rotation.y = -0.4; // face the firing slit up-canyon
    installations.add(bk.group);
    addStructureCollider(bk.group, 6.5, 6);
    gunners.push({
      group: bk.group, pattern: FIRE.bunker, fire: makeFireState(),
      localMuzzle: new THREE.Vector3(0, 2.8, 4.4),
    });
  }

  // Captured airfield: hangar + parked strike jets on the apron.
  {
    const hangar = makeHangar(M);
    placeOnFloor(hangar.group, 110, -20);
    hangar.group.rotation.y = Math.PI; // open end faces the corridor (+canyon)
    installations.add(hangar.group);
    addStructureCollider(hangar.group, 12, 11);
    installations.add(makeLabel('AIRFIELD', 16).translateX(110).translateZ(canyonCenterZ(110) - 20));

    // Three parked jets — the same plane the sea scene spots on its carrier.
    const jetSpots = [[92, -10, 0.5], [104, -6, 0.2], [120, -8, -0.3]];
    for (const [jx, jzOff, jr] of jetSpots) {
      const folded = Math.random() > 0.5;
      const jet = makeStrikeJet({ folded });
      placeOnFloor(jet, jx, jzOff, 0);
      jet.rotation.y = jr;
      destructible(jet, { hp: 5, radius: folded ? 5.2 : 6.2, center: new THREE.Vector3(0.5, 1.25, 0) });
      installations.add(jet);
      const wp = jet.position;
      collision.addCylinder(wp.x, wp.z, 2.4, -1e6, wp.y + 3.0);
    }
  }

  // Enemy command base near the far end.
  {
    const base = makeCommandBase(M);
    placeOnFloor(base.group, 250, 4);
    base.group.rotation.y = Math.PI;
    installations.add(base.group);
    addStructureCollider(base.group, 9.5, 13);
    beacons.push(...base.beacons);
    installations.add(makeLabel('ENEMY HQ', 19).translateX(250).translateZ(canyonCenterZ(250) + 4));
    // Keep a handle so the updater can spin the radar dish.
    turrets._radar = base.radarPivot;
  }

  // Advancing tank column: starts up-canyon, rolls toward the player's FOB.
  const tankStart = [255, 240, 222, 268];
  for (let i = 0; i < tankStart.length; i++) {
    const x = tankStart[i];
    const zOff = (i % 2 ? 1 : -1) * (6 + (i % 3) * 4);
    const tk = makeTank(M);
    placeOnFloor(tk.group, x, zOff, 0);
    installations.add(tk.group);
    const z = canyonCenterZ(x) + zOff;
    const unit = collision.addUnit({
      pos: new THREE.Vector3(x, terrainHeight(x, z), z),
      radius: 3.2,
      dead: false,
    });
    tanks.push({ ...tk, unit, dead: false, speed: 5.5 + Math.random() * 2, yaw: Math.PI, fire: makeFireState() });
  }

  // --- Enemy fire (tracers) ---------------------------------------------------
  // A tracer is a dumb straight-line round fired toward a fixed world point that
  // the shooter computed as its best guess of where the helicopter will be. It
  // never re-aims, so the pilot can fly out of its path. Each round carries the
  // damage it deals if its travel segment passes through the player hit sphere.
  const fxGroup = new THREE.Group();
  fxGroup.name = 'AssaultFx';
  root.add(fxGroup);
  const tracerGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 6);
  tracerGeo.rotateX(Math.PI / 2); // lie along +Z
  // One additive material per tracer colour (so each enemy type reads distinct).
  const tracerMats = new Map();
  function tracerMat(color) {
    let m = tracerMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      tracerMats.set(color, m);
    }
    return m;
  }
  const tracers = [];
  const _muzzle = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _aim = new THREE.Vector3();
  const _rand = new THREE.Vector3();
  const _prev = new THREE.Vector3();
  const _seg = new THREE.Vector3();
  const _toC = new THREE.Vector3();
  const _hit = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 0, 1);

  // Pick the world point a shooter aims at: lead the target by its velocity over
  // the round's flight time, then scatter it inside a range-dependent cone.
  function computeAimPoint(muzzle, targetPos, targetVel, p, out) {
    out.copy(targetPos);
    if (targetVel) {
      const lead = muzzle.distanceTo(targetPos) / (speeds[p.type] ?? p.speed);
      out.addScaledVector(targetVel, lead * p.lead);
    }
    const scatter = p.spread + muzzle.distanceTo(out) * p.cone;
    _rand.set(Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.7, Math.random() * 2 - 1);
    out.addScaledVector(_rand, scatter);
    return out;
  }

  function spawnTracer(fromWorld, toWorld, p) {
    if (tracers.length > 90) return;
    const speed = speeds[p.type] ?? p.speed;
    const mesh = new THREE.Mesh(tracerGeo, tracerMat(p.color));
    mesh.position.copy(fromWorld);
    _dir.copy(toWorld).sub(fromWorld);
    const dist = _dir.length() || 1;
    _dir.divideScalar(dist);
    mesh.quaternion.setFromUnitVectors(_up, _dir);
    const rscale = (p.radius ?? 0.12) / 0.12;
    mesh.scale.set(rscale, rscale, p.size ?? 3);
    fxGroup.add(mesh);
    // Let it overshoot the aim point a touch so a target that flew INTO the
    // predicted spot still gets caught; cap it so misses die off in the distance.
    const travel = Math.min(dist + 70, p.range + 90);
    tracers.push({
      mesh, vel: _dir.clone().multiplyScalar(speed), damage: p.damage,
      life: clamp(travel / speed, 0.2, 1.6), age: 0,
    });
  }

  // Seconds until a shooter's next salvo, derived from its live rounds-per-minute
  // budget so that burst*salvosPerMinute == rpm. A little ±25% jitter desyncs
  // emplacements. rpm 0 = held fire: re-poll periodically (cheap) so turning the
  // slider back up resumes firing without a rebuild.
  function nextSalvoTimer(p) {
    const rpm = rates[p.type] ?? 0;
    if (rpm <= 0) return 0.5;
    const avg = (60 * p.burst) / rpm; // seconds between salvos
    return Math.max(0.1, avg * (0.75 + Math.random() * 0.5));
  }

  // Run one shooter's fire control for the frame. When the salvo timer expires
  // and the target is in range it opens a burst (firing the first round at once),
  // then spaces the rest by burstGap. Returns true on any frame a round leaves
  // the muzzle, so callers can pulse a flash.
  function tickFire(state, p, dt, muzzle, targetPos, targetVel, inRange) {
    let fired = false;
    if (state.burstLeft > 0) {
      state.burstTimer -= dt;
      while (state.burstLeft > 0 && state.burstTimer <= 0) {
        spawnTracer(muzzle, computeAimPoint(muzzle, targetPos, targetVel, p, _aim), p);
        fired = true;
        state.burstLeft -= 1;
        state.burstTimer += p.burstGap;
      }
    } else {
      state.fireTimer -= dt;
      if (state.fireTimer <= 0) {
        if (inRange && (rates[p.type] ?? 0) > 0) {
          spawnTracer(muzzle, computeAimPoint(muzzle, targetPos, targetVel, p, _aim), p);
          fired = true;
          state.burstLeft = p.burst - 1;
          state.burstTimer = p.burstGap;
        }
        state.fireTimer = nextSalvoTimer(p);
      }
    }
    return fired;
  }

  // --- Per-frame level update -------------------------------------------------
  // `player` (optional) carries the helicopter hit sphere + a damage callback:
  //   { pos: Vector3, vel: Vector3, radius: number, alive: bool, damage(n, at) }
  const _world = new THREE.Vector3();

  function update(dt, t, playerPos, player) {
    const targetVel = player?.vel ?? null;
    // While the helicopter sits in a helipad safe zone, every enemy holds fire.
    const playerSafe = playerInSafeZone(playerPos);

    // Spin the HQ radar.
    if (turrets._radar) turrets._radar.rotation.y += dt * 0.8;

    // Turrets: detect destruction, track the player, fire snappy AA bursts.
    for (const tur of turrets) {
      if (!tur || !tur.group) continue;
      if (!tur.dead && tur.group.userData.destructiblePlane?.destroyed) {
        tur.dead = true;
        tur.barrelPivot.rotation.x = 0.5; // barrels droop when knocked out
        tur.flashMat.opacity = 0;
      }
      if (tur.dead) continue;

      tur.group.getWorldPosition(_world);
      const dx = playerPos.x - _world.x;
      const dz = playerPos.z - _world.z;
      const dy = playerPos.y - (_world.y + 1.7);
      const horiz = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      tur.headPivot.rotation.y += angDelta(tur.headPivot.rotation.y, yaw) * Math.min(1, dt * 2.5);
      const pitch = -clamp(Math.atan2(dy, horiz), -0.2, 1.0);
      tur.barrelPivot.rotation.x += (pitch - tur.barrelPivot.rotation.x) * Math.min(1, dt * 2.5);

      // Fade the muzzle flash.
      if (tur.flashMat.opacity > 0) tur.flashMat.opacity = Math.max(0, tur.flashMat.opacity - dt * 6);

      tur.barrelPivot.getWorldPosition(_muzzle);
      _muzzle.y += 0.6;
      const aimed = Math.abs(angDelta(tur.headPivot.rotation.y, yaw)) < 0.25;
      const inRange = !playerSafe && horiz < FIRE.turret.range && aimed;
      if (tickFire(tur.fire, FIRE.turret, dt, _muzzle, playerPos, targetVel, inRange)) {
        tur.flashMat.opacity = 1;
      }
    }

    // Fixed gun emplacements (watchtowers, bunker): fire from a static muzzle
    // whenever the player is inside their (type-specific) reach.
    for (const g of gunners) {
      if (g.group.userData.destructiblePlane?.destroyed) continue;
      g.group.updateWorldMatrix(true, false);
      g.group.localToWorld(_muzzle.copy(g.localMuzzle));
      const inRange = !playerSafe && _muzzle.distanceTo(playerPos) < g.pattern.range;
      tickFire(g.fire, g.pattern, dt, _muzzle, playerPos, targetVel, inRange);
    }

    // Tank column advances down-canyon, staying on the floor + clear of things.
    for (const tk of tanks) {
      if (!tk.dead && tk.group.userData.destructiblePlane?.destroyed) tk.dead = true;
      const u = tk.unit;
      if (tk.dead) { u.dead = true; continue; }

      // Drive toward -X, steering back to the canyon centreline.
      const goalZ = canyonCenterZ(u.pos.x);
      const desiredVx = -tk.speed;
      const desiredVz = clamp(goalZ - u.pos.z, -tk.speed, tk.speed) * 0.6;
      u.pos.x += desiredVx * dt;
      u.pos.z += desiredVz * dt;

      // Stay inside the floor; bounce gently off the walls.
      const hw = canyonHalfWidth(u.pos.x) - 4;
      const off = u.pos.z - canyonCenterZ(u.pos.x);
      if (off > hw) u.pos.z = canyonCenterZ(u.pos.x) + hw;
      if (off < -hw) u.pos.z = canyonCenterZ(u.pos.x) - hw;

      // Loop the column back to the top once it reaches the FOB end.
      if (u.pos.x < WORLD.baseAx + 40) u.pos.x = WORLD.baseBx - 40;

      collision.resolveStatics(u.pos, u.radius);
      // The hull's forward axis is +X (glacis + gun), so steer that axis onto the
      // travel direction — atan2(-vz, vx) for a +X-forward model. (The old
      // atan2(vx, vz) was the +Z-forward convention, which drove the tank
      // sideways, crabbing down the canyon with its flank leading.)
      tk.yaw = Math.atan2(-desiredVz, desiredVx);
    }
    collision.separateUnits();

    // Commit unit positions to the tank groups (sit on the terrain, face travel),
    // aim the turret, and fire slow heavy shells.
    for (const tk of tanks) {
      if (tk.flashMat.opacity > 0) tk.flashMat.opacity = Math.max(0, tk.flashMat.opacity - dt * 6);
      if (tk.dead) continue;
      const u = tk.unit;
      tk.group.position.set(u.pos.x, terrainHeight(u.pos.x, u.pos.z), u.pos.z);
      tk.group.rotation.y = tk.yaw;

      // Turret tracks the player. Both hull and turret are +X-forward, so the
      // world heading to the player is atan2(-dz, dx); the turret's LOCAL yaw is
      // that minus the hull yaw it is parented under.
      tk.group.getWorldPosition(_world);
      const ax = playerPos.x - _world.x;
      const az = playerPos.z - _world.z;
      const worldAim = Math.atan2(-az, ax);
      const localAim = worldAim - tk.yaw;
      tk.turretPivot.rotation.y += angDelta(tk.turretPivot.rotation.y, localAim) * Math.min(1, dt * 2);

      // Fire from the gun mouth when laid on and the player is in range. Refresh
      // the turret's world matrix first so the muzzle reflects this frame's pose.
      tk.turretPivot.updateWorldMatrix(true, false);
      tk.turretPivot.localToWorld(_muzzle.set(5.9, 0.1, 0));
      const turretWorldYaw = tk.yaw + tk.turretPivot.rotation.y;
      const aimed = Math.abs(angDelta(turretWorldYaw, worldAim)) < 0.12;
      const inRange = !playerSafe && Math.hypot(ax, az) < FIRE.tank.range && aimed;
      if (tickFire(tk.fire, FIRE.tank, dt, _muzzle, playerPos, targetVel, inRange)) {
        tk.flashMat.opacity = 1;
      }
    }

    // Advance tracers, test each against the player hit sphere, and retire them.
    const pr = player?.radius ?? 0;
    const canHit = player && player.alive !== false && pr > 0;
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      tr.age += dt;
      _prev.copy(tr.mesh.position);
      tr.mesh.position.addScaledVector(tr.vel, dt);

      if (canHit) {
        _seg.copy(tr.mesh.position).sub(_prev);
        const lenSq = _seg.lengthSq() || 1e-6;
        _toC.copy(playerPos).sub(_prev);
        const s = clamp(_toC.dot(_seg) / lenSq, 0, 1);
        _hit.copy(_prev).addScaledVector(_seg, s);
        if (_hit.distanceToSquared(playerPos) <= pr * pr) {
          player.damage(tr.damage, _hit);
          fxGroup.remove(tr.mesh);
          tracers.splice(i, 1);
          continue;
        }
      }

      if (tr.age >= tr.life) {
        fxGroup.remove(tr.mesh);
        tracers.splice(i, 1);
      }
    }
  }

  return { beacons, world: { collision, update, setFireRate, setProjectileSpeed, safeZones } };
}

// Re-export terrain builder so the scene definition can stay declarative.
export { buildCanyon };
