import * as THREE from 'three';
import { terrainHeight } from './canyon.js';
import { PAD_REST_Y } from './flightpath.js';

// Model convention: nose points +Z, up is +Y, tail boom runs to -Z.

const OLIVE = 0x464f30;
const OLIVE_DARK = 0x363d24;
const GUNMETAL = 0x2b2e2c;
const GLASS = 0x10201c;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0.18,
    ...opts,
  });
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, seg, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---- Apache model builder ----
function buildApache() {
  const group = new THREE.Group();

  const oliveMat = mat(OLIVE, { roughness: 0.78 });
  const oliveDarkMat = mat(OLIVE_DARK, { roughness: 0.8 });
  const metalMat = mat(GUNMETAL, { roughness: 0.5, metalness: 0.7 });
  const glassMat = new THREE.MeshStandardMaterial({ color: GLASS, roughness: 0.18, metalness: 0.3 });
  const blackMat = mat(0x16181a, { roughness: 0.85, metalness: 0.1 });
  const tipMat = mat(0xd8c23a, { roughness: 0.5 });

  // --- Fuselage ---
  const body = box(1.5, 1.5, 6.4, oliveMat, 0, 0.1, 0.2);
  group.add(body);

  // Belly keel.
  group.add(box(1.2, 0.7, 5.6, oliveDarkMat, 0, -0.78, 0.1));

  // Nose taper.
  const nose = box(1.2, 1.1, 1.6, oliveMat, 0, -0.05, 3.4);
  nose.scale.set(1, 1, 1);
  group.add(nose);
  // Sensor turrets (TADS / PNVS) on the nose tip.
  const tads = cyl(0.4, 0.4, 0.6, 12, metalMat, 0, -0.36, 4.2);
  tads.rotation.x = Math.PI / 2;
  group.add(tads);
  const pnvs = cyl(0.3, 0.3, 0.5, 12, metalMat, 0, 0.25, 4.2);
  pnvs.rotation.x = Math.PI / 2;
  group.add(pnvs);

  // --- Tandem stepped canopy (gunner front-low, pilot rear-high) ---
  const gunnerCanopy = box(1.05, 0.85, 1.5, glassMat, 0, 0.7, 2.35);
  group.add(gunnerCanopy);
  const pilotCanopy = box(1.1, 1.0, 1.6, glassMat, 0, 1.0, 0.85);
  group.add(pilotCanopy);
  // Canopy framing.
  group.add(box(1.12, 0.08, 1.55, oliveDarkMat, 0, 1.15, 2.35));
  group.add(box(1.16, 0.08, 1.65, oliveDarkMat, 0, 1.52, 0.85));

  // --- Chin gun (M230 30mm) ---
  const gunMount = box(0.5, 0.4, 0.5, metalMat, 0, -0.85, 3.1);
  group.add(gunMount);
  const barrel = cyl(0.08, 0.08, 1.6, 8, blackMat, 0, -0.95, 3.9);
  barrel.rotation.x = Math.PI / 2;
  group.add(barrel);

  // --- Stub wings + pylons + ordnance ---
  const wing = box(6.2, 0.22, 1.5, oliveMat, 0, 0.15, -0.4);
  group.add(wing);
  for (const side of [-1, 1]) {
    // Inner pylon: Hellfire quad rack.
    const innerPylon = box(0.3, 0.5, 0.9, oliveDarkMat, side * 1.4, -0.25, -0.4);
    group.add(innerPylon);
    const rack = box(0.7, 0.7, 1.7, oliveDarkMat, side * 1.4, -0.7, -0.4);
    group.add(rack);
    for (let r = 0; r < 4; r++) {
      const mx = side * 1.4 + (r % 2 ? 0.18 : -0.18);
      const my = -0.55 + (r < 2 ? 0.18 : -0.18);
      const missile = cyl(0.08, 0.08, 1.5, 7, blackMat, mx, my, -0.4);
      missile.rotation.x = Math.PI / 2;
      group.add(missile);
    }
    // Outer pylon: Hydra rocket pod.
    const outerPylon = box(0.3, 0.45, 0.8, oliveDarkMat, side * 2.7, -0.2, -0.4);
    group.add(outerPylon);
    const pod = cyl(0.42, 0.42, 1.8, 14, oliveDarkMat, side * 2.7, -0.6, -0.3);
    pod.rotation.x = Math.PI / 2;
    group.add(pod);
    const podFace = cyl(0.4, 0.4, 0.1, 14, blackMat, side * 2.7, -0.6, 0.6);
    podFace.rotation.x = Math.PI / 2;
    group.add(podFace);
  }

  // --- Engine nacelles ---
  for (const side of [-1, 1]) {
    const nacelle = cyl(0.55, 0.6, 2.4, 14, oliveDarkMat, side * 0.85, 0.85, -0.7);
    nacelle.rotation.x = Math.PI / 2;
    group.add(nacelle);
    const exhaust = cyl(0.4, 0.5, 0.6, 12, metalMat, side * 0.95, 0.85, -2.0);
    exhaust.rotation.x = Math.PI / 2;
    group.add(exhaust);
  }

  // --- Tail boom ---
  const boom = cyl(0.32, 0.62, 5.6, 12, oliveMat, 0, 0.55, -4.6);
  boom.rotation.x = Math.PI / 2;
  group.add(boom);

  // Vertical tail fin (swept).
  const fin = box(0.22, 2.0, 1.7, oliveMat, 0, 1.35, -7.0);
  fin.rotation.x = -0.32;
  group.add(fin);
  // Horizontal stabilator.
  const stab = box(3.4, 0.16, 1.0, oliveMat, 0, 0.5, -6.7);
  group.add(stab);

  // --- Main rotor ---
  const mast = cyl(0.18, 0.22, 0.8, 10, metalMat, 0, 1.75, -0.3);
  group.add(mast);
  const hub = cyl(0.45, 0.45, 0.35, 10, metalMat, 0, 2.1, -0.3);
  group.add(hub);

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 2.2, -0.3);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1d2022, roughness: 0.7, metalness: 0.1, transparent: true, opacity: 1 });
  for (let i = 0; i < 4; i++) {
    const bladeGroup = new THREE.Group();
    bladeGroup.rotation.y = (i / 4) * Math.PI * 2;
    const blade = box(0.42, 0.07, 7.0, bladeMat, 0, 0, 3.4);
    blade.castShadow = true;
    bladeGroup.add(blade);
    const tip = box(0.42, 0.075, 0.5, tipMat, 0, 0, 6.7);
    bladeGroup.add(tip);
    mainRotor.add(bladeGroup);
  }
  group.add(mainRotor);

  const mainBlur = new THREE.Mesh(
    new THREE.CircleGeometry(7.0, 40),
    new THREE.MeshBasicMaterial({ color: 0x9aa0a4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  mainBlur.rotation.x = -Math.PI / 2;
  mainBlur.position.set(0, 2.25, -0.3);
  group.add(mainBlur);

  // --- Tail rotor (left side of fin, spins about X) ---
  const tailRotor = new THREE.Group();
  tailRotor.position.set(-0.35, 1.5, -7.1);
  const tailBladeMat = new THREE.MeshStandardMaterial({ color: 0x1d2022, roughness: 0.7, transparent: true, opacity: 1 });
  for (let i = 0; i < 4; i++) {
    const bg = new THREE.Group();
    bg.rotation.x = (i / 4) * Math.PI * 2;
    const blade = box(0.12, 1.5, 0.28, tailBladeMat, 0, 0.75, 0);
    bg.add(blade);
    tailRotor.add(bg);
  }
  group.add(tailRotor);

  const tailBlur = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x9aa0a4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  tailBlur.position.set(-0.45, 1.5, -7.1);
  tailBlur.rotation.y = Math.PI / 2;
  group.add(tailBlur);

  // --- Landing gear (taildragger) ---
  for (const side of [-1, 1]) {
    const strut = cyl(0.07, 0.07, 1.2, 6, metalMat, side * 1.0, -1.0, 0.6);
    strut.rotation.z = side * 0.3;
    group.add(strut);
    const wheel = cyl(0.32, 0.32, 0.28, 12, blackMat, side * 1.25, -1.5, 0.6);
    wheel.rotation.z = Math.PI / 2;
    group.add(wheel);
  }
  const tailStrut = cyl(0.05, 0.05, 0.8, 6, metalMat, 0, -0.6, -6.6);
  group.add(tailStrut);
  const tailWheel = cyl(0.2, 0.2, 0.18, 10, blackMat, 0, -1.0, -6.6);
  tailWheel.rotation.z = Math.PI / 2;
  group.add(tailWheel);

  // Navigation strobe.
  const strobeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 1.2 });
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), strobeMat);
  strobe.position.set(0, 2.5, -0.3);
  group.add(strobe);

  return { group, mainRotor, tailRotor, mainBlur, tailBlur, bladeMat, tailBladeMat, strobeMat };
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

