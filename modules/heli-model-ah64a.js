import * as THREE from 'three';

// ---------------------------------------------------------------------------
// AH-64A Apache — a SECOND airframe model, traced off the three-view general
// arrangement drawing (top / front / side). It sits alongside the original
// `buildApache()` in helicopter.js; neither replaces the other, and the model
// registry there decides which one an aircraft is built with.
//
// Model convention is shared with the original builder so every consumer of the
// airframe (cameras, cockpit eye, gun muzzle, pad rest height, collision radius)
// keeps working unchanged:
//   nose -> +Z, up -> +Y, tail boom -> -Z, 1 unit ~= 1 metre.
//   +X is the PILOT'S LEFT (port): with nose +Z and up +Y in a right-handed
//   space, right = forward x up = -X. The tail rotor therefore sits at +X, which
//   is where the real aircraft carries it.
//
// Where this differs from the original model, by construction:
//   * The fuselage, canopy, engine nacelles and avionics bays are LOFTED hulls —
//     a stack of superellipse cross-sections skinned together — instead of
//     boxes, so the side/top silhouettes come straight off the drawing.
//   * Wings, fin, stabilator and rotor blades are extruded planforms, so they
//     taper and sweep instead of being constant-section slabs.
//   * The tail rotor is the real thing: two teetering two-blade pairs on one
//     shaft, set 55 degrees apart rather than an even four-blade cross.
//   * No mast-mounted Longbow radome. The drawing is an AH-64A, which carries a
//     bare rotor head and a mast-top anticollision light. (The original model is
//     the Longbow-equipped one; that's the visible difference between them.)
// ---------------------------------------------------------------------------

// Forward tilt of the main rotor shaft, same convention as the original model:
// the whole mast assembly leans by this, pivoting about the shaft base, and the
// flight model's parked nose-up settle is matched to it so the disc reads level
// on the ground.
export const AH64A_ROTOR_TILT = 0.052; // rad (~3deg)

const MAST_BASE_Y = 1.20; // shaft-base pivot height in model space
const MAST_BASE_Z = -0.55;

// Helo drab: a shade darker and greyer than the original model's olive, which is
// what the real airframe wears, while staying light enough to read at cold dawn.
const DRAB = 0x6a7360;
const DRAB_DARK = 0x525a49;
const METAL = 0x4f544e;
const BLACK = 0x2c2f31;
const TIP_YELLOW = 0xd8c23a;

// ------------------------------------------------------------ primitives -----

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.74,
    metalness: opts.metalness ?? 0.16,
    ...opts,
  });
}

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function cyl(rt, rb, h, seg, material, x = 0, y = 0, z = 0) {
  const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  return m;
}

// A cylinder stretched between two points — used for gear legs, pitch links,
// pylon struts and antennas, where an axis-aligned box would read wrong.
function strut(material, a, b, r = 0.06, seg = 8) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(to, from);
  const len = d.length();
  const m = mesh(new THREE.CylinderGeometry(r, r, len, seg), material);
  m.position.copy(from).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

// One cross-section of a lofted hull: a superellipse of half-width `w` spanning
// `bot`..`top` in Y, at station `z`. The exponent `n` sets how boxy the section
// is — 2 is a plain ellipse, 3+ gives the slab sides and rounded corners the
// Apache's fuselage actually has. `nBot` lets the belly be flatter than the deck.
function contour(s, seg) {
  const cy = (s.top + s.bot) / 2;
  const hy = (s.top - s.bot) / 2;
  const nTop = s.n ?? 2.6;
  const nBot = s.nBot ?? nTop;
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a);
    const si = Math.sin(a);
    const n = si >= 0 ? nTop : nBot;
    const x = s.w * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = cy + hy * Math.sign(si) * Math.abs(si) ** (2 / n);
    pts.push(new THREE.Vector3(x, y, s.z));
  }
  return pts;
}

