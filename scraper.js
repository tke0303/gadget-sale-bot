/**
 * scraper.js  ─  楽天市場 API からガジェットセール商品を取得して返す
 *
 * 使用API: Rakuten IchibaItem/Search/20170706
 *
 * 必須フィルタ:
 *   - レビュー件数 100件以上
 *   - 評価 4.0以上
 *   - 割引率 30%以上
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

// ガジェット系ジャンルID（楽天市場）
const GADGET_GENRES = [
  { id: '213310', label: 'AV・デジモノ'       },
  { id: '560741', label: 'スマホ・タブレット'  },
  { id: '101240', label: 'PC・周辺機器'        },
  { id: '100433', label: 'カメラ・光学機器'    },
  { id: '200162', label: 'イヤホン・ヘッドホン'},
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 楽天検索API呼び出し
 * ジャンルごとにレビュー数・評価でソートして取得
 */
async function searchByGenre(genreId, label, page = 1) {
  // 新認証方式（2026-05-13〜）
  //   - applicationId / accessKey → クエリパラメータ（必須）
  //   - httpReferrer              → POSTボディの requestContext オブジェクト内
  //   - 検索条件                  → POSTボディ（フラット）
  const queryParams = new URLSearchParams({
    applicationId: process.env.RAKUTEN_APP_ID,
    accessKey:     process.env.RAKUTEN_ACCESS_KEY,
  });

  // エラーコード REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING の命名規則から
  // httpReferrer は requestContext オブジェクト内に入れる必要がある
  const body = {
    requestContext: {
      httpReferrer: 'https://gadget-gekiyasu.com',
    },
    genreId,
    hits:         30,
    page,
    availability: 1,              // 在庫あり
    sort:         '-reviewCount', // レビュー数降順
    format:       'json',
  };

  // アフィリエイトIDが設定されている場合のみ追加
  if (process.env.RAKUTEN_AFFILIATE_ID) {
    body.affiliateId = process.env.RAKUTEN_AFFILIATE_ID;
  }

  try {
    const res = await axios.post(`${RAKUTEN_SEARCH_URL}?${queryParams}`, body, {
      headers: {
        'Content-Type': 'application/json',
        'Referer':      'https://gadget-gekiyasu.com',
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
  const discountPrice = raw.discountPrice ?? 0;  // 0のとき未設定
  const discountRate  = raw.discountRate  ?? 0;  // 0のとき未設定

  // 割引率の確定: APIフィールドを優先、なければ価格から計算
  let finalDiscountRate = discountRate;
  let originalPrice     = discountPrice > 0 ? discountPrice : null;

  if (!finalDiscountRate && discountPrice > itemPrice) {
    finalDiscountRate = Math.round((1 - itemPrice / discountPrice) * 100);
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
  console.log(`  APP_ID: ${process.env.RAKUTEN_APP_ID ? '設定済 (' + process.env.RAKUTEN_APP_ID.slice(0, 8) + '...)' : '★未設定★'}`);
  console.log(`  ACCESS_KEY: ${process.env.RAKUTEN_ACCESS_KEY ? '設定済 (' + process.env.RAKUTEN_ACCESS_KEY.length + '文字)' : '★未設定★'}`);

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
    await sleep(1500); // API レート制限対策（新API: 429対応で間隔延長）
  }

  console.log(`  API結果: 成功 ${successCount}件 / エラー ${errorCount}件`);

  // 全ジャンルでエラーが発生した場合はワークフローを失敗させる（赤にする）
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
    if (p.reviewCount < 100) {
      continue;
    }

    // 必須フィルタ②: 評価4.0以上
    if (p.rating < 4.0) {
      continue;
    }

    // 必須フィルタ③: 割引率30%以上
    if (p.discountRate < 30) {
      continue;
    }

    // URL・価格が取れないものは除外
    if (!p.url || p.currentPrice <= 0) {
      continue;
    }

    products.push(p);
    console.log(
      `  ✅ ${p.discountRate}%OFF | ⭐${p.rating}(${p.reviewCount}件)` +
      ` | score:${p.score} | ${p.title.slice(0, 40)}`
    );
  }

  // スコア降順でソート
  products.sort((a, b) => b.score - a.score);
  console.log(`\n  合計 ${products.length} 件 (条件クリア: 割引30%+ / レビュー100件+ / 評価4.0+)`);
  return products;
}

module.exports = { scrapeProducts };
