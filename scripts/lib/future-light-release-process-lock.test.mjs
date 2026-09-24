import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  acquireFutureLightReleaseLock,
  futureLightReleaseLockPort,
} from "./future-light-release-process-lock.mjs";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("derives a stable local port from an explicit checkout identity", () => {
  const first = futureLightReleaseLockPort("/workspace/future-light-store");
  assert.equal(first, futureLightReleaseLockPort("/workspace/future-light-store"));
  assert.notEqual(first, futureLightReleaseLockPort("/workspace/another-store"));
  assert.ok(first >= 49_152 && first <= 65_535);
  assert.throws(() => futureLightReleaseLockPort(""), /project root is required/);
});

test("holds a process-lifetime singleton and exposes read-only status on loopback", async () => {
  const port = await freePort();
  const lock = await acquireFutureLightReleaseLock({
    projectRoot: "/workspace/future-light-store",
    port,
    pid: 12345,
    now: () => "2026-09-24T12:00:00.000Z",
  });

  try {
    assert.equal(lock.address.address, "127.0.0.1");
    assert.equal(lock.active, true);
    assert.equal(lock.pid, 12345);
    const response = await fetch(`http://127.0.0.1:${port}${lock.route}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      active: true,
      projectKey: lock.projectKey,
      pid: 12345,
      startedAt: "2026-09-24T12:00:00.000Z",
    });
    const controlPath = await fetch(`http://127.0.0.1:${port}/stop`, { method: "POST" });
    assert.equal(controlPath.status, 404);
    await assert.rejects(
      acquireFutureLightReleaseLock({ projectRoot: "/workspace/future-light-store", port }),
      (error) => error.code === "EADDRINUSE" && /refusing to overlap/.test(error.message),
    );
  } finally {
    await lock.close();
    await lock.close();
  }
});

test("the kernel releases the lock after clean close so a safe resume can reacquire it", async () => {
  const port = await freePort();
  const first = await acquireFutureLightReleaseLock({ projectRoot: "/workspace/future-light-store", port });
  await first.close();

  const resumed = await acquireFutureLightReleaseLock({ projectRoot: "/workspace/future-light-store", port });
  assert.equal(resumed.projectKey, first.projectKey);
  await resumed.close();
});

test("rejects invalid ports and does not bind beyond loopback", async () => {
  await assert.rejects(
    acquireFutureLightReleaseLock({ projectRoot: "/workspace/future-light-store", port: 65_536 }),
    /port must be an integer/,
  );
  await assert.rejects(
    acquireFutureLightReleaseLock({ projectRoot: "/workspace/future-light-store", port: -1 }),
    /port must be an integer/,
  );
});
