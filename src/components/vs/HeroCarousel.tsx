import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Pause, Play, Sparkles } from "lucide-react";
import heroImage from "@/assets/vs-hero.jpg";

export interface HeroSlide {
  handle: string;
  eyebrow: string;
  title: string;
  copy: string;
  image?: string | undefined;
}

export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isPausedByUser, setIsPausedByUser] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const count = slides.length;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPaused = isHovering || isFocused || isPausedByUser;

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  useEffect(() => {
    if (isPaused || prefersReducedMotion || count < 2) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % count), 5500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [isPaused, prefersReducedMotion, count]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  if (count === 0) return null;

  return (
    <section
      className="mx-auto max-w-7xl px-4 pt-6"
      aria-roledescription="carousel"
      aria-label="Featured collections carousel"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFocused(false);
      }}
    >
      <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-card shadow-[var(--shadow-lift)]">
        <div
          id="hero-carousel-slides"
          className={`flex ${prefersReducedMotion ? "" : "transition-transform duration-700 ease-out"}`}
          aria-live={isPaused ? "polite" : "off"}
          style={{ transform: `translate3d(-${index * 100}%, 0, 0)` }}
        >
          {slides.map((slide, i) => (
            <article
              key={slide.handle}
              className="relative w-full shrink-0"
              role="group"
              aria-hidden={i !== index}
              aria-roledescription="slide"
              aria-label={`Slide ${i + 1} of ${count}: ${slide.title}`}
            >
              <img
                src={slide.image || heroImage}
                alt={slide.title}
                width={1600}
                height={1104}
                loading={i === 0 ? "eager" : "lazy"}
                className="h-[420px] w-full object-cover sm:h-[520px]"
              />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(245,247,252,0.97)_0%,rgba(245,247,252,0.86)_38%,rgba(245,247,252,0.24)_70%,rgba(245,247,252,0.04)_100%)]" />
              <div className="absolute inset-0 flex flex-col justify-center gap-5 p-7 sm:p-14 lg:p-16">
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/60 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-foreground shadow-sm backdrop-blur">
                  <Sparkles className="h-3 w-3" /> {slide.eyebrow}
                </span>
                <h2 className="max-w-xl font-display text-3xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
                  {slide.title}
                </h2>
                <p className="max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
                  {slide.copy}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    to="/collections/$handle"
                    params={{ handle: slide.handle }}
                    tabIndex={i === index ? 0 : -1}
                    className="inline-flex w-fit items-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_12px_30px_rgba(38,88,190,0.28)] transition-transform hover:-translate-y-0.5"
                  >
                    Shop this edit
                  </Link>
                  <Link
                    to="/shop"
                    tabIndex={i === index ? 0 : -1}
                    className="inline-flex w-fit items-center rounded-full border border-border bg-white/70 px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition-colors hover:border-primary hover:bg-white"
                  >
                    Explore the catalog
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>

        <button
          type="button"
          aria-label="Previous slide"
          aria-controls="hero-carousel-slides"
          onClick={() => go(index - 1)}
          className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-card/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Next slide"
          aria-controls="hero-carousel-slides"
          onClick={() => go(index + 1)}
          className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-card/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <div
          className="absolute bottom-5 left-7 flex items-center gap-2 sm:left-14"
          role="group"
          aria-label="Choose featured collection slide"
        >
          {slides.map((slide, i) => (
            <button
              key={slide.handle}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              onClick={() => go(i)}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-8 bg-primary" : "w-3 bg-foreground/20 hover:bg-foreground/40"}`}
            />
          ))}
        </div>

        <button
          type="button"
          aria-label={
            isPausedByUser ? "Resume automatic slide rotation" : "Pause automatic slide rotation"
          }
          aria-pressed={isPausedByUser}
          aria-controls="hero-carousel-slides"
          onClick={() => setIsPausedByUser((paused) => !paused)}
          className="absolute bottom-3 right-4 grid h-9 w-9 place-items-center rounded-full border border-border bg-card/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card sm:bottom-4 sm:right-5"
        >
          {isPausedByUser ? (
            <Play className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Pause className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        Slide {index + 1} of {count}: {slides[index]?.title}
      </p>
    </section>
  );
}
