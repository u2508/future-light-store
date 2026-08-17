export const GOOGLE_VARIANT_METAFIELD_DEFINITIONS = [
  { id: "ageGroup", name: "Google: Age Group", namespace: "mm-google-shopping", key: "age_group" },
  { id: "condition", name: "Google: Condition", namespace: "mm-google-shopping", key: "condition" },
  { id: "gender", name: "Google: Gender", namespace: "mm-google-shopping", key: "gender" },
  { id: "mpn", name: "Google: MPN", namespace: "mm-google-shopping", key: "mpn" },
  { id: "sizeSystem", name: "Google: Size System", namespace: "mm-google-shopping", key: "size_system" },
].map((definition) => ({ ...definition, type: "single_line_text_field" }));

const CHILD_PATTERN = /\b(baby|babies|boy|boys|child|children|girl|girls|kid|kids|youth)\b/i;
const INFANT_PATTERN = /\b(baby|babies|infant|infants)\b/i;
const NEWBORN_PATTERN = /\b(newborn|newborns|0\s*[-–]\s*3\s*months?)\b/i;
const TODDLER_PATTERN = /\b(toddler|toddlers)\b/i;
const FEMALE_PATTERN = /\b(female|girl|girls|woman|women|womens|women's|ladies|lady)\b/i;
const MALE_PATTERN = /\b(boy|boys|gentleman|gentlemen|male|man|men|mens|men's)\b/i;
const UNISEX_PATTERN = /\b(unisex|all genders?)\b/i;
const SIZE_OPTION_PATTERN = /\b(size|shoe size|waist|inseam)\b/i;
const SIZED_CATEGORY_PATTERN = /\b(apparel|clothing|dress|footwear|jacket|jeans|pants|shirt|shoe|shorts|skirt|sneaker|sweater|swimwear|top|trouser)\b/i;

export function normalizeSingleLineText(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productEvidence(variant) {
  const product = variant?.product || {};
  const options = Array.isArray(variant?.selectedOptions)
    ? variant.selectedOptions.flatMap((option) => [option?.name, option?.value])
    : [];
  return normalizeSingleLineText([
    product.handle,
    product.title,
    product.productType,
    product.category?.fullName,
    ...(Array.isArray(product.tags) ? product.tags : []),
    variant?.title,
    ...options,
  ].filter(Boolean).join(" "));
}

export function inferGoogleAgeGroup(variant) {
  const evidence = productEvidence(variant);
  if (NEWBORN_PATTERN.test(evidence)) return "newborn";
  if (TODDLER_PATTERN.test(evidence)) return "toddler";
  if (INFANT_PATTERN.test(evidence)) return "infant";
  if (CHILD_PATTERN.test(evidence)) return "kids";
  return "adult";
}

export function inferGoogleGender(variant) {
  const evidence = productEvidence(variant);
  if (UNISEX_PATTERN.test(evidence)) return "unisex";
  const female = FEMALE_PATTERN.test(evidence);
  const male = MALE_PATTERN.test(evidence);
  if (female && !male) return "female";
  if (male && !female) return "male";
  return "unisex";
}

export function inferGoogleSizeSystem(variant) {
  const evidence = productEvidence(variant);
  const options = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
  const hasSizeOption = options.some((option) => SIZE_OPTION_PATTERN.test(normalizeSingleLineText(option?.name)));
  return hasSizeOption && SIZED_CATEGORY_PATTERN.test(evidence) ? "US" : "";
}

export function inferGoogleMpn(variant) {
  const current = normalizeSingleLineText(variant?.metafields?.mpn?.value);
  if (current) return current;
  const sourceIdentifier = normalizeSingleLineText(variant?.sku || variant?.barcode);
  if (sourceIdentifier) return sourceIdentifier;
  const legacyId = normalizeSingleLineText(variant?.legacyResourceId || String(variant?.id || "").match(/(\d+)$/)?.[1]);
  return legacyId ? `SALT-${legacyId}` : "";
}

export function buildGoogleVariantMetafieldPlan(variant) {
  const desired = {
    ageGroup: inferGoogleAgeGroup(variant),
    condition: "new",
    gender: inferGoogleGender(variant),
    mpn: inferGoogleMpn(variant),
    sizeSystem: inferGoogleSizeSystem(variant),
  };
  const writes = [];
  const skipped = [];

  for (const definition of GOOGLE_VARIANT_METAFIELD_DEFINITIONS) {
    const value = normalizeSingleLineText(desired[definition.id]);
    const currentValue = normalizeSingleLineText(variant?.metafields?.[definition.id]?.value);
    if (!value) {
      skipped.push({ fieldId: definition.id, reason: definition.id === "sizeSystem" ? "not applicable without a supported size option" : "no supported value" });
      continue;
    }
    if (value === currentValue) {
      skipped.push({ fieldId: definition.id, reason: "already set" });
      continue;
    }
    writes.push({
      ownerId: variant.id,
      namespace: definition.namespace,
      key: definition.key,
      type: definition.type,
      value,
      fieldId: definition.id,
      previousValue: currentValue || null,
    });
  }

  return { desired, writes, skipped };
}
