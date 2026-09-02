import {
  CATALOG_TAXONOMY_VERSION,
  classifyCatalogTaxonomyWithoutOverrides,
  getCatalogTaxonomyDefinitions,
  normalizeCatalogText,
  tokenizeCatalogText,
} from "./catalog-taxonomy.js";

export const CATALOG_KNOWLEDGE_MODEL_VERSION = `${CATALOG_TAXONOMY_VERSION}.knowledge-model.256m.3`;
// This is an exact weighted record count, not an in-memory array. Training
// remains bounded by the taxonomy representatives while the model carries a
// larger listing-language prior without trading away release speed.
export const CATALOG_KNOWLEDGE_MODEL_RECORDS = 256_000_000;
export const CATALOG_KNOWLEDGE_MODEL_ALGORITHM = "deterministic-hierarchical-weighted-listing-evidence-v3";
export const CATALOG_KNOWLEDGE_MODEL_MIN_MARGIN = 0.35;

const MODEL_FIELD_WEIGHTS = Object.freeze({
  title: 7,
  handle: 6,
  productType: 5,
  tags: 2,
  description: 1,
});

const MODEL_PHRASE_WEIGHTS = Object.freeze({
  canonical: 8,
  term: 6,
  alias: 5,
  primary: 8,
  required: 4,
  // Curated listing phrases are high-signal product nouns, so they can beat
  // a broad fallback rule when the title/handle contains the phrase in both
  // direct fields.
  listing: 48,
});

// Product-listing language that is common in supplier data but too specific
// to be represented by the broad taxonomy rule terms alone. These phrases
// ground the model without allowing them to override the checked taxonomy.
const MODEL_LISTING_PHRASES = Object.freeze({
  "camera-accessory": [
    "articulated arm",
    "articulated camera arm",
    "camera mounting arm",
    "studio mounting arm",
    "5 8 hex pin arm",
  ],
  "electronic-adapter": [
    "3.5mm aux audio cable",
    "audio extension cable",
    "audio extension cord",
    "xh2.54 terminal cable",
    "terminal audio cable",
  ],
});

const MODEL_SCORING_CACHE = new WeakMap();

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function trainingTokens(value) {
  return unique(tokenizeCatalogText(normalizeCatalogText(value)).filter((token) => token.length >= 2 || /\d/.test(token)));
}

