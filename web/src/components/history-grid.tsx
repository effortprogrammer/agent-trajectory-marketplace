import { UserGenerations } from "@/components/user-generations";
import type { UserGenerationsProps } from "@/components/user-generations";

/**
 * @deprecated Use `UserGenerations` from `@/components/user-generations` — it is
 * THE single canonical component for a browsable feed of the current user's
 * generations. `HistoryGrid` is kept only as a thin back-compat alias so older
 * call sites keep working; new code (and every History tab/page) renders
 * `<UserGenerations />` directly.
 */
export function HistoryGrid(props: UserGenerationsProps) {
  return <UserGenerations {...props} />;
}
