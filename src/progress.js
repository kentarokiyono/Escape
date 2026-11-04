// 実績・累計統計・図鑑・章ランク・日替わり記録（ブラウザに保存）
import { storage } from './util.js';
import { ROBOT_TYPES } from './config.js';

export const ACHIEVEMENTS = [
  ['clear_free', '開店前退勤', 'フリーモードで脱出する'],
  ['ending_normal', 'またのお越しを', 'ストーリーの通常エンドを見る'],
  ['ending_true', '閉店しました', 'ストーリーの真エンドを見る'],
  ['ending_ura', '新しいスタッフ', 'ストーリーの裏エンドを見る'],
  ['no_spot', '透明なお客様', '一度も見つからずに脱出する'],
  ['dark_run', '暗闇の常連', 'ライトの点灯30秒未満で脱出する'],
  ['no_locker', '隠れない主義', 'ロッカーを一度も使わずに脱出する'],
  ['speed_free', '早食い', 'フリーモードを8分以内に脱出する'],
  ['speed_story', '回転率', 'ストーリーを累計30分以内にクリアする'],
  ['stop5', '電源オフ', 'リモコンでロボットを累計5台止める'],
  ['drain1', '燃料切れ', 'ロボットを電池切れで止める'],
  ['throw10', 'ポルターガイスト', '投げた物の音でロボットを累計10回おびき寄せる'],
  ['docs3', 'リバースエンジニア', 'FR-002 の技術資料を3種類すべて読む'],
  ['codes3', '暗号解読班', '2進数・レシート・16進数の暗号をすべて解く'],
  ['trip', '過電流', '配電盤のブレーカーを過電流で落とす'],
  ['dex_all', '図鑑完成', 'ロボット5機種とメモ8枚をすべて図鑑に登録する'],
  ['robot_win', '完璧なおもてなし', 'ロボットモードで全員をご案内する'],
  ['rank_s', '模範的なお客様', 'ストーリーのいずれかの章で S ランクを取る'],
  ['daily', '本日のおすすめ', '「今日の建物」から脱出する'],
  ['hardcore', '一見さんお断り', 'ハードコアでストーリーをクリアする'],
  ['diff_hard', '常連の意地', '難易度「むずかしい」でいずれかのモードをクリアする'],
];
const NAME = Object.fromEntries(ACHIEVEMENTS.map(([id, n]) => [id, n]));

export const NOTE_TOTAL = 8;

class ProgressStore {
  constructor() {
    this.ach = storage.get('escape.ach', {});
    this.stats = storage.get('escape.stats', {});
    this.dex = Object.assign({ robots: [], notes: [] }, storage.get('escape.dex', {}));
    this.ranks = storage.get('escape.ranks', {});
    this.daily = storage.get('escape.daily', {});
    this.ui = null; this.audio = null;
  }
  save() {
    storage.set('escape.ach', this.ach); storage.set('escape.stats', this.stats);
    storage.set('escape.dex', this.dex); storage.set('escape.ranks', this.ranks); storage.set('escape.daily', this.daily);
  }
  has(id) { return !!this.ach[id]; }
  unlock(id) {
    if (this.ach[id] || !NAME[id]) return;
    this.ach[id] = Date.now(); this.save();
    if (this.ui) this.ui.toast('実績解除：' + NAME[id]);
    if (this.audio) this.audio.pickup();
  }
  add(stat, n = 1) {
    this.stats[stat] = (this.stats[stat] || 0) + n; this.save();
    if (stat === 'stops' && this.stats.stops >= 5) this.unlock('stop5');
    if (stat === 'drains') this.unlock('drain1');
    if (stat === 'lures' && this.stats.lures >= 10) this.unlock('throw10');
    return this.stats[stat];
  }
  // kind: 'robots'（機種名）/ 'notes'（番号）。新規なら true
  dexAdd(kind, id) {
    if (this.dex[kind].includes(id)) return false;
    this.dex[kind].push(id); this.save();
    if (this.dex.robots.length >= Object.keys(ROBOT_TYPES).length && this.dex.notes.length >= NOTE_TOTAL) this.unlock('dex_all');
    return true;
  }
  rank(chId, rank, time) {
    const order = 'SABC', cur = this.ranks[chId];
    if (!cur || order.indexOf(rank) < order.indexOf(cur.rank) || (rank === cur.rank && time < cur.time)) { this.ranks[chId] = { rank, time }; this.save(); }
    if (rank === 'S') this.unlock('rank_s');
  }
  dailyResult(date, time) {
    const cur = this.daily[date];
    if (cur == null || time < cur) { this.daily[date] = time; this.save(); return true; }
    return false;
  }
  get achCount() { return ACHIEVEMENTS.filter(([id]) => this.ach[id]).length; }
}
export const Progress = new ProgressStore();

// 日付から建物番号を決める（全員が同じ建物に挑める）
export function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function dailySeed(key) {
  let h = 2166136261;
  for (const c of 'tsukimitei:' + key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// 1回の挑戦中の記録（実績判定用）
export function newRun() { return { lightTime: 0, lockers: 0, codes: [] }; }
// 脱出時に共通の実績を判定する
export function judgeEscape(g, extra = {}) {
  const r = g.run;
  if (g.spotted === 0) Progress.unlock('no_spot');
  if (r.lightTime < 30) Progress.unlock('dark_run');
  if (r.lockers === 0) Progress.unlock('no_locker');
  if (g.diffKey === 'hard') Progress.unlock('diff_hard');
  if (extra.free) Progress.unlock('clear_free');
}
