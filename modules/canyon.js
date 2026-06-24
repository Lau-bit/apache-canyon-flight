import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, ridged, makeRng } from './noise.js';

// ---- World extents (the playable canyon corridor runs along +X) ----
// `xMin..xMax` / `zMin..zMax` is the playable corridor: bases and prop scatter
// live here. The detailed ground mesh itself reaches much further out
// (`terrain*`) so the hand-off to the low-res back-country happens far away near
// the fog rather than at the visible canyon rim.
export const WORLD = {
  xMin: -340,
  xMax: 340,
  zMin: -180,
  zMax: 180,
  baseAx: -300,
  baseBx: 300,
  terrainXMin: -560,
  terrainXMax: 560,
  terrainZMin: -340,
  terrainZMax: 340,
};

// cacti + shrubs (the repeating greenery) are deliberately sparser than the
// rock scatter; boulder counts are left dense. New formation/ground-prop counts
// live alongside them.
const detailPresets = {
  high: { segX: 520, segZ: 320, boulders: 520, cacti: 227, shrubs: 307, spires: 26, buttes: 18, smallRocks: 420, deadBush: 240 },
  balanced: { segX: 400, segZ: 248, boulders: 360, cacti: 147, shrubs: 200, spires: 16, buttes: 11, smallRocks: 280, deadBush: 150 },
  performance: { segX: 288, segZ: 176, boulders: 200, cacti: 80, shrubs: 113, spires: 9, buttes: 6, smallRocks: 170, deadBush: 90 },
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function smootherstep(t) {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ---- Shared canyon geometry (used by terrain AND the flight path) ----

// Lateral meander of the canyon centerline as a function of X.
export function canyonCenterZ(x) {
  return (
    52 * Math.sin(x * 0.0091) +
    24 * Math.sin(x * 0.0246 + 1.1) -
    12 * Math.sin(x * 0.052 + 0.4)
  );
}

// Canyon floor elevation along the corridor (gentle, near 0).
export function canyonFloorY(x) {
  return 1.6 * Math.sin(x * 0.013 + 0.6) + 0.8 * Math.sin(x * 0.04);
}

// Half-width of the flat canyon floor at a given X.
export function canyonHalfWidth(x) {
  return 22 + 15 * fbm(x * 0.006 + 31, 4.2, 3);
}

// Full terrain height field. This is the single source of truth for the ground.
export function terrainHeight(x, z) {
  const cz = canyonCenterZ(x);
  const floor = canyonFloorY(x);
  const d = Math.abs(z - cz);
  const halfWidth = canyonHalfWidth(x);
  const wallRun = 50 + 26 * fbm(x * 0.004, 5.0, 2);
  const plateau = 52 + 34 * fbm(x * 0.0034 + 20, z * 0.0034, 4);

  if (d <= halfWidth) {
    // Canyon floor: a shallow dry wash down the middle + dune ripples.
    const wash = -2.6 * Math.exp(-(d * d) / 70);
    const dunes = (fbm(x * 0.05, z * 0.05, 3) - 0.5) * 2.4;
    return floor + wash + dunes;
  }

  // Climbing the canyon wall up to the plateau.
  const t = clamp((d - halfWidth) / wallRun, 0, 1);
  let climb = smootherstep(t);
  // Stair-stepped strata ledges for that layered sandstone read.
  climb += 0.05 * Math.sin(climb * Math.PI * 7) * (1 - climb);

  let h = floor + plateau * climb;
  // Ridged detail breaks the walls into buttes and fins.
  h += ridged(x * 0.011 + 50, z * 0.011, 4) * 16 * climb;
  // Extra broken terrain right at the rim / plateau top.
  const topMix = clamp((t - 0.8) / 0.2, 0, 1);
  h += (fbm(x * 0.02, z * 0.02, 4) - 0.5) * 18 * topMix;
  return h;
}

// ---- Vertex colouring: sandstone strata banding ----
const strata = [
  [0.80, 0.69, 0.50], // pale floor sand
  [0.78, 0.55, 0.36], // tan
  [0.71, 0.42, 0.28], // orange sandstone
  [0.60, 0.32, 0.25], // deep red band
  [0.74, 0.50, 0.40], // rose
  [0.82, 0.74, 0.62], // bleached rim
];

// Strata colour for an arbitrary world point — shared with the surrounding
// back-country so the far terrain bands match the playable canyon.
export function terrainColorAt(x, z, worldY, out) {
  const n = fbm(x * 0.08 + 7, z * 0.08 + 3, 2);
  strataColor(worldY, canyonFloorY(x), n, out);
  return out;
}

function strataColor(worldY, floor, n, out) {
  const rel = clamp((worldY - floor) / 78, 0, 1);
  const band = rel * (strata.length - 1);
  const i = Math.min(strata.length - 2, Math.floor(band));
  const f = band - i;
  const a = strata[i];
  const b = strata[i + 1];
  // Horizontal sediment striping driven by elevation + a little noise.
  const stripe = 0.86 + 0.14 * Math.sin(worldY * 0.55 + n * 5.0);
  const dust = 0.92 + 0.16 * n;
  out.r = lerp(a[0], b[0], f) * stripe * dust;
  out.g = lerp(a[1], b[1], f) * stripe * dust;
  out.b = lerp(a[2], b[2], f) * stripe * dust;
}

function buildTerrain(root, preset) {
  const spanX = WORLD.terrainXMax - WORLD.terrainXMin;
  const spanZ = WORLD.terrainZMax - WORLD.terrainZMin;
  const geometry = new THREE.PlaneGeometry(spanX, spanZ, preset.segX, preset.segZ);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    const n = fbm(x * 0.08 + 7, z * 0.08 + 3, 2);
    strataColor(h, canyonFloorY(x), n, tmp);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.0,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'CanyonTerrain';
  root.add(mesh);
  return mesh;
}

// ---- Scatter: boulders, saguaro cacti, scrub ----

function makeBoulderGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const jitter = 0.78 + fbm(x * 2 + 1, z * 2 + y, 2) * 0.5;
    pos.setXYZ(i, x * jitter, y * jitter * 0.82, z * jitter);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeCactusGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.5, 0.62, 5.0, 7);
  trunk.translate(0, 2.5, 0);
  parts.push(trunk);

  // Two upturned arms.
  const armDefs = [
    { side: 1, base: 2.4, len: 1.7, up: 1.5 },
    { side: -1, base: 3.1, len: 1.5, up: 1.3 },
  ];
  for (const a of armDefs) {
    const lower = new THREE.CylinderGeometry(0.34, 0.34, a.len, 6);
    lower.rotateZ(a.side * Math.PI * 0.5);
    lower.translate(a.side * (0.5 + a.len * 0.5), a.base, 0);
    const upper = new THREE.CylinderGeometry(0.32, 0.34, a.up, 6);
    upper.translate(a.side * (0.5 + a.len), a.base + a.up * 0.5, 0);
    const cap = new THREE.SphereGeometry(0.32, 6, 5);
    cap.translate(a.side * (0.5 + a.len), a.base + a.up, 0);
    parts.push(lower, upper, cap);
  }
  const top = new THREE.SphereGeometry(0.5, 7, 6);
  top.translate(0, 5.0, 0);
  parts.push(top);

  return mergeGeometries(parts, false);
}

