import * as THREE from 'three';
import { fbm, makeRng } from './noise.js';

// ---------------------------------------------------------------------------
// "Open Sea" — a third scene: a vast water plane with two very different bases.
// BASE ALPHA is a steel aircraft carrier steaming across the swell; BASE BRAVO
// is a rocky island outpost. The carrier deck and the island's flattened top
// both sit at y = 0 (the height the base/heli system expects a pad at), and the
// sea surface lies below them so each base genuinely rises out of the water.
// ---------------------------------------------------------------------------

export const SEA = {
  baseAx: -460, // carrier
  baseBx: 460,  // island
  half: 1700,   // half-extent of the water sheet
  waterY: -7.5, // mean sea level (deck / island top are at 0, well above)
};

const detailSegments = { high: 280, balanced: 200, performance: 130 };
const scatterCounts = {
  high: { buoys: 26, whitecaps: 520 },
  balanced: { buoys: 18, whitecaps: 320 },
  performance: { buoys: 10, whitecaps: 180 },
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// A lazy, broad meander so the carrier->island route sweeps a gentle S.
export function seaCenterZ(x) {
  return 70 * Math.sin(x * 0.0021) + 28 * Math.sin(x * 0.0057 + 0.6);
}

// Gentle swell. Stays near the mean sea level everywhere — the flight path uses
// this only for ground clearance, and the heli cruises far above it.
export function seaHeight(x, z) {
  const swell = Math.sin(x * 0.018 + z * 0.012) * 0.55
    + Math.sin(x * 0.006 - z * 0.021 + 1.7) * 0.8;
  const chop = (fbm(x * 0.05 + 3, z * 0.05 - 2, 2) - 0.5) * 0.5;
  return SEA.waterY + swell + chop;
}

// Wide-open water, so the flight path's slalom clamp does the limiting.
export function seaHalfWidth() {
  return 120;
}

// --- Water surface ----------------------------------------------------------

const DEEP_SEA = new THREE.Color(0x0a2536);

function buildWater(root, detail) {
  const seg = detailSegments[detail] ?? detailSegments.high;
  const size = SEA.half * 2;
  const geometry = new THREE.PlaneGeometry(size, size, seg, seg);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const deep = DEEP_SEA;
  const shallow = new THREE.Color(0x174a5e);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = seaHeight(x, z);
    pos.setY(i, h);
    // Tint crests only slightly lighter than troughs — a subtle depth read, not
    // the bright cyan caps that made the surface read as cracked ice.
    const t = clamp((h - SEA.waterY) * 0.5 + 0.5, 0, 1);
    tmp.copy(deep).lerp(shallow, t * 0.45);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  // Dielectric water: low metalness + a broad-ish roughness spreads the sun into
  // a soft glitter streak instead of the sharp mirror sheen of the old material.
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'SeaSurface';
  root.add(mesh);
}

// A huge, flat, low-poly plane at mean sea level that stretches far past the
// detailed swell out to the fog/horizon, so the ocean reads as edgeless. The
// detailed wave sheet fully fades into fog before its border, hiding the seam.
function buildFarSea(root) {
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000, 1, 1),
    new THREE.MeshStandardMaterial({ color: DEEP_SEA, roughness: 0.55, metalness: 0.05 }),
  );
  far.rotation.x = -Math.PI / 2;
  far.position.y = SEA.waterY - 0.5; // just under the swell so waves win up close
  far.receiveShadow = false;
  far.name = 'FarSea';
  root.add(far);
}

