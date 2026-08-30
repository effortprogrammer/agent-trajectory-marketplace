import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sellerCandidatesResponseSchema } from "../../../src/marketplace/seller-sales-contract";

const root = import.meta.dir;
const files = [
  "candidates-200.json",
  "candidates-page-1-200.json",
  "candidates-page-2-200.json",
  "candidates-merged-200.json",
] as const;
const parsed = await Promise.all(files.map(async (file) =>
  sellerCandidatesResponseSchema.parse(JSON.parse(await readFile(join(root, file), "utf8"))),
));
const [empty, firstPage, secondPage, merged] = parsed;
if (empty === undefined || firstPage === undefined || secondPage === undefined || merged === undefined) {
  throw new Error("missing upload-list fixture");
}
if (
  firstPage.nextCursor !== "c3ViXzAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw"
  || secondPage.nextCursor !== null
  || merged.nextCursor !== null
) {
  throw new Error("invalid upload-list pagination fixture");
}
if (JSON.stringify(merged.rows) !== JSON.stringify([...firstPage.rows, ...secondPage.rows])) {
  throw new Error("invalid upload-list merged fixture");
}
console.log("upload-list fixtures: verified");
