CREATE TABLE IF NOT EXISTS public.shopify_webhook_receipts (
  dedupe_key text PRIMARY KEY,
  topic text NOT NULL,
  shopify_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.shopify_webhook_receipts TO authenticated;
GRANT ALL ON public.shopify_webhook_receipts TO service_role;
ALTER TABLE public.shopify_webhook_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read webhook receipts" ON public.shopify_webhook_receipts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
CREATE INDEX IF NOT EXISTS shopify_webhook_receipts_updated_at_idx
  ON public.shopify_webhook_receipts (updated_at DESC);