function easeInOut(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

export class Helicopter {
  constructor(path) {
    this.path = path;
    const built = buildApache();
    this.group = built.group;
    this.parts = built;

    // Flight state. Phases: HOLD (on pad) -> DEPART (vertical lift) -> TURN ->
    // CRUISE/APPROACH (translate) -> LAND (vertical descent) -> HOLD ...
    this.dist = 0;
    this.dir = 1; // travel direction: +1 toward Bravo, -1 toward Alpha
    this.vel = 0;
    this.currentSpeed = 0;
    this.cruiseSpeed = 28;
    this.autoLoop = true;
    this.phase = 'HOLD';
    this.padRestY = PAD_REST_Y;

    // Sequence timers / flags.
    this.holdTimer = 1.5;     // initial pre-flight pause on the pad
    this.holdDuration = 3.0;  // pause after each landing
    this.liftDuration = 3.0;  // pad -> hover climb time
    this.landDuration = 3.4;  // hover -> pad descent time
    this.liftT = 0;
    this.landT = 0;
    this.needTurn = false;    // turn 180 after each landing

    // Attitude with inertia.
    this.yaw = 0;
    this.yawVel = 0;
    this.pitch = 0;
    this.roll = 0;
    this.maxYawRate = 0.85;   // rad/s — limits how fast the nose can swing
    this.maxBank = 0.6;       // rad — believable max bank angle
    this._bankSignal = 0;     // anticipated turn rate (rad/s) driving the bank
    this.maxLean = 0.22;      // rad — nose-down lean at high airspeed

    // Rotor / effects.
    this.rotorRpm = 0;
    this.rotorAngle = 0;
    this.tailAngle = 0;
    this.bobPhase = 0;
    this.strobePhase = 0;

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._headingVec = new THREE.Vector3();
    this._posTarget = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._vy = 0;
    this._prevSpeed = 0;
    this._accel = 0;

    // Initialise sitting on Base Alpha, facing Bravo.
    const start = path.getStart();
    this.yaw = start.heading;
    this._posTarget.set(start.point.x, this.padRestY, start.point.z);
    this._prevPosY = this.padRestY;
    this.group.position.copy(this._posTarget);
  }

  setCruiseSpeed(v) {
    this.cruiseSpeed = THREE.MathUtils.clamp(Number(v) || 0, 0, 60);
  }

  setAutoLoop(on) {
    this.autoLoop = Boolean(on);
  }

  get destName() {
    const willFlip = this.phase === 'HOLD' && this.needTurn;
    const goingDir = willFlip ? -this.dir : this.dir;
    return goingDir > 0 ? 'BRAVO' : 'ALPHA';
  }

  get progress01() {
    return THREE.MathUtils.clamp(this.dist / this.path.totalLength, 0, 1);
  }

  get headingDeg() {
    let d = (this.yaw * 180) / Math.PI;
    d = ((d % 360) + 360) % 360;
    return d;
  }

  get altitudeAGL() {
    const p = this.group.position;
    return Math.max(0, p.y - terrainHeight(p.x, p.z) - 1.4);
  }

  get rangeToDestNm() {
    const len = this.path.totalLength;
    return this.dir > 0 ? len - this.dist : this.dist;
  }

  _travelHeading(frame) {
    const x = frame.flat.x * this.dir;
    const z = frame.flat.z * this.dir;
    return Math.atan2(x, z);
  }

  // Runs the takeoff/cruise/landing/turn state machine. Sets _posTarget,
  // _desiredYaw, currentSpeed and phase for this frame.
  _updateFlight(dt) {
    const len = this.path.totalLength;

    // Resume the loop if it was re-enabled while parked.
    if (this.phase === 'LANDED' && this.autoLoop) {
      this.phase = 'HOLD';
      this.holdTimer = 1.5;
      this.needTurn = true;
    }

    const endFrame = this.path.getFrameAtDistance(this.dist); // pad endpoint when parked
    const setPad = (y) => this._posTarget.set(endFrame.point.x, y, endFrame.point.z);
    const hoverY = endFrame.point.y;
    this._bankSignal = 0; // only cruise banks; pad phases stay level

    switch (this.phase) {
      case 'LANDED': {
        this.currentSpeed = 0;
        setPad(this.padRestY);
        this._desiredYaw = this.yaw;
        break;
      }
      case 'HOLD': {
        this.currentSpeed = 0;
        setPad(this.padRestY);
        this._desiredYaw = this.yaw;
        this.holdTimer -= dt;
        if (this.holdTimer <= 0) {
          if (this.needTurn) this.dir = -this.dir; // commit to the return leg
          this.phase = 'DEPART';
          this.liftT = 0;
        }
        break;
      }
      case 'DEPART': {
        this.currentSpeed = 0;
        this.liftT = Math.min(1, this.liftT + dt / this.liftDuration);
        setPad(THREE.MathUtils.lerp(this.padRestY, hoverY, easeInOut(this.liftT)));
        this._desiredYaw = this.yaw;
        if (this.liftT >= 1) this.phase = this.needTurn ? 'TURN' : 'CRUISE';
        break;
      }
      case 'TURN': {
        this.currentSpeed = 0;
        setPad(hoverY);
        this._desiredYaw = this._travelHeading(endFrame);
        const aligned = Math.abs(shortestAngle(this.yaw, this._desiredYaw)) < 0.05
          && Math.abs(this.yawVel) < 0.06;
        if (aligned) {
          this.needTurn = false;
          this.phase = 'CRUISE';
        }
        break;
      }
      case 'CRUISE':
      case 'APPROACH': {
        const distRemaining = this.dir > 0 ? len - this.dist : this.dist;
        // Brake to a slow approach crawl, but keep a floor so we actually
        // close the final stretch (a zero target would creep forever).
        const approachRamp = THREE.MathUtils.smoothstep(distRemaining, 5, 60);
        const targetSpeed = Math.max(this.cruiseSpeed * approachRamp, 4.0);
        const lambda = targetSpeed > this.vel ? 0.7 : 1.3;
        this.vel = Math.max(0, damp(this.vel, targetSpeed, lambda, dt));
        this.currentSpeed = this.vel;
        this.dist = THREE.MathUtils.clamp(this.dist + this.vel * this.dir * dt, 0, len);

        const frame = this.path.getFrameAtDistance(this.dist);
        this._posTarget.copy(frame.point);
        this._desiredYaw = this._travelHeading(frame);
        this.phase = distRemaining < 60 ? 'APPROACH' : 'CRUISE';

        // Anticipate the upcoming bend so the bank LEADS the heading change —
        // the helicopter rolls into the turn, then the nose follows.
        const lookahead = THREE.MathUtils.clamp(this.currentSpeed * 1.1, 8, 46);
        const aheadDist = THREE.MathUtils.clamp(this.dist + this.dir * lookahead, 0, len);
        const aheadHeading = this._travelHeading(this.path.getFrameAtDistance(aheadDist));
        const headingDelta = shortestAngle(this._desiredYaw, aheadHeading);
        const lookaheadTime = Math.max(lookahead / Math.max(this.currentSpeed, 1), 0.5);
        this._bankSignal = headingDelta / lookaheadTime;

        // Commit to landing once within a few units of the pad.
        if (distRemaining <= 4) {
          this.dist = this.dir > 0 ? len : 0;
          this.phase = 'LAND';
          this.landT = 0;
        }
        break;
      }
      case 'LAND': {
        this.vel = damp(this.vel, 0, 3, dt);
        this.currentSpeed = this.vel;
        this.landT = Math.min(1, this.landT + dt / this.landDuration);
        setPad(THREE.MathUtils.lerp(hoverY, this.padRestY, easeInOut(this.landT)));
        this._desiredYaw = this.yaw;
        if (this.landT >= 1) {
          if (this.autoLoop) {
            this.phase = 'HOLD';
            this.holdTimer = this.holdDuration;
            this.needTurn = true;
          } else {
            this.phase = 'LANDED';
          }
        }
        break;
      }
    }
  }

  update(dt, t) {
    // Spool rotors up to operating RPM and keep them there.
    this.rotorRpm = damp(this.rotorRpm, 1, 1.4, dt);
    this.rotorAngle += this.rotorRpm * 32 * dt;
    this.tailAngle += this.rotorRpm * 70 * dt;
    this.parts.mainRotor.rotation.y = this.rotorAngle;
    this.parts.tailRotor.rotation.x = this.tailAngle;

    const spin = THREE.MathUtils.smoothstep(this.rotorRpm, 0.3, 0.95);
    this.parts.mainBlur.material.opacity = spin * 0.34;
    this.parts.tailBlur.material.opacity = spin * 0.4;
    this.parts.bladeMat.opacity = 1 - spin * 0.62;
    this.parts.tailBladeMat.opacity = 1 - spin * 0.7;

    // Strobe.
    this.strobePhase += dt;
    this.parts.strobeMat.emissiveIntensity = (this.strobePhase % 1.1) < 0.1 ? 3.0 : 0.15;

    this._updateFlight(dt);

    // --- Heading with inertia (rate-limited, smoothed angular velocity) ---
    const yawErr = shortestAngle(this.yaw, this._desiredYaw);
    const desiredYawVel = THREE.MathUtils.clamp(yawErr * 1.8, -this.maxYawRate, this.maxYawRate);
    this.yawVel = damp(this.yawVel, desiredYawVel, 3.2, dt);
    this.yaw += this.yawVel * dt;
    this._headingVec.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // --- Speed-dependent attitude, damped for inertia ---
    // leanCurve: ~0 at low speed (level), ramps to 1 at high airspeed.
    const leanCurve = THREE.MathUtils.smoothstep(this.currentSpeed, 5, 34);

    // Bank from the ANTICIPATED turn (path lookahead) so the roll leads the
    // heading change. Snappier damping makes it read as the rotor doing work.
    const bankRaw = THREE.MathUtils.clamp(-this._bankSignal * 1.5, -this.maxBank, this.maxBank);
    const rollTarget = bankRaw * (0.2 + 0.8 * leanCurve);
    this.roll = damp(this.roll, rollTarget, 4.2, dt);

    // Pitch: steady nose-down lean with airspeed, PLUS a pronounced transient
    // nose-down when accelerating and nose-up when decelerating (so it visibly
    // tilts as it starts to move and noses up as it brakes), gentle nose-up
    // while climbing, and a nose-up flare during the landing descent.
    const vyRaw = (this._posTarget.y - this._prevPosY) / Math.max(dt, 1e-3);
    this._prevPosY = this._posTarget.y;
    this._vy = damp(this._vy, vyRaw, 4, dt);

    const accelRaw = (this.currentSpeed - this._prevSpeed) / Math.max(dt, 1e-3);
    this._prevSpeed = this.currentSpeed;
    this._accel = damp(this._accel, accelRaw, 5, dt);
    const accelPitch = THREE.MathUtils.clamp(this._accel * 0.045, -0.26, 0.26);

    const forwardLean = this.maxLean * leanCurve;
    const climbUp = -THREE.MathUtils.clamp(Math.max(this._vy, 0) * 0.02, 0, 0.1);
    const flare = this.phase === 'LAND' ? -0.09 : 0;
    const pitchTarget = forwardLean + accelPitch + climbUp + flare;
    this.pitch = damp(this.pitch, pitchTarget, 2.6, dt);

    // Subtle hover bob (fades out with speed) + faint rotor shimmer.
    this.bobPhase += dt * 1.6;
    const bob = Math.sin(this.bobPhase * 1.3) * 0.06 * (1 - leanCurve);
    const shimmer = Math.sin(t * 52) * 0.0016 * this.rotorRpm;

    this.group.position.copy(this._posTarget);
    this.group.position.y += bob;
    this._euler.set(this.pitch + shimmer, this.yaw, this.roll + shimmer, 'YXZ');
    this.group.quaternion.setFromEuler(this._euler);
  }

  getLeadFrame() {
    const point = this.group.position;
    const headingVec = this._headingVec;
    const lateral = new THREE.Vector3(-headingVec.z, 0, headingVec.x).normalize();
    return { point, headingVec, lateral };
  }

  // Cockpit eye pose in world space. look: 'forward'|'left'|'right'|'back'|'down'
  getCockpitPose(look = 'forward') {
    // Gunner seat, local space.
    this._eye.set(0, 0.55, 2.0).applyQuaternion(this.group.quaternion).add(this.group.position);

    let local;
    switch (look) {
      case 'left': local = new THREE.Vector3(-1, -0.1, 0.3); break;
      case 'right': local = new THREE.Vector3(1, -0.1, 0.3); break;
      case 'back': local = new THREE.Vector3(0, 0.1, -1); break;
      case 'down': local = new THREE.Vector3(0, -0.6, 0.7); break;
      default: local = new THREE.Vector3(0, -0.06, 1); break;
    }
    this._look.copy(local).applyQuaternion(this.group.quaternion).add(this._eye);
    return { eye: this._eye, lookAt: this._look };
  }
}
