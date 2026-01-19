const JSON_HEADERS = { "Content-Type": "application/json" };
const FIXED_ORIGIN = "https://gacha-lab-pages.pages.dev";
const DEPLOY_ID = "2026-01-04T21:15JST";

function resolveAllowedOrigin(requestOrigin, allowlist) {
  const allowed = (allowlist || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!requestOrigin) return allowed[0] || "";
  if (allowed.includes(requestOrigin)) return requestOrigin;
  return allowed[0] || "";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Guest-Token",
    "Vary": "Origin",
  };
}

function cors(res) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", FIXED_ORIGIN);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Guest-Token");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
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
  if (headerToken) return headerToken;
  const cookies = parseCookies(request);
  return cookies.guest_token || null;
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
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return randomString(32, alphabet);
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

async function handleSpin(request, env) {
  const allowOrigin = FIXED_ORIGIN;
  const baseHeaders = {
    ...corsHeaders(allowOrigin),
    "X-Worker-Deploy": DEPLOY_ID,
  };

  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

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
      return jsonResponse(
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
      return jsonResponse(
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
    return jsonResponse(
      { error: "MISSING_GACHA_ID", debug: { contentType, bodyLen } },
      { status: 400, headers: baseHeaders }
    );
  }

  console.log("spin received", { gacha_id: gachaId, source: gachaSource });
  const gacha = await getGacha(env, gachaId);
  console.log("gacha lookup", { found: !!gacha, gacha_id: gachaId });
  if (!gacha) {
    return jsonResponse(
      { status: "ERROR", code: "GACHA_NOT_FOUND" },
      { status: 404, headers: baseHeaders }
    );
  }
  if (!gacha.is_active) {
    return jsonResponse(
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
      return jsonResponse({ error: "UNAUTHORIZED" }, { status: 401, headers: baseHeaders });
    }
  }

  let guestToken = getGuestTokenFromRequest(request);
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
      query: `?select=used_at&gacha_id=eq.${encodeURIComponent(gachaId)}&guest_token_hash=eq.${encodeURIComponent(guestHash)}&limit=1`,
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
        used_at: new Date().toISOString(),
      }),
    });
    if (!markRes.ok) {
      return jsonResponse({ error: "GUEST_MARK_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
    }
  }

  if (userId) {
    const bonusRes = await supabaseRest(env, "/rest/v1/user_bonus", {
      query: `?select=login_free_used&gacha_id=eq.${encodeURIComponent(gachaId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
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
          login_free_used: false,
        }),
      });
      if (!insertRes.ok) {
        return jsonResponse({ error: "BONUS_INSERT_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
    } else if (bonusData[0].login_free_used) {
      const creditsRes = await supabaseRest(env, "/rest/v1/credits", {
        query: `?select=balance&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
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
          updated_at: new Date().toISOString(),
        }),
      });
      if (!updateRes.ok) {
        return jsonResponse({ error: "CREDITS_UPDATE_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
      }
    }
  }

  if (userId) {
    const checkBonusRes = await supabaseRest(env, "/rest/v1/user_bonus", {
      query: `?select=login_free_used&gacha_id=eq.${encodeURIComponent(gachaId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
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
          login_free_used_at: new Date().toISOString(),
        }),
      });
      if (!markBonusRes.ok) {
        return jsonResponse({ error: "BONUS_UPDATE_FAILED" }, { status: 500, headers: baseHeaders, setCookie });
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
    status: "SPUN",
    result,
    redeem: result === "WIN" ? redeem : null,
    debug: { contentType, bodyLen },
    guest_token: guestToken,
  };
  return jsonResponse(responseBody, { status: 200, headers: baseHeaders, setCookie });
}

async function handleMe(request, env) {
  const allowOrigin = FIXED_ORIGIN;
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
  const allowOrigin = FIXED_ORIGIN;
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
  const allowOrigin = FIXED_ORIGIN;
  const baseHeaders = corsHeaders(allowOrigin);

  const envError = ensureSupabaseEnv(env, baseHeaders);
  if (envError) return envError;

  const authHeader = request.headers.get("Authorization") || "";
  let userId = null;
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    userId = await supabaseAuthUser(env, token);
  }

  let query = "";
  if (userId) {
    query = `?select=gacha_id,result,redeem_code,created_at&user_id=eq.${encodeURIComponent(
      userId
    )}&order=created_at.desc&limit=1`;
  } else {
    const guestToken = getGuestTokenFromRequest(request);
    if (!guestToken) {
      return jsonResponse({ exists: false }, { status: 200, headers: baseHeaders });
    }
    const guestHash = await sha256(guestToken);
    query = `?select=gacha_id,result,redeem_code,created_at&guest_token_hash=eq.${encodeURIComponent(
      guestHash
    )}&order=created_at.desc&limit=1`;
  }

  try {
    const res = await supabaseRest(env, "/rest/v1/spins", { query });
    if (!res.ok) {
      console.error("last-spin lookup failed", await res.text());
      return jsonResponse({ exists: false }, { status: 200, headers: baseHeaders });
    }
    const data = await res.json();
    const row = data?.[0];
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
  const allowOrigin = FIXED_ORIGIN;
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
    const allowOrigin = FIXED_ORIGIN;

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/admin/")) {
      const baseHeaders = corsHeaders(allowOrigin);
      const envError = ensureSupabaseEnv(env, baseHeaders);
      if (envError) return envError;
      const authError = authorizeAdmin(request, env, baseHeaders);
      if (authError) return authError;

      const segments = url.pathname.split("/").filter(Boolean);
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
  },
};