// Scatter drifting buoys + a sparse field of white-cap dots for life on the water.
function placeScatter(root, cullables, detail) {
  const counts = scatterCounts[detail] ?? scatterCounts.high;
  const rng = makeRng(20260624);
  const dummy = new THREE.Object3D();

  // Marker buoys: little floating cones with a blinking-ish light cap.
  const buoyMat = new THREE.MeshStandardMaterial({ color: 0xb33327, roughness: 0.6 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2a1208, emissive: 0xffd070, emissiveIntensity: 0.6 });
  const buoyGeo = new THREE.ConeGeometry(0.9, 2.6, 8);
  buoyGeo.translate(0, 1.3, 0);
  const buoys = new THREE.InstancedMesh(buoyGeo, buoyMat, counts.buoys);
  const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), capMat, counts.buoys);
  buoys.castShadow = true;
  caps.castShadow = false;

  const baseCenters = [
    { x: SEA.baseAx, z: seaCenterZ(SEA.baseAx) },
    { x: SEA.baseBx, z: seaCenterZ(SEA.baseBx) },
  ];
  const nearBase = (x, z, r) =>
    baseCenters.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < r * r);

  const field = 1250;
  for (let i = 0; i < counts.buoys; i++) {
    let x;
    let z;
    let guard = 0;
    do {
      x = (rng() * 2 - 1) * field;
      z = (rng() * 2 - 1) * field;
      guard++;
    } while (nearBase(x, z, 120) && guard < 16);
    const h = seaHeight(x, z);
    dummy.position.set(x, h, z);
    dummy.rotation.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
    dummy.scale.setScalar(0.8 + rng() * 0.8);
    dummy.updateMatrix();
    buoys.setMatrixAt(i, dummy.matrix);
    dummy.position.y = h + 2.6 * dummy.scale.y;
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    caps.setMatrixAt(i, dummy.matrix);
  }
  buoys.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;

  // White-cap foam flecks: tiny bright quads scattered over the swell.
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xcfe2e8, transparent: true, opacity: 0.32 });
  const foamGeo = new THREE.PlaneGeometry(2.4, 2.4);
  foamGeo.rotateX(-Math.PI / 2);
  const foam = new THREE.InstancedMesh(foamGeo, foamMat, counts.whitecaps);
  for (let i = 0; i < counts.whitecaps; i++) {
    const x = (rng() * 2 - 1) * field;
    const z = (rng() * 2 - 1) * field;
    const h = seaHeight(x, z);
    dummy.position.set(x, h + 0.12, z);
    dummy.rotation.set(0, rng() * Math.PI, 0);
    const s = 0.4 + rng() * 1.2;
    dummy.scale.set(s, 1, s * (0.5 + rng()));
    dummy.updateMatrix();
    foam.setMatrixAt(i, dummy.matrix);
  }
  foam.instanceMatrix.needsUpdate = true;

  // These instanced fields are scattered across the whole sea but, as far as the
  // engine is concerned, each is a single object sitting at the world origin with
  // a tiny (one-quad) bounding sphere. That makes both three.js' default frustum
  // cull and the scene's distance culler pop the ENTIRE field on/off depending on
  // where the camera looks / how far it is from the origin — the foam vanishing
  // "from some angles". Draw them unconditionally (one instanced call each, and
  // distant instances are hidden by fog anyway) instead of enrolling them in the
  // point-object cullers.
  for (const m of [buoys, caps, foam]) m.frustumCulled = false;

  root.add(buoys, caps, foam);
}

// --- Shared materials for the steel/island structures -----------------------

function structureMats() {
  return {
    deck: new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.92, metalness: 0.25 }),
    hull: new THREE.MeshStandardMaterial({ color: 0x6a7077, roughness: 0.7, metalness: 0.55 }),
    hullDark: new THREE.MeshStandardMaterial({ color: 0x2b3035, roughness: 0.75, metalness: 0.5 }),
    island: new THREE.MeshStandardMaterial({ color: 0x8a9097, roughness: 0.6, metalness: 0.5 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xe9eee2, roughness: 0.7 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xd8b53a, roughness: 0.65 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x5a5f63, roughness: 0.5, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x203033, roughness: 0.3, metalness: 0.4 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x5f5750, roughness: 0.98 }),
    rockDk: new THREE.MeshStandardMaterial({ color: 0x423c36, roughness: 0.98 }),
    sand: new THREE.MeshStandardMaterial({ color: 0xb6a578, roughness: 0.95 }),
    grass: new THREE.MeshStandardMaterial({ color: 0x4f5d35, roughness: 0.9 }),
  };
}

function makeLabel(group, text, y) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 30px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d7ffe0';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
  sprite.position.set(0, y, 0);
  sprite.scale.set(13, 3.25, 1);
  sprite.userData.isWorldLabel = true;
  group.add(sprite);
}

// A landing circle: painted ring, H, and a ring of blinking perimeter beacons.
// Pushes the beacon materials into `beacons` so the main loop can pulse them.
function addHelipad(group, beacons, { y = 0, r = 11, color = 0xff3322 } = {}) {
  const mats = structureMats();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.82, 0.34, 8, 64), mats.paint);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = y + 0.14;
  group.add(ring);

  const barGeo = new THREE.BoxGeometry(1.5, 0.12, r * 0.85);
  const left = new THREE.Mesh(barGeo, mats.paint);
  left.position.set(-r * 0.32, y + 0.13, 0);
  const right = new THREE.Mesh(barGeo, mats.paint);
  right.position.set(r * 0.32, y + 0.13, 0);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(r * 0.64, 0.12, 1.6), mats.paint);
  cross.position.set(0, y + 0.13, 0);
  group.add(left, right, cross);

  const markerGeo = new THREE.SphereGeometry(0.34, 10, 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a1010,
      emissive: color,
      emissiveIntensity: 1.4,
      roughness: 0.5,
    });
    const m = new THREE.Mesh(markerGeo, mat);
    m.position.set(Math.cos(a) * r, y + 0.32, Math.sin(a) * r);
    group.add(m);
    beacons.push(mat);
  }
}

