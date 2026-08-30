import { expect, test } from "bun:test";
import { parseMarketplaceCommand } from "../../../src/cli/marketplace-command";

test("seller P0 commands are represented by the marketplace parser", () => {
  expect(parseMarketplaceCommand(["marketplace", "seller", "candidate", "list"]))
    .not.toEqual({ command: "invalid_command" });
  expect(parseMarketplaceCommand(["marketplace", "seller", "sales", "sessions"]))
    .not.toEqual({ command: "invalid_command" });
  expect(parseMarketplaceCommand(["marketplace", "seller", "payout", "status"]))
    .not.toEqual({ command: "invalid_command" });
});
