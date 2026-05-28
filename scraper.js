/**
 * scraper.js  ─  価格.com 売れ筋ランキング × 値下がり情報から
 *                Amazon アフィリエイトリンク（ASIN形式）を付与して返す
 *
 * 品質フィルタ:
 *   1. 価格.com IT家電ランキング 上位300位以内
 *   2. 値下がり率 30% 以上
 *   3. Amazon レビュー件数 100件以上（取得できた場合のみ適用）
 *
 * スコアリング: (301 - rankPosition) × discountRate の降順
 *
 * 将来 PA-API が使えるようになったらこのファイルだけ差し替える。
 * 返却する product オブジェクト:
 *   { asin, title, currentPrice, originalPrice, discountRate,
 *     rankPosition, reviewCount, rating, score, url, image }
 */
require('dotenv').config();
const axios   = require('axios');
const cheerio = require('cheerio');
const iconv   = require('iconv-lite');

// ── ブラウザ偽装ヘッダー ────────────────────────────────────────
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,' +
    'image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':  'ja,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding':  'gzip, deflate',
  'sec-ch-ua':        '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest':   'document',
  'sec-fetch-mode':   'navigate',
  'sec-fetch-site':   'none',
  'sec-fetch-user':   '?1',
  'upgrade-insecure-requests': '1',
  'Cache-Control':    'max-age=0',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 価格文字列 → 数値 */
function parsePrice(text) {
  if (!text) return null;
  const n = parseFloat(text.replace(/[¥,￥円\s税込()〜]/g, '').trim());
  return isNaN(n) ? null : n;
}

/** ASIN → Amazon アフィリエイトURL（dp形式固定、amzn.to 短縮なし）*/
function makeAmazonUrl(asin) {
  const tag = process.env.AMAZON_ASSOCIATE_TAG || '';
  return `https://www.amazon.co.jp/dp/${asin}${tag ? '?tag=' + tag : ''}`;
}

