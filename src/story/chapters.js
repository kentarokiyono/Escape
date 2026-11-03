// 章の構成と進行スクリプト。S はストーリーモードの操作 API（modes/story.js）
// start: 章に初めて入ったときだけ / setup: やり直しのたびに実行
export const STORY_LIMIT = 60 * 60;          // 裏エンドまでの累計時間（秒）
export const HINTS = [[40 * 60, 'hint1'], [50 * 60, 'hint2'], [55 * 60, 'hint3']];

export const CHAPTERS = [
  {
    id: 'prologue', no: '序章', title: 'ご来店', map: '1F',
    objective: '事務所で、電気を戻す手がかりを探す',
    start(S) { S.say('pro_start'); },
    trigger: {
      greet(S) { S.wake('greeter', 'search'); S.say('pro_greet'); },
    },
    item: {
      breakerKey(S) { S.say('pro_key'); S.next(); },
    },
  },
  {
    id: 'ch1', no: '第1章', title: '点灯', map: '1F',
    objective: '電気室の配電盤でブレーカーを上げる',
    start(S) { S.say('ch1_start'); },
    power(S, on) {
      if (!on || S.flag('ch1_power')) return;
      S.setFlag('ch1_power');
      S.say('ch1_power');
      // 放送のあと、ホールのロボットが少しずつ持ち場（巡回）につく
      S.after(5, () => S.wake('docks', 'patrol', 8));
      S.objective('シャッターの開いた階段から 2F へ');
      S.spawnRule({ interval: 70, max: 4 });
    },
  },
  {
    id: 'ch2', no: '第2章', title: '個室', map: '2F', at: '@',
    objective: '階段室を開けるカードキーを探す（しゃがむとダクトを通れる）',
    spawn: { interval: 50, max: 5 },
    start(S) { S.say('ch2_start'); },
    item: { card2(S) { S.say('ch2_card'); S.objective('北東の階段室をカードキーで開ける'); } },
    door(S, d) { if (d.id === 'roomG') S.say('ch2_room'); },
  },
  {
    id: 'ch3', no: '第3章', title: '宴', map: '3F', at: '@',
    objective: '中二階の音響室を調べる',
    spawn: { interval: 60, max: 4 },
    start(S) { S.say('ch3_start'); },
    item: {
      recording(S) {
        if (S.flag('ch3_rec')) return;
        S.setFlag('ch3_rec');
        S.say('ch3_record');
        S.after(9, () => { S.openDoor('stair3'); S.wake('docks', 'patrol', 10, 6); S.objective('北東の階段室から 4F へ'); S.spawnRule({ interval: 50, max: 8 }); });
      },
    },
    fall(S) { S.say('ch3_fall'); S.objective('2F の階段から 3F へ戻る'); },
  },
  {
    id: 'ch4', no: '第4章', title: '仕込み', map: '4F', at: '@',
    objective: '上の階へ行く方法を探す',
    spawn: { interval: 45, max: 5 },
    start(S) { S.say('ch4_start'); },
    trigger: { collapsed(S) { S.say('ch4_collapsed'); S.objective('配電室で電源を入れ、配膳リフトで 5F へ'); } },
    item: { nameplates(S) { S.say('ch4_names'); } },
    power(S, on) {
      if (!on || S.flag('ch4_power')) return;
      S.setFlag('ch4_power');
      S.say('ch4_power');
      S.after(4, () => S.wake('docks', 'patrol', 8));
      S.objective('配膳リフトで 5F へ（動作音でロボットが集まる）');
    },
  },
  {
    id: 'ch5', no: '第5章', title: '女将', map: '5F', at: 'lift5',
    objective: 'サーバー室で FR-002 を停止する',
    spawn: { interval: 55, max: 5 },
    start(S) { S.say('ch5_start'); },
    item: {
      card5(S) { S.say('ch5_card'); S.objective('サーバー室をカードキーで開け、FR-002 を停止する'); },
      fr_stop(S) {
        if (S.flag('stopped')) return;
        S.setFlag('stopped'); S.give('stopped');
        S.say('ch5_stop');
        S.drone(1);
        S.after(14, () => { S.setPower(false); S.wake('docks', 'search', 12); S.objective('マスターキーを取り、エレベーターで 1F へ'); S.drone(0); S.spawnRule({ interval: 35, max: 7 }); });
      },
      master(S) { S.objective('エレベーターで 1F へ'); },
    },
    locked: { master: 'ch5_key_locked', elev5: 'ch5_elev_locked' },
  },
  {
    id: 'final', no: '終章', title: 'お会計', map: '1F', at: 'elev1', startPower: false, dark: true,
    objective: '1F の脱出口からビルの外へ',
    spawn: { interval: 30, max: 7 },
    setup(S) { S.wake('all', 'patrol', 6); S.spawn(2); },
    start(S) { S.say('fin_start'); },
  },
];
