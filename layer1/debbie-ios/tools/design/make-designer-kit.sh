#!/usr/bin/env bash
# Rebuilds the designer kit (DesignerKit/) from the app's sources: every generator under tools/design/kit/ that runs
# without the iOS Simulator, then a check of the whole kit.
#
#   tools/design/make-designer-kit.sh                 from the working tree, as it is now
#   tools/design/make-designer-kit.sh --rev HEAD      from a commit: the app's sources as committed there (use this
#                                                     while the app has uncommitted work the kit shouldn't show)
#   tools/design/make-designer-kit.sh --keep-stage    also keep the working copy (build/designer-kit/stage)
#
# Works from any folder; every path is relative to the repo root. Steps, in order:
#   1. tools/design/kit/brand-tokens.sh    01-brand, 02-color, 03-type, 04-layout
#   2. tools/design/kit/icons-debbie.sh    05-icons, 06-illustrations, 07-debbie (the exports; the guides are by hand)
#   3. tools/design/kit/motion.sh          09-motion (motion.md, motion-tokens.json, curves.png, icon-animations.md)
#                                          and 10-haptics
#   4. tools/design/kit/screens.sh         11-screens, and Debbie's answers inside 12-copy-and-demo/voice-and-copy.md
#   5. 13-code                             fresh copies of the design system and three reference screens
#   6. tools/design/kit/capture.py doc     09-motion/recordings/recordings.md, from the last simulator capture's notes
#                                          (skipped when build/designer-kit/capture doesn't have them)
#   7. tools/design/kit/components.py      checks 08-components/components.md against the code (writes nothing)
#   8. Kit checks                          README lists every folder; no private paths, addresses or keys; every SVG
#                                          renders; every video and GIF has frames; every JSON file parses
#
# Safe to re-run. Everything runs in a copy (build/designer-kit/stage, gitignored); DesignerKit/ is only updated after
# every step has passed, and only files whose content changed are rewritten. If a step fails, DesignerKit/ is left
# exactly as it was and the copy is kept for a look.
#
# Not run here, because they need the iOS Simulator (Xcode 26 and the "Debbie Max" simulator; see the README):
#   tools/design/kit/capture.sh renders        08-components/renders and renders/increase-contrast
#   tools/design/kit/capture.sh recordings     09-motion/recordings (videos, contact sheets, recordings.md)
#   tools/screens/tour.sh --preview, --access  the build screenshots that step 4 copies into 11-screens
#
# Needs: bash, python3, Xcode's command-line tools (swift, swiftc, xcrun, actool), rsvg-convert, ffmpeg and ffprobe
# (Homebrew), sips, rsync, and git for --rev.
set -euo pipefail
cd "$(dirname "$0")/../.."

usage() { sed -n '2,/^set -euo pipefail$/p' "$0" | sed '$d; s/^# \{0,1\}//'; }

REV=""
KEEP_STAGE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rev) [[ $# -ge 2 ]] || { echo "make-designer-kit: --rev needs a commit, for example --rev HEAD" >&2; exit 2; }
           REV="$2"; shift 2 ;;
    --rev=*) REV="${1#--rev=}"; shift ;;
    --keep-stage) KEEP_STAGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "make-designer-kit: unknown option '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

KIT=DesignerKit
STAGE=build/designer-kit/stage
# What the generators read from the app, and what makes the kit itself (its tools, its hand-written guides, the
# component gallery and its UI tests). Only the first group follows --rev.
APP_INPUTS=(Design Packages/DebbieKit/Sources App NotificationService)
KIT_TOOLING=(tools/design UITests "$KIT")
GALLERY=App/DebbieDebugTools   # inside App/, but kit tooling: it stays as it is in the working tree

[[ -d $KIT && -d tools/design/kit && -f Design/tokens/colors.json && -d Packages/DebbieKit/Sources ]] \
  || { echo "make-designer-kit: run inside the Debbie repo" >&2; exit 1; }
for tool in python3 swift swiftc xcrun rsvg-convert ffmpeg ffprobe sips rsync; do
  command -v "$tool" >/dev/null || { echo "make-designer-kit: $tool not found" >&2; exit 1; }
done
if [[ -n $REV ]]; then
  command -v git >/dev/null || { echo "make-designer-kit: --rev needs git" >&2; exit 1; }
  git rev-parse --verify --quiet "$REV^{commit}" >/dev/null || { echo "make-designer-kit: '$REV' isn't a commit" >&2; exit 1; }
fi

started=$SECONDS
say() { printf '%s\n' "$*"; }

# ---------------------------------------------------------------------------------------------------- the working copy
say "== Copying the app's sources and the kit to $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE"
for p in "${APP_INPUTS[@]}" "${KIT_TOOLING[@]}"; do
  [[ -e $p ]] || continue
  mkdir -p "$STAGE/$p"
  rsync -a --exclude .DS_Store --exclude __pycache__ "$p/" "$STAGE/$p/"
done
# The last simulator capture's notes (step 6 reads them) and the compiled icon tool (saves step 2 a compile).
if [[ -d build/designer-kit/capture ]]; then
  mkdir -p "$STAGE/build/designer-kit/capture"
  rsync -a --include '*.json' --exclude '*' build/designer-kit/capture/ "$STAGE/build/designer-kit/capture/"
