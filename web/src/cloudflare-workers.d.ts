// The workerd runtime provides the `cloudflare:workers` module at runtime (the
// bundler keeps it external — see vite.config.ts). Declare it so `tsc` resolves
// the import; typed binding access is centralized in src/lib/bindings.server.ts.
declare module "cloudflare:workers" {
  export const env: unknown;
}