// Natural rock formation, built the same way as the boulders: a high-poly
// icosphere displaced with fbm noise, then shaped vertically into the desired
// silhouette. `flatten` exponents remap latitude so the wide mid-band can be
// pushed toward the top/bottom — < 1 gives a flat mesa cap or a broad base,
// > 1 stretches it into a slender point.
function makeRockFormation({ detail, height, radius, taper, flattenTop, flattenBottom, strata, lump, seed }) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const f = y < 0 ? flattenBottom : flattenTop;
    const ys = Math.sign(y) * Math.pow(Math.abs(y), f);
    const t = (ys + 1) / 2; // 0 at the base, 1 at the top

    // Horizontal profile: taper up the form with thin sedimentary ledges...
    let prof = 1 - taper * t + strata * Math.sin(t * Math.PI * 6);
    // ...and the same organic fbm lumpiness as makeBoulderGeometry.
    prof *= 0.72 + fbm(x * lump + seed, z * lump + y * 1.6 + seed, 3) * 0.56;
    prof = Math.max(0.05, prof);

    pos.setXYZ(i, x * radius * prof, t * height, z * radius * prof);
  }
  geo.computeVertexNormals();
  return geo;
}

// A weathered rock spire / hoodoo — slender, pointed cap, broad foot.
function makeSpireGeometry() {
  return makeRockFormation({
    detail: 3, height: 9, radius: 1.6, taper: 0.68,
    flattenTop: 1.45, flattenBottom: 0.5, strata: 0.05, lump: 1.7, seed: 11,
  });
}

