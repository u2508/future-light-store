const COLLECTION_MARKETING_METAFIELD_DEFINITIONS = [
  {
    id: "salt-marketing.hero_kicker",
    kind: "custom",
    name: "Collection hero kicker",
    namespace: "salt-marketing",
    key: "hero_kicker",
    type: "single_line_text_field",
    ownerType: "COLLECTION",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Short promotional line shown above collection titles in the storefront.",
  },
  {
    id: "salt-marketing.hero_summary",
    kind: "custom",
    name: "Collection hero summary",
    namespace: "salt-marketing",
    key: "hero_summary",
    type: "multi_line_text_field",
    ownerType: "COLLECTION",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Merchandising summary that explains why a collection is worth shopping.",
  },
  {
    id: "salt-marketing.featured_products",
    kind: "custom",
    name: "Featured products",
    namespace: "salt-marketing",
    key: "featured_products",
    type: "list.product_reference",
    ownerType: "COLLECTION",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Hand-picked products featured at the top of the collection experience.",
  },
  {
    id: "salt-marketing.trust_strip",
    kind: "custom",
    name: "Collection trust strip",
    namespace: "salt-marketing",
    key: "trust_strip",
    type: "list.single_line_text_field",
    ownerType: "COLLECTION",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Short trust statements shown alongside the collection header.",
  },
];

const SHOP_MARKETING_METAFIELD_DEFINITIONS = [
  {
    id: "salt-marketing.banner_text",
    kind: "custom",
    name: "Shop banner text",
    namespace: "salt-marketing",
    key: "banner_text",
    type: "single_line_text_field",
    ownerType: "SHOP",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Global sales message surfaced across the storefront shell.",
  },
  {
    id: "salt-marketing.trust_strip",
    kind: "custom",
    name: "Shop trust strip",
    namespace: "salt-marketing",
    key: "trust_strip",
    type: "list.single_line_text_field",
    ownerType: "SHOP",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Global trust statements used in the storefront header and footer.",
  },
];

function getMarketingMetafieldDefinitionId(definition) {
  return `${definition.namespace}.${definition.key}`;
}

export {
  COLLECTION_MARKETING_METAFIELD_DEFINITIONS,
  SHOP_MARKETING_METAFIELD_DEFINITIONS,
  getMarketingMetafieldDefinitionId,
};
