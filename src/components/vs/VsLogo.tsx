import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function VsLogo({ className, inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <Link
      to="/"
      className={cn("group flex items-center gap-2.5", className)}
      aria-label="VS Store home"
    >
      <span
        className={cn(
          "relative grid h-9 w-9 place-items-center rounded-xl vs-hero-gradient text-primary-foreground shadow-[var(--shadow-card)]",
          inverse ? "ring-2 ring-background" : "",
        )}
      >
        <span className="font-display text-[15px] font-bold tracking-tight">VS</span>
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-signal ring-2 ring-card" />
      </span>
      <span className="hidden flex-col leading-none sm:flex">
        <span
          className={cn(
            "font-display text-lg font-bold tracking-tight",
            inverse && "text-background",
          )}
        >
          VS STORE
        </span>
        <span
          className={cn(
            "text-[10px] uppercase tracking-[0.22em] text-muted-foreground",
            inverse && "text-background/60",
          )}
        >
          Future Retail
        </span>
      </span>
    </Link>
  );
}
