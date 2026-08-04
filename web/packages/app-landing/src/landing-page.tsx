"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crop,
  Image as ImageIcon,
  Layers3,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Video,
  WandSparkles,
} from "lucide-react";
import { Button } from "@higgsfield/quanta/button";
import { Icon } from "@higgsfield/quanta/icon";
import { Media } from "@higgsfield/quanta/media";
import { Typography } from "@higgsfield/quanta/typography";
import type {
  LandingContent,
  LandingIconName,
  LandingMedia as LandingMediaContent,
} from "./schema";

const ICONS = {
  check: Check,
  clock: Clock3,
  frame: Crop,
  image: ImageIcon,
  layers: Layers3,
  shield: ShieldCheck,
  sliders: SlidersHorizontal,
  sparkles: Sparkles,
  video: Video,
  wand: WandSparkles,
} satisfies Record<LandingIconName, typeof Check>;

const STUDIO_HERO_GLOW =
  "radial-gradient(60% 80% at 50% 0%, rgba(160,164,170,0.14) 0%, rgba(160,164,170,0.05) 42%, transparent 72%)";
const STUDIO_HERO_DOTS = "radial-gradient(rgba(255,255,255,0.2) 1px, transparent 1px)";
const STUDIO_HERO_DOTS_MASK =
  "radial-gradient(55% 70% at 50% 0%, #000 0%, rgba(0,0,0,0.35) 45%, transparent 75%)";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function LandingMedia({
  media,
  eager = false,
  className,
}: {
  media: LandingMediaContent;
  eager?: boolean;
  className?: string;
}) {
  return (
    <Media ratio="video" rounded="lg" className={classes("h-full w-full", className)}>
      {media.kind === "image" ? (
        <Media.Image
          src={media.src}
          alt={media.alt}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
        />
      ) : (
        <Media.Video
          src={media.src}
          poster={media.poster}
          aria-label={media.alt}
          autoPlayInView
          loop
        />
      )}
    </Media>
  );
}

function SectionHeading({
  title,
  description,
  align = "center",
}: {
  title: string;
  description?: string;
  align?: "center" | "start";
}) {
  return (
    <header
      className={classes(
        "flex max-w-3xl flex-col gap-3",
        align === "center" ? "mx-auto items-center text-center" : "items-start text-left",
      )}
    >
      <Typography
        as="h2"
        variant="accent-xl-bold"
        color="primary"
        className="text-balance uppercase md:text-q-accent-2xl-bold"
      >
        {title}
      </Typography>
      {description != null ? (
        <Typography
          as="p"
          variant="body-md-regular"
          color="secondary"
          className="max-w-2xl text-pretty"
        >
          {description}
        </Typography>
      ) : null}
    </header>
  );
}

