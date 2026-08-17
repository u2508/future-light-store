
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','staff','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE TABLE IF NOT EXISTS public.shopify_orders (
  id text PRIMARY KEY,
  order_number text,
  name text,
  email text,
  currency text NOT NULL DEFAULT 'USD',
  processed_at timestamptz,
  total_price numeric NOT NULL DEFAULT 0,
  subtotal_price numeric NOT NULL DEFAULT 0,
  total_tax numeric NOT NULL DEFAULT 0,
  total_shipping numeric NOT NULL DEFAULT 0,
  total_discounts numeric NOT NULL DEFAULT 0,
  total_refunded numeric NOT NULL DEFAULT 0,
  financial_status text,
  fulfillment_status text,
  cancelled_at timestamptz,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  fulfillments jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shopify_orders TO authenticated;
GRANT ALL ON public.shopify_orders TO service_role;
ALTER TABLE public.shopify_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read orders" ON public.shopify_orders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
CREATE INDEX IF NOT EXISTS shopify_orders_processed_at_idx ON public.shopify_orders (processed_at DESC);
CREATE INDEX IF NOT EXISTS shopify_orders_email_idx ON public.shopify_orders (lower(email));

CREATE TABLE IF NOT EXISTS public.shopify_refunds (
  id text PRIMARY KEY,
  order_id text,
  kind text NOT NULL DEFAULT 'refund',
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  reason text,
  processed_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shopify_refunds TO authenticated;
GRANT ALL ON public.shopify_refunds TO service_role;
ALTER TABLE public.shopify_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read refunds" ON public.shopify_refunds FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

CREATE TABLE IF NOT EXISTS public.shopify_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  shopify_id text,
  status text NOT NULL DEFAULT 'received',
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shopify_webhook_events TO authenticated;
GRANT ALL ON public.shopify_webhook_events TO service_role;
ALTER TABLE public.shopify_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read webhook events" ON public.shopify_webhook_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
