import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCategoryMetafieldPlan,
  matchTaxonomyAttributeValues,
  parseMetafieldReferenceIds,
} from "../src/lib/shopify-category-metafield-backfill.js";

const category = { id: "gid://shopify/TaxonomyCategory/test", name: "Test", fullName: "Test" };

function definition(key, name = key) {
  return {
    namespace: "shopify",
    key,
    name,
    type: "list.metaobject_reference",
    metaobjectDefinitionId: `gid://shopify/MetaobjectDefinition/${key}`,
    constraints: { key: "category" },
    ...(key === "color-pattern" ? { standardTemplate: { id: "gid://shopify/StandardMetafieldDefinitionTemplate/10001" } } : {}),
  };
}

function attribute(id, name, values) {
  return {
    id: `gid://shopify/TaxonomyAttribute/${id}`,
    name,
    values: { nodes: values.map(([valueId, valueName]) => ({ id: `gid://shopify/TaxonomyValue/${valueId}`, name: valueName })) },
  };
}

test("matches exact taxonomy tokens and never treats articulated as Art", () => {
  const product = {
    id: 1,
    title: "3-Section Double Articulated Camera Mounting Arm",
    handle: "3-section-double-articulated-arm",
    body_html: "This arm uses a 5/8 hex pin and threaded fittings.",
  };
  const pattern = attribute(3, "Pattern", [["24479", "Art"], ["2874", "Solid"]]);
  assert.deepEqual(matchTaxonomyAttributeValues(product, pattern), []);
});

test("ignores source tags and clears stale audience metadata without product evidence", () => {
  const product = {
    id: 2,
    title: "Camera Mounting Arm",
    handle: "camera-mounting-arm",
    tags: ["women"],
    customData: {
      metafields: {
        "shopify.target-gender": { value: '["gid://shopify/Metaobject/old"]' },
      },
    },
  };
  const gender = attribute(837, "Target gender", [[18, "Female"], [19, "Male"], [20, "Unisex"]]);
  const plan = buildCategoryMetafieldPlan({ product, category, definitions: [definition("target-gender")], attributes: [gender] });
  assert.deepEqual(matchTaxonomyAttributeValues(product, gender), []);
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].action, "clear-invalid");
  assert.deepEqual(plan.writes[0].currentReferenceIds, ["gid://shopify/Metaobject/old"]);
});

test("uses variant color options but does not turn Golden into jewelry material", () => {
  const product = {
    id: 3,
    title: "Pearl Beauty Head Brooch",
    handle: "pearl-beauty-head-brooch",
    body_html: "A brooch accessory for casual wear.",
    variants: [{ title: "Golden1718" }, { title: "Silvery1718" }],
  };
  const color = attribute(1, "Color", [[4, "Gold"], [5, "Silver"], [13, "Red"]]);
  const material = attribute(2781, "Jewelry material", [[17181, "Gold"], [17192, "Silver"], [34402, "Pearls"]]);
  const pattern = attribute(3, "Pattern", [[24479, "Art"], [2874, "Solid"]]);
  const plan = buildCategoryMetafieldPlan({
    product,
    category,
    definitions: [definition("color-pattern", "Color"), definition("jewelry-material", "Jewelry material")],
    attributes: [color, material, pattern],
  });
  const colors = plan.writes.filter((write) => write.attributeName === "Color").map((write) => write.taxonomyValueName);
  assert.deepEqual(colors, ["Gold", "Silver"]);
  assert.equal(plan.writes.some((write) => write.attributeName === "Jewelry material"), false);
  assert.equal(plan.writes.some((write) => write.taxonomyValueName === "Art"), false);
});

test("accepts explicit audience, jewelry type, and labeled jewelry materials", () => {
  const product = {
    id: 4,
    title: "Women's Imitation Jewelry Pearl Brooch",
    handle: "womens-imitation-jewelry-pearl-brooch",
    body_html: "Material: Metal and Pearls. Designed for women.",
  };
  const gender = attribute(837, "Target gender", [[18, "Female"], [20, "Unisex"]]);
  const jewelryType = attribute(60, "Jewelry type", [[547, "Imitation jewelry"], [546, "Fine jewelry"]]);
  const material = attribute(2781, "Jewelry material", [[17185, "Metal"], [34402, "Pearls"], [17181, "Gold"]]);
  const plan = buildCategoryMetafieldPlan({
    product,
    category,
    definitions: [definition("target-gender"), definition("jewelry-type"), definition("jewelry-material")],
    attributes: [gender, jewelryType, material],
  });
  assert.deepEqual(plan.writes.filter((write) => write.attributeName === "Target gender").map((write) => write.taxonomyValueName), ["Female"]);
  assert.deepEqual(plan.writes.filter((write) => write.attributeName === "Jewelry type").map((write) => write.taxonomyValueName), ["Imitation jewelry"]);
  assert.deepEqual(plan.writes.filter((write) => write.attributeName === "Jewelry material").map((write) => write.taxonomyValueName), ["Metal", "Pearls"]);
});

test("does not classify connector gender as shopper gender", () => {
  const product = {
    id: 5,
    title: "3.5mm AUX Audio Cable with Male Terminals",
    handle: "aux-audio-cable-male-to-male-female-terminal",
    body_html: "Connector layout: Male-to-male. The female terminal is for the amplifier.",
  };
  const gender = attribute(837, "Target gender", [[18, "Female"], [19, "Male"], [20, "Unisex"]]);
  assert.deepEqual(matchTaxonomyAttributeValues(product, gender), []);
});

test("does not map generic Size values into the accessory-size taxonomy", () => {
  const product = {
    id: 7,
    title: "Men's Graphic T-Shirt",
    handle: "mens-graphic-tshirt",
    variants: [{ title: "40" }],
  };
  const genericSize = attribute(2778, "Size", [[2897, "40"]]);
  const accessorySize = {
    ...definition("accessory-size", "Accessory size"),
    standardTemplate: { id: "gid://shopify/StandardMetafieldDefinitionTemplate/10050" },
  };
  const plan = buildCategoryMetafieldPlan({
    product,
    category,
    definitions: [accessorySize],
    attributes: [genericSize],
  });
  assert.equal(plan.writes.length, 0);
  assert.equal(plan.skipped[0].reason, "no category metafield definition");
});

test("uses only validated supplier specification attributes as supplemental evidence", () => {
  const product = {
    id: 6,
    title: "Soft Makeup Puff",
    handle: "soft-makeup-puff",
    customData: {
      metafields: {
        "salt-product.specifications": {
          jsonValue: {
            source: "supplier_description_and_catalog_fields",
            source_attributes: { material: "cotton" },
          },
        },
      },
    },
  };
  const material = attribute(4, "Material", [[1, "Cotton"], [2, "Plastic"]]);
  assert.deepEqual(matchTaxonomyAttributeValues(product, material).map((match) => match.name), ["Cotton"]);

  const untrusted = {
    ...product,
    customData: {
      metafields: {
        "salt-product.specifications": {
          jsonValue: { source: "generated-seo", source_attributes: { material: "plastic" } },
        },
      },
    },
  };
  assert.deepEqual(matchTaxonomyAttributeValues(untrusted, material), []);
});

test("falls back to JSON metafield references when bulk readback has no nested reference nodes", () => {
  assert.deepEqual(
    parseMetafieldReferenceIds({
      value: '["gid://shopify/Metaobject/1767827701841"]',
      jsonValue: ["gid://shopify/Metaobject/1767827701841"],
      references: [],
    }),
    ["gid://shopify/Metaobject/1767827701841"],
  );
});
