import { getHistory, updateHistory, deleteHistory } from "../_history.js";

export async function onRequestGet({ params }) {
  const item = getHistory(params.id);
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

export async function onRequestPut({ params, request }) {
  const patch = await request.json();
  const updated = updateHistory(params.id, patch);
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

export async function onRequestDelete({ params }) {
  const ok = deleteHistory(params.id);
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
