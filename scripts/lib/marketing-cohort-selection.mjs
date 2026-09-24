function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * DSers/Shopify duplicate imports sometimes add a trailing numeric suffix to
 * an otherwise identical handle. Keep that suffix out of the ad-cohort key,
 * while preserving meaningful model numbers elsewhere in the handle.
 */
export function normalizeCandidateHandle(handle) {
  return normalize(handle).replace(/-(?:1|2)$/i, "");
}

export function normalizeCandidateTitle(title) {
  return normalize(title)
    .replace(/\s*[—-]\s*listing\s*\d+\s*$/i, "")
    .replace(/\b(for|the|and|with)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function candidateDedupeKeys(candidate) {
  return [
    `handle:${normalizeCandidateHandle(candidate?.handle)}`,
    `title:${normalizeCandidateTitle(candidate?.title)}`,
  ].filter((key) => !key.endsWith(":"));
}

export function dedupeRankedCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const keys = candidateDedupeKeys(candidate);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}
