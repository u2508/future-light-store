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

test("Shopify drying-rack taxonomy overrides polluted apparel words and writes rack-specific copy", () => {
  const record = buildProductSeoRecord(product({
    id: "107",
    handle: "stainless-steel-windproof-clip-towel-rack-drying-rack-hook-windproof-socks-underwear-drying-rack-family-storage-laundry-rack-1",
    title: "Stainless Steel Underwear",
    productType: "",
    category: {
      name: "Drying Racks",
      fullName: "Home & Garden > Household Supplies > Laundry Supplies > Drying Racks & Hangers > Drying Racks",
    },
    body_html: "<h2>About Stainless Steel Underwear</h2><p>The Stainless Steel Underwear is an easy-to-style garment shaped around its cut, fabric, and occasion details.</p><ul><li>Material: Stainless Steel</li></ul>",
    variants: { nodes: [
      { title: "Square 40 clips" },
      { title: "Square 30 clips" },
      { title: "Square 20 clips" },
      { title: "Round 20 clips" },
      { title: "Arc type 6 clips" },
    ] },
  }));

  assert.equal(record.classification.familyId, "laundry-drying-rack");
  assert.equal(record.classification.source, "shopify-taxonomy+listing-evidence");
  assert.equal(record.title, "Stainless Steel Hanging Clip Drying Rack");
  assert.match(record.descriptionHtml, /Keep socks, underwear, towels, and other small laundry together while it dries/i);
  assert.match(record.descriptionHtml, /Square rack with 40 clips/);
  assert.match(record.descriptionHtml, /Round rack with 20 clips/);
  assert.match(record.descriptionHtml, /Arc-style rack with 6 clips/);
  assert.match(record.descriptionHtml, /rack configurations, not color variations/);
  assert.doesNotMatch(record.descriptionHtml, /In practice, it brings together/i);
  assert.ok(record.seoDescription.length <= 158);
  assert.doesNotMatch(record.seoDescription, /\.\.\.$/);
  assert.match(record.seoDescription, /socks, underwear, or towels/i);
  assert.doesNotMatch(`${record.title}\n${record.seoDescription}\n${record.descriptionHtml}`, /easy-to-style garment|size chart|way you plan to wear|stainless steel underwear/i);
  assert.deepEqual(auditProductSeoRecords([record]).issues, []);
});

test("holds listing text that conflicts with a non-apparel Shopify category", () => {
  const record = buildProductSeoRecord(product({
    id: "109",
    handle: "winter-heated-vest-jacket-gloves-battery-set",
    title: "Winter Heated Vest Jacket Gloves Battery Set",
    productType: "",
    category: { name: "Electronics", fullName: "Electronics > Power > Batteries" },
    body_html: "<p>Battery-powered heating clothing set.</p>",
  }));

  assert.equal(record.classification.reviewRequired, true);
  assert.equal(record.classification.source, "shopify-taxonomy-listing-conflict");
  assert.ok(auditProductSeoRecords([record]).issues.includes("winter-heated-vest-jacket-gloves-battery-set:shopify-category-listing-conflict"));
});

test("does not turn a pet carrier top window into an apparel top", () => {
  const record = buildProductSeoRecord(product({
    id: "110",
    handle: "pet-travel-carrier-box-with-top-window-for-cats",
    title: "Pet Travel Carrier Box with Top Window for Cats",
    category: { name: "Pet Carriers", fullName: "Animals & Pet Supplies > Pet Supplies > Pet Carriers" },
    body_html: "<p>Travel carrier with a top viewing window.</p>",
  }));

  assert.notEqual(record.classification.familyId, "apparel-top");
  assert.doesNotMatch(record.title, /\btop\b/i);
});

test("does not turn a newborn photography backdrop into a baby garment", () => {
  const record = buildProductSeoRecord(product({
    id: "111",
    handle: "newborn-photography-backdrop-studio-background-cloth",
    title: "Newborn Photography Backdrop Studio Background Cloth",
    category: { name: "Photography Backgrounds", fullName: "Arts & Entertainment > Hobbies & Creative Arts > Photography > Photography Backgrounds" },
    body_html: "<p>Studio photography background cloth.</p>",
  }));

  assert.notEqual(record.classification.familyId, "baby-romper");
  assert.doesNotMatch(record.title, /\b(?:romper|bodysuit)\b/i);
});

test("treats Shopify Decor as a broad category rather than relabeling a cleaning tool", () => {
  const record = buildProductSeoRecord(product({
    id: "112",
    handle: "glass-window-cleaning-tool-double-sided-squeegee",
    title: "Glass Window Cleaning Tool Double Sided Squeegee",
    category: { name: "Decor", fullName: "Home & Garden > Decor" },
    body_html: "<p>Double-sided window squeegee for cleaning glass.</p>",
  }));

  assert.equal(record.classification.familyId, "cleaning-tool");
  assert.equal(record.classification.reviewRequired, undefined);
  assert.deepEqual(auditProductSeoRecords([record]).issues, []);
});

test("recognizes plural watches and keeps watch-band listings out of organizer copy", () => {
  const watch = buildProductSeoRecord(product({
    id: "113",
    handle: "synoke-military-digital-watches-men-sports-luminous-chronograph-waterproof",
    title: "Synoke Military Digital Watches Men Sports Luminous Chronograph",
    category: { name: "Watches", fullName: "Apparel & Accessories > Jewelry > Watches" },
    body_html: "",
  }));
  const strap = buildProductSeoRecord(product({
    id: "114",
    handle: "genuine-leather-strap-with-box-watch-band-butterfly-clasp-bracelet",
    title: "Genuine Leather Strap with Box Watch Band Butterfly Clasp Bracelet",
    category: { name: "Watch Bands", fullName: "Apparel & Accessories > Jewelry > Watch Accessories > Watch Bands" },
    body_html: "",
  }));

  assert.equal(watch.classification.familyId, "watch");
  assert.equal(watch.classification.reviewRequired, undefined);
  assert.equal(strap.classification.familyId, "watch-strap");
  assert.equal(strap.classification.reviewRequired, undefined);
  assert.match(strap.title, /Watch Strap/i);
  assert.doesNotMatch(strap.title, /Organizer Case/i);
});

test("uses a USB-flash-drive title for USB storage instead of calling it an SD card", () => {
  const record = buildProductSeoRecord(product({
    id: "115",
    handle: "sandisk-cz50-usb-2-0-flash-drive-128gb-64gb-32gb-u-disk-16gb-pen-drive",
    title: "Sandisk CZ50 USB 2.0 Flash Drive 128GB 64GB 32GB U Disk 16GB Pen Drive",
    category: { name: "USB Flash Drives", fullName: "Electronics > Electronics Accessories > Computer Components > Storage Devices > USB Flash Drives" },
    body_html: "",
  }));

  assert.equal(record.classification.familyId, "memory-card");
  assert.match(record.title, /USB Flash Drive/i);
  assert.doesNotMatch(record.title, /SD Memory Card/i);
  assert.equal(record.classification.reviewRequired, undefined);
});

test("recognizes a clip towel drying rack from product-noun evidence without taxonomy", () => {
  const record = buildProductSeoRecord(product({
    id: "108",
    handle: "stainless-steel-windproof-clip-towel-rack-drying-rack-socks-underwear",
    title: "Stainless Steel Underwear",
    productType: "",
    body_html: "<li>Material: Stainless Steel</li>",
  }));
  assert.equal(record.classification.familyId, "laundry-drying-rack");
  assert.equal(record.title, "Stainless Steel Hanging Clip Drying Rack");
  assert.doesNotMatch(record.descriptionHtml, /garment|size chart/i);
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
