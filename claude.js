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

module.exports = { generateComment };
