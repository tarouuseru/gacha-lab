// pages/public/config.js
window.APP_CONFIG = {
  // Workers (API) のURL（ローカル安定版）
  API_BASE: "http://127.0.0.1:8787",

  // ✅ あなたのガチャID（Supabaseで作ったUUID）
  GACHA_ID: "20678c95-68bc-4025-b245-5d331508cedf",

  // Supabase Project のURL（例: https://xxxx.supabase.co）
  // ※あなたのSupabaseダッシュボード → Project Settings → API で確認して貼る
  SUPABASE_URL: "YOUR_SUPABASE_URL",

  // Supabase の anon key（公開鍵）
  // ※Supabaseダッシュボード → Project Settings → API → anon public key
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",
};
