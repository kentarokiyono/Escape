// 暗証番号の暗号メモ（フリーモード）。階ごとに解き方が変わる
// 2F: 2進数 / 3F: レシート（税込合計） / 4F: 16進数
const MENU = [['ハンバーグ', 980], ['ドリンクバー', 290], ['ミックスグリル', 1380], ['シーザーサラダ', 590], ['コーンスープ', 350],
  ['お子様ランチ', 720], ['ドリア', 499], ['パンケーキ', 640], ['ライス', 220], ['山盛りポテト', 450], ['チーズケーキ', 480], ['ステーキ', 1980]];

export const PUZZLE_KIND = { 2: 'bin', 3: 'receipt', 4: 'hex' };
export const PUZZLE_NAME = { bin: '2進数', receipt: 'レシート', hex: '16進数' };

export function makePuzzle(code, n, R) {
  const kind = PUZZLE_KIND[n] || 'bin';
  const num = Number(code);
  if (kind === 'bin') {
    const bits = [...code].map((d) => Number(d).toString(2).padStart(4, '0')).join(' ');
    return { kind, title: n + 'F → ' + (n + 1) + 'F 階段コード（2進数メモ）', short: bits,
      body: '階段コードは4桁。\n1桁ずつ2進数で書いておく。\n\n　' + bits + '\n\n（例: 0101 は 4+1 で 5）' };
  }
  if (kind === 'hex') {
    const hex = '0x' + num.toString(16).toUpperCase();
    return { kind, title: n + 'F → ' + (n + 1) + 'F 階段コード（16進数メモ）', short: hex,
      body: '階段コード = ' + hex + '\n\n16進数のまま入れても開かない。\n10進数に直して、4桁に満たなければ前を0で埋める。\n\n（例: 0x1F = 1×16 + 15 = 31 → 0031）' };
  }
  // レシート: 税込合計（10%、1円未満切り捨て）の下4桁が暗証番号になる小計を探す
  let sub = 0;
  for (let k = 1; k < 40 && !sub; k++) {
    const total = code === '0000' && k === 1 ? 10000 : num + 10000 * k;
    const s = Math.ceil((total * 10) / 11);
    if (Math.floor((s * 11) / 10) === total) sub = s;
  }
  // 小計を料理の値段に分ける（最後の1品で端数を合わせる）
  const items = [];
  let rest = sub;
  while (rest > 2500) {
    const [name, price] = MENU[Math.floor(R() * MENU.length)];
    const q = 1 + Math.floor(R() * 3);
    if (price * q > rest - 300) continue;
    items.push([name, q, price * q]); rest -= price * q;
  }
  items.push(['宴会コース追加料金', 1, rest]);
  const lines = items.map(([nm, q, p]) => nm.padEnd(10, '　') + ' ×' + q + '　' + p.toLocaleString('ja-JP') + '円');
  return { kind, title: n + 'F → ' + (n + 1) + 'F 階段コード（レシート）', short: '税込合計の下4桁',
    body: 'つきみ亭 本店　閉店記念営業\n―――――――――――\n' + lines.join('\n') + '\n―――――――――――\n小計　？？？円\n消費税（10%・1円未満切り捨て）\n合計　？？？円\n\n裏に走り書き:「階段の番号はこの合計の下4桁」' };
}
