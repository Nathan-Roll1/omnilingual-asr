import { listHistory, putHistory } from "./_history.js";

export async function onRequestGet({ env, data }) {
  if (!env.DB) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const items = await listHistory(env.DB, data.userId);
  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost({ request, env, data }) {
  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: "Database not configured." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await request.json();
  if (!body || !body.id) {
    return new Response(
      JSON.stringify({ error: "Missing history id." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const item = await putHistory(env.DB, body, data.userId);
  return new Response(JSON.stringify(item), {
    headers: { "Content-Type": "application/json" },
  });
}
