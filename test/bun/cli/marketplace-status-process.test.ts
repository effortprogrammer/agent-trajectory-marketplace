import { afterEach, describe, expect, test } from "bun:test";

import { officialRegistryOrigin } from "../../../src/auth/official-origin";

const submissionId = "sub_00000000000000000000000000";
const servers: Bun.Server<undefined>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

const run = async (
  argumentsList: readonly string[],
  target?: string,
): Promise<Readonly<{ exitCode: number; stderr: string; stdout: string }>> => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      `${import.meta.dir}/../fixtures/gateway-fetch-preload.ts`,
      "src/cli/index.ts",
      ...argumentsList,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(target === undefined ? {} : { TRAJECTORY_TEST_GATEWAY_TARGET: target }),
      },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
};

describe("candidate status real CLI process boundary", () => {
  test("reads status from the fixed gateway without a server argument", async () => {
    let observedHost = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        observedHost = new URL(request.url).host;
        return new Response(
          JSON.stringify({ protocolVersion: 1, submissionId, status: "completed" }),
          { status: 200 },
        );
      },
    });
    servers.push(server);

    const result = await run(
      [
        "marketplace", "seller", "candidate", "status",
        "--submission", submissionId,
        "--api-key", "trk_0123456789abcdef_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ],
      `http://127.0.0.1:${server.port}`,
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `${JSON.stringify({ protocolVersion: 1, submissionId, status: "completed" })}\n`,
    });
    expect(observedHost).toBe(`127.0.0.1:${server.port}`);
    expect(officialRegistryOrigin).toBe("https://gateway.getatm.io");
  });

  test("rejects legacy server input before any transport", async () => {
    let hits = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        hits += 1;
        return Response.json({ protocolVersion: 1, status: "completed", submissionId });
      },
    });
    servers.push(server);

    const result = await run([
      "marketplace", "seller", "candidate", "status",
      "--submission", submissionId,
      "--api-key", "trk_0123456789abcdef_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "--server", `http://127.0.0.1:${server.port}`,
    ]);

    expect({ ...result, hits }).toEqual({
      exitCode: 1,
      hits: 0,
      stderr: '{"error":"invalid_command"}\n',
      stdout: "",
    });
  });
});
