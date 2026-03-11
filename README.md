# Gacha MVP (Cloudflare Pages + Workers + Supabase)

SNS誘導用の「ガチャ」MVPです。未ログインは1回だけ無料、ログインで追加1回、以降はPAYWALL表示のみ。

## Supabase 設定

### Site URL / Redirect URLs
- Site URL: `http://localhost:8788`
- Redirect URLs:
  - `http://localhost:8788/auth/callback`
  - `http://localhost:8788/auth-callback.html`

### SQL 適用
1. SupabaseのSQL Editorを開く
2. `supabase.sql` を実行
3. `gachas` に1件データを追加（例）

```sql
insert into gachas (title, is_active, win_rate)
values ('SNS Gacha', true, 0.2)
returning id;
```

## Workers 環境変数 / Secrets

`workers/wrangler.toml` の `ALLOWED_ORIGIN` を確認し、
以下の Secrets を設定してください（Workersディレクトリで実行）。

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

## フロント設定

`pages/public/config.js` の値を設定してください。

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `API_BASE`（例: `http://localhost:8787`）
- `GACHA_ID`（SQLで作成した `gachas.id`）

## ローカル起動

### Workers
```bash
cd workers
wrangler dev --port 8787
```

### Pages
```bash
cd pages/public
python -m http.server 8788
```

### Pages Functions 環境変数
Pages の Functions で `/api/spin` を動かす場合、以下を設定してください。

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Cloudflare Pages 設定メモ
- Framework preset: None
- Build command: なし
- Build output directory: `pages`
- これにより `https://<project>.pages.dev/pages/app.js` が `pages/app.js` を配信

## Cloudflare Pages 設定メモ（本番）
Cloudflare Pages → Build settings
- Framework: None
- Build command: なし（空）
- Build output directory: `.`（repo root）
- Save → 再デプロイ

確認（シークレット推奨）:
- `https://gacha-lab.pages.dev/pages/index.html` を開く
- DevTools → Network で以下が 200 になること
  - `https://gacha-lab.pages.dev/pages/styles.css`
  - `https://gacha-lab.pages.dev/pages/app.js`
  - `https://gacha-lab.pages.dev/pages/config.js`
- 直アクセスで中身が返ること
  - `https://gacha-lab.pages.dev/pages/app.js`（JS本文が表示）
  - `https://gacha-lab.pages.dev/pages/styles.css`（CSS本文が表示）

ローカル確認:
```bash
python -m http.server 8080
```
`http://localhost:8080/pages/index.html` を開き、Network で `styles.css` / `app.js` / `config.js` が 200 を確認
## 動作確認手順

1. 未ログインで `index.html` を開き、1回「回す」
2. 2回目は NEED_LOGIN_FREE モーダルが表示される
3. `login.html` からマジックリンクでログイン
4. ログイン完了後に `/api/claim-guest` が呼ばれ、未ログイン当選が user_id に紐付く
5. `/me` で未ログイン当選の redeem_code が表示される
6. ログイン後に「回す」→ ログイン特典無料が消費される
7. さらに「回す」→ PAYWALL モーダルが表示される

## 管理画面の確認手順

1. `https://gacha-lab.pages.dev/admin/` を開く
2. `ADMIN_TOKEN` と `GACHA_ID` を入力して `gacha load`
3. `prizes load` を押して一覧を表示
4. 任意の prize の `stock` を 0 → 5 に変更して `save`
5. 再度 `prizes load` で反映を確認

## よくあるエラーと修正

### CORS エラー
- 原因: `ALLOWED_ORIGIN` がフロントのURLと一致していない
- 修正: `workers/wrangler.toml` の `ALLOWED_ORIGIN` を合わせる

### Redirect URL エラー
- 原因: Supabaseの Redirect URLs に `auth/callback` が無い
- 修正: Supabase Auth Settings に `http://localhost:8788/auth/callback` を追加

### 401 Unauthorized
- 原因: `SUPABASE_SERVICE_ROLE_KEY` が未設定/誤り
- 修正: `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` を再実行

