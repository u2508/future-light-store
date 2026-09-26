import { assessProductContentSpecificity } from "../../src/lib/product-content-specificity.js";

const COPY_FIELDS = Object.freeze(["title", "descriptionHtml", "seoTitle", "seoDescription"]);

/** Use only the exact final copy already present in a verified SEO manifest. */
export function resolveVerifiedProductSeoCopy(item, override = null) {
  if (item?.status !== "verified" || item?.quality?.ok !== true) {
    throw new Error("Product SEO artifact requires a verified, quality-passing manifest item");
  }
  const desired = item.desired;
  if (!desired || COPY_FIELDS.some((field) => typeof desired[field] !== "string" || !desired[field].trim())) {
    throw new Error("Verified product SEO manifest item is missing an exact final copy field");
  }

  if (override) {
    const unknownFields = Object.keys(override).filter((field) => !COPY_FIELDS.includes(field));
    if (unknownFields.length) {
      throw new Error(`SEO override contains unapproved field(s): ${unknownFields.join(", ")}`);
    }
    const proposed = {
      title: override.title || desired.title,
      descriptionHtml: String(override.descriptionHtml || desired.descriptionHtml).trim(),
      seoTitle: override.seoTitle || override.title || desired.seoTitle,
      seoDescription: override.seoDescription || desired.seoDescription,
    };
    const mismatches = COPY_FIELDS.filter((field) => proposed[field] !== desired[field]);
    if (mismatches.length) {
      throw new Error(
        `SEO override differs from the verified manifest for ${mismatches.join(", ")}`,
      );
    }
  }

  return Object.fromEntries(COPY_FIELDS.map((field) => [field, desired[field]]));
}

/** Reject generic or cross-product copy against only the frozen source identity. */
export function auditVerifiedProductSeoCopy(sourceProduct, copy) {
  const evidence = {
    handle: sourceProduct?.handle,
    title: sourceProduct?.title,
  };
  return COPY_FIELDS.flatMap((field) => {
    const result = assessProductContentSpecificity(copy?.[field], evidence, {
      field,
      rejectGenericPatterns: true,
    });
    return result.specific ? [] : [`${field}:${result.issues.join(",")}`];
  });
}
