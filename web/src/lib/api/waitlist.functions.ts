import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { bindings } from "../bindings.server";

const emailSchema = z
  .string()
  .min(5, "That doesn't look like a full email.")
  .max(320, "Email is too long.")
  .email("That doesn't look like a valid email.")
  .transform((v) => v.trim().toLowerCase());

const joinSchema = z.object({
  email: emailSchema,
  role: z.enum(["seller", "buyer", "both"]).default("seller"),
});

export type WaitlistResult =
  | { ok: true; already: boolean }
  | { ok: false; error: string };

export const joinWaitlist = createServerFn({ method: "POST" })
  .validator(joinSchema)
  .handler(async ({ data }): Promise<WaitlistResult> => {
    const { DB } = bindings();
    if (!DB) {
      return { ok: false, error: "Service unavailable right now. Please try again in a minute." };
    }

    const email = data.email;
    const product = "atm";

    // Whole flow inside one prepared statement set; UNIQUE(idx(email, product))
    // is the source of truth, so this is idempotent on retries.
    const already = await DB.prepare(
      "SELECT id FROM waitlist WHERE email = ?1 AND product = ?2 LIMIT 1",
    )
      .bind(email, product)
      .first<{ id: number }>();

    try {
      if (!already) {
        await DB.prepare(
          "INSERT INTO waitlist (email, product, source) VALUES (?1, ?2, ?3)",
        )
          .bind(email, product, data.role)
          .run();
      }

      await DB.prepare(
        "INSERT INTO waitlist_events (email, event, meta) VALUES (?1, ?2, ?3)",
      )
        .bind(
          email,
          already ? "resubmit" : "join",
          JSON.stringify({ role: data.role }),
        )
        .run();
    } catch {
      return { ok: false, error: "Couldn't save that just now. Try again." };
    }

    return { ok: true, already: Boolean(already) };
  });
