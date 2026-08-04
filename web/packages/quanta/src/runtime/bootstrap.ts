/**
 * Anti-FOUC snippet generator — opinionated recipe implementation.
 *
 * Generates an inline <head> script that sets data-theme before first
 * paint. Used in SSR frameworks (Next.js, Astro, SvelteKit) via
 * dangerouslySetInnerHTML or is:inline.
 *
 * What the script does, in order:
 *   1. Reads persisted runtime themes from localStorage and injects
 *      <style> tags before paint — otherwise an override pinned to
 *      "ai-ocean" would apply before :where([data-theme="ai-ocean"])
 *      exists in the DOM.
 *   2. Reads the pinned override (if any) and applies it.
 *   3. If no override is set, resolves the managed theme from pref +
 *      prefers-color-scheme.
 *
 * Usage (Next.js):
 *   import { bootstrapScript } from "@higgsfield/quanta/runtime";
 *
 *   <script nonce={nonce} dangerouslySetInnerHTML={{ __html: bootstrapScript() }} />
 *
 * Usage (Astro):
 *   <script is:inline set:html={bootstrapScript()} />
 */

import {
  DEFAULT_OVERRIDE_STORAGE_KEY,
  DEFAULT_STORAGE_KEY,
  DEFAULT_THEMES_STORAGE_KEY,
} from './storage-keys.ts'

export interface BootstrapOptions {
  brand?: string
  /** localStorage key for the user's mode pref. Default 'hf:quanta:theme-pref'. */
  storageKey?: string
  /** localStorage key for the pinned override. Default 'hf:quanta:theme-override'. */
  overrideStorageKey?: string
  /** localStorage key for the runtime themes map. Default 'hf:quanta:runtime-themes'. */
  themesStorageKey?: string
}

export function bootstrapScript({
  brand = 'default',
  storageKey = DEFAULT_STORAGE_KEY,
  overrideStorageKey = DEFAULT_OVERRIDE_STORAGE_KEY,
  themesStorageKey = DEFAULT_THEMES_STORAGE_KEY,
}: BootstrapOptions = {}): string {
  return `(function () {
  var currentScript = document.currentScript;
  var styleNonce = currentScript && currentScript.nonce ? currentScript.nonce : "";

  // 1. Re-inject persisted runtime themes (defineTheme'd in a prior session).
  var themes = {};
  try { themes = JSON.parse(localStorage.getItem(${JSON.stringify(themesStorageKey)}) || "{}"); } catch (e) {}
  for (var name in themes) {
    if (!Object.prototype.hasOwnProperty.call(themes, name)) continue;
    var decls = "";
    for (var key in themes[name]) {
      if (!Object.prototype.hasOwnProperty.call(themes[name], key)) continue;
      decls += "  --hf-color-" + key + ": " + themes[name][key] + ";\\n";
    }
    var style = document.createElement("style");
    style.id = "hf-runtime-theme-" + name;
    // :where(...) keeps specificity at (0,0,0) so consumer .my-class
    // overrides win. Runtime themes win the cascade tie not by specificity
    // but by being UNLAYERED while theme/color.css is wrapped in
    // @layer quanta-theme — unlayered always beats layered per CSS spec.
    // See define-theme.ts → injectStyleTag for the rationale.
    if (styleNonce) style.nonce = styleNonce;
    style.textContent = ":where([data-theme=\\"" + name + "\\"]) {\\n" + decls + "}";
    document.head.appendChild(style);
  }

  // 2. Apply override if pinned, otherwise resolve managed theme.
  var override = null;
  try { override = localStorage.getItem(${JSON.stringify(overrideStorageKey)}); } catch (e) {}
  var html = document.documentElement;
  if (override) {
    html.setAttribute("data-theme", override);

    // 3a. Anti-FOUC fallback for runtime themes. The Tailwind stylesheet
    // may load after first paint (esp. in dev where Vite injects CSS via
    // JS) — without this, body would flash with browser defaults before
    // the cascade resolves. Inline html bg+color from the override's
    // tokens covers that window; once the proper class on <body> arrives,
    // it paints over and the inline html style becomes invisible.
    var ot = themes[override];
    if (ot) {
      if (ot["background-primary"]) html.style.backgroundColor = ot["background-primary"];
      if (ot["text-primary"]) html.style.color = ot["text-primary"];
    }
  } else {
    var pref = "auto";
    try { pref = localStorage.getItem(${JSON.stringify(storageKey)}) || "auto"; } catch (e) {}
    // Package default is DARK. Render light ONLY when:
    //   - user explicitly chose pref="light", OR
    //   - pref="auto" and OS explicitly signals prefers-color-scheme: light
    // Any other signal (dark, none, matchMedia missing) resolves to dark.
    var light = pref === "light" || (pref === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
    var dark = !light;
    html.setAttribute("data-theme", ${JSON.stringify(brand)} + "-" + (dark ? "dark" : "light"));

    // 3b. Anti-FOUC for managed themes. Setting color-scheme tells the
    // browser to use dark/light system defaults for the canvas (page
    // background, native form controls) — no white flash before the
    // proper theme/color.css block sets the same property inside its
    // :where(...) block.
    html.style.colorScheme = dark ? "dark" : "light";
  }
})();`
}
