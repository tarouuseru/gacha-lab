export async function onRequest() {
  return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
