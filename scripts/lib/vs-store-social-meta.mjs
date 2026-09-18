import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import { retryDelayMs, parseRetryAfterMs, sleep } from "./performance-runtime.mjs";
import { getZonedParts, zonedDateTimeToUtc } from "./vs-store-social-content.mjs";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function metaErrorMessage(payload, status) {
  return normalizeText(
    payload?.error?.message || payload?.error?.error_user_msg || `Meta Graph API HTTP ${status}`,
  );
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(error) {
  return Boolean(
    error?.retryable ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "EAI_AGAIN" ||
    error?.code === "ENOTFOUND" ||
    /timeout|timed out|network|socket|dns|temporar|unavailable|gateway/i.test(
      String(error?.message || error),
    ),
  );
}

function parseInsightHours(payload, timeZone) {
  const scores = new Map();
  const values = asArray(payload?.data).flatMap((metric) => asArray(metric?.values));
  for (const entry of values) {
    const value = entry?.value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [hour, score] of Object.entries(value)) {
        const numericHour = Number(hour);
        const numericScore = Number(score);
        if (
          Number.isInteger(numericHour) &&
          numericHour >= 0 &&
          numericHour <= 23 &&
          Number.isFinite(numericScore)
        ) {
          scores.set(numericHour, (scores.get(numericHour) || 0) + numericScore);
        }
      }
      continue;
    }
    const numericScore = Number(value);
    const timestamp = entry?.end_time || entry?.start_time;
    if (!Number.isFinite(numericScore) || !timestamp) continue;
    const hour = getZonedParts(new Date(timestamp), timeZone).hour;
    scores.set(hour, (scores.get(hour) || 0) + numericScore);
  }
  return scores;
}

export function choosePeakHour(scores, fallbackHour = 12) {
  const entries = [...(scores instanceof Map ? scores.entries() : [])].filter(([, score]) =>
    Number.isFinite(score),
  );
  if (!entries.length) return { hour: fallbackHour, source: "fallback", scores: {} };
  entries.sort(
    ([leftHour, leftScore], [rightHour, rightScore]) =>
      rightScore - leftScore || leftHour - rightHour,
  );
  return {
    hour: entries[0][0],
    source: "meta-insights",
    scores: Object.fromEntries(
      entries.map(([hour, score]) => [String(hour), Number(score.toFixed(2))]),
    ),
  };
}

export function nextScheduledDate(now, timeZone, hour, minimumLeadMinutes = 25) {
  const local = getZonedParts(now, timeZone);
  let target = zonedDateTimeToUtc(
    { year: local.year, month: local.month, day: local.day, hour, minute: 0 },
    timeZone,
  );
  if (target.getTime() <= now.getTime() + minimumLeadMinutes * 60 * 1000) {
    const nextLocalDate = new Date(Date.UTC(local.year, local.month - 1, local.day + 1, 12, 0, 0));
    target = zonedDateTimeToUtc(
      {
        year: nextLocalDate.getUTCFullYear(),
        month: nextLocalDate.getUTCMonth() + 1,
        day: nextLocalDate.getUTCDate(),
        hour,
        minute: 0,
      },
      timeZone,
    );
  }
  return target;
}

export function nextScheduledDateForWeekday(
  now,
  timeZone,
  hour,
  targetWeekday,
  minimumLeadMinutes = 25,
) {
  const local = getZonedParts(now, timeZone);
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const currentWeekday = weekdayNames.indexOf(local.weekday);
  const normalizedTarget =
    typeof targetWeekday === "string" ? weekdayNames.indexOf(targetWeekday) : Number(targetWeekday);
  if (currentWeekday < 0 || normalizedTarget < 0 || normalizedTarget > 6) {
    return nextScheduledDate(now, timeZone, hour, minimumLeadMinutes);
  }
  let daysAhead = (normalizedTarget - currentWeekday + 7) % 7;
  let target = zonedDateTimeToUtc(
    {
      year: local.year,
      month: local.month,
      day: local.day + daysAhead,
      hour,
      minute: 0,
    },
    timeZone,
  );
  if (target.getTime() <= now.getTime() + minimumLeadMinutes * 60 * 1000) {
    daysAhead += 7;
    target = zonedDateTimeToUtc(
      {
        year: local.year,
        month: local.month,
        day: local.day + daysAhead,
        hour,
        minute: 0,
      },
      timeZone,
    );
  }
  return target;
}

