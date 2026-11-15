# 14 What belongs in Settings
_Researched 2026-11-14 by the lead (not one of the 13 brief topics; it answers brief §5.1 item 8, "Settings: unpair, plus whatever your research says belongs here"). Toolchain: Xcode 26.6 / iOS 26.5 SDK._

## Questions answered
"Settings: unpair, plus whatever your research says belongs here." (KICKOFF_PROMPT.md §5.1.8)

## Summary
- Apple asks apps to minimise settings, give defaults that suit most people, and keep task-specific options inside the task [S1].
- Apps must not copy system-wide settings such as accessibility, appearance or authentication into their own settings; they should respect the system's [S1].
- When something lives in the system Settings app (notification permission, for example), the app may offer a button that opens it directly [S1][S2].
- Debbie therefore keeps an in-app Settings screen to five groups: this iPhone, home connection, notifications, privacy and help, and Unpair.

## Findings
- HIG Settings, "Best practices": "Minimize the number of settings you offer", "Avoid using settings to ask for setup information you can get in other ways", "Respect people's systemwide settings and avoid including redundant versions of them in your custom settings area" [S1].
- HIG Settings, "Task-specific options": prefer letting people change task options in the screens they affect [S1]. For Debbie, live-view controls stay on the live-view screen, and the resident's live-view permission stays on the resident screen. They don't move into Settings.
- HIG Settings, "System settings": "consider providing a button that opens it directly from your interface" [S1]. The developer API is `UIApplication.openNotificationSettingsURLString` (iOS 16+; the Objective-C constant `UIApplicationOpenNotificationSettingsURLString` is deprecated since iOS 16, verified in local SDK UIKit headers), which opens the app's notification settings page [S2].
- Reasoning: a caregiver who has turned notifications off won't get alerts. So Settings must show the current notification authorisation (including whether time-sensitive delivery is allowed), and offer the system shortcut when it's off. This follows the "never show an all-clear you can't confirm" rule (Layer 1 doc, "When things fail").
- Reasoning: the Layer 1 doc's phone screens list "Settings (unpair)" and resident mode "(heart-rate permission, last reading, Sync now, live view on/off)". In the one-iPhone demo, a caregiver phone "can also turn on resident mode" (Layer 1 doc, "Decided: Phone pairing"), so a caregiver phone needs that switch somewhere stable. Settings is the right home, because it's infrequent and phone-wide [S1].

## What changed in the current iOS release
Nothing relevant. The HIG Settings page was last reorganised on June 10, 2024 [S1].

## Recommendations for Debbie
- R1. Settings contains exactly these groups, in this order: **This iPhone** (name, role, the "Resident mode on this iPhone" switch for caregiver phones), **Home** (home name, current route: Home Wi-Fi or Internet relay, last contact), **Notifications** (status in words, plus an "Open iPhone Settings" button when alerts are off or not time-sensitive), **Privacy and help** ("What Debbie can see", "If Debbie can't reach home"), **About** (version and build), then **Unpair this iPhone** (destructive, with confirmation). [S1] ADOPT-TONIGHT: Settings is in scope (§5.1.8).
- R2. No appearance, text-size, motion or haptics toggles in Debbie's settings: the system settings govern them [S1]. ADOPT-TONIGHT.
- R3. Live-view controls stay on the live-view and resident screens, not in Settings [S1]. ADOPT-TONIGHT.
- R4. Unpair deletes every Keychain item for this home, tells the hub (`unpair` command, CONTRACTS §3), and revokes the credential at the relay (`POST /v1/unpair`). If the home can't be reached, it still deletes everything locally and says so. Reasoning: a lost or sold phone must not keep the home key. ADOPT-TONIGHT.

## Open questions / risks
- A Debug-only "Developer" group (mock-home controls, transport switch) appears only in Debug builds; Release never compiles it (brief §3).

## Sources
- [S1] Settings — Apple Human Interface Guidelines — https://developer.apple.com/design/human-interface-guidelines/settings — changelog last entry June 10, 2024 — accessed 2026-11-14 — primary
- [S2] openNotificationSettingsURLString — Apple Developer Documentation — https://developer.apple.com/documentation/uikit/uiapplication/opennotificationsettingsurlstring — undated (iOS 16+) — accessed 2026-11-14 — primary
