require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

// ── リアルなブラウザヘッダー ─────────────────────────────────────
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

function parsePrice(text) {
  if (!text) return null;
  const n = parseFloat(text.replace(/[¥,￥円\s]/g, '').trim());
  return isNaN(n) ? null : n;
}

function makeAmazonUrl(asin, relPath) {
  const tag = process.env.AMAZON_ASSOCIATE_TAG || '';
  const base = asin
    ? `https://www.amazon.co.jp/dp/${asin}`
    : `https://www.amazon.co.jp${(relPath || '/').split('?')[0]}`;
  return tag ? `${base}?tag=${tag}` : base;
}

// ── 汎用フェッチ（リトライ付き）─────────────────────────────────
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
    if ((status === 503 || status === 429) && attempt <= 3) {
      const wait = attempt * 8000;
      console.warn(`  [SCRAPER] HTTP ${status} (試行${attempt}/3) ${wait / 1000}s後リトライ...`);
      await new Promise(r => setTimeout(r, wait));
      return fetchHtml(url, referer, attempt + 1);
    }
    console.warn(`  [SCRAPER] ${err.message} (${url.slice(0, 70)})`);
    return null;
  }
}

// ── Amazon 割引フィルタ検索 ──────────────────────────────────────
// URL に p_n_pct-off-with-tax:2623050051 が含まれる場合、
// 全商品が 30%以上割引 が保証されているため、価格が取得できなくても採用する。
const AMAZON_SEARCH_URL =
  'https://www.amazon.co.jp/s?i=electronics' +
  '&rh=p_n_pct-off-with-tax%3A2623050051%7C2623051051' +
  '&sort=discount-rank&fs=true';

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

    // バッジから割引率を取得
    let discountRate = null;
    $(el).find('.a-badge-text, [class*="savingsPercentage"], span[data-csa-c-badge-type="PERCENT_OFF"]')
      .each((_, badge) => {
        const m = $(badge).text().trim().match(/[-－]?(\d+)%/);
        if (m) { discountRate = parseInt(m[1]); return false; }
      });

    // 価格差から計算
    if (!discountRate && currentPrice && originalPrice && originalPrice > currentPrice) {
      discountRate = Math.round((1 - currentPrice / originalPrice) * 100);
    }

    // ★ 割引フィルタURL使用時の保険: 全商品 30%以上が保証されているので
    //    discountRate が取得できなくても 30 とみなして採用する
    if (!discountRate) discountRate = 30;

    if (discountRate < 30) return;

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

// ── Amazon ベストセラー ──────────────────────────────────────────
const AMAZON_BSR_URL = 'https://www.amazon.co.jp/gp/bestsellers/electronics/';

