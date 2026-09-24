import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ALLOWED_ENV_KEYS = new Set([
  "CONVERSATION_ID",
  "FUTURE_LIGHT_CATALOG_KNOWLEDGE_MODEL_PATH",
  "FUTURE_LIGHT_SEO_GPT_MODEL",
  "FUTURE_LIGHT_SEO_MUTATION_GROUP_SIZE",
  "FUTURE_LIGHT_SEO_NETWORK_MAX_POLL_MS",
  "FUTURE_LIGHT_SEO_NETWORK_POLL_MS",
  "FUTURE_LIGHT_SHOP_DOMAIN",
  "FUTURE_LIGHT_SHOP_URL",
  "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN",
  "FUTURE_LIGHT_SHOPIFY_API_VERSION",
  "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_IDS",
  "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_INFO",
  "FUTURE_LIGHT_SHOPIFY_MAX_REQUEST_ATTEMPTS",
  "FUTURE_LIGHT_SHOPIFY_MAX_RETRY_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_CONCURRENCY",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_DELAY_MS",
  "FUTURE_LIGHT_SHOPIFY_REQUEST_TIMEOUT_MS",
  "OPENAI_API_KEY",
  "SHOPIFY_ADMIN_API_VERSION",
  "SHOPIFY_CLI_BINARY",
]);

function parseValue(raw) {
  const value = String(raw || "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function parseFutureLightEnvText(text, existing = {}, allowedKeys = ALLOWED_ENV_KEYS) {
  const parsed = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const keyMatch = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    if (!allowedKeys.has(key) || existing[key] !== undefined) continue;
    const valueStart = line.indexOf("=", keyMatch.index) + 1;
    parsed[key] = parseValue(line.slice(valueStart));
  }
  return parsed;
}

export async function loadFutureLightEnv({
  rootDir,
  env = process.env,
  files = [".env.local", ".env.release.local"],
  allowedKeys = ALLOWED_ENV_KEYS,
} = {}) {
  if (!rootDir)
    throw new Error("Future Light environment loader requires an explicit project root");
  for (const file of files) {
    let text;
    try {
      text = await readFile(resolve(rootDir, file), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    Object.assign(env, parseFutureLightEnvText(text, env, allowedKeys));
  }
  return env;
}

export function futureLightChildEnv(source = process.env) {
  const allowed = new Set([
    "CI",
    "CONVERSATION_ID",
    "FUTURE_LIGHT_CATALOG_KNOWLEDGE_MODEL_PATH",
    "FUTURE_LIGHT_SEO_GPT_MODEL",
    "FUTURE_LIGHT_SEO_MUTATION_GROUP_SIZE",
    "FUTURE_LIGHT_SEO_NETWORK_MAX_POLL_MS",
    "FUTURE_LIGHT_SEO_NETWORK_POLL_MS",
    "FUTURE_LIGHT_SHOP_DOMAIN",
    "FUTURE_LIGHT_SHOP_URL",
    "FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN",
    "FUTURE_LIGHT_SHOPIFY_API_VERSION",
    "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_IDS",
    "FUTURE_LIGHT_SHOPIFY_CLI_AGENT_INFO",
    "FUTURE_LIGHT_SHOPIFY_MAX_REQUEST_ATTEMPTS",
    "FUTURE_LIGHT_SHOPIFY_MAX_RETRY_DELAY_MS",
    "FUTURE_LIGHT_SHOPIFY_REQUEST_CONCURRENCY",
    "FUTURE_LIGHT_SHOPIFY_REQUEST_DELAY_MS",
    "FUTURE_LIGHT_SHOPIFY_REQUEST_TIMEOUT_MS",
    "HOME",
    "PATH",
    "SHOPIFY_ADMIN_API_VERSION",
    "SHOPIFY_CLI_BINARY",
    "SHOPIFY_CLI_DISABLE_ANALYTICS",
    "TMPDIR",
    "USER",
  ]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
}
