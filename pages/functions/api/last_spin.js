export async function onRequest(ctx) {
  // alias: /api/last_spin -> /api/last-spin と同じ挙動
  const url = new URL(ctx.request.url);
  url.pathname = "/api/last-spin";
  return fetch(url.toString(), ctx.request);
}
