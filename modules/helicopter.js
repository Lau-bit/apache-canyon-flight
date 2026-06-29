import * as THREE from 'three';
import { PAD_REST_Y } from './flightpath.js';

// Model convention: nose points +Z, up is +Y, tail boom runs to -Z.

const OLIVE = 0x7c8757;
const OLIVE_DARK = 0x5c6541;
const GUNMETAL = 0x565b57;
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

// A box reshaped for an aerodynamic, faceted read: the roof can be pulled in
// (topScale) and raked aft (topShiftZ) for a swept canopy, and the forward face
// can be narrowed/drooped (front*) for a pointed nose.
function sweptBox(w, h, d, material, x, y, z, opts = {}) {
  const { topScale = 1, topShiftZ = 0, frontScaleX = 1, frontScaleY = 1, frontShiftY = 0, botFrontShiftZ = 0 } = opts;
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let vx = p.getX(i);
    let vy = p.getY(i);
    let vz = p.getZ(i);
    if (vy > 0) {
      vx *= topScale;
      vz = vz * topScale + topShiftZ;
    } else if (vz > 0) {
      // Pull the lower-front edge back so a raked roof doesn't leave the bottom
      // sticking out as a wedge.
      vz += botFrontShiftZ;
    }
    if (vz > 0) {
      vx *= frontScaleX;
      vy = vy * frontScaleY + frontShiftY;
    }
    p.setXYZ(i, vx, vy, vz);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
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
  const metalMat = mat(GUNMETAL, { roughness: 0.55, metalness: 0.4 });
  // Cockpit "glass": opaque dark grey with a low-roughness sheen so the sun
  // glints off it like real canopy panes (no actual transparency).
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x4a515b, roughness: 0.16, metalness: 0.35 });
  const frameMat = mat(OLIVE_DARK, { roughness: 0.6, metalness: 0.25 });
  const blackMat = mat(0x35383b, { roughness: 0.85, metalness: 0.1 });
  const tipMat = mat(0xd8c23a, { roughness: 0.5 });

  // --- Fuselage ---
  // The forward fuselage tapers in toward the nose (narrower + lower at the
  // front) so it doesn't read as a hard box poking out around the cockpit.
  const body = sweptBox(1.5, 1.5, 6.4, oliveMat, 0, 0.1, 0.2, {
    frontScaleX: 0.68, frontScaleY: 0.62, frontShiftY: -0.16,
  });
  group.add(body);

  // Belly keel.
  group.add(box(1.2, 0.7, 5.6, oliveDarkMat, 0, -0.78, 0.1));

  // Pointed, drooping nose — narrows and noses down toward the sensor turret.
  const nose = sweptBox(1.24, 1.3, 2.0, oliveMat, 0, -0.04, 3.3, {
    frontScaleX: 0.42, frontScaleY: 0.5, frontShiftY: -0.2,
  });
  group.add(nose);
  // TADS / PNVS sensor turret: a rounded housing slung under the nose tip.
  const turretBase = cyl(0.34, 0.42, 0.5, 14, metalMat, 0, -0.16, 4.05);
  turretBase.rotation.x = Math.PI / 2;
  group.add(turretBase);
  const turret = new THREE.Mesh(new THREE.SphereGeometry(0.37, 16, 12), metalMat);
  turret.position.set(0, -0.16, 4.4);
  turret.scale.set(1, 0.92, 1.12);
  group.add(turret);
  // Smaller PNVS sight perched on top of the nose.
  const pnvs = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), metalMat);
  pnvs.position.set(0, 0.34, 4.2);
  pnvs.scale.set(1, 0.85, 1.1);
  group.add(pnvs);

  // --- Tandem stepped canopy (gunner front-low, pilot rear-high) ---
  // Each station is a dark-glass greenhouse whose roof is pulled in and raked
  // aft, so the windscreens slope and the silhouette reads swept rather than
  // boxy — like the Apache's flat-panel canopy.
  function sweptCanopy(cx, cy, cz, w, h, d, topScale, topShiftZ, botShiftZ = 0) {
    const c = new THREE.Group();
    c.position.set(cx, cy, cz);
    c.add(sweptBox(w, h, d, glassMat, 0, 0, 0, { topScale, topShiftZ, botFrontShiftZ: botShiftZ }));

    const fw = 0.06;
    // Base sill (trimmed to the lower front) + raked-back roof rail.
    c.add(box(w + 0.05, fw, d + botShiftZ + 0.05, frameMat, 0, -h / 2, botShiftZ / 2));
    c.add(box(w * topScale + 0.05, fw, d * topScale + 0.05, frameMat, 0, h / 2, topShiftZ));
    // A-pillars following the windscreen rake (centre mullion + side posts).
    const zBot = d / 2 + botShiftZ;
    const zTop = (d / 2) * topScale + topShiftZ;
    const rake = Math.atan2(zTop - zBot, h);
    const pillarLen = Math.hypot(h, zTop - zBot);
    for (const sx of [-0.46, 0, 0.46]) {
      const post = box(fw, pillarLen, fw, frameMat, sx * w, 0, (zBot + zTop) / 2);
      post.rotation.x = rake;
      c.add(post);
    }
    return c;
  }
  group.add(sweptCanopy(0, 0.68, 2.5, 0.98, 0.6, 1.55, 0.62, -0.42, -0.55)); // gunner: trimmed lower front
  group.add(sweptCanopy(0, 0.92, 1.0, 1.06, 0.82, 1.5, 0.74, -0.28)); // pilot: higher rear step
  // Roll-over frame arch at the step between the two cockpits.
  group.add(box(1.12, 0.12, 0.18, frameMat, 0, 1.05, 1.73));
  // Avionics spine sloping down from the pilot station back to the rotor mast.
  group.add(sweptBox(1.04, 0.58, 1.7, oliveMat, 0, 0.55, -0.4, { topScale: 0.78, topShiftZ: -0.12 }));

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

  // --- Tail boom (long, tapering aft, so the tail rotor sits clear of the
  // main-rotor disc instead of overlapping it) ---
  const boom = cyl(0.5, 0.34, 7.6, 12, oliveMat, 0, 0.55, -5.6);
  boom.rotation.x = Math.PI / 2;
  group.add(boom);

  // Vertical tail fin (tall, swept) — carries the tail rotor high up.
  const fin = box(0.24, 2.6, 1.5, oliveMat, 0, 1.7, -9.1);
  fin.rotation.x = -0.34;
  group.add(fin);
  // Horizontal stabilator: mounted low on the boom and forward of the tail
  // rotor, so the rotor disc no longer cuts through it.
  const stab = box(3.2, 0.16, 1.0, oliveMat, 0, 0.42, -8.0);
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
  tailRotor.position.set(-0.42, 2.35, -9.2);
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
  tailBlur.position.set(-0.52, 2.35, -9.2);
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
  // Tail wheel: strut runs from the underside of the boom down to the wheel so
  // it's actually attached rather than floating below the airframe.
  const tailStrut = cyl(0.05, 0.05, 0.8, 6, metalMat, 0, -0.2, -7.6);
  group.add(tailStrut);
  const tailWheel = cyl(0.22, 0.22, 0.2, 10, blackMat, 0, -0.6, -7.6);
  tailWheel.rotation.z = Math.PI / 2;
  group.add(tailWheel);

  // --- Mast-mounted fire-control radar (AN/APG-78 "Longbow") ---
  // The drum-shaped radome on a short pylon above the main rotor — the Apache's
  // signature top fixture. It rides on the fixed mast, so it sits in the static
  // airframe group and does NOT spin with the blades. (Replaces the old top
  // navigation strobe that used to occupy this spot.)
  const radarMat = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.82, metalness: 0.2 });
  const radomeY = 2.82;
  const radarPylon = cyl(0.1, 0.13, 0.55, 8, metalMat, 0, 2.52, -0.3);
  group.add(radarPylon);
  // Flared mast collar under the radome: a frustum wider at the top (where it
  // meets the drum) than at its base, so the mount splays out toward the radome.
  const radarCollar = cyl(0.36, 0.15, 0.34, 16, metalMat, 0, 2.47, -0.3);
  group.add(radarCollar);
  // Drum body + two flattened domed caps give the rounded-edge radome look.
  // Kept squat (half the old height) so it reads as the real Longbow's flat
  // drum — wider than it is tall.
  const radomeBody = cyl(0.54, 0.54, 0.17, 22, radarMat, 0, radomeY, -0.3);
  group.add(radomeBody);
  const radomeTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.54, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), radarMat);
  radomeTop.scale.set(1, 0.275, 1);
  radomeTop.position.set(0, radomeY + 0.085, -0.3);
  radomeTop.castShadow = true;
  group.add(radomeTop);
  const radomeBot = new THREE.Mesh(
    new THREE.SphereGeometry(0.54, 22, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), radarMat);
  radomeBot.scale.set(1, 0.275, 1);
  radomeBot.position.set(0, radomeY - 0.085, -0.3);
  group.add(radomeBot);

  // Red anticollision beacon, relocated to the top of the tail boom now that the
  // mast carries the radome (the real aircraft keeps a beacon back here too).
  const strobeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 1.2 });
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), strobeMat);
  strobe.position.set(0, 1.05, -5.6);
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
  constructor(path, heightFn = () => 0) {
    this.path = path;
    this.heightFn = heightFn;
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

    // Visual-attitude tuning (dev controls). These scale/smooth ONLY the
    // displayed bank & pitch of the airframe — never the flight path, the
    // hand-flying handling, or the world velocity. setVisualPhysics() overrides
    // them live from the dev settings panel.
    this.bankSensitivity = 1;  // multiplies the bank target angle
    this.bankLambda = 4.2;     // roll damping rate (higher = snappier, less lag)
    this.pitchSensitivity = 1; // multiplies the pitch target angle
    this.pitchLambda = 2.6;    // pitch damping rate

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
    this._landFromX = 0;
    this._landFromZ = 0;

    // Optional collision world (set per scene). When present, the airframe is
    // pushed out of the level's static obstacles each frame.
    this.collisionWorld = null;
    this.bodyRadius = 3.5;

    // --- Manual flight (experimental) ---
    this.manualControl = false;
    this.manualInput = { collective: 0, pitch: 0, roll: 0, yaw: 0 };
    this._mvel = new THREE.Vector3();   // world-space velocity while hand-flown
    this.manualMaxClimb = 18;           // m/s vertical at full collective
    this.manualAccel = 26;              // m/s^2 horizontal push from cyclic
    this.manualMaxTilt = 0.4;           // rad cyclic pitch tilt at full input
    this.manualTopSpeed = 18;           // m/s horizontal speed cap
    this.manualDecel = 1.5;             // drag rate (1/s) when the cyclic is released
    this.manualMoveDrag = 1.5;          // drag rate (1/s) while a cyclic input is held
    this.decelAnimation = false;        // sim-like nose-up flare while decelerating
    this.decelFlare = 0.34;             // rad — max nose-up/down flare angle on release
    this.manualFwdStick = 0;            // s — ramp-in time for forward accel ("sticky air")
    this.manualSideStick = 0;           // s — ramp-in time for sideways accel
    this.hoverVert = 0.06;              // m — vertical hover-bob amplitude
    this.hoverHoriz = 0;                // m — lateral hover-sway amplitude
    this._fwdSpool = 0;                 // 0..1 accel ramp state (forward)
    this._sideSpool = 0;                // 0..1 accel ramp state (sideways)
    this._upSpool = 0;                  // 0..1 climb ramp state (up only; down is immediate)

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

  setColliders(world) {
    this.collisionWorld = world || null;
  }

  setAutoLoop(on) {
    this.autoLoop = Boolean(on);
  }

  // Live-tune the VISUAL bank/pitch response from the dev panel. Inertia is a
  // settle time constant in seconds; the damping rate is its reciprocal, so a
  // larger inertia = a laggier, heavier-feeling tilt.
  setVisualPhysics({ bankSensitivity, bankInertia, pitchSensitivity, pitchInertia } = {}) {
    if (Number.isFinite(bankSensitivity)) this.bankSensitivity = bankSensitivity;
    if (Number.isFinite(pitchSensitivity)) this.pitchSensitivity = pitchSensitivity;
    if (Number.isFinite(bankInertia)) this.bankLambda = 1 / Math.max(bankInertia, 0.02);
    if (Number.isFinite(pitchInertia)) this.pitchLambda = 1 / Math.max(pitchInertia, 0.02);
  }

  // Live-tune the hand-flying motion model (dev panel). Inertia is a coast time
  // constant in seconds; the in-motion drag rate is its reciprocal, so larger
  // inertia = the aircraft holds its momentum longer. decelAnimation swaps the
  // arcadey input-driven pitch for a simulator-like deceleration flare.
  setManualPhysics({ topSpeed, accel, decel, inertia, decelAnimation, flareIntensity,
    fwdStick, sideStick, hoverVert, hoverHoriz } = {}) {
    if (Number.isFinite(topSpeed)) this.manualTopSpeed = topSpeed;
    if (Number.isFinite(accel)) this.manualAccel = accel;
    if (Number.isFinite(decel)) this.manualDecel = decel;
    if (Number.isFinite(inertia)) this.manualMoveDrag = 1 / Math.max(inertia, 0.05);
    if (Number.isFinite(flareIntensity)) this.decelFlare = flareIntensity;
    if (Number.isFinite(fwdStick)) this.manualFwdStick = fwdStick;
    if (Number.isFinite(sideStick)) this.manualSideStick = sideStick;
    if (Number.isFinite(hoverVert)) this.hoverVert = hoverVert;
    if (Number.isFinite(hoverHoriz)) this.hoverHoriz = hoverHoriz;
    if (decelAnimation !== undefined) this.decelAnimation = Boolean(decelAnimation);
  }

  // Toggle hand-flying. On enable, the manual integrator is seeded from the
  // current pose; on disable, the auto route is rejoined at the nearest point.
  setManualControl(on) {
    on = Boolean(on);
    if (on === this.manualControl) return;
    this.manualControl = on;
    if (on) {
      this._posTarget.copy(this.group.position);
      this._mvel.set(0, 0, 0);
      this.vel = 0;
      this._prevSpeed = 0;
      this._fwdSpool = 0;
      this._sideSpool = 0;
      this._upSpool = 0;
      this.phase = 'MANUAL';
    } else {
      this._resumeAuto();
    }
  }

  // Snap the auto state machine back onto the path at whatever point is closest
  // to where the pilot left the aircraft, then resume cruising.
  _resumeAuto() {
    const pos = this.group.position;
    const len = this.path.totalLength;
    const samples = 240;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= samples; i++) {
      const d = (i / samples) * len;
      const f = this.path.getFrameAtDistance(d);
      const dd = (f.point.x - pos.x) ** 2 + (f.point.z - pos.z) ** 2;
      if (dd < bestD) { bestD = dd; best = d; }
    }
    this.dist = best;
    this.vel = this.currentSpeed;
    this.needTurn = false;
    this.phase = 'CRUISE';
    this._prevPosY = pos.y;
  }

  // Hand-flown step: cyclic tilts the airframe and pushes it that way, the
  // collective sets a vertical rate, the pedals yaw the nose. Velocity carries
  // (with drag), so it coasts like a helicopter rather than stopping dead.
  _updateManual(dt) {
    const k = this.manualInput;
    this.phase = 'MANUAL';

    // Yaw pedals.
    const yawTarget = (k.yaw || 0) * this.maxYawRate;
    this.yawVel = damp(this.yawVel, yawTarget, 4, dt);
    this.yaw += this.yawVel * dt;
    this._headingVec.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // Cyclic → horizontal thrust along the body forward/right axes.
    const fwdX = this._headingVec.x;
    const fwdZ = this._headingVec.z;
    const rightX = fwdZ;
    const rightZ = -fwdX;
    const inFwd = k.pitch || 0;
    const inRight = k.roll || 0;
    const hasInput = inFwd !== 0 || inRight !== 0;

    // Initial-acceleration "stickiness": each axis ramps its thrust in from the
    // moment its input is pressed, so the airframe visibly pitches/banks before
    // speed builds (fakes a heavier, more advanced inertial model). A stick time
    // of 0 spools instantly = the plain full-thrust behaviour.
    this._fwdSpool = inFwd !== 0
      ? (this.manualFwdStick > 0 ? Math.min(1, this._fwdSpool + dt / this.manualFwdStick) : 1)
      : 0;
    this._sideSpool = inRight !== 0
      ? (this.manualSideStick > 0 ? Math.min(1, this._sideSpool + dt / this.manualSideStick) : 1)
      : 0;
    let fwdThrust = inFwd * this.manualAccel * this._fwdSpool;
    let sideThrust = inRight * this.manualAccel * this._sideSpool;
    // Clamp the COMBINED cyclic thrust to a single axis' worth so banking while
    // moving forward doesn't apply √2× the thrust (which, with drag settling
    // below the speed cap, made a diagonal run end up faster than straight). A
    // forward+bank input now tops out no faster than straight forward.
    const thrustMag = Math.hypot(fwdThrust, sideThrust);
    if (thrustMag > this.manualAccel) {
      const s = this.manualAccel / thrustMag;
      fwdThrust *= s;
      sideThrust *= s;
    }
    this._mvel.x += (fwdX * fwdThrust + rightX * sideThrust) * dt;
    this._mvel.z += (fwdZ * fwdThrust + rightZ * sideThrust) * dt;

    // Idle release decelerates at the deceleration rate; while a cyclic input is
    // held, the lighter in-motion drag (set by motion inertia) lets momentum
    // carry. Horizontal speed is then capped at the top-speed setting.
    const dragRate = hasInput ? this.manualMoveDrag : this.manualDecel;
    const hDrag = Math.exp(-dragRate * dt);
    this._mvel.x *= hDrag;
    this._mvel.z *= hDrag;
    let horizSpeed = Math.hypot(this._mvel.x, this._mvel.z);
    if (horizSpeed > this.manualTopSpeed) {
      const s = this.manualTopSpeed / horizSpeed;
      this._mvel.x *= s;
      this._mvel.z *= s;
      horizSpeed = this.manualTopSpeed;
    }

    // Attitude. Roll always banks into the cyclic input. Pitch is either the
    // arcadey input-driven nose-down (toggle off), or a simulator-like flare
    // (toggle on): while a fore/aft cyclic input is HELD the airframe stays
    // tilted into it (nose-down forward, nose-up aft); once the input is
    // RELEASED it pitches opposite to its travel to bleed off speed, easing
    // back to level as the aircraft coasts to a stop. Using signed forward
    // velocity (not speed magnitude) keeps the flare correct in reverse.
    this.roll = damp(this.roll, -inRight * this.maxBank * this.bankSensitivity, this.bankLambda, dt);
    const vFwd = this._mvel.x * fwdX + this._mvel.z * fwdZ;
    let pitchTarget;
    if (this.decelAnimation) {
      pitchTarget = inFwd !== 0
        ? inFwd * this.manualMaxTilt
        : -this.decelFlare * THREE.MathUtils.clamp(vFwd / Math.max(this.manualTopSpeed, 1), -1, 1);
      pitchTarget *= this.pitchSensitivity;
    } else {
      pitchTarget = inFwd * this.manualMaxTilt * this.pitchSensitivity;
    }
    this.pitch = damp(this.pitch, pitchTarget, this.pitchLambda, dt);

    // Collective → vertical rate. Climbing shares the forward "stickiness" so the
    // aircraft eases upward instead of leaping; descending stays immediate so a
    // down input feels like dropping/falling (no ramp).
    const collective = k.collective || 0;
    this._upSpool = collective > 0
      ? (this.manualFwdStick > 0 ? Math.min(1, this._upSpool + dt / this.manualFwdStick) : 1)
      : 0;
    const climbTarget = collective > 0
      ? collective * this.manualMaxClimb * this._upSpool
      : collective * this.manualMaxClimb;
    this._mvel.y = damp(this._mvel.y, climbTarget, 3, dt);

    // Integrate position on the persistent target vector (no bob feedback).
    const p = this._posTarget;
    p.x += this._mvel.x * dt;
    p.y += this._mvel.y * dt;
    p.z += this._mvel.z * dt;

    // Keep clear of terrain/sea, and below a soft ceiling.
    const minY = this.heightFn(p.x, p.z) + 2.4;
    if (p.y < minY) { p.y = minY; if (this._mvel.y < 0) this._mvel.y = 0; }
    if (p.y > 320) { p.y = 320; if (this._mvel.y > 0) this._mvel.y = 0; }

    // Push out of level obstacles (towers, hangars, the HQ...). Cancels the
    // velocity driving into the wall so the airframe slides along it.
    this.collisionWorld?.resolveStatics(p, this.bodyRadius, this._mvel);

    this.currentSpeed = Math.hypot(this._mvel.x, this._mvel.z);
    this.vel = this.currentSpeed;
    this._prevPosY = p.y;
    this._prevSpeed = this.currentSpeed;
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
    return Math.max(0, p.y - this.heightFn(p.x, p.z) - 1.4);
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

        // Commit to landing once within a few units of the pad. Remember where
        // we were so the descent slides smoothly onto the pad instead of
        // teleporting (which used to snap every following camera).
        if (distRemaining <= 4) {
          this._landFromX = frame.point.x;
          this._landFromZ = frame.point.z;
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
        const e = easeInOut(this.landT);
        this._posTarget.set(
          THREE.MathUtils.lerp(this._landFromX, endFrame.point.x, e),
          THREE.MathUtils.lerp(hoverY, this.padRestY, e),
          THREE.MathUtils.lerp(this._landFromZ, endFrame.point.z, e),
        );
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

    // Hand-flown mode runs its own integrator and shares only the finalize step.
    if (this.manualControl) {
      this._updateManual(dt);
      // Idle hover drift: a vertical bob plus a slow lateral sway (off the up/down
      // axis), both fading out as the aircraft picks up speed.
      this.bobPhase += dt * 1.6;
      const hoverFade = 1 - THREE.MathUtils.smoothstep(this.currentSpeed, 5, 34);
      this.group.position.copy(this._posTarget);
      this.group.position.x += Math.sin(this.bobPhase * 0.9) * this.hoverHoriz * hoverFade;
      this.group.position.y += Math.sin(this.bobPhase * 1.3) * this.hoverVert * hoverFade;
      this.group.position.z += Math.cos(this.bobPhase * 1.1) * this.hoverHoriz * hoverFade;
      this._euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
      this.group.quaternion.setFromEuler(this._euler);
      return;
    }

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
    const bankRaw = THREE.MathUtils.clamp(-this._bankSignal * 1.5 * this.bankSensitivity, -this.maxBank, this.maxBank);
    const rollTarget = bankRaw * (0.2 + 0.8 * leanCurve);
    this.roll = damp(this.roll, rollTarget, this.bankLambda, dt);

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
    const pitchTarget = (forwardLean + accelPitch + climbUp + flare) * this.pitchSensitivity;
    this.pitch = damp(this.pitch, pitchTarget, this.pitchLambda, dt);

    // Subtle hover bob (fades out with speed) + faint rotor shimmer.
    this.bobPhase += dt * 1.6;
    const bob = Math.sin(this.bobPhase * 1.3) * this.hoverVert * (1 - leanCurve);
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
    // Eye out at the nose, level with the TADS/PNVS sensor turrets, so no part
    // of the airframe blocks the forward view.
    this._eye.set(0, 0.25, 4.5).applyQuaternion(this.group.quaternion).add(this.group.position);

    // Lead the view slightly into the direction the nose is swinging.
    const lead = THREE.MathUtils.clamp(this.yawVel * 0.5, -0.45, 0.45);
    let local;
    switch (look) {
      case 'left': local = new THREE.Vector3(-1, -0.1, 0.3); break;
      case 'right': local = new THREE.Vector3(1, -0.1, 0.3); break;
      case 'back': local = new THREE.Vector3(0, 0.1, -1); break;
      case 'down': local = new THREE.Vector3(0, -0.6, 0.7); break;
      default: local = new THREE.Vector3(lead, -0.03, 1); break;
    }
    this._look.copy(local).applyQuaternion(this.group.quaternion).add(this._eye);
    return { eye: this._eye, lookAt: this._look };
  }
}
