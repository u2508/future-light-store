#!/usr/bin/env node

import { resolve } from "node:path";
import { verifyBuiltWebEntrypoint } from "./lib/web-deep-link-assets.mjs";

const count = await verifyBuiltWebEntrypoint(resolve(process.cwd(), "dist"));
process.stdout.write(`Web deep-link asset check passed (${count} local entry assets).\n`);
