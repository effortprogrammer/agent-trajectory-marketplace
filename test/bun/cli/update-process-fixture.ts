import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	deriveInstallPaths,
	writeInstallState,
} from "../../../src/trajectory/install-state";
import { collectServiceLabel } from "../../../src/trajectory/collect-service";

const encoder = new TextEncoder();
const version = "1.1.0";
const tag = `v${version}`;
const repository = "effortprogrammer/agent-trajectory-marketplace";

type ProcessFixture = Readonly<{
	executable: string;
	home: string;
	oldRelease: string;
	outputSentinel: string;
	priorService: string;
	releaseFixture: string;
	root: string;
	serviceLog: string;
}>;

const writeTarText = (
	header: Uint8Array,
	offset: number,
	length: number,
	value: string,
): void => {
	header.set(encoder.encode(value).subarray(0, length), offset);
};

const tarEntry = (path: string, content: Uint8Array): Uint8Array => {
	const header = new Uint8Array(512);
	writeTarText(header, 0, 100, path);
	writeTarText(header, 100, 8, "0000644\0");
	writeTarText(header, 108, 8, "0000000\0");
	writeTarText(header, 116, 8, "0000000\0");
	writeTarText(
		header,
		124,
		12,
		`${content.byteLength.toString(8).padStart(11, "0")}\0`,
	);
	writeTarText(header, 136, 12, "00000000000\0");
	header.fill(32, 148, 156);
	header[156] = "0".charCodeAt(0);
	writeTarText(header, 257, 8, "ustar\x000");
	writeTarText(header, 265, 2, "00");
	let checksum = 0;
	for (const byte of header) checksum += byte;
	writeTarText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
	const padded = new Uint8Array(Math.ceil(content.byteLength / 512) * 512);
	padded.set(content);
	const entry = new Uint8Array(header.byteLength + padded.byteLength);
	entry.set(header);
	entry.set(padded, header.byteLength);
	return entry;
};

const releaseArchive = (buildSucceeds: boolean): Uint8Array => {
	const packageJson = JSON.stringify({
		name: "agent-trajectory-marketplace",
		version,
		packageManager: "bun@1.3.14",
		scripts: { build: "bun scripts/build.ts", "build:collector": "bun scripts/build.ts" },
	});
	const buildScript = buildSucceeds
		? `import { copyFileSync, mkdirSync } from "node:fs";\nmkdirSync("dist", { recursive: true });\ncopyFileSync("fixture-collector.js", "dist/collector.js");\n`
		: `throw new Error("fixture build failure");\n`;
	const files = [
		["package.json", packageJson],
		["scripts/build.ts", buildScript],
		["fixture-collector.js", "#!/usr/bin/env bun\nconsole.log('{}');\n"],
	] as const;
	const entries = files.map(([path, content]) =>
		tarEntry(`agent-trajectory-marketplace/${path}`, encoder.encode(content))
	);
	const length = entries.reduce((total, entry) => total + entry.byteLength, 1024);
	const tar = new Uint8Array(length);
	let offset = 0;
	for (const entry of entries) {
		tar.set(entry, offset);
		offset += entry.byteLength;
	}
	return Bun.gzipSync(tar);
};

const writeReleaseFixture = (root: string, buildSucceeds: boolean): string => {
	const fixture = join(root, "release-fixture");
	mkdirSync(fixture);
	const archive = releaseArchive(buildSucceeds);
	const sha256 = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
	const archiveName = `atm-${tag}.tar.gz`;
	const archiveUrl = `https://github.com/${repository}/releases/download/${tag}/${archiveName}`;
	const manifestUrl = `https://github.com/${repository}/releases/download/${tag}/atm-release-manifest.json`;
	const manifest = encoder.encode(JSON.stringify({
		schemaVersion: 1,
		packageName: "agent-trajectory-marketplace",
		version,
		tag,
		archive: { name: archiveName, size: archive.byteLength, sha256 },
	}));
	writeFileSync(join(fixture, "archive.tar.gz"), archive);
	writeFileSync(join(fixture, "corrupt.tar.gz"), archive.map((byte, index) => index === 20 ? byte ^ 1 : byte));
	writeFileSync(join(fixture, "manifest.json"), manifest);
	writeFileSync(join(fixture, "latest.json"), JSON.stringify({ tag_name: tag }));
	writeFileSync(join(fixture, "metadata.json"), JSON.stringify({
		tag_name: tag,
		immutable: true,
		draft: false,
		prerelease: false,
		assets: [
			{ name: "atm-release-manifest.json", size: manifest.byteLength, digest: null, browser_download_url: manifestUrl },
			{ name: archiveName, size: archive.byteLength, digest: `sha256:${sha256}`, browser_download_url: archiveUrl },
		],
	}));
	return fixture;
};

