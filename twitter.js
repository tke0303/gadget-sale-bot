require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

const client = new TwitterApi({
  appKey:      process.env.TWITTER_API_KEY,
  appSecret:   process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});
const rwClient = client.readWrite;

function buildTweetText(product) {
  const title = product.title.length > 45
    ? product.title.slice(0, 45) + '…'
    : product.title;

  const currentStr = product.currentPrice
    ? `¥${product.currentPrice.toLocaleString()}`
    : '価格を確認';
  const origStr = product.originalPrice
    ? `¥${product.originalPrice.toLocaleString()}`
    : '';

  const priceLine = origStr
    ? `定価 ${origStr} → 今だけ ${currentStr}`
    : `価格 ${currentStr}`;

  const commentLine = product.comment ? `💬 ${product.comment}\n\n` : '';

  return (
    `🔥 ${product.discountRate}%OFF【Amazon激安ガジェット】\n\n` +
    `${title}\n\n` +
    `${commentLine}` +
    `${priceLine}\n` +
    `🛒 ${product.url}\n\n` +
    `#ガジェット #Amazon激安 #セール #お得`
  );
}

async function postTweet(product) {
  const text = buildTweetText(product);
  console.log('\n投稿内容:\n' + text);
  await rwClient.v2.tweet(text);
}

module.exports = { postTweet, buildTweetText };
