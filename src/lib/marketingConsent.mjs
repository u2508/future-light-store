export const MARKETING_CONSENT_STORAGE_KEY = "vs-store-consent-v1";
export const MARKETING_CONSENT_VERSION = 1;

export function deniedMarketingConsent(source = "standalone", ready = true) {
  return {
    analytics: false,
    advertising: false,
    explicit: false,
    source,
    ready,
  };
}

export function normalizeMarketingPreferences(value) {
  return {
    analytics: value?.analytics === true,
    advertising: value?.advertising === true,
  };
}

export function parseStoredMarketingConsent(raw) {
  if (typeof raw !== "string" || !raw) return null;

  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      value.version !== MARKETING_CONSENT_VERSION ||
      value.explicit !== true ||
      typeof value.analytics !== "boolean" ||
      typeof value.advertising !== "boolean"
    ) {
      return null;
    }

    return {
      analytics: value.analytics,
      advertising: value.advertising,
      explicit: true,
      source: "standalone",
      ready: true,
    };
  } catch {
    return null;
  }
}

export function serializeMarketingConsent(preferences) {
  const normalized = normalizeMarketingPreferences(preferences);
  return JSON.stringify({
    version: MARKETING_CONSENT_VERSION,
    explicit: true,
    ...normalized,
    updatedAt: new Date().toISOString(),
  });
}

export function persistStandaloneMarketingConsent(storage, preferences) {
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem(MARKETING_CONSENT_STORAGE_KEY, serializeMarketingConsent(preferences));
    return true;
  } catch {
    return false;
  }
}

export function canProcessMarketingPurpose(consent, purpose) {
  if (!consent || consent.ready !== true) return false;
  if (consent.source === "shopify") return consent[purpose] === true;
  if (consent.source !== "standalone" || consent.explicit !== true) return false;
  return consent[purpose] === true;
}
