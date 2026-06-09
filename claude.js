require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateComment(product) {
  const priceInfo = product.currentPrice
    ? `現在価格: ¥${product.currentPrice.toLocaleString()}` +
      (product.originalPrice
        ? `（定価¥${product.originalPrice.toLocaleString()}）`
        : '')
    : '';

  const prompt =
    `あなたは楽天市場のガジェットセールをSNSで紹介する人です。\n` +
    `以下の商品について、Twitterに投稿する一言コメントを書いてください。\n\n` +
    `【条件】\n` +
    `・30文字以内\n` +
    `・カジュアルで親しみやすい口語体（ですます調NG、友達に話しかける感じ）\n` +
    `・「〜探してた人チャンス」「これ安すぎ」「マジで買い」など自然な表現\n` +
    `・絵文字・ハッシュタグ・URLは不要\n` +
    `・コメント本文のみ出力（前置き不要）\n\n` +
    `商品名: ${product.title}\n` +
    `割引率: ${product.discountRate}%オフ\n` +
    `評価: ⭐${product.rating?.toFixed(1)} (${product.reviewCount?.toLocaleString()}件)\n` +
    (priceInfo ? priceInfo + '\n' : '');

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 80,
    messages:   [{ role: 'user', content: prompt }],
  });

  return message.content[0].text.trim().replace(/^「|」$/g, '');
}

/**
 * 記事用導入文を生成する（100文字以内）
 */
async function generateArticleIntro(products) {
  const top = products[0];
  const prompt =
    `楽天市場ガジェットセール記事の導入文を書いてください。\n\n` +
    `【条件】\n` +
    `・100文字以内\n` +
    `・今日のセールで一番お得な情報を前面に出す\n` +
    `・読者が読みたくなる自然な日本語（敬体・ですます調）\n` +
    `・本文テキストのみ出力（前置き・改行不要）\n\n` +
    `本日の最高割引: ${top.title}（${top.discountRate}%オフ / ⭐${top.rating?.toFixed(1)}）\n` +
    `掲載件数: ${products.length}件`;

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages:   [{ role: 'user', content: prompt }],
  });

  return message.content[0].text.trim();
}

/**
 * SNS投稿文を生成する（X/Threads用・2〜3行・60〜80文字）
 * 商品名・価格・星評価は文中に含めず、実体験風・共感を呼ぶ文体で生成する
 */
async function generateSNSPost(product) {
  const prompt =
    `以下の商品情報をもとに、SNSで思わずクリックしたくなる\n` +
    `投稿文を2〜3行で書いてください。\n\n` +
    `条件：\n` +
    `・商品名・価格・星評価は文中に含めない\n` +
    `・実体験風・共感を呼ぶ文体\n` +
    `・「〜した人に聞いたら」「〜してる人が多い」「〜なのが神」のような自然な口語表現\n` +
    `・60〜80文字以内\n` +
    `・毎回違う切り口で生成\n` +
    `・投稿文のみ出力（前置き・説明不要）\n\n` +
    `商品名: ${product.title}\n` +
    `評価: ⭐${product.rating?.toFixed(1)}（${product.reviewCount?.toLocaleString()}件レビュー）\n` +
    `価格: ¥${product.currentPrice?.toLocaleString()}\n` +
    `カテゴリ: ガジェット`;

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages:   [{ role: 'user', content: prompt }],
  });

  return message.content[0].text.trim();
}

module.exports = { generateComment, generateArticleIntro, generateSNSPost };