fi
if [[ -x build/designer-kit/icons-debbie/icons-debbie-icons ]]; then
  mkdir -p "$STAGE/build/designer-kit/icons-debbie"
  cp -p build/designer-kit/icons-debbie/icons-debbie-icons "$STAGE/build/designer-kit/icons-debbie/"
fi

if [[ -n $REV ]]; then
  # Put every app file back as it is at REV. Restored files carry REV's commit time, because screens.sh labels the
  # contact sheets with the screenshots' file times.
  short=$(git rev-parse --short "$REV")
  stamp=$(git log -1 --format=%cd --date=format-local:%Y%m%d%H%M.%S "$REV")   # local time, as touch -t reads it
  restored=0
  while IFS= read -r -d '' p; do
    if git cat-file -e "$REV:$p" 2>/dev/null; then
      mkdir -p "$STAGE/$(dirname "$p")"
      git show "$REV:$p" > "$STAGE/$p"
      touch -t "$stamp" "$STAGE/$p"
    else
      rm -f "$STAGE/$p"
    fi
    restored=$((restored + 1))
  done < <(git diff -z --name-only --no-renames "$REV" -- "${APP_INPUTS[@]}")
  # Files that are new since REV and not committed (work in progress), except the gallery.
  while IFS= read -r -d '' p; do
    rm -f "$STAGE/$p"
    restored=$((restored + 1))
  done < <(git ls-files -z --others --exclude-standard -- "${APP_INPUTS[@]}" ":(exclude)$GALLERY")
  # Folders those removals emptied go too (git keeps no empty folders, so REV has none).
  for p in "${APP_INPUTS[@]}"; do
    [[ ! -d $STAGE/$p ]] || find "$STAGE/$p" -mindepth 1 -type d -empty -delete
  done
  say "   app sources as at $short: $restored file(s) in the working tree differ and were set back in the copy"
elif command -v git >/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  drift=$(git status --porcelain -- "${APP_INPUTS[@]}" ":(exclude)$GALLERY" | wc -l | tr -d ' ')
  if [[ $drift != 0 ]]; then
    say "   note: $drift app file(s) differ from the last commit, and the kit will describe them:"
    git status --porcelain -- "${APP_INPUTS[@]}" ":(exclude)$GALLERY" | sed 's/^/     /'
    say "   If a generator stops on something it doesn't describe yet, describe it in that generator, or run"
    say "   tools/design/make-designer-kit.sh --rev HEAD to rebuild the kit for the last commit."
  fi
fi

# --------------------------------------------------------------------------------------------------------- the steps
# run <label> <command…>: runs in the copy; on failure, stops with DesignerKit/ untouched.
run() {
  local label=$1 t0=$SECONDS
  shift
  say "== $label"
  if ! (cd "$STAGE" && "$@"); then
    say "make-designer-kit: '$label' failed. DesignerKit/ was not changed; the copy is in $STAGE." >&2
    exit 1
  fi
  say "   ($((SECONDS - t0)) s)"
}

# Step 5. The design system as a standalone package, plus three screens that show how it's wired. README.md and
# Package.swift in 13-code are written by hand and stay.
sync_code() {
  local ds=$KIT/13-code/DebbieDesignSystem/Sources/DebbieDesignSystem ref=$KIT/13-code/reference-screens
  local src=Packages/DebbieKit/Sources
  [[ -f $KIT/13-code/README.md && -f $KIT/13-code/DebbieDesignSystem/Package.swift ]] \
    || { echo "13-code: README.md or DebbieDesignSystem/Package.swift is missing (both are written by hand)" >&2; return 1; }
  # Shell functions run by run() sit in an `if`, where bash ignores set -e, so each step returns on its own failure.
  rm -rf "$ds" "$ref" && mkdir -p "$ds" "$ref" || return 1
  rsync -a --exclude .DS_Store "$src/DebbieDesignSystem/" "$ds/" || return 1
  find "$ds" -mindepth 1 -type d -empty -delete || return 1
  cp -p "$src/DebbieCareScreens/CareScreens.swift" "$src/DebbieFeatures/Views.swift" "$src/DebbieFeatures/DebbieChat.swift" "$ref/" \
    || return 1
  say "• $KIT/13-code: $(find "$ds" -type f | wc -l | tr -d ' ') design-system files and 3 reference screens copied"
}

# Step 6. recordings.md is written from the notes the last capture left in build/designer-kit/capture. Without them it
# would list no recordings, so it is only rewritten when the notes for every video are there.
recordings_doc() {
  local work=build/designer-kit/capture recs=$KIT/09-motion/recordings n
  for n in app-tour icon-animations debbie-idle-app resident; do
    if [[ ! -f $work/$n.json || ! -f $recs/$n.mp4 ]]; then
      say "• $recs/recordings.md kept as it is: $work/$n.json (from tools/design/kit/capture.sh recordings) isn't here"
      return 0
    fi
  done
  python3 -I tools/design/kit/capture.py doc "$recs" "$work"
}

