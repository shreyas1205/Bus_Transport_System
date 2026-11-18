const STORAGE_KEY = 'campusbus_offline_queue_v1';
let flushChain = Promise.resolve();
const activeFlushes = new Map();

function readQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  window.dispatchEvent(
    new CustomEvent('campusbus:offline-queue', {
      detail: { count: queue.length }
    })
  );
}

export function getOfflineQueueCount(ownerUserId = null) {
  const queue = readQueue();
  if (!ownerUserId) return queue.length;
  return queue.filter(item => !item.ownerUserId || item.ownerUserId === ownerUserId).length;
}

export function queueOfflineRequest({
  method = 'post',
  url,
  data = null,
  kind = 'GENERAL',
  description = 'Queued action',
  dedupeKey = null,
  ownerUserId = null
}) {
  const queue = readQueue();

  if (dedupeKey) {
    const index = queue.findIndex(item => item.dedupeKey === dedupeKey);
    if (index >= 0) {
      queue[index] = {
        ...queue[index],
        method,
        url,
        data,
        kind,
        description,
        queuedAt: new Date().toISOString(),
        ownerUserId
      };
      writeQueue(queue);
      return queue[index];
    }
  }

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    method: String(method || 'post').toLowerCase(),
    url,
    data,
    kind,
    description,
    dedupeKey,
    ownerUserId,
    queuedAt: new Date().toISOString()
  };

  queue.push(item);

  // Keep the queue bounded. GPS updates use a dedupe key so the latest
  // coordinate replaces the previous queued GPS packet.
  writeQueue(queue.slice(-100));
  return item;
}

export function flushOfflineQueue(api, ownerUserId = null) {
  const ownerKey = ownerUserId || '*';
  if (activeFlushes.has(ownerKey)) return activeFlushes.get(ownerKey);
  const currentFlush = flushChain.then(() => flushQueue(api, ownerUserId));
  flushChain = currentFlush.catch(() => {});
  activeFlushes.set(ownerKey, currentFlush);
  currentFlush.finally(() => {
    if (activeFlushes.get(ownerKey) === currentFlush) activeFlushes.delete(ownerKey);
  }).catch(() => {});
  return currentFlush;
}

async function flushQueue(api, ownerUserId) {
  const queue = readQueue();
  if (!queue.length) {
    return { synced: 0, failed: 0, remaining: 0 };
  }

  const removeIfUnchanged = new Map();
  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    if (
      item.ownerUserId &&
      ownerUserId &&
      item.ownerUserId !== ownerUserId
    ) {
      continue;
    }

    try {
      await api.request({
        method: item.method,
        url: item.url,
        data: item.data
      });
      removeIfUnchanged.set(item.id, JSON.stringify(item));
      synced += 1;
    } catch (error) {
      const status = error.response?.status;
      const retryable = !Number.isInteger(status) || status === 408 || status === 429 || status >= 500 || status === 401;
      if (!retryable) removeIfUnchanged.set(item.id, JSON.stringify(item));
      failed += 1;
    }
  }

  // Keep items added or replaced while a request was in flight. Only remove a
  // completed snapshot when the stored item still has the exact sent version.
  const latestQueue = readQueue();
  const remaining = latestQueue.filter(item => removeIfUnchanged.get(item.id) !== JSON.stringify(item));
  writeQueue(remaining);

  return {
    synced,
    failed,
    remaining: remaining.length
  };
}
