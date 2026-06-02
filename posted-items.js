/**
 * posted-items.js  ─  投稿済み商品の記録・重複排除
 *
 * posted-items.json に itemCode → タイムスタンプ を保存。
 * 2日（48時間）以内に投稿済みの商品をスキップするために使う。
 * GitHub Actions ワークフロー完了後にコミットして永続化する。
 */
const fs   = require('fs');
const path = require('path');

const FILE        = path.join(__dirname, 'posted-items.json');
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;  // 48時間
const KEEP_MS     = 7 * 24 * 60 * 60 * 1000;  // 7日（古いエントリを削除）

/** ファイルを読み込む（存在しない場合は空オブジェクトを返す） */
function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** ファイルに書き込む */
function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * 商品が直近2日以内に投稿済みか確認する
 * @param {string} itemCode - 楽天商品コード
 * @returns {boolean}
 */
function isPostedRecently(itemCode) {
  const data = load();
  const ts   = data[itemCode];
  if (!ts) return false;
  return Date.now() - ts < TWO_DAYS_MS;
}

/**
 * 商品を投稿済みとして記録する（7日以上前の古いエントリは自動削除）
 * @param {string} itemCode
 */
function markAsPosted(itemCode) {
  const data   = load();
  const cutoff = Date.now() - KEEP_MS;

  // 7日以上前のエントリを削除
  for (const [k, v] of Object.entries(data)) {
    if (v < cutoff) delete data[k];
  }

  data[itemCode] = Date.now();
  save(data);
}

/**
 * 商品リストから2日以内に投稿済みのものを除外して返す
 * @param {Array} products
 * @returns {Array}
 */
function filterUnposted(products) {
  return products.filter(p => {
    if (isPostedRecently(p.itemCode)) {
      console.log(`  ⏭ 投稿済みスキップ: ${p.title.slice(0, 40)}`);
      return false;
    }
    return true;
  });
}

module.exports = { isPostedRecently, markAsPosted, filterUnposted };
