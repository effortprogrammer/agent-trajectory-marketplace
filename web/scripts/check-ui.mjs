import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const uiRoots = [
  "src/layouts",
  "src/routes",
  "src/components/custom-ui",
  "src/features",
  "src/widgets",
];

const rules = [
  {
    label: "raw color literal",
    pattern: /#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(/i,
  },
  {
    label: "arbitrary Tailwind color",
    pattern: /\b(?:bg|text|border|outline|ring|from|via|to)-\[[^\]]+\]/,
  },
  {
    label: "theme-specific dark variant",
    pattern: /\bdark:/,
  },
  {
    label: "unapproved component library",
    pattern: /from\s+["'](?:@mui|antd|@chakra-ui|semantic-ui|react-bootstrap|@mantine)/,
  },
  {
    label: "agent-facing instructional copy rendered in UI",
    pattern:
      /replace (?:all )?mock|before shipping|this screen is mock|composed from the same .* recipes|use metric cards/i,
  },
];

function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => filesUnder(join(path, entry)));
}

const files = uiRoots
  .flatMap((path) => filesUnder(join(root, path)))
  .filter((path) => [".ts", ".tsx", ".js", ".jsx"].includes(extname(path)));

const failures = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const inspected = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const rule of rules) {
    const match = inspected.match(rule.pattern);
    if (!match || match.index == null) continue;
    const line = inspected.slice(0, match.index).split("\n").length;
    failures.push(`${relative(root, file)}:${line} — ${rule.label}: ${match[0]}`);
  }
  if (
    relative(root, file) !== "src/components/custom-ui/custom-ui.tsx" &&
    /<span[^>]+className=["'][^"']*\bsize-(?:9|10|12)\b[^"']*items-center[^"']*rounded-q-/s.test(
      inspected,
    )
  ) {
    failures.push(
      `${relative(root, file)} — hand-built raised icon tile; use VolumetricIconTile`,
    );
  }
}

const layoutPath = join(root, "src/layouts/custom.tsx");
if (existsSync(layoutPath)) {
  const layout = readFileSync(layoutPath, "utf8");
  for (const recipe of ["CustomAppShell", "WorkspaceContent"]) {
    if (!layout.includes(recipe)) failures.push(`src/layouts/custom.tsx — missing ${recipe}`);
  }
}

if (failures.length > 0) {
  console.error("Custom UI contract failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Custom UI contract passed (${files.length} files checked).`);
