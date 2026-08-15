import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function VsLogo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("group flex items-center gap-2.5", className)} aria-label="VS Store home">
      <span className="relative grid h-9 w-9 place-items-center rounded-xl vs-hero-gradient text-primary-foreground shadow-[var(--shadow-card)]">
        <span className="font-display text-[15px] font-bold tracking-tight">VS</span>
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-signal ring-2 ring-card" />
      </span>
      <span className="hidden flex-col leading-none sm:flex">
        <span className="font-display text-lg font-bold tracking-tight">VS STORE</span>
        <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Future Retail</span>
      </span>
    </Link>
  );
}
