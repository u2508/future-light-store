import test from "node:test";
import assert from "node:assert/strict";

import {
  auditProductSeoRecords,
  buildProductSeoRecord,
  ensureDistinctProductSeo,
} from "./lib/future-light-product-seo.mjs";

function product(overrides = {}) {
  return {
    id: "100",
    handle: "3-section-double-articulated-arm-5-8-hex-pin-with-1-4-20-female",
    title: "3 Section Double Articulated Arm 5 8 Hex Pin With 1 4 20 Female",
    body_html: "<h3>Key Details</h3><ul><li>Product type: Camera Mount</li><li>Arm format: Double articulated</li><li>Mounting fittings: 5/8 hex pin; 1/4-20 female</li></ul>",
    vendor: "VS Store",
    ...overrides,
  };
}

test("keeps technical connector genders out of audience language", () => {
  const record = buildProductSeoRecord(product());
  assert.equal(record.classification.familyId, "camera-mount");
  assert.match(record.title, /Camera Mounting Arm/);
  assert.doesNotMatch(`${record.title}\n${record.seoDescription}`, /\b(?:women|men|girl|boy)\b/i);
  assert.deepEqual(auditProductSeoRecords([record]).issues, []);
});

test("does not label an AUX cable as a human-gender product", () => {
  const record = buildProductSeoRecord(product({
    id: "101",
    handle: "funnyjack-3-5mm-aux-audio-cable-to-xh2-54-3p-terminal-male-to-male",
    title: "Funnyjack 3 5mm Aux Audio Cable To Xh2 54 3p Terminal Male To Male",
    body_html: "<h3>Key Details</h3><ul><li>Product type: Audio Extension Cord</li><li>Connector size: 3.5mm</li><li>Connector layout: Male-to-male</li></ul>",
  }));
  assert.equal(record.classification.familyId, "audio-cable");
  assert.match(record.title, /AUX Audio Cable/);
  assert.doesNotMatch(`${record.title}\n${record.seoDescription}`, /\b(?:women|men|girl|boy)\b/i);
  assert.deepEqual(auditProductSeoRecords([record]).issues, []);
});

test("keeps HDMI-to-VGA adapters separate from AUX cables", () => {
  const record = buildProductSeoRecord(product({
    id: "106",
    handle: "hdmi-compatible-to-vga-adapter-1080p-male-to-famale-converter-with-3-5mm-audio-jack-and-usb-power-supply-for-pc-laptop-projector",
    title: "1080p AUX Audio Cable - HDMI",
    body_html: "<h3>Key Details</h3><ul><li>Device compatibility: PC</li><li>Connector size: 3.5mm</li></ul>",
  }));
  assert.equal(record.classification.familyId, "video-adapter");
  assert.match(record.title, /HDMI-to-VGA Adapter/i);
  assert.match(record.descriptionHtml, /VGA display/i);
  assert.doesNotMatch(`${record.title}\n${record.seoDescription}`, /AUX Audio Cable/i);
  assert.deepEqual(auditProductSeoRecords([record]).issues, []);
});

test("keeps pet copy specific and grammatical when the source title is unrelated", () => {
  const record = buildProductSeoRecord(product({
    id: "104",
    handle: "funny-simulated-animal-no-stuffing-dog-toy-with-squeakers-durable-stuffingless-plush-squeaky-dog-chew-toy-crinkle-pet-squeak-toy",
    title: "Casual Graphic T Shirt",
    body_html: "<h3>Key Details</h3><ul><li>Features: squeaky, plush, interactive</li></ul>",
  }));
  assert.equal(record.classification.familyId, "pet-toy");
  assert.match(record.title, /Plush Chew Toy For Dogs/i);
  assert.match(record.seoDescription, /chew-and-play toy for dogs/i);
  assert.doesNotMatch(`${record.title}\n${record.seoDescription}\n${record.descriptionHtml}`, /Casual Graphic T Shirt/i);
  assert.doesNotMatch(`${record.seoDescription}\n${record.descriptionHtml}`, /\ba interactive\b|product details|specific function|Choose the size, color/i);
  assert.deepEqual(auditProductSeoRecords([record]).issues, []);
});

test("does not fall back to generic SEO filler", () => {
  const record = buildProductSeoRecord(product({
    id: "105",
    handle: "compact-usb-cooling-desk-fan-three-speed-portable-fan",
    title: "Compact USB Cooling Desk Fan",
    body_html: "<p>Three speed portable fan for a desk or bedside table.</p>",
  }));
  assert.doesNotMatch(`${record.seoDescription}\n${record.descriptionHtml}`, /specific function|confirmed product facts|job you want it to do|Choose the size, color|product information|product details/i);
});

test("makes duplicate catalog records deterministic and unique", () => {
  const records = [
    buildProductSeoRecord(product({ id: "102" })),
    buildProductSeoRecord(product({ id: "103" })),
  ];
  ensureDistinctProductSeo(records);
  const audit = auditProductSeoRecords(records);
  assert.equal(audit.duplicateTitles, 0);
  assert.equal(audit.duplicateDescriptions, 0);
  assert.equal(audit.issues.length, 0);
  assert.notEqual(records[0].title, records[1].title);
});
