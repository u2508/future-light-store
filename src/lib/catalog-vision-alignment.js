import {
  getCatalogTaxonomyDefinitions,
  normalizeCatalogText,
  singularizeCatalogToken,
  tokenizeCatalogText,
} from "./catalog-taxonomy.js";

const IGNORED_ALIGNMENT_TOKENS = new Set([
  "accessory", "anime", "assorted", "best", "black", "blue", "brand", "classic", "collection",
  "color", "colour", "compact", "creative", "daily", "device", "digital", "easy", "essential",
  "fashion", "feature", "general", "gift", "gadget", "green", "high", "item", "kid", "latest",
  "large", "man", "mini", "modern", "new", "original", "portable", "premium", "product", "quality",
  "red", "shop", "small", "smart", "style", "stylish", "thing", "tool", "universal", "white",
  "wireless", "woman", "yellow",
]);

function normalizeToken(token) {
  return singularizeCatalogToken(normalizeCatalogText(token));
}

function meaningfulTokens(value) {
  return Array.from(new Set(tokenizeCatalogText(value)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !IGNORED_ALIGNMENT_TOKENS.has(token))));
}

function definitionValues(definition) {
  return [
    definition?.canonicalType,
    ...Array.isArray(definition?.terms) ? definition.terms : [],
    ...Array.isArray(definition?.aliases) ? definition.aliases : [],
    ...Array.isArray(definition?.primaryTerms) ? definition.primaryTerms : [],
  ].filter(Boolean);
}

function compileDefinitions(definitions) {
  const entries = definitions.map((definition) => ({
    definition,
    phrases: definitionValues(definition).map(normalizeCatalogText).filter(Boolean),
    tokens: new Set(meaningfulTokens(definitionValues(definition).join(" "))),
  }));
  return {
    entries,
    byId: new Map(entries.map((entry) => [entry.definition.id, entry])),
    allRuleTokens: new Set(entries.flatMap((entry) => [...entry.tokens])),
  };
}

const COMPILED_DEFINITIONS = compileDefinitions(getCatalogTaxonomyDefinitions());

export function assessVisionTaxonomyAlignment(product, ruleId, definitions = null) {
  const compiled = definitions ? compileDefinitions(definitions) : COMPILED_DEFINITIONS;
  const selected = compiled.byId.get(ruleId);
  if (!selected) {
    return {
      accepted: false,
      reason: `Vision selected unknown taxonomy rule ${ruleId || "(empty)"}.`,
      productTokens: [],
      categorySignalTokens: [],
      overlapTokens: [],
    };
  }

  const originalText = normalizeCatalogText([
    product?.title,
    product?.handle,
    product?.product_type || product?.productType,
  ].filter(Boolean).join(" "));
  const productTokens = meaningfulTokens(originalText);
  const categorySignalTokens = productTokens.filter((token) => compiled.allRuleTokens.has(token));
  const overlapTokens = categorySignalTokens.filter((token) => selected.tokens.has(token));
  const exactPhrase = selected.phrases.find((phrase) => {
    const phraseTokens = meaningfulTokens(phrase);
    return phraseTokens.length > 0 && ` ${originalText} `.includes(` ${phrase} `);
  }) || null;
  const strongOverlap = overlapTokens.find((token) => token.length >= 7) || null;
  const opaque = categorySignalTokens.length === 0 && productTokens.length <= 3;

  if (exactPhrase) {
    return {
      accepted: true,
      reason: `Original product evidence contains exact taxonomy phrase "${exactPhrase}".`,
      productTokens,
      categorySignalTokens,
      overlapTokens,
      exactPhrase,
      opaque: false,
    };
  }
  if (overlapTokens.length >= 2) {
    return {
      accepted: true,
      reason: `Original product evidence shares taxonomy tokens: ${overlapTokens.join(", ")}.`,
      productTokens,
      categorySignalTokens,
      overlapTokens,
      exactPhrase: null,
      opaque: false,
    };
  }
  if (strongOverlap) {
    return {
      accepted: true,
      reason: `Original product evidence shares strong taxonomy noun "${strongOverlap}".`,
      productTokens,
      categorySignalTokens,
      overlapTokens,
      exactPhrase: null,
      opaque: false,
    };
  }
  if (opaque) {
    return {
      accepted: true,
      reason: "Original supplier identity is opaque and contains no checked-in category noun; visual evidence may supply the category.",
      productTokens,
      categorySignalTokens,
      overlapTokens,
      exactPhrase: null,
      opaque: true,
    };
  }

  return {
    accepted: false,
    reason: `Vision rule ${ruleId} conflicts with original category evidence (${categorySignalTokens.join(", ") || "none"}).`,
    productTokens,
    categorySignalTokens,
    overlapTokens,
    exactPhrase: null,
    opaque: false,
  };
}
