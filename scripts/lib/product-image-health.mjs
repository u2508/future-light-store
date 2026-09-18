import { createHash } from "node:crypto";

export const IMAGE_HEALTH_SCHEMA_VERSION = 1;
export const FUTURE_LIGHT_SCOPE = "future-light-store";
export const FUTURE_LIGHT_BRAND = "VS Store";
export const FUTURE_LIGHT_SHOP_DOMAIN = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
export const FUTURE_LIGHT_CDN_HOST = "cdn.shopify.com";
export const FUTURE_LIGHT_CDN_PATH_PREFIX = "/s/files/1/1065/7008/8529/";

export const IMAGE_HEALTH_THRESHOLDS = Object.freeze({
  primaryMinDimension: 640,
  minDimension: 500,
  maxAspectRatio: 3,
  suspiciouslySmallBytes: 1024,
});

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function imageUrlFromRecord(image) {
  return normalizeText(
    typeof image === "string" ? image : image?.src || image?.url || image?.originalSrc || "",
  );
}

export function canonicalImageUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return raw.split("?")[0];
  }
}

export function isFutureLightImageUrl(value) {
  try {
    const url = new URL(normalizeText(value));
    return (
      url.protocol === "https:" &&
      url.hostname === FUTURE_LIGHT_CDN_HOST &&
      url.pathname.startsWith(FUTURE_LIGHT_CDN_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

export function assertFutureLightCatalog(products) {
  const foreignProducts = asArray(products).filter(
    (product) => normalizeText(product?.vendor) !== FUTURE_LIGHT_BRAND,
  );
  if (foreignProducts.length) {
    const examples = foreignProducts
      .slice(0, 5)
      .map((product) => normalizeText(product?.handle || product?.id || "unknown"))
      .join(", ");
    throw new Error(
      `Future Light image audit refused ${foreignProducts.length} non-${FUTURE_LIGHT_BRAND} product(s): ${examples}`,
    );
  }
  return {
    scope: FUTURE_LIGHT_SCOPE,
    brand: FUTURE_LIGHT_BRAND,
    shopDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    productCount: asArray(products).length,
  };
}

export function productKey(product) {
  const id = normalizeText(product?.id || product?.admin_graphql_api_id);
  const handle = normalizeText(product?.handle).toLowerCase();
  return `${id || "no-id"}::${handle || "no-handle"}`;
}

export function normalizeImageRecord(image, index = 0) {
  const width = Number(image?.width);
  const height = Number(image?.height);
  const variantIds = asArray(image?.variant_ids || image?.variantIds)
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return {
    id: normalizeText(image?.id),
    url: imageUrlFromRecord(image),
    alt: normalizeText(image?.alt || image?.altText),
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    variantIds,
    position:
      Number.isInteger(Number(image?.position)) && Number(image.position) > 0
        ? Number(image.position)
        : index + 1,
    index,
  };
}

function numericIdentity(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  const match = raw.match(/(\d+)$/);
  return match ? `numeric:${match[1]}` : `value:${raw}`;
}

function imageIdIdentities(value) {
  const raw = normalizeText(value);
  if (!raw) return [];
  return [raw, numericIdentity(raw)].filter(Boolean);
}

function variantImageReference(variant) {
  const mediaNodes = Array.isArray(variant?.media?.nodes)
    ? variant.media.nodes
    : variant?.media?.edges?.map((edge) => edge?.node) || [];
  const mediaNode = asArray(mediaNodes).find(
    (node) => node?.id && (!node.__typename || node.__typename === "MediaImage"),
  );
  return {
    id: normalizeText(
      variant?.image_id || variant?.imageId || variant?.featured_image?.id || mediaNode?.id,
    ),
    url: normalizeText(
      variant?.featured_image?.src ||
        variant?.featured_image?.url ||
        variant?.image?.src ||
        variant?.image?.url,
    ),
  };
}

export function detectImageFormat(bytes) {
  const buffer = Buffer.from(bytes || []);
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "jpeg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "png";
  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")
  )
    return "gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brands = [
      buffer.subarray(8, 12).toString("ascii"),
      ...Array.from({ length: Math.floor(Math.max(0, buffer.length - 16) / 4) }, (_, index) =>
        buffer.subarray(16 + index * 4, 20 + index * 4).toString("ascii"),
      ),
    ];
    if (brands.some((brand) => ["avif", "avis", "mif1", "msf1"].includes(brand))) return "avif";
  }
  return "unknown";
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 1 >= buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker) && segmentLength >= 7) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(buffer) {
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer[24] + (buffer[25] << 8) + ((buffer[26] & 0x3f) << 16),
      height: 1 + buffer[27] + (buffer[28] << 8) + ((buffer[29] & 0x3f) << 16),
    };
  }
  if (chunk === "VP8L" && buffer.length >= 27 && buffer[21] === 0x2f) {
    return {
      width: 1 + (buffer[22] | (buffer[23] << 8) | ((buffer[24] & 0x3f) << 16)),
      height: 1 + ((buffer[24] >> 6) | (buffer[25] << 2) | ((buffer[26] & 0x0f) << 10)),
    };
  }
  if (chunk === "VP8 ") {
    for (let offset = 20; offset + 9 < buffer.length; offset += 1) {
      if (buffer[offset] === 0x9d && buffer[offset + 1] === 0x01 && buffer[offset + 2] === 0x2a) {
        return {
          width: buffer.readUInt16LE(offset + 3) & 0x3fff,
          height: buffer.readUInt16LE(offset + 5) & 0x3fff,
        };
      }
    }
  }
  return null;
}

