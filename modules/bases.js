import * as THREE from 'three';
import { canyonCenterZ, WORLD } from './canyon.js';

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

  addLabel(group, name, PAD_TOP + 5.5);

  return { group, beacons };
}

export function buildBases(root) {
  const beacons = [];

  const a = buildOneBase('BASE ALPHA');
  a.group.position.set(WORLD.baseAx, 0, canyonCenterZ(WORLD.baseAx));
  root.add(a.group);
  beacons.push(...a.beacons);

  const b = buildOneBase('BASE BRAVO');
  b.group.position.set(WORLD.baseBx, 0, canyonCenterZ(WORLD.baseBx));
  b.group.rotation.y = Math.PI;
  root.add(b.group);
  beacons.push(...b.beacons);

  return { beacons };
}