### Cookie が送られない
- 原因: `guest_token` は `Secure` Cookie のため `http` では送信されない
- 修正: `wrangler dev --https` を使うか、ローカル時だけ `Secure` を外す（本番では必ず有効化）

### 本番デプロイ時の変更点
- `ALLOWED_ORIGIN` を本番ドメインに変更
- Supabase Site URL / Redirect URLs を本番ドメインに追加

## Gate-1 (Creator SaaS) 追加メモ

### SQL
- `supabase_gate1.sql` を Supabase SQL Editor で実行

### 主要API（Workers）
- `POST /api/creator/terms/accept`
- `POST /api/creator/series`
- `GET /api/creator/series`
- `PATCH /api/creator/series/:id`
- `POST /api/creator/series/:id/prizes`
- `GET /api/creator/series/:id/prizes`
- `PATCH /api/creator/prizes/:id`
- `GET /api/public/series/:slug`
- `POST /api/public/series/:slug/spin`
- `POST /api/admin/series/:id/suspend`
- `POST /api/admin/series/:id/unsuspend`（Gate-8）
- `POST /api/public/report`（Gate-2）
- `GET /api/admin/reports`（Gate-2）
- `POST /api/admin/reports/:id/resolve`（Gate-6）

### 追加ページ
- `pages/public/creator.html`（売り手管理）
- `pages/public/creator-callback.html`（OAuth callback）
- `pages/public/s/index.html?slug=<slug>`（静的確認用）
- `GET /s/:slug`（Workers配信の公開ページ）

### 検証手順
- `GATE1_E2E_CHECKLIST.md` を参照
- APIスモーク確認: `scripts/gate1_smoke.sh`
  - 例: `API_BASE=http://127.0.0.1:8787 USER_TOKEN=<token> ADMIN_TOKEN=<token> ./scripts/gate1_smoke.sh`
  - `jq` が必要

## Cache busting
確認・検証時は URL に `?v=YYYYMMDDHHmm` を付けて同一URLで再現できるようにする（例: `/?v=202602281340`）。

## ローカル運用メモ（ハマりどころ対策）

### 1) workers/.dev.vars の必須項目
`workers/.dev.vars` はローカル専用です。以下が未設定だと `UNAUTHORIZED` や `MISSING_*` が発生します。

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
ADMIN_TOKEN=gl_admin_local_2026
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 2) ローカル起動は --local を推奨
OAuthの失敗ループを避けるため、まずはローカルモードで起動します。

```bash
cd workers
wrangler dev --local --port 8787
```

`Address already in use` が出た場合:

```bash
lsof -i :8787
kill -9 <PID>
```

### 3) public/creator の起動

```bash
cd pages/public
python3 -m http.server 8080
```

- Creator URL: `http://localhost:8080/creator.html`
- API_BASE は `http://127.0.0.1:8787` を使用

### 4) Gate6: 通報クローズAPI
管理者トークンで通報を解決状態にします。

```bash
curl -X POST "http://127.0.0.1:8787/api/admin/reports/<REPORT_ID>/resolve" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"note":"closed by admin"}'
```

成功時は `status: "closed"` と `resolved_at` が返ります。

### 5) よくあるエラー
- `UNAUTHORIZED`
  - `ADMIN_TOKEN` が空、または `Authorization: Bearer ...` と一致していない
- `MISSING_STRIPE_PRICE_ID`
  - `.dev.vars` の `STRIPE_PRICE_ID` 未設定
- `Session from session_id claim ... does not exist`
  - 古いSupabase access tokenを使っている。`creator.html` で再ログインして再取得する

## Gate6-7 完了チェック

- Gate6（API）
  - `POST /api/admin/reports/:id/resolve` が `ok: true` を返す
  - `series_reports.status` が `closed` になる
  - `series_reports.resolved_at` が入る
  - `audit_logs` に `action=report_resolve` が記録される

- Gate7（UI）
  - `admin-series.html` で `Load Reports` が動く
  - `open` の通報だけ `Resolve` ボタンを表示
  - `closed` の通報は `already resolved` 表示（ボタン非表示）
  - `admin-series.js` にスクリプト分離済み（埋め込みscriptなし）
