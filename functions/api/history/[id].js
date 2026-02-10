import { getHistory, updateHistory, deleteHistory, getSessionKey } from "../_history.js";

export async function onRequestGet({ params, request, env }) {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Database not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionKey = getSessionKey(request);
  if (!sessionKey) {
    return new Response(JSON.stringify({ error: "Missing session key." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const item = await getHistory(env.DB, params.id, sessionKey);
  if (!item) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(item), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPut({ params, request, env }) {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Database not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionKey = getSessionKey(request);
  if (!sessionKey) {
    return new Response(JSON.stringify({ error: "Missing session key." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const patch = await request.json();
  const updated = await updateHistory(env.DB, params.id, patch, sessionKey);
  if (!updated) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(updated), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestDelete({ params, request, env }) {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Database not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionKey = getSessionKey(request);
  if (!sessionKey) {
    return new Response(JSON.stringify({ error: "Missing session key." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ok = await deleteHistory(env.DB, env.AUDIO_BUCKET || null, params.id, sessionKey);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