/** Content-Type or <meta charset> から文字コードを検出 */
function detectCharset(contentType, buffer) {
  if (contentType) {
    const m = contentType.match(/charset=([^\s;]+)/i);
    if (m) return m[1].toLowerCase().replace('_', '-');
  }
  const head = buffer.slice(0, 2000).toString('ascii');
  const m2   = head.match(/charset=["']?([^"';\s>]+)/i);
  if (m2) return m2[1].toLowerCase().replace('_', '-');
  return 'utf-8';
}

/** 文字列から Amazon ASIN を探す（直接URL / URLエンコード済み両対応）*/
function findAsinInStr(str) {
  if (!str) return null;
  let m = str.match(/amazon\.co\.jp\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  if (m) return m[1];
  m = str.match(/dp(?:%252F|%2F)([A-Z0-9]{10})/i);
  if (m) return m[1];
  return null;
}

// ── 汎用フェッチ（Shift-JIS対応 + 指数バックオフリトライ）────────
async function fetchHtml(url, referer, attempt = 1) {
  try {
    const res = await axios.get(url, {
      headers:      { ...HEADERS, Referer: referer },
      timeout:      25000,
      decompress:   true,
      maxRedirects: 5,
      responseType: 'arraybuffer',
    });
    const buffer  = Buffer.from(res.data);
    const charset = detectCharset(res.headers['content-type'] || '', buffer);
    const decoded = iconv.decode(buffer, charset);
    if (!decoded) {
      console.warn(`  [FETCH] デコード失敗: ${url.slice(0, 70)}`);
      return null;
    }
    return decoded;
  } catch (err) {
    const status = err.response?.status;
    if ((status === 503 || status === 429) && attempt <= 3) {
      const wait = attempt * 6000;
      console.warn(`  [FETCH] HTTP ${status} → ${wait / 1000}s 待機 (${attempt}/3)`);
      await sleep(wait);
      return fetchHtml(url, referer, attempt + 1);
    }
    if (status !== 404) {
      console.warn(`  [FETCH] ${err.message} | ${url.slice(0, 70)}`);
    }
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 1 ─ 売れ筋ランキングマップを構築（IT家電 top 300）
// ══════════════════════════════════════════════════════════════

/**
 * 価格.com IT家電ランキングを順にフェッチして
 * Map<kakakuItemId, rankPosition> を構築する（最大 maxRank 件）
 * 取得順序 = ランキング順位（1位から）
 */
async function buildRankMap(maxRank = 300) {
  const rankMap = new Map(); // itemId → rankPosition (1-based)
  const BASE    = 'https://kakaku.com/ranking/kaden_ict/';

  for (let page = 1; rankMap.size < maxRank; page++) {
    const url  = page === 1 ? BASE : `${BASE}?page=${page}`;
    console.log(`  [ranking] p${page} 取得中...`);

    const html = await fetchHtml(url, 'https://kakaku.com/ranking/');
    if (!html) break;

    const $    = cheerio.load(html);
    const seen = new Set();
    let   added = 0;

    // ページ上の /item/K... リンクを出現順にランキング番号として記録
    $('a[href*="/item/K"]').each((_, el) => {
      if (rankMap.size >= maxRank) return false;
      const href = $(el).attr('href') || '';
      const m    = href.match(/\/item\/(K\d+)/);
      if (!m || seen.has(m[1]) || rankMap.has(m[1])) return;
      seen.add(m[1]);
      rankMap.set(m[1], rankMap.size + 1);
      added++;
    });

    console.log(`  [ranking] p${page}: +${added}件 (累計 ${rankMap.size}件)`);
    if (added === 0) break; // ページ末尾
    if (rankMap.size < maxRank) await sleep(1200);
  }

  console.log(`  [ranking] ランキングマップ完成: ${rankMap.size}件`);
  return rankMap;
}

// ══════════════════════════════════════════════════════════════
// STEP 2 ─ 値下がりページから割引候補を収集
// ══════════════════════════════════════════════════════════════

function extractProductLinks(html, sourceLabel) {
  const $ = cheerio.load(html);
  const seen  = new Set();
  const links = [];

  $('a[href*="/item/K"]').each((_, el) => {
    let href = $(el).attr('href') || '';
    if (!href.startsWith('http')) href = 'https://kakaku.com' + href;

    const m = href.match(/\/item\/(K\d+)/);
    if (!m || seen.has(m[1])) return;
    seen.add(m[1]);

    const kakakuUrl  = `https://kakaku.com/item/${m[1]}/`;
    const $container = $(el).closest('li, tr, div');
    const priceText  = $container.find('[class*="price"],[class*="Price"]').first().text();
    const dropText   = $container.find('[class*="down"],[class*="off"],[class*="Down"],[class*="Off"]').text();
    const dm         = dropText.match(/(\d+)%/);

    links.push({
      kakakuUrl,
      hintTitle:    $(el).text().trim().replace(/\s+/g, ' '),
      hintPrice:    parsePrice(priceText),
      hintDiscount: dm ? parseInt(dm[1]) : null,
    });
  });

  console.log(`  [${sourceLabel}] ${links.length}件`);
  return links;
}

const PRICEDOWN_URLS = [
  { url: 'https://kakaku.com/pricedown/pricedown.asp?ca=0004', label: '値下がり IT/PC' },
  { url: 'https://kakaku.com/pricedown/pricedown.asp',         label: '値下がり 全般' },
  { url: 'https://kakaku.com/pricedown/',                      label: '値下がり Root' },
];

async function discoverPricedownCandidates() {
  for (const { url, label } of PRICEDOWN_URLS) {
    const html = await fetchHtml(url, 'https://kakaku.com/');
    if (!html) { await sleep(1000); continue; }
    const links = extractProductLinks(html, label);
    if (links.length >= 3) return links;
    await sleep(1000);
  }
  return [];
}

// ══════════════════════════════════════════════════════════════
// STEP 3 ─ Amazon レビューデータ取得（オプション）
// ══════════════════════════════════════════════════════════════

/**
 * Amazon 商品ページからレビュー件数・評価を取得する。
 * GitHub Actions の IP ブロック時は null を返す（フィルタをスキップ）。
 * タイムアウト 8秒・リトライなし で素早く諦める。
 */
async function fetchAmazonReviewData(asin) {
  const url = `https://www.amazon.co.jp/dp/${asin}`;
  try {
    const res = await axios.get(url, {
      headers:      { ...HEADERS, Referer: 'https://www.amazon.co.jp/' },
      timeout:      8000,
      decompress:   true,
      maxRedirects: 3,
      responseType: 'arraybuffer',
    });
    const buffer  = Buffer.from(res.data);
    const charset = detectCharset(res.headers['content-type'] || '', buffer);
    const html    = iconv.decode(buffer, charset);
    if (!html) return null;

    const $ = cheerio.load(html);

    // レビュー件数
    const reviewRaw = (
      $('#acrCustomerReviewText').text() ||
      $('[data-hook="total-review-count"]').text() ||
      ''
    ).replace(/[,，, ]/g, '');
    const countM     = reviewRaw.match(/(\d+)/);
    const reviewCount = countM ? parseInt(countM[1]) : null;

    // 評価（5段階）
    const ratingRaw = (
      $('span[data-hook="rating-out-of-text"]').text() ||
      $('#acrPopover').attr('title') ||
      $('i.a-icon-star span.a-icon-alt').first().text() ||
      ''
    );
    const ratingM = ratingRaw.match(/(\d+\.?\d*)/);
    const rating  = ratingM ? parseFloat(ratingM[1]) : null;

    if (!reviewCount && !rating) return null;
    return { reviewCount, rating };
  } catch {
    return null; // ブロック・タイムアウトは静かにスキップ
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 4 ─ 価格.com 商品詳細ページ取得
// ══════════════════════════════════════════════════════════════

async function fetchKakakuDetail(kakakuUrl) {
  const html = await fetchHtml(kakakuUrl, 'https://kakaku.com/');
  if (!html) return null;

  const $ = cheerio.load(html);

  // タイトル
  const title = (
    $('h1.itmNm').text() ||
    $('[class*="itemName"] h1').text() ||
    $('#itemName').text() ||
    $('h1').first().text()
  ).trim().replace(/\s+/g, ' ');
  if (!title || title.length < 3) return null;

  // 最安値
  const currentPrice =
    parsePrice($('em.prc').first().text()) ||
    parsePrice($('.cheapPrice em').first().text()) ||
    parsePrice($('#cheapPrice em').first().text()) ||
    parsePrice($('#priceTable td.price').first().text()) ||
    null;

  // メーカー希望小売価格
  const originalPrice =
    parsePrice($('#makerHopPrice dd').first().text()) ||
    parsePrice($('[class*="makerPrice"] dd').first().text()) ||
    parsePrice($('[id*="makerPrice"]').first().text()) ||
    parsePrice($('dd[class*="reference"]').first().text()) ||
    null;

  // 割引率
  let discountRate = null;
  if (currentPrice && originalPrice && originalPrice > currentPrice) {
    discountRate = Math.round((1 - currentPrice / originalPrice) * 100);
  }
  if (!discountRate) {
    const sm = $('[class*="down"],[class*="off"]').text().match(/(\d+)%/);
    if (sm) discountRate = parseInt(sm[1]);
  }

  // ASIN 抽出（複数戦略）
  let asin = null;

  // 1. href 属性
  $('a').each((_, el) => {
    if (asin) return false;
    const href = $(el).attr('href') || '';
    const direct = findAsinInStr(href);
    if (direct) { asin = direct; return false; }
    if (href.includes('url=')) {
      try {
        const base     = href.startsWith('http') ? href : `https://kakaku.com${href}`;
        const urlParam = new URL(base).searchParams.get('url') || '';
        const found    = findAsinInStr(urlParam);
        if (found) { asin = found; return false; }
      } catch (_) {}
      const encoded = findAsinInStr(href);
      if (encoded) { asin = encoded; return false; }
    }
  });

  // 2. onclick 属性
  if (!asin) {
    $('[onclick]').each((_, el) => {
      if (asin) return false;
      const onclick = $(el).attr('onclick') || '';
      const found   = findAsinInStr(onclick);
      if (found) { asin = found; return false; }
      try {
        const f2 = findAsinInStr(decodeURIComponent(onclick));
        if (f2) { asin = f2; return false; }
      } catch (_) {}
    });
  }

  // 3. data-* 属性
  if (!asin) {
    $('[data-url],[data-href],[data-link]').each((_, el) => {
      if (asin) return false;
      for (const attr of ['data-url', 'data-href', 'data-link']) {
        const found = findAsinInStr($(el).attr(attr) || '');
        if (found) { asin = found; return false; }
      }
    });
  }

  // 4. HTML 全文検索（最終手段）
  if (!asin) {
    const full = $.html();
    const m1 = full.match(/amazon\.co\.jp\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (m1) asin = m1[1];
  }
  if (!asin) {
    const full = $.html();
    const m2 = full.match(/dp(?:%252F|%2F)([A-Z0-9]{10})/i);
    if (m2) asin = m2[1];
  }

  // 商品画像
  const image = (
    $('img#ItemPhoto').attr('src') ||
    $('#main_photo img').attr('src') ||
    $('[class*="mainPhoto"] img,[class*="MainPhoto"] img').first().attr('src') ||
    $('img[class*="itemImg"],img[class*="ItemImg"]').first().attr('src') ||
    ''
  );

  return { title, currentPrice, originalPrice, discountRate, asin, image };
}

// ══════════════════════════════════════════════════════════════
// MAIN ─ 全体フロー
// ══════════════════════════════════════════════════════════════

async function scrapeProducts() {
  // ── ① ランキングマップ構築（top 300）──
  console.log('\n  ▶ 価格.com IT家電ランキングを収集中 (top 300)...');
  const rankMap = await buildRankMap(300);

  // ── ② 値下がり候補を収集 ──
  console.log('\n  ▶ 価格.com 値下がり商品を収集中...');
  const pricedownCandidates = await discoverPricedownCandidates();

  // ── ③ 候補をマージ（ランキング順 + 値下がりアノテーション）──
  const pricedownById = new Map();
  for (const c of pricedownCandidates) {
    const id = c.kakakuUrl.match(/\/item\/(K\d+)/)?.[1];
    if (id) pricedownById.set(id, c);
  }

  const allCandidates = [];
  const addedIds      = new Set();

  // ランキング上位から追加（値下がりヒントをマージ）
  for (const [itemId, rank] of rankMap) {
    const pd = pricedownById.get(itemId);
    allCandidates.push({
      kakakuUrl:    `https://kakaku.com/item/${itemId}/`,
      rankPosition: rank,
      hintTitle:    pd?.hintTitle    ?? '',
      hintPrice:    pd?.hintPrice    ?? null,
      hintDiscount: pd?.hintDiscount ?? null,
    });
    addedIds.add(itemId);
  }

  // 値下がりページのみにあるアイテム（ランク外）を末尾に追加
  for (const c of pricedownCandidates) {
    const id = c.kakakuUrl.match(/\/item\/(K\d+)/)?.[1];
    if (id && !addedIds.has(id)) {
      allCandidates.push({ ...c, rankPosition: null });
    }
  }

  // ④ 並べ替え: 順位昇順（1位が先）、同順位なら割引ヒントが高い方優先
  allCandidates.sort((a, b) => {
    const rA = a.rankPosition ?? 9999;
    const rB = b.rankPosition ?? 9999;
    if (rA !== rB) return rA - rB;
    return (b.hintDiscount ?? 0) - (a.hintDiscount ?? 0);
  });

  const inRankCount = allCandidates.filter(c => c.rankPosition !== null && c.rankPosition <= 300).length;
  console.log(`\n  候補合計: ${allCandidates.length}件 (ランキング300位内: ${inRankCount}件)`);

  // ── ⑤ 詳細取得 + 3段階フィルタリング（最大30件調査）──
  console.log('\n  ▶ 詳細取得・品質フィルタリング中 (最大30件)...');
  const products = [];

  for (const { kakakuUrl, hintTitle, hintPrice, hintDiscount, rankPosition } of allCandidates.slice(0, 30)) {
    await sleep(1200);

    const label  = (hintTitle || '').slice(0, 35) || kakakuUrl.slice(-25);
    const detail = await fetchKakakuDetail(kakakuUrl);

    if (!detail) { console.log(`  ○ 取得失敗: ${label}`); continue; }
    if (!detail.asin) {
      console.log(`  ○ ASIN なし: ${detail.title.slice(0, 35)}`);
      continue;
    }

    // フィルタ①: 値下がり率 30% 以上
    const discountRate = detail.discountRate ?? hintDiscount;
    if (!discountRate || discountRate < 30) {
      console.log(`  ○ 割引${discountRate ?? '?'}% < 30%: ${detail.title.slice(0, 30)}`);
      continue;
    }

    // フィルタ②: ランキング300位以内（ランク外アイテムはフォールバックとして通す）
    if (rankPosition !== null && rankPosition > 300) {
      console.log(`  ○ ランク${rankPosition}位 > 300: ${detail.title.slice(0, 30)}`);
      continue;
    }

    // フィルタ③: Amazon レビュー件数 100件以上（取得できた場合のみ適用）
    let reviewCount = null, rating = null;
    const amazonData = await fetchAmazonReviewData(detail.asin);
    if (amazonData) {
      reviewCount = amazonData.reviewCount;
      rating      = amazonData.rating;
      if (reviewCount !== null && reviewCount < 100) {
        console.log(`  ○ レビュー${reviewCount}件 < 100件: ${detail.title.slice(0, 30)}`);
        continue;
      }
    }

    // スコア = (301 - rank) × discountRate
    // ランク外は rank=300 扱いで低スコアのフォールバック
    const effectiveRank = rankPosition ?? 300;
    const score = (301 - Math.min(effectiveRank, 300)) * discountRate;

    const rankStr   = rankPosition ? `${rankPosition}位` : 'ランク外';
    const reviewStr = reviewCount  ? `${reviewCount}件`  : '未取得';
    console.log(
      `  ✅ ${detail.asin} | rank:${rankStr} | ${discountRate}%OFF` +
      ` | reviews:${reviewStr} | score:${score}` +
      ` | ${detail.title.slice(0, 35)}`
    );

    products.push({
      asin:          detail.asin,
      title:         detail.title,
      currentPrice:  detail.currentPrice ?? hintPrice,
      originalPrice: detail.originalPrice,
      discountRate,
      rankPosition:  rankPosition ?? null,
      reviewCount,
      rating,
      score,
      url:           makeAmazonUrl(detail.asin),
      image:         detail.image,
    });

    if (products.length >= 10) break;
  }

  // スコア降順でソート（ランキング順位 × 値下がり率）
  products.sort((a, b) => b.score - a.score);
  console.log(`\n  合計 ${products.length} 件 (スコア順: ランク × 値下がり率)`);
  return products;
}

module.exports = { scrapeProducts };
