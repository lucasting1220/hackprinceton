#!/usr/bin/env bash
# Validates an exported IPA before upload (brief §7 "Before each upload, validate the archive";
# research note 12 R14). Fails on any miss.  tools/ci/validate-ipa.sh <ipa> <expected-build-number>
set -uo pipefail
ipa="${1:?ipa}"; n="${2:?build number}"
mkdir -p build; work="$(mktemp -d "$PWD/build/validate.XXXXXX")"; trap 'rm -rf "$work"' EXIT
unzip -q "$ipa" -d "$work" || { echo "✗ cannot unzip $ipa"; exit 1; }
app="$(find "$work/Payload" -maxdepth 1 -name '*.app' | head -1)"
appex="$(find "$app/PlugIns" -maxdepth 1 -name '*.appex' 2>/dev/null | head -1)"
fail=0
check() { if eval "$2"; then echo "✓ $1"; else echo "✗ $1"; fail=1; fi; }
pl() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Info.plist" 2>/dev/null; }
check "CFBundleVersion == $n (app)" '[[ "$(pl "$app" CFBundleVersion)" == "$n" ]]'
check "CFBundleVersion == $n (extension)" '[[ -z "$appex" || "$(pl "$appex" CFBundleVersion)" == "$n" ]]'
check "ITSAppUsesNonExemptEncryption is false" '[[ "$(pl "$app" ITSAppUsesNonExemptEncryption)" == "false" ]]'
for key in NSCameraUsageDescription NSLocalNetworkUsageDescription NSHealthShareUsageDescription NSHealthUpdateUsageDescription; do
  check "$key present" '[[ -n "$(pl "$app" $key)" ]]'
done
check "CFBundleShortVersionString matches (app, extension)" '[[ -z "$appex" || "$(pl "$app" CFBundleShortVersionString)" == "$(pl "$appex" CFBundleShortVersionString)" ]]'
check "UIDeviceFamily is iPhone only (D-022)" '[[ "$(pl "$app" UIDeviceFamily | grep -cE "^[[:space:]]+[0-9]+$")" == "1" && -n "$(pl "$app" UIDeviceFamily | grep -E "^[[:space:]]+1$")" ]]'
check "NSBonjourServices has _debbie._tcp" '/usr/libexec/PlistBuddy -c "Print :NSBonjourServices" "$app/Info.plist" | grep -q "_debbie._tcp"'
check "UILaunchScreen has only UIColorName" '[[ "$(/usr/libexec/PlistBuddy -c "Print :UILaunchScreen" "$app/Info.plist" | grep -c "=")" == "1" ]]'
# Debbie's Gemini key is optional: without it the chat answers on the phone (D-031). Report it either way, without the value.
if [[ -n "$(pl "$app" DebbieGeminiKey)" ]]; then echo "✓ Debbie's Gemini key present (value not shown)"; else echo "! no Gemini key: Debbie answers with on-device wording"; fi
check "PrivacyInfo.xcprivacy in app" '[[ -f "$app/PrivacyInfo.xcprivacy" ]]'
check "app icon compiled into Assets.car" 'xcrun assetutil --info "$app/Assets.car" 2>/dev/null | grep -q "AppIcon"'
ents="$(codesign -d --entitlements - --xml "$app" 2>/dev/null)"
check "aps-environment = production" 'printf "%s" "$ents" | grep -A1 "aps-environment" | grep -q "production"'
check "time-sensitive entitlement" 'printf "%s" "$ents" | grep -q "com.apple.developer.usernotifications.time-sensitive"'
check "keychain-access-groups (app)" 'printf "%s" "$ents" | grep -q "keychain-access-groups"'
check "keychain-access-groups (extension)" '[[ -n "$appex" ]] && codesign -d --entitlements - --xml "$appex" 2>/dev/null | grep -q "keychain-access-groups"'
check "embedded.mobileprovision present (App Store profile)" '[[ -f "$app/embedded.mobileprovision" ]]'
check "extension links no WebRTC or SwiftUI" '[[ -z "$appex" ]] || ! otool -L "$appex/$(basename "$appex" .appex)" | grep -qE "WebRTC|SwiftUI"'
exit $fail
