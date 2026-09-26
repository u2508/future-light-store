import test from "node:test";
import assert from "node:assert/strict";
import { auditProductSeoDuplicateGroups } from "./product-seo-artifact-audit.mjs";

test("flags a new product colliding with one existing copy record", () => {
  const result = auditProductSeoDuplicateGroups([
    { handle: "legacy-item", title: "Compact Desk Stand", seoDescription: "A useful stand.", descriptionHtml: "<p>A useful stand.</p>" },
    { handle: "new-item", title: "Compact Desk Stand", seoDescription: "A useful stand.", descriptionHtml: "<p>A useful stand.</p>" },
  ], { introducedHandles: new Set(["new-item"]) });

  assert.deepEqual(result, {
    duplicateTitles: 1,
    duplicateDescriptions: 1,
    duplicateDescriptionHtml: 1,
  });
});

test("does not fail unrelated duplicate legacy records when a cohort is scoped", () => {
  const result = auditProductSeoDuplicateGroups([
    { handle: "legacy-one", title: "Legacy Item", seoDescription: "Same old text", descriptionHtml: "<p>Same old text</p>" },
    { handle: "legacy-two", title: "Legacy Item", seoDescription: "Same old text", descriptionHtml: "<p>Same old text</p>" },
    { handle: "new-item", title: "Distinct Product", seoDescription: "Distinct detail.", descriptionHtml: "<p>Distinct detail.</p>" },
  ], { introducedHandles: new Set(["new-item"]) });

  assert.deepEqual(result, {
    duplicateTitles: 0,
    duplicateDescriptions: 0,
    duplicateDescriptionHtml: 0,
  });
});

test("normalizes case, HTML, punctuation, and common entities before comparing copy", () => {
  const result = auditProductSeoDuplicateGroups([
    { handle: "legacy", title: "A&B Desk Stand", seoDescription: "A&mdash;B stand!", descriptionHtml: "<p>A&nbsp;B stand!</p>" },
    { handle: "new", title: "A and B Desk Stand", seoDescription: "A B stand", descriptionHtml: "<div>A B stand</div>" },
  ], { introducedHandles: ["new"] });

  assert.deepEqual(result, {
    duplicateTitles: 0,
    duplicateDescriptions: 1,
    duplicateDescriptionHtml: 1,
  });
});

test("counts all duplicate groups when no cohort is supplied", () => {
  const result = auditProductSeoDuplicateGroups([
    { handle: "one", title: "Same title" },
    { handle: "two", title: "Same title" },
  ]);
  assert.equal(result.duplicateTitles, 1);
});
