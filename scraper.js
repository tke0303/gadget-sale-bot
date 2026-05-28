require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

// ── リアルなブラウザに近い完全ヘッダー ──────────────────────────
const CHROME_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,' +
    'image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'Cache-Control': 'max-age=0',
};

// ── 試行するデータソース ─────────────────────────────────────────
const SOURCES = [
  // 1. Amazon 割引フィルタ検索
  {
    label: 'Amazon 割引検索',
    url: 'https://www.amazon.co.jp/s?i=electronics' +
         '&rh=p_n_pct-off-with-tax%3A2623050051%7C2623051051' +
         '&sort=discount-rank&fs=true',
    referer: 'https://www.amazon.co.jp/',
    parser: parseAmazonSearch,
  },
  // 2. Amazon ベストセラー（よりキャッシュが強い）
  {
    label: 'Amazon BSR',
    url: 'https://www.amazon.co.jp/gp/bestsellers/electronics/',
    referer: 'https://www.amazon.co.jp/',
    parser: parseAmazonBSR,
  },
  // 3. Kakaku.com セール（Amazon が完全ブロック時の保険）
  {
    label: 'Kakaku.com',
    url: 'https://kakaku.com/sale/kaden/',
    referer: 'https://kakaku.com/',
    parser: parseKakaku,
  },
];

// ── 汎用フェッチ ─────────────────────────────────────────────────
async function fetchHtml(url, referer, attempt = 1) {
  const headers = { ...CHROME_HEADERS, Referer: referer };
  try {
    const res = await axios.get(url, { headers, timeout: 30000 });
    const blocked =
      res.data.includes('robot check') ||
      res.data.includes('captcha') ||
      res.data.includes('CAPTCHA') ||
      res.data.includes('Sorry, we just need to make sure you');
    if (blocked) {
      console.warn(`  [SCRAPER] ボット検出: ${url.slice(0, 60)}`);
      return null;
    }
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    // 503 / 429 → バックオフリトライ
    if ((status === 503 || status === 429 || status === 403) && attempt <= 3) {
      const wait = attempt * 8000;
      console.warn(`  [SCRAPER] HTTP ${status} (試行${attempt}/3), ${wait / 1000}s 後リトライ...`);
      await new Promise(r => setTimeout(r, wait));
      return fetchHtml(url, referer, attempt + 1);
    }
    console.warn(`  [SCRAPER] ${err.message} (${url.slice(0, 60)})`);
    return null;
  }
}

// ── ユーティリティ ───────────────────────────────────────────────
function parsePrice(text) {
  if (!text) return null;
  const n = parseFloat(text.replace(/[¥,￥円\s]/g, '').trim());
  return isNaN(n) ? null : n;
}

function makeAmazonUrl(asin, relPath) {
  const tag = process.env.AMAZON_ASSOCIATE_TAG || '';
  const base = asin
    ? `https://www.amazon.co.jp/dp/${asin}`
    : `https://www.amazon.co.jp${relPath.split('?')[0]}`;
  return tag ? `${base}?tag=${tag}` : base;
}

// ── パーサー: Amazon 割引検索 ────────────────────────────────────
function parseAmazonSearch(html) {
  const $ = cheerio.load(html);
  const products = [];

  $('[data-component-type="s-search-result"][data-asin]').each((_, el) => {
    const asin = $(el).attr('data-asin');
    if (!asin) return;

    const title = $(el).find('h2 a span').first().text().trim();
    if (!title) return;

    const currentPrice = parsePrice($(el).find('.a-price .a-offscreen').first().text());
    const originalPrice = parsePrice($(el).find('.a-text-price .a-offscreen').first().text());

    // -XX% バッジを探す
    let discountRate = null;
    $(el).find('.a-badge-text, [class*="savingsPercentage"]').each((_, badge) => {
      const m = $(badge).text().trim().match(/[-－]?(\d+)%/);
      if (m) { discountRate = parseInt(m[1]); return false; }
    });
    // バッジがなければ価格差から計算
    if (!discountRate && currentPrice && originalPrice && originalPrice > currentPrice) {
      discountRate = Math.round((1 - currentPrice / originalPrice) * 100);
    }

    if (!discountRate || discountRate < 30) return;

    const relUrl = $(el).find('h2 a').attr('href') || `/dp/${asin}`;
    products.push({
      asin,
      title,
      currentPrice,
      originalPrice,
      discountRate,
      url: makeAmazonUrl(asin, relUrl),
      image: $(el).find('.s-image').attr('src') || '',
    });
  });

  return products;
}

