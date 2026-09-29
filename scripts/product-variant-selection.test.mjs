import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVariantOptionGroups,
  displayOptionGroupName,
  displayOptionValue,
  hasImageBearingOption,
  chooseProductVariantId,
  resolveVariantOptionSelection,
} from "../src/lib/product-variant-selection.mjs";

const variants = [
  {
    id: "black-small",
    title: "Black / Small",
    availableForSale: true,
    selectedOptions: [
      { name: "Color", value: "Black" },
      { name: "Size", value: "Small" },
    ],
  },
  {
    id: "black-large",
    title: "Black / Large",
    availableForSale: true,
    selectedOptions: [
      { name: "Color", value: "Black" },
      { name: "Size", value: "Large" },
    ],
  },
  {
    id: "blue-small",
    title: "Blue / Small",
    availableForSale: false,
    selectedOptions: [
      { name: "Color", value: "Blue" },
      { name: "Size", value: "Small" },
    ],
  },
  {
    id: "blue-large",
    title: "Blue / Large",
    availableForSale: true,
    selectedOptions: [
      { name: "Color", value: "Blue" },
      { name: "Size", value: "Large" },
    ],
  },
];

test("an unavailable server default falls through to the first available variant", () => {
  const soldOutDefault = { ...variants[2], availableForSale: false };
  assert.equal(
    chooseProductVariantId({
      variants: [soldOutDefault, variants[0], variants[1]],
      currentId: soldOutDefault.id,
    }),
    variants[0].id,
  );
});

test("an explicit shopper selection is preserved even if availability refreshes", () => {
  const soldOutSelection = { ...variants[2], availableForSale: false };
  assert.equal(
    chooseProductVariantId({
      variants: [variants[0], soldOutSelection],
      currentId: soldOutSelection.id,
      userSelected: true,
    }),
    soldOutSelection.id,
  );
});

test("variant controls are grouped by option axis rather than duplicated combinations", () => {
  const groups = buildVariantOptionGroups({
    options: [
      { name: "Color", values: ["Black", "Blue"] },
      { name: "Size", values: ["Small", "Large"] },
    ],
    variants,
    selectedVariantId: "black-small",
  });

  assert.deepEqual(
    groups.map((group) => [group.name, group.values.length]),
    [
      ["Color", 2],
      ["Size", 2],
    ],
  );
  assert.equal(groups.flatMap((group) => group.values).length, 4);
});

test("changing an option keeps the closest available value on the other axis", () => {
  const next = resolveVariantOptionSelection({
    variants,
    currentVariantId: "black-small",
    optionName: "Color",
    optionValue: "Blue",
  });

  assert.equal(next.id, "blue-large");
});

test("option-value controls expose the resolved variant and disable values that are wholly sold out", () => {
  const groups = buildVariantOptionGroups({
    options: [
      { name: "Color", values: ["Black", "Blue"] },
      { name: "Size", values: ["Small", "Large"] },
    ],
    variants,
    selectedVariantId: "black-small",
  });

  const blue = groups[0].values.find((value) => value.value === "Blue");
  assert.equal(blue.available, true);
  assert.equal(blue.variantId, "blue-large");
  assert.equal(groups[1].values.find((value) => value.value === "Small").available, true);

  const allBlueUnavailable = variants.map((variant) =>
    variant.id === "blue-large" ? { ...variant, availableForSale: false } : variant,
  );
  const soldOutGroups = buildVariantOptionGroups({
    options: [{ name: "Color", values: ["Black", "Blue"] }],
    variants: allBlueUnavailable,
    selectedVariantId: "black-small",
  });
  assert.equal(soldOutGroups[0].values.find((value) => value.value === "Blue").available, false);
});

test("opaque mousepad color codes are honestly presented as design codes, not colors", () => {
  assert.equal(
    displayOptionGroupName("Color", ["TK-0000007129", "TK-0000007128"], "Gaming mouse pad"),
    "Design",
  );
  assert.equal(
    displayOptionValue("TK-0000007129", "Color", "Gaming mouse pad"),
    "Design code 7129",
  );
  assert.equal(displayOptionGroupName("Color", ["Black", "Blue"], "Wallet"), "Color");
});

test("the smartwatch's mixed band finishes are labeled as band styles", () => {
  assert.equal(
    displayOptionGroupName(
      "Color",
      ["Black Steel 2", "Brown Leather", "Blue"],
      "Square-Screen Smartwatch with Band Styles",
    ),
    "Band style",
  );
});

test("only appearance-bearing option axes require exact variant image evidence", () => {
  assert.equal(hasImageBearingOption([{ name: "Color", values: ["Black", "Blue"] }]), true);
  assert.equal(hasImageBearingOption([{ name: "Band style", values: ["Black Steel", "Blue"] }]), true);
  assert.equal(hasImageBearingOption([{ name: "Band Color", values: ["Black Silver"] }]), true);
  assert.equal(
    hasImageBearingOption([
      { name: "Strap color, stitching & clasp", values: ["Black strap · Gold clasp"] },
    ]),
    true,
  );
  assert.equal(hasImageBearingOption([{ name: "Size", values: ["Small", "Large"] }]), false);
  assert.equal(hasImageBearingOption([{ name: "Ships From", values: ["US", "China"] }]), false);
});

test("splits leather watch-band combinations into organized strap, stitching, clasp, and width choices", () => {
  const title = "Leather Strap With Box Watch Band Butterfly Clasp Bracelet";
  const sourceVariants = [
    {
      id: "black-silver-22",
      availableForSale: true,
      selectedOptions: [
        { name: "Band Color", value: "Black Silver" },
        { name: "Band Width", value: "22mm" },
      ],
    },
    {
      id: "black-white-gold-20",
      availableForSale: true,
      selectedOptions: [
        { name: "Band Color", value: "Black White Gold" },
        { name: "Band Width", value: "20mm" },
      ],
    },
    {
      id: "light-brown-rose-gold-18",
      availableForSale: true,
      selectedOptions: [
        { name: "Band Color", value: "LightBrown Rose Gold" },
        { name: "Band Width", value: "18mm" },
      ],
    },
    {
      id: "brown-white-black-21",
      availableForSale: true,
      selectedOptions: [
        { name: "Band Color", value: "BrownWhite Black" },
        { name: "Band Width", value: "21mm" },
      ],
    },
  ];
  const groups = buildVariantOptionGroups({
    options: [
      {
        name: "Band Color",
        values: ["Black Silver", "Black White Gold", "LightBrown Rose Gold", "BrownWhite Black"],
      },
      { name: "Band Width", values: ["22mm", "20mm", "18mm", "21mm"] },
    ],
    variants: sourceVariants,
    selectedVariantId: "black-silver-22",
    productTitle: title,
  });

  assert.deepEqual(
    groups.map((group) => [group.name, group.values.map((value) => value.value)]),
    [
      ["Strap color", ["Black", "Brown", "Light brown"]],
      ["Stitching", ["Black", "White"]],
      ["Clasp finish", ["Silver", "Gold", "Rose gold", "Black"]],
      ["Band Width", ["18mm", "20mm", "21mm", "22mm"]],
    ],
  );
  assert.equal(groups[0].values[1].variantId, "brown-white-black-21");
  assert.equal(groups[1].values[1].variantId, "black-white-gold-20");
  assert.equal(groups[2].values[1].variantId, "black-white-gold-20");
  assert.equal(groups[3].values[0].variantId, "light-brown-rose-gold-18");
  assert.equal(
    sourceVariants[0].selectedOptions.some((option) => option.name === "Strap color"),
    false,
  );
});
