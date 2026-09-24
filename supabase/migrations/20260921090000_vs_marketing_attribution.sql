ALTER TABLE public.shopify_orders
  ADD COLUMN IF NOT EXISTS marketing_attribution jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.shopify_orders.marketing_attribution IS
  'First-party UTM and click-id attributes copied from the Shopify cart; no customer PII.';
