var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var JSON_HEADERS = { "Content-Type": "application/json" };
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
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
__name(parseCookies, "parseCookies");
function randomString(length, alphabet) {
  let output = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}
__name(randomString, "randomString");
function generateGuestToken() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return randomString(32, alphabet);
}
__name(generateGuestToken, "generateGuestToken");
async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
function clampRate(rate) {
  const parsed = Number(rate);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}
__name(clampRate, "clampRate");
async function supabaseRest(env, path, { method = "GET", body, headers = {}, query = "" } = {}) {
  const url = `${env.SUPABASE_URL}${path}${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...headers
    },
    body
  });
  return res;
}
__name(supabaseRest, "supabaseRest");
async function supabaseAuthUser(env, token) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.id || null;
}
__name(supabaseAuthUser, "supabaseAuthUser");
async function getGacha(env, gachaId) {
  const res = await supabaseRest(env, "/rest/v1/gachas", {
    query: `?select=id,win_rate,is_active&id=eq.${encodeURIComponent(gachaId)}&limit=1`
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}
__name(getGacha, "getGacha");
async function createRedeem(env, gachaId, { userId, guestHash }) {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  for (let i = 0; i < 5; i += 1) {
    const code = `${randomString(4, letters)}-${randomString(4, digits)}`;
    const issuedAt = (/* @__PURE__ */ new Date()).toISOString();
    const expiresAt = new Date(Date.now() + 1e3 * 60 * 60 * 24 * 30).toISOString();
    const payload = {
      gacha_id: gachaId,
      user_id: userId || null,
      guest_token_hash: guestHash || null,
      redeem_code: code,
      status: "ISSUED",
      issued_at: issuedAt,
      expires_at: expiresAt
    };
    const res = await supabaseRest(env, "/rest/v1/redeems", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      return code;
    }
  }
  return null;
}
__name(createRedeem, "createRedeem");
function jsonResponse(body, { status = 200, headers = {}, setCookie } = {}) {
  const responseHeaders = new Headers({
    ...JSON_HEADERS,
    ...headers
  });
  if (setCookie) {
    responseHeaders.append("Set-Cookie", setCookie);
  }
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
__name(jsonResponse, "jsonResponse");
async function handleSpin(request, env) {
  const origin = request.headers.get("Origin") || env.ALLOWED_ORIGIN;
  const baseHeaders = corsHeaders(env.ALLOWED_ORIGIN || origin);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "INVALID_JSON" }, { status: 400, headers: baseHeaders });
  }
  const gachaId = payload?.gachaId;
  if (!gachaId) {
    return jsonResponse({ error: "MISSING_GACHA_ID" }, { status: 400, headers: baseHeaders });
  }
  const gacha = await getGacha(env, gachaId);
  if (!gacha || !gacha.is_active) {
    return jsonResponse({ error: "GACHA_NOT_FOUND" }, { status: 404, headers: baseHeaders });
  }
  const authHeader = request.headers.get("Authorization") || "";
  let userId = null;
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    userId = await supabaseAuthUser(env, token);
    if (!userId) {
      return jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers: baseHeaders });
    }
  }
  const cookies = parseCookies(request);
  let guestToken = cookies.guest_token || null;
  let setCookie = null;
  if (!guestToken) {
    guestToken = generateGuestToken();
    const allowOrigin = env.ALLOWED_ORIGIN || "";
    const isLocalhost = allowOrigin.startsWith("http://localhost");
    const secureAttr = isLocalhost ? "" : " Secure;";
    setCookie = `guest_token=${guestToken}; HttpOnly;${secureAttr} SameSite=Lax; Path=/; Max-Age=31536000`;
  }
  const guestHash = await sha256(guestToken);
  if (!userId) {
    const usedRes = await supabaseRest(env, "/rest/v1/guest_free_spins", {
      query: `?select=used_at&gacha_id=eq.${encodeURIComponent(gachaId)}&guest_token_hash=eq.${encodeURIComponent(guestHash)}&limit=1`
    });
    if (!usedRes.ok) {
      return jsonResponse({ error: "GUEST_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
    }
    const usedData = await usedRes.json();
    if (usedData.length > 0) {
      return jsonResponse({ status: "NEED_LOGIN_FREE" }, { status: 200, headers: baseHeaders, setCookie });
    }
    const markRes = await supabaseRest(env, "/rest/v1/guest_free_spins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gacha_id: gachaId,
        guest_token_hash: guestHash,
        used_at: (/* @__PURE__ */ new Date()).toISOString()
      })
    });
    if (!markRes.ok) {
      return jsonResponse({ error: "GUEST_MARK_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
    }
  }
  if (userId) {
    const bonusRes = await supabaseRest(env, "/rest/v1/user_bonus", {
      query: `?select=login_free_used&gacha_id=eq.${encodeURIComponent(gachaId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`
    });
    if (!bonusRes.ok) {
      return jsonResponse({ error: "BONUS_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
    }
    const bonusData = await bonusRes.json();
    if (bonusData.length === 0) {
      const insertRes = await supabaseRest(env, "/rest/v1/user_bonus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gacha_id: gachaId,
          user_id: userId,
          login_free_used: false
        })
      });
      if (!insertRes.ok) {
        return jsonResponse({ error: "BONUS_INSERT_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
    } else if (bonusData[0].login_free_used) {
      const creditsRes = await supabaseRest(env, "/rest/v1/credits", {
        query: `?select=balance&user_id=eq.${encodeURIComponent(userId)}&limit=1`
      });
      if (!creditsRes.ok) {
        return jsonResponse({ error: "CREDITS_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
      const creditsData = await creditsRes.json();
      const balance = creditsData[0]?.balance ?? 0;
      if (balance <= 0) {
        return jsonResponse({ status: "PAYWALL" }, { status: 200, headers: baseHeaders, setCookie });
      }
      const updateRes = await supabaseRest(env, "/rest/v1/credits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        query: `?user_id=eq.${encodeURIComponent(userId)}`,
        body: JSON.stringify({
          balance: balance - 1,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        })
      });
      if (!updateRes.ok) {
        return jsonResponse({ error: "CREDITS_UPDATE_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
    }
  }
  if (userId) {
    const checkBonusRes = await supabaseRest(env, "/rest/v1/user_bonus", {
      query: `?select=login_free_used&gacha_id=eq.${encodeURIComponent(gachaId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`
    });
    if (!checkBonusRes.ok) {
      return jsonResponse({ error: "BONUS_RECHECK_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
    }
    const checkBonus = await checkBonusRes.json();
    if (checkBonus.length > 0 && checkBonus[0].login_free_used === false) {
      const markBonusRes = await supabaseRest(env, "/rest/v1/user_bonus", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        query: `?gacha_id=eq.${encodeURIComponent(gachaId)}&user_id=eq.${encodeURIComponent(userId)}`,
        body: JSON.stringify({
          login_free_used: true,
          login_free_used_at: (/* @__PURE__ */ new Date()).toISOString()
        })
      });
      if (!markBonusRes.ok) {
        return jsonResponse({ error: "BONUS_UPDATE_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
    }
  }
  const winRate = clampRate(gacha.win_rate);
  const isWin = winRate > 0 && Math.random() < winRate;
  const result = isWin ? "WIN" : "LOSE";
  const spinRes = await supabaseRest(env, "/rest/v1/spins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gacha_id: gachaId,
      user_id: userId || null,
      guest_token_hash: userId ? null : guestHash,
      result,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    })
  });
  if (!spinRes.ok) {
    return jsonResponse({ error: "SPIN_SAVE_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
  }
  let redeem = null;
  if (result === "WIN") {
    const code = await createRedeem(env, gachaId, {
      userId: userId || null,
      guestHash: userId ? null : guestHash
    });
    if (code) {
      redeem = { code };
    }
  }
  return jsonResponse(
    { status: "SPUN", result, redeem },
    { status: 200, headers: baseHeaders, setCookie }
  );
}
__name(handleSpin, "handleSpin");
async function handleMe(request, env) {
  const origin = request.headers.get("Origin") || env.ALLOWED_ORIGIN;
  const baseHeaders = corsHeaders(env.ALLOWED_ORIGIN || origin);
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
    query: `?select=redeem_code,status,issued_at&user_id=eq.${encodeURIComponent(userId)}&order=issued_at.desc&limit=20`
  });
  if (!res.ok) {
    return jsonResponse({ error: "REDEEMS_LOOKUP_FAILED" }, { status: 500, headers: baseHeaders });
  }
  const data = await res.json();
  return jsonResponse({ items: data }, { status: 200, headers: baseHeaders });
}
__name(handleMe, "handleMe");
async function handleClaimGuest(request, env) {
  const origin = request.headers.get("Origin") || env.ALLOWED_ORIGIN;
  const baseHeaders = corsHeaders(env.ALLOWED_ORIGIN || origin);
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers: baseHeaders });
  }
  const token = authHeader.slice("Bearer ".length);
  const userId = await supabaseAuthUser(env, token);
  if (!userId) {
    return jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers: baseHeaders });
  }
  const cookies = parseCookies(request);
  const guestToken = cookies.guest_token || null;
  if (!guestToken) {
    return jsonResponse({ claimed: 0 }, { status: 200, headers: baseHeaders });
  }
  const guestHash = await sha256(guestToken);
  const res = await supabaseRest(env, "/rest/v1/redeems", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    query: `?guest_token_hash=eq.${encodeURIComponent(guestHash)}&user_id=is.null`,
    body: JSON.stringify({ user_id: userId })
  });
  if (!res.ok) {
    return jsonResponse({ error: "CLAIM_FAILED" }, { status: 500, headers: baseHeaders });
  }
  const data = await res.json();
  return jsonResponse({ claimed: Array.isArray(data) ? data.length : 0 }, { status: 200, headers: baseHeaders });
}
__name(handleClaimGuest, "handleClaimGuest");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env.ALLOWED_ORIGIN || "")
      });
    }
    if (url.pathname === "/api/spin" && request.method === "POST") {
      return handleSpin(request, env);
    }
    if (url.pathname === "/api/me" && request.method === "GET") {
      return handleMe(request, env);
    }
    if (url.pathname === "/api/claim-guest" && request.method === "POST") {
      return handleClaimGuest(request, env);
    }
    return jsonResponse({ error: "NOT_FOUND" }, { status: 404, headers: corsHeaders(env.ALLOWED_ORIGIN || "") });
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-HMy5Jo/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-HMy5Jo/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