// Skin a stack of cross-sections into a closed hull. Stations run nose-first
// (descending Z); with the contours wound counter-clockwise in XY that ordering
// makes the quad winding below face outward.
function loft(stations, material, opts = {}) {
  const seg = opts.seg ?? 20;
  const rings = stations.map((s) => contour(s, seg));
  const pos = [];
  const idx = [];
  for (const ring of rings) for (const p of ring) pos.push(p.x, p.y, p.z);

  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const a = r * seg + i;
      const b = r * seg + j;
      const c = (r + 1) * seg + i;
      const d = (r + 1) * seg + j;
      idx.push(a, c, b, b, c, d);
    }
  }

  const first = stations[0];
  const last = stations[stations.length - 1];
  // Nose cap: a fan to a tip vertex ahead of the first ring.
  const noseTip = pos.length / 3;
  pos.push(0, (first.top + first.bot) / 2, first.z + (opts.noseTip ?? 0.16));
  for (let i = 0; i < seg; i++) idx.push(noseTip, i, (i + 1) % seg);
  // Tail cap: same fan behind the last ring, wound the other way.
  const tailTip = pos.length / 3;
  const base = (rings.length - 1) * seg;
  pos.push(0, (last.top + last.bot) / 2, last.z - (opts.tailTip ?? 0.16));
  for (let i = 0; i < seg; i++) idx.push(tailTip, base + ((i + 1) % seg), base + i);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return mesh(g, material);
}

// Extrude a flat planform from [u, v] pairs.
//
// Orientation is baked into the GEOMETRY, not stacked on the mesh's Euler.
// Three.js applies an 'XYZ' Euler as RX*RY*RZ — the Z turn happens FIRST — so
// setting rotation.x here and rotation.z at the call site does not compose the
// way it reads, and lands the part on a permuted axis. BufferGeometry.rotateX /
// rotateZ apply in call order, which is unambiguous.
//
//   default (upright omitted): u -> X, v -> Z, thickness centred on Y
//                              -> wings, stabilator, rotor blades
//   upright: true            : u -> Y, v -> Z, thickness centred on X
//                              -> the vertical fin (u = height, v = chord)
function extrudePanel(pts, thickness, material, opts = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: Math.min(0.02, thickness * 0.2),
    bevelSize: Math.min(0.02, thickness * 0.2),
    bevelSegments: 1,
  });
  g.translate(0, 0, -thickness / 2);
  g.rotateX(Math.PI / 2);
  if (opts.upright) g.rotateZ(Math.PI / 2);
  return mesh(g, material);
}

// A closed tube threaded through a contour — canopy frame bows and rails.
function frameRing(points, r, material) {
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  return mesh(new THREE.TubeGeometry(curve, points.length * 2, r, 4, true), material);
}

function frameRail(points, r, material) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return mesh(new THREE.TubeGeometry(curve, points.length * 3, r, 4, false), material);
}

// -------------------------------------------------------------- sections -----

// Fuselage + tail boom as one continuous loft, so the boom root blends into the
// aft deck the way the drawing's side view shows it rather than butting on as a
// separate tube. Stations are read off the side view (top/bot) and the top view
// (half-width).
const FUSELAGE = [
  { z: 4.34, w: 0.08, top: -0.10, bot: -0.38, n: 2.2 },
  { z: 4.10, w: 0.20, top: 0.06, bot: -0.54, n: 2.3 },
  { z: 3.72, w: 0.34, top: 0.24, bot: -0.72, n: 2.5 },
  { z: 3.24, w: 0.48, top: 0.38, bot: -0.84, n: 2.7, nBot: 3.0 },
  { z: 2.70, w: 0.54, top: 0.42, bot: -0.94, n: 2.9, nBot: 3.2 },
  { z: 2.05, w: 0.57, top: 0.42, bot: -1.00, n: 3.0, nBot: 3.4 },
  { z: 1.32, w: 0.60, top: 0.44, bot: -1.02, n: 3.0, nBot: 3.4 },
  { z: 0.55, w: 0.66, top: 0.60, bot: -1.02, n: 3.1, nBot: 3.4 },
  { z: -0.22, w: 0.70, top: 0.94, bot: -0.98, n: 3.1, nBot: 3.2 },
  { z: -0.95, w: 0.70, top: 1.14, bot: -0.88, n: 3.0, nBot: 3.0 },
  { z: -1.80, w: 0.64, top: 1.08, bot: -0.72, n: 2.9 },
  { z: -2.60, w: 0.54, top: 0.94, bot: -0.52, n: 2.8 },
  { z: -3.05, w: 0.49, top: 0.90, bot: -0.42, n: 2.8 },
  { z: -3.40, w: 0.42, top: 0.83, bot: -0.26, n: 2.6 },
  { z: -3.80, w: 0.36, top: 0.79, bot: -0.12, n: 2.4 },
  { z: -4.40, w: 0.32, top: 0.76, bot: 0.00, n: 2.3 },
  { z: -5.50, w: 0.28, top: 0.73, bot: 0.15, n: 2.15 },
  { z: -6.70, w: 0.24, top: 0.71, bot: 0.23, n: 2.05 },
  { z: -7.90, w: 0.23, top: 0.69, bot: 0.28, n: 2.0 },
  { z: -8.90, w: 0.20, top: 0.67, bot: 0.32, n: 2.0 },
  { z: -9.70, w: 0.16, top: 0.64, bot: 0.36, n: 2.0 },
];

