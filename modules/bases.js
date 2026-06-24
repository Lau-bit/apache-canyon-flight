import * as THREE from 'three';

const PAD_TOP = 3.2;

function addLabel(group, text, y) {
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
  sprite.scale.set(11, 2.75, 1);
  sprite.userData.isWorldLabel = true;
  group.add(sprite);
}

function buildOneBase(name) {
  const group = new THREE.Group();

  const concrete = new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 0.95, metalness: 0 });
  const darkConcrete = new THREE.MeshStandardMaterial({ color: 0x40413c, roughness: 0.95, metalness: 0 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xe9eee2, roughness: 0.7 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd8b53a, roughness: 0.65 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x5a5f63, roughness: 0.5, metalness: 0.6 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x57603a, roughness: 0.8 });

  // Raised landing platform.
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(15, 16, PAD_TOP, 40), concrete);
  pad.position.y = PAD_TOP / 2;
  pad.receiveShadow = true;
  pad.castShadow = true;
  group.add(pad);

  const apron = new THREE.Mesh(new THREE.CylinderGeometry(15.2, 15.2, 0.18, 40), darkConcrete);
  apron.position.y = PAD_TOP + 0.02;
  apron.receiveShadow = true;
  group.add(apron);

  // Painted circle + H.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9.4, 0.32, 8, 64), paint);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = PAD_TOP + 0.13;
  group.add(ring);

  const barGeo = new THREE.BoxGeometry(1.5, 0.12, 8);
  const left = new THREE.Mesh(barGeo, paint);
  left.position.set(-3, PAD_TOP + 0.12, 0);
  const right = new THREE.Mesh(barGeo, paint);
  right.position.set(3, PAD_TOP + 0.12, 0);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 1.6), paint);
  cross.position.set(0, PAD_TOP + 0.12, 0);
  group.add(left, right, cross);

  // Perimeter marker lights (returned for blinking).
  const beacons = [];
  const markerGeo = new THREE.SphereGeometry(0.32, 10, 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a1010,
      emissive: 0xff3322,
      emissiveIntensity: 1.4,
      roughness: 0.5,
    });
    const m = new THREE.Mesh(markerGeo, mat);
    m.position.set(Math.cos(a) * 14, PAD_TOP + 0.3, Math.sin(a) * 14);
    group.add(m);
    beacons.push(mat);
  }

  // Control hut beside the pad.
  const hut = new THREE.Group();
  hut.position.set(0, 0, -24);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(9, 4.2, 6), new THREE.MeshStandardMaterial({ color: 0x8c8472, roughness: 0.9 }));
  wall.position.y = 2.1;
  wall.castShadow = true;
  wall.receiveShadow = true;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.4, 6.6), darkConcrete);
  roof.position.y = 4.4;
  roof.castShadow = true;
  const win = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.5, 0.1), new THREE.MeshStandardMaterial({ color: 0x223033, roughness: 0.3, metalness: 0.4 }));
  win.position.set(0, 2.7, 3.02);
  hut.add(wall, roof, win);

  // Antenna mast with a blinking obstruction light.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 11, 8), metal);
  mast.position.set(4.6, 5.5, 0);
  mast.castShadow = true;
  hut.add(mast);
  const obstructionMat = new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0xff2010, emissiveIntensity: 2.0 });
  const obstruction = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), obstructionMat);
  obstruction.position.set(4.6, 11.1, 0);
  hut.add(obstruction);
  beacons.push(obstructionMat);
  group.add(hut);

  // Fuel drums.
  const drumGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.7, 14);
  for (let i = 0; i < 5; i++) {
    const drum = new THREE.Mesh(drumGeo, i % 2 ? olive : yellow);
    drum.position.set(-18 + (i % 3) * 1.7, PAD_TOP + 0.85, -10 - Math.floor(i / 3) * 1.7);
    drum.castShadow = true;
    drum.receiveShadow = true;
    group.add(drum);
  }

  // Windsock pole.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 8, 8), metal);
  pole.position.set(16, PAD_TOP + 4, 6);
  pole.castShadow = true;
  group.add(pole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xd86a2a, roughness: 0.8, side: THREE.DoubleSide }));
  sock.rotation.z = Math.PI / 2 - 0.4;
  sock.position.set(17.6, PAD_TOP + 7.4, 6);
  group.add(sock);

  // --- Base-yard details ------------------------------------------------------
  const tarmac = new THREE.MeshStandardMaterial({ color: 0x57544d, roughness: 0.98, metalness: 0 });
  const sandbag = new THREE.MeshStandardMaterial({ color: 0x9a8a63, roughness: 0.98 });
  const tan = new THREE.MeshStandardMaterial({ color: 0x8f7c52, roughness: 0.9 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.92 });
  const barrier = new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 0.95 });

  // Worn tarmac apron the pad sits on, so the base reads as a cleared yard.
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(27, 27.6, 0.16, 48), tarmac);
  yard.position.y = 0.08;
  yard.receiveShadow = true;
  group.add(yard);

  // Perimeter fence: a ring of posts with two thin rails.
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x4c4f4a, roughness: 0.6, metalness: 0.5 });
  const fenceR = 26;
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 2.4, 6);
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const post = new THREE.Mesh(postGeo, fenceMat);
    post.position.set(Math.cos(a) * fenceR, 1.2, Math.sin(a) * fenceR);
    post.castShadow = true;
    group.add(post);
  }
  const railGeo = new THREE.TorusGeometry(fenceR, 0.04, 5, 84);
  for (const ry of [1.0, 1.9]) {
    const rail = new THREE.Mesh(railGeo, fenceMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = ry;
    group.add(rail);
  }

  // Conex shipping containers.
  const conexGeo = new THREE.BoxGeometry(6.4, 2.6, 2.5);
  const conex1 = new THREE.Mesh(conexGeo, olive);
  conex1.position.set(20, 1.4, -2);
  const conex2 = new THREE.Mesh(conexGeo, tan);
  conex2.position.set(20, 1.4, 1);
  for (const c of [conex1, conex2]) {
    c.castShadow = true;
    c.receiveShadow = true;
    group.add(c);
  }

  // A small stack of supply crates.
  const crateGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6b3f, roughness: 0.9 });
  for (const [cx, cy, cz] of [[12.5, 0.85, -9], [14.2, 0.85, -9], [13.3, 2.45, -9]]) {
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(cx, cy, cz);
    crate.castShadow = true;
    crate.receiveShadow = true;
    group.add(crate);
  }

  // Floodlight tower.
  const flood = new THREE.Group();
  const floodPole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 12, 8), metal);
  floodPole.position.y = 6;
  floodPole.castShadow = true;
  const floodHead = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.5), darkConcrete);
  floodHead.position.set(0, 11.6, 0.5);
  const floodLensMat = new THREE.MeshStandardMaterial({ color: 0x2a261a, emissive: 0xfff0c0, emissiveIntensity: 0.5 });
  for (const lx of [-0.8, 0, 0.8]) {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.12), floodLensMat);
    lens.position.set(lx, 11.6, 0.78);
    flood.add(lens);
  }
  flood.add(floodPole, floodHead);
  flood.position.set(-15, 0, 16);
  group.add(flood);

  // A parked utility truck.
  const truck = new THREE.Group();
  const truckMat = new THREE.MeshStandardMaterial({ color: 0x4d5436, roughness: 0.7 });
  const bed = new THREE.Mesh(new THREE.BoxGeometry(7, 1.6, 3), truckMat);
  bed.position.set(0, 1.7, 0);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 3), truckMat);
  cab.position.set(3.1, 2.0, 0);
  truck.add(bed, cab);
  const wheelGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 12);
  for (const wx of [-2.2, 2.4]) {
    for (const wz of [-1.45, 1.45]) {
      const wheel = new THREE.Mesh(wheelGeo, tire);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.8, wz);
      truck.add(wheel);
    }
  }
  truck.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  truck.position.set(19, 0, 17);
  truck.rotation.y = -0.5;
  group.add(truck);

  // Jersey blast barriers lining the approach.
  const jerseyGeo = new THREE.BoxGeometry(3.2, 1.1, 0.7);
  for (const [jx, jz, jr] of [[-9, 21, 0.18], [-5.6, 21.4, 0.18], [8, 21, -0.18], [11.4, 20.5, -0.18]]) {
    const j = new THREE.Mesh(jerseyGeo, barrier);
    j.position.set(jx, 0.55, jz);
    j.rotation.y = jr;
    j.castShadow = true;
    j.receiveShadow = true;
    group.add(j);
  }

  // Sandbag revetment shielding the fuel drums.
  const bagGeo = new THREE.BoxGeometry(1.1, 0.5, 0.8);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 8; i++) {
      const bag = new THREE.Mesh(bagGeo, sandbag);
      bag.position.set(-22 + i * 1.05 + (row % 2) * 0.5, 0.25 + row * 0.5, -6.4);
      bag.castShadow = true;
      bag.receiveShadow = true;
      group.add(bag);
    }
  }

  addLabel(group, name, PAD_TOP + 5.5);

  return { group, beacons };
}

// `placements` is the scene's base layout: [{ name, x, z, rotationY }]. Each
// scene arranges (and rotates) its two bases differently.
export function buildBases(root, placements) {
  const beacons = [];

  for (const place of placements) {
    const b = buildOneBase(place.name);
    b.group.position.set(place.x, 0, place.z);
    b.group.rotation.y = place.rotationY ?? 0;
    root.add(b.group);
    beacons.push(...b.beacons);
  }

  return { beacons };
}
