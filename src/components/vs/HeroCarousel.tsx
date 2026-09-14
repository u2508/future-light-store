import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

export interface HeroSlide {
  handle: string;
  eyebrow: string;
  title: string;
  copy: string;
  cta?: string;
  image?: string | undefined;
  imageSrcSet?: string | undefined;
}

export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const count = slides.length;
  const current = count ? index % count : 0;
  const slide = slides[current];
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!playing || interacting || reducedMotion || count < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), 3800);
    return () => window.clearInterval(timer);
  }, [playing, interacting, reducedMotion, count]);
  if (!slide) return null;
  const go = (offset: number) => setIndex((current + offset + count) % count);
  const control =
    "grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/30 text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  return (
    <section
      className="vs-wide-shell pt-3 sm:pt-5"
      aria-roledescription="carousel"
      aria-label="Featured collections carousel"
      onPointerEnter={() => setInteracting(true)}
      onPointerLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setInteracting(false);
      }}
    >
      <div className="vs-cinematic-hero relative isolate overflow-hidden rounded-[1.5rem] bg-[#090b10] text-white sm:rounded-[2rem]">
        {slide.image && (
          <img
            key={slide.handle}
            src={slide.image}
            srcSet={slide.imageSrcSet}
            sizes="(min-width: 1440px) 1392px, 100vw"
            alt=""
            width={1536}
            height={1024}
            fetchPriority="high"
            className="vs-cinematic-image absolute inset-0 -z-20 h-full w-full object-cover"
          />
        )}
        <div className="vs-cinematic-shade absolute inset-0 -z-10" />
        <div className="vs-cinematic-copy relative flex min-h-[580px] flex-col justify-end px-6 pb-24 pt-72 sm:min-h-[560px] sm:justify-center sm:px-16 sm:pb-24 sm:pt-16 lg:px-20">
          <p className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_12px_#a5f3fc]" />
            {slide.eyebrow}
          </p>
          <div
            aria-live={playing && !interacting && !reducedMotion ? "off" : "polite"}
            aria-atomic="true"
          >
            <h1 className="max-w-[540px] text-[clamp(2.6rem,5.1vw,4.7rem)] font-medium leading-[1.02] tracking-[-0.055em]">
              {slide.title}
            </h1>
            <p className="mt-5 max-w-[330px] text-sm leading-6 text-white/75 sm:text-base">
              {slide.copy}
            </p>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-5">
            <Link
              to="/collections/$handle"
              params={{ handle: slide.handle }}
              className="inline-flex min-h-12 items-center gap-4 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#11131a] transition-colors hover:bg-cyan-100"
            >
              {slide.cta || "Explore the edit"}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              to="/shop"
              className="py-3 text-sm text-white/85 underline decoration-white/35 underline-offset-4 hover:text-white"
            >
              Shop all
            </Link>
          </div>
        </div>
        <div className="absolute inset-x-6 bottom-5 flex items-center justify-between gap-3 sm:inset-x-16 sm:bottom-6 lg:inset-x-20">
          <div
            className="flex items-center sm:gap-1"
            role="group"
            aria-label="Choose featured collection"
          >
            {slides.map((item, i) => (
              <button
                key={item.handle}
                type="button"
                aria-label={`Show ${item.eyebrow}`}
                aria-pressed={i === current}
                onClick={() => setIndex(i)}
                className="grid h-11 w-11 place-items-center"
              >
                <span
                  className={`h-[2px] w-7 transition-colors ${i === current ? "bg-white" : "bg-white/30"}`}
                />
              </button>
            ))}
            <span className="ml-3 hidden whitespace-nowrap text-[10px] tabular-nums tracking-widest text-white/60 sm:inline">
              {String(current + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
            </span>
          </div>
          <div className="flex gap-2">
            {!reducedMotion && count > 1 && (
              <button
                type="button"
                className={control + " hidden sm:grid"}
                onClick={() => setPlaying((v) => !v)}
                aria-label={
                  playing ? "Pause automatic slide rotation" : "Start automatic slide rotation"
                }
                aria-pressed={playing}
              >
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              type="button"
              disabled={count < 2}
              className={control}
              aria-label="Previous collection banner"
              onClick={() => go(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={count < 2}
              className={control}
              aria-label="Next collection banner"
              onClick={() => go(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
