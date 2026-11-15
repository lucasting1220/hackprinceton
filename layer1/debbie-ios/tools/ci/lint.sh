#!/usr/bin/env bash
# Source lints for CRAFT.md rules a regex can check (CRAFT.md §8 lint table; §9 "L" items).
# Brief §3: "A test or lint MUST fail on raw animation curves or haptic calls outside the
# design-system code." Every rule: ID, description, a Perl regex, and the paths it exempts.
# Exit 1 if any rule matches. Run from anywhere: tools/ci/lint.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

FILES=()
while IFS= read -r -d '' f; do FILES+=("$f"); done < <(
  find App NotificationService Packages/DebbieKit/Sources -name '*.swift' -print0 2>/dev/null)
if [[ ${#FILES[@]} -eq 0 ]]; then echo "lint: no Swift sources yet"; exit 0; fi

fail=0
# rule <id> <description> <perl-regex> <exempt-path-regex or "-">
rule() {
  local id="$1" desc="$2" re="$3" exempt="$4" hits
  hits="$(perl -ne '
      BEGIN { $re = shift @ARGV; $ex = shift @ARGV }
      my $skip = ($ex ne "-" && $ARGV =~ /$ex/) || /^\s*\/\//;   # exempt paths; whole-line comments
      print "$ARGV:$.: $_" if !$skip && /$re/;
      close ARGV if eof;                         # reset $. per file
    ' "$re" "$exempt" "${FILES[@]}" 2>/dev/null || true)"
  if [[ -n "$hits" ]]; then
    echo "✗ $id $desc"; printf '%s\n' "$hits" | sed 's/^/    /' | head -20; fail=1
  else
    echo "✓ $id $desc"
  fi
}

DS='Packages/DebbieKit/Sources/DebbieDesignSystem/'
MOTION='DebbieDesignSystem/Motion/'
HAPTICS='DebbieDesignSystem/Haptics/'
TOKEN='(?:Motion|motion|DebbieMotion|DebbieTransition)\.'

# --- Motion (CRAFT.md §3, brief §3) ---
rule M1 "withAnimation must take a named Motion token"            "withAnimation\\s*(?:\\{|\\(\\s*\\)|\\((?!\\s*$TOKEN))" "$MOTION"
rule M2 ".animation(_:value:) must take a named Motion token or nil" "(?<!TimelineView\\()\\.animation\\((?!\\s*(?:$TOKEN|nil\\b))" "$MOTION"
rule M3 "no raw curves or spring constructors outside Motion"     "(?:\\bAnimation\\.|[\\s(\\[,]\\.(?:spring|interpolatingSpring|interactiveSpring|smooth|snappy|bouncy|easeIn|easeOut|easeInOut|linear|timingCurve)\\b\\s*(?:\\(|$|[,)])|\\bSpring\\()" "$MOTION"
rule M4 ".transition / .contentTransition must use named tokens"  "\\.(?:transition|contentTransition)\\((?!\\s*$TOKEN)" "$MOTION"
rule M5 "no navigation transitions, animators or Core Animation outside the design system" \
  "\\.navigationTransition\\(|PhaseAnimator|KeyframeAnimator|UIView\\.animate|UIViewPropertyAnimator|CABasicAnimation|CASpringAnimation|CAKeyframeAnimation|CADisplayLink" "$DS"
rule M6 "symbol effects only through Motion tokens"               "\\.symbolEffect\\((?!\\s*$TOKEN)" "$MOTION"
rule M7 "no asyncAfter or Task.sleep in views (chain with completion criteria)" \
  "asyncAfter|Task\\.sleep" "(?:(?:DebbieNetworking|DebbieSecureStore|DebbieCrypto|DebbieCore|DebbieDebugTools|DemoHome|Tests)/|AppModel\\.swift|DebbieChatModel\\.swift|LocalNetworkPrompt\\.swift)"
rule M8 "no scroll-driven decorative motion"                      "scrollTransition|\\.visualEffect\\(" -

# --- Haptics (CRAFT.md §4) ---
rule H1 "haptics only through the design system's haptic map" \
  "sensoryFeedback\\(|UI(?:Impact|Notification|Selection)FeedbackGenerator|CHHapticEngine|AudioServicesPlaySystemSound" "$HAPTICS"

# --- Colour, type, spacing, shape, materials (CRAFT.md §2) ---
rule C1 "no literal colours outside the design system" \
  "Color\\((?:red|hue|white):|UIColor\\((?:red|hue|white|displayP3Red):|Color\\(\\s*#|\\bColor\\.(?:red|green|blue|mint|teal|orange|yellow|pink|purple|indigo|cyan|brown|gray|black|white|primary|secondary|accentColor)\\b|UIColor\\.(?:system\\w+|label|secondaryLabel)\\b|\\.foregroundStyle\\(\\s*\\.(?:red|green|blue|mint|teal|orange|yellow|pink|purple|indigo|gray|black|white|primary|secondary)\\b" "$DS"
rule T1 "no raw font sizes, caption styles or light weights outside the design system" \
  "\\.font\\(\\s*\\.system\\(size:|Font\\.system\\(size:|\\.font\\(\\s*\\.caption2?\\b|\\.fontWeight\\(\\s*\\.(?:ultraLight|thin|light)\\)|\\.weight\\(\\s*\\.(?:ultraLight|thin|light)\\)" "$DS"
rule L1 "no numeric literals in padding, spacing or frames outside the design system" \
  "\\.padding\\([^)]*(?<![\\w.])[1-9]|spacing:\\s*[1-9]|\\.frame\\([^)]*(?:width|height|minWidth|minHeight|maxWidth|maxHeight):\\s*[1-9]|\\.offset\\([^)]*(?<![\\w.])[1-9]" "$DS"
rule S1 "no literal corner radii outside the design system" "cornerRadius:\\s*\\d|\\.cornerRadius\\(" "$DS"
rule D1 "Liquid Glass only in design-system chrome" "\\.glassEffect\\(|buttonStyle\\(\\s*\\.glass|GlassEffectContainer|\\.glassProminent" "DebbieDesignSystem/Chrome/"
rule D2 "no soft scroll edge, custom sheet backgrounds or imitation glass" "scrollEdgeEffectStyle\\(\\s*\\.soft|presentationBackground\\(|UIBlurEffect|\\.ultraThinMaterial|\\.regularMaterial|\\.thinMaterial" "$DS"

# --- Stock glyphs and system-default controls (brief §3, CRAFT.md §5) ---
rule I1 "no SF Symbols or other system glyphs" "systemName:|systemImage:|UIImage\\(systemName|systemImageName:|iconWithSystemImageName" -
rule I2 "no label-less system buttons (iOS 26 draws a system glyph)" "Button\\(\\s*role:\\s*\\.\\w+\\s*(?:,\\s*action:\\s*[^)]*)?\\)\\s*(?:\\{|$)|ButtonRole\\.(?:close|confirm)" "$DS"
rule K1 "no system-default control styles outside the design system" \
  "\\.buttonStyle\\(\\s*\\.(?:bordered|borderedProminent|borderless|plain|automatic|glass)|\\.toggleStyle\\(\\s*\\.(?:switch|button|automatic)|\\.pickerStyle\\(\\s*\\.segmented|\\.progressViewStyle\\(\\s*\\.(?:circular|linear|automatic)|\\.textFieldStyle\\(\\s*\\.(?:roundedBorder|plain|automatic)|\\.navigationTitle\\(|\\.navigationBarTitleDisplayMode\\(|\\bTabView\\s*[{(]|\\.tabItem\\s*[{(]" "$DS"

# --- Safety (CRAFT.md §8) ---
rule R1 "no try!, as! or fatalError outside tests and debug tools" "try!|\\bas!\\s|fatalError\\(" "(?:Tests/|DebbieDebugTools/)"
rule R2 "Observation only (no ObservableObject / @Published)" "\\bObservableObject\\b|@Published\\b" -
rule R3 "no deprecated button-shapes API" "buttonShapesEnabled|accessibilityShowButtonShapes" -
rule R4 "no custom navigation transition animators" "UIViewControllerAnimatedTransitioning|UIViewControllerTransitioningDelegate" -
rule P1 "no print(); use os.Logger with privacy annotations" "(?:^|[^\\w.])print\\(" "(?:Tests/|DebbieDebugTools/)"
rule P2 "logger interpolations must declare privacy" "\\blog(?:ger)?\\.(?:debug|info|notice|error|fault|warning|trace|critical|log)\\(.*\\\\\\((?![^)]*privacy:)" "(?:Tests/)"

exit $fail
