/**
 * wordpress.js  ─  楽天ガジェットセール 日次ランキング記事を WordPress に投稿する
 *
 * 記事構成:
 *   タイトル : 【本日のガジェットセール】YYYY年MM月DD日｜割引率30%以上おすすめ10選
 *   本文     : 導入文（Claude生成）+ 割引率順ランキング1〜10位 + 締め文
 *
 * 各商品ブロック:
 *   順位見出し・商品画像・価格・割引率・星評価・ひとこと・アフィリエイトリンク
 */
require('dotenv').config();
const axios = require('axios');

// ── ヘルパー ─────────────────────────────────────────────────────

/**
 * JST の YYYY年MM月DD日 形式で今日の日付を返す
 */
function getTodayJST() {
  const d   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}年${m}月${day}日`;
}

/**
 * floor(rating) 個の⭐ + 数値   例) 4.5 → ⭐⭐⭐⭐4.5
 */
function buildStars(rating) {
  if (!rating) return '';
  return '⭐'.repeat(Math.floor(rating)) + rating.toFixed(1);
}

/**
 * レビュー件数による人気ラベル
 */
function buildPopularTag(reviewCount) {
  if (reviewCount >= 10000) return '&nbsp;🔥大人気';
  if (reviewCount  >= 1000) return '&nbsp;👍人気';
  return '';
}

/**
 * 順位に応じたメダル絵文字
 */
function getRankLabel(rank) {
  if (rank === 1) return '🥇 1位';
  if (rank === 2) return '🥈 2位';
  if (rank === 3) return '🥉 3位';
  return `${rank}位`;
}

// ── HTML ビルダー ───────────────────────────────────────────────

function buildArticleContent(products, introText) {
  const dateStr = getTodayJST();
  let html = '';

  // ── 導入文 ──
  html += `<!-- wp:paragraph -->
<p>${introText}</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>評価4.0以上・レビュー100件以上の信頼できる商品のみを厳選しています。</p>
<!-- /wp:paragraph -->

<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->

`;

  // ── 商品ランキング ──
  products.forEach((p, i) => {
    const rank       = i + 1;
    const rankLabel  = getRankLabel(rank);
    const currentStr = p.currentPrice  ? `¥${p.currentPrice.toLocaleString()}`  : '価格確認中';
    const origStr    = p.originalPrice ? `¥${p.originalPrice.toLocaleString()}` : '';
    const stars      = buildStars(p.rating);
    const popular    = buildPopularTag(p.reviewCount ?? 0);
    const priceDisplay = origStr
      ? `<del>${origStr}</del> → <strong>${currentStr}</strong>`
      : `<strong>${currentStr}</strong>`;

    html += `<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">${rankLabel}｜${p.discountRate}%OFF｜${p.title}</h2>
<!-- /wp:heading -->

`;

    if (p.image) {
      html += `<!-- wp:image {"sizeSlug":"medium"} -->
<figure class="wp-block-image size-medium"><img src="${p.image}" alt="${p.title}"/></figure>
<!-- /wp:image -->

`;
    }

    html += `<!-- wp:list -->
<ul class="wp-block-list">
  <li>💰 <strong>価格：</strong>${priceDisplay}（<strong>${p.discountRate}%オフ</strong>）</li>
  ${stars ? `<li>⭐ <strong>評価：</strong>${stars}${popular}</li>` : ''}
  ${p.comment ? `<li>💁‍♂️ <strong>ひとこと：</strong>${p.comment}</li>` : ''}
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p><a href="${p.url}" target="_blank" rel="noopener noreferrer sponsored">▶ 楽天市場で見る（${currentStr}）</a></p>
<!-- /wp:paragraph -->

`;

    // 最後の商品以外はセパレーターを挟む
    if (rank < products.length) {
      html += `<!-- wp:separator {"className":"is-style-dots"} -->
<hr class="wp-block-separator has-alpha-channel-opacity is-style-dots"/>
<!-- /wp:separator -->

`;
    }
  });

  // ── 締め文 ──
  html += `<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->

<!-- wp:paragraph -->
<p>🔄 <strong>毎日更新中！</strong>朝8時30分に本日のおすすめセール情報をお届けしています。<br>ブックマークして毎日チェックしてください！</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><small>※価格・在庫状況は楽天市場掲載情報に基づきます。購入前に最新情報をご確認ください。</small></p>
<!-- /wp:paragraph -->
`;

  return html;
}

// ── WordPress 投稿 ──────────────────────────────────────────────

async function postArticle(products, introText) {
  const dateStr = getTodayJST();
  const title   = `【本日のガジェットセール】${dateStr}｜割引率30%以上おすすめ10選`;
  const content = buildArticleContent(products, introText);
  const excerpt = `${dateStr}の楽天市場セール情報。割引率30%以上・評価4.0以上・レビュー100件以上の厳選ガジェット${products.length}件をランキング形式でご紹介！`;

  const auth = Buffer.from(
    `${process.env.WORDPRESS_USERNAME}:${process.env.WORDPRESS_PASSWORD}`
  ).toString('base64');

  const response = await axios.post(
    `${process.env.WORDPRESS_URL}/wp-json/wp/v2/posts`,
    {
      title,
      content,
      status:  'publish',
      excerpt,
    },
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
