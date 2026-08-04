/**
 * ATM SEO: structured data builders, meta helpers, and sitemap data.
 * Pure TypeScript — no browser APIs, safe to import server-side.
 * Used by index.tsx (JSON-LD injection) and the sitemap/robots route files.
 */

export const ATM_SITE = {
  name: "ATM — Agent Trajectory Marketplace",
  shortName: "ATM",
  url: "https://agent-trajectory-marketplace.higgsfield.app",
  description:
    "A marketplace for real AI-agent session trajectories. Developers sell their agent work; AI labs buy real coding trajectories.",
  tagline: "Real work. Real repos.",
} as const;

/** Pathnames only — the origin is appended by the caller. */
export const ATM_ROUTES = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
] as const;

export function orgJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "ATM",
    alternateName: "Agent Trajectory Marketplace",
    url: ATM_SITE.url,
    description: ATM_SITE.description,
    slogan: ATM_SITE.tagline,
    // Logo intentionally points at a same-origin asset so it survives hosts.
    logo: `${ATM_SITE.url}/assets/og.png`,
  };
}

export function productJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ATM CLI",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Linux",
    description:
      "A small CLI that runs alongside your coding agents, collects session logs locally, and masks credentials before upload.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };
}

export function faqJsonLd() {
  const faq = [
    {
      q: "What exactly am I selling?",
      a: "The detailed trajectory logs your coding agent (Claude Code, Codex, etc.) leaves behind: what it read, what it tried, where it failed, how it recovered. Not your repository source code, and never your credentials.",
    },
    {
      q: "How is privacy handled before upload?",
      a: "Everything runs locally. The ATM CLI masks API keys, tokens, env values, and secrets on your machine with deterministic redaction, before any byte leaves your disk. Nothing uploads until you say so, and every upload is additionally reviewed by an operator before it lists.",
    },
    {
      q: "Why do buyers want these instead of synthetic data?",
      a: "Real repositories carry real decisions, real failure shapes, and real recovery moves. Synthetic prompts can't reproduce the mess a working developer's week produces — the edge cases buyers pay for are exactly the ones you hit without noticing.",
    },
    {
      q: "How do I get paid?",
      a: "Payouts go to the details you register during onboarding. Credits or fiat at seller's choice; we publish weekly reports on what sold, at what price, and to which use-case categories.",
    },
    {
      q: "Do I need to be using a specific agent?",
      a: "ATM supports the major coding agents (Claude Code, Codex, others added on a rolling basis). If your agent emits logs we can ingest, we can normalize them.",
    },
    {
      q: "Can I withdraw a session after listing it?",
      a: "Yes. You own the original data; a listed session is a licensed snapshot. You can delist anytime from the dashboard. Buyers keep any copies already downloaded under the marketplace terms.",
    },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: ATM_SITE.name,
    url: ATM_SITE.url,
    potentialAction: {
      "@type": "SearchAction",
      target: `${ATM_SITE.url}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

/** Build the ldm sitemap body (single host, no lastmod inflation). */
export function buildSitemapXml(origin: string): string {
  const entries = ATM_ROUTES.map(
    (r) =>
      `  <url>
    <loc>${origin}${r.path}</loc>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
}

export function buildRobotsTxt(origin: string): string {
  return `User-agent: *
Allow: /
Disallow: /app

Sitemap: ${origin}/sitemap.xml
`;
}
