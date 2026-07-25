import { describe, expect, test } from "bun:test"

import {
  AuthServerUrlError,
  authEndpoint,
  authEndpointPaths,
  normalizeAuthServerUrl,
  type AuthEndpoint,
} from "../../../src/auth/server-url"

describe("auth server origin confinement", () => {
  test("normalizes secure and loopback origins to a bare origin", () => {
    // Given: origins that differ only by case, default ports, and a root slash.
    const inputs = [
      ["HTTPS://Example.COM:443/", "https://example.com"],
      ["http://localhost:80/", "http://localhost"],
      ["http://127.0.0.1:80", "http://127.0.0.1"],
      ["http://[::1]:80/", "http://[::1]"],
      ["https://example.com:8443", "https://example.com:8443"],
    ] as const

    // When: each explicit server value crosses the origin boundary.
    const normalized = inputs.map(([input]) => normalizeAuthServerUrl(input))

    // Then: only the deterministic public origin remains.
    expect(normalized).toEqual(inputs.map(([, output]) => output))
  })

  test("constructs exactly the five fixed auth endpoints", () => {
    // Given: one normalized server origin and each named auth operation.
    const server = "https://auth.example.test/"
    const operations: readonly AuthEndpoint[] = ["signup", "login", "verify", "me", "logout"]

    // When: endpoint URLs are built from operation names.
    const endpoints = operations.map((operation) => authEndpoint(server, operation))

    // Then: paths are fixed under the auth namespace and cannot escape the origin.
    expect(endpoints).toEqual([
      "https://auth.example.test/v1/auth/signup",
      "https://auth.example.test/v1/auth/login",
      "https://auth.example.test/v1/auth/verify",
      "https://auth.example.test/v1/auth/me",
      "https://auth.example.test/v1/auth/logout",
    ])
    expect(new Set(endpoints.map((endpoint) => new URL(endpoint).origin))).toEqual(
      new Set(["https://auth.example.test"]),
    )
  })

  test("rejects hostile origins before any transport invocation", () => {
    // Given: malformed, non-loopback HTTP, credential-bearing, and URL-escape inputs.
    const hostile = [
      "http://example.com",
      "http://example.com:443",
      "ftp://example.com",
      "file:///tmp/auth",
      "data:text/plain,auth",
      "javascript:alert(1)",
      "//example.com",
      "example.com",
      "https://user@example.com",
      "https://:secret@example.com",
      "https://user:secret@example.com",
      "https://example.com/path",
      "https://example.com/a/..",
      "https://example.com//",
      "https://example.com?next=/v1/auth/me",
      "https://example.com#fragment",
      "https://example.com/path?x=1#y",
      "http://[::2]",
      "http://[::1",
      "http://::1",
      "https://[::1]extra",
      "https://",
      "https://?query",
      "https://example.com/%2e%2e",
      "https://example.com/%2F",
      " https://example.com",
      "https://example.com ",
    ] as const
    let transportCalls = 0
    const transport = (url: string): string => {
      transportCalls += 1
      return url
    }

    // When: each hostile value is normalized and, only if accepted, sent to transport.
    const failures: readonly unknown[] = hostile.map((origin) => {
      try {
        return transport(authEndpoint(origin, "signup"))
      } catch (error) {
        if (error instanceof AuthServerUrlError) {
          return error
        }
        throw error
      }
    })

    // Then: every value fails with a stable URL-boundary code and transport is untouched.
    const errors = failures.filter(
      (failure): failure is AuthServerUrlError => failure instanceof AuthServerUrlError,
    )
    expect(errors).toHaveLength(hostile.length)
    expect(
      errors.every((failure) => ["invalid_server_url", "insecure_server_url"].includes(failure.code)),
    ).toBe(true)
    expect(transportCalls).toBe(0)
  })

  test("classifies remote HTTP and unknown endpoint values with stable codes", () => {
    // Given: an otherwise parseable remote HTTP origin and an unrecognized endpoint name.
    // When: each crosses its respective validation boundary.
    const remoteHttp = (): string => normalizeAuthServerUrl("http://auth.example.test")
    const unknownEndpoint = (): string => authEndpoint("https://auth.example.test", "publish")

    // Then: transport policy and endpoint policy remain independently typed.
    expect(remoteHttp).toThrowError(
      expect.objectContaining({ code: "insecure_server_url" }),
    )
    expect(unknownEndpoint).toThrowError(
      expect.objectContaining({ code: "invalid_auth_endpoint" }),
    )
  })
})
