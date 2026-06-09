require('dotenv').config();
const { getRankedProducts }                              = require('./ranker');   // X/Threads用: ランキングAPI
const { scrapeProducts }                                 = require('./scraper');  // WordPress用: セール検索API
const { generateComment, generateArticleIntro,
        generateSNSPost, generateProductArticle }        = require('./claude');
const { postTweet }                                      = require('./twitter');
const { postThreads }                                    = require('./threads');
const { postArticle }                                    = require('./wordpress');
const { filterUnposted, markAsPosted }                   = require('./posted-items');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── X/Threads 投稿（1回 = 1商品）────────────────────────────────
async function runTweetPost() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`実行日時 (UTC): ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n[1/3] 楽天市場ランキングから人気ガジェットを取得中...');
  const allProducts = await getRankedProducts();

  if (allProducts.length === 0) {
    console.log('人気商品が見つかりませんでした。終了します。');
    return;
  }

  // 2日以内に投稿済みの商品を除外（シャッフル済みリストから先頭を選択）
  const fresh = filterUnposted(allProducts);
  if (fresh.length === 0) {
    console.log('未投稿の商品がありません（全て2日以内に投稿済み）。終了します。');
    return;
  }

  const product = fresh[0];
  console.log(`  → 選択: ${product.title.slice(0, 50)}`);
  console.log(`    評価: ⭐${product.rating?.toFixed(1)}（${product.reviewCount?.toLocaleString()}件）`);

  console.log('\n[2/3] ClaudeでSNS投稿文を生成中...');
  product.comment = await generateSNSPost(product);
  console.log(`  投稿文:\n${product.comment}`);

  console.log('\n[3/3] X(Twitter) と Threads に同時投稿中...');
  const [twitterResult, threadsResult] = await Promise.allSettled([
    postTweet(product),
    postThreads(product),
  ]);

  if (twitterResult.status === 'rejected') throw twitterResult.reason;
  if (threadsResult.status === 'rejected') throw threadsResult.reason;

  markAsPosted(product.itemCode);
  console.log('✅ 投稿完了！（X + Threads）');
}

// ── WordPress記事投稿（1日1回・単品レビュー形式）────────────────
async function runArticlePost() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`実行日時 (UTC): ${new Date().toISOString()}`);
  console.log('WordPress記事投稿を開始します...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n[1/3] 楽天市場からセール商品を取得中...');
  const allProducts = await scrapeProducts();

  if (allProducts.length === 0) {
    console.log('セール商品が見つかりませんでした。終了します。');
    return;
  }

  // スコア最上位の商品1件を選択してレビュー記事を作成
  const product = allProducts[0];
  console.log(`  → 選択商品: ${product.title.slice(0, 60)}`);
  console.log(`    ${product.discountRate}%OFF | ⭐${product.rating?.toFixed(1)}（${product.reviewCount?.toLocaleString()}件）| score: ${product.score}`);

  console.log('\n[2/3] Claudeでレビュー記事を生成中...');
  const articleData = await generateProductArticle(product);
  console.log(`  タイトルサフィックス: ${articleData.titleSuffix}`);
  console.log(`  導入文: ${articleData.intro}`);
  console.log(`  魅力: ${articleData.appeals.map(a => a.title).join(' / ')}`);

  console.log('\n[3/3] WordPressに記事を投稿中...');
  const result = await postArticle(product, articleData);
  console.log(`✅ 記事投稿成功！ ID: ${result.id}, URL: ${result.link}`);
}

module.exports = { runTweetPost, runArticlePost };
