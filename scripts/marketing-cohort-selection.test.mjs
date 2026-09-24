import test from "node:test";
import assert from "node:assert/strict";

import {
  candidateDedupeKeys,
  dedupeRankedCandidates,
  normalizeCandidateHandle,
  normalizeCandidateTitle,
} from "./lib/marketing-cohort-selection.mjs";

test("normalizes only duplicate suffixes from a candidate handle", () => {
  assert.equal(normalizeCandidateHandle("crown-accessory-1"), "crown-accessory");
  assert.equal(normalizeCandidateHandle("iphone-14-case"), "iphone-14-case");
});

test("normalizes listing suffixes from a candidate title", () => {
  assert.equal(normalizeCandidateTitle("Crown Accessories — Listing 2"), "crown accessories");
});

test("dedupes an otherwise identical handle with a numeric import suffix", () => {
  const candidates = [
    { handle: "crown-accessory-1", title: "Crown Accessories — Listing 2" },
    { handle: "crown-accessory", title: "Crown Accessories" },
    { handle: "mouse-rgb", title: "Rechargeable RGB Mouse" },
  ];

  assert.deepEqual(
    dedupeRankedCandidates(candidates).map((candidate) => candidate.handle),
    ["crown-accessory-1", "mouse-rgb"],
  );
});

test("keeps meaningful model handles distinct", () => {
  const keys = candidateDedupeKeys({ handle: "iphone-14-case", title: "iPhone 14 Case" });
  assert.ok(keys.includes("handle:iphone-14-case"));
});
