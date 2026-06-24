import * as THREE from 'three';
import { terrainHeight, terrainColorAt, WORLD } from './canyon.js';
import { ridged } from './noise.js';

// The surrounding back-country. Without it the detailed terrain plane just stops
// at the playable rim and you see the edge of the world against the sky. This is
// a single large, low-resolution mesh that:
//   - continues the canyon terrain seamlessly past the rim (same height field),
//   - lifts into distant mesa ranges as it heads for the horizon, and
//   - dives well below the detailed terrain anywhere inside the playable
//     rectangle, so the high-res mesh always wins there (no z-fighting / seam).
// The existing scene fog dissolves the far country into the sky for free.

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

function surroundHeight(x, z) {
  const base = terrainHeight(x, z);

  // How far this point lies OUTSIDE the detailed terrain (0 at/inside its edge).
  const outX = Math.max(0, Math.abs(x) - WORLD.terrainXMax);
  const outZ = Math.max(0, Math.abs(z) - WORLD.terrainZMax);
  const out = Math.hypot(outX, outZ);

  // Distant mesa ranges that swell up toward the horizon to frame the scene.
  const range = ridged(x * 0.0016 + 11, z * 0.0016 - 4, 4);
  const lift = smootherstep(out / 820) * (38 + range * 120);
  const h = base + lift;

  // Inside the detailed terrain: sink it below so the high-res mesh always wins.
  const inside = Math.min(WORLD.terrainXMax - Math.abs(x), WORLD.terrainZMax - Math.abs(z));
  if (inside > 0) {
    const t = smootherstep(inside / 120);
    return lerp(h, -80, t) - 2.0;
  }
  return h;
}

export function buildSurroundings(root, { half = 1200, segments = 200 } = {}) {
  const size = half * 2;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = surroundHeight(x, z);
    pos.setY(i, h);
    terrainColorAt(x, z, h, tmp);
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
    // Bias the far mesh behind the detailed terrain so the shared rim seam never
    // z-fights with the high-res canyon.
    polygonOffset: true,
    polygonOffsetFactor: 1.2,
    polygonOffsetUnits: 1.2,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = -1;
  mesh.name = 'Surroundings';
  root.add(mesh);
  return mesh;
}
