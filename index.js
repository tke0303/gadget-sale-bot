require('dotenv').config();
const { scrapeProducts }               = require('./scraper');
const { generateComment, generateArticleIntro } = require('./claude');
const { postTweet }                    = require('./twitter');
const { postThreads }                  = require('./threads');
const { postArticle }                  = require('./wordpress');
const { filterUnposted, markAsPosted } = require('./posted-items');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── ツイート投稿（1回 = 1商品）──────────────────────────────────
async function runTweetPost() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`実行日時 (UTC): ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n[1/3] 楽天市場からセール商品を取得中...');
  const allProducts = await scrapeProducts();

  if (allProducts.length === 0) {
    console.log('セール商品が見つかりませんでした。終了します。');
    return;
  }

  // 2日以内に投稿済みの商品を除外
  const fresh = filterUnposted(allProducts);
  if (fresh.length === 0) {
    console.log('未投稿の商品がありません（全て2日以内に投稿済み）。終了します。');
    return;
  }

  // スコア最上位の商品を1件選択
  const product = fresh[0];
  console.log(`  → 選択: ${product.title.slice(0, 50)} (${product.discountRate}%OFF / score:${product.score})`);

  console.log('\n[2/3] Claudeでコメントを生成中...');
  product.comment = await generateComment(product);
  console.log(`  コメント: ${product.comment}`);

  console.log('\n[3/3] X(Twitter) と Threads に同時投稿中...');
  const [twitterResult, threadsResult] = await Promise.allSettled([
    postTweet(product),
    postThreads(product),
  ]);

  // X の失敗は致命的エラー（必須）
  if (twitterResult.status === 'rejected') {
    throw twitterResult.reason;
  }
  // Threads の失敗もエラーとして扱う（トークン設定済みの場合）
  if (threadsResult.status === 'rejected') {
    throw threadsResult.reason;
  }

  // 投稿済みとして記録
  markAsPosted(product.itemCode);
  console.log('✅ 投稿完了！（X + Threads）');
}

// ── WordPress記事投稿（1日1回・割引率ランキング形式）────────────
async function runArticlePost() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`実行日時 (UTC): ${new Date().toISOString()}`);
  console.log('WordPress記事投稿を開始します...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n[1/4] 楽天市場からセール商品を取得中...');
  const allProducts = await scrapeProducts();

  if (allProducts.length === 0) {
    console.log('セール商品が見つかりませんでした。終了します。');
    return;
  }

  // 割引率降順でソートして上位10件を選択
  const top10 = [...allProducts]
    .sort((a, b) => b.discountRate - a.discountRate)
    .slice(0, 10);
  console.log(`  掲載商品: ${top10.length}件（割引率順）`);
  top10.forEach((p, i) =>
    console.log(`  ${i + 1}位: ${p.discountRate}%OFF | ${p.title.slice(0, 40)}`)
  );

  console.log('\n[2/4] Claudeで記事導入文を生成中...');
  const introText = await generateArticleIntro(top10);
  console.log(`  導入文: ${introText}`);

  console.log('\n[3/4] Claudeで各商品のコメントを生成中...');
  for (let i = 0; i < top10.length; i++) {
    const p = top10[i];
    p.comment = await generateComment(p);
    console.log(`  [${i + 1}/${top10.length}] ${p.title.slice(0, 35)}: ${p.comment}`);
    await sleep(500);
  }

  console.log('\n[4/4] WordPressに記事を投稿中...');
  const result = await postArticle(top10, introText);
  console.log(`✅ 記事投稿成功！ ID: ${result.id}, URL: ${result.link}`);
}

module.exports = { runTweetPost, runArticlePost };
