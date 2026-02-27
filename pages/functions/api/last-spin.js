const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

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
    return jsonResponse({ exists: false, status: "NO_STATE" }, 200);
  }

  const cookies = parseCookies(request);
  const guest = cookies.gl_guest || "";
  if (!guest) {
    return jsonResponse({ exists: false, status: "NO_STATE" }, 200);
  }

  const res = await supabaseRest(env, "/rest/v1/gacha_results", {
    query: `?select=*&gacha_id=eq.${encodeURIComponent(gachaId)}&guest_token=eq.${encodeURIComponent(guest)}&order=created_at.desc&limit=1`,
  });

  if (!res.ok) {
    return jsonResponse({ exists: false, status: "NO_STATE" }, 200);
  }

  const rows = await res.json();
  if (!rows?.length) {
    return jsonResponse({ exists: false, status: "NO_STATE" }, 200);
  }

  return jsonResponse({ exists: true, status: "HAS_STATE", last: rows[0] }, 200);
}
