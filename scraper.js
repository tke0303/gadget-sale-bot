/**
 * scraper.js  ─  楽天市場 API からガジェットセール商品を取得して返す
 *
 * 使用API: Rakuten IchibaItem/Search/20220601 (2026-05-13〜新エンドポイント)
 *
 * 必須フィルタ:
 *   - レビュー件数 100件以上
 *   - 評価 4.0以上
 *   - 割引率 20%以上（タイトルの「XX%OFF」から抽出 ─ API は割引フィールドを返さない）
 *
 * スコアリング: discountRate × log10(reviewCount + 1) × reviewAverage
 *   → 割引率が高く、レビューが多く、評価が高い商品を優先
 *
 * 返却する product オブジェクト:
 *   { itemCode, title, currentPrice, originalPrice, discountRate,
 *     reviewCount, rating, score, url, image, shopName }
 */
require('dotenv').config();
const axios = require('axios');

// 2026-05-13 新エンドポイント（旧 app.rakuten.co.jp は廃止）
const RAKUTEN_SEARCH_URL =
  'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';

// ガジェット系ジャンルID（楽天市場 2026年版）
// ※ "OFF"キーワードと組み合わせてセール品を検索
const GADGET_GENRES = [
  { id: '211742', label: 'TV・オーディオ・カメラ' },  // 旧213310(0件)→修正
  { id: '564500', label: 'スマホ・タブレット'      },  // 旧560741(404)→修正
  { id: '100026', label: 'PC・周辺機器'            },  // 旧101240(誤分類)→修正
  { id: '100433', label: 'カメラ・光学機器'        },  // 動作確認済み
  { id: '200162', label: 'イヤホン・ヘッドホン'    },  // 動作確認済み
];

// 割引率の最小しきい値（タイトルから抽出した値と比較）
const MIN_DISCOUNT_RATE = 20;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 商品タイトルから割引率を抽出する
 * 例: "超お得！50%OFF Bluetooth..." → 50
 *     "3割引き 高評価..."          → 30  (「N割」も対応)
 */
function extractDiscountFromTitle(title) {
  if (!title) return 0;
  // "XX%OFF" / "XX% OFF" / "XX%オフ" / "XX%off"
  const pctMatch = title.match(/(\d+)\s*%\s*(OFF|オフ|off)/i);
  if (pctMatch) return parseInt(pctMatch[1], 10);
  // "X割" / "X割引" (3割=30%, 5割=50%)
  const wariMatch = title.match(/([1-9])\s*割/);
  if (wariMatch) return parseInt(wariMatch[1], 10) * 10;
  return 0;
}

/**
 * 楽天検索API呼び出し
 * keyword='OFF' を付けてセール品を優先的に取得
 */
async function searchByGenre(genreId, label, page = 1) {
  // 新認証方式（2026-05-13〜）
  //   - applicationId / accessKey → クエリパラメータ
  //   - 検索条件                 → クエリパラメータ（GETリクエスト）
  //
  // ⚠️ Referer・Origin はアプリ登録URL（gadget-gekiyasu.com）を指定
  //   Origin が欠けると REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING になる
  const params = {
    applicationId: process.env.RAKUTEN_APP_ID,
    accessKey:     process.env.RAKUTEN_ACCESS_KEY,
    genreId,
    keyword:       'OFF',            // "XX%OFF" の商品を優先取得
    hits:          30,
    page,
    availability:  1,                // 在庫あり
    sort:          '-reviewCount',   // レビュー数降順
    format:        'json',
  };

  // アフィリエイトIDが設定されている場合のみ追加
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
    console.log(`  [${label}] ${items.length}件取得 (page ${page})`);
    return { items: items.map(i => i.Item ?? i), hadError: false };
  } catch (err) {
    const status  = err.response?.status;
    const errBody = err.response?.data;
    const errDetail = typeof errBody === 'string'
      ? errBody.slice(0, 300)
      : JSON.stringify(errBody ?? {}).slice(0, 300);
    const errMsg = errBody?.errors?.errorMessage || errBody?.error_description || errBody?.error || err.message;
    if (status === 404) {
      console.log(`  [${label}] ジャンルID ${genreId} は存在しません。スキップ`);
    } else {
      console.warn(`  [${label}] 取得失敗 HTTP${status ?? '?'}: ${errMsg}`);
      console.warn(`  [${label}] エラー詳細: ${errDetail}`);
    }
    return { items: [], hadError: status !== 404 };
  }
}

