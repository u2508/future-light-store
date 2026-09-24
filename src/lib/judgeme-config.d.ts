export interface JudgeMeRuntimeConfig {
  widgetScriptUrl: string;
  shopReviewsCount: number;
}

export function normalizeJudgeMeRuntimeConfig(value: unknown): JudgeMeRuntimeConfig | null;
export function parseShopifyProductNumericId(value: unknown): string | null;
