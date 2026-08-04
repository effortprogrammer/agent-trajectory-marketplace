import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Formatting is prettier's job (`bun run format`), NOT a lint error — lint
  // reports real code problems only. Vendored packages/ and generated files
  // are not ours to lint.
  { ignores: ["dist", ".output", ".vinxi", "packages", "scripts", "src/routeTree.gen.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      // Route files export `Route` and shared components export helpers/data
      // alongside components BY DESIGN here — this rule is all noise in this
      // codebase (HMR just full-reloads those modules).
      "react-refresh/only-export-components": "off",
      // `catch {}` is a deliberate ignore pattern in shipped code.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // The justified-gallery engine deliberately reads refs during its
    // render-time measure pass (bespoke out-of-React layout/windowing engine).
    // Exempt from the compiler-strict refs rule — do NOT imitate this pattern
    // in app code.
    files: ["src/components/gallery/**"],
    rules: { "react-hooks/refs": "off" },
  },
);
