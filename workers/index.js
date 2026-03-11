const JSON_HEADERS = { "Content-Type": "application/json" };
const DEFAULT_ALLOWED_ORIGINS = [
  "https://gacha-lab.pages.dev",
  "https://gacha-lab-pages.pages.dev",
];
const DEPLOY_ID = "2026-01-04T21:15JST";
const CORS_VER = "2026-01-27-1";

function resolveAllowedOrigin(requestOrigin, allowlist) {
  const allowed = new Set(DEFAULT_ALLOWED_ORIGINS);
  (allowlist || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((origin) => allowed.add(origin));
  if (!requestOrigin) return "";
  if (allowed.has(requestOrigin)) return requestOrigin;
  return "";
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Guest-Token",
    "Access-Control-Max-Age": "86400",
  };
  return headers;
}

function cors(res) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Guest-Token");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("X-CORS-VER", CORS_VER);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function preflight(request, allowOrigin) {
  if (!allowOrigin) {
    return new Response("CORS origin not allowed", { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Guest-Token",
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
    },
  });
}

function parseCookies(request) {
  const cookie = request.headers.get("Cookie") || "";
  const entries = cookie.split(";").map((part) => part.trim()).filter(Boolean);
  const out = {};
  for (const entry of entries) {
    const index = entry.indexOf("=");
    if (index === -1) continue;
    const key = entry.slice(0, index);
    const value = entry.slice(index + 1);
    out[key] = value;
  }
  return out;
}

function getGuestTokenFromRequest(request) {
  const headerToken = request.headers.get("X-Guest-Token");
  if (headerToken && headerToken !== "null" && headerToken !== "undefined") return headerToken;
  const cookies = parseCookies(request);
  return cookies.gl_guest || cookies.guest_token || null;
}

function randomString(length, alphabet) {
  let output = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}

function generateGuestToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clampRate(rate) {
  const parsed = Number(rate);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

async function supabaseRest(env, path, { method = "GET", body, headers = {}, query = "" } = {}) {
  const url = `${env.SUPABASE_URL}${path}${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...headers,
    },
    body,
  });
  return res;
}

async function supabaseAuthUser(env, token) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.id || null;
}

async function getGacha(env, gachaId) {
  const res = await supabaseRest(env, "/rest/v1/gachas", {
    query: `?select=id,win_rate,is_active&id=eq.${encodeURIComponent(gachaId)}&limit=1`,
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

async function fetchPrizes(env, gachaId) {
  const res = await supabaseRest(env, "/rest/v1/prizes", {
    query: `?select=id,name,image_url,stock,weight&gacha_id=eq.${encodeURIComponent(
      gachaId
    )}&is_active=is.true&stock=gt.0`,
  });
  if (!res.ok) return null;
  return res.json();
}

function chooseWeightedPrize(prizes) {
  const weighted = prizes.map((prize) => ({
    prize,
    weight: Math.max(1, Number(prize.weight) || 1),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let pick = Math.random() * total;
  for (const item of weighted) {
    pick -= item.weight;
    if (pick < 0) return item.prize;
  }
  return weighted[weighted.length - 1]?.prize || null;
}

async function decrementPrizeStock(env, prize) {
  const res = await supabaseRest(env, "/rest/v1/prizes", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    query: `?id=eq.${encodeURIComponent(prize.id)}&stock=gt.0`,
    body: JSON.stringify({ stock: prize.stock - 1 }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.length ? data[0] : null;
}

async function createRedeemWin(env, gachaId, prizeId) {
  const res = await supabaseRest(env, "/rest/v1/redeems", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      gacha_id: gachaId,
      prize_id: prizeId,
      result: "WIN",
      created_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] || null;
}

function jsonResponse(body, { status = 200, headers = {}, setCookie } = {}) {
  const responseHeaders = new Headers({
    ...JSON_HEADERS,
    ...headers,
  });
  if (setCookie) {
    responseHeaders.append("Set-Cookie", setCookie);
  }
  return cors(new Response(JSON.stringify(body), { status, headers: responseHeaders }));
}

function ensureSupabaseEnv(env, headers) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(
      { error: "MISSING_SUPABASE_ENV" },
      { status: 500, headers }
    );
  }
  return null;
}

function authorizeAdmin(request, env, headers) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token || token !== env.ADMIN_TOKEN) {
    return jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers });
  }
  return null;
}

function getBearerToken(request) {
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length);
}

async function requireUserId(request, env, headers) {
  const token = getBearerToken(request);
  if (!token) {
    return { error: jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers }) };
  }
  const userId = await supabaseAuthUser(env, token);
  if (!userId) {
    return { error: jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers }) };
  }
  return { userId };
}

async function parseJsonBody(request, headers) {
  try {
    return { data: await request.json() };
  } catch {
    return { error: jsonResponse({ error: "INVALID_JSON" }, { status: 400, headers }) };
  }
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function ensureUniqueSlug(env, base) {
  let candidate = base || `series-${randomString(6, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
  for (let i = 0; i < 10; i += 1) {
    const res = await supabaseRest(env, "/rest/v1/series", {
      query: `?select=id&slug=eq.${encodeURIComponent(candidate)}&limit=1`,
    });
    if (!res.ok) {
      throw new Error("SLUG_LOOKUP_FAILED");
    }
    const data = await res.json();
    if (!data?.length) return candidate;
    candidate = `${base || "series"}-${randomString(4, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
  }
  return `series-${randomString(10, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
}

async function getSellerProfile(env, userId) {
  const res = await supabaseRest(env, "/rest/v1/seller_profiles", {
    query: `?select=user_id,status,terms_accepted_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

async function ensureSellerProfile(env, userId) {
  const current = await getSellerProfile(env, userId);
  if (current) return current;
  const res = await supabaseRest(env, "/rest/v1/seller_profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

function canPublishSeries(seriesRow) {
  return Boolean(
    seriesRow?.title &&
      seriesRow?.description &&
      seriesRow?.category &&
      seriesRow?.purchase_url
  );
}

function isBillingActive(status) {
  return status === "active" || status === "trialing";
}

async function validatePublishable(env, seriesRow, userId) {
  if (!canPublishSeries(seriesRow)) {
    return { ok: false, code: "PUBLISH_INVALID_REQUIRED_FIELDS" };
  }
  const subscription = await getSellerSubscriptionByUserId(env, userId);
  if (!isBillingActive(subscription?.status || "inactive")) {
    return { ok: false, code: "BILLING_INACTIVE" };
  }
  const profile = await ensureSellerProfile(env, userId);
  if (!profile?.terms_accepted_at) {
    return { ok: false, code: "TERMS_NOT_ACCEPTED" };
  }
  const activeRes = await supabaseRest(env, "/rest/v1/series_prizes", {
    query: `?select=id,stock&series_id=eq.${encodeURIComponent(seriesRow.id)}&is_active=is.true`,
  });
  if (!activeRes.ok) {
    return { ok: false, code: "PRIZE_LOOKUP_FAILED" };
  }
  const active = await activeRes.json();
  if (!active.length) {
    return { ok: false, code: "PUBLISH_NO_ACTIVE_PRIZES" };
  }
  const hasStock = active.some((item) => Number(item.stock || 0) > 0);
  if (!hasStock) {
    return { ok: false, code: "PUBLISH_NO_PRIZE_STOCK" };
  }
  return { ok: true };
}

async function getOwnedSeries(env, seriesId, userId) {
  const res = await supabaseRest(env, "/rest/v1/series", {
    query: `?select=id,owner_user_id,title,description,category,purchase_url,status,slug,suspended_at&id=eq.${encodeURIComponent(
      seriesId
    )}&owner_user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

function ensureSeriesEditable(seriesRow, headers) {
  if (seriesRow?.status === "suspended" || seriesRow?.suspended_at) {
    return jsonResponse(
      { error: "FORBIDDEN", code: "SERIES_SUSPENDED" },
      { status: 403, headers }
    );
  }
  return null;
}

async function fetchPublicSeries(env, slug) {
  const res = await supabaseRest(env, "/rest/v1/series", {
    query: `?select=id,slug,title,description,category,purchase_url,status,suspended_at&slug=eq.${encodeURIComponent(
      slug
    )}&status=eq.published&suspended_at=is.null&limit=1`,
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

async function fetchSeriesPrizes(env, seriesId, { activeOnly = false, stockOnly = false } = {}) {
  const filters = [
    `series_id=eq.${encodeURIComponent(seriesId)}`,
    "order=created_at.desc",
  ];
  if (activeOnly) filters.push("is_active=is.true");
  if (stockOnly) filters.push("stock=gt.0");
  const query = `?select=id,series_id,name,image_url,stock,weight,is_active&${filters.join("&")}`;
  const res = await supabaseRest(env, "/rest/v1/series_prizes", { query });
  if (!res.ok) return null;
  return res.json();
}

async function decrementSeriesPrizeStock(env, prize) {
  const current = Number(prize.stock || 0);
  if (current <= 0) return null;
  const res = await supabaseRest(env, "/rest/v1/series_prizes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    query: `?id=eq.${encodeURIComponent(prize.id)}&stock=gt.0`,
    body: JSON.stringify({ stock: current - 1, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

async function appendModerationAction(env, { targetType, targetId, action, reason, actor = "admin" }) {
  const res = await supabaseRest(env, "/rest/v1/moderation_actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_type: targetType,
      target_id: targetId,
      action,
      reason: reason || null,
      actor,
      created_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    console.error("moderation_actions insert failed", await res.text());
  }
}

async function appendAuditLog(env, { actor, action, targetType, targetId, payload = {} }) {
  const res = await supabaseRest(env, "/rest/v1/audit_logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actor,
      action,
      target_type: targetType,
      target_id: String(targetId),
      payload,
      created_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    console.error("audit_logs insert failed", await res.text());
  }
}

function getDailyLimit(env, key, fallback) {
  const raw = env[key];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

async function enforceDailyLimit(env, headers, bucketKey, limit) {
  const res = await supabaseRest(env, "/rest/v1/rpc/increment_daily_usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_bucket_key: bucketKey,
      p_limit: limit,
    }),
  });
  if (!res.ok) {
    return jsonResponse(
      { error: "RATE_LIMIT_CHECK_FAILED" },
      { status: 500, headers }
    );
  }
  const payload = await res.json();
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row?.allowed) {
    return jsonResponse(
      {
        error: "RATE_LIMIT_EXCEEDED",
        code: "DAILY_LIMIT_EXCEEDED",
        limit,
      },
      { status: 429, headers }
    );
  }
  return null;
}

function unixToIsoOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

async function stripeRequest(env, path, { method = "POST", form = {} } = {}) {
  if (!env.STRIPE_SECRET_KEY) {
    return { ok: false, code: "MISSING_STRIPE_SECRET_KEY" };
  }
  const body = new URLSearchParams();
  Object.entries(form).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    body.set(k, String(v));
  });
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      code: "STRIPE_API_FAILED",
      status: res.status,
      stripe_error: json?.error?.message || "unknown_stripe_error",
    };
  }
  return { ok: true, data: json };
}

async function getSellerSubscriptionByUserId(env, userId) {
  const res = await supabaseRest(env, "/rest/v1/seller_subscriptions", {
    query: `?select=user_id,stripe_customer_id,stripe_subscription_id,plan_code,status,current_period_end,cancel_at_period_end,created_at,updated_at&user_id=eq.${encodeURIComponent(
      userId
    )}&limit=1`,
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

async function getSellerSubscriptionByStripeSubscriptionId(env, stripeSubscriptionId) {
  const res = await supabaseRest(env, "/rest/v1/seller_subscriptions", {
    query: `?select=user_id,stripe_customer_id,stripe_subscription_id,plan_code,status,current_period_end,cancel_at_period_end,created_at,updated_at&stripe_subscription_id=eq.${encodeURIComponent(
      stripeSubscriptionId
    )}&limit=1`,
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

async function getSellerSubscriptionByStripeCustomerId(env, stripeCustomerId) {
  const res = await supabaseRest(env, "/rest/v1/seller_subscriptions", {
    query: `?select=user_id,stripe_customer_id,stripe_subscription_id,plan_code,status,current_period_end,cancel_at_period_end,created_at,updated_at&stripe_customer_id=eq.${encodeURIComponent(
      stripeCustomerId
    )}&limit=1`,
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

async function upsertSellerSubscription(env, userId, update) {
  const current = await getSellerSubscriptionByUserId(env, userId);
  const payload = {
    user_id: userId,
    plan_code: "creator_monthly",
    status: "inactive",
    cancel_at_period_end: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...update,
  };
  if (current) {
    const patchRes = await supabaseRest(env, "/rest/v1/seller_subscriptions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      query: `?user_id=eq.${encodeURIComponent(userId)}`,
      body: JSON.stringify({ ...payload, created_at: current.created_at || payload.created_at }),
    });
    if (!patchRes.ok) return null;
    const rows = await patchRes.json();
    return rows?.[0] || null;
  }
  const insertRes = await supabaseRest(env, "/rest/v1/seller_subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!insertRes.ok) return null;
  const rows = await insertRes.json();
  return rows?.[0] || null;
}

async function handleBillingApi(request, env, url, allowOrigin) {
  const baseHeaders = corsHeaders(allowOrigin);
  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

  const auth = await requireUserId(request, env, baseHeaders);
  if (auth.error) return auth.error;
  const userId = auth.userId;
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[2] === "subscription" && request.method === "GET") {
    const row = await getSellerSubscriptionByUserId(env, userId);
    return jsonResponse(
      {
        user_id: userId,
        status: row?.status || "inactive",
        plan_code: row?.plan_code || "creator_monthly",
        stripe_customer_id: row?.stripe_customer_id || null,
        stripe_subscription_id: row?.stripe_subscription_id || null,
        current_period_end: row?.current_period_end || null,
        cancel_at_period_end: Boolean(row?.cancel_at_period_end),
      },
      { status: 200, headers: baseHeaders }
    );
  }

  if (segments[2] === "checkout-session" && request.method === "POST") {
    const checkoutLimit = getDailyLimit(env, "DAILY_LIMIT_BILLING_CHECKOUT", 20);
    const checkoutLimitError = await enforceDailyLimit(
      env,
      baseHeaders,
      `billing_checkout:${userId}`,
      checkoutLimit
    );
    if (checkoutLimitError) return checkoutLimitError;

    if (!env.STRIPE_PRICE_ID) {
      return jsonResponse({ error: "MISSING_STRIPE_PRICE_ID" }, { status: 500, headers: baseHeaders });
    }
    if (!env.STRIPE_SUCCESS_URL || !env.STRIPE_CANCEL_URL) {
      return jsonResponse(
        { error: "MISSING_STRIPE_REDIRECT_URLS" },
        { status: 500, headers: baseHeaders }
      );
    }

    const current = await getSellerSubscriptionByUserId(env, userId);
    let stripeCustomerId = current?.stripe_customer_id || null;

    if (!stripeCustomerId) {
      const customerCreate = await stripeRequest(env, "/v1/customers", {
        form: {
          "metadata[user_id]": userId,
        },
      });
      if (!customerCreate.ok) {
        return jsonResponse(
          {
            error: customerCreate.code,
            stripe_error: customerCreate.stripe_error || null,
          },
          { status: 502, headers: baseHeaders }
        );
      }
      stripeCustomerId = customerCreate.data.id;
    }

    const checkout = await stripeRequest(env, "/v1/checkout/sessions", {
      form: {
        mode: "subscription",
        customer: stripeCustomerId,
        "line_items[0][price]": env.STRIPE_PRICE_ID,
        "line_items[0][quantity]": 1,
        success_url: env.STRIPE_SUCCESS_URL,
        cancel_url: env.STRIPE_CANCEL_URL,
        allow_promotion_codes: "true",
        client_reference_id: userId,
        "metadata[user_id]": userId,
      },
    });
    if (!checkout.ok) {
      return jsonResponse(
        {
          error: checkout.code,
          stripe_error: checkout.stripe_error || null,
        },
        { status: 502, headers: baseHeaders }
      );
    }

    await upsertSellerSubscription(env, userId, {
      stripe_customer_id: stripeCustomerId,
      status: current?.status || "inactive",
      updated_at: new Date().toISOString(),
    });
    await appendAuditLog(env, {
      actor: userId,
      action: "billing_checkout_session_create",
      targetType: "user",
      targetId: userId,
      payload: { stripe_customer_id: stripeCustomerId, checkout_session_id: checkout.data.id },
    });

    return jsonResponse(
      { ok: true, id: checkout.data.id, url: checkout.data.url },
      { status: 200, headers: baseHeaders }
    );
  }

  if (segments[2] === "customer-portal" && request.method === "POST") {
    const portalLimit = getDailyLimit(env, "DAILY_LIMIT_BILLING_PORTAL", 40);
    const portalLimitError = await enforceDailyLimit(
      env,
      baseHeaders,
      `billing_portal:${userId}`,
      portalLimit
    );
    if (portalLimitError) return portalLimitError;

    const current = await getSellerSubscriptionByUserId(env, userId);
    const stripeCustomerId = current?.stripe_customer_id || null;
    if (!stripeCustomerId) {
      return jsonResponse({ error: "NO_STRIPE_CUSTOMER" }, { status: 400, headers: baseHeaders });
    }
    const portal = await stripeRequest(env, "/v1/billing_portal/sessions", {
      form: {
        customer: stripeCustomerId,
        return_url: env.STRIPE_SUCCESS_URL || "http://localhost:8080/creator.html",
      },
    });
    if (!portal.ok) {
      return jsonResponse(
        {
          error: portal.code,
          stripe_error: portal.stripe_error || null,
        },
        { status: 502, headers: baseHeaders }
      );
    }
    await appendAuditLog(env, {
      actor: userId,
      action: "billing_portal_session_create",
      targetType: "user",
      targetId: userId,
      payload: { stripe_customer_id: stripeCustomerId },
    });
    return jsonResponse(
      { ok: true, url: portal.data.url },
      { status: 200, headers: baseHeaders }
    );
  }

  return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: baseHeaders });
}

function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseStripeSignatureHeader(header) {
  const parts = String(header || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const out = { t: null, v1: [] };
  for (const part of parts) {
    const [k, v] = part.split("=", 2);
    if (k === "t") out.t = v;
    if (k === "v1") out.v1.push(v);
  }
  return out;
}

async function handleBillingWebhook(request, env, allowOrigin) {
  const baseHeaders = corsHeaders(allowOrigin);
  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

  const rawBody = await request.text();
  let event;

  if (env.STRIPE_WEBHOOK_SECRET) {
    const sigHeader = request.headers.get("Stripe-Signature");
    if (!sigHeader) {
      return jsonResponse({ error: "MISSING_STRIPE_SIGNATURE" }, { status: 400, headers: baseHeaders });
    }
    const parsed = parseStripeSignatureHeader(sigHeader);
    if (!parsed.t || !parsed.v1.length) {
      return jsonResponse({ error: "INVALID_STRIPE_SIGNATURE" }, { status: 400, headers: baseHeaders });
    }
    const signedPayload = `${parsed.t}.${rawBody}`;
    const expected = await hmacSha256Hex(env.STRIPE_WEBHOOK_SECRET, signedPayload);
    const matched = parsed.v1.some((sig) => timingSafeEqualHex(sig, expected));
    if (!matched) {
      return jsonResponse({ error: "INVALID_STRIPE_SIGNATURE" }, { status: 400, headers: baseHeaders });
    }
  }

  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "INVALID_JSON" }, { status: 400, headers: baseHeaders });
  }

  const type = event?.type || "";
  const obj = event?.data?.object || {};
  let targetUserId = null;

  if (type === "checkout.session.completed") {
    targetUserId = String(obj?.client_reference_id || obj?.metadata?.user_id || "").trim() || null;
    if (targetUserId) {
      await upsertSellerSubscription(env, targetUserId, {
        stripe_customer_id: obj?.customer || null,
        stripe_subscription_id: obj?.subscription || null,
        status: "active",
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted"
  ) {
    const stripeSubscriptionId = String(obj?.id || "").trim();
    const stripeCustomerId = String(obj?.customer || "").trim();
    const bySubscription = stripeSubscriptionId
      ? await getSellerSubscriptionByStripeSubscriptionId(env, stripeSubscriptionId)
      : null;
    const byCustomer = !bySubscription && stripeCustomerId
      ? await getSellerSubscriptionByStripeCustomerId(env, stripeCustomerId)
      : null;
    targetUserId = bySubscription?.user_id || byCustomer?.user_id || null;
    if (targetUserId) {
      const normalizedStatus =
        type === "customer.subscription.deleted"
          ? "canceled"
          : String(obj?.status || "inactive");
      await upsertSellerSubscription(env, targetUserId, {
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId || null,
        status: normalizedStatus,
        current_period_end: unixToIsoOrNull(obj?.current_period_end),
        cancel_at_period_end: Boolean(obj?.cancel_at_period_end),
        updated_at: new Date().toISOString(),
      });
    }
  }

  await appendAuditLog(env, {
    actor: "stripe_webhook",
    action: "billing_webhook",
    targetType: "user",
    targetId: targetUserId || "unknown",
    payload: { event_type: type, event_id: event?.id || null },
  });

  return jsonResponse({ ok: true }, { status: 200, headers: baseHeaders });
}

async function handleCreatorApi(request, env, url, allowOrigin) {
  const baseHeaders = corsHeaders(allowOrigin);
  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

  const auth = await requireUserId(request, env, baseHeaders);
  if (auth.error) return auth.error;
  const userId = auth.userId;
  const profile = await ensureSellerProfile(env, userId);
  if (!profile) {
    return jsonResponse({ error: "PROFILE_SETUP_FAILED" }, { status: 500, headers: baseHeaders });
  }

  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[2] === "me" && request.method === "GET") {
    return jsonResponse(
      {
        user_id: userId,
        status: profile.status || "active",
        terms_accepted_at: profile.terms_accepted_at || null,
      },
      { status: 200, headers: baseHeaders }
    );
  }

  if (segments[2] === "terms" && segments[3] === "accept" && request.method === "POST") {
    const res = await supabaseRest(env, "/rest/v1/seller_profiles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      query: `?user_id=eq.${encodeURIComponent(userId)}`,
      body: JSON.stringify({
        terms_accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      return jsonResponse({ error: "TERMS_ACCEPT_FAILED" }, { status: 500, headers: baseHeaders });
    }
    const rows = await res.json();
    return jsonResponse(rows?.[0] || {}, { status: 200, headers: baseHeaders });
  }

  if (segments[2] === "series" && segments.length === 3 && request.method === "POST") {
    const body = await parseJsonBody(request, baseHeaders);
    if (body.error) return body.error;
    const payload = body.data || {};

    const title = String(payload.title || "").trim();
    const description = String(payload.description || "").trim();
    const purchaseUrl = String(payload.purchase_url || "").trim();
    if (!title || !description || !purchaseUrl) {
      return jsonResponse(
        { error: "VALIDATION_FAILED", code: "MISSING_REQUIRED_FIELDS" },
        { status: 400, headers: baseHeaders }
      );
    }
    if (!isHttpUrl(purchaseUrl)) {
      return jsonResponse(
        { error: "VALIDATION_FAILED", code: "INVALID_PURCHASE_URL" },
        { status: 400, headers: baseHeaders }
      );
    }
    const category = "lure";
    const baseSlug = slugify(title);
    let slug = "";
    try {
      slug = await ensureUniqueSlug(env, baseSlug);
    } catch {
      return jsonResponse({ error: "SLUG_GENERATION_FAILED" }, { status: 500, headers: baseHeaders });
    }

    const res = await supabaseRest(env, "/rest/v1/series", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        owner_user_id: userId,
        slug,
        title,
        description,
        category,
        purchase_url: purchaseUrl,
        status: "draft",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      return jsonResponse({ error: "SERIES_CREATE_FAILED" }, { status: 500, headers: baseHeaders });
    }
    const rows = await res.json();
    return jsonResponse(rows?.[0] || {}, { status: 201, headers: baseHeaders });
  }

  if (segments[2] === "series" && segments.length === 3 && request.method === "GET") {
    const res = await supabaseRest(env, "/rest/v1/series", {
      query: `?select=id,slug,title,description,category,purchase_url,status,suspended_at,created_at,updated_at&owner_user_id=eq.${encodeURIComponent(
        userId
      )}&order=updated_at.desc`,
    });
    if (!res.ok) {
      return jsonResponse({ error: "SERIES_LIST_FAILED" }, { status: 500, headers: baseHeaders });
    }
    const rows = await res.json();
    return jsonResponse({ items: rows }, { status: 200, headers: baseHeaders });
  }

  if (segments[2] === "series" && segments[3] && segments.length === 4 && request.method === "PATCH") {
    const seriesId = segments[3];
    const owned = await getOwnedSeries(env, seriesId, userId);
    if (!owned) {
      return jsonResponse({ error: "NOT_FOUND_OR_FORBIDDEN" }, { status: 403, headers: baseHeaders });
    }
    const suspendError = ensureSeriesEditable(owned, baseHeaders);
    if (suspendError) return suspendError;
    const body = await parseJsonBody(request, baseHeaders);
    if (body.error) return body.error;
    const payload = body.data || {};

    const update = {};
    if (payload.title !== undefined) update.title = payload.title;
    if (payload.title !== undefined) update.title = String(payload.title || "").trim();
    if (payload.description !== undefined) update.description = String(payload.description || "").trim();
    if (payload.purchase_url !== undefined) {
      const purchaseUrl = String(payload.purchase_url || "").trim();
      if (purchaseUrl && !isHttpUrl(purchaseUrl)) {
        return jsonResponse(
          { error: "VALIDATION_FAILED", code: "INVALID_PURCHASE_URL" },
          { status: 400, headers: baseHeaders }
        );
      }
      update.purchase_url = purchaseUrl;
    }
    if (payload.category !== undefined) update.category = "lure";
    if (payload.status !== undefined) {
      if (!["draft", "published"].includes(payload.status)) {
        return jsonResponse(
          { error: "VALIDATION_FAILED", code: "INVALID_STATUS" },
          { status: 400, headers: baseHeaders }
        );
      }
      update.status = payload.status;
    }

    const desiredStatus = update.status || owned.status;
    const nextRow = { ...owned, ...update };
    if (desiredStatus === "published") {
      const valid = await validatePublishable(env, nextRow, userId);
      if (!valid.ok) {
        return jsonResponse(
          { error: "VALIDATION_FAILED", code: valid.code },
          { status: 400, headers: baseHeaders }
        );
      }
    }
    if (Object.keys(update).length === 0) {
      return jsonResponse({ error: "NO_FIELDS" }, { status: 400, headers: baseHeaders });
    }
    update.updated_at = new Date().toISOString();
    if (update.status !== "suspended" && owned.suspended_at) {
      update.suspended_at = null;
    }

    const res = await supabaseRest(env, "/rest/v1/series", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      query: `?id=eq.${encodeURIComponent(seriesId)}&owner_user_id=eq.${encodeURIComponent(userId)}`,
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      return jsonResponse({ error: "SERIES_UPDATE_FAILED" }, { status: 500, headers: baseHeaders });
    }
    const rows = await res.json();
    return jsonResponse(rows?.[0] || {}, { status: 200, headers: baseHeaders });
  }

  if (segments[2] === "series" && segments[3] && segments[4] === "prizes") {
    const seriesId = segments[3];
    const owned = await getOwnedSeries(env, seriesId, userId);
    if (!owned) {
      return jsonResponse({ error: "NOT_FOUND_OR_FORBIDDEN" }, { status: 403, headers: baseHeaders });
    }
    const suspendError = ensureSeriesEditable(owned, baseHeaders);
    if (suspendError) return suspendError;

    if (request.method === "POST") {
      const body = await parseJsonBody(request, baseHeaders);
      if (body.error) return body.error;
      const payload = body.data || {};
      const stock = Number(payload.stock ?? 0);
      const weight = Number(payload.weight ?? 1);
      if (!payload.name || stock < 0 || weight < 1) {
        return jsonResponse(
          { error: "VALIDATION_FAILED", code: "INVALID_PRIZE_FIELDS" },
          { status: 400, headers: baseHeaders }
        );
      }
      const res = await supabaseRest(env, "/rest/v1/series_prizes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({
          series_id: seriesId,
          name: payload.name,
          image_url: payload.image_url || "",
          stock,
          weight,
          is_active: payload.is_active !== false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        return jsonResponse({ error: "PRIZE_CREATE_FAILED" }, { status: 500, headers: baseHeaders });
      }
      const rows = await res.json();
      return jsonResponse(rows?.[0] || {}, { status: 201, headers: baseHeaders });
    }

    if (request.method === "GET") {
      const prizes = await fetchSeriesPrizes(env, seriesId);
      if (!prizes) {
        return jsonResponse({ error: "PRIZE_LIST_FAILED" }, { status: 500, headers: baseHeaders });
      }
      return jsonResponse({ items: prizes }, { status: 200, headers: baseHeaders });
    }
  }

  if (segments[2] === "prizes" && segments[3] && request.method === "PATCH") {
    const prizeId = segments[3];
    const lookup = await supabaseRest(env, "/rest/v1/series_prizes", {
      query: `?select=id,series_id&id=eq.${encodeURIComponent(prizeId)}&limit=1`,
    });
    if (!lookup.ok) {
      return jsonResponse({ error: "PRIZE_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders });
    }
    const rows = await lookup.json();
    const prize = rows?.[0];
    if (!prize) {
      return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: baseHeaders });
    }
    const owned = await getOwnedSeries(env, prize.series_id, userId);
    if (!owned) {
      return jsonResponse({ error: "NOT_FOUND_OR_FORBIDDEN" }, { status: 403, headers: baseHeaders });
    }
    const suspendError = ensureSeriesEditable(owned, baseHeaders);
    if (suspendError) return suspendError;
    const body = await parseJsonBody(request, baseHeaders);
    if (body.error) return body.error;
    const payload = body.data || {};
    const update = {};
    if (payload.name !== undefined) update.name = payload.name;
    if (payload.image_url !== undefined) update.image_url = payload.image_url;
    if (payload.stock !== undefined) {
      const stock = Number(payload.stock);
      if (!Number.isFinite(stock) || stock < 0) {
        return jsonResponse(
          { error: "VALIDATION_FAILED", code: "INVALID_STOCK" },
          { status: 400, headers: baseHeaders }
        );
      }
      update.stock = stock;
    }
    if (payload.weight !== undefined) {
      const weight = Number(payload.weight);
      if (!Number.isFinite(weight) || weight < 1) {
        return jsonResponse(
          { error: "VALIDATION_FAILED", code: "INVALID_WEIGHT" },
          { status: 400, headers: baseHeaders }
        );
      }
      update.weight = weight;
    }
    if (payload.is_active !== undefined) update.is_active = Boolean(payload.is_active);
    if (Object.keys(update).length === 0) {
      return jsonResponse({ error: "NO_FIELDS" }, { status: 400, headers: baseHeaders });
    }
    update.updated_at = new Date().toISOString();

    const res = await supabaseRest(env, "/rest/v1/series_prizes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      query: `?id=eq.${encodeURIComponent(prizeId)}`,
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      return jsonResponse({ error: "PRIZE_UPDATE_FAILED" }, { status: 500, headers: baseHeaders });
    }
    const updated = await res.json();
    return jsonResponse(updated?.[0] || {}, { status: 200, headers: baseHeaders });
  }

  return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: baseHeaders });
}

async function handlePublicSeriesGet(env, slug, headers) {
  const row = await fetchPublicSeries(env, slug);
  if (!row) {
    return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers });
  }
  const prizes = await fetchSeriesPrizes(env, row.id, { activeOnly: true, stockOnly: true });
  if (!prizes) {
    return jsonResponse({ error: "PRIZE_LIST_FAILED" }, { status: 500, headers });
  }
  return jsonResponse(
    {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      category: row.category,
      purchase_url: row.purchase_url,
      disclaimer:
        "購入・配送・返金・問い合わせは販売者の責任で行われます。運営は取引の当事者ではありません。",
      prizes: prizes.map((item) => ({
        id: item.id,
        name: item.name,
        image_url: item.image_url || null,
        stock: item.stock,
      })),
    },
    { status: 200, headers }
  );
}

async function handlePublicSeriesSpin(request, env, slug, headers) {
  const row = await fetchPublicSeries(env, slug);
  if (!row) {
    return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers });
  }
  const prizes = await fetchSeriesPrizes(env, row.id, { activeOnly: true, stockOnly: true });
  if (!prizes || prizes.length === 0) {
    return jsonResponse(
      { error: "OUT_OF_STOCK", code: "NO_AVAILABLE_PRIZES" },
      { status: 400, headers }
    );
  }

  let selected = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const picked = chooseWeightedPrize(prizes);
    if (!picked) break;
    const updated = await decrementSeriesPrizeStock(env, picked);
    if (updated) {
      selected = { picked, updated };
      break;
    }
  }
  if (!selected) {
    return jsonResponse(
      { error: "OUT_OF_STOCK", code: "CONCURRENT_STOCK_EMPTY" },
      { status: 409, headers }
    );
  }

  const guestToken = getGuestTokenFromRequest(request) || generateGuestToken();
  const guestHash = await sha256(guestToken);
  await supabaseRest(env, "/rest/v1/series_spin_results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      series_id: row.id,
      prize_id: selected.picked.id,
      visitor_token_hash: guestHash,
      result: "WIN",
      created_at: new Date().toISOString(),
    }),
  });

  const setCookie = request.headers.get("X-Guest-Token")
    ? null
    : `gl_guest=${guestToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;

  return jsonResponse(
    {
      result: "WIN",
      message: "当選しました。販売者の案内に従って購入へ進んでください。",
      prize: {
        id: selected.picked.id,
        name: selected.picked.name,
        image_url: selected.picked.image_url || null,
      },
    },
    { status: 200, headers, setCookie }
  );
}

async function handlePublicApi(request, env, url, allowOrigin) {
  const baseHeaders = corsHeaders(allowOrigin);
  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[2] === "report" && request.method === "POST") {
    const clientIp =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "unknown";
    const reportLimit = getDailyLimit(env, "DAILY_LIMIT_PUBLIC_REPORT", 50);
    const reportLimitError = await enforceDailyLimit(
      env,
      baseHeaders,
      `public_report:${String(clientIp).split(",")[0].trim() || "unknown"}`,
      reportLimit
    );
    if (reportLimitError) return reportLimitError;

    const body = await parseJsonBody(request, baseHeaders);
    if (body.error) return body.error;
    const payload = body.data || {};
    const slug = String(payload.series_slug || "").trim();
    const reasonCode = String(payload.reason_code || "").trim();
    const detail = String(payload.detail || "").trim();
    const reporterContact = String(payload.reporter_contact || "").trim();

    if (!slug || !reasonCode) {
      return jsonResponse(
        { error: "VALIDATION_FAILED", code: "MISSING_REQUIRED_FIELDS" },
        { status: 400, headers: baseHeaders }
      );
    }

    const targetSeries = await fetchPublicSeries(env, slug);
    if (!targetSeries) {
      return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: baseHeaders });
    }

    const insertRes = await supabaseRest(env, "/rest/v1/series_reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        series_id: targetSeries.id,
        reporter_contact: reporterContact || null,
        reason_code: reasonCode,
        detail: detail || null,
        status: "open",
        created_at: new Date().toISOString(),
      }),
    });
    if (!insertRes.ok) {
      return jsonResponse({ error: "REPORT_CREATE_FAILED" }, { status: 500, headers: baseHeaders });
    }
    const rows = await insertRes.json();

    await appendAuditLog(env, {
      actor: reporterContact || "public_reporter",
      action: "report_create",
      targetType: "series",
      targetId: targetSeries.id,
      payload: { reason_code: reasonCode, report_id: rows?.[0]?.id || null },
    });

    return jsonResponse({ ok: true, item: rows?.[0] || {} }, { status: 201, headers: baseHeaders });
  }

  if (segments[2] === "series" && segments[3]) {
    const slug = segments[3];
    if (request.method === "GET") {
      return handlePublicSeriesGet(env, slug, baseHeaders);
    }
    if (request.method === "POST" && segments[4] === "spin") {
      return handlePublicSeriesSpin(request, env, slug, baseHeaders);
    }
  }
  return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: baseHeaders });
}

function renderSeriesPageHtml(slug) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Series</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0b1015; color: #f0f4f8; }
      main { max-width: 760px; margin: 0 auto; padding: 24px 16px 40px; }
      .card { background: #121b24; border: 1px solid #243240; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
      .btn { background: #1f8bff; color: #fff; border: 0; border-radius: 10px; padding: 10px 16px; cursor: pointer; font-weight: 600; }
      .muted { color: #9cb0c3; font-size: 13px; white-space: pre-line; }
      .grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .prize { border: 1px solid #263746; border-radius: 10px; padding: 10px; background: #0f1720; }
      img { width: 100%; border-radius: 8px; object-fit: cover; max-height: 140px; }
      #result { font-weight: 700; margin-top: 12px; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1 id="title">読み込み中...</h1>
        <p id="description" class="muted"></p>
        <button id="spin" class="btn">ガチャを回す</button>
        <div id="result"></div>
      </section>
      <section class="card">
        <h2>候補景品</h2>
        <div id="prizes" class="grid"></div>
      </section>
      <section class="card">
        <p id="disclaimer" class="muted"></p>
      </section>
    </main>
    <script>
      const slug = ${JSON.stringify(slug)};
      const titleEl = document.getElementById("title");
      const descEl = document.getElementById("description");
      const resultEl = document.getElementById("result");
      const prizesEl = document.getElementById("prizes");
      const disclaimerEl = document.getElementById("disclaimer");
      const spinBtn = document.getElementById("spin");
      async function loadSeries() {
        const res = await fetch("/api/public/series/" + encodeURIComponent(slug));
        if (!res.ok) {
          titleEl.textContent = "このシリーズは公開されていません";
          spinBtn.disabled = true;
          return;
        }
        const data = await res.json();
        titleEl.textContent = data.title;
        descEl.textContent = data.description || "";
        disclaimerEl.textContent = data.disclaimer || "";
        prizesEl.innerHTML = "";
        (data.prizes || []).forEach((item) => {
          const div = document.createElement("div");
          div.className = "prize";
          div.innerHTML = (item.image_url ? '<img src="' + item.image_url + '" alt="' + item.name + '" />' : "") + "<div>" + item.name + "</div>";
          prizesEl.appendChild(div);
        });
      }
      spinBtn.addEventListener("click", async () => {
        spinBtn.disabled = true;
        resultEl.textContent = "抽選中...";
        const res = await fetch("/api/public/series/" + encodeURIComponent(slug) + "/spin", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          resultEl.textContent = data.code || data.error || "抽選に失敗しました";
          spinBtn.disabled = false;
          return;
        }
        resultEl.textContent = "当選: " + (data.prize?.name || "-") + " / " + (data.message || "");
        spinBtn.disabled = false;
      });
      loadSeries();
    </script>
  </body>
</html>`;
}

async function handleSpin(request, env) {
  const allowOrigin = resolveAllowedOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const baseHeaders = {
    ...corsHeaders(allowOrigin),
    "X-Worker-Deploy": DEPLOY_ID,
  };
  const spinJson = (result, options = {}) => {
    console.log("SPIN RESPONSE", result);
    return jsonResponse(result, options);
  };

  try {
    const envError = ensureSupabaseEnv(env, baseHeaders);
    if (envError) {
      return spinJson({ error: "MISSING_SUPABASE_ENV" }, { status: 500, headers: baseHeaders });
    }

  const url = new URL(request.url);
  let gachaId = url.searchParams.get("gacha_id");
  let gachaSource = gachaId ? "query" : "body";
  const contentType = request.headers.get("Content-Type") || "";
  let rawBody = "";
  let bodyLen = 0;

  if (gachaId) {
    try {
      bodyLen = (await request.clone().text()).length;
    } catch {
      bodyLen = 0;
    }
  } else {
    try {
      rawBody = await request.text();
    } catch {
      rawBody = "";
    }

    bodyLen = rawBody.length;

    if (!rawBody) {
      console.log("spin empty body", {
        contentType,
        length: 0,
      });
      return spinJson(
        { error: "EMPTY_BODY", debug: { contentType, bodyLen } },
        { status: 400, headers: baseHeaders }
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      console.log("spin invalid json", {
        contentType,
        length: rawBody.length,
      });
      return spinJson(
        { error: "INVALID_JSON", debug: { contentType, bodyLen } },
        { status: 400, headers: baseHeaders }
      );
    }

    gachaId = parsed?.gacha_id;
    gachaSource = "body";
  }

  if (!gachaId) {
    console.log("spin missing gacha_id", {
      contentType,
      length: rawBody.length,
    });
    return spinJson(
      { error: "MISSING_GACHA_ID", debug: { contentType, bodyLen } },
      { status: 400, headers: baseHeaders }
    );
  }

  console.log("spin received", { gacha_id: gachaId, source: gachaSource });
  const gacha = await getGacha(env, gachaId);
  console.log("gacha lookup", { found: !!gacha, gacha_id: gachaId });
  if (!gacha) {
    return spinJson(
      { status: "ERROR", code: "GACHA_NOT_FOUND" },
      { status: 404, headers: baseHeaders }
    );
  }
  if (!gacha.is_active) {
    return spinJson(
      { status: "ERROR", code: "GACHA_INACTIVE" },
      { status: 200, headers: baseHeaders }
    );
  }

  const authHeader = request.headers.get("Authorization") || "";
  let userId = null;
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    userId = await supabaseAuthUser(env, token);
    if (!userId) {
      return spinJson({ error: "UNAUTHORIZED" }, { status: 401, headers: baseHeaders });
    }
  }

  const headerGuestToken = request.headers.get("X-Guest-Token");
  let guestToken = getGuestTokenFromRequest(request);
  const hadGuestToken = Boolean(guestToken);
  let setCookie = null;
  if (!guestToken) {
    guestToken = generateGuestToken();
    setCookie =
      `gl_guest=${guestToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
  }
  const guestHash = await sha256(guestToken);

  if (!userId) {
    const existingRes = await supabaseRest(env, "/rest/v1/gacha_results", {
      query: `?select=id&gacha_id=eq.${encodeURIComponent(gachaId)}&guest_token=eq.${encodeURIComponent(
        guestToken
      )}&limit=1`,
    });
    if (!existingRes.ok) {
      return spinJson({ error: "RESULT_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
    }
    const existing = await existingRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      return spinJson({ error: "ALREADY_SPUN" }, { status: 409, headers: baseHeaders, setCookie });
    }
  }

  let freeResultNeedLogin = false;
  let guestFreeUsed = false;
  let guestFreeUsedCount = 0;
  let skipLoginFlow = false;
  if (!userId || headerGuestToken) {
    const usedRes = await supabaseRest(env, "/rest/v1/guest_free_spins", {
      query: `?select=used_at&gacha_id=eq.${encodeURIComponent(gachaId)}&guest_token_hash=eq.${encodeURIComponent(guestHash)}&limit=1`,
    });
    if (!usedRes.ok) {
      return spinJson({ error: "GUEST_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
    }
    const usedData = await usedRes.json();
    guestFreeUsedCount = Array.isArray(usedData) ? usedData.length : 0;
    guestFreeUsed = guestFreeUsedCount > 0;
    if (usedData.length > 0) {
      console.log("spin status decide", {
        status: "NEED_LOGIN_FREE",
        guestFreeUsed,
        guestFreeUsedCount,
        headerGuestToken,
        guestToken,
        hadGuestToken,
        userId,
      });
      if (!userId) {
        return spinJson({ status: "NEED_LOGIN_FREE" }, { status: 200, headers: baseHeaders, setCookie });
      }
    } else {
      const markRes = await supabaseRest(env, "/rest/v1/guest_free_spins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gacha_id: gachaId,
          guest_token_hash: guestHash,
          used_at: new Date().toISOString(),
        }),
      });
      if (!markRes.ok) {
        return spinJson({ error: "GUEST_MARK_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
      freeResultNeedLogin = true;
      if (userId) {
        skipLoginFlow = true;
      }
    }
  }

  if (userId && !skipLoginFlow) {
    const bonusRes = await supabaseRest(env, "/rest/v1/user_bonus", {
      query: `?select=login_free_used&gacha_id=eq.${encodeURIComponent(gachaId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    });
    if (!bonusRes.ok) {
      return spinJson({ error: "BONUS_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
    }
    const bonusData = await bonusRes.json();
    if (bonusData.length === 0) {
      const insertRes = await supabaseRest(env, "/rest/v1/user_bonus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gacha_id: gachaId,
          user_id: userId,
          login_free_used: false,
        }),
      });
      if (!insertRes.ok) {
        return spinJson({ error: "BONUS_INSERT_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
    } else if (bonusData[0].login_free_used) {
      const creditsRes = await supabaseRest(env, "/rest/v1/credits", {
        query: `?select=balance&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      });
      if (!creditsRes.ok) {
        return spinJson({ error: "CREDITS_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
      const creditsData = await creditsRes.json();
      const balance = creditsData[0]?.balance ?? 0;
      if (balance <= 0) {
        return spinJson({ status: "PAYWALL" }, { status: 200, headers: baseHeaders, setCookie });
      }
      const updateRes = await supabaseRest(env, "/rest/v1/credits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        query: `?user_id=eq.${encodeURIComponent(userId)}`,
        body: JSON.stringify({
          balance: balance - 1,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!updateRes.ok) {
        return spinJson({ error: "CREDITS_UPDATE_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
    }
  }

  if (userId) {
    const checkBonusRes = await supabaseRest(env, "/rest/v1/user_bonus", {
      query: `?select=login_free_used&gacha_id=eq.${encodeURIComponent(gachaId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    });
    if (!checkBonusRes.ok) {
      return spinJson({ error: "BONUS_RECHECK_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
    }
    const checkBonus = await checkBonusRes.json();
    if (checkBonus.length > 0 && checkBonus[0].login_free_used === false) {
      const markBonusRes = await supabaseRest(env, "/rest/v1/user_bonus", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        query: `?gacha_id=eq.${encodeURIComponent(gachaId)}&user_id=eq.${encodeURIComponent(userId)}`,
        body: JSON.stringify({
          login_free_used: true,
          login_free_used_at: new Date().toISOString(),
        }),
      });
      if (!markBonusRes.ok) {
        return spinJson({ error: "BONUS_UPDATE_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
    }
  }

  const winRate = clampRate(gacha.win_rate == null ? 0.1 : gacha.win_rate);
  const isWin = winRate > 0 && Math.random() < winRate;
  let result = isWin ? "WIN" : "LOSE";
  let redeem = null;

  if (result === "WIN") {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prizes = await fetchPrizes(env, gachaId);
      if (!prizes || prizes.length === 0) {
        result = "LOSE";
        redeem = null;
        break;
      }
      const prize = chooseWeightedPrize(prizes);
      if (!prize) {
        result = "LOSE";
        redeem = null;
        break;
      }
      const updated = await decrementPrizeStock(env, prize);
      if (!updated) {
        continue;
      }
      const redeemRow = await createRedeemWin(env, gachaId, prize.id);
      if (!redeemRow) {
        console.error("redeem insert failed");
        redeem = null;
      } else {
        redeem = {
          redeem_id: redeemRow.id,
          prize: {
            id: prize.id,
            name: prize.name,
            image_url: prize.image_url || null,
          },
        };
      }
      break;
    }
    if (!redeem) {
      result = "LOSE";
    }
  }

  const spinRes = await supabaseRest(env, "/rest/v1/spins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gacha_id: gachaId,
      user_id: userId || null,
      guest_token_hash: userId ? null : guestHash,
      redeem_code: redeem?.code || null,
      result,
      created_at: new Date().toISOString(),
    }),
  });
  if (!spinRes.ok) {
    console.error("spin save failed", await spinRes.text());
  }

  const responseBody = {
    status: freeResultNeedLogin ? "FREE_RESULT_NEED_LOGIN" : "SPUN",
    result,
    redeem: result === "WIN" ? redeem : null,
    debug: { contentType, bodyLen },
    guest_token: guestToken,
  };

  if (!userId) {
    const payload = {
      status: responseBody.status,
      result,
      redeem: responseBody.redeem,
    };
    const insertRes = await supabaseRest(env, "/rest/v1/gacha_results", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify([
        {
          gacha_id: gachaId,
          guest_token: guestToken,
          user_id: null,
          result_type: result,
          payload,
          version: 1,
          created_at: new Date().toISOString(),
        },
      ]),
    });
    if (!insertRes.ok) {
      const detail = await insertRes.text();
      console.error("gacha_results insert failed", detail);
      return spinJson(
        { error: "DB_INSERT_FAILED", detail },
        { status: 500, headers: baseHeaders, setCookie }
      );
    }
    const inserted = await insertRes.json();
    responseBody.result_id = inserted?.[0]?.id || null;
  }
  console.log("spin guest token", {
    headerGuestToken,
    guestToken,
    hadGuestToken,
    userId,
  });
  console.log("spin free check", {
    guestFreeUsed,
    guestFreeUsedCount,
    freeResultNeedLogin,
  });
  console.log("spin status decide", {
    status: responseBody.status,
    result,
  });
  return spinJson(responseBody, { status: 200, headers: baseHeaders, setCookie });
  } catch (error) {
    console.error("spin handler error", error);
    return spinJson({ error: "SPIN_FAILED" }, { status: 500, headers: baseHeaders });
  }
}

async function handleMe(request, env) {
  const allowOrigin = resolveAllowedOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const baseHeaders = corsHeaders(allowOrigin);

  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers: baseHeaders });
  }
  const token = authHeader.slice("Bearer ".length);
  const userId = await supabaseAuthUser(env, token);
  if (!userId) {
    return jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers: baseHeaders });
  }

  const res = await supabaseRest(env, "/rest/v1/redeems", {
    query: `?select=redeem_code,status,issued_at&user_id=eq.${encodeURIComponent(userId)}&order=issued_at.desc&limit=20`,
  });
  if (!res.ok) {
    return jsonResponse({ error: "REDEEMS_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders });
  }
  const data = await res.json();
  return jsonResponse({ items: data }, { status: 200, headers: baseHeaders });
}

async function handleClaimGuest(request, env) {
  const allowOrigin = resolveAllowedOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const baseHeaders = corsHeaders(allowOrigin);

  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers: baseHeaders });
  }
  const token = authHeader.slice("Bearer ".length);
  const userId = await supabaseAuthUser(env, token);
  if (!userId) {
    return jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers: baseHeaders });
  }

  const guestToken = getGuestTokenFromRequest(request);
  if (!guestToken) {
    return jsonResponse({ claimed: 0, guest_token: null }, { status: 200, headers: baseHeaders });
  }
  const guestHash = await sha256(guestToken);

  const res = await supabaseRest(env, "/rest/v1/redeems", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    query: `?guest_token_hash=eq.${encodeURIComponent(guestHash)}&user_id=is.null`,
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) {
    return jsonResponse({ error: "CLAIM_FAILED" }, { status: 500, headers: baseHeaders });
  }
  const data = await res.json();
  return jsonResponse(
    { claimed: Array.isArray(data) ? data.length : 0, guest_token: guestToken },
    { status: 200, headers: baseHeaders }
  );
}

async function handleLastSpin(request, env) {
  const allowOrigin = resolveAllowedOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const baseHeaders = corsHeaders(allowOrigin);

  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

  const authHeader = request.headers.get("Authorization") || "";
  let userId = null;
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    userId = await supabaseAuthUser(env, token);
  }

  const guestToken = getGuestTokenFromRequest(request);
  const guestHash = guestToken ? await sha256(guestToken) : null;
  const fetchLast = async (query) => {
    const res = await supabaseRest(env, "/rest/v1/spins", { query });
    if (!res.ok) {
      console.error("last-spin lookup failed", await res.text());
      return null;
    }
    const data = await res.json();
    return data?.[0] || null;
  };

  try {
    let row = null;
    if (userId) {
      row = await fetchLast(
        `?select=gacha_id,result,redeem_code,created_at&user_id=eq.${encodeURIComponent(
          userId
        )}&order=created_at.desc&limit=1`
      );
    }
    if (!row && guestHash) {
      row = await fetchLast(
        `?select=gacha_id,result,redeem_code,created_at&guest_token_hash=eq.${encodeURIComponent(
          guestHash
        )}&order=created_at.desc&limit=1`
      );
    }
    if (!row) {
      return jsonResponse({ exists: false }, { status: 200, headers: baseHeaders });
    }
    return jsonResponse(
      {
        exists: true,
        gacha_id: row.gacha_id,
        result: row.result,
        redeem: row.redeem_code ? { code: row.redeem_code } : null,
        created_at: row.created_at,
      },
      { status: 200, headers: baseHeaders }
    );
  } catch (error) {
    console.error("last-spin error", error);
    return jsonResponse({ exists: false }, { status: 200, headers: baseHeaders });
  }
}

async function handleTrack(request, env) {
  const allowOrigin = resolveAllowedOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const baseHeaders = corsHeaders(allowOrigin);

  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const eventName = payload?.event_name;
  const reason = payload?.reason;
  const gachaId = payload?.gacha_id;
  if (!eventName || !reason || !gachaId) {
    return jsonResponse({ ok: true }, { status: 200, headers: baseHeaders });
  }

  const authHeader = request.headers.get("Authorization") || "";
  let userId = null;
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    userId = await supabaseAuthUser(env, token);
  }

  let guestHash = null;
  if (!userId) {
    const guestToken = getGuestTokenFromRequest(request);
    if (guestToken) {
      guestHash = await sha256(guestToken);
    }
  }

  try {
    const res = await supabaseRest(env, "/rest/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: eventName,
        reason,
        gacha_id: gachaId,
        user_id: userId || null,
        guest_token_hash: userId ? null : guestHash,
        created_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.error("track insert failed", await res.text());
    }
  } catch (error) {
    console.error("track insert error", error);
  }

  return jsonResponse({ ok: true }, { status: 200, headers: baseHeaders });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Guest-Token",
        },
      });
    }
    try {
      const url = new URL(request.url);
      console.log("[REQ]", request.method, url.pathname, "Origin:", request.headers.get("Origin"));
      const allowOrigin = resolveAllowedOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGIN);

      if (request.method === "OPTIONS") {
        return preflight(request, allowOrigin);
      }

      if (request.method === "GET" && url.pathname.startsWith("/s/")) {
        const slug = url.pathname.split("/").filter(Boolean)[1] || "";
        if (!slug) {
          return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: corsHeaders(allowOrigin) });
        }
        const series = await fetchPublicSeries(env, slug);
        if (!series) {
          return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: corsHeaders(allowOrigin) });
        }
        return new Response(renderSeriesPageHtml(slug), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=UTF-8",
            ...corsHeaders(allowOrigin),
          },
        });
      }

      if (url.pathname.startsWith("/api/creator/")) {
        return handleCreatorApi(request, env, url, allowOrigin);
      }

      if (url.pathname.startsWith("/api/public/")) {
        return handlePublicApi(request, env, url, allowOrigin);
      }

      if (url.pathname === "/api/billing/webhook" && request.method === "POST") {
        return handleBillingWebhook(request, env, allowOrigin);
      }

      if (url.pathname.startsWith("/api/billing/")) {
        return handleBillingApi(request, env, url, allowOrigin);
      }

      if (url.pathname.startsWith("/api/admin/")) {
        const baseHeaders = corsHeaders(allowOrigin);
        const envError = ensureSupabaseEnv(env, baseHeaders);
        if (envError) return envError;
        const authError = authorizeAdmin(request, env, baseHeaders);
        if (authError) return authError;

        const segments = url.pathname.split("/").filter(Boolean);
        if (segments[2] === "reports" && request.method === "GET") {
          const statusFilter = (url.searchParams.get("status") || "").trim();
          const queryParts = [
            "select=id,series_id,reporter_contact,reason_code,detail,status,created_at,resolved_at",
            "order=created_at.desc",
            "limit=100",
          ];
          if (statusFilter) {
            queryParts.push(`status=eq.${encodeURIComponent(statusFilter)}`);
          }
          const reportRes = await supabaseRest(env, "/rest/v1/series_reports", {
            query: `?${queryParts.join("&")}`,
          });
          if (!reportRes.ok) {
            return jsonResponse({ error: "REPORTS_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders });
          }
          const items = await reportRes.json();

          const seriesIds = [...new Set((items || []).map((item) => item.series_id).filter(Boolean))];
          let seriesById = new Map();
          if (seriesIds.length > 0) {
            const inClause = seriesIds.map((id) => encodeURIComponent(id)).join(",");
            const seriesRes = await supabaseRest(env, "/rest/v1/series", {
              query: `?select=id,slug,status&id=in.(${inClause})`,
            });
            if (seriesRes.ok) {
              const seriesRows = await seriesRes.json();
              seriesById = new Map((seriesRows || []).map((row) => [row.id, row]));
            }
          }

          const enriched = (items || []).map((item) => {
            const s = seriesById.get(item.series_id);
            return {
              ...item,
              series_slug: s?.slug || null,
              series_status: s?.status || null,
            };
          });
          return jsonResponse({ items: enriched }, { status: 200, headers: baseHeaders });
        }

        if (
          segments[2] === "reports" &&
          segments[3] &&
          segments[4] === "resolve" &&
          request.method === "POST"
        ) {
          const reportId = segments[3];
          const body = await parseJsonBody(request, baseHeaders);
          let note = null;
          if (!body.error) {
            note = String(body.data?.note || "").trim() || null;
          }

          const nowIso = new Date().toISOString();
          const updateRes = await supabaseRest(env, "/rest/v1/series_reports", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=representation" },
            query: `?id=eq.${encodeURIComponent(reportId)}&status=eq.open`,
            body: JSON.stringify({
              status: "closed",
              resolved_at: nowIso,
            }),
          });
          if (!updateRes.ok) {
            return jsonResponse({ error: "REPORT_RESOLVE_FAILED" }, { status: 500, headers: baseHeaders });
          }
          const updated = await updateRes.json();
          if (!updated?.length) {
            return jsonResponse(
              { error: "NOT_FOUND_OR_ALREADY_RESOLVED" },
              { status: 404, headers: baseHeaders }
            );
          }

          const item = updated[0];
          await appendAuditLog(env, {
            actor: "admin",
            action: "report_resolve",
            targetType: "series",
            targetId: item.series_id,
            payload: {
              report_id: item.id,
              note,
            },
          });

          return jsonResponse({ ok: true, item }, { status: 200, headers: baseHeaders });
        }

        if (segments[2] === "gachas" && segments[3]) {
          const gachaId = segments[3];
          if (segments.length === 4 && request.method === "GET") {
            const res = await supabaseRest(env, "/rest/v1/gachas", {
              query: `?select=id,win_rate,is_active&id=eq.${encodeURIComponent(gachaId)}&limit=1`,
            });
            if (!res.ok) {
              return jsonResponse({ error: "GACHA_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders });
            }
            const data = await res.json();
            if (!data?.length) {
              return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: baseHeaders });
            }
            return jsonResponse(data[0], { status: 200, headers: baseHeaders });
          }
          if (segments.length === 4 && request.method === "PATCH") {
            let payload = {};
            try {
              payload = await request.json();
            } catch {
              return jsonResponse({ error: "INVALID_JSON" }, { status: 400, headers: baseHeaders });
            }
            const update = {};
            if (payload.win_rate !== undefined) update.win_rate = payload.win_rate;
            if (payload.is_active !== undefined) update.is_active = payload.is_active;
            if (Object.keys(update).length === 0) {
              return jsonResponse({ error: "NO_FIELDS" }, { status: 400, headers: baseHeaders });
            }
            const res = await supabaseRest(env, "/rest/v1/gachas", {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Prefer: "return=representation" },
              query: `?id=eq.${encodeURIComponent(gachaId)}`,
              body: JSON.stringify(update),
            });
            if (!res.ok) {
              return jsonResponse({ error: "GACHA_UPDATE_FAILED" }, { status: 500, headers: baseHeaders });
            }
            const data = await res.json();
            return jsonResponse(data[0] || {}, { status: 200, headers: baseHeaders });
          }
          if (segments.length === 5 && segments[4] === "prizes" && request.method === "GET") {
            const res = await supabaseRest(env, "/rest/v1/prizes", {
              query: `?select=id,name,stock,weight,is_active,image_url&gacha_id=eq.${encodeURIComponent(
                gachaId
              )}&order=created_at.desc`,
            });
            if (!res.ok) {
              return jsonResponse({ error: "PRIZES_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders });
            }
            const data = await res.json();
            return jsonResponse({ items: data }, { status: 200, headers: baseHeaders });
          }
        }

        if (segments[2] === "series" && segments[3] && segments[4] === "suspend" && request.method === "POST") {
          const seriesId = segments[3];
          const body = await parseJsonBody(request, baseHeaders);
          let reason = null;
          if (!body.error) {
            reason = String(body.data?.reason || "").trim() || null;
          }
          const res = await supabaseRest(env, "/rest/v1/series", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=representation" },
            query: `?id=eq.${encodeURIComponent(seriesId)}`,
            body: JSON.stringify({
              status: "suspended",
              suspended_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }),
          });
          if (!res.ok) {
            return jsonResponse({ error: "SERIES_SUSPEND_FAILED" }, { status: 500, headers: baseHeaders });
          }
          const data = await res.json();
          if (!data?.length) {
            return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: baseHeaders });
          }

          await appendModerationAction(env, {
            targetType: "series",
            targetId: seriesId,
            action: "suspend",
            reason,
            actor: "admin",
          });
          await appendAuditLog(env, {
            actor: "admin",
            action: "series_suspend",
            targetType: "series",
            targetId: seriesId,
            payload: { reason },
          });

          return jsonResponse({ ok: true, item: data[0] }, { status: 200, headers: baseHeaders });
        }

        if (segments[2] === "prizes" && segments[3] && request.method === "PATCH") {
          const prizeId = segments[3];
          let payload = {};
          try {
            payload = await request.json();
          } catch {
            return jsonResponse({ error: "INVALID_JSON" }, { status: 400, headers: baseHeaders });
          }
          const update = {};
          if (payload.name !== undefined) update.name = payload.name;
          if (payload.stock !== undefined) update.stock = payload.stock;
          if (payload.weight !== undefined) update.weight = payload.weight;
          if (payload.is_active !== undefined) update.is_active = payload.is_active;
          if (payload.image_url !== undefined) update.image_url = payload.image_url;
          if (Object.keys(update).length === 0) {
            return jsonResponse({ error: "NO_FIELDS" }, { status: 400, headers: baseHeaders });
          }
          const res = await supabaseRest(env, "/rest/v1/prizes", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=representation" },
            query: `?id=eq.${encodeURIComponent(prizeId)}`,
            body: JSON.stringify(update),
          });
          if (!res.ok) {
            return jsonResponse({ error: "PRIZE_UPDATE_FAILED" }, { status: 500, headers: baseHeaders });
          }
          const data = await res.json();
          return jsonResponse(data[0] || {}, { status: 200, headers: baseHeaders });
        }
      }

      if (url.pathname === "/api/spin") {
        if (request.method === "POST") {
          return handleSpin(request, env);
        }
        return jsonResponse(
          { error: "METHOD_NOT_ALLOWED" },
          { status: 405, headers: corsHeaders(allowOrigin) }
        );
      }

      if (url.pathname === "/api/me" && request.method === "GET") {
        return handleMe(request, env);
      }

      if (url.pathname === "/api/claim-guest" && request.method === "POST") {
        return handleClaimGuest(request, env);
      }

      if (url.pathname === "/api/last-spin" && request.method === "GET") {
        return handleLastSpin(request, env);
      }

      if (url.pathname === "/api/track" && request.method === "POST") {
        return handleTrack(request, env);
      }

      return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: corsHeaders(allowOrigin) });
    } catch (e) {
      console.error("SPIN ERROR", e);
      return new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};
