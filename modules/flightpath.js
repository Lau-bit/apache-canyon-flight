import * as THREE from 'three';

// Resting height of the helicopter group origin when sat on a base pad.
export const PAD_REST_Y = 4.6;
// Altitude the helicopter hovers at over a pad before translating / after the
// turn-around. The spline ends here so the vertical takeoff/landing transition
// (handled in the flight state machine) is continuous with the cruise route.
export const HOVER_ALT = PAD_REST_Y + 12;

// Builds an open A->B spline between two bases. The scene supplies its own
// centreline meander, corridor half-width and ground height field, so the same
// path generator threads a winding canyon or sweeps over open plains.
export class FlightPath {
  constructor({
    baseAx,
    baseBx,
    centerZ,
    halfWidth,
    height,
    hoverAlt = HOVER_ALT,
    cruiseBase = 30,
    cruiseWave = 11,
    slalomCount = 5,
    slalomMax = 16,
    clearance = 9,
  }) {
    const waypoints = [];
    const xStart = baseAx;
    const xEnd = baseBx;
    const span = xEnd - xStart;
    const count = 26;

    for (let i = 0; i <= count; i++) {
      const f = i / count;
      const x = xStart + span * f;
      const cz = centerZ(x);
      const hw = halfWidth(x);

      // Slalom inside the corridor (kept clear of the walls).
      const slalom = Math.sin(f * Math.PI * slalomCount + 0.6) * Math.min(slalomMax, hw * 0.55);
      const z = cz + slalom;

      // Altitude profile: climb out of the hover, cruise with rolling
      // dips/climbs, ease back down to the far hover point.
      let y;
      const rampIn = THREE.MathUtils.smoothstep(f, 0.0, 0.12);
      const rampOut = 1 - THREE.MathUtils.smoothstep(f, 0.88, 1.0);
      const climb = Math.min(rampIn, rampOut);
      const cruise = cruiseBase + cruiseWave * Math.sin(f * Math.PI * 3.2 + 0.4) + 5 * Math.sin(f * Math.PI * 7);
      y = hoverAlt + (cruise - hoverAlt) * climb;

      // Never clip the terrain.
      const ground = height(x, z);
      y = Math.max(y, ground + clearance);

      waypoints.push(new THREE.Vector3(x, y, z));
    }

    // Pin both ends to the hover point directly above each pad.
    waypoints[0].set(xStart, hoverAlt, centerZ(xStart));
    waypoints[waypoints.length - 1].set(xEnd, hoverAlt, centerZ(xEnd));

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