/**
 * アイテムをフィルタ・正規化してスコア付きオブジェクトに変換
 */
function normalizeItem(raw) {
  const reviewCount   = raw.reviewCount   ?? 0;
  const reviewAverage = raw.reviewAverage ?? 0;
  const itemPrice     = raw.itemPrice     ?? 0;
  // 楽天APIは discountPrice / discountRate を返さないケースが多い
  const discountPrice = raw.discountPrice ?? 0;
  const discountRate  = raw.discountRate  ?? 0;

  // 割引率の確定:
  //   1. APIフィールド（discountRate）
  //   2. 価格差から計算（discountPrice > itemPrice）
  //   3. 商品タイトルから "XX%OFF" を抽出（楽天では最も一般的）
  let finalDiscountRate = discountRate;
  let originalPrice     = discountPrice > 0 ? discountPrice : null;

  if (!finalDiscountRate && discountPrice > itemPrice) {
    finalDiscountRate = Math.round((1 - itemPrice / discountPrice) * 100);
  }
  if (!finalDiscountRate) {
    finalDiscountRate = extractDiscountFromTitle(raw.itemName);
  }

  // スコア = 割引率 × log10(レビュー数+1) × 評価
  const score = finalDiscountRate
    ? Math.round(finalDiscountRate * Math.log10(reviewCount + 1) * reviewAverage * 10) / 10
    : 0;

  // アフィリエイトURL（設定がなければ通常URL）
  const url = raw.affiliateUrl || raw.itemUrl || '';

  // 商品画像（mediumImageUrls の先頭）
  const image = raw.mediumImageUrls?.[0]?.imageUrl ?? '';

  return {
    itemCode:      raw.itemCode   ?? '',
    title:         raw.itemName   ?? '',
    currentPrice:  itemPrice,
    originalPrice,
    discountRate:  finalDiscountRate,
    reviewCount,
    rating:        reviewAverage,
    score,
    url,
    image,
    shopName:      raw.shopName   ?? '',
  };
}

/**
 * メイン: 全ジャンルを横断して条件を満たす商品を収集・スコアリング
 */
async function scrapeProducts() {
  console.log('\n  ▶ 楽天市場APIからガジェット商品を収集中...');
  console.log(`  APP_ID: ${process.env.RAKUTEN_APP_ID
    ? '設定済 (' + process.env.RAKUTEN_APP_ID.slice(0, 8) + '...)'
    : '★未設定★'}`);
  console.log(`  ACCESS_KEY: ${process.env.RAKUTEN_ACCESS_KEY
    ? '設定済 (' + process.env.RAKUTEN_ACCESS_KEY.length + '文字)'
    : '★未設定★'}`);

  const seen     = new Set();
  const rawItems = [];
  let errorCount   = 0;
  let successCount = 0;

  for (const { id, label } of GADGET_GENRES) {
    const { items, hadError } = await searchByGenre(id, label);
    if (hadError) errorCount++;
    else          successCount++;
    for (const item of items) {
      if (item.itemCode && !seen.has(item.itemCode)) {
        seen.add(item.itemCode);
        rawItems.push(item);
      }
    }
    await sleep(1500); // API レート制限対策
  }

  console.log(`  API結果: 成功 ${successCount}件 / エラー ${errorCount}件`);

  // 全ジャンルでエラーの場合はワークフローを失敗（赤）にする
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

    // 必須フィルタ①: レビュー100件以上
    if (p.reviewCount < 100) continue;

    // 必須フィルタ②: 評価4.0以上
    if (p.rating < 4.0) continue;

    // 必須フィルタ③: 割引率 MIN_DISCOUNT_RATE% 以上（タイトルから抽出）
    if (p.discountRate < MIN_DISCOUNT_RATE) continue;

    // URL・価格が取れないものは除外
    if (!p.url || p.currentPrice <= 0) continue;

    products.push(p);
    console.log(
      `  ✅ ${p.discountRate}%OFF | ⭐${p.rating}(${p.reviewCount}件)` +
      ` | score:${p.score} | ${p.title.slice(0, 40)}`
    );
  }

  // スコア降順でソート
  products.sort((a, b) => b.score - a.score);
  console.log(`\n  合計 ${products.length} 件` +
    ` (条件クリア: 割引${MIN_DISCOUNT_RATE}%+ / レビュー100件+ / 評価4.0+)`);
  return products;
}

module.exports = { scrapeProducts };
