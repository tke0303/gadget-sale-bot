require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateComment(product) {
  // 価格情報が取れているときだけ価格を含める
  const priceInfo = product.currentPrice
    ? `価格: ¥${product.currentPrice.toLocaleString()}` +
      (product.originalPrice ? `（定価¥${product.originalPrice.toLocaleString()}）` : '')
    : '';

  const prompt =
    `あなたはAmazonのガジェットセールをSNSで紹介する人です。\n` +
    `以下の商品について、Twitterに投稿する一言コメントを書いてください。\n\n` +
    `【条件】\n` +
    `・40文字以内\n` +
    `・カジュアルで親しみやすい口語体（ですます調NG、友達に話しかける感じ）\n` +
    `・文末に必ず💁‍♂️を付ける\n` +
    `・「〜を探してる方はチャンス」「〜持ってない人は今がお得」「これ安すぎ」など自然な表現で\n` +
    `・ハッシュタグ・URLは不要\n` +
    `・コメントのみを出力（前置きや説明は不要）\n\n` +
    `商品名: ${product.title}\n` +
    `割引率: ${product.discountRate}%オフ\n` +
    (priceInfo ? priceInfo + '\n' : '');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 80,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text.trim();
}

module.exports = { generateComment };
