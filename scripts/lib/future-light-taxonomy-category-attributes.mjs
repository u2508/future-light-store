const CATEGORY_ID_PATTERN = /^gid:\/\/shopify\/TaxonomyCategory\//;

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

export function collectAssignedTaxonomyCategories(products) {
  if (!Array.isArray(products)) throw new Error("Catalog products must be an array.");
  const categoriesById = new Map();

  for (const product of products) {
    const category = product?.category;
    if (!category?.id) continue;
    const id = requireText(category.id, "Taxonomy category ID");
    if (!CATEGORY_ID_PATTERN.test(id)) {
      throw new Error(`Unexpected Shopify taxonomy category ID ${id}.`);
    }
    const name = requireText(category.name, `Taxonomy category ${id} name`);
    const fullName = requireText(category.fullName, `Taxonomy category ${id} fullName`);
    const current = categoriesById.get(id);
    if (current && (current.name !== name || current.fullName !== fullName)) {
      throw new Error(`Catalog products disagree on the identity of taxonomy category ${id}.`);
    }
    if (current) current.productCount += 1;
    else categoriesById.set(id, { id, name, fullName, productCount: 1 });
  }

  return [...categoriesById.values()].sort(
    (left, right) => left.fullName.localeCompare(right.fullName) || left.id.localeCompare(right.id),
  );
}

export function chunkTaxonomyCategoryIds(categories, batchSize = 50) {
  if (!Array.isArray(categories)) throw new Error("Taxonomy categories must be an array.");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 250) {
    throw new Error("Taxonomy query batch size must be an integer from 1 to 250.");
  }
  const ids = categories.map((category) => requireText(category?.id, "Taxonomy category ID"));
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) throw new Error("Taxonomy category query IDs must be unique.");
  const batches = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    batches.push(ids.slice(index, index + batchSize));
  }
  return batches;
}

function readPage(nodes, pageInfo, label) {
  if (!Array.isArray(nodes)) throw new Error(`${label} returned no nodes array.`);
  if (typeof pageInfo?.hasNextPage !== "boolean") {
    throw new Error(`${label} returned incomplete pagination metadata.`);
  }
  if (pageInfo?.hasNextPage === true) {
    throw new Error(`${label} is truncated; an additional page is required.`);
  }
  return nodes;
}

function normalizeAttribute(attribute, categoryId) {
  const id = requireText(attribute?.id, `Attribute ID for category ${categoryId}`);
  switch (attribute.__typename) {
    case "TaxonomyAttribute":
      return { id, type: attribute.__typename, name: null };
    case "TaxonomyChoiceListAttribute": {
      const name = requireText(attribute.name, `Choice-list attribute ${id} name`);
      const valueNodes = readPage(
        attribute.values?.nodes,
        attribute.values?.pageInfo,
        `Choice values for ${categoryId}/${name}`,
      );
      const valueIds = new Set();
      const values = valueNodes.map((value) => {
        const valueId = requireText(value?.id, `Choice value ID for ${categoryId}/${name}`);
        const valueName = requireText(value?.name, `Choice value ${valueId} name`);
        if (valueIds.has(valueId)) throw new Error(`Duplicate choice value ${valueId} for ${name}.`);
        valueIds.add(valueId);
        return { id: valueId, name: valueName };
      });
      return { id, type: attribute.__typename, name, values };
    }
    case "TaxonomyMeasurementAttribute": {
      const name = requireText(attribute.name, `Measurement attribute ${id} name`);
      if (!Array.isArray(attribute.options)) {
        throw new Error(`Measurement attribute ${id} returned no options array.`);
      }
      const optionKeys = new Set();
      const options = attribute.options.map((option) => {
        const key = requireText(option?.key, `Measurement option key for ${categoryId}/${name}`);
        if (optionKeys.has(key)) throw new Error(`Duplicate measurement option ${key} for ${name}.`);
        optionKeys.add(key);
        if (option.value !== null && option.value !== undefined && typeof option.value !== "string") {
          throw new Error(`Measurement option ${key} for ${name} has a non-string value.`);
        }
        return { key, value: option.value ?? null };
      });
      return { id, type: attribute.__typename, name, options };
    }
    default:
      throw new Error(
        `Unsupported taxonomy category attribute type ${attribute?.__typename || "<missing>"}.`,
      );
  }
}

export function reconcileTaxonomyCategoryAttributes({ productRecords, categoryNodes }) {
  const expectedCategories = collectAssignedTaxonomyCategories(productRecords);
  if (!Array.isArray(categoryNodes)) throw new Error("Shopify taxonomy response must be an array.");

  const categoriesById = new Map();
  for (const node of categoryNodes) {
    if (!node || node.__typename !== "TaxonomyCategory") {
      throw new Error("Shopify returned a missing or non-category node for a taxonomy ID.");
    }
    const id = requireText(node.id, "Returned taxonomy category ID");
    if (categoriesById.has(id)) throw new Error(`Duplicate taxonomy category response ${id}.`);
    categoriesById.set(id, node);
  }

  if (categoriesById.size !== expectedCategories.length) {
    throw new Error(
      `Taxonomy category cohort mismatch: received ${categoriesById.size}, expected ${expectedCategories.length}.`,
    );
  }

  const attributes = [];
  let choiceValueCount = 0;
  let measurementAttributeCount = 0;
  let unnamedAttributeCount = 0;

  for (const expected of expectedCategories) {
    const node = categoriesById.get(expected.id);
    if (!node) throw new Error(`Missing taxonomy category ${expected.id} (${expected.fullName}).`);
    if (node.name !== expected.name || node.fullName !== expected.fullName) {
      throw new Error(`Live taxonomy category identity disagrees for ${expected.id}.`);
    }
    if (typeof node.isLeaf !== "boolean") {
      throw new Error(`Taxonomy category ${expected.id} did not return its leaf-category flag.`);
    }

    const attributeNodes = readPage(
      node.attributes?.nodes,
      node.attributes?.pageInfo,
      `Attributes for ${expected.fullName}`,
    );
    const attributeIds = new Set();
    const normalizedAttributes = attributeNodes.map((attribute) => {
      const normalized = normalizeAttribute(attribute, expected.id);
      if (attributeIds.has(normalized.id)) {
        throw new Error(`Duplicate attribute ${normalized.id} on category ${expected.id}.`);
      }
      attributeIds.add(normalized.id);
      if (normalized.type === "TaxonomyChoiceListAttribute") {
        choiceValueCount += normalized.values.length;
      } else if (normalized.type === "TaxonomyMeasurementAttribute") {
        measurementAttributeCount += 1;
      } else {
        unnamedAttributeCount += 1;
      }
      return normalized;
    });

    attributes.push({
      ...expected,
      isLeaf: node.isLeaf,
      attributes: normalizedAttributes,
    });
  }

  return {
    categories: attributes,
    counts: {
      categories: attributes.length,
      attributes: attributes.reduce((total, category) => total + category.attributes.length, 0),
      choiceValues: choiceValueCount,
      measurementAttributes: measurementAttributeCount,
      unnamedTaxonomyAttributes: unnamedAttributeCount,
    },
  };
}
