import { PLAYER, NOISE } from './config.js';
import { damp } from './util.js';
import { HOLE } from './physics.js';

export class Player {
  constructor() { this.reset(0, 0, 0); }

  reset(x, z, yaw) {
    Object.assign(this, {
      x, z, yaw, pitch: 0, vx: 0, vz: 0, r: PLAYER.radius, gy: 0, vy: 0, falling: false, fellThrough: false,
      stamina: 100, exhausted: false, crouch: false, crawl: false, dash: false, moving: false, noise: 0,
      hidden: false, locker: null, yawCenter: 0, eye: PLAYER.eye, speedMul: 1, eyeOverride: 0, robot: false,
      eyeH: PLAYER.eye, phase: 0, lastStep: 0, bobAmp: 0, bobX: 0, bobY: 0, roll: 0,
    });
  }
  place(x, z, yaw, gy = 0) {
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = 0; this.vx = this.vz = 0;
    this.hidden = false; this.locker = null; this.gy = gy; this.vy = 0; this.falling = false; this.fellThrough = false;
  }
  get eyeY() { return this.gy + this.eyeH; }

  // 視線方向との一致度（水平）
  facingDot(x, z) {
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz) || 1;
    return ((dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) / d) * Math.cos(this.pitch);
  }

  look(dx, dy) {
    this.yaw -= dx; this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy));
    if (this.hidden) {
      let d = this.yaw - this.yawCenter;
      d = Math.max(-0.55, Math.min(0.55, Math.atan2(Math.sin(d), Math.cos(d))));
      this.yaw = this.yawCenter + d;
      this.pitch = Math.max(-0.35, Math.min(0.35, this.pitch));
    }
  }

  update(dt, keys, g) {
    const ph = g.level.phys;
    const regen = (k) => {
      this.stamina = Math.min(100, this.stamina + PLAYER.staminaRegen * dt * k);
      if (this.exhausted && this.stamina > PLAYER.exhaustRecover) this.exhausted = false;
    };
    if (this.hidden) {
      this.moving = this.dash = false; this.noise = 0; this.vx = this.vz = 0; this.bobAmp = 0;
      regen(1);
      this.eyeH = damp(this.eyeH, 1.55, 8, dt);
      this._bob(dt, 0);
      return;
    }
    const can = g.state === 'play' && !this.falling;
    const k = (a, b) => (can && (keys[a] || keys[b]) ? 1 : 0);
    let f = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
    let s = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    let mag = 1;
    const tm = g.touchMove; // タッチのスティック（倒した量で速度が変わる）
    if (tm && tm.active && can) { f = -tm.y; s = tm.x; mag = Math.min(1, Math.hypot(f, s)); }
    let dx = -Math.sin(this.yaw) * f + Math.cos(this.yaw) * s, dz = -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s;
    const dl = Math.hypot(dx, dz);
    if (dl > 0) { dx = (dx / dl) * mag; dz = (dz / dl) * mag; }
    // ダクトの中（または体がかかっている）ならしゃがみ固定
    const o = { y: this.gy, crouch: false };
    const stuckUp = !this.robot && ph.collide(this.x, this.z, this.r, o) && !ph.collide(this.x, this.z, this.r, { y: this.gy, crouch: true });
    this.crawl = !this.robot && ph.inCrawl(this.x, this.z);
    this.crouch = !this.robot && (this.crawl || stuckUp || (can && !!keys.KeyC));
    o.crouch = this.crouch; o.robot = this.robot;
    const wantDash = can && (keys.ShiftLeft || keys.ShiftRight) && f > 0.3;
    this.dash = dl > 0 && wantDash && !this.exhausted && !this.crouch && this.stamina > 0;
    if (this.dash) { this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt); if (this.stamina <= 0) this.exhausted = true; }
    else regen(dl > 0 ? 0.6 : 1);
    let sp = this.crawl ? 1.1 : this.crouch ? PLAYER.crouch : this.dash ? PLAYER.dash : this.exhausted ? PLAYER.tired : PLAYER.walk;
    sp *= this.speedMul;
    this.vx = damp(this.vx, dx * sp, 10, dt); this.vz = damp(this.vz, dz * sp, 10, dt);
    if (!this.falling) {
      const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
      // 既に障害物に食い込んでいる場合は、めり込みが浅くなる方向への移動だけ許す
      const stuck = ph.collide(this.x, this.z, this.r, o);
      const ok = (x, z) => (stuck ? ph.clearance(x, z, this.r, o) > ph.clearance(this.x, this.z, this.r, o) - 1e-4 && ph.canMove(x, z, 0.05, o) : ph.canMove(x, z, this.r, o));
      if (ok(nx, this.z)) this.x = nx; else this.vx = 0;
      if (ok(this.x, nz)) this.z = nz; else this.vz = 0;
    }
    // 床の高さ・落下
    const center = ph.groundAt(this.x, this.z);
    const ground = center <= HOLE + 1 ? HOLE : ph.groundSpan(this.x, this.z, 0.12)[1];
    if (ground >= this.gy - 0.05 && !this.falling) this.gy = ground > this.gy ? damp(this.gy, ground, 18, dt) : ground;
    else {
      if (!this.falling && this.gy - ground > 0.6) { this.falling = true; this.vy = 0; }
      if (this.falling) {
        this.vy -= 9.8 * dt; this.gy += this.vy * dt;
        if (this.gy <= ground) { const v = -this.vy; this.gy = ground; this.vy = 0; this.falling = false; g.onLand(v); }
        else if (ground === HOLE && this.gy < -2.2 && !this.fellThrough) { this.fellThrough = true; g.onFallThrough(); }
      } else this.gy = damp(this.gy, ground, 18, dt);
    }

    const speed = Math.hypot(this.vx, this.vz);
    this.moving = speed > 0.3;
    const wet = g.level.puddles.some((p) => Math.hypot(p.x - this.x, p.z - this.z) < p.r * 0.8) && this.gy < 0.05;
    this.noise = !this.moving ? 0 : this.crawl ? 1.0 : this.crouch ? NOISE.crouch : this.dash ? NOISE.dash : NOISE.walk * Math.min(1, speed / PLAYER.walk);
    if (wet) this.noise *= 1.4;
    const eyeT = this.eyeOverride || (this.crawl ? 0.5 : this.crouch ? PLAYER.crouchEye : PLAYER.eye);
    this.eyeH = damp(this.eyeH, eyeT, 10, dt);

    const stepLen = this.crawl ? 0.5 : this.crouch ? 0.55 : this.dash ? 1.0 : 0.75;
    if (this.moving) this.phase += (speed * dt / stepLen) * Math.PI;
    const idx = Math.floor(this.phase / Math.PI);
    if (idx !== this.lastStep) {
      this.lastStep = idx;
      if (this.moving && !this.falling) g.onStep(this.crawl ? 'crawl' : this.crouch ? 'crouch' : this.dash ? 'dash' : 'walk', wet);
    }
    const side = this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw);
    this._bob(dt, this.moving ? (this.robot ? 0.006 : this.crawl ? 0.012 : this.crouch ? 0.018 : this.dash ? 0.055 : 0.032) : 0, side);
  }

  _bob(dt, amp, side = 0) {
    this.bobAmp = damp(this.bobAmp, amp, 6, dt);
    this.bobY = (Math.abs(Math.sin(this.phase)) - 0.5) * this.bobAmp * 2;
    this.bobX = Math.cos(this.phase) * this.bobAmp * 0.6;
    this.roll = damp(this.roll, -side * 0.006 + Math.cos(this.phase) * this.bobAmp * 0.12, 8, dt);
  }

  applyCamera(cam, t, shake) {
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
    cam.position.set(this.x + rx * this.bobX, this.gy + this.eyeH + this.bobY + Math.sin(t * 1.3) * 0.004 + sy, this.z + rz * this.bobX);
    cam.rotation.set(this.pitch + sy * 0.5, this.yaw + sx * 0.5, this.roll);
  }
}