function parseAmazonBSR(html) {
  const $ = cheerio.load(html);
  const products = [];

  $('[data-asin]').each((_, el) => {
    const asin = $(el).attr('data-asin');
    if (!asin || asin.length < 5) return;

    const title = $(el)
      .find('._cDEzb_p13n-sc-css-line-clamp-1_1Fn1y, .p13n-sc-truncate, [class*="zg-title"]')
      .first().text().trim();
    if (!title) return;

    const currentPrice = parsePrice($(el).find('.a-price .a-offscreen, .p13n-sc-price').first().text());
    const originalPrice = parsePrice($(el).find('.a-text-strike, .a-text-price .a-offscreen').first().text());

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

// ── Kakaku.com フォールバック ────────────────────────────────────
// 複数のパスを順に試す（サイトリニューアル等で変わりやすいため）
const KAKAKU_URLS = [
  'https://kakaku.com/sale/',
  'https://kakaku.com/ranking/',
  'https://kakaku.com/kaden/',
];

async function scrapeKakaku() {
  for (const url of KAKAKU_URLS) {
    console.log(`  [Kakaku] 試行: ${url}`);
    const html = await fetchHtml(url, 'https://kakaku.com/');
    if (!html) continue;

    const $ = cheerio.load(html);
    const products = [];
    const tag = process.env.AMAZON_ASSOCIATE_TAG || '';

    // 複数のセレクタパターンに対応
    const ITEM_SELS = [
      '.itemCard', '.p-itemCard', '.itemSale__item',
      '.saleitem', 'li.itemlist__item', '.rnkBody li',
    ];
    let $items = $();
    for (const sel of ITEM_SELS) {
      const found = $(sel);
      if (found.length > 2) { $items = found; break; }
    }

    if ($items.length === 0) { console.warn(`  [Kakaku] 商品リスト未発見: ${url}`); continue; }

    $items.each((_, el) => {
      const titleEl = $(el).find('[class*="name"] a, [class*="title"] a, h2 a, h3 a').first();
      const title = titleEl.text().trim();
      if (!title || title.length < 3) return;

      const currentPrice = parsePrice(
        $(el).find('[class*="salePrice"], [class*="sale_price"], [class*="nowprice"]').first().text()
      );
      const originalPrice = parsePrice(
        $(el).find('[class*="regular"], [class*="before"], del, s').first().text()
      );
      const offText = $(el).find('[class*="off"], [class*="Off"], [class*="percent"]').first().text();

      let discountRate = null;
      const offMatch = offText.match(/(\d+)%/);
      if (offMatch) discountRate = parseInt(offMatch[1]);
      if (!discountRate && currentPrice && originalPrice && originalPrice > currentPrice) {
        discountRate = Math.round((1 - currentPrice / originalPrice) * 100);
      }
      if (!discountRate || discountRate < 30) return;

      const q = encodeURIComponent(title.slice(0, 50));
      products.push({
        asin: '',
        title,
        currentPrice,
        originalPrice,
        discountRate,
        url: `https://www.amazon.co.jp/s?k=${q}${tag ? '&tag=' + tag : ''}`,
        image: $(el).find('img').first().attr('src') || '',
      });
    });

    if (products.length > 0) {
      console.log(`  [Kakaku] ${products.length} 件取得 (${url})`);
      return products;
    }
    console.warn(`  [Kakaku] 30%以上割引商品が見つからず: ${url}`);
  }
  return [];
}

// ── メイン ───────────────────────────────────────────────────────
async function scrapeProducts() {
  // 1. Amazon 割引フィルタ検索
  console.log('  [Amazon 割引検索] 取得中...');
  const searchHtml = await fetchHtml(AMAZON_SEARCH_URL, 'https://www.amazon.co.jp/');
  if (searchHtml) {
    const products = parseAmazonSearch(searchHtml);
    if (products.length > 0) {
      products.sort((a, b) => b.discountRate - a.discountRate);
      console.log(`  → ${products.length} 件取得 (Amazon 割引検索)`);
      return products;
    }
    console.warn('  [Amazon 割引検索] 商品なし → BSR に切替');
  }

  // 2. Amazon ベストセラー
  console.log('  [Amazon BSR] 取得中...');
  const bsrHtml = await fetchHtml(AMAZON_BSR_URL, 'https://www.amazon.co.jp/');
  if (bsrHtml) {
    const products = parseAmazonBSR(bsrHtml);
    if (products.length > 0) {
      products.sort((a, b) => b.discountRate - a.discountRate);
      console.log(`  → ${products.length} 件取得 (Amazon BSR)`);
      return products;
    }
    console.warn('  [Amazon BSR] 30%以上割引商品なし → Kakaku に切替');
  }

  // 3. Kakaku.com フォールバック
  console.log('  [Kakaku.com] フォールバック取得中...');
  const kakakuProducts = await scrapeKakaku();
  if (kakakuProducts.length > 0) {
    kakakuProducts.sort((a, b) => b.discountRate - a.discountRate);
    return kakakuProducts;
  }

  console.error('  全ソースで商品取得に失敗しました。');
  return [];
}

module.exports = { scrapeProducts };
