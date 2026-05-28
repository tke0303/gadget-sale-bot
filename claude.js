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
    `以下のAmazonセール商品について、購入を検討している人向けに一言コメントを日本語で書いてください。` +
    `30文字以内で商品の魅力や割引のお得さを簡潔に伝えてください。ハッシュタグ・絵文字は不要です。` +
    `価格情報がない場合は割引率と商品名から魅力を伝えてください。\n\n` +
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
