const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/\d+$/;
const RECORD_KEYS = new Set([
  "productGid",
  "handle",
  "status",
  "title",
  "confidence",
  "familyLane",
  "visualEvidence",
  "beforeTags",
  "beforeMembershipIds",
  "addMemberships",
  "removeMemberships",
]);

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sameSet(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function assertStringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? "an array" : "a non-empty array"}`);
  }
  if (value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} contains an empty or non-string value`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} contains duplicates`);
  }
}

function membershipsByTag(record, key) {
  const memberships = record[key];
  if (!Array.isArray(memberships)) throw new Error(`${key} must be an array`);
  const seenCollections = new Set();
  const seenMappings = new Set();
  for (const membership of memberships) {
    if (!membership || typeof membership !== "object") throw new Error(`${key} has an invalid membership`);
    const { tag, collectionGid } = membership;
    if (typeof tag !== "string" || !tag.trim() || !COLLECTION_GID.test(String(collectionGid || ""))) {
      throw new Error(`${key} has an invalid tag or collection GID`);
    }
    const mappingKey = `${tag}\0${collectionGid}`;
    if (seenMappings.has(mappingKey) || seenCollections.has(collectionGid)) {
      throw new Error(`${key} contains a duplicate mapping or collection`);
    }
    seenMappings.add(mappingKey);
    seenCollections.add(collectionGid);
  }
  return memberships;
}

export function validateCollectionClassificationManifest(manifest, { expectedShopDomain } = {}) {
  if (manifest?.schemaVersion !== 1) throw new Error("Unsupported collection-classification manifest version");
  if (typeof manifest.authorization !== "string" || !manifest.authorization.includes("User requested execution")) {
    throw new Error("Manifest is missing the bounded user-request authorization record");
  }
  if (JSON.stringify(manifest.mutationScope) !== JSON.stringify(["product.tags only"])) {
    throw new Error("Only product.tags mutations are permitted by this runner");
  }
  if (!manifest.target || manifest.target.shopDomain !== expectedShopDomain) {
    throw new Error("Manifest target does not match the pinned Future Light Shopify domain");
  }
  if (manifest.target.shopId !== "gid://shopify/Shop/106570088529" || manifest.target.apiVersion !== "2026-07") {
    throw new Error("Manifest shop ID or API version does not match the approved target");
  }
  for (const key of ["docxSha256", "catalogSnapshotSha256", "collectionsSnapshotSha256"]) {
    if (!/^[a-f0-9]{64}$/.test(String(manifest.source?.[key] || ""))) {
      throw new Error(`Manifest source ${key} must be a SHA-256 digest`);
    }
  }
  if (!Array.isArray(manifest.records) || manifest.records.length === 0) {
    throw new Error("Manifest contains no classification records");
  }

  const productIds = new Set();
  for (const [index, record] of manifest.records.entries()) {
    const label = `record ${index + 1}`;
    if (!record || typeof record !== "object") throw new Error(`${label} is invalid`);
    for (const key of Object.keys(record)) {
      if (!RECORD_KEYS.has(key)) throw new Error(`${label} contains forbidden field ${key}`);
    }
    if (!PRODUCT_GID.test(String(record.productGid || ""))) throw new Error(`${label} has an invalid Product GID`);
    if (productIds.has(record.productGid)) throw new Error(`Duplicate Product GID ${record.productGid}`);
    productIds.add(record.productGid);
    if (!record.handle || !record.title || record.status !== "ACTIVE") throw new Error(`${label} has an incomplete or non-active product preimage`);
    if (!Number.isFinite(record.confidence) || record.confidence < 0.95) throw new Error(`${label} is below the 0.95 confidence floor`);
    if (String(record.visualEvidence || "").trim().length < 30) throw new Error(`${label} lacks a substantive visual evidence note`);

    assertStringArray(record.beforeTags, `${label}.beforeTags`);
    assertStringArray(record.beforeMembershipIds, `${label}.beforeMembershipIds`);
    if (record.beforeMembershipIds.some((id) => !COLLECTION_GID.test(id))) throw new Error(`${label} has an invalid preimage collection GID`);
    const add = membershipsByTag(record, "addMemberships");
    const remove = membershipsByTag(record, "removeMemberships");
    const beforeTags = new Set(record.beforeTags);
    const beforeMembershipIds = new Set(record.beforeMembershipIds);
    const addTags = new Set(add.map((item) => item.tag));
    const removeTags = new Set(remove.map((item) => item.tag));
    if ([...addTags].some((tag) => beforeTags.has(tag))) throw new Error(`${label} attempts to add a tag already in its preimage`);
    if ([...removeTags].some((tag) => !beforeTags.has(tag))) throw new Error(`${label} attempts to remove a tag absent from its preimage`);
    if ([...addTags].some((tag) => removeTags.has(tag))) throw new Error(`${label} adds and removes the same tag`);
    if ([...add].some((item) => beforeMembershipIds.has(item.collectionGid))) throw new Error(`${label} target collection is already in its preimage`);
    if ([...remove].some((item) => !beforeMembershipIds.has(item.collectionGid))) throw new Error(`${label} removal collection is absent from its preimage`);
  }
  return true;
}

export function compareSnapshotPreimage(record, snapshotProduct) {
  if (!snapshotProduct || snapshotProduct.id !== record.productGid) throw new Error(`${record.productGid} is missing from the source catalog snapshot`);
  if (snapshotProduct.handle !== record.handle || snapshotProduct.title !== record.title || snapshotProduct.status !== record.status) {
    throw new Error(`${record.productGid} manifest identity does not match the hashed catalog snapshot`);
  }
  const tags = snapshotProduct.tags || [];
  const membershipIds = snapshotProduct.collections?.nodes?.map((collection) => collection.id) || [];
  if (!sameSet(tags, record.beforeTags)) throw new Error(`${record.productGid} manifest tags do not match the hashed catalog snapshot`);
  if (!sameSet(membershipIds, record.beforeMembershipIds)) {
    throw new Error(`${record.productGid} manifest memberships do not match the hashed catalog snapshot`);
  }
  if (snapshotProduct.collections?.pageInfo?.hasNextPage !== false) {
    throw new Error(`${record.productGid} source snapshot has incomplete collection membership pagination`);
  }
  return true;
}

export function computeExpectedTags(record) {
  const tags = new Set(record.beforeTags);
  for (const { tag } of record.addMemberships) tags.add(tag);
  for (const { tag } of record.removeMemberships) tags.delete(tag);
  return sortedUnique([...tags]);
}

export function computeExpectedMembershipIds(record, currentTags) {
  const tags = new Set(currentTags);
  const ids = new Set(record.beforeMembershipIds);
  for (const { tag, collectionGid } of record.addMemberships) {
    if (tags.has(tag)) ids.add(collectionGid);
  }
  for (const { tag, collectionGid } of record.removeMemberships) {
    if (!tags.has(tag)) ids.delete(collectionGid);
  }
  return sortedUnique([...ids]);
}

export function classifyTagTransition(record, currentTags) {
  const current = new Set(currentTags || []);
  const before = new Set(record.beforeTags);
  const expectedAfter = new Set(computeExpectedTags(record));
  const allowedRemovals = new Set(record.removeMemberships.map((item) => item.tag));
  for (const tag of current) {
    if (!before.has(tag) && !expectedAfter.has(tag)) {
      throw new Error(`${record.productGid} has an unexpected concurrent tag ${tag}`);
    }
  }
  for (const tag of before) {
    if (!current.has(tag) && !allowedRemovals.has(tag)) {
      throw new Error(`${record.productGid} lost unrelated preimage tag ${tag}`);
    }
  }
  const additions = sortedUnique(record.addMemberships.map((item) => item.tag).filter((tag) => !current.has(tag)));
  const removals = sortedUnique(record.removeMemberships.map((item) => item.tag).filter((tag) => current.has(tag)));
  return {
    state: sameSet([...current], [...expectedAfter]) ? "complete" : sameSet([...current], record.beforeTags) ? "preimage" : "partial",
    tags: sortedUnique([...current]),
    expectedTags: sortedUnique([...expectedAfter]),
    expectedMembershipIds: computeExpectedMembershipIds(record, [...current]),
    addTags: additions,
    removeTags: removals,
  };
}

export function assertExactSet(actual, expected, label) {
  if (!sameSet(actual || [], expected || [])) {
    throw new Error(`${label} mismatch; actual=${JSON.stringify(sortedUnique(actual || []))} expected=${JSON.stringify(sortedUnique(expected || []))}`);
  }
  return true;
}

export function assertCompletedTagTransition(record, product) {
  const transition = classifyTagTransition(record, product?.tags || []);
  if (transition.state !== "complete") {
    throw new Error(`${record.productGid} tag transition is ${transition.state}, not complete`);
  }
  assertExactSet(product.tags || [], transition.expectedTags, `${record.productGid} final tags`);
  const membershipIds = product.collections?.nodes?.map((collection) => collection.id) || [];
  if (product.collections?.pageInfo?.hasNextPage !== false) {
    throw new Error(`${record.productGid} final collection membership pagination is incomplete`);
  }
  assertExactSet(membershipIds, transition.expectedMembershipIds, `${record.productGid} final collection memberships`);
  return transition;
}

export function assertCollectionRuleForMembership(collection, { collectionGid, tag }) {
  if (!collection || collection.id !== collectionGid) throw new Error(`Collection ${collectionGid} is missing or mismatched`);
  const rules = collection.ruleSet?.rules || [];
  const exact = rules.filter((rule) => rule.column === "TAG" && rule.relation === "EQUALS" && rule.condition === tag);
  const exactSingleRule = collection.ruleSet?.appliedDisjunctively === false && rules.length === 1 && exact.length === 1;
  const explicitTagOrRule = collection.ruleSet?.appliedDisjunctively === true
    && rules.length > 1
    && rules.every((rule) => rule.column === "TAG" && rule.relation === "EQUALS" && typeof rule.condition === "string" && rule.condition.trim())
    && exact.length === 1;
  if (!exactSingleRule && !explicitTagOrRule) {
    throw new Error(`Collection ${collectionGid} lacks a single exact TAG EQUALS ${tag} rule or an explicit tag-only OR rule containing it`);
  }
  if (collection.handle === "classification-fallback" || collectionGid === "gid://shopify/Collection/698007158865") {
    throw new Error("The classification-fallback collection is never a valid target");
  }
  return true;
}
