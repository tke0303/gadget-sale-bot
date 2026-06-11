/**
 * ranker.js  ─  楽天市場ランキングAPIからガジェット人気商品を取得する
 *
 * scraper.js との違い:
 *   - エンドポイント: IchibaItem/Ranking（人気順）
 *   - 割引率フィルタなし（セール品限定にしない）
 *   - 結果をシャッフルして返す（毎回同じ投稿順にならないよう）
 *
 * 品質フィルタ（維持）:
 *   - レビュー件数 100件以上
 *   - 評価 4.0以上
 *
 * 重複排除:
 *   - ジャンル横断の itemCode 重複を除去
 *   - posted-items.js による2日以内投稿済みスキップは index.js 側で実施
 */
require('dotenv').config();
const axios = require('axios');

// ランキングAPIが利用不可のため Search API でレビュー数降順取得
// sort='-reviewCount' でレビュー数が多い人気商品を取得する
const RAKUTEN_SEARCH_URL =
  'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';

const GADGET_GENRES = [
  { id: '211742', label: 'TV・オーディオ・カメラ' },
  { id: '564500', label: 'スマホ・タブレット'      },
  { id: '100026', label: 'PC・周辺機器'            },
  { id: '100433', label: 'カメラ・光学機器'        },
  { id: '200162', label: 'イヤホン・ヘッドホン'    },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Fisher-Yates シャッフル（毎回ランダムな順番で投稿するため） */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Search API でレビュー数降順（人気順）取得
 * discountフィルタなし・割引率問わず人気商品を対象にする
 */
async function fetchPopular(genreId, label) {
  const params = {
    applicationId: process.env.RAKUTEN_APP_ID,
    accessKey:     process.env.RAKUTEN_ACCESS_KEY,
    genreId,
    hits:          30,
    page:          1,
    availability:  1,
    sort:          '-reviewCount',  // レビュー数降順 = 人気順
    format:        'json',
  };
  if (process.env.RAKUTEN_AFFILIATE_ID) {
    params.affiliateId = process.env.RAKUTEN_AFFILIATE_ID;
  }

  try {
    const res = await axios.get(RAKUTEN_SEARCH_URL, {
      params,
      headers: {
        'Referer':    'https://gadget-gekiyasu.com',
        'Origin':     'https://gadget-gekiyasu.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      },
      timeout: 15000,
    });
    const items = res.data?.Items ?? [];
    console.log(`  [${label}] ${items.length}件取得`);
    return { items: items.map(i => i.Item ?? i), hadError: false };
  } catch (err) {
    const status  = err.response?.status;
    const errBody = err.response?.data;
    const errMsg  = errBody?.errors?.errorMessage || errBody?.error_description || errBody?.error || err.message;
    if (status === 404) {
      console.log(`  [${label}] ジャンルID ${genreId} は存在しません。スキップ`);
    } else {
      console.warn(`  [${label}] 取得失敗 HTTP${status ?? '?'}: ${errMsg}`);
    }
    return { items: [], hadError: status !== 404 };
  }
}

/**
 * アイテムを正規化（割引関連フィールドは不要）
 */
function normalizeItem(raw) {
  return {
    itemCode:     raw.itemCode      ?? '',
    title:        raw.itemName      ?? '',
    currentPrice: raw.itemPrice     ?? 0,
    reviewCount:  raw.reviewCount   ?? 0,
    rating:       raw.reviewAverage ?? 0,
    url:          raw.affiliateUrl  || raw.itemUrl || '',
    image:        raw.mediumImageUrls?.[0]?.imageUrl ?? '',
    shopName:     raw.shopName      ?? '',
  };
}

/**
 * メイン: 全ジャンルの人気商品を収集 → フィルタ → シャッフルして返す
 */
async function getRankedProducts() {
  console.log('\n  ▶ 楽天市場から人気ガジェット商品を収集中（レビュー数降順）...');
  console.log(`  APP_ID: ${process.env.RAKUTEN_APP_ID
    ? '設定済 (' + process.env.RAKUTEN_APP_ID.slice(0, 8) + '...)'
    : '★未設定★'}`);

  const seen     = new Set();
  const rawItems = [];
  let errorCount   = 0;
  let successCount = 0;

  for (const { id, label } of GADGET_GENRES) {
    const { items, hadError } = await fetchPopular(id, label);
    if (hadError) errorCount++;
    else          successCount++;
    for (const item of items) {
      if (item.itemCode && !seen.has(item.itemCode)) {
        seen.add(item.itemCode);
        rawItems.push(item);
      }
    }
    await sleep(1000);
  }

  console.log(`  API結果: 成功 ${successCount}件 / エラー ${errorCount}件`);

  if (errorCount === GADGET_GENRES.length) {
    throw new Error(
      `楽天API: 全${GADGET_GENRES.length}ジャンルで取得失敗。` +
      `RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY を確認してください。`
    );
  }

  console.log(`\n  収集合計: ${rawItems.length}件 → フィルタリング中...`);

  const products = [];
  for (const raw of rawItems) {
    const p = normalizeItem(raw);

    // 品質フィルタ: レビュー100件以上・評価4.0以上
    if (p.reviewCount < 100) continue;
    if (p.rating      < 4.0) continue;

    // URL・価格が取れないものは除外
    if (!p.url || p.currentPrice <= 0) continue;

    products.push(p);
  }

  console.log(`  フィルタ後: ${products.length}件（レビュー100件+ / 評価4.0+）`);

  // シャッフルして返す（毎回ランダムな商品から投稿）
  const shuffled = shuffle(products);
  console.log(`  ランダムシャッフル完了`);
  return shuffled;
}

module.exports = { getRankedProducts };