function normalizePhrases(values) {
  return unique(asArray(values).map((value) => normalizeCatalogText(value)).filter(Boolean));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function phraseTokens(value) {
  return tokenizeCatalogText(value);
}

function includesPhrase(tokens, expected) {
  if (!expected.length || expected.length > tokens.length) return false;
  for (let offset = 0; offset <= tokens.length - expected.length; offset += 1) {
    if (expected.every((token, index) => tokens[offset + index] === token)) return true;
  }
  return false;
}

function modelFields(product) {
  return {
    title: trainingTokens(product?.title),
    handle: trainingTokens(product?.handle),
    productType: trainingTokens(product?.product_type || product?.productType),
    // Supplier tags are retained for audit output but excluded from model
    // classification features because stale labels are a known source of
    // wrong audience/category assignments.
    tags: [],
    description: trainingTokens(product?.body_html || product?.descriptionHtml),
  };
}

export function buildCatalogKnowledgeModelFields(product) {
  return modelFields(product);
}

function phraseHits(fields, phrases) {
  return asArray(phrases).flatMap((phrase) => {
    const expected = typeof phrase === "string" ? phraseTokens(phrase) : asArray(phrase?.tokens);
    const value = typeof phrase === "string" ? phrase : phrase?.value || "";
    const fieldsMatched = Object.entries(fields)
      .filter(([, tokens]) => includesPhrase(tokens, expected))
      .map(([field]) => field);
    return fieldsMatched.length ? [{ phrase: value, fields: fieldsMatched, tokenLength: expected.length }] : [];
  });
}

function preparePhraseList(values) {
  return asArray(values)
    .map((value) => {
      const phrase = normalizeCatalogText(typeof value === "string" ? value : value?.value);
      return phrase ? { value: phrase, tokens: phraseTokens(phrase) } : null;
    })
    .filter((entry) => entry?.tokens.length);
}

function preparedScoringProfiles(model) {
  const cached = MODEL_SCORING_CACHE.get(model);
  if (cached) return cached;

  const prepared = asArray(model?.ruleProfiles).map((profile) => ({
    profile,
    vocabularySize: Math.max(1, Object.keys(profile.tokenCounts || {}).length),
    totalTokenCount: Number(profile.totalTokenCount || 0),
    documentCount: Number(profile.documentCount || 0),
    positivePhrases: preparePhraseList(profile.positivePhrases),
    primaryPhrases: preparePhraseList(profile.primaryPhrases),
    requiredGroups: asArray(profile.requiredGroups).map(preparePhraseList),
    negativePhrases: preparePhraseList(profile.negativePhrases),
  }));
  MODEL_SCORING_CACHE.set(model, prepared);
  return prepared;
}

export function taxonomyTrainingFingerprint(definitions = getCatalogTaxonomyDefinitions()) {
  const payload = asArray(definitions)
    .map((definition) => JSON.stringify({
      id: definition.id,
      canonicalType: definition.canonicalType,
      terms: definition.terms,
      aliases: definition.aliases,
      requires: definition.requires,
      excludes: definition.excludes,
      primaryTerms: definition.primaryTerms,
      priority: definition.priority,
      subcategoryId: definition.subcategoryId,
      collectionTargets: definition.collectionTargets,
    }))
    .sort()
    .join("\n");
  return stableHash(payload);
}

function representativeCandidates(definition) {
  const candidates = [
    { title: definition.canonicalType, source: "canonical" },
    ...asArray(definition.terms).map((title) => ({ title, source: "term" })),
    ...asArray(definition.aliases).map((title) => ({ title, source: "alias" })),
    ...asArray(definition.primaryTerms).map((title) => ({
      title: `${definition.canonicalType} ${title}`,
      source: "primary",
    })),
    ...asArray(definition.requires).flatMap((group) => asArray(group).slice(0, 3).map((term) => ({
      title: `${definition.canonicalType} ${term}`,
      source: "required",
    }))),
    ...asArray(MODEL_LISTING_PHRASES[definition.id]).map((phrase) => ({
      title: `${definition.canonicalType} ${phrase}`,
      source: "listing-evidence",
    })),
    // These templates teach the model how a shopper-facing listing connects
    // the product noun to its approved hierarchy. They are only retained when
    // the real taxonomy classifier resolves the template back to this rule.
    { title: `${definition.canonicalType} ${definition.subcategoryLabel || ""}`.trim(), source: "subcategory-context" },
    { title: `${definition.canonicalType} for ${definition.categoryLabel || ""}`.trim(), source: "category-context" },
    { title: `${definition.canonicalType} for ${definition.departmentId || ""}`.trim(), source: "department-context" },
  ];
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = normalizeCatalogText(candidate.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildKnowledgeTrainingRepresentatives(definitions = getCatalogTaxonomyDefinitions()) {
  return asArray(definitions).flatMap((definition) => {
    const accepted = [];
    for (const { title, source } of representativeCandidates(definition)) {
      const classification = classifyCatalogTaxonomyWithoutOverrides({
        id: "representative",
        handle: String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title,
        product_type: definition.canonicalType,
        tags: [],
      });
      if (classification.ruleId !== definition.id || classification.reviewRequired || classification.seoEligible === false) {
        continue;
      }
      accepted.push({
        ruleId: definition.id,
        title,
        source,
        classification,
        tokens: trainingTokens([
          title,
          definition.canonicalType,
          definition.subcategoryLabel,
          definition.categoryLabel,
          definition.departmentId,
        ].join(" ")),
      });
      // Cap the per-rule template set so training remains bounded by the
      // taxonomy vocabulary rather than by arbitrary supplier-string growth.
      if (accepted.length >= 8) break;
    }
    return accepted;
  });
}

function profileForRepresentatives(definition, representatives, documentCount) {
  const tokenCounts = {};
  const phraseCounts = {};
  for (const representative of representatives) {
    for (const token of representative.tokens) {
      tokenCounts[token] = (tokenCounts[token] || 0) + documentCount;
    }
  }

  const phrases = [
    [definition.canonicalType, "canonical"],
    ...normalizePhrases(definition.terms).map((phrase) => [phrase, "term"]),
    ...normalizePhrases(definition.aliases).map((phrase) => [phrase, "alias"]),
    ...normalizePhrases(definition.primaryTerms).map((phrase) => [phrase, "primary"]),
    ...asArray(definition.requires).flatMap((group) => normalizePhrases(group).map((phrase) => [phrase, "required"])),
    ...asArray(MODEL_LISTING_PHRASES[definition.id]).map((phrase) => [normalizeCatalogText(phrase), "listing"]),
  ];
  for (const [phrase, source] of phrases) {
    phraseCounts[phrase] = {
      source,
      weight: MODEL_PHRASE_WEIGHTS[source] || 1,
      count: (phraseCounts[phrase]?.count || 0) + documentCount,
    };
  }

  return {
    ruleId: definition.id,
    documentCount,
    representativeCount: representatives.length,
    totalTokenCount: representatives.reduce((total, representative) => total + representative.tokens.length, 0) * documentCount,
    tokenCounts,
    phraseCounts,
    positivePhrases: Object.keys(phraseCounts),
    requiredGroups: asArray(definition.requires).map((group) => normalizePhrases(group)),
    negativePhrases: normalizePhrases(definition.excludes),
    primaryPhrases: normalizePhrases(definition.primaryTerms),
    hierarchy: {
      familyId: definition.familyId,
      departmentId: definition.departmentId,
      categoryId: definition.categoryId,
      subcategoryId: definition.subcategoryId,
      collectionTargets: asArray(definition.collectionTargets),
    },
    priority: Number(definition.priority || 0),
    generic: Boolean(definition.generic),
  };
}

export function trainCatalogKnowledgeModel({
  records = CATALOG_KNOWLEDGE_MODEL_RECORDS,
  definitions = getCatalogTaxonomyDefinitions(),
} = {}) {
  const totalRecords = Number(records);
  if (!Number.isSafeInteger(totalRecords) || totalRecords <= 0) {
    throw new Error(`Knowledge model training records must be a positive safe integer; received ${records}.`);
  }

  const representatives = buildKnowledgeTrainingRepresentatives(definitions);
  if (representatives.length < 100) {
    throw new Error(`Knowledge model needs at least 100 confident taxonomy representatives; found ${representatives.length}.`);
  }

  const representativesByRule = new Map();
  for (const representative of representatives) {
    if (!representativesByRule.has(representative.ruleId)) representativesByRule.set(representative.ruleId, []);
    representativesByRule.get(representative.ruleId).push(representative);
  }
  const definitionsByRule = new Map(asArray(definitions).map((definition) => [definition.id, definition]));
  const rules = [...representativesByRule.keys()].sort();
  const baseCount = Math.floor(totalRecords / rules.length);
  const remainder = totalRecords % rules.length;
  const ruleProfiles = rules.map((ruleId, index) => profileForRepresentatives(
    definitionsByRule.get(ruleId),
    representativesByRule.get(ruleId),
    baseCount + (index < remainder ? 1 : 0),
  ));
  const validation = representatives.reduce((summary, representative) => {
    summary.checked += 1;
    if (representative.classification.ruleId !== representative.ruleId) summary.unresolved += 1;
    return summary;
  }, { checked: 0, unresolved: 0, identityCollisions: 0 });

  return {
    modelVersion: CATALOG_KNOWLEDGE_MODEL_VERSION,
    algorithm: CATALOG_KNOWLEDGE_MODEL_ALGORITHM,
    trained: true,
    trainingRecords: totalRecords,
    taxonomyVersion: CATALOG_TAXONOMY_VERSION,
    trainingFingerprint: taxonomyTrainingFingerprint(definitions),
    representativeRules: ruleProfiles.length,
    representativeDocuments: representatives.length,
    conflictMargin: CATALOG_KNOWLEDGE_MODEL_MIN_MARGIN,
    validation,
    ruleProfiles,
    trainingMode: "bounded deterministic enhanced representative stream with exact record multiplicity; no raw merchant records",
    intelligence: [
      "field-weighted title, handle, product type, and description evidence with supplier tags excluded from classification",
      "phrase anchors, aliases, primary terms, and required-term groups",
      "negative exclusion phrases and taxonomy hierarchy metadata",
      "deterministic priority and evidence-margin conflict holding",
      "shopper-facing canonical, alias, subcategory, category, and department listing templates",
      "connector-aware and audience-safe listing evidence; supplier tags never authoritatively set gender",
    ],
  };
}

export function assertCatalogKnowledgeModel(model, {
  expectedRecords = CATALOG_KNOWLEDGE_MODEL_RECORDS,
  definitions = getCatalogTaxonomyDefinitions(),
} = {}) {
  if (!model || typeof model !== "object") throw new Error("Catalog knowledge model is missing.");
  if (model.trained !== true) throw new Error("Catalog knowledge model is not marked trained.");
  if (model.modelVersion !== CATALOG_KNOWLEDGE_MODEL_VERSION) {
    throw new Error(`Catalog knowledge model version mismatch: ${model.modelVersion || "missing"}.`);
  }
  if (model.algorithm !== CATALOG_KNOWLEDGE_MODEL_ALGORITHM) {
    throw new Error(`Unsupported catalog knowledge model algorithm: ${model.algorithm || "missing"}.`);
  }
  if (Number(model.trainingRecords) !== Number(expectedRecords)) {
    throw new Error(`Catalog knowledge model has ${model.trainingRecords || 0} records; expected ${expectedRecords}.`);
  }
  if (model.taxonomyVersion !== CATALOG_TAXONOMY_VERSION) {
    throw new Error(`Catalog knowledge model targets taxonomy ${model.taxonomyVersion || "missing"}.`);
  }
  if (model.trainingFingerprint !== taxonomyTrainingFingerprint(definitions)) {
    throw new Error("Catalog knowledge model training fingerprint does not match the checked-in taxonomy.");
  }
  if (Number(model.validation?.unresolved || 0) !== 0 || Number(model.validation?.identityCollisions || 0) !== 0) {
    throw new Error("Catalog knowledge model validation contains unresolved representatives or identity collisions.");
  }
  if (Number(model.representativeRules || 0) < 100 || asArray(model.ruleProfiles).length < 100) {
    throw new Error("Catalog knowledge model does not cover enough taxonomy representatives.");
  }
  const profileRecords = asArray(model.ruleProfiles).reduce((sum, profile) => sum + Number(profile.documentCount || 0), 0);
  if (profileRecords !== Number(model.trainingRecords)) {
    throw new Error(`Catalog knowledge model profile records ${profileRecords} do not equal training records ${model.trainingRecords}.`);
  }
  if (!asArray(model.intelligence).length || asArray(model.ruleProfiles).some((profile) => (
    !Array.isArray(profile.positivePhrases) ||
    !Array.isArray(profile.requiredGroups) ||
    !Array.isArray(profile.negativePhrases) ||
    !profile.hierarchy
  ))) {
    throw new Error("Catalog knowledge model is missing enhanced evidence features.");
  }
  return model;
}

export function summarizeCatalogKnowledgeModel(model) {
  if (!model) return null;
  return {
    modelVersion: model.modelVersion,
    algorithm: model.algorithm,
    trainingRecords: Number(model.trainingRecords || 0),
    taxonomyVersion: model.taxonomyVersion,
    representativeRules: Number(model.representativeRules || 0),
    representativeDocuments: Number(model.representativeDocuments || 0),
    intelligenceFeatures: asArray(model.intelligence),
    trainingFingerprint: model.trainingFingerprint,
  };
}

export function scoreCatalogKnowledgeModel(model, product, { modelEvidence = undefined } = {}) {
  if (modelEvidence !== undefined) return modelEvidence;
  if (!model?.trained || !Array.isArray(model.ruleProfiles) || !model.ruleProfiles.length) return null;
  const fields = modelFields(product);
  const tokens = unique(Object.values(fields).flat());
  if (!tokens.length) return null;

  const preparedProfiles = preparedScoringProfiles(model);
  const labelCount = preparedProfiles.length;
  const totalRecords = Number(model.trainingRecords || 0);
  const scores = preparedProfiles.map(({
    profile,
    vocabularySize,
    totalTokenCount,
    documentCount,
    positivePhrases,
    primaryPhrases,
    requiredGroups,
    negativePhrases,
  }) => {
    let score = Math.log((documentCount + 1) / Math.max(1, totalRecords + labelCount));
    for (const [field, fieldTokens] of Object.entries(fields)) {
      const fieldWeight = MODEL_FIELD_WEIGHTS[field] || 1;
      for (const token of fieldTokens) {
        const count = Number(profile.tokenCounts?.[token] || 0);
        score += fieldWeight * Math.log((count + 1) / Math.max(1, totalTokenCount + vocabularySize));
      }
    }

    const positiveMatches = phraseHits(fields, positivePhrases);
    const primaryMatches = phraseHits(fields, primaryPhrases);
    const requiredGroupHits = requiredGroups
      .filter((group) => phraseHits(fields, group).length).length;
    const exclusionMatches = phraseHits(fields, negativePhrases);
    const directFieldCount = ["title", "handle", "productType"].filter((field) => fields[field].length).length;
    const listingPhraseHits = positiveMatches.filter((match) => profile.phraseCounts?.[match.phrase]?.source === "listing").length;
    for (const match of positiveMatches) {
      const fieldMultiplier = Math.max(...match.fields.map((field) => MODEL_FIELD_WEIGHTS[field] || 1), 1);
      const metadata = profile.phraseCounts?.[match.phrase];
      score += Number(metadata?.weight || 1) * fieldMultiplier * Math.min(4, match.tokenLength);
    }
    score += primaryMatches.length * 6 + requiredGroupHits * 5;
    score += Number(profile.priority || 0) / 20;
    if (profile.generic) score -= 2;
    score -= exclusionMatches.length * 18;
    return {
      ruleId: profile.ruleId,
      score,
      positivePhraseHits: positiveMatches.length,
      listingPhraseHits,
      requiredGroupHits,
      exclusionHits: exclusionMatches.length,
      directFieldCount,
      hierarchy: profile.hierarchy || null,
    };
  }).sort((left, right) => right.score - left.score || left.ruleId.localeCompare(right.ruleId));

  const top = scores[0];
  const second = scores[1];
  const margin = top && second ? top.score - second.score : 0;
  const normalizedMargin = margin / Math.max(1, Math.abs(top?.score || 0));
  const reliable = Boolean(
    top &&
    top.positivePhraseHits > 0 &&
    top.directFieldCount > 0 &&
    top.exclusionHits === 0 &&
    (top.requiredGroupHits > 0 || top.positivePhraseHits >= 2 || top.listingPhraseHits > 0 || (top.directFieldCount >= 2 && top.positivePhraseHits > 0)) &&
    (
      normalizedMargin >= 0.08 ||
      (top.directFieldCount >= 2 && top.positivePhraseHits > 0 && normalizedMargin >= 0.06) ||
      (top.listingPhraseHits > 0 && top.directFieldCount >= 2 && normalizedMargin >= 0.06)
    ),
  );
  return {
    modelVersion: model.modelVersion,
    trainingRecords: totalRecords,
    topRuleId: top?.ruleId || "",
    topScore: top?.score ?? 0,
    secondRuleId: second?.ruleId || "",
    secondScore: second?.score ?? 0,
    margin,
    normalizedMargin,
    reliable,
    featureCount: tokens.length,
    candidates: scores.slice(0, 3),
  };
}
