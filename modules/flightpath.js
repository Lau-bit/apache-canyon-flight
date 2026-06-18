import * as THREE from 'three';
import { canyonCenterZ, canyonHalfWidth, terrainHeight, WORLD } from './canyon.js';

// Resting height of the helicopter group origin when sat on a base pad.
export const PAD_REST_Y = 4.6;
// Altitude the helicopter hovers at over a pad before translating / after the
// turn-around. The spline ends here so the vertical takeoff/landing transition
// (handled in the flight state machine) is continuous with the cruise route.
export const HOVER_ALT = PAD_REST_Y + 12;

// Builds an open A->B spline that threads the canyon: lifts off Base A, weaves
// between the walls at cruise altitude, then settles onto Base B.
export class FlightPath {
  constructor() {
    const waypoints = [];
    const xStart = WORLD.baseAx;
    const xEnd = WORLD.baseBx;
    const span = xEnd - xStart;
    const count = 26;

    for (let i = 0; i <= count; i++) {
      const f = i / count;
      const x = xStart + span * f;
      const cz = canyonCenterZ(x);
      const hw = canyonHalfWidth(x);

      // Slalom inside the corridor (kept clear of the walls).
      const slalom = Math.sin(f * Math.PI * 5 + 0.6) * Math.min(16, hw * 0.55);
      const z = cz + slalom;

      // Altitude profile: climb out of the hover, cruise with rolling
      // dips/climbs, ease back down to the far hover point.
      let y;
      const rampIn = THREE.MathUtils.smoothstep(f, 0.0, 0.12);
      const rampOut = 1 - THREE.MathUtils.smoothstep(f, 0.88, 1.0);
      const climb = Math.min(rampIn, rampOut);
      const cruise = 30 + 11 * Math.sin(f * Math.PI * 3.2 + 0.4) + 5 * Math.sin(f * Math.PI * 7);
      y = HOVER_ALT + (cruise - HOVER_ALT) * climb;

      // Never clip the terrain.
      const ground = terrainHeight(x, z);
      y = Math.max(y, ground + 9);

      waypoints.push(new THREE.Vector3(x, y, z));
    }

    // Pin both ends to the hover point directly above each pad.
    waypoints[0].set(xStart, HOVER_ALT, canyonCenterZ(xStart));
    waypoints[waypoints.length - 1].set(xEnd, HOVER_ALT, canyonCenterZ(xEnd));

    this.curve = new THREE.CatmullRomCurve3(waypoints, false, 'centripetal', 0.5);
    this.curve.arcLengthDivisions = 3000;
    this.totalLength = this.curve.getLength();
    this.waypoints = waypoints;

    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  // Frame at an absolute distance (metres) along the route.
  getFrameAtDistance(distance) {
    const d = THREE.MathUtils.clamp(distance, 0, this.totalLength);
    const u = d / this.totalLength;
    const point = this.curve.getPointAt(u, this._p).clone();
    const tangent = this.curve.getTangentAt(u, this._t).clone().normalize();
    const flat = new THREE.Vector3(tangent.x, 0, tangent.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    flat.normalize();
    const lateral = new THREE.Vector3(-flat.z, 0, flat.x);
    const heading = Math.atan2(flat.x, flat.z);
    return { u, point, tangent, flat, lateral, heading };
  }

  getStart() {
    return this.getFrameAtDistance(0);
  }

  getEnd() {
    return this.getFrameAtDistance(this.totalLength);
  }
}
