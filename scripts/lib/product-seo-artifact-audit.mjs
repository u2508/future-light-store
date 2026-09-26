function normalizeSeoValue(value, field) {
  let normalized = String(value ?? "");
  if (field === "descriptionHtml") {
    normalized = normalized.replace(/<[^>]*>/g, " ");
  }
  return normalized
    .replace(/&(?:amp|mdash|nbsp|quot|#39);/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function duplicateGroupCount(records, field, introducedHandles) {
  const groups = new Map();
  for (const record of records) {
    const value = normalizeSeoValue(record?.[field], field);
    if (!value) continue;
    const group = groups.get(value) || { count: 0, hasIntroducedRecord: false };
    group.count += 1;
    if (introducedHandles?.has(record?.handle)) group.hasIntroducedRecord = true;
    groups.set(value, group);
  }

  return [...groups.values()].filter(
    (group) => group.count > 1 && (!introducedHandles || group.hasIntroducedRecord),
  ).length;
}

/** Count duplicate final-copy groups, including new-vs-existing collisions. */
export function auditProductSeoDuplicateGroups(records, { introducedHandles = null } = {}) {
  const cohort = introducedHandles == null
    ? null
    : introducedHandles instanceof Set
      ? introducedHandles
      : new Set(introducedHandles);

  return {
    duplicateTitles: duplicateGroupCount(records, "title", cohort),
    duplicateDescriptions: duplicateGroupCount(records, "seoDescription", cohort),
    duplicateDescriptionHtml: duplicateGroupCount(records, "descriptionHtml", cohort),
  };
}
