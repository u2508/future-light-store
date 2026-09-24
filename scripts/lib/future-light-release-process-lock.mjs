import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";

const LOOPBACK_HOST = "127.0.0.1";
const LOCK_ROUTE = "/_codex_future_light_release_lock";
const EPHEMERAL_PORT_START = 49_152;
const EPHEMERAL_PORT_SPAN = 16_384;

function checkoutKey(projectRoot) {
  return createHash("sha256").update(resolve(projectRoot)).digest("hex");
}

export function futureLightReleaseLockPort(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    throw new TypeError("A Future Light project root is required for the release lock");
  }
  const digest = Buffer.from(checkoutKey(projectRoot), "hex");
  const offset = digest.readUInt32BE(0) % EPHEMERAL_PORT_SPAN;
  return EPHEMERAL_PORT_START + offset;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    Connection: "close",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

/**
 * Acquire a process-lifetime, loopback-only singleton lock for the Future Light
 * release. The listening socket is the lock: the OS releases it after a crash,
 * avoiding unsafe stale-PID deletion and lock-file races. This server exposes
 * read-only owner status only; it cannot start, stop, or control a release.
 */
export async function acquireFutureLightReleaseLock({
  projectRoot,
  port = futureLightReleaseLockPort(projectRoot),
  now = () => new Date().toISOString(),
  pid = process.pid,
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    throw new TypeError("A Future Light project root is required for the release lock");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("Release lock port must be an integer from 0 through 65535");
  }
  if (!Number.isInteger(pid) || pid <= 0) throw new TypeError("Release lock PID must be a positive integer");

  const owner = Object.freeze({
    active: true,
    projectKey: checkoutKey(projectRoot),
    pid,
    startedAt: now(),
  });
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== LOCK_ROUTE) {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    writeJson(response, 200, owner);
  });

  await new Promise((resolveListen, rejectListen) => {
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    const onError = (error) => {
      server.off("listening", onListening);
      const detail = error?.code === "EADDRINUSE"
        ? `A release process or loopback port conflict is present on port ${port}; refusing to overlap.`
        : `Unable to acquire the Future Light release lock: ${error?.message || String(error)}`;
      rejectListen(Object.assign(new Error(detail), { code: error?.code || "RELEASE_LOCK_ERROR" }));
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen({ host: LOOPBACK_HOST, port, exclusive: true });
  });

  let closed = false;
  return Object.freeze({
    ...owner,
    address: server.address(),
    route: LOCK_ROUTE,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    },
  });
}
