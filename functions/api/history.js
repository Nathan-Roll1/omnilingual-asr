import { listHistory, putHistory } from "./_history.js";

export async function onRequestGet() {
  const items = listHistory();
  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost({ request }) {
  const data = await request.json();
  if (!data || !data.id) {
    return new Response(
      JSON.stringify({ error: "Missing history id." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const item = putHistory(data);
  return new Response(JSON.stringify(item), {
    headers: { "Content-Type": "application/json" },
  });
}
