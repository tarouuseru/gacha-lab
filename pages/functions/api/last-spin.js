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
  const debug = url.searchParams.get("debug") === "1";
  const noState = (reason) =>
    jsonResponse(
      debug ? { exists: false, status: "NO_STATE", reason } : { exists: false, status: "NO_STATE" },
      200
    );

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return noState("MISSING_SUPABASE_ENV");
  }

  const gachaId = url.searchParams.get("gacha_id") || env.DEFAULT_GACHA_ID || "";

  if (!gachaId) {
    return noState("MISSING_GACHA_ID");
  }

  const cookies = parseCookies(request);
  const guest = cookies.gl_guest || "";
  if (!guest) {
    return noState("MISSING_GUEST_COOKIE");
  }

  try {
    const res = await supabaseRest(env, "/rest/v1/gacha_results", {
      query: `?select=created_at,result,result_type,redeem,payload&gacha_id=eq.${encodeURIComponent(
        gachaId
      )}&guest_token=eq.${encodeURIComponent(guest)}&order=created_at.desc&limit=1`,
    });

    if (!res.ok) {
      if (debug) {
        const supabaseBody = await res.text().catch(() => "");
        return jsonResponse(
          {
            exists: false,
            status: "NO_STATE",
            reason: "SUPABASE_NOT_OK",
            supabase_status: res.status,
            supabase_body: supabaseBody,
          },
          200
        );
      }
      return noState("SUPABASE_NOT_OK");
    }

    const rows = await res.json();
    if (!rows?.length) {
      return noState("EMPTY_ROWS");
    }

    const row = rows[0];
    return jsonResponse(
      {
        exists: true,
        status: "HAS_STATE",
        created_at: row.created_at || null,
        result: row.result || row.result_type || null,
        redeem: row.redeem || row.payload?.redeem || null,
      },
      200
    );
  } catch {
    return noState("EXCEPTION");
  }
}
