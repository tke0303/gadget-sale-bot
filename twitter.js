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

function buildTweetText(product) {
  const title = product.title.length > 50
    ? product.title.slice(0, 50) + '…'
    : product.title;

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

  const ratingLine = (product.rating && product.reviewCount)
    ? `⭐${product.rating.toFixed(1)}（${product.reviewCount.toLocaleString()}件）`
    : '';

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
  const client = getClient();

  // ── デバッグ: 認証情報の確認 ──────────────────────────────────
  const apiKey       = process.env.TWITTER_API_KEY       || '';
  const apiSecret    = process.env.TWITTER_API_SECRET    || '';
  const accessToken  = process.env.TWITTER_ACCESS_TOKEN  || '';
  const accessSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET || '';

  console.log('--- Twitter認証デバッグ ---');
  console.log(`TWITTER_API_KEY       : ${apiKey    ? apiKey.slice(0,6)    + '...(長さ:' + apiKey.length    + ')' : '★未設定★'}`);
  console.log(`TWITTER_API_SECRET    : ${apiSecret ? apiSecret.slice(0,6) + '...(長さ:' + apiSecret.length + ')' : '★未設定★'}`);
  console.log(`TWITTER_ACCESS_TOKEN  : ${accessToken  ? accessToken.slice(0,8)  + '...(長さ:' + accessToken.length  + ')' : '★未設定★'}`);
  console.log(`TWITTER_ACCESS_SECRET : ${accessSecret ? accessSecret.slice(0,6) + '...(長さ:' + accessSecret.length + ')' : '★未設定★'}`);

  // ACCESS_TOKEN の数字部分を確認（例: "1234567890-xxxxx"）
  const tokenUserId = accessToken.split('-')[0];
  console.log(`ACCESS_TOKEN ユーザーID部分: ${tokenUserId}`);

  // ── ステップ1: 読み取りテスト（v2.me）で認証を確認 ──────────
  console.log('\n[認証テスト] v2.me() で認証確認中...');
  try {
    const me = await client.readWrite.v2.me();
    console.log(`[認証テスト] ✅ 成功: @${me.data.username} (id: ${me.data.id})`);
  } catch (meErr) {
    console.warn(`[認証テスト] ❌ 失敗: ${meErr.code} - ${meErr.data?.detail || meErr.message}`);
    console.warn(`[認証テスト]    title: ${meErr.data?.title || 'N/A'}`);
  }

  const text = buildTweetText(product);
  console.log('\n投稿内容:\n' + text);
  console.log(`\n文字数（参考）: ${text.length}文字`);

  // ── ステップ2: v2 API でツイート ──────────────────────────────
  console.log('\n[v2] POST /2/tweets で投稿試行...');
  try {
    const result = await client.readWrite.v2.tweet(text);
    console.log(`[v2] ✅ 投稿成功！ tweet_id: ${result.data?.id}`);
    return;
  } catch (v2Err) {
    console.warn(`[v2] ❌ 失敗: HTTP ${v2Err.code}`);
    console.warn(`[v2]    title  : ${v2Err.data?.title || 'N/A'}`);
    console.warn(`[v2]    detail : ${v2Err.data?.detail || 'N/A'}`);
    if (v2Err.data?.errors) {
      console.warn(`[v2]    errors : ${JSON.stringify(v2Err.data.errors)}`);
    }
    // 403の場合はv1にフォールバック
    if (v2Err.code !== 403 && v2Err.code !== 401) throw v2Err;
    console.warn('[v2] → v1.1 フォールバックを試みます...');
  }

  // ── ステップ3: v1.1 API にフォールバック ─────────────────────
  console.log('\n[v1.1] POST statuses/update.json で投稿試行...');
  try {
    const result = await client.readWrite.v1.tweet(text);
    console.log(`[v1.1] ✅ 投稿成功！ tweet_id: ${result.id_str}`);
    return;
  } catch (v1Err) {
    console.error(`[v1.1] ❌ 失敗: HTTP ${v1Err.code}`);
    console.error(`[v1.1]    title  : ${v1Err.data?.title || 'N/A'}`);
    console.error(`[v1.1]    detail : ${v1Err.data?.detail || 'N/A'}`);
    if (v1Err.data?.errors) {
      console.error(`[v1.1]    errors : ${JSON.stringify(v1Err.data.errors)}`);
    }
    // v2 と v1.1 両方失敗したらそれぞれのエラーを添えてスロー
    throw new Error(
      `Twitter投稿失敗（v2 & v1.1 両方エラー）\n` +
      `v2: ${v1Err.code} ${v1Err.data?.detail || v1Err.message}\n` +
      `→ Twitter Developer Portal で「Access Token and Secret」を再生成してください`
    );
  }
}

module.exports = { postTweet, buildTweetText };
