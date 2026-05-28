require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

// Electronics 30%+, 50%+ off, sorted by discount rate
const SEARCH_URL =
  'https://www.amazon.co.jp/s' +
  '?i=electronics' +
  '&rh=p_n_pct-off-with-tax%3A2623050051%7C2623051051' +
  '&sort=discount-rank' +
  '&fs=true';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
};

function parsePrice(text) {
  const n = parseFloat(text.replace(/[¥,￥\s]/g, '').trim());
  return isNaN(n) ? null : n;
}

async function fetchPage(url, attempt = 1) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 30000 });
    // Amazon sometimes returns CAPTCHA page
    if (res.data.includes('robot check') || res.data.includes('captcha')) {
      console.warn('  [SCRAPER] CAPTCHA detected');
      return null;
    }
    return res.data;
  } catch (err) {
    if (attempt < 3) {
      console.warn(`  [SCRAPER] Error (attempt ${attempt}): ${err.message}. Retrying in 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      return fetchPage(url, attempt + 1);
    }
    console.error(`  [SCRAPER] Failed after 3 attempts: ${err.message}`);
    return null;
  }
}

async function scrapeProducts() {
  console.log(`  Fetching: ${SEARCH_URL}`);
  const html = await fetchPage(SEARCH_URL);
  if (!html) return [];

  const $ = cheerio.load(html);
  const products = [];
  const tag = process.env.AMAZON_ASSOCIATE_TAG || '';

  $('[data-component-type="s-search-result"][data-asin]').each((_, el) => {
    const asin = $(el).attr('data-asin');
    if (!asin) return;

    // Title
    const title = $(el).find('h2 a span').first().text().trim();
    if (!title) return;

    // Current price: first .a-price .a-offscreen
    const currentPriceText = $(el).find('.a-price .a-offscreen').first().text();
    const currentPrice = parsePrice(currentPriceText);

    // Original strike-through price
    const origPriceText = $(el).find('.a-text-price .a-offscreen').first().text();
    const originalPrice = parsePrice(origPriceText);

    // Savings badge (e.g. "-42%")
    let discountRate = null;
    $(el).find('.a-badge-text, .a-color-price').each((_, badge) => {
      const t = $(badge).text().trim();
      const m = t.match(/[-－](\d+)%/);
      if (m) { discountRate = parseInt(m[1]); return false; }
    });

    // Compute from prices if badge not found
    if (!discountRate && currentPrice && originalPrice && originalPrice > currentPrice) {
      discountRate = Math.round((1 - currentPrice / originalPrice) * 100);
    }

    if (!discountRate || discountRate < 30) return;

    const relUrl = $(el).find('h2 a').attr('href') || `/dp/${asin}`;
    const url = `https://www.amazon.co.jp${relUrl.split('?')[0]}${tag ? '?tag=' + tag : ''}`;
    const image = $(el).find('.s-image').attr('src') || '';

    products.push({
      asin,
      title,
      currentPrice,
      originalPrice,
      discountRate,
      url,
      image,
    });
  });

  // Sort by discount rate descending
  products.sort((a, b) => b.discountRate - a.discountRate);
  console.log(`  → ${products.length} products with 30%+ discount found`);
  return products;
}

module.exports = { scrapeProducts };
