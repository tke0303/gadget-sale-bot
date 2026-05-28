/**
 * scraper.js  ─  価格.com から値下がりガジェット情報を取得し
 *                Amazon アフィリエイトリンク（ASIN形式）を付与して返す
 *
 * 将来 PA-API が使えるようになったらこのファイルだけ差し替える。
 * 返却する product オブジェクトの形式は変わらない:
 *   { asin, title, currentPrice, originalPrice, discountRate, url, image }
 */
require('dotenv').config();
const axios   = require('axios');
const cheerio = require('cheerio');
const iconv   = require('iconv-lite');

// ── ブラウザ偽装ヘッダー（brotli除外でCI環境のデコードエラーを防ぐ）─
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,' +
    'image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':  'ja,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding':  'gzip, deflate',   // brotli(br)を除外
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

/** URL から Amazon ASIN (10文字) を抽出 */
function extractAsin(url) {
  if (!url) return null;
  const m = url.match(/amazon\.co\.jp\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return m ? m[1] : null;
}

/** URL エンコード済み文字列から ASIN を抽出 */
function extractAsinEncoded(str) {
  if (!str) return null;
  // dp%2F または dp%252F (二重エンコード)
  const m = str.match(/dp(?:%252F|%2F)([A-Z0-9]{10})/i);
  return m ? m[1] : null;
}

/** ASIN → Amazon アフィリエイトURL（amzn.to 短縮なし、dp形式固定）*/
function makeAmazonUrl(asin) {
  const tag = process.env.AMAZON_ASSOCIATE_TAG || '';
  return `https://www.amazon.co.jp/dp/${asin}${tag ? '?tag=' + tag : ''}`;
}

// ── 文字コード検出（Content-Type ヘッダー or <meta charset>）───────
function detectCharset(contentType, buffer) {
  // 1. Content-Type ヘッダーから
  if (contentType) {
    const m = contentType.match(/charset=([^\s;]+)/i);
    if (m) return m[1].toLowerCase().replace('_', '-');
  }
  // 2. HTML 先頭 2000バイトの <meta charset> から
  const head = buffer.slice(0, 2000).toString('ascii');
  const m2 = head.match(/charset=["']?([^"';\s>]+)/i);
  if (m2) return m2[1].toLowerCase().replace('_', '-');
  // 3. デフォルトは UTF-8
  return 'utf-8';
}

// ── 汎用フェッチ（Shift-JIS対応 + 指数バックオフリトライ付き）─────
async function fetchHtml(url, referer, attempt = 1) {
  try {
    const res = await axios.get(url, {
      headers:      { ...HEADERS, Referer: referer },
      timeout:      25000,
      decompress:   true,
      maxRedirects: 5,
      responseType: 'arraybuffer',   // バイナリで受け取る
    });

    const buffer      = Buffer.from(res.data);
    const contentType = res.headers['content-type'] || '';
    const charset     = detectCharset(contentType, buffer);

    // iconv-lite で正しいエンコーディングにデコード
    const decoded = iconv.decode(buffer, charset);
    if (typeof decoded !== 'string' || decoded.length === 0) {
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
    if (status !== 404) {  // 404は静かに握りつぶす
      console.warn(`  [FETCH] ${err.message} | ${url.slice(0, 70)}`);
    }
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// STEP 1 ─ 価格.com の値下がりページから商品URLを収集
// ══════════════════════════════════════════════════════════════

/**
 * 価格.com の各ページから /item/K…/ 形式の商品URLを抽出する。
 * 同時に、ページ上に割引率・価格が表示されていれば合わせて取得する。
 */
function extractProductLinks(html, sourceLabel) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const links = [];

  $('a[href*="/item/K"]').each((_, el) => {
    let href = $(el).attr('href') || '';
    if (!href.startsWith('http')) href = 'https://kakaku.com' + href;

    // /item/KXXXXXXXXXX/ の形に正規化
    const m = href.match(/\/item\/(K\d+)/);
    if (!m || seen.has(m[1])) return;
    seen.add(m[1]);

    const kakakuUrl  = `https://kakaku.com/item/${m[1]}/`;
    const $container = $(el).closest('li, tr, div');

    // ページ上の割引・価格情報（なければ null）
    const priceText  = $container.find('[class*="price"],[class*="Price"]').first().text();
    const dropText   = $container.find('[class*="down"],[class*="off"],[class*="Down"],[class*="Off"]').text();
    const dm         = dropText.match(/(\d+)%/);
    const hintDiscount = dm ? parseInt(dm[1]) : null;
    const hintPrice    = parsePrice(priceText);
    const hintTitle    = $(el).text().trim().replace(/\s+/g, ' ') || '';

    links.push({ kakakuUrl, hintTitle, hintPrice, hintDiscount });
  });

  console.log(`  [${sourceLabel}] 商品リンク: ${links.length} 件`);
  return links;
}

// 価格.com 値下がり情報ページ（優先順）
const PRICEDOWN_URLS = [
  { url: 'https://kakaku.com/pricedown/pricedown.asp?ca=0004', label: '値下がり IT/PC' },
  { url: 'https://kakaku.com/pricedown/pricedown.asp',         label: '値下がり 全般' },
  { url: 'https://kakaku.com/pricedown/',                      label: '値下がり Root' },
  { url: 'https://kakaku.com/ranking/kaden_ict/',              label: 'ランキング IT家電' },
  { url: 'https://kakaku.com/ranking/',                        label: 'ランキング 全般' },
];

async function discoverProducts() {
  for (const { url, label } of PRICEDOWN_URLS) {
    console.log(`  [kakaku] ${label}: ${url}`);
    const html = await fetchHtml(url, 'https://kakaku.com/');
    if (!html) continue;

    const links = extractProductLinks(html, label);
    if (links.length >= 3) {   // 値下がりページは件数が少ないので閾値を下げる
      // ヒント割引率の高い順に並べ替え（既に判明しているもの優先）
      links.sort((a, b) => (b.hintDiscount || 0) - (a.hintDiscount || 0));
      return links;
    }
    await sleep(1000);
  }
  return [];
}

// ══════════════════════════════════════════════════════════════
// STEP 2 ─ 価格.com 商品詳細ページから価格・ASIN を取得
// ══════════════════════════════════════════════════════════════

/**
 * テキスト or href から ASIN を探す共通ヘルパー
 */
function findAsinInStr(str) {
  if (!str) return null;
  // 直接 amazon.co.jp/dp/XXXXXXXXXX
  let m = str.match(/amazon\.co\.jp\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  if (m) return m[1];
  // URL エンコード済み: dp%2F or dp%252F
  m = str.match(/dp(?:%252F|%2F)([A-Z0-9]{10})/i);
  if (m) return m[1];
  return null;
}

/**
 * 価格.com の商品詳細ページを解析して以下を返す:
 *   title, currentPrice, originalPrice, discountRate, asin, image
 */
async function fetchKakakuDetail(kakakuUrl) {
  const html = await fetchHtml(kakakuUrl, 'https://kakaku.com/');
  if (!html) return null;

  const $ = cheerio.load(html);

  // ── タイトル ──
  const title = (
    $('h1.itmNm').text() ||
    $('[class*="itemName"] h1').text() ||
    $('#itemName').text() ||
    $('h1').first().text()
  ).trim().replace(/\s+/g, ' ');
  if (!title || title.length < 3) return null;

  // ── 最安値（現在価格）──
  const currentPrice =
    parsePrice($('em.prc').first().text()) ||
    parsePrice($('.cheapPrice em').first().text()) ||
    parsePrice($('#cheapPrice em').first().text()) ||
    parsePrice($('#priceTable td.price').first().text()) ||
    null;

  // ── 参考価格・定価（メーカー希望小売価格）──
  const originalPrice =
    parsePrice($('#makerHopPrice dd').first().text()) ||
    parsePrice($('[class*="makerPrice"] dd').first().text()) ||
    parsePrice($('[id*="makerPrice"]').first().text()) ||
    parsePrice($('dd[class*="reference"]').first().text()) ||
    null;

  // ── 割引率 ──
  let discountRate = null;
  if (currentPrice && originalPrice && originalPrice > currentPrice) {
    discountRate = Math.round((1 - currentPrice / originalPrice) * 100);
  }
  // 値下がり情報ページ由来のテキストがあれば補完
  if (!discountRate) {
    const savingsText = $('[class*="down"],[class*="off"]').text();
    const sm = savingsText.match(/(\d+)%/);
    if (sm) discountRate = parseInt(sm[1]);
  }

  // ── Amazon ASIN ──
  // 価格.com のショップリンクは href / onclick / data-* いずれかに埋め込まれている
  let asin = null;

  // 1. href 属性（直接 or url= パラメータ）
  $('a').each((_, el) => {
    if (asin) return false;
    const href = $(el).attr('href') || '';

    // 直接 Amazon URL
    const direct = findAsinInStr(href);
    if (direct) { asin = direct; return false; }

    // リダイレクト URL に url= パラメータが含まれる場合
    if (href.includes('url=')) {
      try {
        const base     = href.startsWith('http') ? href : `https://kakaku.com${href}`;
        const urlParam = new URL(base).searchParams.get('url') || '';
        const found    = findAsinInStr(urlParam);
        if (found) { asin = found; return false; }
      } catch (_) { /* ignore parse error */ }
      // URL エンコードがネストしている場合も findAsinInStr でカバー済み
      const encoded = findAsinInStr(href);
      if (encoded) { asin = encoded; return false; }
    }
  });

  // 2. onclick 属性（価格.com は jumpToShop() に URL を埋め込む）
  if (!asin) {
    $('[onclick]').each((_, el) => {
      if (asin) return false;
      const onclick = $(el).attr('onclick') || '';
      const found   = findAsinInStr(onclick);
      if (found) { asin = found; return false; }
      // onclick 内の URL デコード試行
      try {
        const decoded = decodeURIComponent(onclick);
        const f2 = findAsinInStr(decoded);
        if (f2) { asin = f2; return false; }
      } catch (_) { /* ignore */ }
    });
  }

  // 3. data-* 属性
  if (!asin) {
    $('[data-url],[data-href],[data-link]').each((_, el) => {
      if (asin) return false;
      for (const attr of ['data-url', 'data-href', 'data-link']) {
        const val = $(el).attr(attr) || '';
        const found = findAsinInStr(val);
        if (found) { asin = found; return false; }
      }
    });
  }

  // 4. HTML 全体から正規表現で検索（最終手段）
  if (!asin) {
    const fullHtml = $.html();
    const m = fullHtml.match(/amazon\.co\.jp\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (m) asin = m[1];
  }

  // 5. HTML 全体の URL エンコード済みパターン（最終手段 その2）
  if (!asin) {
    const fullHtml = $.html();
    const m = fullHtml.match(/dp(?:%252F|%2F)([A-Z0-9]{10})/i);
    if (m) asin = m[1];
  }

  // ── 商品画像 ──
  const image = (
    $('img#ItemPhoto').attr('src') ||
    $('#main_photo img').attr('src') ||
    $('[class*="mainPhoto"] img, [class*="MainPhoto"] img').first().attr('src') ||
    $('img[class*="itemImg"], img[class*="ItemImg"]').first().attr('src') ||
    ''
  );

  return { title, currentPrice, originalPrice, discountRate, asin, image };
}

// ══════════════════════════════════════════════════════════════
// MAIN ─ 全体フロー
// ══════════════════════════════════════════════════════════════
async function scrapeProducts() {
  // ── 商品候補を収集 ──
  console.log('\n  ▶ 価格.com から商品候補を収集中...');
  const candidates = await discoverProducts();

  if (candidates.length === 0) {
    console.error('  [scraper] 価格.com から商品リンクを取得できませんでした');
    return [];
  }

  // ── 各商品の詳細を取得（最大25件を調査して10件以上集める）──
  console.log(`\n  ▶ 詳細ページを取得中 (最大25件調査)...`);
  const products = [];

  for (const { kakakuUrl, hintTitle, hintPrice, hintDiscount } of candidates.slice(0, 25)) {
    await sleep(1200);  // 価格.com へのリクエスト間隔

    const label = hintTitle.slice(0, 35) || kakakuUrl.slice(-25);
    const detail = await fetchKakakuDetail(kakakuUrl);

    if (!detail) { console.log(`  ○ 取得失敗: ${label}`); continue; }

    // ASIN なし → Amazon リンクが生成できないのでスキップ
    if (!detail.asin) {
      console.log(`  ○ ASIN なし: ${detail.title.slice(0, 35)}`);
      continue;
    }

    // 割引率 < 30% → スキップ
    const discountRate = detail.discountRate || hintDiscount;
    if (!discountRate || discountRate < 30) {
      console.log(`  ○ 割引${discountRate ?? '?'}% < 30%: ${detail.title.slice(0, 30)}`);
      continue;
    }

    const product = {
      asin:          detail.asin,
      title:         detail.title,
      currentPrice:  detail.currentPrice  ?? hintPrice,
      originalPrice: detail.originalPrice,
      discountRate,
      url:           makeAmazonUrl(detail.asin),
      image:         detail.image,
    };

    products.push(product);
    console.log(`  ✅ ${detail.asin} | ${discountRate}%OFF | ${detail.title.slice(0, 40)}`);

    if (products.length >= 10) break;
  }

  products.sort((a, b) => b.discountRate - a.discountRate);
  console.log(`\n  合計 ${products.length} 件 (30%以上割引, Amazon ASIN 付き)`);
  return products;
}

module.exports = { scrapeProducts };
