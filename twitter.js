require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

// ── 遅延初期化：Twitter Secrets が不要なワークフロー（WordPress記事投稿等）で
//    このモジュールを読み込んでもクラッシュしないようにする
function getClient() {
  return new TwitterApi({
    appKey:      process.env.TWITTER_API_KEY,
    appSecret:   process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  });
}

function buildTweetText(product) {
  const title = product.title.length > 50
    ? product.title.slice(0, 50) + '…'
    : product.title;

  // 価格表示：定価→現在値（割引率）
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

  const commentLine = product.comment ? `${product.comment}\n\n` : '';

  return (
    `【🔥ガジェットセール】\n` +
    `${title}\n` +
    `${priceLine}\n\n` +
    `${commentLine}` +
    `👇 Amazonで見る\n` +
    `${product.url}\n\n` +
    `#Amazon #ガジェット #セール #広告`
  );
}

async function postTweet(product) {
  const rwClient = getClient().readWrite;
  const text = buildTweetText(product);
  console.log('\n投稿内容:\n' + text);
  await rwClient.v2.tweet(text);
}

module.exports = { postTweet, buildTweetText };
