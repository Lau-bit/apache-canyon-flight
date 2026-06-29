import { buildCanyon, canyonCenterZ, canyonHalfWidth, terrainHeight, WORLD } from './canyon.js';
import { buildSurroundings } from './surroundings.js';
import { buildPlains, plainsCenterZ, plainsHalfWidth, plainsHeight, PLAINS } from './plains.js';
import { buildSeaTerrain, buildSeaBases, seaCenterZ, seaHalfWidth, seaHeight, SEA } from './sea.js';
import { buildAssault } from './assault.js';
import { FlightPath } from './flightpath.js';

// A scene bundles everything that differs between worlds: how the ground is
// built, where the two bases sit, the height field the flight path / heli use,
// and an optional lighting tweak layered over the time-of-day preset.

function heading(dx, dz) {
  return Math.atan2(dx, dz);
}

export const SCENES = [
  {
    id: 'canyon',
    label: 'Canyon corridor',
    buildTerrain(group, detail) {
      return buildCanyon(group, { detail });
    },
    buildStatic(group) {
      buildSurroundings(group);
    },
    basePlacements() {
      return [
        { name: 'BASE ALPHA', x: WORLD.baseAx, z: canyonCenterZ(WORLD.baseAx), rotationY: 0 },
        { name: 'BASE BRAVO', x: WORLD.baseBx, z: canyonCenterZ(WORLD.baseBx), rotationY: Math.PI },
      ];
    },
    height: terrainHeight,
    makePath() {
      return new FlightPath({
        baseAx: WORLD.baseAx,
        baseBx: WORLD.baseBx,
        centerZ: canyonCenterZ,
        halfWidth: canyonHalfWidth,
        height: terrainHeight,
      });
    },
    cameraStartX: WORLD.baseAx,
    // Canyon keeps the raw time-of-day preset.
  },
  {
    id: 'assault',
    label: 'Canyon assault',
    buildTerrain(group, detail) {
      return buildCanyon(group, { detail });
    },
    buildStatic() {
      // Installations, endpoint pads, and the tank column are all placed by the
      // custom buildBases hook below (which also returns the live-update world).
    },
    buildBases(group) {
      return buildAssault(group);
    },
    basePlacements() {
      // Used only by makePath(): the FOB -> objective run along the corridor.
      return [
        { name: 'FOB ALPHA', x: WORLD.baseAx, z: canyonCenterZ(WORLD.baseAx), rotationY: 0 },
        { name: 'OBJ BRAVO', x: WORLD.baseBx, z: canyonCenterZ(WORLD.baseBx), rotationY: Math.PI },
      ];
    },
    height: terrainHeight,
    makePath() {
      return new FlightPath({
        baseAx: WORLD.baseAx,
        baseBx: WORLD.baseBx,
        centerZ: canyonCenterZ,
        halfWidth: canyonHalfWidth,
        height: terrainHeight,
      });
    },
    cameraStartX: WORLD.baseAx,
    // A hot, dusty gun-run light: warmer haze pulled in a little closer.
    tuneLighting(L) {
      L.fog.color = 0xc9b6a0;
      L.fog.near = Math.max(60, L.fog.near - 10);
      L.hemi.ground = 0x6a4a30;
      L.ambient += 0.04;
    },
  },
  {
    id: 'plains',
    label: 'Open plains',
    buildTerrain(group, detail) {
      return buildPlains(group, { detail });
    },
    buildStatic() {
      // The plains are one massive ground sheet — no surrounding back-country.
    },
    basePlacements() {
      const az = plainsCenterZ(PLAINS.baseAx);
      const bz = plainsCenterZ(PLAINS.baseBx);
      // Staggered + angled rather than the canyon's head-on pair: each base is
      // rotated to roughly face the other across the open ground.
      return [
        { name: 'BASE ALPHA', x: PLAINS.baseAx, z: az, rotationY: heading(PLAINS.baseBx - PLAINS.baseAx, bz - az) + 0.5 },
        { name: 'BASE BRAVO', x: PLAINS.baseBx, z: bz, rotationY: heading(PLAINS.baseAx - PLAINS.baseBx, az - bz) - 0.5 },
      ];
    },
    height: plainsHeight,
    makePath() {
      return new FlightPath({
        baseAx: PLAINS.baseAx,
        baseBx: PLAINS.baseBx,
        centerZ: plainsCenterZ,
        halfWidth: plainsHalfWidth,
        height: plainsHeight,
        cruiseBase: 36,
        cruiseWave: 8,
        slalomCount: 2,
        slalomMax: 60,
      });
    },
    cameraStartX: PLAINS.baseAx,
    // Flatter, cooler, wide-open light with a far horizon.
    tuneLighting(L) {
      L.fog.near = Math.max(L.fog.near, 360);
      L.fog.far = 1600;
      L.hemi.intensity *= 1.3;
      L.hemi.sky = 0xcfe4ff;
      L.ambient += 0.08;
      L.sun.intensity *= 0.92;
    },
  },
  {
    id: 'sea',
    label: 'Open sea',
    buildTerrain(group, detail) {
      return buildSeaTerrain(group, { detail });
    },
    buildStatic() {
      // The carrier + island are built by the custom buildBases hook below.
    },
    // The carrier and the island ARE the two bases, so the sea scene supplies
    // its own base builder instead of the generic land bases.
    buildBases(group) {
      return buildSeaBases(group);
    },
    basePlacements() {
      // Only used by makePath() here; the actual structures are placed by
      // buildBases(). Kept consistent so the route threads carrier -> island.
      return [
        { name: 'CVN ALPHA', x: SEA.baseAx, z: seaCenterZ(SEA.baseAx), rotationY: 0 },
        { name: 'BASE BRAVO', x: SEA.baseBx, z: seaCenterZ(SEA.baseBx), rotationY: Math.PI },
      ];
    },
    height: seaHeight,
    makePath() {
      return new FlightPath({
        baseAx: SEA.baseAx,
        baseBx: SEA.baseBx,
        centerZ: seaCenterZ,
        halfWidth: seaHalfWidth,
        height: seaHeight,
        cruiseBase: 40,
        cruiseWave: 9,
        slalomCount: 2,
        slalomMax: 70,
      });
    },
    cameraStartX: SEA.baseAx,
    // Bright, hazy maritime light with a far, soft horizon.
    tuneLighting(L) {
      L.fog.near = Math.max(L.fog.near, 320);
      L.fog.far = 1700;
      L.fog.color = 0xbcd0dc;
      L.hemi.intensity *= 1.25;
      L.hemi.sky = 0xbfe0ff;
      L.hemi.ground = 0x29506a;
      L.ambient += 0.06;
    },
  },
];

export function getScene(id) {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}
