import { describe, expect, test } from "bun:test";

import { selectionDocumentFromTraces } from "../../../src/marketplace/selection-contract";
import {
  fullSelectorSchema,
  traceHashSchema,
  type FrozenTrace,
  type ValidatedTrace,
} from "../../../src/marketplace/session-contract";
import {
  buildSessionListItem,
  buildSessionReport,
  renderSessionList,
  renderSessionReport,
} from "../../../src/marketplace/session-report";
import { harnessTraceDocumentSchema } from "../../../src/trajectory/adapters/contract";

const document = harnessTraceDocumentSchema.parse({
  runtime: "pi",
  runtimeAttribution: "operator_declared",
  status: "collected",
  eventCount: 1,
  events: [{ kind: "function_enter", name: "turn-1" }],
});
const bytes = Buffer.from(JSON.stringify(document), "utf8");
const frozenTrace: FrozenTrace = {
  selector: fullSelectorSchema.parse(`s-${"a".repeat(64)}`),
  relativePath: "pi.atf.json",
  hash: traceHashSchema.parse("b".repeat(64)),
  byteCount: bytes.byteLength,
  runtime: "pi",
  runtimeAttribution: "operator_declared",
  eventCount: 1,
  earliestTimestamp: "unknown",
  bytes,
};
const trace: ValidatedTrace = { document, frozenTrace };

describe("operator-declared Pi marketplace surfaces", () => {
  test("retains attribution in selection and rendered reports", () => {
    const listItem = buildSessionListItem(trace);
    const report = buildSessionReport(trace);
    const selection = selectionDocumentFromTraces("/tmp/traces", [frozenTrace]);

    expect(selection.traces[0]?.runtimeAttribution).toBe("operator_declared");
    expect(listItem.runtimeAttribution).toBe("operator_declared");
    expect(report.runtimeAttribution).toBe("operator_declared");
    expect(renderSessionList([listItem])).toContain("runtime-attribution: operator_declared");
    expect(renderSessionReport(report)).toContain("runtime-attribution: operator_declared");
  });
});
