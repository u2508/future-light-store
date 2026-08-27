import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/finance")({
  head: () => ({
    meta: [
      { title: "Finance — VS Admin" },
      {
        name: "description",
        content: "VS Store finance workspace: P&L, refunds, chargebacks and reconciliation.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

export async function callAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("shopify-admin", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}
