import { listHistory, putHistory, getSessionKey } from "./_history.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionKey = getSessionKey(request);
  if (!sessionKey) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const items = await listHistory(env.DB, sessionKey);
  return new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: "Database not configured." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const sessionKey = getSessionKey(request);
  if (!sessionKey) {
    return new Response(
      JSON.stringify({ error: "Missing session key." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const data = await request.json();
  if (!data || !data.id) {
    return new Response(
      JSON.stringify({ error: "Missing history id." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const item = await putHistory(env.DB, data, sessionKey);
  return new Response(JSON.stringify(item), {
    headers: { "Content-Type": "application/json" },
  });
}
