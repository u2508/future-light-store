export type MarketingConsentPurpose = "analytics" | "advertising";
export type MarketingConsentSource = "standalone" | "shopify";

export type MarketingConsentSnapshot = {
  analytics: boolean;
  advertising: boolean;
  explicit: boolean;
  source: MarketingConsentSource;
  ready: boolean;
};

export type MarketingConsentPreferences = Pick<
  MarketingConsentSnapshot,
  "analytics" | "advertising"
>;

export const MARKETING_CONSENT_STORAGE_KEY: string;
export const MARKETING_CONSENT_VERSION: number;
export function deniedMarketingConsent(
  source?: MarketingConsentSource,
  ready?: boolean,
): MarketingConsentSnapshot;
export function normalizeMarketingPreferences(value: unknown): MarketingConsentPreferences;
export function parseStoredMarketingConsent(raw: unknown): MarketingConsentSnapshot | null;
export function serializeMarketingConsent(value: unknown): string;
export function persistStandaloneMarketingConsent(
  storage: { setItem?: (key: string, value: string) => void } | null | undefined,
  preferences: unknown,
): boolean;
export function canProcessMarketingPurpose(
  consent: MarketingConsentSnapshot | null | undefined,
  purpose: MarketingConsentPurpose,
): boolean;
