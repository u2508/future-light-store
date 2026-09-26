import test from "node:test";
import assert from "node:assert/strict";
import {
  auditVerifiedProductSeoCopy,
  resolveVerifiedProductSeoCopy,
} from "./verified-product-seo-copy.mjs";

const desired = {
  title: "Exact Reviewed Product Title",
  descriptionHtml: "<p>Exact reviewed product description.</p>",
  seoTitle: "Exact SEO title",
  seoDescription: "Exact product-led search description.",
};

function manifestItem(overrides = {}) {
  return {
    status: "verified",
    quality: { ok: true },
    desired,
    ...overrides,
  };
}

test("returns final copy byte-for-byte from the verified manifest", () => {
  const copy = resolveVerifiedProductSeoCopy(manifestItem());
  assert.deepEqual(copy, desired);
  assert.equal(copy.descriptionHtml, desired.descriptionHtml);
});

test("permits a configured override only when it exactly matches the verified manifest", () => {
  const copy = resolveVerifiedProductSeoCopy(manifestItem(), desired);
  assert.deepEqual(copy, desired);
});

test("rejects a stale or unreviewed override instead of silently replacing manifest copy", () => {
  assert.throws(
    () =>
      resolveVerifiedProductSeoCopy(manifestItem(), {
        ...desired,
        descriptionHtml: "<p>Generic replacement copy.</p>",
      }),
    /differs from the verified manifest/,
  );
});

test("holds missing fields and historical verified flags without quality evidence", () => {
  assert.throws(
    () => resolveVerifiedProductSeoCopy(manifestItem({ quality: { ok: false } })),
    /verified, quality-passing/,
  );
  assert.throws(
    () => resolveVerifiedProductSeoCopy(manifestItem({ desired: { ...desired, title: " " } })),
    /missing an exact final copy field/,
  );
});

test("semantic audit rejects generic boilerplate and cross-domain product copy", () => {
  const source = {
    handle: "silicone-lip-mask-applicator",
    title: "Reusable Silicone Lip Mask Brush Applicator",
  };
  const copy = {
    title: "Reusable Silicone Lip Mask Brush Applicator",
    seoTitle: "Reusable Silicone Lip Mask Brush Applicator",
    seoDescription: "Shop this reusable silicone lip mask brush applicator at VS Store.",
    descriptionHtml:
      "<p>Give your pet a more engaging addition to their routine with this reusable lip mask applicator.</p>",
  };
  assert.match(auditVerifiedProductSeoCopy(source, copy).join(" | "), /descriptionHtml/);
});
