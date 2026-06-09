/**
 * wordpress.js  ─  楽天ガジェット商品のレビュー記事を WordPress に投稿する
 *
 * 記事構成:
 *   タイトル  : 【レビュー】{商品名}を使ってみた感想｜{魅力を一言で}
 *   本文      : 導入文 → 基本情報 → 魅力3点 → おすすめ対象 → 使用シーン → まとめ
 *   アイキャッチ: 楽天API の imageUrl を WordPress メディアにアップロード
 */
require('dotenv').config();
const axios = require('axios');

// ── ヘルパー ─────────────────────────────────────────────────────

/** floor(rating) 個の⭐ + 数値   例) 4.5 → ⭐⭐⭐⭐4.5 */
function buildStars(rating) {
  if (!rating) return '';
  return '⭐'.repeat(Math.floor(rating)) + rating.toFixed(1);
}

/** レビュー件数による人気ラベル */
function buildPopularTag(reviewCount) {
  if (reviewCount >= 10000) return ' 🔥大人気';
  if (reviewCount  >= 1000) return ' 👍人気';
  return '';
}

// ── アイキャッチ画像アップロード ────────────────────────────────

/**
 * 楽天APIの画像URLを WordPress メディアにアップロードし、メディアIDを返す
 * 失敗した場合は null を返す（記事投稿は続行）
 */
async function uploadFeaturedImage(imageUrl, auth) {
  if (!imageUrl) return null;

  try {
    // 画像をバイナリで取得
    const imgRes = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout:       15000,
    });

    const contentType = imgRes.headers['content-type'] || 'image/jpeg';
    const ext      = contentType.includes('png') ? 'png' : 'jpg';
    const filename = `gadget-${Date.now()}.${ext}`;

    // WordPress メディアAPIにアップロード
    const uploadRes = await axios.post(
      `${process.env.WORDPRESS_URL}/wp-json/wp/v2/media`,
      Buffer.from(imgRes.data),
      {
        headers: {
          Authorization:       `Basic ${auth}`,
          'Content-Type':      contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
        timeout: 30000,
      }
    );

    console.log(`  アイキャッチ画像アップロード成功: メディアID ${uploadRes.data.id}`);
    return uploadRes.data.id;

  } catch (err) {
    console.warn(`  アイキャッチ画像アップロード失敗: ${err.message}（記事投稿は続行）`);
    return null;
  }
}

// ── HTML ビルダー ───────────────────────────────────────────────

/**
 * Claude が生成した articleData からWordPress ブロックHTMLを組み立てる
 *
 * @param {object} product     - 楽天商品オブジェクト
 * @param {object} articleData - generateProductArticle() の戻り値（JSON）
 */
function buildArticleHtml(product, articleData) {
  const stars      = buildStars(product.rating);
  const popularTag = buildPopularTag(product.reviewCount ?? 0);

  const priceDisplay = product.originalPrice
    ? `<del>¥${product.originalPrice.toLocaleString()}</del> → <strong>¥${product.currentPrice.toLocaleString()}</strong>（${product.discountRate}%OFF）`
    : `<strong>¥${product.currentPrice?.toLocaleString()}</strong>`;

  // 購入ボタンの共通HTML
  const buyButton = `<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center"><a href="${product.url}" target="_blank" rel="noopener noreferrer sponsored" style="display:inline-block;background-color:#e8380d;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:1.1em;">▶ 楽天市場でこの商品を見る・購入する</a></p>
<!-- /wp:paragraph -->

`;

  let html = '';

  // ── 1. 導入文 ──
  html += `<!-- wp:paragraph -->
<p>${articleData.intro}</p>
<!-- /wp:paragraph -->

`;

  // ── 2. 基本情報 ──
  html += `<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">📦 商品の基本情報</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">
  <li>💰 <strong>価格：</strong>${priceDisplay}</li>
  <li>${stars}<strong>評価：</strong>${stars}${popularTag}（${product.reviewCount?.toLocaleString()}件レビュー）</li>
  ${product.shopName ? `<li>🏪 <strong>ショップ：</strong>${product.shopName}</li>` : ''}
</ul>
<!-- /wp:list -->

${buyButton}<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->

`;

  // ── 3. この商品の魅力3つ ──
  for (const appeal of articleData.appeals) {
    html += `<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">✨ ${appeal.title}</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>${appeal.body.replace(/\n/g, '<br>')}</p>
<!-- /wp:paragraph -->

`;
  }

  html += `<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->

`;

  // ── 4. こんな人におすすめ ──
  html += `<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">👤 こんな人におすすめ</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">
${articleData.recommends.map(r => `  <li>✅ ${r}</li>`).join('\n')}
</ul>
<!-- /wp:list -->

`;

  // ── 5. 実際に使うシーン ──
  for (const scene of articleData.scenes) {
    html += `<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">🔍 ${scene.title}</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>${scene.body.replace(/\n/g, '<br>')}</p>
<!-- /wp:paragraph -->

`;
  }

  html += `<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->

`;

  // ── 6. 購入を後押しする一言 ──
  html += `<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center"><strong>💡 ${articleData.push}</strong></p>
<!-- /wp:paragraph -->

`;

  // ── 7. まとめ ──
  html += `<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">📝 まとめ</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>${articleData.summary}</p>
<!-- /wp:paragraph -->

`;

  // ── 8. 最後の購入ボタン（再掲） ──
  html += buyButton;

  html += `<!-- wp:paragraph -->
<p><small>※価格・在庫状況は楽天市場掲載情報に基づきます。購入前に最新情報をご確認ください。</small></p>
<!-- /wp:paragraph -->
`;

  return html;
}

// ── WordPress 投稿 ──────────────────────────────────────────────

/**
 * 単品レビュー記事を WordPress に投稿する
 *
 * @param {object} product     - 楽天商品オブジェクト
 * @param {object} articleData - generateProductArticle() の戻り値
 */
async function postArticle(product, articleData) {
  const auth = Buffer.from(
    `${process.env.WORDPRESS_USERNAME}:${process.env.WORDPRESS_PASSWORD}`
  ).toString('base64');

  // アイキャッチ画像のアップロード（失敗してもスキップ）
  const featuredMediaId = await uploadFeaturedImage(product.image, auth);

  const title   = `【レビュー】${product.title}を使ってみた感想｜${articleData.titleSuffix}`;
  const content = buildArticleHtml(product, articleData);
  const excerpt = articleData.intro;

  const postData = {
    title,
    content,
    status:  'publish',
    excerpt,
  };
  if (featuredMediaId) {
    postData.featured_media = featuredMediaId;
  }

  const response = await axios.post(
    `${process.env.WORDPRESS_URL}/wp-json/wp/v2/posts`,
    postData,
    {
      headers: {
        Authorization:  `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  return response.data;
}

module.exports = { postArticle };
