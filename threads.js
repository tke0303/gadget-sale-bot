/**
 * threads.js  ─  Meta Threads API にテキスト投稿する
 *
 * Threads API の投稿フロー（2ステップ）:
 *   1. メディアコンテナ作成  POST /{user-id}/threads
 *   2. コンテナを公開        POST /{user-id}/threads_publish
 *
 * 認証: アクセストークン（環境変数 THREADS_ACCESS_TOKEN）
 *   THREADS_ACCESS_TOKEN が未設定の場合はスキップして正常終了
 *
 * 文字数上限: 500文字（Xの280より余裕あり、同じテキストをそのまま使用）
 */
require('dotenv').config();
const axios = require('axios');
const { buildTweetText } = require('./twitter');

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * アクセストークンからユーザーIDを取得する
 */
async function getUserId(accessToken) {
  const res = await axios.get(`${THREADS_API_BASE}/me`, {
    params: {
      fields:       'id,username',
      access_token: accessToken,
    },
    timeout: 10000,
  });
  console.log(`  Threads ユーザー: @${res.data.username} (id: ${res.data.id})`);
  return res.data.id;
}

/**
 * コンテナのステータスを確認してから公開する
 * Threads はテキスト投稿でも非同期処理になることがあるため確認する
 */
async function waitForContainer(userId, creationId, accessToken, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    await sleep(3000);
    const res = await axios.get(`${THREADS_API_BASE}/${creationId}`, {
      params: {
        fields:       'status,error_message',
        access_token: accessToken,
      },
      timeout: 10000,
    });
    const status = res.data.status;
    console.log(`  コンテナ状態 (試行${i + 1}): ${status}`);

    if (status === 'FINISHED') return;
    if (status === 'ERROR') {
      throw new Error(`Threadsコンテナ作成失敗: ${res.data.error_message}`);
    }
    // IN_PROGRESS の場合はリトライ
  }
  throw new Error('Threadsコンテナが時間内にFINISHEDになりませんでした');
}

/**
 * Threads に投稿する
 * THREADS_ACCESS_TOKEN が未設定の場合はスキップ
 */
async function postThreads(product) {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;

  if (!accessToken) {
    console.log('  ⏭️  THREADS_ACCESS_TOKEN 未設定のためスキップ');
    return null;
  }

  // X と同じテキストをそのまま使用（Threadsは500文字まで余裕あり）
  const text = buildTweetText(product);

  try {
    // Step 1: ユーザーID取得
    const userId = await getUserId(accessToken);

    // Step 2: メディアコンテナ作成
    const containerRes = await axios.post(
      `${THREADS_API_BASE}/${userId}/threads`,
      null,
      {
        params: {
          media_type:   'TEXT',
          text,
          access_token: accessToken,
        },
        timeout: 15000,
      },
    );
    const creationId = containerRes.data.id;
    console.log(`  コンテナ作成完了: ${creationId}`);

    // Step 3: コンテナが FINISHED になるまで待機
    await waitForContainer(userId, creationId, accessToken);

    // Step 4: 公開
    const publishRes = await axios.post(
      `${THREADS_API_BASE}/${userId}/threads_publish`,
      null,
      {
        params: {
          creation_id:  creationId,
          access_token: accessToken,
        },
        timeout: 15000,
      },
    );

    console.log(`✅ Threads投稿成功！ id: ${publishRes.data.id}`);
    return publishRes.data;

  } catch (err) {
    const status  = err.response?.status;
    const errData = err.response?.data;
    console.error(`Threads投稿失敗 HTTP ${status ?? '?'}: ${err.message}`);
    if (errData) console.error(`  詳細: ${JSON.stringify(errData).slice(0, 300)}`);
    throw err;
  }
}

module.exports = { postThreads };
