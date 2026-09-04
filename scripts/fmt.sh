#!/usr/bin/env bash

# Formats the whole codebase with oxfmt, clang-format, swift-format and ktfmt.
# Pass --check for dry run.

set -euo pipefail

cd "$(dirname "$0")/.."

native=('*.c' '*.h' '*.cpp' '*.hpp' '*.m' '*.mm')
swift=('*.swift')
kotlin=('*.kt' '*.kts')

ktfmt_flags=(--google-style --enable-editorconfig --quiet)

files() {
  git ls-files -co --exclude-standard -z "$@"
}

if [ "${1-}" = "--check" ]; then
  oxfmt --check
  files "${native[@]}" |
    xargs -0 clang-format --dry-run -Werror
  files "${swift[@]}" |
    xargs -0 swift format lint --strict --parallel
  files "${kotlin[@]}" |
    xargs -0 ktfmt --dry-run --set-exit-if-changed "${ktfmt_flags[@]}"
else
  oxfmt
  files "${native[@]}" | xargs -0 clang-format -i
  files "${swift[@]}" | xargs -0 swift format --in-place --parallel
  files "${kotlin[@]}" | xargs -0 ktfmt "${ktfmt_flags[@]}"
fi
