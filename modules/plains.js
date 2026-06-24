import * as THREE from 'three';
import { fbm, makeRng } from './noise.js';

// ---------------------------------------------------------------------------
// "Open Plains" — a deliberately simple second scene: a single massive, almost
// flat ground sheet with two bases set out across it, lit cooler and flatter
// than the canyon. No canyon walls, no dense prop fields — just a wide horizon.
// ---------------------------------------------------------------------------

export const PLAINS = {
  baseAx: -420,
  baseBx: 420,
  // The whole world is one big ground sheet. `half` is its half-extent.
  half: 1500,
};

const detailSegments = { high: 320, balanced: 240, performance: 160 };
const scatterCounts = {
  high: { rocks: 200, bushes: 260, tufts: 360 },
  balanced: { rocks: 130, bushes: 170, tufts: 230 },
  performance: { rocks: 80, bushes: 110, tufts: 150 },
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// A lazy, very broad meander so the A->B route sweeps a gentle S rather than a
// dead-straight line. Far smaller amplitude than the canyon's tight weave.
export function plainsCenterZ(x) {
  return 90 * Math.sin(x * 0.0024) + 36 * Math.sin(x * 0.0061 + 0.7);
}

// Near-flat ground: long, shallow swells you only really read once the low sun
// rakes shadows across them. Stays close to y = 0 everywhere.
export function plainsHeight(x, z) {
  const swell = (fbm(x * 0.0016 + 4, z * 0.0016 - 2, 4) - 0.5) * 9.0;
  const ripple = (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 0.7;
  return swell + ripple;
}

// The corridor is wide-open, so the flight path's slalom clamp does the limiting.
export function plainsHalfWidth() {
  return 120;
}

// Dry savanna / hardpan palette — a cooler, greyer-green dust quite distinct
// from the canyon's warm red sandstone strata.
const SOIL = [0.62, 0.59, 0.46];   // pale dust
const SOIL_DK = [0.45, 0.44, 0.34]; // damp/shadowed earth
const GRASS = [0.52, 0.55, 0.36];  // dry grass tint
export function plainsColorAt(x, z, out) {
  const patch = fbm(x * 0.004 + 9, z * 0.004 - 5, 4);     // big tonal patches
  const grain = fbm(x * 0.09 + 1, z * 0.09 + 3, 2);        // fine speckle
  const grassiness = clamp(fbm(x * 0.011 - 7, z * 0.011 + 2, 3) * 1.4 - 0.25, 0, 1);
  const r = lerp(SOIL_DK[0], SOIL[0], patch);
  const g = lerp(SOIL_DK[1], SOIL[1], patch);
  const b = lerp(SOIL_DK[2], SOIL[2], patch);
  const dust = 0.9 + grain * 0.2;
  out.r = lerp(r, GRASS[0], grassiness * 0.55) * dust;
  out.g = lerp(g, GRASS[1], grassiness * 0.55) * dust;
  out.b = lerp(b, GRASS[2], grassiness * 0.55) * dust;
  return out;
}

function buildGround(root, detail) {
  const seg = detailSegments[detail] ?? detailSegments.high;
  const size = PLAINS.half * 2;
  const geometry = new THREE.PlaneGeometry(size, size, seg, seg);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = plainsHeight(x, z);
    pos.setY(i, h);
    plainsColorAt(x, z, tmp);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'PlainsGround';
  root.add(mesh);
}

// --- Simple props (reused-in-spirit from the canyon: lumpy rocks + dry bushes) ---

function makeRockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const jitter = 0.72 + fbm(x * 2 + 1, z * 2 + y, 2) * 0.55;
    pos.setXYZ(i, x * jitter, y * jitter * 0.7, z * jitter);
  }
  geo.computeVertexNormals();
  return geo;
}

function placeScatter(root, cullables, highShadowObjects, detail) {
  const counts = scatterCounts[detail] ?? scatterCounts.high;
  const rng = makeRng(20260623);
  const dummy = new THREE.Object3D();

  const rockMat = new THREE.MeshStandardMaterial({ color: 0x70695a, roughness: 0.97 });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x6c733f, roughness: 0.92 });
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0x8a8a52, roughness: 0.95 });

  const rocks = new THREE.InstancedMesh(makeRockGeometry(), rockMat, counts.rocks);
  const bushes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), bushMat, counts.bushes);
  const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1.1, 5, 1, true), tuftMat, counts.tufts);

  rocks.castShadow = true;
  rocks.receiveShadow = true;
  bushes.castShadow = false;
  bushes.receiveShadow = true;
  tufts.castShadow = false;
  tufts.receiveShadow = false;

  const baseCenters = [
    { x: PLAINS.baseAx, z: plainsCenterZ(PLAINS.baseAx) },
    { x: PLAINS.baseBx, z: plainsCenterZ(PLAINS.baseBx) },
  ];
  const nearBase = (x, z, r) =>
    baseCenters.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < r * r);

  // Scatter sparsely over a wide field (props thin out toward the far horizon).
  const field = 1150;
  const place = (mesh, n, sizeFn) => {
    for (let i = 0; i < n; i++) {
      let x;
      let z;
      let guard = 0;
      do {
        x = (rng() * 2 - 1) * field;
        z = (rng() * 2 - 1) * field;
        guard++;
      } while (nearBase(x, z, 34) && guard < 12);
      const h = plainsHeight(x, z);
      sizeFn(dummy, rng);
      dummy.position.set(x, h, z);
      dummy.rotation.y = rng() * Math.PI * 2;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  place(rocks, counts.rocks, (d, r) => {
    const s = 0.3 + r() * r() * 2.4;
    d.scale.set(s, s * 0.8, s);
    d.rotation.set(r() * 0.5, 0, r() * 0.5);
  });
  place(bushes, counts.bushes, (d, r) => {
    const s = 0.5 + r() * 1.1;
    d.scale.set(s * 1.3, s * 0.45, s * 1.3);
    d.rotation.set(0, 0, 0);
  });
  place(tufts, counts.tufts, (d, r) => {
    const s = 0.5 + r() * 0.9;
    d.scale.set(s, s * (0.8 + r() * 0.8), s);
    d.rotation.set(0, 0, 0);
  });

  const all = [rocks, bushes, tufts];
  root.add(...all);
  cullables.push(...all);
  highShadowObjects.push(rocks);
}

export function buildPlains(root, { detail = 'high' } = {}) {
  const cullables = [];
  const highShadowObjects = [];
  buildGround(root, detail);
  placeScatter(root, cullables, highShadowObjects, detail);
  return { cullables, highShadowObjects };
}
