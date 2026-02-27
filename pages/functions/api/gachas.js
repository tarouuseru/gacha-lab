const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

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

export async function onRequest({ env }) {
  const res = await supabaseRest(env, "/rest/v1/gachas", {
    query: `?select=id,is_active,win_rate&limit=20`,
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: JSON_HEADERS });
}
