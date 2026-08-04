import { expect, test } from "bun:test";
import { applySecurityHeaders } from "../src/lib/security-headers.server";

test("allows the host approval iframe and preserves the response", async () => {
  const response = applySecurityHeaders(new Response("ok", { status: 201 }));
  expect(response.status).toBe(201);
  expect(await response.text()).toBe("ok");
  expect(response.headers.get("content-security-policy")).toContain(
    "frame-src 'self' https://auth.higgsfield.app https://auth.higgsfield-dev.app;",
  );
  expect(response.headers.get("content-security-policy")).not.toContain("frame-ancestors");
});