// Tandem stepped canopy. The near-zero gap between the z=1.74 and z=1.70
// stations is deliberate: it makes the loft throw a vertical face there, which
// is the step up from the gunner's greenhouse to the pilot's.
const CANOPY = [
  { z: 3.26, w: 0.30, top: 0.50, bot: 0.36, n: 3.4 },
  { z: 2.98, w: 0.44, top: 0.80, bot: 0.38, n: 3.6 },
  { z: 2.52, w: 0.50, top: 1.00, bot: 0.40, n: 4.0 },
  { z: 1.92, w: 0.52, top: 1.04, bot: 0.40, n: 4.0 },
  { z: 1.74, w: 0.53, top: 1.06, bot: 0.42, n: 4.0 },
  { z: 1.70, w: 0.54, top: 1.32, bot: 0.42, n: 4.0 },
  { z: 1.12, w: 0.56, top: 1.40, bot: 0.44, n: 4.0 },
  { z: 0.52, w: 0.56, top: 1.36, bot: 0.48, n: 4.0 },
  { z: 0.16, w: 0.48, top: 1.18, bot: 0.56, n: 3.6 },
];

// Extended Forward Avionics Bay: the cheek blisters that give the front view its
// wide lower shoulders. Contours are centred on the origin and the mesh is
// pushed out to the side, so one table serves both bays.
const EFAB = [
  { z: 2.40, w: 0.05, top: 0.20, bot: -0.20, n: 2.4 },
  { z: 1.85, w: 0.15, top: 0.42, bot: -0.42, n: 2.6 },
  { z: 1.10, w: 0.21, top: 0.54, bot: -0.54, n: 2.8 },
  { z: 0.35, w: 0.21, top: 0.58, bot: -0.58, n: 2.8 },
  { z: -0.35, w: 0.15, top: 0.50, bot: -0.50, n: 2.6 },
  { z: -0.90, w: 0.05, top: 0.24, bot: -0.24, n: 2.4 },
];

// T700 nacelle, likewise centred and then placed.
const NACELLE = [
  { z: 0.80, w: 0.24, top: 0.22, bot: -0.22, n: 2.2 },
  { z: 0.35, w: 0.38, top: 0.38, bot: -0.36, n: 2.4 },
  { z: -0.40, w: 0.41, top: 0.42, bot: -0.42, n: 2.5 },
  { z: -1.40, w: 0.42, top: 0.42, bot: -0.42, n: 2.5 },
  { z: -2.10, w: 0.38, top: 0.38, bot: -0.40, n: 2.4 },
  { z: -2.55, w: 0.34, top: 0.32, bot: -0.34, n: 2.2 },
];

// ------------------------------------------------------------- the model -----

