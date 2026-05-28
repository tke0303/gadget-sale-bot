require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateComment(product) {
  const prompt =
    `以下のAmazonセール商品について、購入を検討している人向けに一言コメントを日本語で書いてください。` +
    `30文字以内で商品の魅力を簡潔に伝えてください。ハッシュタグ・絵文字は不要です。\n\n` +
    `商品名: ${product.title}\n` +
    `割引率: ${product.discountRate}%オフ\n` +
    `価格: ¥${(product.currentPrice || 0).toLocaleString()}` +
    `（定価¥${(product.originalPrice || 0).toLocaleString()}）`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 80,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text.trim();
}

module.exports = { generateComment };
