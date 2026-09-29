const FORMER_TRADING_LABEL = "vs store";

/** Normalize only the company's former display label, leaving product brands intact. */
export function displayBrandName(value?: string | null) {
  const label = value?.trim() ?? "";
  return label.toLowerCase() === FORMER_TRADING_LABEL ? "VS Associates" : label;
}