function Hero({ content }: { content: LandingContent["hero"] }) {
  return (
    <section className="flex flex-col items-center gap-6 pb-4 pt-10 text-center md:pb-8 md:pt-16">
      {content.eyebrow != null ? (
        <Typography
          as="p"
          variant="label-sm-semi-bold"
          color="brand"
          className="uppercase tracking-wider"
        >
          {content.eyebrow}
        </Typography>
      ) : null}
      <div className="flex max-w-4xl flex-col items-center gap-4">
        <Typography
          as="h1"
          variant="accent-3xl-bold"
          color="primary"
          className="text-balance uppercase md:text-q-accent-5xl-bold"
        >
          {content.title}
        </Typography>
        <Typography
          as="p"
          variant="body-lg-regular"
          color="secondary"
          className="max-w-2xl text-pretty"
        >
          {content.description}
        </Typography>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button as="a" href={content.primaryCta.href} variant="marketingPrimary" size="lg">
          {content.primaryCta.label}
        </Button>
        {content.secondaryCta != null ? (
          <Button as="a" href={content.secondaryCta.href} variant="marketingSecondary" size="lg">
            {content.secondaryCta.label}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function AppPreview({
  content,
  inlinePreview,
}: {
  content: LandingContent["preview"];
  inlinePreview?: ReactNode;
}) {
  if (content.kind === "inline") {
    return inlinePreview == null ? null : (
      <section aria-label={content.title} className="overflow-hidden rounded-q-600">
        {inlinePreview}
      </section>
    );
  }

  return (
    <section aria-label={content.title}>
      <div className="group relative overflow-hidden rounded-q-600 border border-q-border-subtle bg-q-background-secondary shadow-q-raised">
        <div className="aspect-video min-h-72 w-full md:min-h-[540px]">
          {content.kind === "route" ? (
            <iframe
              title={content.title}
              src={content.src}
              loading="lazy"
              tabIndex={-1}
              className="pointer-events-none h-full w-full border-0"
            />
          ) : (
            <LandingMedia media={content.media} eager className="rounded-q-0" />
          )}
        </div>
        <a
          href={content.openHref}
          aria-label={content.openLabel}
          className="absolute inset-0 flex cursor-pointer items-end justify-center bg-q-transparent-dark-20 p-5 opacity-100 transition-colors hover:bg-q-transparent-dark-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-q-border-focus md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        >
          <span className="rounded-q-full bg-q-background-primary px-5 py-3 text-q-body-sm-semi-bold text-q-text-primary shadow-q-raised-sm">
            {content.openLabel}
          </span>
        </a>
      </div>
    </section>
  );
}

function StepPreview({
  preview,
}: {
  preview: LandingContent["steps"]["items"][number]["preview"];
}) {
  if (preview.kind === "instruction") {
    const Glyph = ICONS[preview.icon];
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-q-300 border border-dashed border-q-border-subtle px-8">
        <Icon as={Glyph} size="md" color="secondary" />
        <div className="flex flex-col items-center gap-1 text-center">
          <Typography as="span" variant="body-sm-semi-bold" color="primary" className="uppercase">
            {preview.title}
          </Typography>
          {preview.description != null ? (
            <Typography as="span" variant="caption-xs-regular" color="secondary">
              {preview.description}
            </Typography>
          ) : null}
        </div>
      </div>
    );
  }

  if (preview.kind === "action") {
    return (
      <div className="flex h-full items-center justify-center">
        <Button
          variant="marketingPrimary"
          size="lg"
          start={<Icon as={Sparkles} size="sm" />}
        >
          {preview.label}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <LandingMedia media={preview.media} className="max-w-full rounded-q-300" />
    </div>
  );
}

function Steps({ content }: { content: LandingContent["steps"] }) {
  return (
    <section id="how-it-works" className="flex scroll-mt-8 flex-col gap-8">
      <SectionHeading title={content.title} description={content.description} align="start" />
      <div className="grid gap-10 md:grid-cols-3">
        {content.items.map((item, index) => (
          <article key={item.title} className="flex min-w-0 flex-col gap-4">
            <div className="h-60 overflow-hidden rounded-q-400 bg-q-transparent-light-05">
              <StepPreview preview={item.preview} />
            </div>
            <div className="flex flex-col gap-2">
              <Typography
                as="h3"
                variant="accent-xs-bold"
                color="primary"
                className="uppercase"
              >
                {`${index + 1}. ${item.title}`}
              </Typography>
              <Typography as="p" variant="body-sm-regular" color="secondary">
                {item.description}
              </Typography>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Features({ content }: { content: LandingContent["features"] }) {
  return (
    <section className="flex flex-col gap-8">
      <SectionHeading title={content.title} description={content.description} />
      <div className="grid gap-3 md:grid-cols-3">
        {content.items.map((item) => {
          const Glyph = ICONS[item.icon];
          return (
            <article
              key={item.title}
              className="flex min-h-48 flex-col gap-5 rounded-q-500 border border-q-border-subtle bg-q-background-secondary p-5"
            >
              <span className="flex size-11 items-center justify-center rounded-q-300 bg-q-transparent-light-10 text-q-icon-primary">
                <Icon as={Glyph} size="md" />
              </span>
              <div className="flex flex-col gap-2">
                <Typography as="h3" variant="body-lg-semi-bold" color="primary">
                  {item.title}
                </Typography>
                <Typography as="p" variant="body-sm-regular" color="secondary">
                  {item.description}
                </Typography>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Showcase({ content }: { content: LandingContent["showcase"] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = content.items[selectedIndex] ?? content.items[0];
  if (selected == null) return null;

  return (
    <section className="flex flex-col gap-8">
      <SectionHeading title={content.title} description={content.description} />
      <div className="flex flex-col items-center gap-4">
        <div className="aspect-video w-full overflow-hidden rounded-q-600 border border-q-border-subtle bg-q-background-secondary">
          <LandingMedia media={selected.media} eager />
        </div>
        {content.items.length > 1 ? (
          <div className="flex max-w-full items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              className="!border-0 !bg-transparent !shadow-none hover:!bg-transparent"
              aria-label="Previous showcase example"
              onClick={() =>
                setSelectedIndex(
                  (current) => (current - 1 + content.items.length) % content.items.length,
                )
              }
              start={<Icon as={ChevronLeft} size="sm" />}
            />
            <div
              role="tablist"
              aria-label="Showcase examples"
              className="flex min-w-0 items-center gap-2 overflow-x-auto rounded-q-full bg-q-background-secondary p-1.5"
            >
              {content.items.map((item, index) => (
                <button
                  key={`${item.label}-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={selectedIndex === index}
                  aria-label={`Show ${item.label}`}
                  onClick={() => setSelectedIndex(index)}
                  className={classes(
                    "relative aspect-[3/2] h-12 shrink-0 cursor-pointer overflow-hidden rounded-q-full border-2 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-q-border-focus",
                    selectedIndex === index
                      ? "border-q-border-focus opacity-100"
                      : "border-transparent opacity-60 hover:opacity-100",
                  )}
                >
                  {item.media.kind === "image" || item.media.poster != null ? (
                    <img
                      src={item.media.kind === "image" ? item.media.src : item.media.poster}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-q-background-tertiary">
                      <Icon as={Video} size="sm" color="secondary" />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              className="!border-0 !bg-transparent !shadow-none hover:!bg-transparent"
              aria-label="Next showcase example"
              onClick={() =>
                setSelectedIndex((current) => (current + 1) % content.items.length)
              }
              start={<Icon as={ChevronRight} size="sm" />}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FinalCta({ content }: { content: LandingContent["finalCta"] }) {
  return (
    <section className="relative isolate overflow-hidden rounded-q-600 border border-q-border-subtle bg-q-background-secondary px-5 py-16 md:px-12 md:py-24">
      {content.backgroundMedia != null ? (
        <div className="absolute inset-0 -z-10 opacity-30">
          <LandingMedia media={content.backgroundMedia} className="rounded-q-0" />
        </div>
      ) : null}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage: STUDIO_HERO_DOTS,
          backgroundSize: "14px 14px",
          maskImage: STUDIO_HERO_DOTS_MASK,
          WebkitMaskImage: STUDIO_HERO_DOTS_MASK,
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ backgroundImage: STUDIO_HERO_GLOW }}
      />
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
        <Typography
          as="h2"
          variant="accent-2xl-bold"
          color="primary"
          className="text-balance uppercase md:text-q-accent-3xl-bold"
        >
          {content.title}
        </Typography>
        <Typography as="p" variant="body-md-regular" color="secondary" className="text-pretty">
          {content.description}
        </Typography>
        <Button as="a" href={content.action.href} variant="marketingPrimary" size="lg">
          {content.action.label}
        </Button>
      </div>
    </section>
  );
}

export interface LandingSectionsProps {
  content: LandingContent;
  className?: string;
}

export function LandingSections({ content, className }: LandingSectionsProps) {
  return (
    <div className={classes("flex flex-col gap-20 md:gap-28", className)}>
      <Steps content={content.steps} />
      <Features content={content.features} />
      <Showcase content={content.showcase} />
      <FinalCta content={content.finalCta} />
    </div>
  );
}

export interface LandingPageProps {
  content: LandingContent;
  inlinePreview?: ReactNode;
}

export function LandingPage({ content, inlinePreview }: LandingPageProps) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-q-background-primary">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[600px]"
        style={{
          backgroundImage: STUDIO_HERO_DOTS,
          backgroundSize: "14px 14px",
          maskImage: STUDIO_HERO_DOTS_MASK,
          WebkitMaskImage: STUDIO_HERO_DOTS_MASK,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[600px]"
        style={{ backgroundImage: STUDIO_HERO_GLOW }}
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-16 px-4 pb-8 md:gap-24 md:px-8 md:pb-12">
        <Hero content={content.hero} />
        <AppPreview content={content.preview} inlinePreview={inlinePreview} />
        <LandingSections content={content} />
      </div>
    </main>
  );
}
