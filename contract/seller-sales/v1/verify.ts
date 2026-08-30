import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSellerResponse } from "../../../src/marketplace/seller-sales-contract";
const root = import.meta.dir;
for (const [file, kind] of [["sessions-200.json","sales-sessions"],["earnings-200.json","sales-earnings"],["ledger-200.json","sales-ledger"]] as const) parseSellerResponse(kind, JSON.parse(await readFile(join(root,file),"utf8")));
console.log("seller-sales fixtures: verified");
