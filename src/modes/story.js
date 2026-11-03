// ストーリーモード: 固定マップの章立て。チェックポイントは章の開始時点（ブラウザに保存）
import { MAPS } from '../story/maps.js';
import { CHAPTERS, STORY_LIMIT, HINTS } from '../story/chapters.js';
import { TEXT, DIARIES, DIARY_TITLE, ENDINGS } from '../story/text.js';
import { buildMapLevel } from '../mapbuild.js';
import { storage, fmtTime } from '../util.js';

export const SAVE_KEY = 'escape.story';
export const UNLOCK_KEY = 'escape.unlock';
const MAP_ORDER = ['1F', '2F', '3F', '4F', '5F'];

// 日誌の通し番号（マップ順・上から）
const DIARY_INDEX = (() => {
  const ids = [];
  for (const id of MAP_ORDER) MAPS[id].grid.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === 'j') ids.push(id + ':' + c + ',' + r); });
  return ids;
})();
export const DIARY_TOTAL = DIARY_INDEX.length;

const clone = (o) => JSON.parse(JSON.stringify(o));

export class StoryMode {
  constructor(g, app, cont) {
    this.g = g; this.app = app; this.cont = cont;
    this.timers = []; this.ended = false; this.saveT = 0;
  }
  static hasSave() { return !!storage.get(SAVE_KEY, null); }

  start() {
    const g = this.g;
    Object.assign(g, { alarm: false, flashOn: true, time: 0, spotted: 0, decoyCd: 0, fear: 0 });
    const save = this.cont ? storage.get(SAVE_KEY, null) : null;
    if (save) { this.cp = save.cp; this.restore(save.time ?? save.cp.s.time, true); }
    else {
      this.s = { ch: 0, time: 0, inv: [], flags: [], diaries: [], maps: {}, hints: [] };
      this.mapId = null;
      this.startChapter(0);
    }
    g.begin();
  }

  get ch() { return CHAPTERS[this.s.ch]; }
  ms(id) { return this.s.maps[id] || (this.s.maps[id] = { taken: [], doors: [], power: null, awake: [] }); }

  // ---------- 章 ----------
  startChapter(i) {
    const prevMap = this.mapId;
    this.s.ch = i;
    const ch = this.ch;
    if (ch.startPower !== undefined) this.ms(ch.map).power = ch.startPower;
    if (ch.map !== prevMap || ch.at) this.loadMap(ch.map, ch.at || '@');
    this.objectiveText = ch.objective;
    this.spawnCfg = ch.spawn || null; this.spawnT = 0;
    this.g.ui.chapterCard(ch.no, ch.title);
    this.saveCheckpoint();
    if (ch.setup) ch.setup(this.api);
    if (ch.start) ch.start(this.api);
  }
  next() { this.timers = []; this.startChapter(this.s.ch + 1); }

  saveCheckpoint() {
    const p = this.g.player;
    this.cp = { s: clone(this.s), map: this.mapId, pos: { x: p.x, z: p.z, yaw: p.yaw } };
    storage.set(SAVE_KEY, { cp: this.cp, time: this.s.time });
  }
  restore(time, fromSave) {
    const g = this.g;
    this.s = clone(this.cp.s); this.s.time = time;
    this.timers = []; this.ended = false;
    g.ui.clearSubtitles();
    g.flashOn = true;
    this.loadMap(this.cp.map, this.cp.pos);
    const ch = this.ch;
    this.objectiveText = ch.objective;
    this.spawnCfg = ch.spawn || null; this.spawnT = 0;
    g.ui.chapterCard(ch.no, ch.title);
    if (ch.setup) ch.setup(this.api);
    if (fromSave && ch.start) ch.start(this.api);
  }

  loadMap(id, at) {
    const g = this.g, def = MAPS[id], ms = this.ms(id);
    if (this.mapId && this.mapId !== id) g.ui.clearSubtitles();
    this.mapId = id;
    const st = { taken: new Set(ms.taken), doors: new Set(ms.doors), power: ms.power ?? def.power };
    const lv = buildMapLevel(id, def, g.M, st, { mode: 'story' });
    let pos;
    if (at && typeof at === 'object') pos = at;
    else {
      const m = lv.markers[at] || lv.markers['@'];
      pos = { x: m.x, z: m.z, yaw: m.yaw ?? Math.atan2(m.x, m.z) };
    }
    g.setLevel(lv, pos);
    const awake = new Set(ms.awake), all = awake.has('all');
    for (const sp of lv.spawns) {
      const r = g.addRobot(sp.x, sp.z, { sleep: sp.sleep && !all && !awake.has(sp.id), heading: Math.random() * 6 });
      r.sid = sp.id || null;
    }
    for (const d of lv.docks) { const r = g.addRobot(d.x, d.z, { sleep: !all && !awake.has('docks'), heading: 0 }); r.dock = true; }
    g.ui.say(def.name, 3);
  }

