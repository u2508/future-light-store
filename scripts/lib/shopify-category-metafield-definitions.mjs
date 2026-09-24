import { collectAssignedTaxonomyCategories } from "./future-light-taxonomy-category-attributes.mjs";

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function normalizeDefinition(definition, categoryId) {
  const id = requireText(definition?.id, `Definition ID for category ${categoryId}`);
  const name = requireText(definition?.name, `Definition ${id} name`);
  const namespace = requireText(definition?.namespace, `Definition ${id} namespace`);
  const key = requireText(definition?.key, `Definition ${id} key`);
  const ownerType = requireText(definition?.ownerType, `Definition ${id} owner type`);
  const type = requireText(definition?.type?.name, `Definition ${id} value type`);
  if (ownerType !== "PRODUCT") {
    throw new Error(`Category metafield definition ${namespace}.${key} is not owned by PRODUCT.`);
  }
  if (definition?.constraints?.key !== "category") {
    throw new Error(`Category metafield definition ${namespace}.${key} is not constrained by product category.`);
  }
  if (!Array.isArray(definition.validations)) {
    throw new Error(`Category metafield definition ${namespace}.${key} returned no validations array.`);
  }
  const validationKeys = new Set();
  const validations = definition.validations.map((validation) => {
    const validationName = requireText(validation?.name, `Validation name for ${namespace}.${key}`);
    if (validationKeys.has(validationName)) {
      throw new Error(`Duplicate validation ${validationName} on ${namespace}.${key}.`);
    }
    validationKeys.add(validationName);
    if (typeof validation.value !== "string") {
      throw new Error(`Validation ${validationName} on ${namespace}.${key} must have a string value.`);
    }
    return { name: validationName, value: validation.value };
  });
  return {
    id,
    name,
    namespace,
    key,
    definitionKey: `${namespace}.${key}`,
    ownerType,
    type,
    validations,
  };
}

function sameDefinition(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Reconcile the exact set of category-constrained PRODUCT metafield definitions
 * returned by Shopify for every category in a frozen product cohort. The caller
 * must query metafieldDefinitions with constraintSubtype.key="category" and
 * constraintStatus=CONSTRAINED_ONLY, and fully paginate each connection.
 */
export function reconcileShopifyCategoryMetafieldDefinitions({ productRecords, definitionsByCategory }) {
  const expectedCategories = collectAssignedTaxonomyCategories(productRecords);
  if (!Array.isArray(definitionsByCategory)) {
    throw new TypeError("definitionsByCategory must be an array.");
  }
  const expectedById = new Map(expectedCategories.map((category) => [category.id, category]));
  const responseById = new Map();
  const uniqueDefinitions = new Map();

  for (const entry of definitionsByCategory) {
    const categoryId = requireText(entry?.categoryId, "Definition result category ID");
    if (!expectedById.has(categoryId)) {
      throw new Error(`Shopify returned definitions for an unassigned category ${categoryId}.`);
    }
    if (responseById.has(categoryId)) {
      throw new Error(`Duplicate category metafield-definition result for ${categoryId}.`);
    }
    if (entry.hasNextPage !== false) {
      throw new Error(`Category metafield definitions for ${categoryId} are not fully paginated.`);
    }
    if (!Array.isArray(entry.definitions)) {
      throw new Error(`Category metafield definitions for ${categoryId} returned no definitions array.`);
    }

    const seenIds = new Set();
    const seenKeys = new Set();
    const normalizedDefinitions = entry.definitions.map((definition) => {
      const normalized = normalizeDefinition(definition, categoryId);
      if (seenIds.has(normalized.id) || seenKeys.has(normalized.definitionKey)) {
        throw new Error(`Duplicate category metafield definition ${normalized.definitionKey} for ${categoryId}.`);
      }
      seenIds.add(normalized.id);
      seenKeys.add(normalized.definitionKey);
      const previous = uniqueDefinitions.get(normalized.id);
      if (previous && !sameDefinition(previous, normalized)) {
        throw new Error(`Shopify returned conflicting schema for metafield definition ${normalized.id}.`);
      }
      uniqueDefinitions.set(normalized.id, normalized);
      return normalized;
    }).sort((left, right) => left.definitionKey.localeCompare(right.definitionKey));

    responseById.set(categoryId, {
      ...expectedById.get(categoryId),
      definitions: normalizedDefinitions,
    });
  }

  if (responseById.size !== expectedCategories.length) {
    const missing = expectedCategories.filter((category) => !responseById.has(category.id));
    throw new Error(
      `Category metafield-definition cohort mismatch: received ${responseById.size}, expected ${expectedCategories.length}; missing ${missing.length}.`,
    );
  }

  const categories = expectedCategories.map((category) => responseById.get(category.id));
  return {
    categories,
    counts: {
      categories: categories.length,
      categoryDefinitionAssignments: categories.reduce((sum, category) => sum + category.definitions.length, 0),
      uniqueDefinitions: uniqueDefinitions.size,
      validationRules: [...uniqueDefinitions.values()].reduce((sum, definition) => sum + definition.validations.length, 0),
    },
  };
}
