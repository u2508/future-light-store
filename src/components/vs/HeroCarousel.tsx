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
  const [isPointerHovering, setIsPointerHovering] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [isPausedByUser, setIsPausedByUser] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const count = slides.length;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPaused = isPointerHovering || isFocusWithin || isPausedByUser;
  const isAutoRotating = count > 1 && !prefersReducedMotion && !isPaused;
  const previousIndex = count > 0 ? (index - 1 + count) % count : 0;
  const nextIndex = count > 0 ? (index + 1) % count : 0;

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  useEffect(() => {
    if (!isAutoRotating) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % count), 5500);
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [isAutoRotating, count]);

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
      className="mx-auto max-w-7xl px-3 pt-3 sm:px-4 sm:pt-6"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured collections carousel"
      onPointerEnter={() => setIsPointerHovering(true)}
      onPointerLeave={() => setIsPointerHovering(false)}
      onPointerCancel={() => setIsPointerHovering(false)}
      onFocusCapture={() => setIsFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocusWithin(false);
        }
      }}
    >
      <div className="relative overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-[var(--shadow-lift)] sm:rounded-[2rem]">
        <button
          type="button"
          aria-label={
            isPausedByUser ? "Resume automatic slide rotation" : "Pause automatic slide rotation"
          }
          aria-pressed={isPausedByUser}
          aria-controls="hero-carousel-slides"
          onClick={() => setIsPausedByUser((paused) => !paused)}
          className="absolute bottom-3 right-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-border bg-card/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card sm:bottom-4 sm:right-5"
        >
          {isPausedByUser ? (
            <Play className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Pause className="h-4 w-4" aria-hidden="true" />
          )}
        </button>

        <div
          id="hero-carousel-slides"
          className={`flex ${prefersReducedMotion ? "" : "transition-transform duration-700 ease-out"}`}
          aria-live={isAutoRotating ? "off" : "polite"}
          style={{ transform: `translate3d(-${index * 100}%, 0, 0)` }}
        >
          {slides.map((slide, i) => (
            <article
              key={slide.handle}
              id={`hero-carousel-slide-${i + 1}`}
              className="relative w-full shrink-0"
              role="group"
              aria-hidden={i !== index}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}: ${slide.title}`}
            >
              <img
                src={slide.image || heroImage}
                alt={slide.title}
                width={1600}
                height={1104}
                loading={i === 0 ? "eager" : "lazy"}
                className="h-[390px] w-full object-cover sm:h-[520px]"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(245,247,252,0.04)_20%,rgba(245,247,252,0.78)_64%,rgba(245,247,252,0.98)_100%)] sm:bg-[linear-gradient(90deg,rgba(245,247,252,0.97)_0%,rgba(245,247,252,0.86)_38%,rgba(245,247,252,0.24)_70%,rgba(245,247,252,0.04)_100%)]" />
              <div className="absolute inset-0 flex flex-col justify-end gap-3 p-5 pb-16 sm:justify-center sm:gap-5 sm:p-14 sm:pb-14 lg:p-16">
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/60 bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground shadow-sm backdrop-blur sm:text-[11px] sm:tracking-[0.28em]">
                  <Sparkles className="h-3 w-3" /> {slide.eyebrow}
                </span>
                <h2 className="max-w-xl font-display text-2xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
                  {slide.title}
                </h2>
                <p className="max-w-md text-xs leading-5 text-muted-foreground sm:text-base sm:leading-6">
                  {slide.copy}
                </p>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                  <Link
                    to="/collections/$handle"
                    params={{ handle: slide.handle }}
                    tabIndex={i === index ? 0 : -1}
                    className="inline-flex w-full items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_12px_30px_rgba(38,88,190,0.28)] transition-transform hover:-translate-y-0.5 sm:w-fit sm:px-6"
                  >
                    Shop this edit
                  </Link>
                  <Link
                    to="/shop"
                    tabIndex={i === index ? 0 : -1}
                    className="inline-flex w-full items-center justify-center rounded-full border border-border bg-white/70 px-5 py-3 text-sm font-semibold text-foreground backdrop-blur transition-colors hover:border-primary hover:bg-white sm:w-fit sm:px-6"
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
          aria-label={`Previous slide, ${previousIndex + 1} of ${count}: ${slides[previousIndex]?.title}`}
          aria-controls="hero-carousel-slides"
          disabled={count < 2}
          onClick={() => go(index - 1)}
          className="absolute left-3 top-5 grid h-9 w-9 place-items-center rounded-full border border-border bg-card/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card sm:top-1/2 sm:h-10 sm:w-10 sm:-translate-y-1/2"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Next slide, ${nextIndex + 1} of ${count}: ${slides[nextIndex]?.title}`}
          aria-controls="hero-carousel-slides"
          disabled={count < 2}
          onClick={() => go(index + 1)}
          className="absolute right-3 top-5 grid h-9 w-9 place-items-center rounded-full border border-border bg-card/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-card sm:top-1/2 sm:h-10 sm:w-10 sm:-translate-y-1/2"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
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
              aria-label={`Show slide ${i + 1} of ${count}: ${slide.title}`}
              aria-controls={`hero-carousel-slide-${i + 1}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => go(i)}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-8 bg-primary" : "w-3 bg-foreground/20 hover:bg-foreground/40"}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
