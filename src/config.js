// ゲーム全体の定数
export const RX = 40;          // フロア半幅 (x: -RX..RX)
export const RZ = 80;          // フロア半奥行 (z: -RZ..RZ)
export const GRID = 0.5;       // ナビ/視線グリッド解像度
export const TOP_FLOOR = 5;

// theme: 小物の種類 / door: 扉幅 / open: 壁ごと撤去する確率 / maze: 迷路化
export const FLOORS = {
  1: { cols: 4, rows: 8,  name: '1F 元メインフロア', theme: 'hall',    door: 5.0, open: 0.45, maze: false, wallH: 5.5 },
  2: { cols: 6, rows: 12, name: '2F 元個室フロア',   theme: 'private', door: 2.0, open: 0,    maze: false },
  3: { cols: 8, rows: 16, name: '3F 元宴会フロア',   theme: 'banquet', door: 2.0, open: 0,    maze: true  },
  4: { cols: 5, rows: 10, name: '4F 元厨房',         theme: 'kitchen', door: 2.4, open: 0.1,  maze: false },
  5: { cols: 3, rows: 6,  name: '5F 機械管理室',     theme: 'machine', door: 3.0, open: 0.2,  maze: false },
};

export const ENTRY = { x: 10, z: RZ - 3 };      // 1F 開始地点
export const EXIT_DOOR = { x: 10, z: RZ };      // 1F 脱出口
export const KEY_POS = { x: 3, z: -RZ + 4 };    // 5F マスターキー
export const DOCK_XS = [-30, -20, -10, 16, 26]; // 5F 充電ドック

export const PLAYER = {
  radius: 0.3,
  eye: 1.6, crouchEye: 1.0,
  walk: 3.0, dash: 5.4, crouch: 1.6, tired: 2.3,
  staminaDrain: 24, staminaRegen: 14, exhaustRecover: 30,
};

// 足音が届く半径 (m)
export const NOISE = { crouch: 1.5, walk: 6, dash: 13 };

export const ROBOT = {
  radius: 0.3,
  patrol: 1.3, search: 2.0, lure: 2.3, chase: 3.7,
  fovCos: Math.cos(65 * Math.PI / 180),
  sight: 10, sightFlash: 16, close: 2.2,
  alertTime: 0.55, loseTime: 3.5, track: 0.9,
  catchDist: 0.85,
};

export const DECOY_CD = 12;
export const DECOY_RANGE = 45;

export const STORAGE_KEYS = { best: 'escape.best', settings: 'escape.settings' };

// 難易度: speed=ロボット速度, sight=視認距離, spawn=増援間隔の倍率, drain=バッテリー消費
export const DIFFICULTY = {
  easy: { name: 'やさしい', speed: 0.88, sight: 0.8, spawn: 1.4, drain: 1.3 },
  normal: { name: 'ふつう', speed: 1, sight: 1, spawn: 1, drain: 1 },
  hard: { name: 'むずかしい', speed: 1.1, sight: 1.2, spawn: 0.7, drain: 0.8 },
};

// 給仕ロボットの機種（図鑑・性能差）
export const ROBOT_TYPES = {
  patrol: { name: 'MK-2 巡回型', speed: 1, sight: 1, battery: 100, drain: 1, tint: null, acc: null,
    desc: 'ホール巡回用の標準機。トレイ3段、最大積載6kg。' },
  guide: { name: 'MK-2G 案内型', speed: 1.05, sight: 1.1, battery: 100, drain: 1, tint: 0xf0d8d8, acc: 'bow',
    desc: '入口でお客様をお迎えする機体。蝶ネクタイ型の装飾付き。挨拶の音声が多い。' },
  kitchen: { name: 'MK-3K 厨房型', speed: 1.12, sight: 0.9, battery: 90, drain: 1.2, tint: 0xc8ccd0, acc: 'hat',
    desc: '厨房と配膳口を往復する高速機。耐熱外装。視覚センサーは油煙対策で控えめ。' },
  guard: { name: 'MK-5S 警備型', speed: 1, sight: 1.35, battery: 130, drain: 0.9, tint: 0x9aa4ad, acc: 'antenna',
    desc: '閉店後の見回り用。大容量バッテリーと長距離センサーを持つ。' },
  old: { name: 'MK-1 旧型', speed: 0.85, sight: 0.85, battery: 60, drain: 1.4, tint: 0xc8b890, acc: 'rust',
    desc: '開店当初の初期型。外装が黄ばみ、バッテリーの劣化が激しい。' },
};

// 配電盤: 各系統の負荷（100V 換算の電流 A）
export const LOADS = { light: 8, camera: 6, shutter: 10, lift: 14 };
export const SYS_NAMES = { light: '照明', camera: '監視カメラ', shutter: 'シャッター・扉', lift: 'リフト・エレベーター' };
export const CAPACITY = 30;