export function buildAh64a() {
  const group = new THREE.Group();

  const bodyMat = mat(DRAB, { roughness: 0.8 });
  const bodyDarkMat = mat(DRAB_DARK, { roughness: 0.82 });
  const metalMat = mat(METAL, { roughness: 0.55, metalness: 0.42 });
  const blackMat = mat(BLACK, { roughness: 0.86, metalness: 0.1 });
  const frameMat = mat(DRAB_DARK, { roughness: 0.58, metalness: 0.28 });
  const tipMat = mat(TIP_YELLOW, { roughness: 0.5 });
  // Canopy "glass": opaque dark grey with a low-roughness sheen, so the sun
  // glints off the flat panes the way the real canopy does. No transparency —
  // the airframe has to hide itself in cockpit view by killing depth writes.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x3d444d, roughness: 0.14, metalness: 0.38 });
  const voidMat = mat(0x14161a, { roughness: 0.95, metalness: 0.05 });

  // --- Fuselage + boom ---
  group.add(loft(FUSELAGE, bodyMat, { seg: 24, noseTip: 0.18, tailTip: 0.14 }));

  // Belly ammo magazine bulge under the gunner's station.
  const magazine = loft([
    { z: 2.30, w: 0.10, top: 0.10, bot: -0.10, n: 2.4 },
    { z: 1.60, w: 0.38, top: 0.10, bot: -0.20, n: 3.0 },
    { z: 0.60, w: 0.42, top: 0.10, bot: -0.24, n: 3.0 },
    { z: -0.30, w: 0.36, top: 0.10, bot: -0.19, n: 2.8 },
    { z: -0.90, w: 0.12, top: 0.08, bot: -0.10, n: 2.4 },
  ], bodyDarkMat, { seg: 16, noseTip: 0.1, tailTip: 0.1 });
  magazine.position.y = -0.98;
  group.add(magazine);

  // --- Forward avionics bays (both cheeks) ---
  for (const side of [-1, 1]) {
    const efab = loft(EFAB, bodyDarkMat, { seg: 16, noseTip: 0.12, tailTip: 0.12 });
    efab.position.set(side * 0.58, -0.28, 0);
    group.add(efab);
  }

  // --- Canopy ---
  const canopy = loft(CANOPY, glassMat, { seg: 16, noseTip: 0.1, tailTip: 0.08 });
  group.add(canopy);

  // Frame bows around selected stations, plus the four corner rails running the
  // length of the greenhouse — this is what makes it read as flat panes in a
  // frame rather than a smooth bubble.
  for (const si of [0, 1, 2, 3, 5, 6, 7]) {
    const s = CANOPY[si];
    const cy = (s.top + s.bot) / 2;
    const ring = contour(s, 16).map((p) => new THREE.Vector3(p.x * 1.05, cy + (p.y - cy) * 1.05, p.z));
    group.add(frameRing(ring, 0.028, frameMat));
  }
  for (const ci of [2, 6, 10, 14]) {
    const chain = CANOPY.map((s) => contour(s, 16)[ci]);
    group.add(frameRail(chain, 0.03, frameMat));
  }
  // Windscreen centre post, from the nose deck up to the gunner's roof.
  group.add(strut(frameMat, [0, 0.40, 3.34], [0, 0.86, 2.96], 0.032));
  // Roll-over arch at the step between the two stations.
  group.add(box(1.16, 0.11, 0.16, frameMat, 0, 1.30, 1.72));

  // --- Nose sensors ---
  // TADS: the two-window sighting turret slung under the nose tip.
  const tadsYoke = cyl(0.25, 0.29, 0.42, 14, metalMat, 0, -0.30, 4.06);
  tadsYoke.rotation.x = Math.PI / 2;
  group.add(tadsYoke);
  const tads = mesh(new THREE.SphereGeometry(0.28, 18, 14), metalMat);
  tads.position.set(0, -0.30, 4.32);
  tads.scale.set(1.0, 0.96, 1.18);
  group.add(tads);
  for (const side of [-1, 1]) {
    const window = cyl(0.095, 0.095, 0.06, 12, blackMat, side * 0.12, -0.26, 4.62);
    window.rotation.x = Math.PI / 2;
    group.add(window);
  }
  // PNVS: the smaller night-vision turret perched on the nose, kept low and far
  // enough forward that it stays clear of the cockpit eye point at z = 4.5.
  const pnvsBase = cyl(0.16, 0.18, 0.16, 12, metalMat, 0, 0.16, 4.02);
  group.add(pnvsBase);
  const pnvs = mesh(new THREE.SphereGeometry(0.21, 14, 12), metalMat);
  pnvs.position.set(0, 0.30, 4.03);
  pnvs.scale.set(1, 0.9, 1.08);
  group.add(pnvs);
  group.add(cyl(0.09, 0.09, 0.05, 10, blackMat, 0, 0.32, 4.22).rotateX(Math.PI / 2));

  // Pitot booms + air-data probe.
  for (const side of [-1, 1]) group.add(strut(metalMat, [side * 0.34, 0.02, 3.86], [side * 0.40, 0.02, 4.52], 0.022, 6));
  group.add(strut(metalMat, [0, 0.44, 3.60], [0, 0.86, 3.60], 0.022, 6));

  // --- M230 chin gun ---
  // Trunnion + receiver under the forward fuselage, barrel reaching the muzzle
  // point the weapon code fires from (0, -0.95, 4.65).
  group.add(box(0.62, 0.30, 0.66, metalMat, 0, -0.78, 3.02));
  const gunYoke = cyl(0.17, 0.17, 0.70, 12, metalMat, 0, -0.95, 3.02);
  gunYoke.rotation.z = Math.PI / 2;
  group.add(gunYoke);
  group.add(box(0.30, 0.30, 0.72, blackMat, 0, -0.95, 3.28));
  const barrel = cyl(0.062, 0.075, 1.30, 10, blackMat, 0, -0.95, 4.02);
  barrel.rotation.x = Math.PI / 2;
  group.add(barrel);
  const muzzle = cyl(0.085, 0.085, 0.18, 10, metalMat, 0, -0.95, 4.58);
  muzzle.rotation.x = Math.PI / 2;
  group.add(muzzle);

  // --- Stub wings ---
  // Built as two half-panels so each can carry a little anhedral, tapered and
  // slightly swept the way the top view shows.
  for (const side of [-1, 1]) {
    const wing = extrudePanel([
      [side * 0.30, 0.22],
      [side * 2.62, 0.06],
      [side * 2.62, -0.92],
      [side * 0.30, -1.08],
    ], 0.22, bodyMat);
    wing.position.y = 0.06;
    wing.rotation.z = -side * 0.05; // anhedral
    group.add(wing);

    // Wingtip fairing + navigation light (port red, starboard green).
    group.add(box(0.13, 0.16, 0.74, bodyDarkMat, side * 2.66, -0.04, -0.42));
    const navColor = side > 0 ? 0xd03028 : 0x28b050;
    const nav = mesh(new THREE.SphereGeometry(0.075, 10, 8),
      new THREE.MeshStandardMaterial({ color: navColor, emissive: navColor, emissiveIntensity: 1.5, roughness: 0.4 }));
    nav.position.set(side * 2.72, -0.02, -0.02);
    group.add(nav);

    // Inner station: M299 quad Hellfire launcher.
    group.add(box(0.26, 0.42, 0.86, bodyDarkMat, side * 1.32, -0.16, -0.44));
    group.add(box(0.28, 0.24, 1.45, bodyDarkMat, side * 1.32, -0.60, -0.44));
    for (let r = 0; r < 4; r++) {
      const mx = side * 1.32 + (r % 2 ? 0.19 : -0.19);
      const my = -0.60 + (r < 2 ? 0.19 : -0.19);
      const body = cyl(0.088, 0.088, 1.35, 8, blackMat, mx, my, -0.44);
      body.rotation.x = Math.PI / 2;
      group.add(body);
      const cone = cyl(0.012, 0.088, 0.26, 8, blackMat, mx, my, 0.36);
      cone.rotation.x = Math.PI / 2;
      group.add(cone);
      // Tail fins, so the racks don't read as plain rods from the chase camera.
      for (const f of [0, 1]) {
        const fin = box(f ? 0.02 : 0.24, f ? 0.24 : 0.02, 0.3, blackMat, mx, my, -1.02);
        group.add(fin);
      }
    }

    // Outer station: M261 nineteen-tube Hydra pod.
    group.add(box(0.26, 0.38, 0.78, bodyDarkMat, side * 2.24, -0.14, -0.42));
    const pod = cyl(0.40, 0.40, 1.86, 16, bodyDarkMat, side * 2.24, -0.54, -0.36);
    pod.rotation.x = Math.PI / 2;
    group.add(pod);
    const podNose = cyl(0.34, 0.40, 0.22, 16, bodyDarkMat, side * 2.24, -0.54, 0.68);
    podNose.rotation.x = Math.PI / 2;
    group.add(podNose);
    const podFace = cyl(0.35, 0.35, 0.04, 16, blackMat, side * 2.24, -0.54, 0.60);
    podFace.rotation.x = Math.PI / 2;
    group.add(podFace);
    // Seven visible tube mouths — enough to read the honeycomb at chase range.
    for (let t = 0; t < 7; t++) {
      const a = (t / 6) * Math.PI * 2;
      const rr = t === 6 ? 0 : 0.2;
      const tube = cyl(0.055, 0.055, 0.06, 8, voidMat,
        side * 2.24 + Math.cos(a) * rr, -0.54 + Math.sin(a) * rr, 0.615);
      tube.rotation.x = Math.PI / 2;
      group.add(tube);
    }
  }

  // --- Engine nacelles ---
  for (const side of [-1, 1]) {
    const nacelle = loft(NACELLE, bodyDarkMat, { seg: 18, noseTip: 0.16, tailTip: 0.14 });
    nacelle.position.set(side * 1.00, 0.86, 0);
    group.add(nacelle);
    // Particle-separator intake lip + dark intake face.
    const lip = cyl(0.28, 0.25, 0.22, 16, metalMat, side * 1.00, 0.86, 0.84);
    lip.rotation.x = Math.PI / 2;
    group.add(lip);
    const intake = cyl(0.22, 0.22, 0.04, 16, voidMat, side * 1.00, 0.86, 0.90);
    intake.rotation.x = Math.PI / 2;
    group.add(intake);
    // "Black Hole" exhaust suppressor: the duct cants gently up and outboard.
    const duct = cyl(0.28, 0.32, 0.80, 14, metalMat, side * 1.12, 0.94, -2.68);
    duct.rotation.set(Math.PI / 2 - 0.12, 0, side * -0.16);
    group.add(duct);
    const exhaustFace = cyl(0.25, 0.25, 0.05, 14, voidMat, side * 1.18, 1.01, -3.02);
    exhaustFace.rotation.set(Math.PI / 2 - 0.12, 0, side * -0.16);
    group.add(exhaustFace);
  }

  // AN/ALQ-144 infrared jammer on the aft deck — the little ribbed drum.
  group.add(cyl(0.15, 0.17, 0.34, 12, metalMat, 0, 1.30, -2.30));
  group.add(cyl(0.10, 0.14, 0.10, 12, mat(0x9b8f5a, { roughness: 0.4, metalness: 0.5 }), 0, 1.50, -2.30));

  // --- Vertical fin ---
  // A swept planform in the height/chord plane, stood upright so height runs up
  // +Y and the extrusion thickness runs across X.
  const fin = extrudePanel([
    [0.62, -7.20],
    [1.60, -8.30],
    [2.86, -9.20],
    [2.86, -9.96],
    [1.60, -10.10],
    [0.62, -9.90],
  ], 0.24, bodyMat, { upright: true });
  group.add(fin);

  // --- Stabilator ---
  const stab = extrudePanel([
    [-1.74, -9.00],
    [-0.32, -8.80],
    [0.32, -8.80],
    [1.74, -9.00],
    [1.74, -9.86],
    [0.32, -10.16],
    [-0.32, -10.16],
    [-1.74, -9.86],
  ], 0.14, bodyMat);
  stab.position.y = 0.36;
  group.add(stab);

  // Boom strakes + chaff dispenser.
  for (const side of [-1, 1]) group.add(box(0.06, 0.16, 2.4, bodyDarkMat, side * 0.24, 0.34, -6.2));
  group.add(box(0.36, 0.2, 0.5, bodyDarkMat, 0, 0.16, -4.9));

  // --- Main rotor + mast assembly ---
  // Everything on the shaft hangs off `mastAssembly`, which is seated at the
  // shaft base and leaned forward, so mast, swashplate, hub and blades tilt
  // together. Child Ys/Zs are measured from that pivot.
  const mastAssembly = new THREE.Group();
  const ly = (y) => y - MAST_BASE_Y;

  // Transmission cowling flaring out of the deck into the mast.
  mastAssembly.add(cyl(0.28, 0.46, 0.42, 16, bodyMat, 0, ly(1.28), 0));
  mastAssembly.add(cyl(0.155, 0.155, 0.62, 12, metalMat, 0, ly(1.72), 0));
  // Swashplate: a fixed lower plate and a rotating upper one.
  mastAssembly.add(cyl(0.33, 0.33, 0.055, 18, metalMat, 0, ly(1.90), 0));
  mastAssembly.add(cyl(0.31, 0.31, 0.055, 18, blackMat, 0, ly(1.99), 0));
  // Hub.
  mastAssembly.add(cyl(0.40, 0.40, 0.24, 14, metalMat, 0, ly(2.18), 0));
  mastAssembly.add(cyl(0.22, 0.22, 0.18, 12, metalMat, 0, ly(2.34), 0));

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, ly(2.18), 0);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x1d2022, roughness: 0.72, metalness: 0.1, transparent: true, opacity: 1,
  });
  const gripMat = mat(METAL, { roughness: 0.5, metalness: 0.45, transparent: true, opacity: 1 });

  for (let i = 0; i < 4; i++) {
    const bladeGroup = new THREE.Group();
    bladeGroup.rotation.y = (i / 4) * Math.PI * 2;

    // Blade grip + damper out to the root, then the blade itself: constant chord
    // to 6.45 m, then a swept tip — the AH-64's blades are not plain rectangles.
    bladeGroup.add(box(0.30, 0.20, 0.55, gripMat, 0, 0, 0.62));
    bladeGroup.add(strut(gripMat, [0.16, -0.02, 0.42], [0.05, -0.24, 0.16], 0.035, 6));

    const blade = extrudePanel([
      [-0.27, 0.86],
      [0.27, 0.86],
      [0.27, 6.45],
      [0.05, 7.22],
      [-0.49, 7.22],
      [-0.27, 6.45],
    ], 0.07, bladeMat);
    bladeGroup.add(blade);

    const tip = extrudePanel([
      [0.12, 6.96],
      [-0.42, 6.96],
      [-0.49, 7.22],
      [0.05, 7.22],
    ], 0.075, tipMat);
    bladeGroup.add(tip);
    mainRotor.add(bladeGroup);
  }
  mastAssembly.add(mainRotor);

  const mainBlur = new THREE.Mesh(
    new THREE.CircleGeometry(7.22, 44),
    new THREE.MeshBasicMaterial({ color: 0x9aa0a4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  mainBlur.rotation.x = -Math.PI / 2;
  mainBlur.position.set(0, ly(2.24), 0);
  mastAssembly.add(mainBlur);

  // Mast-top anticollision light. The A-model carries this where the D-model's
  // Longbow radome sits, and it is the quickest way to tell the two apart.
  const strobeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 1.2 });
  mastAssembly.add(cyl(0.09, 0.12, 0.16, 10, metalMat, 0, ly(2.48), 0));
  const mastLight = mesh(new THREE.SphereGeometry(0.1, 10, 8), strobeMat);
  mastLight.position.set(0, ly(2.60), 0);
  mastAssembly.add(mastLight);

  mastAssembly.position.set(0, MAST_BASE_Y, MAST_BASE_Z);
  mastAssembly.rotation.x = AH64A_ROTOR_TILT;
  group.add(mastAssembly);

  // --- Tail rotor ---
  // Two teetering two-blade pairs on one shaft, set 55 degrees apart instead of
  // an even cross — the AH-64's signature scissor arrangement. Mounted on the
  // PORT side of the fin (+X here), as on the real aircraft.
  const TR_X = 0.44;
  const TR_Y = 2.30;
  const TR_Z = -9.40;
  const gearbox = cyl(0.20, 0.24, 0.34, 12, bodyDarkMat, 0.24, TR_Y, TR_Z);
  gearbox.rotation.z = Math.PI / 2;
  group.add(gearbox);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(TR_X, TR_Y, TR_Z);
  const tailBladeMat = new THREE.MeshStandardMaterial({
    color: 0x1d2022, roughness: 0.72, transparent: true, opacity: 1,
  });
  const tailHubMat = mat(METAL, { roughness: 0.5, metalness: 0.45, transparent: true, opacity: 1 });
  const tailHub = cyl(0.13, 0.13, 0.22, 10, tailHubMat, 0, 0, 0);
  tailHub.rotation.z = Math.PI / 2;
  tailRotor.add(tailHub);
  // Pair offsets in X keep the two teetering assemblies on separate hinges.
  const pairs = [{ a: 0, x: -0.07 }, { a: 0.96, x: 0.07 }]; // 0.96 rad ~= 55deg
  for (const pair of pairs) {
    for (const s of [1, -1]) {
      const bg = new THREE.Group();
      bg.rotation.x = pair.a + (s < 0 ? Math.PI : 0);
      const blade = box(0.05, 1.28, 0.235, tailBladeMat, pair.x, 0.76, 0);
      bg.add(blade);
      const tipStripe = box(0.055, 0.18, 0.24, tipMat, pair.x, 1.31, 0);
      bg.add(tipStripe);
      bg.add(box(0.1, 0.26, 0.14, tailHubMat, pair.x, 0.2, 0));
      tailRotor.add(bg);
    }
  }
  group.add(tailRotor);

  const tailBlur = new THREE.Mesh(
    new THREE.CircleGeometry(1.42, 26),
    new THREE.MeshBasicMaterial({ color: 0x9aa0a4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  tailBlur.position.set(TR_X + 0.1, TR_Y, TR_Z);
  tailBlur.rotation.y = Math.PI / 2;
  group.add(tailBlur);

  // --- Landing gear ---
  // Trailing-link main units: an oleo raked down-aft from the fuselage side, and
  // a drag arm from a forward pivot back to the axle. Wheel radius and axle
  // height are chosen so that, with the parked nose-up settle, all three wheels
  // touch at the same height (see the tail-wheel note below).
  for (const side of [-1, 1]) {
    const axle = [side * 1.10, -1.48, 0.45];
    group.add(box(0.24, 0.34, 0.5, bodyDarkMat, side * 0.74, -0.72, 0.98));
    group.add(strut(metalMat, [side * 0.78, -0.62, 1.02], axle, 0.075));
    group.add(strut(metalMat, [side * 0.80, -0.90, 1.34], axle, 0.055));
    const wheel = cyl(0.34, 0.34, 0.26, 14, blackMat, ...axle);
    wheel.rotation.z = Math.PI / 2;
    group.add(wheel);
    const hubCap = cyl(0.14, 0.14, 0.28, 10, metalMat, ...axle);
    hubCap.rotation.z = Math.PI / 2;
    group.add(hubCap);
  }
  // Tail wheel. Centre y = -1.089 with r = 0.24 puts its contact point level
  // with the main wheels once the airframe sits at parkPitch (-3deg, nose up),
  // so the taildragger stance rests flat on the pad instead of on two points.
  group.add(strut(metalMat, [0, 0.26, -8.46], [0, -1.089, -8.98], 0.055));
  group.add(strut(metalMat, [0, 0.16, -9.34], [0, -1.089, -8.98], 0.04));
  const tailWheel = cyl(0.24, 0.24, 0.20, 12, blackMat, 0, -1.089, -8.98);
  tailWheel.rotation.z = Math.PI / 2;
  group.add(tailWheel);

  // --- Lights ---
  // Upper beacon on the fin, lower beacon on the belly; both share strobeMat so
  // the flight code's single strobe channel drives them together.
  const finBeacon = mesh(new THREE.SphereGeometry(0.095, 10, 8), strobeMat);
  finBeacon.position.set(0, 2.98, -9.60);
  group.add(finBeacon);
  const bellyBeacon = mesh(new THREE.SphereGeometry(0.09, 10, 8), strobeMat);
  bellyBeacon.position.set(0, -1.19, -0.20);
  group.add(bellyBeacon);
  // White tail position light at the very aft end.
  const tailLight = mesh(new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xf0efe6, emissive: 0xf0efe6, emissiveIntensity: 1.1, roughness: 0.4 }));
  tailLight.position.set(0, 0.52, -10.02);
  group.add(tailLight);

  return {
    group,
    mainRotor,
    tailRotor,
    mainBlur,
    tailBlur,
    bladeMat,
    tailBladeMat,
    strobeMat,
    rotorTilt: AH64A_ROTOR_TILT,
  };
}
