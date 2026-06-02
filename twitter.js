require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

// ── 遅延初期化：Twitter Secrets が不要なワークフローでクラッシュしないようにする
function getClient() {
  return new TwitterApi({
    appKey:       process.env.TWITTER_API_KEY,
    appSecret:    process.env.TWITTER_API_SECRET,
    accessToken:  process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  });
}

function buildTweetText(product) {
  // タイトルは50文字まで
  const title = product.title.length > 50
    ? product.title.slice(0, 50) + '…'
    : product.title;

  // 価格表示: 定価 → 現在値（XX%OFF）
  let priceLine;
  if (product.currentPrice && product.originalPrice) {
    priceLine =
      `¥${product.originalPrice.toLocaleString()} → ` +
      `¥${product.currentPrice.toLocaleString()}（${product.discountRate}%OFF）`;
  } else if (product.currentPrice) {
    priceLine = `¥${product.currentPrice.toLocaleString()}（${product.discountRate}%OFF）`;
  } else {
    priceLine = `${product.discountRate}%OFF 🎉`;
  }

  // 評価・レビュー行
  const ratingLine = (product.rating && product.reviewCount)
    ? `⭐${product.rating.toFixed(1)}（${product.reviewCount.toLocaleString()}件）`
    : '';

  // Claudeコメント
  const commentLine = product.comment ? `\n💁‍♂️「${product.comment}」` : '';

  return (
    `【🔥ガジェットセール】\n` +
    `${title}\n\n` +
    `${priceLine}\n` +
    (ratingLine ? `${ratingLine}\n` : '') +
    `${commentLine}\n\n` +
    `👇 楽天で見る\n` +
    `${product.url}\n\n` +
    `#楽天 #ガジェット #セール #広告`
  );
}

async function postTweet(product) {
  const rwClient = getClient().readWrite;
  const text = buildTweetText(product);
  console.log('\n投稿内容:\n' + text);
  await rwClient.v2.tweet(text);
}

module.exports = { postTweet, buildTweetText };
