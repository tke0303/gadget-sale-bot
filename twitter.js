require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

function getClient() {
  return new TwitterApi({
    appKey:       process.env.TWITTER_API_KEY,
    appSecret:    process.env.TWITTER_API_SECRET,
    accessToken:  process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  });
}

/**
 * ツイート本文を組み立てる
 *
 * Twitter の文字数カウント:
 *   - 通常文字: 1文字 = 1カウント
 *   - 全角文字: 1文字 = 1カウント (Twitterは全角も1)
 *   - URL: 長さに関わらず 23 カウント (t.co 変換)
 *   - 上限: 280
 *
 * 構成:
 *   タイトル(最大20文字) + 価格 + 評価 + コメント(最大30文字) + URL + ハッシュタグ
 *   実測 ≈ 130〜150カウント (URLは23カウント換算)
 *
 * フォーマット例:
 *   【🔥楽天セール】
 *   商品名（20文字）
 *
 *   ¥13,980 → ¥1,399（90%OFF）
 *   ⭐4.5（30,104件）
 *
 *   💁‍♂️ 一言コメント
 *
 *   👉 URL
 *
 *   #楽天 #セール #ガジェット #広告
 */
function buildTweetText(product) {
  // タイトルは全角20文字まで
  const title = product.title.length > 20
    ? product.title.slice(0, 20) + '…'
    : product.title;

  // 価格表示: 元値 → 現在値（XX%OFF）
  let priceLine;
  if (product.currentPrice && product.originalPrice) {
    priceLine =
      `¥${product.originalPrice.toLocaleString()} → ¥${product.currentPrice.toLocaleString()}` +
      `（${product.discountRate}%OFF）`;
  } else if (product.currentPrice) {
    priceLine = `¥${product.currentPrice.toLocaleString()}（${product.discountRate}%OFF）`;
  } else {
    priceLine = `${product.discountRate}%OFF 🎉`;
  }

  // 評価・レビュー行
  const ratingLine = (product.rating && product.reviewCount)
    ? `⭐${product.rating.toFixed(1)}（${product.reviewCount.toLocaleString()}件）`
    : '';

  // コメントは最大30文字
  let commentLine = '';
  if (product.comment) {
    const c = product.comment.length > 30
      ? product.comment.slice(0, 30) + '…'
      : product.comment;
    commentLine = `💁‍♂️ ${c}`;
  }

  const lines = [
    `【🔥楽天セール】`,
    title,
    ``,
    priceLine,
    ratingLine,
    ``,
    commentLine,
    ``,
    `👉 ${product.url}`,
    ``,
    `#楽天 #セール #ガジェット #広告`,
  ].filter(l => l !== null && l !== undefined);

  return lines.join('\n');
}

async function postTweet(product) {
  const client = getClient();

  // 認証情報の確認ログ（先頭数文字のみ表示）
  const ak  = process.env.TWITTER_API_KEY            || '';
  const at  = process.env.TWITTER_ACCESS_TOKEN       || '';
  console.log(`Twitter API_KEY 先頭: ${ak.slice(0,6)}... (${ak.length}文字)`);
  console.log(`Twitter ACCESS_TOKEN 先頭: ${at.slice(0,10)}... (${at.length}文字)`);

  const text = buildTweetText(product);
  console.log('\n投稿内容:\n' + text);
  console.log(`\n文字数（raw）: ${text.length} / URLを23換算した実効カウント参考値`);

  // v2 API でツイート投稿
  try {
    const result = await client.readWrite.v2.tweet(text);
    console.log(`✅ 投稿成功！ tweet_id: ${result.data?.id}`);
  } catch (err) {
    // 詳細なエラー情報を出力
    console.error(`Twitter投稿失敗 HTTP ${err.code}: ${err.data?.title}`);
    console.error(`  detail : ${err.data?.detail}`);
    if (err.data?.errors) console.error(`  errors : ${JSON.stringify(err.data.errors)}`);

    if (err.code === 403) {
      console.error('');
      console.error('【403エラーの対処法】');
      console.error('Access Token が Read-only で生成されている可能性があります。');
      console.error('Twitter Developer Portal → Keys and Tokens →');
      console.error('「Access Token and Secret」の Regenerate を実行してください。');
    }
    throw err;
  }
}

module.exports = { postTweet, buildTweetText };
