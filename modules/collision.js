import * as THREE from 'three';

// ---------------------------------------------------------------------------
// A deliberately simple collision world for the gameplay levels. It keeps two
// registries:
//
//   * statics  — upright cylinders standing in for buildings, towers, turrets,
//                boulders, etc. Each has a horizontal radius and a vertical span
//                [bottom, top] so an aircraft can clear a low bunker but is
//                walled off by a tall tower.
//   * units    — dynamic movers (enemy vehicles). They get pushed out of statics,
//                each other, and the terrain every frame by their own updater.
//
// Everything is resolved as horizontal circles + a terrain floor — no meshes,
// no broadphase. That is plenty for a few dozen colliders and keeps the player
// craft, the enemy column, and the props from passing through one another.
// ---------------------------------------------------------------------------

export class CollisionWorld {
  constructor(heightFn = () => 0) {
    this.heightFn = heightFn;
    this.statics = [];
    this.units = [];
  }

  // Add an upright cylinder collider. `bottom`/`top` default to an effectively
  // infinite column (a wall you cannot fly over).
  addCylinder(x, z, radius, bottom = -1e6, top = 1e6) {
    const c = { x, z, radius, bottom, top };
    this.statics.push(c);
    return c;
  }

  addUnit(unit) {
    this.units.push(unit);
    return unit;
  }

  // Push a horizontal circle (centred on `pos`, radius `radius`, at height
  // pos.y) out of every overlapping static cylinder. Mutates `pos`; if `vel` is
  // given, cancels the velocity component driving into each wall so the mover
  // slides along it instead of jittering. Returns true if anything was hit.
  resolveStatics(pos, radius, vel = null) {
    let hit = false;
    for (const s of this.statics) {
      // Only collide where the column actually exists vertically — a margin lets
      // a craft skim just over a roof without clipping its edge.
      if (pos.y > s.top + 1.2 || pos.y < s.bottom) continue;
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      const minDist = s.radius + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;
      const d = Math.sqrt(d2) || 1e-4;
      const nx = dx / d;
      const nz = dz / d;
      const push = minDist - d;
      pos.x += nx * push;
      pos.z += nz * push;
      if (vel) {
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
      }
      hit = true;
    }
    return hit;
  }

  // Separate the dynamic units from each other (each pushed half the overlap).
  // Cheap O(n^2) — there are only a handful of units.
  separateUnits() {
    const u = this.units;
    for (let i = 0; i < u.length; i++) {
      const a = u[i];
      if (a.dead) continue;
      for (let j = i + 1; j < u.length; j++) {
        const b = u[j];
        if (b.dead) continue;
        const dx = a.pos.x - b.pos.x;
        const dz = a.pos.z - b.pos.z;
        const minDist = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (minDist - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        a.pos.x += nx * push; a.pos.z += nz * push;
        b.pos.x -= nx * push; b.pos.z -= nz * push;
      }
    }
  }
}
