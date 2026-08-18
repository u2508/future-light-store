import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/shopify";

interface FinanceChartProps {
  currency: string;
  data: Array<{ date: string; net: number }>;
}

export default function FinanceChart({ data, currency }: FinanceChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={60} />
        <Tooltip formatter={(value: number) => formatMoney(value, currency)} />
        <Area type="monotone" dataKey="net" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