export function createVsStoreMetaClient(config) {
  if (!config.metaPageId) throw new Error("FUTURE_LIGHT_META_PAGE_ID is required.");
  if (!config.metaPageAccessToken)
    throw new Error("FUTURE_LIGHT_META_PAGE_ACCESS_TOKEN is required.");
  const baseUrl = `https://graph.facebook.com/${config.metaGraphVersion}`;

  async function request(
    path,
    { method = "GET", query = {}, body = null, retryInfo = [], operation = "Meta request" } = {},
  ) {
    const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    url.searchParams.set("access_token", config.metaPageAccessToken);
    for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method,
          headers: { Accept: "application/json" },
          body,
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        });
        const raw = await response.text();
        let payload;
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          const error = new Error(`Meta returned non-JSON HTTP ${response.status}.`);
          error.retryable = response.status >= 500;
          throw error;
        }
        if (!response.ok || payload?.error) {
          const error = new Error(metaErrorMessage(payload, response.status));
          error.status = response.status;
          error.metaType = payload?.error?.type || null;
          error.metaCode = payload?.error?.code || null;
          error.retryable = isRetryableStatus(response.status);
          error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
          throw error;
        }
        return payload;
      } catch (error) {
        if (!isRetryableError(error) || attempt >= config.maxAttempts - 1) throw error;
        const delayMs = retryDelayMs({
          attempt,
          baseMs: 750,
          maxMs: 60_000,
          retryAfterMs: Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : null,
          jitterMs: 350,
        });
        retryInfo.push({ operation, attempt: attempt + 1, delayMs, at: new Date().toISOString() });
        process.stdout.write(
          `Meta social request transient failure; retrying in ${Math.ceil(delayMs / 1000)}s (${operation})\n`,
        );
        await sleep(delayMs);
      }
    }
    throw new Error(`${operation} exhausted retries.`);
  }

  async function pageReadback({ retryInfo = [] } = {}) {
    return request(`/${encodeURIComponent(config.metaPageId)}`, {
      query: { fields: "id,name,instagram_business_account{id,username}" },
      retryInfo,
      operation: "Meta VS Store Page readback",
    });
  }

  async function instagramAccountReadback({ retryInfo = [] } = {}) {
    const page = await pageReadback({ retryInfo });
    const linked = page?.instagram_business_account;
    return {
      id: normalizeText(config.metaInstagramAccountId || linked?.id),
      username: normalizeText(linked?.username || config.metaInstagramUsername),
      page,
    };
  }

  async function audiencePeak({ retryInfo = [] } = {}) {
    try {
      const payload = await request(`/${encodeURIComponent(config.metaPageId)}/insights`, {
        query: {
          metric: "page_fans_online",
          period: "day",
          date_preset: "last_28_days",
        },
        retryInfo,
        operation: "Meta audience insights",
      });
      return choosePeakHour(parseInsightHours(payload, config.timezone), config.fallbackHour);
    } catch (error) {
      if (
        error?.status === 401 ||
        error?.status === 403 ||
        error?.metaCode === 10 ||
        error?.metaCode === 100
      ) {
        process.stdout.write(
          `Meta audience insights unavailable; using ${config.fallbackHour}:00 ${config.timezone}.\n`,
        );
        return {
          hour: config.fallbackHour,
          source: "fallback-after-meta-permission",
          scores: {},
          error: normalizeText(error.message),
        };
      }
      throw error;
    }
  }

  async function schedulePhoto({ imagePath, caption, scheduledAt, retryInfo = [] }) {
    const imageBytes = await readFile(imagePath);
    const form = new FormData();
    form.set("access_token", config.metaPageAccessToken);
    form.set("caption", caption);
    const publishImmediately = scheduledAt.getTime() <= Date.now() + 2 * 60 * 1000;
    form.set("published", publishImmediately ? "true" : "false");
    if (!publishImmediately)
      form.set("scheduled_publish_time", String(Math.floor(scheduledAt.getTime() / 1000)));
    form.set("source", new Blob([imageBytes], { type: "image/jpeg" }), basename(imagePath));
    return request(`/${encodeURIComponent(config.metaPageId)}/photos`, {
      method: "POST",
      body: form,
      retryInfo,
      operation: "Meta VS Store Page photo publish",
    });
  }

  async function publishInstagramPhoto({ accountId, imageUrl, caption, retryInfo = [] }) {
    if (!accountId) throw new Error("Linked Instagram Business account ID is required.");
    if (!imageUrl) throw new Error("A public Instagram image URL is required for API publishing.");
    const container = await request(`/${encodeURIComponent(accountId)}/media`, {
      method: "POST",
      body: new URLSearchParams({ image_url: imageUrl, caption }),
      retryInfo,
      operation: "Instagram media container create",
    });
    const creationId = normalizeText(container?.id || container?.creation_id);
    if (!creationId) throw new Error("Instagram media container response did not include an ID.");
    return request(`/${encodeURIComponent(accountId)}/media_publish`, {
      method: "POST",
      body: new URLSearchParams({ creation_id: creationId }),
      retryInfo,
      operation: "Instagram media publish",
    });
  }

  async function instagramPostReadback(postId, { retryInfo = [] } = {}) {
    return request(`/${encodeURIComponent(postId)}`, {
      query: { fields: "id,caption,media_type,media_url,permalink,timestamp" },
      retryInfo,
      operation: `Instagram post readback ${postId}`,
    });
  }

  async function postReadback(postId, { retryInfo = [] } = {}) {
    return request(`/${encodeURIComponent(postId)}`, {
      query: {
        fields: "id,created_time,scheduled_publish_time,is_published,permalink_url,message",
      },
      retryInfo,
      operation: `Meta post readback ${postId}`,
    });
  }

  return {
    request,
    pageReadback,
    instagramAccountReadback,
    audiencePeak,
    schedulePhoto,
    publishInstagramPhoto,
    postReadback,
    instagramPostReadback,
  };
}
