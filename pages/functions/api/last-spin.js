const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function parseCookies(request) {
  const cookie = request.headers.get("Cookie") || "";
  const entries = cookie.split(";").map((part) => part.trim()).filter(Boolean);
  const out = {};
  for (const entry of entries) {
    const index = entry.indexOf("=");
    if (index === -1) continue;
    out[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return out;
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

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const gachaId = url.searchParams.get("gacha_id") || env.DEFAULT_GACHA_ID || "";

  if (!gachaId) {
    return new Response(JSON.stringify({ status: "NO_STATE" }), { status: 200, headers: JSON_HEADERS });
  }

  const cookies = parseCookies(request);
  const guest = cookies.gl_guest || "";
  if (!guest) {
    return new Response(JSON.stringify({ status: "NO_STATE" }), { status: 200, headers: JSON_HEADERS });
  }

  // 直近のスピン結果を返す（テーブル名は spin.js に合わせてください：ここでは spin_results を仮定）
  // もしテーブル名が違って 400/404 になる場合は、次ステップで spin.js の参照箇所に合わせて修正します。
  const res = await supabaseRest(env, "/rest/v1/gacha_results", {
    query: `?select=*&gacha_id=eq.${encodeURIComponent(gachaId)}&guest_token=eq.${encodeURIComponent(guest)}&order=created_at.desc&limit=1`,
  });

  if (!res.ok) {
    const text = await res.text();
    return new Response(text, { status: res.status, headers: JSON_HEADERS });
  }

  const rows = await res.json();
  if (!rows?.length) {
    return new Response(JSON.stringify({ status: "NO_STATE" }), { status: 200, headers: JSON_HEADERS });
  }

  return new Response(JSON.stringify({ status: "HAS_STATE", last: rows[0] }), { status: 200, headers: JSON_HEADERS });
}
