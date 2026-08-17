import { describe, expect, test } from "bun:test";

import {
  collectServicePaths,
  renderCollectWatchPlist,
} from "../../../src/trajectory/collect-service";
import { renderCollectWatchSystemdUnit } from "../../../src/trajectory/collect-service-systemd";

describe("Pi collect service attribution", () => {
  test("persists the explicit declaration in launchd and systemd commands", () => {
    const config = {
      declareRuntime: "pi" as const,
      intervalSeconds: 30,
      outDir: "/tmp/out",
      runtimes: ["pi"],
      settleSeconds: 60,
    };
    const plist = renderCollectWatchPlist({
      config,
      entryScriptPath: "/tmp/collector.js",
      executablePath: "/usr/local/bin/bun",
      paths: collectServicePaths("/tmp/home"),
      workingDirectory: "/tmp",
    });
    const unit = renderCollectWatchSystemdUnit({
      config,
      entryScriptPath: "/tmp/collector.js",
      executablePath: "/usr/local/bin/bun",
      workingDirectory: "/tmp",
    });

    expect(plist).toContain("<string>--declare-runtime</string>");
    expect(unit).toContain('"--declare-runtime" "pi"');
  });
});