function avifDimensions(buffer) {
  const marker = Buffer.from("ispe", "ascii");
  for (let offset = 0; offset + 12 < buffer.length; offset += 1) {
    if (!buffer.subarray(offset, offset + 4).equals(marker)) continue;
    const widthOffset = offset + 8;
    const heightOffset = offset + 12;
    if (heightOffset + 4 > buffer.length) continue;
    const width = buffer.readUInt32BE(widthOffset);
    const height = buffer.readUInt32BE(heightOffset);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

export function parseImageDimensions(bytes, format = detectImageFormat(bytes)) {
  const buffer = Buffer.from(bytes || []);
  if (format === "jpeg") return jpegDimensions(buffer);
  if (format === "png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (format === "gif" && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (format === "webp") return webpDimensions(buffer);
  if (format === "avif") return avifDimensions(buffer);
  return null;
}

function lastNonWhitespaceByte(buffer) {
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    if (![0x09, 0x0a, 0x0d, 0x20].includes(buffer[index])) return buffer[index];
  }
  return null;
}

function hasCompleteContainer(buffer, format) {
  if (format === "jpeg") return buffer.length >= 2 && lastNonWhitespaceByte(buffer) === 0xd9;
  if (format === "png") return buffer.includes(Buffer.from("IEND", "ascii"));
  if (format === "gif") return lastNonWhitespaceByte(buffer) === 0x3b;
  if (format === "webp" && buffer.length >= 8) return buffer.readUInt32LE(4) + 8 <= buffer.length;
  return true;
}

export function inspectImageBytes(bytes, { declaredWidth = null, declaredHeight = null } = {}) {
  const buffer = Buffer.from(bytes || []);
  const format = detectImageFormat(buffer);
  const dimensions = parseImageDimensions(buffer, format);
  const issues = [];
  if (!buffer.length) {
    issues.push({ code: "empty-image-body", severity: "error" });
  } else if (format === "unknown") {
    issues.push({ code: "unsupported-image-format", severity: "error" });
  } else if (!dimensions?.width || !dimensions?.height) {
    issues.push({ code: "unreadable-image-dimensions", severity: "error" });
  } else if (!hasCompleteContainer(buffer, format)) {
    issues.push({ code: "truncated-image-body", severity: "error" });
  }

  if (
    declaredWidth &&
    declaredHeight &&
    dimensions?.width &&
    dimensions?.height &&
    (declaredWidth !== dimensions.width || declaredHeight !== dimensions.height)
  ) {
    issues.push({
      code: "catalog-dimension-mismatch",
      severity: "warning",
      declaredWidth,
      declaredHeight,
      actualWidth: dimensions.width,
      actualHeight: dimensions.height,
    });
  }

  return {
    format,
    width: dimensions?.width || null,
    height: dimensions?.height || null,
    byteLength: buffer.length,
    issues,
  };
}

function imageQualityIssues({ width, height, byteLength, primary }) {
  if (!width || !height) return [];
  const issues = [];
  const shortSide = Math.min(width, height);
  const aspectRatio = Math.max(width, height) / Math.max(1, shortSide);
  if (shortSide < IMAGE_HEALTH_THRESHOLDS.minDimension) {
    issues.push({
      code: primary ? "primary-low-resolution" : "low-resolution",
      severity: primary ? "error" : "warning",
      width,
      height,
      shortSide,
      minimum: IMAGE_HEALTH_THRESHOLDS.minDimension,
    });
  }
  if (primary && shortSide < IMAGE_HEALTH_THRESHOLDS.primaryMinDimension) {
    issues.push({
      code: "primary-below-card-target",
      severity: "error",
      width,
      height,
      shortSide,
      target: IMAGE_HEALTH_THRESHOLDS.primaryMinDimension,
    });
  }
  if (aspectRatio > IMAGE_HEALTH_THRESHOLDS.maxAspectRatio) {
    issues.push({
      code: primary ? "primary-extreme-aspect-ratio" : "extreme-aspect-ratio",
      severity: primary ? "error" : "warning",
      width,
      height,
      aspectRatio: Number(aspectRatio.toFixed(3)),
      maximum: IMAGE_HEALTH_THRESHOLDS.maxAspectRatio,
    });
  }
  if (byteLength != null && byteLength < IMAGE_HEALTH_THRESHOLDS.suspiciouslySmallBytes) {
    issues.push({
      code: "suspiciously-small-image-body",
      severity: primary ? "error" : "warning",
      byteLength,
      minimum: IMAGE_HEALTH_THRESHOLDS.suspiciouslySmallBytes,
    });
  }
  return issues;
}

function pushUniqueIssue(issues, next) {
  const key = `${next.target || "image"}:${next.code}:${next.imageId || ""}:${next.variantId || ""}`;
  if (
    !issues.some(
      (issue) =>
        `${issue.target || "image"}:${issue.code}:${issue.imageId || ""}:${issue.variantId || ""}` ===
        key,
    )
  ) {
    issues.push(next);
  }
}

function imageStaticIssues(image, primary) {
  const issues = [];
  if (!image.id)
    pushUniqueIssue(issues, { code: "missing-media-id", severity: "error", target: "image" });
  if (!image.url) {
    pushUniqueIssue(issues, { code: "missing-image-url", severity: "error", target: "image" });
  } else {
    let parsedUrl = null;
    try {
      parsedUrl = new URL(image.url);
    } catch {
      pushUniqueIssue(issues, { code: "invalid-image-url", severity: "error", target: "image" });
    }
    if (parsedUrl && parsedUrl.protocol !== "https:") {
      pushUniqueIssue(issues, { code: "insecure-image-url", severity: "error", target: "image" });
    }
    if (parsedUrl && !isFutureLightImageUrl(image.url)) {
      pushUniqueIssue(issues, { code: "foreign-image-url", severity: "error", target: "image" });
    }
    if (
      /(?:placeholder|no[-_ ]?image|default[-_ ]?image|transparent)/i.test(
        parsedUrl?.pathname || image.url,
      )
    ) {
      pushUniqueIssue(issues, {
        code: "placeholder-image-url",
        severity: primary ? "error" : "warning",
        target: "image",
      });
    }
  }
  if (!image.alt)
    pushUniqueIssue(issues, { code: "missing-alt", severity: "warning", target: "image" });
  if (!image.width || !image.height) {
    pushUniqueIssue(issues, {
      code: "missing-image-dimensions",
      severity: "warning",
      target: "image",
    });
  }
  return issues;
}

function imageIssueWithContext(issue, image) {
  return {
    ...issue,
    imageId: image.id || null,
    imageIndex: image.index,
    url: image.url || null,
  };
}

export function buildImageAudit(image, { primary = false, probe = null } = {}) {
  const issues = imageStaticIssues(image, primary);
  const effectiveWidth = probe?.width || image.width;
  const effectiveHeight = probe?.height || image.height;
  const quality = imageQualityIssues({
    width: effectiveWidth,
    height: effectiveHeight,
    byteLength: probe?.byteLength,
    primary,
  });
  for (const issue of quality) pushUniqueIssue(issues, imageIssueWithContext(issue, image));

  if (probe?.status === "http-error") {
    pushUniqueIssue(
      issues,
      imageIssueWithContext(
        {
          code: "image-http-error",
          severity: probe.retryable ? "warning" : "error",
          httpStatus: probe.httpStatus || null,
          retryable: Boolean(probe.retryable),
        },
        image,
      ),
    );
  } else if (probe?.status === "probe-error") {
    const probeErrorCode = normalizeText(probe.errorCode);
    const probeIssueCode =
      probeErrorCode === "RESPONSE_TOO_LARGE" ? "image-response-too-large" : "image-probe-error";
    pushUniqueIssue(
      issues,
      imageIssueWithContext(
        {
          code: probeIssueCode,
          severity: probe.retryable ? "warning" : "error",
          error: normalizeText(probe.error || "image probe failed").slice(0, 240),
          errorCode: probeErrorCode || null,
          retryable: Boolean(probe.retryable),
        },
        image,
      ),
    );
  } else if (probe?.status === "redirected-out-of-scope") {
    pushUniqueIssue(
      issues,
      imageIssueWithContext(
        {
          code: "image-redirected-out-of-scope",
          severity: "error",
          finalUrl: probe.finalUrl || null,
        },
        image,
      ),
    );
  } else if (probe?.status === "ok") {
    for (const issue of asArray(probe.issues))
      pushUniqueIssue(issues, imageIssueWithContext(issue, image));
    if (probe.contentType && !/^image\//i.test(probe.contentType)) {
      pushUniqueIssue(
        issues,
        imageIssueWithContext(
          {
            code: "non-image-content-type",
            severity: "error",
            contentType: probe.contentType,
          },
          image,
        ),
      );
    }
  }

  const blocking = issues.some((issue) => ["error", "critical"].includes(issue.severity));
  const retryable = issues.some((issue) => issue.retryable === true);
  return {
    ...image,
    primary,
    probe: probe
      ? {
          status: probe.status,
          httpStatus: probe.httpStatus || null,
          contentType: probe.contentType || null,
          byteLength: probe.byteLength ?? null,
          format: probe.format || null,
          width: probe.width || null,
          height: probe.height || null,
          errorCode: probe.errorCode || null,
          retryable: Boolean(probe.retryable),
          error: probe.error ? normalizeText(probe.error).slice(0, 240) : null,
          checkedAt: probe.checkedAt || null,
        }
      : { status: "not-probed" },
    effectiveWidth: effectiveWidth || null,
    effectiveHeight: effectiveHeight || null,
    issues: issues.map((issue) => imageIssueWithContext(issue, image)),
    blocking,
    retryable,
  };
}

function variantHasImageAssociation(variant, images) {
  const identities = new Set([
    ...imageIdIdentities(variant?.id),
    ...imageIdIdentities(variant?.legacyResourceId),
  ]);
  return images.some((image) =>
    image.variantIds.some(
      (id) => identities.has(id) || imageIdIdentities(id).some((entry) => identities.has(entry)),
    ),
  );
}

function repairActionForIssue(issue) {
  if (issue.code === "missing-alt") return { action: "metadata-alt-review", priority: "low" };
  if (
    [
      "broken-variant-association",
      "missing-variant-image-association",
      "variant-image-url-not-in-product-media",
      "variant-points-to-unhealthy-image",
    ].includes(issue.code)
  ) {
    return { action: "variant-association-review", priority: "medium" };
  }
  if (issue.code === "missing-media-id")
    return { action: "live-media-reconciliation", priority: "high" };
  return {
    action: "approved-media-replacement-review",
    priority: issue.severity === "error" ? "high" : "medium",
  };
}

function buildRepairCandidates(product, issues) {
  const candidates = [];
  for (const issue of issues) {
    if (issue.code === "missing-image-dimensions" || issue.code === "catalog-dimension-mismatch")
      continue;
    if (issue.code === "image-probe-error") continue;
    const { action, priority } = repairActionForIssue(issue);
    candidates.push({
      key: `${productKey(product)}:${issue.imageId || issue.imageIndex || issue.variantId || "product"}:${issue.code}`,
      productId: normalizeText(product?.id),
      handle: normalizeText(product?.handle),
      title: normalizeText(product?.title),
      imageId: issue.imageId || null,
      imageIndex: issue.imageIndex ?? null,
      variantId: issue.variantId || null,
      url: issue.url || null,
      issueCode: issue.code,
      severity: issue.severity,
      priority,
      action,
      status: "queued",
      automaticAction: "none",
      requiresApprovedSource: true,
      reason:
        "The health audit found a deterministic image or association defect; supply and approve a replacement or metadata correction before any Shopify mutation.",
    });
  }
  return candidates;
}

export function buildProductImageAudit(product, { probes = new Map(), maxImages = 100 } = {}) {
  const rawImages = asArray(product?.images);
  const images = rawImages.map(normalizeImageRecord);
  const auditedImages = images.slice(0, Math.max(1, maxImages));
  const issues = [];
  if (!images.length) {
    issues.push({
      code: "missing-product-image",
      severity: "critical",
      target: "product",
      productId: normalizeText(product?.id),
      handle: normalizeText(product?.handle),
    });
  }
  if (images.length > auditedImages.length) {
    issues.push({
      code: "image-audit-bounded",
      severity: "warning",
      target: "product",
      imageCount: images.length,
      auditedImageCount: auditedImages.length,
      maxImages,
    });
  }

  const imageAudits = auditedImages.map((image, index) => {
    const key = canonicalImageUrl(image.url);
    const audit = buildImageAudit(image, {
      primary: index === 0,
      probe: key ? probes.get(image.url) || probes.get(key) || null : null,
    });
    for (const issue of audit.issues) issues.push(issue);
    return audit;
  });

  const primary = imageAudits[0];
  if (primary?.blocking) {
    issues.push({
      code: "primary-image-unusable",
      severity: "critical",
      target: "product",
      imageId: primary.id || null,
      imageIndex: primary.index,
      url: primary.url || null,
    });
  }

  const imageIdentitySet = new Set(images.flatMap((image) => imageIdIdentities(image.id)));
  const imageUrlSet = new Set(images.map((image) => canonicalImageUrl(image.url)).filter(Boolean));
  const variantAudits = asArray(product?.variants).map((variant) => {
    const reference = variantImageReference(variant);
    const variantId = normalizeText(variant?.id || variant?.legacyResourceId);
    const variantIssues = [];
    // Shopify can expose a legacy ProductImage ID on a variant while the
    // product media connection exposes the newer MediaImage ID. When the
    // exact CDN URL is present in this product's media, that URL is stronger
    // association evidence than the legacy ID and must not be reported as a
    // broken mapping. A URL that is absent from the product media still
    // remains a real association error.
    const referenceUrl = canonicalImageUrl(reference.url);
    const urlMatchesProductMedia = Boolean(referenceUrl && imageUrlSet.has(referenceUrl));
    if (
      reference.id &&
      !imageIdIdentities(reference.id).some((identity) => imageIdentitySet.has(identity)) &&
      !urlMatchesProductMedia
    ) {
      variantIssues.push({
        code: "broken-variant-association",
        severity: "error",
        target: "variant",
        variantId,
        mediaId: reference.id,
      });
    }
    if (reference.url && !imageUrlSet.has(canonicalImageUrl(reference.url))) {
      variantIssues.push({
        code: "variant-image-url-not-in-product-media",
        severity: "error",
        target: "variant",
        variantId,
        variantImageUrl: reference.url,
      });
    }
    if (
      !reference.id &&
      !reference.url &&
      asArray(product?.variants).length > 1 &&
      !variantHasImageAssociation(variant, images)
    ) {
      variantIssues.push({
        code: "missing-variant-image-association",
        severity: "warning",
        target: "variant",
        variantId,
      });
    }
    const referencedImageById = reference.id
      ? imageAudits.find((image) =>
          imageIdIdentities(image.id).some((identity) =>
            imageIdIdentities(reference.id).includes(identity),
          ),
        )
      : null;
    const referencedImageByUrl = referenceUrl
      ? imageAudits.find((image) => canonicalImageUrl(image.url) === referenceUrl)
      : null;
    const referencedImage = referencedImageById || referencedImageByUrl;
    if (referencedImage?.blocking) {
      variantIssues.push({
        code: "variant-points-to-unhealthy-image",
        severity: "error",
        target: "variant",
        variantId,
        imageId: referencedImage.id || null,
      });
    }
    for (const issue of variantIssues) issues.push(issue);
    return {
      variantId,
      imageId: reference.id || null,
      imageUrl: reference.url || null,
      issues: variantIssues,
    };
  });

  const uniqueIssues = [];
  for (const issue of issues) pushUniqueIssue(uniqueIssues, issue);
  const repairQueue = buildRepairCandidates(product, uniqueIssues);
  const needsRetry = imageAudits.some((image) => image.retryable);
  const blocking = uniqueIssues.some((issue) => ["critical", "error"].includes(issue.severity));
  const status = needsRetry
    ? "needs-retry"
    : blocking
      ? "repair-required"
      : uniqueIssues.length
        ? "review"
        : "healthy";

  return {
    key: productKey(product),
    productId: normalizeText(product?.id),
    handle: normalizeText(product?.handle),
    title: normalizeText(product?.title),
    vendor: normalizeText(product?.vendor),
    imageCount: images.length,
    auditedImageCount: imageAudits.length,
    variantCount: asArray(product?.variants).length,
    imageAudits,
    variantAudits,
    issues: uniqueIssues,
    repairQueue,
    status,
    completed: !needsRetry,
    needsRetry,
  };
}

export function productCatalogFingerprint(products) {
  const material = asArray(products)
    .map((product) => ({
      id: normalizeText(product?.id),
      handle: normalizeText(product?.handle).toLowerCase(),
      vendor: normalizeText(product?.vendor),
      updatedAt: normalizeText(product?.updated_at || product?.updatedAt),
      images: asArray(product?.images).map((image) => ({
        id: normalizeText(image?.id),
        url: canonicalImageUrl(imageUrlFromRecord(image)),
        width: image?.width ?? null,
        height: image?.height ?? null,
        alt: normalizeText(image?.alt || image?.altText),
        variantIds: asArray(image?.variant_ids || image?.variantIds)
          .map((value) => normalizeText(value))
          .filter(Boolean),
        position: image?.position ?? null,
      })),
      variants: asArray(product?.variants).map((variant) => ({
        id: normalizeText(variant?.id || variant?.legacyResourceId),
        imageId: normalizeText(
          variant?.image_id || variant?.imageId || variant?.featured_image?.id,
        ),
        imageUrl: canonicalImageUrl(
          variant?.featured_image?.src || variant?.featured_image?.url || "",
        ),
        mediaIds: [
          ...asArray(variant?.media?.nodes),
          ...asArray(variant?.media?.edges).map((edge) => edge?.node),
        ]
          .map((node) => normalizeText(node?.id))
          .filter(Boolean)
          .sort(),
      })),
    }))
    .sort((left, right) =>
      `${left.id}:${left.handle}`.localeCompare(`${right.id}:${right.handle}`),
    );
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

export function buildRepairQueue(audits) {
  const byKey = new Map();
  for (const audit of asArray(audits)) {
    for (const candidate of asArray(audit?.repairQueue)) {
      if (!byKey.has(candidate.key)) byKey.set(candidate.key, candidate);
    }
  }
  return [...byKey.values()].sort((left, right) => {
    const priority = { critical: 0, high: 1, medium: 2, low: 3 };
    return (
      (priority[left.priority] ?? 9) - (priority[right.priority] ?? 9) ||
      String(left.handle).localeCompare(String(right.handle)) ||
      String(left.issueCode).localeCompare(String(right.issueCode))
    );
  });
}
