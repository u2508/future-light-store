type TikTokQueue = {
  (command: string, ...args: unknown[]): void;
  _i?: Record<string, unknown>;
  _o?: Record<string, unknown>;
  load?: (id: string, options?: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    ttq?: TikTokQueue;
  }
}

let initializedPixelId: string | null = null;

export function initializeTikTokPixel(pixelId = import.meta.env.VITE_TIKTOK_PIXEL_ID): void {
  if (typeof window === "undefined" || !pixelId || initializedPixelId === pixelId) return;

  const queue =
    window.ttq ??
    (((...args: unknown[]) => {
      (queue._o ??= {})[String(args[0])] = args.slice(1);
    }) as TikTokQueue);

  queue._i = { ...(queue._i ?? {}), [pixelId]: true };
  queue.load = (id, options = {}) => {
    queue._i = { ...(queue._i ?? {}), [id]: options };
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(id)}&lib=ttq`;
    document.head.appendChild(script);
  };

  window.ttq = queue;
  queue.load(pixelId);
  queue("page");
  initializedPixelId = pixelId;
}

export function trackTikTokEvent(event: string, properties?: Record<string, unknown>): void {
  window.ttq?.("track", event, properties);
}
