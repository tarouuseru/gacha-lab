export async function onRequest({ request }) {
  const url = new URL(request.url);
  return new Response(JSON.stringify({
    url: url.toString(),
    pathname: url.pathname,
    search: url.search,
  }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