// ── パーサー: Amazon ベストセラー ────────────────────────────────
function parseAmazonBSR(html) {
  const $ = cheerio.load(html);
  const products = [];

  $('[data-asin]').each((_, el) => {
    const asin = $(el).attr('data-asin');
    if (!asin || asin.length < 5) return;

    const title = $(el)
      .find('.p13n-sc-truncate, [class*="zg-title"], ._cDEzb_p13n-sc-css-line-clamp-1_1Fn1y')
      .first().text().trim();
    if (!title) return;

    const currentPrice = parsePrice(
      $(el).find('.a-price .a-offscreen, .p13n-sc-price').first().text()
    );
    const originalPrice = parsePrice(
      $(el).find('.a-text-strike, .a-text-price .a-offscreen').first().text()
    );

    let discountRate = null;
    if (currentPrice && originalPrice && originalPrice > currentPrice) {
      discountRate = Math.round((1 - currentPrice / originalPrice) * 100);
    }

    if (!discountRate || discountRate < 30) return;

    products.push({
      asin,
      title,
      currentPrice,
      originalPrice,
      discountRate,
      url: makeAmazonUrl(asin, ''),
      image: $(el).find('img').first().attr('src') || '',
    });
  });

  return products;
}

// ── パーサー: Kakaku.com セールページ ────────────────────────────
function parseKakaku(html) {
  const $ = cheerio.load(html);
  const products = [];
  const tag = process.env.AMAZON_ASSOCIATE_TAG || '';

  // よくあるセレクタパターンを順に試す
  const ITEM_SELS = ['.itemCard', '.p-itemCard', '.itemSale__item', 'li.itemlist__item', 'article'];
  let $items = $();
  for (const sel of ITEM_SELS) {
    const found = $(sel);
    if (found.length > 2) { $items = found; break; }
  }

  $items.each((_, el) => {
    const titleEl = $(el)
      .find('[class*="name"] a, [class*="title"] a, h2 a, h3 a')
      .first();
    const title = titleEl.text().trim();
    if (!title || title.length < 3) return;

    const currentPrice = parsePrice(
      $(el).find('[class*="salePrice"], [class*="sale_price"], [class*="nowprice"]').first().text()
    );
    const originalPrice = parsePrice(
      $(el).find('[class*="regular"], del, s, [class*="base"], [class*="before"]').first().text()
    );
    const offText = $(el).find('[class*="off"], [class*="Off"], [class*="percent"]').first().text();

    let discountRate = null;
    const offMatch = offText.match(/(\d+)%/);
    if (offMatch) discountRate = parseInt(offMatch[1]);
    if (!discountRate && currentPrice && originalPrice && originalPrice > currentPrice) {
      discountRate = Math.round((1 - currentPrice / originalPrice) * 100);
    }

    if (!discountRate || discountRate < 30) return;

    // Kakaku.com は ASIN を持たないため Amazon 検索リンクを生成
    const q = encodeURIComponent(title.slice(0, 50));
    const url = `https://www.amazon.co.jp/s?k=${q}${tag ? '&tag=' + tag : ''}`;

    products.push({
      asin: '',
      title,
      currentPrice,
      originalPrice,
      discountRate,
      url,
      image: $(el).find('img').first().attr('src') || '',
    });
  });

  return products;
}

// ── メイン: 全ソースを順番に試す ────────────────────────────────
async function scrapeProducts() {
  for (const src of SOURCES) {
    console.log(`  [${src.label}] 取得中... ${src.url.slice(0, 60)}`);
    const html = await fetchHtml(src.url, src.referer);
    if (!html) { console.warn(`  [${src.label}] ページ取得失敗 → 次のソースへ`); continue; }

    const products = src.parser(html);
    if (products.length === 0) {
      console.warn(`  [${src.label}] 30%以上割引の商品が見つからず → 次のソースへ`);
      continue;
    }

    products.sort((a, b) => b.discountRate - a.discountRate);
    console.log(`  → ${products.length} 件取得 (${src.label})`);
    return products;
  }

  console.error('  全ソースで商品取得に失敗しました。');
  return [];
}

module.exports = { scrapeProducts };
