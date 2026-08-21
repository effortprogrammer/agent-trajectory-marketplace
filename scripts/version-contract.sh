#!/usr/bin/env bash

atm_is_stable_version() {
  local value="${1:-}" year month day max_day
  if [[ "$value" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    return 0
  fi
  if [[ ! "$value" =~ ^([1-9][0-9]{3})\.(0[1-9]|1[0-2])\.(0[1-9]|[12][0-9]|3[01])\.(0|[1-9][0-9]*)$ ]]; then
    return 1
  fi
  year=$((10#${BASH_REMATCH[1]}))
  month=$((10#${BASH_REMATCH[2]}))
  day=$((10#${BASH_REMATCH[3]}))
  case "$month" in
    2)
      max_day=28
      if ((year % 400 == 0 || (year % 4 == 0 && year % 100 != 0))); then
        max_day=29
      fi
      ;;
    4|6|9|11) max_day=30 ;;
    *) max_day=31 ;;
  esac
  ((day <= max_day))
}

atm_is_stable_tag() {
  local tag="${1:-}"
  [[ "$tag" == v* ]] && atm_is_stable_version "${tag#v}"
}
