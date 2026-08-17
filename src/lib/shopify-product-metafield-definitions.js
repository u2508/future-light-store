const PRODUCT_METAFIELD_DEFINITIONS = [
  {
    id: "reviews.rating",
    kind: "standard",
    name: "Product rating",
    namespace: "reviews",
    key: "rating",
    type: "rating",
    ownerType: "PRODUCT",
    standardTemplateId: 6,
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
  },
  {
    id: "reviews.rating_count",
    kind: "standard",
    name: "Product rating count",
    namespace: "reviews",
    key: "rating_count",
    type: "number_integer",
    ownerType: "PRODUCT",
    standardTemplateId: 7,
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
  },
  {
    id: "descriptors.subtitle",
    kind: "standard",
    name: "Product subtitle",
    namespace: "descriptors",
    key: "subtitle",
    type: "single_line_text_field",
    ownerType: "PRODUCT",
    standardTemplateId: 1,
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
  },
  {
    id: "shopify--discovery--product_recommendation.related_products",
    kind: "standard",
    name: "Related products",
    namespace: "shopify--discovery--product_recommendation",
    key: "related_products",
    type: "list.product_reference",
    ownerType: "PRODUCT",
    standardTemplateId: 14,
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
  },
  {
    id: "shopify--discovery--product_recommendation.related_products_display",
    kind: "standard",
    name: "Related products setting",
    namespace: "shopify--discovery--product_recommendation",
    key: "related_products_display",
    type: "single_line_text_field",
    ownerType: "PRODUCT",
    standardTemplateId: 15,
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
  },
  {
    id: "shopify--discovery--product_search_boost.queries",
    kind: "standard",
    name: "Search product boosts",
    namespace: "shopify--discovery--product_search_boost",
    key: "queries",
    type: "list.single_line_text_field",
    ownerType: "PRODUCT",
    standardTemplateId: 16,
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
  },
  {
    id: "shopify--discovery--product_recommendation.complementary_products",
    kind: "standard",
    name: "Complementary products",
    namespace: "shopify--discovery--product_recommendation",
    key: "complementary_products",
    type: "list.product_reference",
    ownerType: "PRODUCT",
    standardTemplateId: 17,
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
  },
  {
    id: "salt-search.query_terms",
    kind: "custom",
    name: "SALT Search Query Terms",
    namespace: "salt-search",
    key: "query_terms",
    type: "list.single_line_text_field",
    ownerType: "PRODUCT",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Catalog-owned search phrases used when Shopify's standard search boost field is subtype-constrained.",
  },
  {
    id: "salt-recommendations.complementary_products",
    kind: "custom",
    name: "SALT Complementary Products",
    namespace: "salt-recommendations",
    key: "complementary_products",
    type: "list.product_reference",
    ownerType: "PRODUCT",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Catalog-owned complementary product references used when Shopify's standard recommendation field is subtype-constrained.",
  },
  {
    id: "shopify.diaper-type",
    kind: "custom",
    name: "Diaper type",
    namespace: "shopify",
    key: "diaper-type",
    type: "list.metaobject_reference",
    ownerType: "PRODUCT",
    access: {
      admin: "PUBLIC_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Distinguishes between incontinence aids, such as pads, pull-ups, or diapers.",
    validations: [
      {
        name: "metaobject_definition_id",
        value: "gid://shopify/MetaobjectDefinition/9632874595",
      },
    ],
  },
  {
    id: "salt-marketing.badge_text",
    kind: "custom",
    name: "Product badge text",
    namespace: "salt-marketing",
    key: "badge_text",
    type: "single_line_text_field",
    ownerType: "PRODUCT",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Short promotional badge displayed on product cards and product pages.",
  },
  {
    id: "salt-marketing.highlights",
    kind: "custom",
    name: "Product highlights",
    namespace: "salt-marketing",
    key: "highlights",
    type: "list.single_line_text_field",
    ownerType: "PRODUCT",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Short benefit bullets that help customers scan the offer faster.",
  },
  {
    id: "salt-marketing.collection_signal",
    kind: "custom",
    name: "Collection signal",
    namespace: "salt-marketing",
    key: "collection_signal",
    type: "single_line_text_field",
    ownerType: "PRODUCT",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Search and merchandising signal used for smart collection logic and filters.",
    capabilities: {
      adminFilterable: {
        enabled: true,
      },
      smartCollectionCondition: {
        enabled: true,
      },
    },
  },
  {
    id: "mm-google-shopping.custom_product",
    kind: "custom",
    name: "MM Google Shopping: Custom Product",
    namespace: "mm-google-shopping",
    key: "custom_product",
    type: "boolean",
    ownerType: "PRODUCT",
    access: {
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Marks products that should be treated as custom products in Google Merchant Center.",
  },
  {
    id: "salt-marketing.shop_channel_minimum_quantity",
    kind: "custom",
    name: "Shop channel minimum quantity",
    namespace: "salt-marketing",
    key: "shop_channel_minimum_quantity",
    type: "number_integer",
    ownerType: "PRODUCT",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Editable quantity floor used to keep Shop channel merchandising and cart behavior aligned.",
  },
  {
    id: "salt_taxonomy.classification",
    kind: "custom",
    name: "Catalog classification",
    namespace: "salt_taxonomy",
    key: "classification",
    type: "json",
    ownerType: "PRODUCT",
    access: {
      admin: "MERCHANT_READ_WRITE",
      storefront: "PUBLIC_READ",
    },
    pin: true,
    description: "Versioned high-confidence catalog taxonomy used for search, filters, and collection mapping.",
  },
];

function getProductMetafieldDefinitionId(definition) {
  return `${definition.namespace}.${definition.key}`;
}

function getStandardMetafieldTemplateGid(templateId) {
  return `gid://shopify/StandardMetafieldDefinitionTemplate/${templateId}`;
}

function isStandardProductMetafieldDefinition(definition) {
  return definition.kind === "standard";
}

function isCustomProductMetafieldDefinition(definition) {
  return definition.kind === "custom";
}

export {
  PRODUCT_METAFIELD_DEFINITIONS,
  getProductMetafieldDefinitionId,
  getStandardMetafieldTemplateGid,
  isCustomProductMetafieldDefinition,
  isStandardProductMetafieldDefinition,
};
