import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { bindings } from "../bindings.server";

// Example server function that touches the app's D1 binding (server-only).
export const getGreeting = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { DB, HF_ENV } = bindings();
    let count = 0;
    if (DB) {
      const row = await DB.prepare("SELECT 1 AS n").first<{ n: number }>();
      count = row?.n ?? 0;
    }
    return { greeting: `Hello, ${data.name}!`, env: HF_ENV ?? "unknown", count };
  });
