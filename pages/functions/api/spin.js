const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function randomHex(bytesLength = 32) {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

function clampRate(rate) {
  const parsed = Number(rate);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

async function supabaseRest(env, path, { method = "GET", body, headers = {}, query = "" } = {}) {
  const url = `${env.SUPABASE_URL}${path}${query}`;
  return fetch(url, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...headers,
    },
    body,
  });
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
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

async function handlePost(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "MISSING_SUPABASE_ENV" }, { status: 500 });
  }

  const url = new URL(request.url);
  let gachaId = url.searchParams.get("gacha_id") || env.DEFAULT_GACHA_ID || "";
  let rawBody = "";
  if (!gachaId) {
    rawBody = await request.text().catch(() => "");
    if (!rawBody) {
      return jsonResponse({ error: "EMPTY_BODY" }, { status: 400 });
    }
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "INVALID_JSON" }, { status: 400 });
    }
    gachaId = parsed?.gacha_id;
  }

  if (!gachaId) {
    return jsonResponse({ error: "MISSING_GACHA_ID" }, { status: 400 });
  }

  const cookies = parseCookies(request);
  let guestToken = cookies.gl_guest || null;
  let setCookie = null;
  if (!guestToken) {
    guestToken = randomHex(32);
    setCookie = `gl_guest=${guestToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
  }

  const gacha = await getGacha(env, gachaId);
  if (!gacha) {
    return jsonResponse({ status: "ERROR", code: "GACHA_NOT_FOUND" }, { status: 404, setCookie });
  }
  if (!gacha.is_active) {
    return jsonResponse({ status: "ERROR", code: "GACHA_INACTIVE" }, { status: 200, setCookie });
  }

  const existingRes = await supabaseRest(env, "/rest/v1/gacha_results", {
    query: `?select=id&gacha_id=eq.${encodeURIComponent(gachaId)}&guest_token=eq.${encodeURIComponent(
      guestToken
    )}&limit=1`,
  });
  if (!existingRes.ok) {
    return jsonResponse({ error: "RESULT_LOOKUP_FAILED" }, { status: 500, setCookie });
  }
  const existing = await existingRes.json();
  if (Array.isArray(existing) && existing.length > 0) {
    return jsonResponse({ error: "ALREADY_SPUN" }, { status: 409, setCookie });
  }

  const winRate = clampRate(gacha.win_rate == null ? 0.1 : gacha.win_rate);
  let result = winRate > 0 && Math.random() < winRate ? "WIN" : "LOSE";
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
      if (!updated) continue;
      const redeemRow = await createRedeemWin(env, gachaId, prize.id);
      if (!redeemRow) {
        redeem = null;
      } else {
        redeem = {
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

  const responseBody = {
    status: "SPUN",
    result,
    redeem: result === "WIN" ? redeem : null,
    guest_token: guestToken,
  };

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
    return jsonResponse({ error: "DB_INSERT_FAILED", detail }, { status: 500, setCookie });
  }
  const inserted = await insertRes.json();
  responseBody.result_id = inserted?.[0]?.id || null;

  return jsonResponse(responseBody, { status: 200, setCookie });
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Guest-Token",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequestPost({ request, env }) {
  return handlePost(request, env);
}

export async function onRequestGet() {
  return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
}
