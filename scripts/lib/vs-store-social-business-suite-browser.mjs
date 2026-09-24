import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_PLAYWRIGHT_CLI = "/Users/mac/.codex/skills/playwright/scripts/playwright_cli.sh";

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function inspectBusinessSuiteSnapshot({ url = "", title = "", snapshot = "", config }) {
  const source = `${url}\n${title}\n${snapshot}`;
  const loginRequired =
    /\/login(?:page)?\b/i.test(url) ||
    hasAny(source, [
      /log\s*in/i,
      /continue with facebook/i,
      /facebook ke saath jaari/i,
      /instagram ke saath/i,
    ]);
  if (loginRequired)
    return {
      status: "waiting_for_login",
      reason: "Business Suite requires interactive login in the dedicated browser profile.",
      pageIdentity: false,
      instagramIdentity: false,
      canCreateContent: false,
    };
  if (hasAny(source, [/checkpoint/i, /security check/i, /captcha/i, /confirm your identity/i]))
    return {
      status: "needs_review",
      reason: "Meta presented a security or consent checkpoint; no automation may bypass it.",
      pageIdentity: false,
      instagramIdentity: false,
      canCreateContent: false,
    };
  const expectedPageName = normalizeText(config.facebookPageName);
  const expectedPageId = normalizeText(config.facebookPageId);
  const expectedInstagram = normalizeText(config.instagramHandle).replace(/^@/, "");
  const pageIdentity = Boolean(
    expectedPageName &&
    source.toLowerCase().includes(expectedPageName.toLowerCase()) &&
    (!expectedPageId || source.includes(expectedPageId)),
  );
  const instagramIdentity = Boolean(
    expectedInstagram && source.toLowerCase().includes(`@${expectedInstagram}`.toLowerCase()),
  );
  const canCreateContent = hasAny(source, [
    /create post/i,
    /create content/i,
    /new post/i,
    /publish/i,
    /पोस्ट बनाएँ/i,
  ]);
  if (!pageIdentity || !instagramIdentity)
    return {
      status: "identity_mismatch",
      reason: "The expected VS Store Page and connected Instagram identity were not both visible.",
      pageIdentity,
      instagramIdentity,
      canCreateContent,
    };
  if (!canCreateContent)
    return {
      status: "needs_review",
      reason: "The logged-in Business Suite UI does not expose an identifiable content control.",
      pageIdentity,
      instagramIdentity,
      canCreateContent,
    };
  return {
    status: "ready",
    reason: "Exact VS Store Page and connected Instagram identity are visible in Business Suite.",
    pageIdentity,
    instagramIdentity,
    canCreateContent,
  };
}

export function browserPublishSteps(request) {
  return [
    { step: "verify_identity", mutation: false },
    { step: "open_composer", mutation: false },
    {
      step: "select_allowed_destinations",
      mutation: false,
      platforms: request.allowedPlatforms,
    },
    { step: "upload_local_asset", mutation: false, imagePath: request.imagePath },
    { step: "fill_canonical_caption", mutation: false, captionPath: request.captionPath },
    { step: "inspect_both_previews", mutation: false },
    { step: "persist_submit_intent", mutation: true },
    { step: "click_publish_once", mutation: true },
    { step: "verify_facebook_independently", mutation: false },
    { step: "verify_instagram_independently", mutation: false },
  ];
}

export function assertBrowserPublishingAllowed(config, request) {
  if (
    !["business-suite-browser", "meta-api-primary", "meta-api", "auto"].includes(
      config.socialPublisher,
    )
  )
    throw new Error(
      "Business Suite fallback requires VS_STORE_SOCIAL_PUBLISHER=meta-api-primary or business-suite-browser.",
    );
  if (!config.socialLiveEnabled)
    throw new Error(
      "Live browser publishing is disabled; set VS_STORE_SOCIAL_LIVE_ENABLED=1 only after rollout approval.",
    );
  if (request.publishMode !== "now" && request.publishMode !== "scheduled")
    throw new Error(`Unsupported browser publish mode: ${request.publishMode}`);
}

async function runPlaywright(config, args, { maxBuffer = 2_000_000 } = {}) {
  const cliPath = process.env.VS_STORE_PLAYWRIGHT_CLI || DEFAULT_PLAYWRIGHT_CLI;
  const cliArgs = [`-s=${config.browserSession}`, ...args];
  try {
    return await execFileAsync(cliPath, cliArgs, {
      cwd: config.rootDir,
      maxBuffer,
      env: process.env,
    });
  } catch (error) {
    const message = normalizeText(error?.stderr || error?.stdout || error?.message);
    const wrapped = new Error(`Playwright Business Suite preflight failed: ${message}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function openBusinessSuite(config, { headed = true } = {}) {
  await mkdir(config.browserProfileDir, { recursive: true, mode: 0o700 });
  const args = [
    "open",
    config.businessSuiteUrl,
    "--browser",
    "webkit",
    "--persistent",
    `--profile=${config.browserProfileDir}`,
  ];
  if (headed) args.push("--headed");
  const result = await runPlaywright(config, args);
  return result.stdout || result.stderr || "";
}

export async function readBusinessSuiteSnapshot(config) {
  const result = await runPlaywright(config, ["snapshot"]);
  const output = result.stdout || result.stderr || "";
  const pageUrl = output.match(/Page URL:\s*(\S+)/)?.[1] || "";
  const pageTitle = output.match(/Page Title:\s*(.+)/)?.[1] || "";
  return { output, pageUrl, pageTitle };
}

export async function runBusinessSuitePreflight(config) {
  await openBusinessSuite(config, { headed: true });
  const snapshot = await readBusinessSuiteSnapshot(config);
  const result = inspectBusinessSuiteSnapshot({ ...snapshot, snapshot: snapshot.output, config });
  return { ...result, ...snapshot };
}