  // ---------- 章スクリプト用 API ----------
  get api() {
    const self = this, g = this.g;
    return {
      say: (k) => g.ui.subtitles(TEXT[k] || [['', k]]),
      objective: (t) => { self.objectiveText = t; g.ui.note('目標: ' + t); },
      give: (id) => { if (!self.s.inv.includes(id)) self.s.inv.push(id); },
      has: (id) => self.has(id),
      flag: (id) => self.s.flags.includes(id),
      setFlag: (id) => { if (!self.s.flags.includes(id)) self.s.flags.push(id); },
      next: () => self.next(),
      wake: (id, how, stagger, limit) => self.wake(id, how, stagger, limit),
      openDoor: (id) => { const d = g.level.doors.find((x) => x.id === id); if (d) { g.openDoor(d); self.ms(self.mapId).doors.push(id); } },
      setPower: (on) => { self.ms(self.mapId).power = on; g.applyPower(on); },
      spawnRule: (cfg) => { self.spawnCfg = cfg; self.spawnT = 0; },
      spawn: (n) => { for (let i = 0; i < n; i++) g.spawnRobotFar(14); },
      after: (sec, fn) => self.timers.push({ t: sec, fn }),
      drone: (v) => g.audio.drone(v),
    };
  }
  has(id) { return this.s.inv.includes(id); }
  hasExitKey() { return this.has('master'); }
  // how: 'patrol'（持ち場へ）/ 'search'（プレイヤーの今の位置を調べに来る）/ 'chase'
  // stagger: 起動を 0〜stagger 秒ばらつかせる（一斉に押し寄せないように）
  // limit: 起動する最大台数（残りは眠ったまま）
  wake(id, how, stagger = 0, limit = Infinity) {
    const g = this.g, p = g.player;
    const ms = this.ms(this.mapId);
    if (!ms.awake.includes(id)) ms.awake.push(id);
    let n = 0;
    for (const r of g.robots) {
      if (r.state !== 'sleep') continue;
      if (!(id === 'all' || (id === 'docks' && r.dock) || r.sid === id)) continue;
      if (n++ >= limit) break;
      const go = () => {
        if (r.state !== 'sleep' || !g.robots.includes(r)) return;
        if (how === 'chase') { r.enter('chase'); r.sinceSeen = 0; r.lastSeen = { x: p.x, z: p.z }; }
        else if (how === 'search') r.enter('search', { x: p.x, z: p.z });
        else r.enter('patrol');
      };
      if (stagger > 0) this.timers.push({ t: Math.random() * stagger, fn: go }); else go();
    }
  }
  get breakerNoise() { return 5; }

  // ---------- 毎フレーム ----------
  update(dt) {
    const g = this.g;
    if (this.ended) return;
    this.s.time += dt;
    for (const t of this.timers) { t.t -= dt; if (t.t <= 0 && !t.done) { t.done = true; t.fn(); } }
    this.timers = this.timers.filter((t) => !t.done);
    if (this.spawnCfg) {
      this.spawnT += dt * (g.player.hidden ? 3 : 1);
      const active = g.robots.filter((r) => r.state !== 'sleep').length;
      if (this.spawnT > this.spawnCfg.interval && active < this.spawnCfg.max) { this.spawnT = 0; g.spawnRobotFar(14, false); }
    }
    // 裏エンド: 累計時間
    for (const [t, k] of HINTS) {
      if (this.s.time > t && !this.s.hints.includes(k)) { this.s.hints.push(k); g.audio.pa(); g.audio.staticBurst(0.06); g.ui.subtitles(TEXT[k]); }
    }
    const over = Math.max(0, (this.s.time - HINTS[0][0]) / (STORY_LIMIT - HINTS[0][0]));
    this.fearOverride = undefined;
    if (over > 0) g.fx.u.robo.value = Math.max(0, (over - 0.85) * 2); // 末期は視界が変質していく
    if (this.s.time >= STORY_LIMIT) { this.uraEnd(); return; }
    this.saveT += dt;
    if (this.saveT > 10) { this.saveT = 0; const sv = storage.get(SAVE_KEY, null); if (sv) { sv.time = this.s.time; storage.set(SAVE_KEY, sv); } }
  }
  get ambient() { return this.ch.dark ? 0.55 : undefined; }

