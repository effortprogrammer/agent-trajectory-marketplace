import { parseLandingContent } from "@higgsfield/app-landing";

const TEMPLATE_PREVIEW = "/assets/landing/template-preview.svg";

// TEMPLATE DEMO CONTENT. Replace it from the product AppBrief together with
// product-specific step UI and owned result/showcase media before shipping.
export const landingContent = parseLandingContent({
  hero: {
    eyebrow: "Your focused workspace",
    title: "Turn complex work into a clear, repeatable flow",
    description:
      "Organize the important work, keep progress visible and move from idea to done without losing context.",
    primaryCta: { label: "Open app", href: "/app" },
    secondaryCta: { label: "See how it works", href: "#how-it-works" },
  },
  preview: {
    kind: "route",
    title: "Interactive app preview",
    src: "/app?preview=1",
    openHref: "/app",
    openLabel: "Open full app",
  },
  steps: {
    title: "Move forward in 3 easy steps",
    description: "A focused workflow that keeps the next action obvious.",
    items: [
      {
        title: "Capture the work",
        description: "Add the items, files or ideas that need your attention.",
        preview: {
          kind: "instruction",
          icon: "layers",
          title: "Open your workspace",
          description: "Add the first item, file or idea",
        },
      },
      {
        title: "Shape the workflow",
        description: "Organize priorities and choose the controls that fit your process.",
        preview: {
          kind: "action",
          label: "Open app",
        },
      },
      {
        title: "Finish with confidence",
        description: "Track progress, review the result and keep the next step moving.",
        preview: {
          kind: "result",
          media: { kind: "image", src: TEMPLATE_PREVIEW, alt: "Completed workflow" },
        },
      },
    ],
  },
  features: {
    title: "Built for seamless progress",
    description:
      "The essential controls stay visible while secondary complexity stays out of the way.",
    items: [
      {
        icon: "layers",
        title: "Clear structure",
        description: "Keep related work together in a workspace that is easy to scan.",
      },
      {
        icon: "sliders",
        title: "Flexible controls",
        description: "Adapt views and settings to the task without crowding the main surface.",
      },
      {
        icon: "check",
        title: "Visible progress",
        description: "Understand what changed, what is active and what needs attention next.",
      },
    ],
  },
  showcase: {
    title: "See the workspace in action",
    description: "Explore the product's most important flows before opening the full app.",
    items: [
      {
        label: "Overview",
        media: { kind: "image", src: TEMPLATE_PREVIEW, alt: "Workspace overview" },
      },
      {
        label: "Focused workflow",
        media: { kind: "image", src: TEMPLATE_PREVIEW, alt: "Focused workflow view" },
      },
      {
        label: "Progress review",
        media: { kind: "image", src: TEMPLATE_PREVIEW, alt: "Progress review view" },
      },
    ],
  },
  finalCta: {
    title: "Ready to move your work forward?",
    description: "Open the full workspace and start with the task that matters most.",
    action: { label: "Open app", href: "/app" },
  },
});