// --- Shared strike fighter ---------------------------------------------------
// A twin-tail strike fighter, ~11m long, nose toward +X. Exported so any scene
// can spot the same aircraft (the carrier deck park AND the canyon airfield).
export function makeStrikeJet({ folded = false } = {}) {
  const jetMat = new THREE.MeshStandardMaterial({ color: 0x5b656f, roughness: 0.55, metalness: 0.35 });
  const jetDk = new THREE.MeshStandardMaterial({ color: 0x434b53, roughness: 0.6, metalness: 0.3 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1a2226, roughness: 0.2, metalness: 0.5 });
  const missileMat = new THREE.MeshStandardMaterial({ color: 0xcfcabb, roughness: 0.7 });

  const j = new THREE.Group();
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 9, 10), jetMat);
  fuse.rotation.z = Math.PI / 2;
  fuse.position.y = 1.1;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.2, 10), jetMat);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(6, 1.1, 0);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), canopyMat);
  canopy.scale.set(1.8, 0.7, 0.9);
  canopy.position.set(2.8, 1.7, 0);
  // Swept wings (foldable). Each side built around the wing-root hinge.
  const wingGeo = new THREE.BoxGeometry(4.6, 0.18, 3.2);
  const wingL = new THREE.Mesh(wingGeo, jetDk);
  const wingR = new THREE.Mesh(wingGeo, jetDk);
  if (folded) {
    wingL.position.set(-0.5, 2.2, 1.4); wingL.rotation.x = -1.2;
    wingR.position.set(-0.5, 2.2, -1.4); wingR.rotation.x = 1.2;
  } else {
    wingL.position.set(-0.6, 1.1, 3.0); wingL.rotation.y = 0.5;
    wingR.position.set(-0.6, 1.1, -3.0); wingR.rotation.y = -0.5;
  }
  // Twin canted tail fins + horizontal stabs.
  const finGeo = new THREE.BoxGeometry(2.4, 2.2, 0.16);
  const finL = new THREE.Mesh(finGeo, jetDk);
  finL.position.set(-4, 2.3, 0.9); finL.rotation.z = 0.3; finL.rotation.x = 0.2;
  const finR = new THREE.Mesh(finGeo, jetDk);
  finR.position.set(-4, 2.3, -0.9); finR.rotation.z = 0.3; finR.rotation.x = -0.2;
  const stab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 4.2), jetDk);
  stab.position.set(-4.2, 1.1, 0);
  // Wingtip missiles.
  const m1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6), missileMat);
  m1.rotation.z = Math.PI / 2; m1.position.set(0, 1.0, folded ? 1.4 : 4.4);
  const m2 = m1.clone(); m2.position.z = folded ? -1.4 : -4.4;
  j.add(fuse, nose, canopy, wingL, wingR, finL, finR, stab, m1, m2);
  j.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return j;
}

// --- Aircraft carrier (BASE ALPHA) ------------------------------------------