  // ---------- インタラクション ----------
  interactText(it) {
    switch (it.kind) {
      case 'item':
        if (it.need && !this.has(it.need)) return it.name + '：外れない';
        if (it.diary) return '[E] 日誌の切れ端を拾う';
        if (it.id === 'fr_stop') return this.has('stopped') ? null : '[E] 停止スイッチを押す';
        if (it.keep) return '[E] ' + it.name + 'を調べる';
        return '[E] ' + it.name + 'を取る';
      case 'up': return '[E] 階段を上る';
      case 'exit': return this.has('master') ? '[E] マスターキーで脱出口を開ける' : '脱出口：施錠されている（マスターキーが必要）';
      case 'lift':
        if (it.need && !this.has(it.need)) return it.label + '：止まっている';
        if (!it.to) return it.label + '：動かない';
        if (!it.need && !this.g.level.power) return it.label + '：電源が落ちている';
        return '[E] ' + it.label + 'に乗る';
    }
    return undefined;
  }
  use(it) {
    const g = this.g, ch = this.ch;
    switch (it.kind) {
      case 'item': {
        const o = it.o;
        if (o.need && !this.has(o.need)) { g.audio.locked(); const k = ch.locked && ch.locked[o.id]; if (k) g.ui.subtitles(TEXT[k]); return true; }
        if (!o.keep) { o.gone = true; o.mesh.visible = false; this.ms(this.mapId).taken.push(o.id); }
        if (o.diary) {
          if (!this.s.diaries.includes(o.id)) this.s.diaries.push(o.id);
          const n = DIARY_INDEX.indexOf(o.id);
          g.audio.pickup();
          g.showDoc(DIARY_TITLE + '（' + (n + 1) + '/' + DIARY_TOTAL + '）　所持 ' + this.s.diaries.length + '枚', DIARIES[n] || '');
          return true;
        }
        if (o.id === 'fr_stop') { g.audio.click(); if (o.btnMat) o.btnMat.color.copy(g.M.ledGreen.color); }
        else if (!o.keep) { this.api.give(o.id); g.audio.pickup(); g.ui.note('入手: ' + o.name); }
        else g.audio.click();
        if (ch.item && ch.item[o.id]) ch.item[o.id](this.api);
        return true;
      }
      case 'up': {
        const to = it.o.to, nx = CHAPTERS[this.s.ch + 1];
        g.transition(() => { if (nx && nx.map === to) this.next(); else this.loadMap(to, '@'); }, 650, () => g.audio.stairs());
        return true;
      }
      case 'exit':
        if (this.has('master')) this.ending(this.s.diaries.length >= DIARY_TOTAL ? 'true' : 'normal');
        else { g.audio.locked(); g.ui.say('鍵がかかっている'); }
        return true;
    }
    return false;
  }
  onLift(L) {
    const g = this.g;
    if (L.need && !this.has(L.need)) { g.audio.locked(); const k = this.ch.locked && this.ch.locked[L.id]; if (k) g.ui.subtitles(TEXT[k]); return; }
    if (!L.to || (!L.need && !g.level.power)) { g.audio.locked(); g.ui.subtitles(TEXT.lift_dead); return; }
    g.noiseAt(L.x, L.z, 18);
    const nx = CHAPTERS[this.s.ch + 1];
    g.transition(() => {
      if (nx && nx.map === L.to) this.next(); else this.loadMap(L.to, L.at || '@');
      g.noiseAt(g.player.x, g.player.z, 16);
    }, 3200, () => g.audio.liftRide(3));
  }
  onPower(on) {
    this.ms(this.mapId).power = on;
    if (typeof this.ch.power === 'function') this.ch.power(this.api, on);
  }
  onDoorOpen(d) {
    this.ms(this.mapId).doors.push(d.id);
    if (this.ch.door) this.ch.door(this.api, d);
  }
  onTrigger(t) {
    this.ms(this.mapId).taken.push('trig:' + t.id);
    if (this.ch.trigger && this.ch.trigger[t.id]) this.ch.trigger[t.id](this.api);
  }
  onFall(x, z) {
    const g = this.g, below = MAPS[this.mapId].below;
    if (!below) return;
    g.transition(() => {
      this.loadMap(below, { x, z, yaw: g.player.yaw });
      const lv = g.level, k = lv.nav.nearestFree(lv.nav.idx(x, z));
      const p = g.player;
      p.x = lv.nav.cx(k); p.z = lv.nav.cz(k); p.gy = lv.groundAt(p.x, p.z) + 2.8; p.falling = true; p.vy = -2;
      if (this.ch.fall) this.ch.fall(this.api);
    }, 500);
  }

