require('dotenv').config();
const { scrapeProducts } = require('./scraper');
const { generateComment } = require('./claude');
const { postTweet } = require('./twitter');
const { postArticle } = require('./wordpress');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 10 scheduled UTC hours → JST: 08, 10, 12, 13, 15, 17, 19, 20, 21, 23
const TWEET_HOURS_UTC = [23, 1, 3, 4, 6, 8, 10, 11, 12, 14];

function getSlotIndex() {
  const h = new Date().getUTCHours();
  const idx = TWEET_HOURS_UTC.indexOf(h);
  return idx >= 0 ? idx : 0;
}

// ── ツイート投稿（1回 = 1商品）──────────────────────────────────
async function runTweetPost() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`実行日時 (UTC): ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n[1/3] Amazonからセール商品を取得中...');
  const products = await scrapeProducts();
  if (products.length === 0) {
    console.log('セール商品が見つかりませんでした。終了します。');
    return;
  }

  const slotIdx = getSlotIndex();
  const product = products[slotIdx % products.length];
  console.log(`  スロット: ${slotIdx} → ${product.title.slice(0, 50)} (${product.discountRate}%OFF)`);

  console.log('\n[2/3] Claudeでコメントを生成中...');
  product.comment = await generateComment(product);
  console.log(`  コメント: ${product.comment}`);

  console.log('\n[3/3] X(Twitter)に投稿中...');
  await postTweet(product);
  console.log('✅ ツイート投稿成功！');
}

// ── WordPress記事投稿（1日1回）──────────────────────────────────
async function runArticlePost() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`実行日時 (UTC): ${new Date().toISOString()}`);
  console.log('WordPress記事投稿を開始します...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n[1/3] Amazonからセール商品を取得中...');
  const products = await scrapeProducts();
  if (products.length === 0) {
    console.log('セール商品が見つかりませんでした。終了します。');
    return;
  }

  const top10 = products.slice(0, 10);
  console.log(`  記事に掲載する商品: ${top10.length}件`);

  console.log('\n[2/3] Claudeで各商品のコメントを生成中...');
  for (let i = 0; i < top10.length; i++) {
    const p = top10[i];
    p.comment = await generateComment(p);
    console.log(`  [${i + 1}/${top10.length}] ${p.title.slice(0, 30)}: ${p.comment}`);
    await sleep(800);
  }

  console.log('\n[3/3] WordPressに記事を投稿中...');
  const result = await postArticle(top10);
  console.log(`✅ 記事投稿成功！ ID: ${result.id}, URL: ${result.link}`);
}

module.exports = { runTweetPost, runArticlePost };
