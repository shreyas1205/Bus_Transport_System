const STORAGE_KEY = 'campusbus_offline_queue_v1';

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

export async function flushOfflineQueue(api, ownerUserId = null) {
  const queue = readQueue();
  if (!queue.length) {
    return { synced: 0, failed: 0, remaining: 0 };
  }

  const remaining = [];
  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    if (
      item.ownerUserId &&
      ownerUserId &&
      item.ownerUserId !== ownerUserId
    ) {
      remaining.push(item);
      continue;
    }

    try {
      await api.request({
        method: item.method,
        url: item.url,
        data: item.data
      });
      synced += 1;
    } catch (error) {
      // No response normally means the network is still unavailable.
      // Keep those requests for the next sync attempt. A 4xx/5xx response is
      // considered a completed attempt so a permanently-invalid action does
      // not retry forever.
      if (!error.response) {
        remaining.push(item);
      } else {
        failed += 1;
      }
    }
  }

  writeQueue(remaining);

  return {
    synced,
    failed,
    remaining: remaining.length
  };
}
