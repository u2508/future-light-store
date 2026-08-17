#!/usr/bin/env node

import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2] || process.env.FINANCE_APP_PASSWORD || "";
if (!password) {
  throw new Error("Pass the finance password as the first argument or FINANCE_APP_PASSWORD.");
}

const N = 16_384;
const r = 8;
const p = 1;
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 }).toString("hex");

process.stdout.write(`scrypt$${N}$${r}$${p}$${salt}$${hash}\n`);
