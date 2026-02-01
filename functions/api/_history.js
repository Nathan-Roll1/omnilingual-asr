const STORE_KEY = "__omniscribe_history_store";

function getStore() {
  if (!globalThis[STORE_KEY]) {
    globalThis[STORE_KEY] = {
      items: new Map(),
      order: [],
    };
  }
  return globalThis[STORE_KEY];
}

function listHistory() {
  const store = getStore();
  return store.order
    .map((id) => store.items.get(id))
    .filter(Boolean);
}

function getHistory(id) {
  const store = getStore();
  return store.items.get(id) || null;
}

function putHistory(item) {
  const store = getStore();
  if (!store.items.has(item.id)) {
    store.order.unshift(item.id);
  }
  store.items.set(item.id, item);
  return item;
}

function updateHistory(id, patch) {
  const store = getStore();
  const existing = store.items.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  store.items.set(id, updated);
  return updated;
}

function deleteHistory(id) {
  const store = getStore();
  const existed = store.items.delete(id);
  if (existed) {
    store.order = store.order.filter((x) => x !== id);
  }
  return existed;
}

export {
  listHistory,
  getHistory,
  putHistory,
  updateHistory,
  deleteHistory,
};