const writePreload = (root: string): void => {
	writeFileSync(join(root, "release-preload.ts"), `
import { join } from "node:path";
const fixture = process.env.ATM_TEST_RELEASE_FIXTURE ?? "";
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  let file = url.endsWith("/releases/latest") ? "latest.json" : url.includes("/releases/tags/") ? "metadata.json" : url.endsWith("atm-release-manifest.json") ? "manifest.json" : process.env.ATM_TEST_CORRUPT === "1" ? "corrupt.tar.gz" : "archive.tar.gz";
  return new Response(await Bun.file(join(fixture, file)).arrayBuffer(), { status: 200 });
};
`);
};

export const createProcessFixture = (buildSucceeds = true): ProcessFixture => {
	const root = mkdtempSync(join(tmpdir(), "atm-built-update-"));
	const oldRelease = join(root, "releases", "1.0.0");
	mkdirSync(join(oldRelease, "dist"), { recursive: true });
	copyFileSync(join(process.cwd(), "dist", "collector.js"), join(oldRelease, "dist", "collector.js"));
	symlinkSync(oldRelease, join(root, "current"));
	const outputSentinel = join(root, "collected", "sentinel.atf.json");
	mkdirSync(join(root, "collected"));
	writeFileSync(outputSentinel, "preserve");
	writeInstallState(deriveInstallPaths(root, "1.0.0"), {
		schemaVersion: 1,
		installRoot: root,
		outputDir: join(root, "collected"),
		service: { runtimes: ["codex"], intervalSeconds: 30, settleSeconds: 60 },
	});
	const home = join(root, "home");
	const serviceDir = process.platform === "linux"
		? join(home, ".config", "systemd", "user")
		: join(home, "Library", "LaunchAgents");
	mkdirSync(serviceDir, { recursive: true });
	const priorService = join(
		serviceDir,
		`${collectServiceLabel}.${process.platform === "linux" ? "service" : "plist"}`,
	);
	writeFileSync(priorService, "prior-service");
	const bin = join(root, "bin");
	mkdirSync(bin);
	const serviceLog = join(root, "service.log");
	const serviceManager = process.platform === "linux" ? "systemctl" : "launchctl";
	writeFileSync(join(bin, serviceManager), `#!/bin/sh
printf '%s\\n' "$*" >> "$ATM_TEST_SERVICE_LOG"
action="$1"
if [ "$1" = "--user" ]; then action="$2"; fi
if [ "$action" = "bootstrap" ] || [ "$action" = "restart" ]; then
  count=0
  [ -f "$ATM_TEST_BOOTSTRAP_COUNT" ] && count=$(sed -n '1p' "$ATM_TEST_BOOTSTRAP_COUNT")
  count=$((count + 1))
  printf '%s\\n' "$count" > "$ATM_TEST_BOOTSTRAP_COUNT"
fi
if [ "$action" = "print" ] || [ "$action" = "is-active" ]; then
  if [ "$ATM_TEST_HEALTH_FAIL" = "1" ]; then
    count=$(sed -n '1p' "$ATM_TEST_BOOTSTRAP_COUNT")
    [ "$count" = "1" ] && exit 1
  fi
fi
exit 0
`);
	chmodSync(join(bin, serviceManager), 0o755);
	writePreload(root);
	return {
		executable: join(root, "current", "dist", "collector.js"),
		home,
		oldRelease,
		outputSentinel,
		priorService,
		releaseFixture: writeReleaseFixture(root, buildSucceeds),
		root,
		serviceLog,
	};
};

export const runBuiltUpdate = (
	fixture: ProcessFixture,
	options: Readonly<{ corrupt?: boolean; healthFails?: boolean }> = {},
) => Bun.spawnSync([
	process.execPath,
	"--preload",
	join(fixture.root, "release-preload.ts"),
	fixture.executable,
	"trajectory",
	"update",
], {
	cwd: join(fixture.root, "current"),
	env: {
		...process.env,
		HOME: fixture.home,
		PATH: `${join(fixture.root, "bin")}:${process.env.PATH ?? ""}`,
		ATM_TEST_BOOTSTRAP_COUNT: join(fixture.root, "bootstrap-count"),
		ATM_TEST_CORRUPT: options.corrupt ? "1" : "0",
		ATM_TEST_HEALTH_FAIL: options.healthFails ? "1" : "0",
		ATM_TEST_RELEASE_FIXTURE: fixture.releaseFixture,
		ATM_TEST_SERVICE_LOG: fixture.serviceLog,
	},
	stderr: "pipe",
	stdout: "pipe",
});