  // ---------- 終了 ----------
  gameOver() {
    const g = this.g;
    document.exitPointerLock(); g.ui.showHud(false);
    g.ui.overlay({
      title: 'お席へご案内いたしました',
      body: '<p>' + this.ch.no + '「' + this.ch.title + '」の始めからやり直せます。</p>',
      buttons: [
        { label: 'チェックポイントから再開', primary: true, onClick: () => { this.restore(this.s.time); g.begin(); } },
        { label: 'タイトルへ', onClick: () => this.app.showTitle() },
      ],
      settings: true,
    });
  }
  ending(kind) {
    const g = this.g, E = ENDINGS[kind];
    this.ended = true; g.state = 'win';
    storage.set(SAVE_KEY, null);
    const cleared = storage.get(UNLOCK_KEY, {});
    cleared[kind] = true; storage.set(UNLOCK_KEY, cleared);
    g.audio.unlock(); document.exitPointerLock(); g.ui.showHud(false); g.ui.clearSubtitles();
    g.ui.overlay({
      title: E.title,
      body: '<div class="endtext">' + E.text + '</div>' +
        '<table class="stats"><tr><th>プレイ時間</th><td>' + fmtTime(this.s.time) + '</td></tr><tr><th>日誌</th><td>' + this.s.diaries.length + ' / ' + DIARY_TOTAL + '</td></tr></table>' +
        (kind === 'normal' ? '<p class="dim">日誌をすべて集めると、別の結末がある。</p>' : ''),
      buttons: [{ label: 'タイトルへ', primary: true, onClick: () => this.app.showTitle() }],
    });
  }
  uraEnd() {
    const g = this.g;
    if (this.ended) return;
    this.ended = true;
    g.state = 'trans';
    g.closeDoc(); g.ui.clearSubtitles(); g.ui.prompt('');
    g.audio.pa(); g.audio.staticBurst(0.2);
    g.ui.subtitles([['FR-002', 'お客様、大変お待たせいたしました。'], ['FR-002', 'お席のご用意ができました。']]);
    g.fx.u.robo.value = 1;
    setTimeout(() => { g.ui.robotFace(true); g.audio.jingle(g.player.x, g.player.z, true, 0.2); }, 3500);
    setTimeout(() => {
      g.ui.robotFace(false);
      g.fx.u.robo.value = 0;
      g.state = 'win';
      storage.set(SAVE_KEY, null);
      const un = storage.get(UNLOCK_KEY, {}); un.ura = true; un.robot = true; storage.set(UNLOCK_KEY, un);
      document.exitPointerLock(); g.ui.showHud(false);
      const E = ENDINGS.ura;
      g.ui.overlay({
        title: E.title,
        body: '<div class="endtext">' + E.text + '</div><p class="best">ロボットモードが解放されました</p>',
        buttons: [{ label: 'ロボットモードへ', primary: true, onClick: () => this.app.startRobot() }, { label: 'タイトルへ', onClick: () => this.app.showTitle() }],
      });
    }, 8000);
  }

  hud() {
    const g = this.g, p = g.player;
    return {
      floor: this.ch.no + '「' + this.ch.title + '」<small>' + MAPS[this.mapId].name + '</small>',
      obj: '目標: <b>' + this.objectiveText + '</b>',
      code: '日誌 ' + this.s.diaries.length + ' / ' + DIARY_TOTAL + (this.s.inv.length ? '　所持: ' + this.s.inv.filter((i) => i !== 'stopped').map(itemName).join('・') : ''),
      sub: 'ライト ' + (g.flashOn ? 'ON' : '<span class="warn">OFF</span>') + '　電源 ' + (g.level.power ? 'ON' : '<span class="warn">OFF</span>') +
        (p.crawl ? '　<span class="dim">ダクト内</span>' : p.crouch ? '　<span class="dim">しゃがみ</span>' : '') +
        (p.hidden ? '<br><span class="warn">隠れている…</span>' : ''),
      stamina: p.stamina, exhausted: p.exhausted,
    };
  }
  pauseInfo() {
    return {
      body: '<p>ストーリー　' + this.ch.no + '「' + this.ch.title + '」　日誌 ' + this.s.diaries.length + '/' + DIARY_TOTAL + '</p><p class="dim">目標: ' + this.objectiveText + '</p>',
      buttons: [
        { label: 'チェックポイントからやり直す', onClick: () => { this.restore(this.s.time); this.g.begin(); } },
        { label: 'タイトルへ（進行は章の始めから再開できます）', onClick: () => this.app.showTitle() },
      ],
    };
  }
}

const NAMES = { breakerKey: '配電盤の鍵', card2: 'カードキー(2F)', card5: 'カードキー(5F)', master: 'マスターキー' };
function itemName(id) { return NAMES[id] || id; }