function buildCarrier(name, beacons) {
  const group = new THREE.Group();
  const mats = structureMats();

  const len = 165; // along X (bow toward +X / toward the island)
  const beam = 40; // along Z
  const deckY = 0;
  const hullDepth = 22; // hull extends below the waterline

  // Hull: a tapered box. Built from a box whose bow vertices pinch in.
  const hullGeo = new THREE.BoxGeometry(len, hullDepth, beam, 1, 1, 1);
  {
    const p = hullGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const f = clamp((x / (len / 2)) * 0.5 + 0.5, 0, 1); // 0 stern .. 1 bow
      // Pinch the bow and round the keel.
      const taperBow = x > len * 0.28 ? (1 - (f - 0.64) / 0.36 * 0.62) : 1;
      const taperStern = x < -len * 0.34 ? 0.82 : 1;
      const narrow = Math.min(taperBow, 1) * taperStern;
      const keel = y < 0 ? 1 - Math.pow((-y) / (hullDepth / 2), 2) * 0.18 : 1;
      p.setZ(i, z * narrow);
      p.setX(i, x * (y < 0 ? keel : 1));
    }
    hullGeo.computeVertexNormals();
  }
  const hull = new THREE.Mesh(hullGeo, mats.hull);
  hull.position.y = deckY - hullDepth / 2 + 1.0;
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  // Boot-top stripe at the waterline.
  const waterStripe = new THREE.Mesh(new THREE.BoxGeometry(len * 0.985, 1.4, beam * 0.9), mats.hullDark);
  waterStripe.position.y = SEA.waterY - deckY + 0.2;
  group.add(waterStripe);

  // Flight deck: a flat slab slightly wider than the hull, plus an angled
  // landing deck cantilevered out to port (-Z), like a real carrier.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(len * 0.99, 1.4, beam + 12), mats.deck);
  deck.position.y = deckY - 0.7;
  deck.receiveShadow = true;
  deck.castShadow = true;
  group.add(deck);

  const angled = new THREE.Mesh(new THREE.BoxGeometry(len * 0.5, 1.2, 17), mats.deck);
  angled.position.set(-len * 0.12, deckY - 0.6, -beam * 0.5 - 4);
  angled.rotation.y = 0.16;
  angled.receiveShadow = true;
  group.add(angled);

  // Deck markings: dashed centreline + angled-deck centreline + foul lines.
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xeceee6, roughness: 0.7 });
  const yellowLine = new THREE.MeshStandardMaterial({ color: 0xd8b53a, roughness: 0.65 });
  const redLine = new THREE.MeshStandardMaterial({ color: 0xb5402f, roughness: 0.7 });
  for (let i = -7; i <= 7; i++) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.06, 1.0), lineMat);
    dash.position.set(i * 10, deckY + 0.02, 2);
    group.add(dash);
  }
  const angledLine = new THREE.Mesh(new THREE.BoxGeometry(len * 0.42, 0.06, 1.0), yellowLine);
  angledLine.position.set(-len * 0.12, deckY + 0.03, -beam * 0.5 - 4);
  angledLine.rotation.y = 0.16;
  group.add(angledLine);
  // Red/white foul line bordering the landing area.
  const foul = new THREE.Mesh(new THREE.BoxGeometry(len * 0.46, 0.06, 0.6), redLine);
  foul.position.set(-len * 0.12, deckY + 0.03, -beam * 0.5 + 4);
  foul.rotation.y = 0.16;
  group.add(foul);

  // Two bow catapult tracks + jet-blast deflectors raised behind each.
  const catMat = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.85, metalness: 0.3 });
  const jbdMat = new THREE.MeshStandardMaterial({ color: 0x6b5b34, roughness: 0.8, metalness: 0.2 });
  for (const cz of [-3, 7]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(56, 0.12, 0.7), catMat);
    track.position.set(len * 0.22, deckY + 0.04, cz);
    group.add(track);
    const jbd = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 0.5), jbdMat);
    jbd.position.set(len * 0.22 - 30, deckY + 1.0, cz);
    jbd.rotation.z = 0.5; // tilted up out of the deck
    jbd.castShadow = true;
    group.add(jbd);
  }

  // Arrestor wires across the angled landing deck.
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 22, 6), wireMat);
    wire.rotation.x = Math.PI / 2;
    wire.rotation.y = 0.16;
    wire.position.set(-len * 0.18 + i * 3.2, deckY + 0.18, -beam * 0.5 - 3.5);
    group.add(wire);
  }

  // Deck-edge aircraft elevators (slightly inset slabs along the starboard edge).
  const elevMat = new THREE.MeshStandardMaterial({ color: 0x34383d, roughness: 0.9, metalness: 0.25 });
  for (const ex of [len * 0.2, -len * 0.18]) {
    const elev = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 12), elevMat);
    elev.position.set(ex, deckY + 0.05, beam * 0.5 + 5);
    elev.receiveShadow = true;
    group.add(elev);
    // Outline stripes.
    for (const dz of [-6, 6]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(16, 0.07, 0.4), yellowLine);
      edge.position.set(ex, deckY + 0.1, beam * 0.5 + 5 + dz);
      group.add(edge);
    }
  }

  // Big deck number near the bow.
  {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 128, 128);
    ctx.font = '700 90px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#eceee6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('72', 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const num = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8 }));
    num.rotation.x = -Math.PI / 2;
    num.rotation.z = -Math.PI / 2;
    num.position.set(len * 0.42, deckY + 0.04, 0);
    group.add(num);
  }

  // The "island" superstructure on the starboard side (+Z), set aft of midships.
  const sup = new THREE.Group();
  sup.position.set(-len * 0.06, deckY, beam * 0.5 - 1);
  // Stepped tower body (two stacked blocks).
  const towerLo = new THREE.Mesh(new THREE.BoxGeometry(22, 8, 9), mats.hull);
  towerLo.position.y = 4.5;
  towerLo.castShadow = true;
  towerLo.receiveShadow = true;
  sup.add(towerLo);
  const towerHi = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 8), mats.hull);
  towerHi.position.set(-1, 11, 0);
  towerHi.castShadow = true;
  sup.add(towerHi);
  // Pri-fly / bridge glass band wrapping the tower.
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(22.4, 2.2, 9.4), mats.glass);
  bridge.position.y = 6.5;
  sup.add(bridge);
  const priFly = new THREE.Mesh(new THREE.BoxGeometry(16.4, 1.8, 8.4), mats.glass);
  priFly.position.set(-1, 12, 0);
  sup.add(priFly);
  // Flat planar SPS radar arrays on two faces of the upper block.
  const arrayMat = new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.5, metalness: 0.4 });
  const a1 = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.2, 0.4), arrayMat);
  a1.position.set(-1, 11, 4.1);
  sup.add(a1);
  const a2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.2, 4.2), arrayMat);
  a2.position.set(-9, 11, 0);
  sup.add(a2);
  // Funnel/exhaust stack.
  const stack = new THREE.Mesh(new THREE.BoxGeometry(7, 7, 6), mats.hullDark);
  stack.position.set(-6, 9, 0);
  stack.castShadow = true;
  sup.add(stack);
  // Forward lattice mast + main mast with yardarm and antennas.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 18, 8), mats.metal);
  mast.position.set(4, 23, 0);
  mast.castShadow = true;
  sup.add(mast);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 11, 6), mats.metal);
  yard.rotation.x = Math.PI / 2;
  yard.position.set(4, 27, 0);
  sup.add(yard);
  for (const ax of [2, 6]) {
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 5), mats.metal);
    whip.position.set(ax, 19, 3.5);
    whip.rotation.z = 0.3;
    sup.add(whip);
  }
  // Rotating air-search radar bar on top of the mast.
  const radar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 8), arrayMat);
  radar.position.set(4, 31, 0);
  sup.add(radar);
  // Obstruction light atop the mast (blinks).
  const obsMat = new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0xff2010, emissiveIntensity: 2.0 });
  const obs = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), obsMat);
  obs.position.set(4, 32.3, 0);
  sup.add(obs);
  beacons.push(obsMat);
  // Ensign on a small gaff.
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4, 5), mats.metal);
  flagPole.position.set(-9, 16, 0);
  sup.add(flagPole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 2.6), new THREE.MeshStandardMaterial({ color: 0xb23, roughness: 0.85, side: THREE.DoubleSide }));
  flag.position.set(-9, 17.2, 1.4);
  sup.add(flag);
  group.add(sup);

  // CIWS / point-defence mounts at two deck-edge sponsons.
  for (const [mx, mz] of [[len * 0.4, -beam * 0.5 - 2], [-len * 0.44, beam * 0.5 + 2]]) {
    const ciws = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 1.0, 12), mats.metal);
    base.position.y = deckY + 0.6;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.paint);
    dome.position.y = deckY + 1.4;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.2, 8), mats.hullDark);
    barrel.rotation.z = Math.PI / 2 - 0.5;
    barrel.position.set(0.9, deckY + 1.8, 0);
    ciws.add(base, dome, barrel);
    ciws.position.set(mx, 0, mz);
    ciws.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(ciws);
  }

  // --- Aircraft ---------------------------------------------------------------
  // The strike fighter model lives at module scope (makeStrikeJet) so other
  // scenes — e.g. the canyon assault level's airfield — can reuse the same plane.
  const makeJet = makeStrikeJet;
  // Steel tones shared by the stern plane-guard helicopter below.
  const jetMat = new THREE.MeshStandardMaterial({ color: 0x5b656f, roughness: 0.55, metalness: 0.35 });
  const jetDk = new THREE.MeshStandardMaterial({ color: 0x434b53, roughness: 0.6, metalness: 0.3 });

  // A packed deck park aft + a couple spotted on the elevators.
  const jetSpots = [
    [-len * 0.40, beam * 0.30, 0.6, true],
    [-len * 0.40, beam * 0.06, 0.6, true],
    [-len * 0.33, beam * 0.30, 0.5, true],
    [-len * 0.33, beam * 0.06, 0.5, false],
    [-len * 0.46, beam * 0.18, 0.7, true],
    [len * 0.2, beam * 0.5 + 5, -0.4, false], // on the forward elevator
  ];
  for (const [jx, jz, jr, folded] of jetSpots) {
    const j = makeJet({ folded });
    j.position.set(jx, deckY + 0.1, jz);
    j.rotation.y = jr;
    j.userData.destructiblePlane = {
      hp: 5,
      radius: folded ? 5.2 : 6.2,
      center: new THREE.Vector3(0.5, 1.25, 0),
    };
    group.add(j);
  }

  // A plane-guard helicopter spotted at the stern.
  {
    const h = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 4, 6, 10), jetDk);
    cab.rotation.z = Math.PI / 2;
    cab.position.y = 1.4;
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.18, 4.5, 8), jetDk);
    boom.rotation.z = Math.PI / 2;
    boom.position.set(-4, 1.8, 0);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.08, 0.5), jetMat);
    rotor.position.y = 3.0;
    const skidL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), mats.metal);
    skidL.rotation.x = Math.PI / 2; skidL.position.set(0, 0.3, 1.1);
    const skidR = skidL.clone(); skidR.position.z = -1.1;
    h.add(cab, boom, rotor, skidL, skidR);
    h.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    h.position.set(-len * 0.46, deckY + 0.2, -beam * 0.28);
    h.rotation.y = 0.3;
    group.add(h);
  }

  // Yellow flight-deck tow tractor parked by the island.
  {
    const t = new THREE.Group();
    const tBody = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 1.8), mats.yellow);
    tBody.position.y = 1.0;
    const tCab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.6), mats.hullDark);
    tCab.position.set(-0.8, 1.9, 0);
    const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 10);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.9 });
    t.add(tBody, tCab);
    for (const wx of [-1.1, 1.1]) for (const wz of [-0.9, 0.9]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.x = Math.PI / 2; w.position.set(wx, 0.45, wz);
      t.add(w);
    }
    t.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    t.position.set(-len * 0.06, deckY + 0.1, beam * 0.5 + 8);
    t.rotation.y = 0.4;
    group.add(t);
  }

  // Deck-edge safety netting posts + catwalk rail along both long edges.
  const railMat = new THREE.MeshStandardMaterial({ color: 0x33373b, roughness: 0.7, metalness: 0.4 });
  const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6);
  for (const edgeZ of [-(beam + 12) / 2 + 0.3, (beam + 12) / 2 - 0.3]) {
    for (let i = -8; i <= 8; i++) {
      const post = new THREE.Mesh(postGeo, railMat);
      post.position.set(i * 9.5, deckY + 0.8, edgeZ);
      group.add(post);
    }
  }

  // Helipad spot at deck centre (where the heli actually lands).
  addHelipad(group, beacons, { y: deckY, r: 11, color: 0xffd070 });
  makeLabel(group, name, deckY + 8);

  return { group };
}