# Step 8. Checks across the whole kit.
kit_checks() {
  local fail=0 f d n tmp hits
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/debbie-kit-check.XXXXXX") || return 1
  # README.md is the way in: it must name every folder.
  if [[ ! -f $KIT/README.md ]]; then
    say "✗ $KIT/README.md is missing"; fail=1
  else
    for d in "$KIT"/*/; do
      d=$(basename "$d")
      grep -qF "\`$d/\`" "$KIT/README.md" || { say "✗ $KIT/README.md doesn't list $d/"; fail=1; }
    done
  fi
  # Nothing private: no home-folder or temporary paths, e-mail addresses or key material (`name@2x.png` isn't one).
  hits=$(grep -rIlE '/Users/|/private/var/|/var/folders/|-----BEGIN [A-Z ]*PRIVATE KEY|AuthKey_[A-Z0-9]+' "$KIT" || true)
  [[ -z $hits ]] || { say "✗ private paths or key material in:"; say "$hits"; fail=1; }
  hits=$(grep -rIoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' "$KIT" | grep -vE '@[0-9]+x\.[a-z]+$' || true)
  [[ -z $hits ]] || { say "✗ what look like e-mail addresses:"; say "$hits"; fail=1; }
  # Every SVG renders.
  n=0
  while IFS= read -r -d '' f; do
    n=$((n + 1))
    rsvg-convert -w 64 -o "$tmp/check.png" "$f" 2>/dev/null || { say "✗ $f doesn't render"; fail=1; }
  done < <(find "$KIT" -name '*.svg' -print0)
  say "• $n SVG files render"
  # Every video and GIF has a picture track with frames.
  n=0
  while IFS= read -r -d '' f; do
    n=$((n + 1))
    d=$(ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$f" 2>/dev/null || true)
    [[ ${d%%,*} =~ ^[0-9]+$ && ${d%%,*} -gt 0 ]] || { say "✗ $f has no readable frames"; fail=1; }
  done < <(find "$KIT" \( -name '*.mp4' -o -name '*.mov' -o -name '*.gif' \) -print0)
  say "• $n videos and GIFs have frames"
  # Every JSON file parses.
  find "$KIT" -name '*.json' -print0 | xargs -0 python3 -I -c '
import json, sys
bad = 0
for p in sys.argv[1:]:
    try:
        json.load(open(p, encoding="utf-8"))
    except ValueError as e:
        print("✗ %s: %s" % (p, e)); bad = 1
sys.exit(bad)' || fail=1
  say "• $(find "$KIT" -name '*.json' | wc -l | tr -d ' ') JSON files parse"
  # No empty files or folders.
  hits=$(find "$KIT" \( -type f -size 0 \) -o \( -type d -empty \))
  [[ -z $hits ]] || { say "✗ empty files or folders:"; say "$hits"; fail=1; }
  rm -rf "$tmp"
  return $fail
}

run "1. 01-brand, 02-color, 03-type, 04-layout (brand-tokens.sh)" tools/design/kit/brand-tokens.sh
run "2. 05-icons, 06-illustrations, 07-debbie (icons-debbie.sh)" tools/design/kit/icons-debbie.sh
run "3. 09-motion and 10-haptics (motion.sh)" tools/design/kit/motion.sh
run "4. 11-screens, and Debbie's answers in 12-copy-and-demo (screens.sh)" tools/design/kit/screens.sh
run "5. 13-code" sync_code
run "6. 09-motion/recordings/recordings.md (capture.py doc)" recordings_doc
run "7. 08-components/components.md against the code (components.py)" python3 -I tools/design/kit/components.py
run "8. Kit checks" kit_checks

# ------------------------------------------------------------------------------------------- update DesignerKit/
say "== Updating $KIT/"
changes=$(rsync -a -c -i --delete --exclude .DS_Store "$STAGE/$KIT/" "$KIT/")
changed=$(printf '%s\n' "$changes" | grep -c '^[>*]' || true)
if [[ $changed == 0 ]]; then
  say "   no file changed"
else
  say "   $changed file(s) added, changed or removed:"
  printf '%s\n' "$changes" | grep '^[>*]' | sed 's/^/     /' | head -60
  [[ $changed -le 60 ]] || say "     … and $((changed - 60)) more"
fi
# The idle animation's 1024 px transparent frames live outside the kit (07-debbie/debbie.md says where).
if [[ -d $STAGE/build/designer-kit/debbie-frames ]]; then
  mkdir -p build/designer-kit/debbie-frames
  rsync -a -c --delete "$STAGE/build/designer-kit/debbie-frames/" build/designer-kit/debbie-frames/
fi
[[ $KEEP_STAGE == 1 ]] || rm -rf "$STAGE"

say "== $KIT: $(du -sh "$KIT" | cut -f1 | tr -d ' '), $(find "$KIT" -type f | wc -l | tr -d ' ') files ($((SECONDS - started)) s)"
say "Not run here (they need the iOS Simulator): tools/design/kit/capture.sh renders, tools/design/kit/capture.sh"
say "recordings, and tools/screens/tour.sh --preview and --access. Run them first, then this script."
