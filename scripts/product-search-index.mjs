import { classifyProductKnowledge, compactProductKnowledge } from "../src/lib/product-knowledge-base.js";

function plainText(input, maxLength = 360) {
  return String(input || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function asPrice(input) {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function buildSearchImage(input) {
  if (!input?.src) {
    return null;
  }

  return {
    id: Number(input.id) || 0,
    src: String(input.src),
    alt: input.alt == null ? null : plainText(input.alt, 160),
  };
}

function buildSearchVariant(variants) {
  const cheapest = (Array.isArray(variants) ? variants : [])
    .filter((variant) => variant && variant.price != null)
    .sort((left, right) => asPrice(left.price) - asPrice(right.price))[0];

  if (!cheapest) {
    return [];
  }

  return [
    {
      id: Number(cheapest.id) || 0,
      title: plainText(cheapest.title || "Default Title", 120),
      price: String(cheapest.price),
      compare_at_price: cheapest.compare_at_price == null ? null : String(cheapest.compare_at_price),
      available: Boolean(cheapest.available),
    },
  ];
}

function buildSearchProduct(product, knowledgeModel = null, modelEvidenceByKey = null, precomputedKnowledgeByKey = null) {
  const firstImage = buildSearchImage(product?.image || product?.images?.[0]);
  const productKey = String(product?.id || product?.handle || "");
  const modelEvidence = modelEvidenceByKey?.get(productKey);
  const precomputedKnowledge = precomputedKnowledgeByKey?.get(productKey);
  const knowledge = precomputedKnowledge || classifyProductKnowledge(product, { knowledgeModel, modelEvidence });
  const searchBoosts = Array.isArray(product?.customData?.searchProductBoosts)
    ? product.customData.searchProductBoosts.map((entry) => plainText(entry, 120)).filter(Boolean).slice(0, 20)
    : [];

  return {
    id: Number(product?.id) || 0,
    title: plainText(product?.title, 240),
    handle: String(product?.handle || "").trim(),
    body_html: plainText(product?.body_html),
    vendor: plainText(product?.vendor, 160),
    product_type: plainText(product?.product_type, 160),
    tags: Array.isArray(product?.tags)
      ? product.tags.map((entry) => plainText(entry, 120)).filter(Boolean).slice(0, 60)
      : plainText(product?.tags, 1000),
    created_at: String(product?.created_at || ""),
    published_at: String(product?.published_at || ""),
    updated_at: String(product?.updated_at || ""),
    variants: buildSearchVariant(product?.variants),
    images: firstImage ? [firstImage] : [],
    image: firstImage,
    knowledge: precomputedKnowledge || compactProductKnowledge(knowledge),
    customData: searchBoosts.length ? { searchProductBoosts: searchBoosts } : null,
  };
}

export function buildProductSearchPayload(
  productsPayload,
  { knowledgeModel = null, modelEvidenceByKey = null, precomputedKnowledgeByKey = null } = {},
) {
  const products = Array.isArray(productsPayload?.products) ? productsPayload.products : [];
  const searchProducts = products
    .map((product) => buildSearchProduct(product, knowledgeModel, modelEvidenceByKey, precomputedKnowledgeByKey))
    .filter((product) => product.id && product.handle && product.title);

  return {
    generatedAt: productsPayload?.generatedAt || new Date().toISOString(),
    source: productsPayload?.source || "/data/products.json",
    total: searchProducts.length,
    knowledgeModel: knowledgeModel
      ? {
          modelVersion: knowledgeModel.modelVersion,
          trainingRecords: knowledgeModel.trainingRecords,
          algorithm: knowledgeModel.algorithm,
        }
      : null,
    products: searchProducts,
  };
}
