require('dotenv').config();
const axios = require('axios');

function buildArticleContent(products) {
  const dateStr = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  let html = `<!-- wp:paragraph -->
<p>本日（${dateStr}）のAmazonで見つけた<strong>割引率30%以上</strong>のガジェット・電子機器をまとめました。どれもお買い得なので、気になる商品があればお早めに！</p>
<!-- /wp:paragraph -->

`;

  for (const p of products) {
    const currentStr = p.currentPrice ? `¥${p.currentPrice.toLocaleString()}` : '確認中';
    const origStr = p.originalPrice ? `¥${p.originalPrice.toLocaleString()}` : '';

    html += `<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">${p.title}</h3>
<!-- /wp:heading -->

`;

    if (p.image) {
      html += `<!-- wp:image -->
<figure class="wp-block-image"><img src="${p.image}" alt="${p.title}" /></figure>
<!-- /wp:image -->

`;
    }

    html += `<!-- wp:list -->
<ul>
  <li><strong>割引率:</strong> ${p.discountRate}%オフ</li>
  <li><strong>価格:</strong> ${origStr ? `<del>${origStr}</del> → ` : ''}<strong>${currentStr}</strong></li>
  ${p.comment ? `<li><strong>コメント:</strong> ${p.comment}</li>` : ''}
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p><a href="${p.url}" target="_blank" rel="noopener noreferrer sponsored">▶ Amazonで見る（${currentStr}）</a></p>
<!-- /wp:paragraph -->

`;
  }

  html += `<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->

<!-- wp:paragraph -->
<p>※価格・在庫状況はAmazon掲載情報に基づきます。変動する場合がありますのでご確認ください。</p>
<!-- /wp:paragraph -->
`;

  return html;
}

async function postArticle(products) {
  const dateStr = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const title = `${dateStr}のAmazonガジェットセール【割引率30%以上まとめ】`;
  const content = buildArticleContent(products);

  const auth = Buffer.from(
    `${process.env.WORDPRESS_USERNAME}:${process.env.WORDPRESS_PASSWORD}`
  ).toString('base64');

  const response = await axios.post(
    `${process.env.WORDPRESS_URL}/wp-json/wp/v2/posts`,
    {
      title,
      content,
      status: 'publish',
      excerpt: `本日のAmazonで割引率30%以上のガジェットセール情報を${products.length}件まとめました。`,
    },
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  return response.data;
}

module.exports = { postArticle };
