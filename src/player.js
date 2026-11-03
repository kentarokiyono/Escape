import { PLAYER, NOISE } from './config.js';
import { damp } from './util.js';

export class Player {
  constructor() { this.reset(0, 0, 0); }

  reset(x, z, yaw) {
    Object.assign(this, {
      x, z, yaw, pitch: 0, vx: 0, vz: 0, r: PLAYER.radius,
      stamina: 100, exhausted: false, crouch: false, dash: false, moving: false, noise: 0,
      hidden: false, locker: null, yawCenter: 0,
      eyeH: PLAYER.eye, phase: 0, lastStep: 0, bobAmp: 0, bobX: 0, bobY: 0, roll: 0,
    });
  }
  place(x, z, yaw) { this.x = x; this.z = z; this.yaw = yaw; this.pitch = 0; this.vx = this.vz = 0; this.hidden = false; this.locker = null; }

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
    const can = g.state === 'play';
    const k = (a, b) => (can && (keys[a] || keys[b]) ? 1 : 0);
    const f = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
    const s = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    let dx = -Math.sin(this.yaw) * f + Math.cos(this.yaw) * s, dz = -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s;
    const dl = Math.hypot(dx, dz);
    if (dl > 0) { dx /= dl; dz /= dl; }
    this.crouch = can && !!keys.KeyC;
    const wantDash = can && (keys.ShiftLeft || keys.ShiftRight) && f > 0;
    this.dash = dl > 0 && wantDash && !this.exhausted && !this.crouch && this.stamina > 0;
    if (this.dash) { this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt); if (this.stamina <= 0) this.exhausted = true; }
    else regen(dl > 0 ? 0.6 : 1);
    const sp = this.crouch ? PLAYER.crouch : this.dash ? PLAYER.dash : this.exhausted ? PLAYER.tired : PLAYER.walk;
    this.vx = damp(this.vx, dx * sp, 10, dt); this.vz = damp(this.vz, dz * sp, 10, dt);
    const ph = g.level.phys;
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (!ph.collide(nx, this.z, this.r)) this.x = nx; else this.vx = 0;
    if (!ph.collide(this.x, nz, this.r)) this.z = nz; else this.vz = 0;
    const speed = Math.hypot(this.vx, this.vz);
    this.moving = speed > 0.3;
    const wet = g.level.puddles.some((p) => Math.hypot(p.x - this.x, p.z - this.z) < p.r * 0.8);
    this.noise = !this.moving ? 0 : this.crouch ? NOISE.crouch : this.dash ? NOISE.dash : NOISE.walk * Math.min(1, speed / PLAYER.walk);
    if (wet) this.noise *= 1.4;
    this.eyeH = damp(this.eyeH, this.crouch ? PLAYER.crouchEye : PLAYER.eye, 10, dt);

    const stepLen = this.crouch ? 0.55 : this.dash ? 1.0 : 0.75;
    if (this.moving) this.phase += (speed * dt / stepLen) * Math.PI;
    const idx = Math.floor(this.phase / Math.PI);
    if (idx !== this.lastStep) {
      this.lastStep = idx;
      if (this.moving) g.audio.step(g.level.surface, this.crouch ? 'crouch' : this.dash ? 'dash' : 'walk', wet);
    }
    const side = this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw);
    this._bob(dt, this.moving ? (this.crouch ? 0.018 : this.dash ? 0.055 : 0.032) : 0, side);
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
    cam.position.set(this.x + rx * this.bobX, this.eyeH + this.bobY + Math.sin(t * 1.3) * 0.004 + sy, this.z + rz * this.bobX);
    cam.rotation.set(this.pitch + sy * 0.5, this.yaw + sx * 0.5, this.roll);
  }
}
