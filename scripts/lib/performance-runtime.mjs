import os from "node:os";

export function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.min(max, Math.max(min, fallback));
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function availableParallelism({ reserve = 1, max = 16 } = {}) {
  const detected =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return boundedInteger(detected - reserve, 1, { min: 1, max });
}

export function envInteger(name, fallback, options = {}) {
  return boundedInteger(process.env[name], fallback, options);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export function retryDelayMs({
  attempt,
  baseMs = 250,
  maxMs = 30_000,
  retryAfterMs = null,
  jitterMs = 250,
}) {
  if (retryAfterMs !== null && Number.isFinite(retryAfterMs)) {
    return Math.min(maxMs, Math.max(0, retryAfterMs));
  }
  const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  return Math.min(maxMs, Math.max(baseMs, baseMs * 2 ** attempt + jitter));
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createInFlightCache() {
  const entries = new Map();
  return {
    getOrCreate(key, task) {
      if (!key) return task();
      const existing = entries.get(key);
      if (existing) return existing;
      const promise = Promise.resolve()
        .then(task)
        .finally(() => entries.delete(key));
      entries.set(key, promise);
      return promise;
    },
    clear() {
      entries.clear();
    },
  };
}

export function createRequestScheduler({ concurrency = 4, minIntervalMs = 0 } = {}) {
  const maxConcurrency = boundedInteger(concurrency, 4, { min: 1, max: 32 });
  const intervalMs = Math.max(0, Number(minIntervalMs) || 0);
  const queue = [];
  let active = 0;
  let nextStartAt = 0;
  let pumping = false;

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length && active < maxConcurrency) {
        const waitFor = Math.max(0, nextStartAt - Date.now());
        if (waitFor) await sleep(waitFor);
        const job = queue.shift();
        if (!job) continue;
        active += 1;
        nextStartAt = Date.now() + intervalMs;
        Promise.resolve()
          .then(job.task)
          .then(job.resolve, job.reject)
          .finally(() => {
            active -= 1;
            void pump();
          });
      }
    } finally {
      pumping = false;
      if (queue.length && active < maxConcurrency) void pump();
    }
  };

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        void pump();
      });
    },
    stats() {
      return {
        active,
        queued: queue.length,
        concurrency: maxConcurrency,
        minIntervalMs: intervalMs,
      };
    },
  };
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) return;
      results[index] = await mapper(list[index], index);
    }
  };
  const workerCount = Math.min(boundedInteger(concurrency, 1, { min: 1, max: 32 }), list.length);
  if (!workerCount) return results;
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