// A broad, flat-topped butte / mesa.
function makeButteGeometry() {
  return makeRockFormation({
    detail: 3, height: 6.2, radius: 4.3, taper: 0.2,
    flattenTop: 0.5, flattenBottom: 0.5, strata: 0.06, lump: 0.95, seed: 41,
  });
}

// A small rounded stone — the same icosphere-and-fbm technique as the boulders,
// just smaller and flattened.
function makeSmallRockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const jitter = 0.7 + fbm(x * 3 + 5, z * 3 + y, 2) * 0.6;
    pos.setXYZ(i, x * jitter, y * jitter * 0.66, z * jitter);
  }
  geo.computeVertexNormals();
  return geo;
}

// A dry desert bush — a low spray of bare twigs.
function makeDeadBushGeometry() {
  const parts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const branch = new THREE.CylinderGeometry(0.03, 0.07, 1.3, 4);
    branch.translate(0, 0.62, 0);
    branch.rotateZ(0.5 + (i % 3) * 0.16);
    branch.rotateY((i / n) * Math.PI * 2);
    parts.push(branch);
  }
  const geo = mergeGeometries(parts, false);
  geo.computeVertexNormals();
  return geo;
}

function placeScatter(root, cullables, preset, highShadowObjects) {
  const rng = makeRng(20260618);
  const dummy = new THREE.Object3D();

  const boulderMat = new THREE.MeshStandardMaterial({ color: 0x8a5b41, roughness: 0.95, metalness: 0 });
  const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f7a43, roughness: 0.85, metalness: 0 });
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0x6e7a42, roughness: 0.92, metalness: 0 });
  const spireMat = new THREE.MeshStandardMaterial({ color: 0x9c6f4e, roughness: 0.96, metalness: 0 });
  const butteMat = new THREE.MeshStandardMaterial({ color: 0xa9794f, roughness: 0.96, metalness: 0 });
  const smallRockMat = new THREE.MeshStandardMaterial({ color: 0x7e6450, roughness: 0.97, metalness: 0 });
  const deadBushMat = new THREE.MeshStandardMaterial({ color: 0x8a7345, roughness: 0.95, metalness: 0 });

  const boulders = new THREE.InstancedMesh(makeBoulderGeometry(), boulderMat, preset.boulders);
  const cacti = new THREE.InstancedMesh(makeCactusGeometry(), cactusMat, preset.cacti);
  const shrubs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), shrubMat, preset.shrubs);
  const spires = new THREE.InstancedMesh(makeSpireGeometry(), spireMat, preset.spires);
  const buttes = new THREE.InstancedMesh(makeButteGeometry(), butteMat, preset.buttes);
  const smallRocks = new THREE.InstancedMesh(makeSmallRockGeometry(), smallRockMat, preset.smallRocks);
  const deadBush = new THREE.InstancedMesh(makeDeadBushGeometry(), deadBushMat, preset.deadBush);

  boulders.castShadow = true;
  boulders.receiveShadow = true;
  cacti.castShadow = true;
  shrubs.castShadow = false;
  shrubs.receiveShadow = true;
  spires.castShadow = true;
  spires.receiveShadow = true;
  buttes.castShadow = true;
  buttes.receiveShadow = true;
  smallRocks.castShadow = false;
  smallRocks.receiveShadow = true;
  deadBush.castShadow = false;
  deadBush.receiveShadow = false;

  // Keep props off the helipads and out of the immediate base yard.
  const baseCenters = [
    { x: WORLD.baseAx, z: canyonCenterZ(WORLD.baseAx) },
    { x: WORLD.baseBx, z: canyonCenterZ(WORLD.baseBx) },
  ];
  function nearBase(x, z, r) {
    for (const b of baseCenters) {
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  let bi = 0;
  let ci = 0;
  let si = 0;
  let pi = 0;
  let ti = 0;
  let ri = 0;
  let di = 0;
  const spanX = WORLD.xMax - WORLD.xMin;
  let guard = 0;
  const filled = () =>
    bi >= preset.boulders && ci >= preset.cacti && si >= preset.shrubs &&
    pi >= preset.spires && ti >= preset.buttes && ri >= preset.smallRocks && di >= preset.deadBush;

  while (!filled() && guard < 300000) {
    guard++;
    const x = WORLD.xMin + 20 + rng() * (spanX - 40);
    const cz = canyonCenterZ(x);
    const hw = canyonHalfWidth(x);
    const z = cz + (rng() * 2 - 1) * (hw + 60);
    const d = Math.abs(z - cz);
    const h = terrainHeight(x, z);
    // Estimate slope so nothing floats off a cliff face.
    const slope = Math.abs(h - terrainHeight(x + 2, z)) + Math.abs(h - terrainHeight(x, z + 2));
    const onPad = nearBase(x, z, 18); // the platform itself
    const inBaseYard = nearBase(x, z, 30); // the cleared apron around it

    if (d < hw) {
      // Canyon floor → cacti, scrub, dry bushes, loose stones.
      if (ci < preset.cacti && !inBaseYard && rng() < 0.4 && slope < 2.2) {
        dummy.position.set(x, h - 0.2, z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        const s = 0.6 + rng() * 0.9;
        dummy.scale.set(s, s * (0.85 + rng() * 0.4), s);
        dummy.updateMatrix();
        cacti.setMatrixAt(ci++, dummy.matrix);
      } else if (di < preset.deadBush && !inBaseYard && rng() < 0.5 && slope < 2.4) {
        dummy.position.set(x, h - 0.05, z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        const s = 0.5 + rng() * 0.9;
        dummy.scale.set(s, s * (0.8 + rng() * 0.5), s);
        dummy.updateMatrix();
        deadBush.setMatrixAt(di++, dummy.matrix);
      } else if (si < preset.shrubs && !inBaseYard && slope < 2.6) {
        dummy.position.set(x, h, z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        const s = 0.5 + rng() * 1.0;
        dummy.scale.set(s * 1.4, s * 0.5, s * 1.4);
        dummy.updateMatrix();
        shrubs.setMatrixAt(si++, dummy.matrix);
      } else if (ri < preset.smallRocks && !onPad && slope < 3.0) {
        dummy.position.set(x, h - 0.15, z);
        dummy.rotation.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI);
        const s = 0.25 + rng() * rng() * 0.9;
        dummy.scale.set(s, s * 0.8, s);
        dummy.updateMatrix();
        smallRocks.setMatrixAt(ri++, dummy.matrix);
      }
    } else if (!onPad) {
      // Wall bases and plateau → spires, buttes, boulders, loose stones.
      if (pi < preset.spires && rng() < 0.06 && slope < 6) {
        dummy.position.set(x, h - 0.3, z);
        dummy.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI * 2, (rng() - 0.5) * 0.15);
        const s = 1.0 + rng() * rng() * 2.2;
        dummy.scale.set(s * (0.8 + rng() * 0.3), s, s * (0.8 + rng() * 0.3));
        dummy.updateMatrix();
        spires.setMatrixAt(pi++, dummy.matrix);
      } else if (ti < preset.buttes && rng() < 0.05 && slope < 5) {
        dummy.position.set(x, h - 0.4, z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        const s = 1.0 + rng() * 1.4;
        dummy.scale.set(s * (0.9 + rng() * 0.5), s * (0.8 + rng() * 0.7), s * (0.9 + rng() * 0.5));
        dummy.updateMatrix();
        buttes.setMatrixAt(ti++, dummy.matrix);
      } else if (bi < preset.boulders && slope < 9) {
        dummy.position.set(x, h, z);
        dummy.rotation.set(rng() * 0.6, rng() * Math.PI * 2, rng() * 0.6);
        const s = 0.7 + rng() * rng() * 5.5;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        boulders.setMatrixAt(bi++, dummy.matrix);
      } else if (ri < preset.smallRocks && slope < 6) {
        dummy.position.set(x, h - 0.15, z);
        dummy.rotation.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI);
        const s = 0.25 + rng() * rng() * 0.9;
        dummy.scale.set(s, s * 0.8, s);
        dummy.updateMatrix();
        smallRocks.setMatrixAt(ri++, dummy.matrix);
      }
    }
  }

  const all = [boulders, cacti, shrubs, spires, buttes, smallRocks, deadBush];
  const counts = [bi, ci, si, pi, ti, ri, di];
  all.forEach((mesh, k) => {
    mesh.count = counts[k];
    mesh.instanceMatrix.needsUpdate = true;
  });

  root.add(...all);
  cullables.push(...all);
  highShadowObjects.push(cacti);
}

export function buildCanyon(root, { detail = 'high' } = {}) {
  const preset = detailPresets[detail] ?? detailPresets.high;
  const cullables = [];
  const highShadowObjects = [];

  const terrain = buildTerrain(root, preset);
  placeScatter(root, cullables, preset, highShadowObjects);

  return { terrain, cullables, highShadowObjects };
}
