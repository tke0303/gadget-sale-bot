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
 * 投稿本文を組み立てる
 *
 * フォーマット:
 *   {Claudeが生成した2〜3行の投稿文}
 *
 *   {楽天アフィリエイトリンク}
 *
 *   #楽天 #ガジェット #おすすめ #広告
 *
 * Twitter文字数カウント:
 *   - URL: 長さに関わらず 23 カウント (t.co 変換)
 *   - 上限: 280
 *   - 投稿文60〜80字 + URL23 + ハッシュタグ15 ≈ 100〜120カウント
 */
function buildTweetText(product) {
  return [
    product.comment,
    '',
    product.url,
    '',
    '#楽天 #ガジェット #おすすめ #広告',
  ].join('\n');
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
