"use client";

import type { ComponentProps, CSSProperties, ReactNode } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Blocks as DefaultBrandIcon, PanelLeftClose, PanelRightClose } from "lucide-react";
import { Button } from "@higgsfield/quanta/button";
import { card } from "@higgsfield/quanta/card";
import { Icon, icon as iconClass } from "@higgsfield/quanta/icon";
import type { IconGlyph } from "@higgsfield/quanta/icon";
import { Sidebar } from "@higgsfield/quanta/sidebar";
import { Typography } from "@higgsfield/quanta/typography";
import { IconTile } from "@/components/icon-tile";
import type { IconTileGradient } from "@/components/icon-tile";
import { cn } from "@/lib/utils";

export interface NavigationItem {
  id: string;
  label: string;
  icon: PhosphorIcon;
  gradient?: IconTileGradient;
}

function FilledNavigationIcon({ glyph: Glyph }: { glyph: PhosphorIcon }) {
  return <Glyph weight="fill" aria-hidden className={iconClass({ size: "sm" })} />;
}

export interface CustomAppShellProps {
  brand: string;
  navigation: NavigationItem[];
  activeId: string;
  onNavigate: (id: string) => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Navigation sidebar placement. Use `none` for two settings/tool rails. */
  navigationSide?: "left" | "right" | "none";
  /** Optional non-navigation rail, typically `SettingsRail`. */
  leftRail?: ReactNode;
  /** Optional non-navigation rail, typically `SettingsRail`. */
  rightRail?: ReactNode;
}

const TOP_GLOW =
  "radial-gradient(60% 80% at 50% 0%, var(--hf-color-transparent-light-10) 0%, var(--hf-color-transparent-light-05) 42%, transparent 72%)";
const TOP_DOTS =
  "radial-gradient(var(--hf-color-transparent-light-20) 1px, transparent 1px)";
const TOP_DOTS_MASK =
  "radial-gradient(55% 70% at 50% 0%, var(--hf-color-transparent-dark-100) 0%, var(--hf-color-transparent-dark-40) 45%, transparent 75%)";

function NavigationSidebar({
  brand,
  navigation,
  activeId,
  onNavigate,
  footer,
  side,
}: Omit<CustomAppShellProps, "children" | "leftRail" | "rightRail" | "navigationSide"> & {
  side: "left" | "right";
}) {
  return (
    <Sidebar.Root
      className="m-2.5 hidden lg:flex"
      style={
        { height: "calc(100% - 20px)", ["--q-sidebar-radius" as string]: "12px" } as CSSProperties
      }
    >
      <Sidebar.Header>
        <Sidebar.Switcher>
          <Sidebar.Logo>
            <span className="flex size-6 items-center justify-center rounded-q-200 bg-q-brand-primary text-q-icon-inverse">
              <Icon as={DefaultBrandIcon} size="sm" />
            </span>
          </Sidebar.Logo>
          <Sidebar.Title>{brand}</Sidebar.Title>
        </Sidebar.Switcher>
        <Sidebar.Toggle>
          <Icon as={side === "left" ? PanelLeftClose : PanelRightClose} size="md" />
        </Sidebar.Toggle>
      </Sidebar.Header>

      <Sidebar.Body>
        <Sidebar.Section>
          <Sidebar.SectionItems>
            {navigation.map((item) => (
              <Sidebar.Item
                key={item.id}
                selected={activeId === item.id}
                onClick={() => onNavigate(item.id)}
                start={<IconTile as={item.icon} gradient={item.gradient ?? "blue"} />}
                title={item.label}
              />
            ))}
          </Sidebar.SectionItems>
        </Sidebar.Section>
      </Sidebar.Body>

      {footer != null ? (
        <Sidebar.Footer>
          <div className="px-2 py-1">{footer}</div>
        </Sidebar.Footer>
      ) : null}
    </Sidebar.Root>
  );
}

/**
 * The mandatory custom-template shell. It owns responsive navigation, page
 * background, content overflow, spacing, and the maximum readable width.
 */
