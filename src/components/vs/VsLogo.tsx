import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function VsLogo({ className, inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <Link
      to="/"
      className={cn("group flex items-center gap-2.5", className)}
      aria-label="VS Associates home"
    >
      <img
        src="/brand/vs-associates-monogram.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-10 w-10 shrink-0 object-contain sm:h-11 sm:w-11"
      />
      <span className="hidden flex-col leading-none sm:flex">
        <span
          className={cn(
            "font-display text-lg font-bold tracking-tight",
            inverse && "text-background",
          )}
        >
          VS Associates
        </span>
      </span>
    </Link>
  );
}
