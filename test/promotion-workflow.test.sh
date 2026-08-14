#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/promotion-policy.yml"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -f "$WORKFLOW" ]] || fail "promotion policy workflow is missing"
grep -Fq 'base == "main"' "$WORKFLOW" || fail "main promotion base is not checked"
grep -Fq 'head == "dev"' "$WORKFLOW" || fail "dev promotion is not allowed"
grep -Fq 'head.startsWith("hotfix/")' "$WORKFLOW" || fail "hotfix promotion is not allowed"
grep -Fq 'Feature pull requests must target dev' "$WORKFLOW" || fail "feature guidance is missing"
grep -Fq 'Promotion policy accepted' "$WORKFLOW" || fail "accepted promotion evidence is missing"

printf 'promotion workflow contract passed\n'
