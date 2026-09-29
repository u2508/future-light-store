import test from "node:test";
import assert from "node:assert/strict";

import { assessProductContentSpecificity } from "../src/lib/product-content-specificity.js";

const product = {
  handle: "foldable-camping-inflatable-mattress",
  title: "Foldable Camping Inflatable Mattress",
  productType: "Camping Mattress",
  tags: ["outdoor", "sleeping gear"],
};

test("rejects generic copy used by previous SEO templates", () => {
  const assessment = assessProductContentSpecificity(
    "This product serves the specific function identified by its handle. Confirmed product facts and available options help shoppers compare it.",
    product,
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, false);
  assert.ok(assessment.issues.includes("generic-filler-pattern"));
});

test("rejects raw supplier labels and boilerplate care instructions", () => {
  const assessment = assessProductContentSpecificity(
    "Brand Name: Generic Supplier. Catalog tag: camping. Source Specifications. Use it only for the stated task and keep it in a clean, dry place when not in use.",
    product,
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, false);
  assert.ok(assessment.issues.includes("generic-filler-pattern"));
  assert.ok(assessment.genericPatterns.length >= 4);
});

test("decodes HTML entities before detecting boilerplate", () => {
  const assessment = assessProductContentSpecificity(
    "Foldable camping inflatable mattress. Use it only for the stated task &amp; follow all supplied setup, handling, and care instructions.",
    product,
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, false);
  assert.ok(assessment.issues.includes("generic-filler-pattern"));
});

test("accepts product-led, evidence-grounded language without template filler", () => {
  const assessment = assessProductContentSpecificity(
    "A foldable inflatable camping mattress gives you a compact sleeping surface for a tent or guest setup. Check the listed dimensions and packed size against your available space before ordering.",
    product,
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, true);
  assert.deepEqual(assessment.issues, []);
  assert.deepEqual(assessment.genericPatterns, []);
});

test("rejects pet-care copy on a beauty product even when product keywords overlap", () => {
  const assessment = assessProductContentSpecificity(
    "Give your pet a more engaging addition to their routine with this silicone lip mask brush. Choose the appropriate size and supervise use, especially during chewing or active play.",
    {
      handle: "6-new-lip-mask-brush-beauty-tools-portable-silicone-lip-brush",
      title: "6 New Lip Mask Brush Beauty Tools Portable Silicone Lip Brush",
      productType: "makeup brush",
      category: { fullName: "Pet Grooming Supplies" },
    },
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, false);
  assert.ok(assessment.issues.includes("cross-domain-product-copy"));
});

test("does not flag accurate pet-grooming copy as a beauty mismatch", () => {
  const assessment = assessProductContentSpecificity(
    "This dog grooming brush is designed to lift loose coat during routine brushing. Check the brush dimensions and use gently around sensitive areas.",
    {
      handle: "dog-grooming-brush-loose-coat",
      title: "Dog Grooming Brush for Loose Coat",
      productType: "pet grooming brush",
    },
    { field: "description", rejectGenericPatterns: true },
  );

  assert.equal(assessment.specific, true);
  assert.ok(!assessment.issues.includes("cross-domain-product-copy"));
});

test("rejects the generic SEO template fragments found in the saved catalog export", () => {
  const phrases = [
    "Give your pet a more engaging addition to their routine",
    "Shape, texture, and finish shown are the details to compare",
    "Play or outfit option you choose",
    "Build a more considered beauty routine with this",
    "Texture, shade, size, and application format shown",
    "Choose the shade, size, and format shown for your needs",
    "A practical addition to a beauty routine in the format shown",
    "Choose the shade or format that suits your routine",
  ];

  for (const phrase of phrases) {
    const assessment = assessProductContentSpecificity(
      phrase + ".",
      product,
      { field: "description", rejectGenericPatterns: true },
    );
    assert.ok(
      assessment.issues.includes("generic-filler-pattern"),
      "expected generic SEO filler to be rejected: " + phrase,
    );
  }
});

test("rejects templated wearable, wallet, and electronics copy shown in recent PDP audits", () => {
  const cases = [
    {
      product: {
        handle: "genuine-leather-strap-watch-band-butterfly-clasp-bracelet",
        title: "Genuine Leather Strap with Box Watch Band Butterfly Clasp Bracelet",
      },
      copy: "This watch band is a wearable watch listing with the finish, features, or fit options shown below. In practice, it brings together options listed on the product page.",
    },
    {
      product: {
        handle: "mens-wallet-made-of-pu-wax-oil-skin-purse",
        title: "Made PU Wax Oil Skin Wallet",
      },
      copy: "The Made PU Wax Oil Skin Wallet is a wallet with its features and intended use clear before checkout. In practice, it brings together zipper supported features.",
    },
    {
      product: {
        handle: "blood-pressure-smart-watch-ecg-precise",
        title: "Blood Pressure Smart Watch ECG Precise",
      },
      copy: "This smart watch combines a wrist display with connectivity and fitness tools listed for the model. Check phone compatibility, charging method, and supported functions before ordering.",
    },
  ];

  for (const { product: source, copy } of cases) {
    const assessment = assessProductContentSpecificity(copy, source, {
      field: "description",
      rejectGenericPatterns: true,
    });
    assert.equal(assessment.specific, false, source.handle);
    assert.ok(assessment.issues.includes("generic-filler-pattern"), source.handle);
  }
});
