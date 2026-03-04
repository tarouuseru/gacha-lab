# Gate-1 E2E Checklist

## 0. Setup
1. Supabase SQL Editor で `supabase_gate1.sql` を実行
2. Workers secret を設定
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_TOKEN`
3. Supabase Auth Redirect URLs に追加
- `http://localhost:8080/creator-callback.html`
- `https://<your-domain>/creator-callback.html`
4. 起動
- Workers: `cd workers && wrangler dev --port 8787`
- Pages: `cd pages/public && python -m http.server 8080`
5. API向き先を強制したい場合（任意）
- ブラウザConsoleで `localStorage.setItem('api_base_override','http://127.0.0.1:8787')`
- 解除は `localStorage.removeItem('api_base_override')`

## 1. Creator login and terms
1. `http://localhost:8080/creator.html` を開く
2. Googleログイン
3. 規約同意ボタンを押す
4. 期待値
- `terms_accepted_at` が `seller_profiles` に保存される

## 2. Create series
1. タイトル/説明/購入URLを入力して作成
2. 期待値
- `series` に `status=draft` で追加
- 一意 `slug` が発行
3. Creator画面の `save` でタイトル/説明/購入URLを更新
4. 期待値
- `series.updated_at` が更新される
- 変更内容が再読み込み後も反映される

## 3. Publish guard checks
1. 景品未登録のまま publish
2. 期待値
- 400 + `code=PUBLISH_NO_ACTIVE_PRIZES`
3. 景品を登録（stock=0）して publish
4. 期待値
- 400 + `code=PUBLISH_NO_PRIZE_STOCK`
5. 景品 `stock>0` を用意して publish
6. 期待値
- `status=published`

## 4. Public page and spin
1. 発行URL `/s/:slug` を開く
2. 期待値
- 候補景品一覧が表示
- 責任分界文言が表示
3. ガチャを回す
4. 期待値
- 200
- `series_prizes.stock` が減る
- `series_spin_results` が記録される
5. Creator画面で景品 `stock/weight/name` を `save` で更新
6. 期待値
- `series_prizes.updated_at` が更新される
- 更新値が抽選挙動に反映される

## 5. Suspension behavior
1. 管理者で suspend API 実行（`http://localhost:8080/admin-series.html` でも可）
```bash
curl -X POST "http://127.0.0.1:8787/api/admin/series/<series_id>/suspend" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
2. 期待値
- `/api/public/series/:slug` が 404
- `/s/:slug` が 404
3. 停止済みシリーズに対して creator API で編集/景品更新を実行
4. 期待値
- 403 + `code=SERIES_SUSPENDED`

## 8. Purchase URL validation
1. `purchase_url` に `ftp://...` や空文字を設定して create/update
2. 期待値
- 400 + `code=INVALID_PURCHASE_URL`（空文字は `MISSING_REQUIRED_FIELDS` か publish時に required系エラー）

## 6. Ownership guard
1. 別ユーザーで同じ `series_id` を PATCH
2. 期待値
- 403 `NOT_FOUND_OR_FORBIDDEN`

## 7. Parallel stock safety (manual)
1. `stock=1` 景品のシリーズを公開
2. 同時に2回 `/api/public/series/:slug/spin` をPOST
3. 期待値
- 1回成功, もう1回は `409 CONCURRENT_STOCK_EMPTY` か `400 NO_AVAILABLE_PRIZES`
- 在庫は負数にならない
