import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  createInFlightCache,
  createRequestScheduler,
  envInteger,
  recommendedConcurrency,
  stableJson,
} from "./lib/performance-runtime.mjs";

const execFileAsync = promisify(execFile);

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGraphQlPayload(raw) {
  const text = String(raw || "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(text || "Shopify returned no JSON payload");
  }

  const payload = JSON.parse(text.slice(jsonStart));
  const errors = asArray(payload?.errors).length ? payload.errors : asArray(payload?.data?.errors);
  if (errors.length) {
    throw new Error(
      errors
        .map((entry) => normalizeText(entry?.message || "Unknown Shopify GraphQL error"))
        .filter(Boolean)
        .join(" | "),
    );
  }
  return payload?.data || payload || {};
}

function isRetryable(error) {
  return error?.code === "ETIMEDOUT" || error?.killed || /429|rate limit|throttl|timeout|timed out|5\d\d|network|socket|temporar|aborted|enotfound|eai_again|getaddrinfo|dns/i.test(
    String(error?.message || error),
  );
}

export function createShopifyAdminGraphQLClient({ rootDir, agentName }) {
  const shopBase = process.env.SALT_SHOP_URL;
  if (!shopBase) throw new Error("SALT_SHOP_URL is required for Future Light Store Shopify operations.");
  const storeDomain = new URL(shopBase).hostname;
  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";
  const accessToken = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SALT_SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
  const graphqlUrl = `${new URL(shopBase).origin}/admin/api/${apiVersion}/graphql.json`;
  const cliBinary = process.env.SHOPIFY_CLI_BINARY || "shopify";
  const requestDelayMs = Math.max(0, Number(process.env.SALT_SHOPIFY_REQUEST_DELAY_MS || 125));
  const requestConcurrency = envInteger(
    "SALT_SHOPIFY_REQUEST_CONCURRENCY",
    recommendedConcurrency({ kind: "io", reserve: 2, max: 8 }),
    { min: 1, max: 8 },
  );
  const requestTimeoutMs = Math.max(10_000, Number(process.env.SALT_SHOPIFY_REQUEST_TIMEOUT_MS || 180_000));
  const maxAttempts = Math.max(1, Number(process.env.SALT_SHOPIFY_MAX_REQUEST_ATTEMPTS || 5));
  const maxRetryDelayMs = Math.max(1000, Number(process.env.SALT_SHOPIFY_MAX_RETRY_DELAY_MS || 30_000));
  const cliAgentInfo = process.env.SHOPIFY_CLI_AGENT_INFO || `n:future-light-store|v:1|p:${agentName}`;
  const cliAgentIds =
    process.env.SHOPIFY_CLI_AGENT_IDS ||
    `s:${process.env.CONVERSATION_ID || "local"}|r:${process.pid}|i:${agentName}`;
  const requestScheduler = createRequestScheduler({ concurrency: requestConcurrency, minIntervalMs: requestDelayMs });
  const inFlightReads = createInFlightCache();

  async function run(query, variables = {}, { allowMutations = false, operation = "Shopify request", retryInfo = [] } = {}) {
    const cacheKey = allowMutations ? "" : `${query}\n${stableJson(variables)}`;
    return inFlightReads.getOrCreate(cacheKey, () => requestScheduler.run(async () => {
      let attempt = 0;
      while (true) {
        try {
          if (accessToken) {
            const response = await fetch(graphqlUrl, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": accessToken,
            },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
            const raw = await response.text();
            if (!response.ok) {
              throw new Error(`Admin GraphQL HTTP ${response.status}: ${raw.slice(0, 500)}`);
            }
            return parseGraphQlPayload(raw);
          }

          const tempDir = await mkdtemp(join(tmpdir(), "salt-shopify-admin-"));
          const queryPath = join(tempDir, "operation.graphql");
          const variablesPath = join(tempDir, "variables.json");
          const outputPath = join(tempDir, "result.json");
          try {
            await Promise.all([
              writeFile(queryPath, query, "utf8"),
              writeFile(variablesPath, JSON.stringify(variables, null, 2), "utf8"),
            ]);
            const args = [
            "store",
            "execute",
            "--store",
            storeDomain,
            "--version",
            apiVersion,
            "--query-file",
            queryPath,
            "--variable-file",
            variablesPath,
            "--output-file",
            outputPath,
            "--json",
            ];
            if (allowMutations) args.push("--allow-mutations");
            const result = await execFileAsync(cliBinary, args, {
            cwd: rootDir,
            env: {
              ...process.env,
              CI: "1",
              SHOPIFY_CLI_DISABLE_ANALYTICS: "1",
              SHOPIFY_CLI_AGENT_INFO: cliAgentInfo,
              SHOPIFY_CLI_AGENT_IDS: cliAgentIds,
            },
            maxBuffer: 20 * 1024 * 1024,
            timeout: requestTimeoutMs,
            killSignal: "SIGTERM",
            });
            let raw = result.stdout || "";
            try {
              raw = await readFile(outputPath, "utf8");
            } catch {
              // Older Shopify CLI builds only emit JSON on stdout.
            }
            return parseGraphQlPayload(raw);
          } finally {
            await rm(tempDir, { recursive: true, force: true });
          }
        } catch (error) {
          if (!isRetryable(error) || attempt >= maxAttempts - 1) {
            throw new Error(`${operation} failed: ${normalizeText(error?.message || error)}`);
          }
          const delayMs = Math.min(maxRetryDelayMs, Math.max(requestDelayMs, 1000 * 2 ** attempt));
          retryInfo.push({
            operation,
            attempt: attempt + 1,
            delayMs,
            message: normalizeText(error?.message || error).slice(0, 500),
            at: new Date().toISOString(),
          });
          await sleep(delayMs);
          attempt += 1;
        }
      }
    }));
  }

  return {
    run,
    storeDomain,
    apiVersion,
  };
}