export function CustomAppShell({
  brand,
  navigation,
  activeId,
  onNavigate,
  children,
  footer,
  navigationSide = "left",
  leftRail,
  rightRail,
}: CustomAppShellProps) {
  const navigationSidebar =
    navigationSide === "none" ? null : (
      <NavigationSidebar
        brand={brand}
        navigation={navigation}
        activeId={activeId}
        onNavigate={onNavigate}
        footer={footer}
        side={navigationSide}
      />
    );
  const left = navigationSide === "left" ? navigationSidebar : leftRail;
  const right = navigationSide === "right" ? navigationSidebar : rightRail;

  return (
    <div className="flex h-dvh min-h-0 bg-q-background-primary text-q-text-primary">
      {left}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-q-border-subtle px-3 py-2 lg:hidden">
          <Typography as="span" variant="label-sm-semi-bold" color="primary" className="mr-2">
            {brand}
          </Typography>
          {navigation.map((item) => (
            <Button
              key={item.id}
              variant={activeId === item.id ? "secondary" : "ghost"}
              size="xs"
              aria-label={item.label}
              start={<FilledNavigationIcon glyph={item.icon} />}
              onClick={() => onNavigate(item.id)}
            >
              <span className="hidden sm:inline">{item.label}</span>
            </Button>
          ))}
        </header>
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[600px]"
            style={{
              backgroundImage: TOP_DOTS,
              backgroundSize: "14px 14px",
              maskImage: TOP_DOTS_MASK,
              WebkitMaskImage: TOP_DOTS_MASK,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[600px]"
            style={{ backgroundImage: TOP_GLOW }}
          />
          <div className="relative h-full min-h-0">{children}</div>
        </main>
      </div>
      {right}
    </div>
  );
}

export type WorkspaceContentMode = "page" | "canvas" | "generations";

export interface WorkspaceContentProps {
  mode?: WorkspaceContentMode;
  children: ReactNode;
  className?: string;
}

/**
 * Central shell window: scrolling page, fixed custom canvas, or the canonical
 * generations feed. Use one mode per view; side rails remain shell siblings.
 */
export function WorkspaceContent({
  mode = "page",
  children,
  className,
}: WorkspaceContentProps) {
  return (
    <div
      className={cn(
        "relative h-full min-h-0",
        mode === "page" && "overflow-y-auto",
        mode === "canvas" && "overflow-hidden",
        mode === "generations" && "flex flex-col overflow-hidden p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SettingsRailProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Preset-style settings/input rail. Pass it to `leftRail` or `rightRail`; the
 * shell decides placement while the rail owns width, scrolling, and footer.
 */
export function SettingsRail({
  title,
  description,
  children,
  footer,
  className,
}: SettingsRailProps) {
  return (
    <aside
      className={card(
        { surface: "solid", elevation: "raised" },
        "m-2.5 hidden h-[calc(100%_-_20px)] w-85.5 shrink-0 flex-col gap-4 overflow-y-auto border-q-thin border-q-border-subtle p-3 lg:flex [&>*]:shrink-0",
        className,
      )}
    >
      <div className="flex flex-col gap-1 px-2 py-1">
        <Typography as="h2" variant="title-sm-semi-bold" color="primary">
          {title}
        </Typography>
        {description != null ? (
          <Typography as="p" variant="caption-sm-regular" color="secondary">
            {description}
          </Typography>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
      {footer != null ? (
        <div className="sticky bottom-0 mt-auto bg-q-background-secondary pt-3">{footer}</div>
      ) : null}
    </aside>
  );
}

export function Page({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-7xl flex-col gap-10 p-5 md:gap-12 md:p-8 lg:p-10",
        className,
      )}
      {...props}
    />
  );
}

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col items-center gap-6 py-8 text-center md:py-12">
      <div className="flex max-w-3xl flex-col items-center gap-3">
        {eyebrow != null ? (
          <Typography as="span" variant="label-xs-semi-bold" color="brand">
            {eyebrow}
          </Typography>
        ) : null}
        <Typography as="h1" variant="title-lg-semi-bold" color="primary">
          {title}
        </Typography>
        {description != null ? (
          <Typography as="p" variant="body-md-regular" color="secondary">
            {description}
          </Typography>
        ) : null}
      </div>
      {actions != null ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ title, description, actions, children, className }: SectionProps) {
  return (
    <section className={cn("flex flex-col gap-5", className)}>
      {title != null || actions != null ? (
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            {title != null ? (
              <Typography as="h2" variant="title-sm-semi-bold" color="primary">
                {title}
              </Typography>
            ) : null}
            {description != null ? (
              <Typography as="p" variant="body-sm-regular" color="secondary">
                {description}
              </Typography>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Panel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-q-500 border border-q-border-subtle bg-q-transparent-light-05 p-5 shadow-q-raised-sm md:p-6",
        className,
      )}
      {...props}
    />
  );
}

export type VolumetricIconTileSize = "sm" | "md" | "lg";

const VOLUMETRIC_ICON_TILE_SIZE = {
  sm: { root: "size-9 rounded-q-300", icon: "sm" },
  md: { root: "size-10 rounded-q-300", icon: "sm" },
  lg: { root: "size-12 rounded-q-300", icon: "md" },
} as const;

export interface VolumetricIconTileProps {
  icon: IconGlyph;
  size?: VolumetricIconTileSize;
  className?: string;
}

/** Canonical raised icon surface — Figma Left_lg (3617:50814). */
export function VolumetricIconTile({
  icon,
  size = "md",
  className,
}: VolumetricIconTileProps) {
  const dimensions = VOLUMETRIC_ICON_TILE_SIZE[size];
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden border border-q-border-subtle bg-gradient-to-b from-q-transparent-light-20 via-q-transparent-dark-10 to-q-transparent-light-05 text-q-icon-primary shadow-q-raised",
        dimensions.root,
        className,
      )}
    >
      <Icon as={icon} size={dimensions.icon} />
    </span>
  );
}

export interface MetricCardProps {
  label: ReactNode;
  value: ReactNode;
  badge?: ReactNode;
  icon: IconGlyph;
}

export function MetricCard({ label, value, badge, icon }: MetricCardProps) {
  return (
    <Panel className="relative flex min-w-0 items-center gap-4">
      <VolumetricIconTile icon={icon} size="md" />
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1", badge != null && "pr-12")}>
        <Typography as="strong" variant="title-md-semi-bold" color="primary" truncate>
          {value}
        </Typography>
        <Typography as="span" variant="caption-sm-medium" color="secondary">
          {label}
        </Typography>
      </div>
      {badge != null ? (
        <Typography
          as="span"
          variant="caption-xs-medium"
          color="secondary"
          className="absolute right-4 top-4 rounded-q-200 bg-q-transparent-light-10 px-2 py-1"
        >
          {badge}
        </Typography>
      ) : null}
    </Panel>
  );
}

export interface EmptyStateProps {
  icon: IconGlyph;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
      <VolumetricIconTile icon={icon} size="lg" />
      <div className="flex max-w-sm flex-col gap-1.5">
        <Typography as="h3" variant="label-md-semi-bold" color="primary">
          {title}
        </Typography>
        <Typography as="p" variant="body-sm-regular" color="secondary">
          {description}
        </Typography>
      </div>
      {action}
    </div>
  );
}