// --- Rocky island outpost (BASE BRAVO) --------------------------------------

function buildIsland(name, beacons) {
  const group = new THREE.Group();
  const mats = structureMats();

  const topY = 0;        // flattened summit (where the pad sits)
  const baseR = 95;      // radius at the waterline
  const rimR = 22;       // flat summit radius

  // Island land mass: a radial mound. A high-segment cone reshaped so it rises
  // from below the water to a flat top, with a noisy rocky flank.
  const seg = 96;
  const rings = 26;
  const geo = new THREE.CylinderGeometry(rimR, baseR, 40, seg, rings, false);
  {
    const p = geo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const rockC = new THREE.Color(0x5f5750);
    const rockDk = new THREE.Color(0x3a342e);
    const sandC = new THREE.Color(0xb6a578);
    const grassC = new THREE.Color(0x4f5d35);
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      let y = p.getY(i);
      const z = p.getZ(i);
      const radial = Math.sqrt(x * x + z * z);
      const ang = Math.atan2(z, x);
      // Map cone height (-20..20) to world so the top is flat at topY and the
      // flank descends below the sea.
      const f = clamp((y + 20) / 40, 0, 1); // 0 base .. 1 top
      let worldY = topY - (1 - f) * 30; // flank drops to ~ -30 at the base
      // Rocky displacement on the flanks (none on the flat summit).
      const flank = clamp((1 - f) * 1.4, 0, 1);
      const n = fbm(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2 - 3, 4) - 0.5;
      const bump = n * 9 * flank;
      worldY += bump;
      // Outward bulge so it's not a clean cone.
      const bulge = 1 + (fbm(Math.cos(ang) * 3 + 1, Math.sin(ang) * 3 + 7, 3) - 0.5) * 0.35 * flank;
      p.setX(i, x * bulge);
      p.setZ(i, z * bulge);
      p.setY(i, worldY);

      // Colour by height band: rock low, sand at the waterline, grass on top.
      const wy = worldY;
      if (wy > topY - 3) tmp.copy(grassC);
      else if (wy > SEA.waterY - 1 && wy < SEA.waterY + 4) tmp.copy(sandC);
      else tmp.copy(rockC).lerp(rockDk, fbm(x * 0.05, z * 0.05, 2));
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
  }
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 }));
  land.castShadow = true;
  land.receiveShadow = true;
  group.add(land);

  // Flat concrete pad cap on the summit so the helipad reads as a built platform.
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR + 1.5, 1.2, 48), mats.deck);
  cap.position.y = topY - 0.5;
  cap.receiveShadow = true;
  cap.castShadow = true;
  group.add(cap);

  // Outpost structures clustered to one side of the pad.
  // Radar dome.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.paint);
  dome.position.set(-15, topY, 8);
  dome.castShadow = true;
  group.add(dome);
  const domeBase = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 2.4, 16), mats.hull);
  domeBase.position.set(-15, topY + 1.2, 8);
  group.add(domeBase);

  // Two fuel tanks.
  for (const tx of [-16, -11]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 5, 18), mats.metal);
    tank.position.set(tx, topY + 2.5, -10);
    tank.castShadow = true;
    tank.receiveShadow = true;
    group.add(tank);
    const top = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.metal);
    top.position.set(tx, topY + 5, -10);
    group.add(top);
  }

  // Control hut.
  const hut = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), new THREE.MeshStandardMaterial({ color: 0x8c8472, roughness: 0.9 }));
  hut.position.set(14, topY + 2, -10);
  hut.castShadow = true;
  hut.receiveShadow = true;
  group.add(hut);
  const hutRoof = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.4, 6.6), mats.hullDark);
  hutRoof.position.set(14, topY + 4.2, -10);
  group.add(hutRoof);

  // Lighthouse / beacon tower on the seaward edge.
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 12, 14), mats.paint);
  tower.position.set(16, topY + 6, 12);
  tower.castShadow = true;
  group.add(tower);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x402a10, emissive: 0xfff0b0, emissiveIntensity: 2.2 });
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2, 14), lampMat);
  lamp.position.set(16, topY + 12.6, 12);
  group.add(lamp);
  beacons.push(lampMat);
  const lampRoof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 2, 14), mats.hullDark);
  lampRoof.position.set(16, topY + 14.4, 12);
  group.add(lampRoof);

  // Antenna mast with obstruction light.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 13, 8), mats.metal);
  mast.position.set(-15, topY + 6.5, 8);
  group.add(mast);
  const obsMat = new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0xff2010, emissiveIntensity: 2.0 });
  const obs = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), obsMat);
  obs.position.set(-15, topY + 13.3, 8);
  group.add(obs);
  beacons.push(obsMat);

  // Comms / radar lattice tower behind the dome.
  {
    const t = new THREE.Group();
    for (const legA of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 16, 6), mats.metal);
      leg.position.set(Math.cos(legA) * 1.1, topY + 8, Math.sin(legA) * 1.1);
      leg.rotation.z = Math.cos(legA) * 0.04;
      leg.rotation.x = -Math.sin(legA) * 0.04;
      t.add(leg);
    }
    for (let ry = 2; ry < 16; ry += 2.5) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 4, 8), mats.metal);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = topY + ry;
      t.add(ring);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), mats.paint);
    dish.rotation.x = -1.1;
    dish.position.set(0, topY + 15, 1.4);
    t.add(dish);
    t.position.set(-8, 0, 14);
    t.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(t);
  }

  // Barracks hut + a small solar array, opposite the fuel farm.
  const barracks = new THREE.Mesh(new THREE.BoxGeometry(10, 3.4, 5), new THREE.MeshStandardMaterial({ color: 0x7d8a6a, roughness: 0.9 }));
  barracks.position.set(4, topY + 1.7, 14);
  barracks.castShadow = true;
  barracks.receiveShadow = true;
  group.add(barracks);
  const barRoof = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.4, 5.6), mats.hullDark);
  barRoof.position.set(4, topY + 3.6, 14);
  group.add(barRoof);
  const solarMat = new THREE.MeshStandardMaterial({ color: 0x1b2740, roughness: 0.35, metalness: 0.5 });
  for (const sx of [-2, 0.5]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 3), solarMat);
    panel.rotation.x = -0.5;
    panel.position.set(sx, topY + 1.4, 17.5);
    group.add(panel);
  }

  // Sandbag revetment ringing the fuel tanks.
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x9a8a63, roughness: 0.98 });
  const bagGeo = new THREE.BoxGeometry(1.1, 0.5, 0.8);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 1.2 - 0.6;
    const bag = new THREE.Mesh(bagGeo, bagMat);
    bag.position.set(-13.5 + Math.cos(a) * 5.5, topY + 0.5, -10 + Math.sin(a) * 4.5);
    bag.rotation.y = a;
    bag.castShadow = true;
    group.add(bag);
  }

  // Windsock by the pad.
  const sockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 6, 8), mats.metal);
  sockPole.position.set(0, topY + 3, 18);
  sockPole.castShadow = true;
  group.add(sockPole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.6, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xd86a2a, roughness: 0.8, side: THREE.DoubleSide }));
  sock.rotation.z = Math.PI / 2 - 0.4;
  sock.position.set(1.4, topY + 5.6, 18);
  group.add(sock);

  // --- Vegetation + boulders on the upper flanks ------------------------------
  // Place props by (angle, f) along the same radial profile the land mesh uses
  // (f: 0 at the waterline base .. 1 at the flat summit), so they sit on the
  // slope. Noise on the real surface is ignored, hidden by the foliage/footing.
  const surfaceAt = (ang, f) => {
    const radius = baseR + (rimR - baseR) * f;
    return { x: Math.cos(ang) * radius, z: Math.sin(ang) * radius, y: topY - (1 - f) * 30 };
  };

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4228, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3c5a2c, roughness: 0.9 });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x4a6a33, roughness: 0.9 });
  function makeTree(scale, leaf) {
    const tr = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6), trunkMat);
    trunk.position.y = 1.2;
    tr.add(trunk);
    for (let k = 0; k < 3; k++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6 - k * 0.4, 2.0, 8), leaf);
      cone.position.y = 2.4 + k * 1.3;
      tr.add(cone);
    }
    tr.scale.setScalar(scale);
    tr.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return tr;
  }
  const treeRng = makeRng(7731);
  for (let i = 0; i < 18; i++) {
    const ang = treeRng() * Math.PI * 2;
    const f = 0.78 + treeRng() * 0.16;
    const s = surfaceAt(ang, f);
    const tree = makeTree(0.8 + treeRng() * 0.9, treeRng() > 0.5 ? leafMat : leafMat2);
    tree.position.set(s.x, s.y - 0.3, s.z);
    tree.rotation.y = treeRng() * Math.PI;
    group.add(tree);
  }

  // Scattered boulders lower on the rocky flank.
  const boulderMat = new THREE.MeshStandardMaterial({ color: 0x554d45, roughness: 0.98 });
  const boulderGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockRng = makeRng(5519);
  for (let i = 0; i < 12; i++) {
    const ang = rockRng() * Math.PI * 2;
    const f = 0.62 + rockRng() * 0.22;
    const s = surfaceAt(ang, f);
    const b = new THREE.Mesh(boulderGeo, boulderMat);
    const sc = 1.2 + rockRng() * 2.6;
    b.scale.set(sc, sc * 0.8, sc * (0.8 + rockRng() * 0.4));
    b.rotation.set(rockRng() * 3, rockRng() * 3, rockRng() * 3);
    b.position.set(s.x, s.y, s.z);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
  }

  // A short jetty/pier running down the flank into the water.
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x6a5a42, roughness: 0.95 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 46), pierMat);
  pier.position.set(40, SEA.waterY + 1.5, 0);
  pier.castShadow = true;
  pier.receiveShadow = true;
  group.add(pier);
  for (let i = 0; i < 5; i++) {
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6, 8), pierMat);
    pile.position.set(40 + (i % 2 ? 2 : -2), SEA.waterY - 0.5, -18 + i * 9);
    group.add(pile);
  }

  // A small patrol boat moored alongside the pier.
  {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.0, 9, 8), new THREE.MeshStandardMaterial({ color: 0x39434b, roughness: 0.7, metalness: 0.3 }));
    hull.rotation.z = Math.PI / 2;
    hull.scale.set(1, 1, 0.6);
    hull.position.y = 0.4;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 1.6), mats.paint);
    cabin.position.set(-0.5, 1.4, 0);
    const mastB = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5), mats.metal);
    mastB.position.set(-0.5, 2.8, 0);
    boat.add(hull, cabin, mastB);
    boat.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    boat.position.set(45, SEA.waterY + 0.4, 14);
    boat.rotation.y = Math.PI / 2;
    group.add(boat);
  }

  // A winding footpath from the pad down toward the pier (flat stepping slabs).
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x847462, roughness: 0.97 });
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const ang = lerp(0, 0.5, t);
    const f = lerp(0.95, 0.7, t);
    const s = surfaceAt(ang, f);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 3.2), pathMat);
    slab.position.set(s.x * 0.9, s.y + 0.15, s.z * 0.9);
    slab.rotation.y = ang + 0.4;
    slab.receiveShadow = true;
    group.add(slab);
  }

  // Helipad on the summit.
  addHelipad(group, beacons, { y: topY, r: 11, color: 0xff3322 });
  makeLabel(group, name, topY + 7);

  return { group };
}

// --- Public scene hooks -----------------------------------------------------

export function buildSeaTerrain(root, { detail = 'high' } = {}) {
  const cullables = [];
  const highShadowObjects = [];
  buildFarSea(root);
  buildWater(root, detail);
  placeScatter(root, cullables, detail);
  return { cullables, highShadowObjects };
}

// Custom base builder for the sea scene: the carrier and the island ARE the two
// bases. Returns the blinking beacon materials, like buildBases() does.
export function buildSeaBases(root) {
  const beacons = [];
  const carrier = buildCarrier('CVN ALPHA', beacons);
  carrier.group.position.set(SEA.baseAx, 0, seaCenterZ(SEA.baseAx));
  // Bow points toward the island (+X), heading the heli flies on departure.
  carrier.group.rotation.y = 0;
  root.add(carrier.group);

  const island = buildIsland('BASE BRAVO', beacons);
  island.group.position.set(SEA.baseBx, 0, seaCenterZ(SEA.baseBx));
  root.add(island.group);

  return { beacons };
}
