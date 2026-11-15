# 13 Platform extras: notification actions, interruption levels, widgets, Live Activities, Controls, App Intents, StandBy

_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: **iOS 27.2.1** (released 9 Nov 2026; iOS 27.0 shipped 14 Sep 2026) [S1]._

## Questions answered

> "Platform extras featured apps use, such as widgets, Live Activities, App Intents and notification actions: which would genuinely help a caregiver, and at what cost. Build the ones you can justify only after 5.1 passes its gates." (KICKOFF_PROMPT.md §9, topic 13 [S32])

For each candidate, this note covers four things: what it gives a caregiver, what it costs to build (new targets, entitlements, relay work), how much it exposes on the Lock Screen, and whether to adopt it tonight or later. The candidates are notification actions and categories, interruption levels and their entitlements, notification summaries and Focus, widgets (App Groups and refresh limits), Live Activities (push-to-start and relay changes), Controls, App Intents with Siri and Shortcuts ("Is Mum okay?"), and StandBy.

## Summary

- **Time Sensitive is core push work, not an extra.** The Layer 1 doc already requires it [S31]. It needs only the `com.apple.developer.usernotifications.time-sensitive` entitlement, which requires no Apple approval [S7]. It overrides scheduled summaries and breaks through Focus, but not the Ring/Silent switch [S3].
- **One extra clears the bar for tonight, once 5.1 passes its gates:** an actionable alert notification with a single "I'm On It" acknowledge action, marked `.authenticationRequired`. It is cheap, it uses the push path we must build anyway, and it saves a stressed caregiver the trip into the app just to say "seen" [S2][S9].
- **Critical alerts would be the biggest safety gain**, because they sound even when the phone is muted or in Do Not Disturb. They need an entitlement Apple grants through a request form, which can't happen tonight → LATER [S4][S5][S7].
- **Live Activities fit poorly** [S14][S15][S18]:
  - The relay would need work: the `liveactivity` push type and topic, per-activity tokens, and token-based APNs. AWS documents the SNS attributes needed but not the `liveactivity` value itself.
  - The system decodes the content state itself (there is no service-extension step), so the alert text could not stay end-to-end encrypted.
  - Anything shown sits on the Lock Screen, in StandBy and on the Always-On display.
  - Verdict: LATER at best, and probably never for alerts.
- **A status widget (with StandBy) is the best candidate after the hackathon.** It needs a new extension target and App Group, a status snapshot written by the app, careful handling of stale data (the refresh budget is 40–70 reloads per day), `.privacySensitive()`, and custom glyphs. Tonight it is blocked anyway: no `BUNDLE_ID`, so no extension ID can be registered [S19][S20][S22][S35].
- **Controls and the App Intent "How's home?"** are moderately useful and moderately costly, and they carry a privacy risk (status spoken aloud, or shown on a locked device). Both must require authentication → LATER [S25][S26][S27].
- **Communication notifications: no.** They are for direct communication such as calls and messages [S3].
- **The brief's no-SF-Symbols rule** affects these extras. Notification action icons must use `UNNotificationActionIcon(templateImageName:)` with Debbie's own asset. App Shortcuts can leave out `systemImageName`. Widgets and Controls need custom glyphs (all verified in local SDK [S8]).
- **APNs keeps only one stored notification per app per device** while the phone is offline [S36]. A later notice can therefore overwrite an earlier fall alert, so fetching alerts when the app opens remains the backstop. This is a risk for the relay builders.

## Findings

### 1. Interruption levels, Focus and summaries

- **The four levels** [S3]:

| Level | Overrides scheduled delivery | Breaks through Focus | Overrides Ring/Silent |
|---|---|---|---|
| Passive | No | No | No |
| Active (default) | No | No | No |
| Time Sensitive | Yes | Yes | No |
| Critical | Yes | Yes | Yes |

- **Apple's descriptions** [S3]:
  - Time Sensitive is "Information that directly impacts the person and requires their immediate attention".
  - Critical is "Urgent information about health and safety … typically come[s] from governmental and public agencies or apps that help people manage their health or home."
- **Time Sensitive is under the user's control.**
  - The first Time Sensitive notification explains how they work and offers to turn them off, and the system re-asks the user periodically [S3].
  - Use the level only for events happening now or within an hour [S3].
  - The user can turn Time Sensitive off per app [S4][S12].
- **Critical alerts** always present, even in Do Not Disturb. They play the default critical sound if none is given, and they "require an approved entitlement" [S4][S11].
- **Payload keys** (`aps`) [S37]:
  - `interruption-level`: `"passive"`, `"active"`, `"time-sensitive"` or `"critical"`.
  - `relevance-score`: 0 to 1; the highest score is featured in the summary [S13].
  - `category`.
  - `sound` as a dictionary for critical alerts.
  - Maximum payload: 4 KB.
- **Relevant user settings on iOS 27** [S12]:
  - Per-app Time Sensitive Notifications.
  - Show Previews: Always, When Unlocked or Never.
  - Scheduled Summary per app.
  - Prioritize Notifications.
  - Apple Intelligence summaries of long or stacked notifications (iPhone 15 Pro and later on iOS 27).
  - I found no API that lets an app opt out of Apple Intelligence summaries. The only summary APIs in the iOS 26.5 UserNotifications headers are the old `categorySummaryFormat` and the deprecated `summaryArgument` (verified in local SDK [S8]).
- **Reading the user's choices.** The app can read them with `UNUserNotificationCenter.notificationSettings()`: `timeSensitiveSetting`, `showPreviewsSetting`, `scheduledDeliverySetting` and `criticalAlertSetting`. It can deep-link with `UIApplication.openNotificationSettingsURLString` (iOS 16) (all verified in local SDK [S8]).
- **Focus.** It "might delay the delivery of a notification alert" but "the notification itself is available as soon as it arrives" [S3]. The Layer 1 demo checklist already says to turn Focus and Do Not Disturb off on the demo phone [S31].
- **Communication notifications** are for "direct communications — like phone calls and messages" and need SiriKit intents such as `INSendMessageIntent` [S3]. Debbie's alerts aren't person-to-person messages. Reasoning: dressing them up as communications to get through Focus would misuse the category.

### 2. Entitlements and what each needs

- **Time Sensitive Notifications** [S7] (from Xcode's local capability catalogue):
  - Key: `com.apple.developer.usernotifications.time-sensitive`, Boolean.
  - Public, with no approval step and no request form (`isPublic: true`, `distributionApprovalRequired: false`, no request-form URL).
  - The old `UNAuthorizationOptionTimeSensitive` is deprecated with "Use time-sensitive entitlement" (verified in local SDK [S8]).
- **Critical Alerts** [S5][S7]:
  - Key: `com.apple.developer.usernotifications.critical-alerts`.
  - Not public: requested through https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/.
  - Once granted, the app must also ask the user for the separate `.criticalAlert` permission [S6] (`UNAuthorizationOptionCriticalAlert`, iOS 12, verified [S8]).
- **Push Notifications** (`aps-environment`) is already part of 5.1 [S31].
- **Widgets, Controls and Live Activities** need a widget extension target. Each new target needs its own App ID of the form `BUNDLE_ID.<suffix>`. Sharing data needs an App Group whose container ID starts with `group.` and is registered in the developer account [S24]. The brief allows only `BUNDLE_ID.<suffix>` IDs and the matching app and keychain groups, each listed in PROGRESS.md first [S32]. Tonight `BUNDLE_ID` is missing, so nothing can be registered [S35].

### 3. Notification actions and categories

- **How they work** [S9]:
  - Categories are declared at launch with `UNNotificationCategory` and `UNNotificationAction`.
  - A remote push selects one with `aps.category`.
  - When the user taps an action, "the system launches your app in the background" and calls `userNotificationCenter(_:didReceive:withCompletionHandler:)`.
- **Action options** [S8] (verified in local SDK):
  - `.authenticationRequired`, `.destructive`, `.foreground`.
  - Icons: `UNNotificationActionIcon(templateImageName:)` takes a custom asset; `(systemImageName:)` takes an SF Symbol.
  - Category options include `.hiddenPreviewsShowTitle` and `.hiddenPreviewsShowSubtitle`.
  - `hiddenPreviewsBodyPlaceholder` sets the text shown when previews are hidden.
- **HIG guidance** [S2]:
  - At most four actions.
  - Short title-case labels.
  - No action that merely opens the app.
  - Prefer nondestructive actions.
  - Give each action an icon.
  - Write generic placeholder text for when previews are hidden.
  - Don't put sensitive information in notifications.
  - Don't send several notifications about the same thing.
- **Apple Watch.** Double tap "selects the first nondestructive action" [S2]. So the first action in the list is what a caregiver's Watch double-tap triggers.
- **The notification service extension** has "only about 30 seconds" [S10]. It needs `mutable-content: 1` and an `alert` dictionary. Apple's own encrypted-push sample payload carries `"category"` in `aps` [S10].
  - Reasoning: setting the category from the relay is the documented route. Changing `categoryIdentifier` inside the extension after decrypting is unverified.
- **Debbie's ack contract.** Acknowledgements are encrypted with the phone's own key, safe to send twice, and queued until sent [S32]. A background action handler fits that design: persist the ack, try to send it, call the completion handler.
  - Reasoning: the encrypted alert is in the notification's `userInfo`, so the handler can decrypt it with the home key to get `alert_id`. The keychain is readable after first unlock [S31].

### 4. Lock-screen privacy of notifications

- The HIG says to avoid sensitive personal information in notifications [S2]. But Layer 1 deliberately decrypts in the extension "so the notification says what happened" [S31].
  - Reasoning: the caregiver needs that text, so the safeguards are the user's Show Previews setting [S12], a generic `hiddenPreviewsBodyPlaceholder`, and keeping clinical details such as heart-rate numbers out of push-visible `title` and `body`.
- **APNs storage.** "APNs stores only one notification per bundle ID … In most cases, the latest notification is stored" [S36]. Reasoning: if the caregiver's phone is offline, a later relay notice can replace an earlier fall alert. The app's fetch with a cursor on launch (5.1 item 2) is what guarantees nothing is missed.
- **Collapse ID.** `apns-collapse-id` (at most 64 bytes) merges updates into one notification [S36]. Layer 1 already uses the `alert_id` for this [S31].

### 5. Widgets, StandBy, App Groups and refresh budgets

- **Value.** Widgets show "timely, glanceable content". Lock Screen widgets work like complications: "don't treat it as an additional way for people to launch into your app" [S19].
- **StandBy** [S19]:
  - Two small widgets sit side by side, scaled up, with the background removed.
  - The system renders them red in low light.
  - Rich colour shouldn't carry the meaning there.
  - The background must be marked removable: `containerBackground(_:for:)` (iOS 17) and `containerBackgroundRemovable(_:)` (verified [S8]).
  - Small widgets also appear on Apple HomeView, which is new [S19].
- **Refresh budget** [S20]:
  - A frequently viewed widget typically gets 40–70 reloads a day, "roughly … every 15 to 60 minutes".
  - Timeline entries should be at least about 5 minutes apart.
  - Reloads while the app is in the foreground don't count.
  - StandBy refreshes on its own schedule.
- **WidgetKit push** (iOS 26) [S21] (`WidgetPushHandler` and `pushHandler(_:)` verified iOS 26.0 [S8]):
  - Headers: `apns-push-type: widgets`, `apns-topic: <bundleID>.push-type.widgets`, plus `content-changed: true` in the payload.
  - Pushes are budgeted and "delivered opportunistically", so they add to timeline reloads rather than replace them.
  - Channels (broadcast) aren't supported.
- **Privacy** [S22]:
  - Mark views with `privacySensitive(_:)` (verified [S8]). People can then hide that content on a locked device.
  - Alternatively, give the extension the Data Protection capability. With `NSFileProtectionComplete`, WidgetKit hides widget content while the device is locked, and iOS widgets aren't offered as iPhone widgets on Mac.
- **Sharing data.** App and extension share a container through an App Group, using `UserDefaults(suiteName:)` or `containerURL(forSecurityApplicationGroupIdentifier:)` [S24].
- **Rendering modes.** Test in full colour, tinted and clear. In accented mode the system removes the widget's background and replaces it with a tint or with Liquid Glass. Images may need `widgetAccentedRenderingMode` (iOS 18, verified [S8]) to render correctly [S19][S23].
- **The Debbie-specific difficulty.** Reasoning: the status has to be decrypted with the home key. A widget can't reload on demand, so it will often show data minutes or hours old. The brief forbids "an all-clear you can't confirm" [S32]. So any widget must show when the status was confirmed, and must switch to "unknown" by itself through a dated timeline entry.

### 6. Live Activities

- **Fit** [S14]:
  - Meant for tasks "that have a defined beginning and end", up to eight hours.
  - "Avoid displaying sensitive information": they are visible on the Lock Screen and Always-On display.
  - "don't use push notifications alongside Live Activities for the same updates".
  - End them immediately when the event ends; they stay on the Lock Screen for up to four hours afterwards.
- **Limits** [S16]:
  - Active for at most 8 hours, then shown on the Lock Screen for up to 4 more (12 hours total).
  - Static and dynamic data together must stay under 4 KB.
- **Push mechanics** [S15]:
  - Headers: `apns-push-type: liveactivity`, `apns-topic: <bundleID>.push-type.liveactivity`, `apns-priority` 5 or 10.
  - A token-based connection to APNs.
  - Per-activity push tokens from `pushTokenUpdates`.
  - Push-to-start on iOS 17.2 and later (`pushToStartToken` / `pushToStartTokenUpdates`, verified iOS 17.2 [S8]).
  - Channel broadcast with `PushType.channel(_:)` (iOS 18, verified [S8]).
  - An hourly budget, with `NSSupportsLiveActivitiesFrequentUpdates` to raise it.
  - "The system can decode the JSON payload … the system wakes the widget extension to render the UI." Reasoning: there is no service-extension step that could decrypt end-to-end content before display.
- **The relay** sends through Amazon SNS [S31]. SNS lets you set the `AWS.SNS.MOBILE.APNS.TOPIC`, `PUSH_TYPE` and `PRIORITY` attributes, but "can infer only alert or background" itself. AWS gives no explicit example of `liveactivity` [S18].
  - Reasoning: it might work, but each activity token would need its own SNS endpoint and an untested push type.
- **iOS 27** shows Live Activities in the Dynamic Island in landscape too, and adds `isDynamicIslandLimitedInWidth` [S16][S17]. That API is **absent from our iOS 26.5 SDK** (0 matches [S8]) and needs a newer SDK.
- **The live-view session as a Live Activity.** Reasoning: it doesn't help. Video doesn't play once the app leaves the screen, and a session left running in the background would keep the resident's "someone is watching" notice on with nobody watching. Debbie should stop live view when it goes to the background instead.

### 7. Controls (iOS 18)

- **What they are.** Buttons or toggles in Control Center, on the Lock Screen and on the Action button [S25].
- **Guidance** [S25]:
  - "Hide sensitive information when the device is locked."
  - "Require authentication for actions that affect security."
  - The symbol "can be a symbol from SF Symbols … or a custom symbol".
- **APIs.** `ControlWidget`, `StaticControlConfiguration`, `ControlWidgetButton` (iOS 18.0), `ControlWidgetTemplate.privacySensitive(_:)`, and `ControlPushHandler` (iOS 18.0) (verified [S8]). A control lives in a widget extension, so it has the same target and signing cost as a widget.
- **Possible Debbie controls.** "Live view" (opens the app), or "Ask home to check" (the `check_now` request, whose contract is only PROPOSED and whose Layer 4 side doesn't exist yet [S31]).

### 8. App Intents, Siri and Shortcuts ("Is Mum okay?")

- **App Intents is the hub for all of these.** Apple calls it "how our platforms understand what your apps can do". It feeds the Action button, Shortcuts, widgets and Siri AI [S34].
- **App Shortcuts** [S26]:
  - Run from Siri, Spotlight, Shortcuts and the Action button.
  - Up to 10 per app.
  - The phrase "has to include your app name".
  - Responses on audio-only devices (AirPods, HomePod) must carry all critical information in the spoken dialogue.
  - `AppShortcut(intent:phrases:shortTitle:systemImageName:)` lets `systemImageName` default to `nil` (verified [S8]), so we can avoid SF Symbols.
- **Authentication** [S27] (`IntentAuthenticationPolicy` verified [S8]):
  - `.alwaysAllowed` runs even when the device is locked.
  - `.requiresAuthentication`: an unlocked paired Watch counts.
  - `.requiresLocalDeviceAuthentication` makes the user unlock the phone itself.
- **iOS 26 change.** `openAppWhenRun` is deprecated in favour of `supportedModes` (verified [S8]).
- **iOS 27.** Siri AI and app schemas [S28][S30]. None of the schema domains in the iOS 26.5 SDK fits home monitoring. They are word processor, whiteboard, spreadsheet, reader, presentation, photos, mail, journal, files, camera, browser and books (verified [S8]). The new Siri AI capabilities need the iOS 27 SDK.
- **Snippets** (new HIG page, June 2026) are at most 400 pt tall. Prefer a visual result over repeating the dialogue [S29].

### 9. Value, cost and risk at a glance

| Extra | Value to a caregiver | Engineering cost | Privacy risk | Verdict |
|---|---|---|---|---|
| Time Sensitive level | High: alerts get through Focus and summaries [S3] | Low: one entitlement, no approval [S7]; relay sets `interruption-level` [S31][S37] | None new | **ADOPT-TONIGHT** (core 5.1) |
| "I'm On It" notification action | High: acknowledge in two taps from the Lock Screen or Watch [S2][S9] | Low: categories at launch, background handler, existing ack queue; relay adds `aps.category` (PROPOSED); custom icon | Low with `.authenticationRequired` [S8] | **ADOPT-TONIGHT** after 5.1 gates |
| Critical alerts | Highest for a possible fall: sounds even on mute or DND [S3][S4] | Blocked: Apple approval [S5]; extra permission prompt [S6]; relay sound dictionary [S37] | Low | LATER |
| Communication notifications | None (not person-to-person) [S3] | Medium (SiriKit) | — | No |
| Status widget + StandBy | Medium-high: glanceable "home OK / can't reach home" | Medium-high: new target, App ID, App Group, snapshot writer, stale-data logic, custom glyphs; optional relay push [S20][S21][S24] | Medium: Home Screen, Lock Screen and StandBy are visible to others [S19][S22] | LATER (first after the hackathon) |
| Live Activity for an open alert | Medium | High: tokens, push-to-start, new push type and topic through SNS, 4 KB limit, no way to decrypt [S15][S16][S18] | High: Lock Screen, StandBy, Always-On [S14] | LATER, probably never |
| Live Activity for a live-view session | Low (video stops in the background) | Medium | Medium | No |
| Control | Low-medium | Medium: needs a widget extension and the unbuilt `check_now` [S25][S31] | Medium: must require authentication [S25] | LATER |
| App Shortcut "How's home?" | Medium: hands-free check | Low-medium: in-app intent and dialog, no new target [S26] | Medium-high: spoken aloud [S26] | LATER |

## What changed in the current iOS release

- **[CHANGED, iOS 27]** Live Activities appear in the Dynamic Island in landscape, and a limited-width compact layout (28 pt circle) is recommended. The HIG Live Activities page was updated on 13 Oct 2026 [S14][S16][S17]. **Needs the iOS 27 SDK:** `isDynamicIslandLimitedInWidth` is absent locally [S8].
- **[CHANGED, iOS 27]** Widgets now also appear on Apple HomeView. The HIG Widgets page was updated on 13 Oct 2026 [S19].
- **[CHANGED, iOS 27]** Siri AI and app schemas; the HIG Siri page was revised on 8 Jun 2026 and a Snippets page added [S28][S29]. App Shortcuts guidance now points to app schemas first [S26]. The new App Intents capabilities need the iOS 27 SDK [S30].
- **[iOS 26, usable with our SDK]** WidgetKit push notifications (`WidgetPushHandler`, iOS 26.0) [S21][S8]. `supportedModes` replaces `openAppWhenRun` [S8]. Live Activities can be scheduled to start (`request(… start:)`, iOS 26.0) [S8][S17].
- **Notifications:** I found no change in iOS 27. WWDC26 has no notifications session [S33]. The HIG Notifications page was last changed on 24 Oct 2023 [S2]. On the user side, iOS 27's settings include Prioritize Notifications and Apple Intelligence summaries on iPhone 15 Pro and later [S12].

## Recommendations for Debbie

R1. **Time Sensitive pushes.**
  - Add `com.apple.developer.usernotifications.time-sensitive = true` to the app's entitlements.
  - Keep Layer 1's rule: every hub-encrypted alert push uses `"interruption-level": "time-sensitive"` with `"relevance-score": 1.0` [S31][S37].
  - PROPOSE in CONTRACTS.md that the relay-written "hub offline" notice is `"time-sensitive"` (0.8) and "back online" is `"active"` (0.3).
  - Check: the entitlement is present in the built app, and the mock home's payload tests cover all four classes.
  - Cites [S3][S7][S31][S37]. **ADOPT-TONIGHT** (core 5.1 push, not an extra). Why: Layer 1 requires it, and it's the only no-approval way through Focus and Scheduled Summary.

R2. **One actionable alert category, after 5.1 passes its gates.**
  - At launch, register category `debbie.alert` with one action `debbie.ack` and `hiddenPreviewsBodyPlaceholder` "Alert from home".
  - The action is titled in title case per CRAFT voice rules (working label "I'm On It"), with options `[.authenticationRequired]` and icon `UNNotificationActionIcon(templateImageName: <Debbie asset>)`.
  - Register category `debbie.notice` with no actions and placeholder "Home status".
  - The relay sets `aps.category` (PROPOSED in CONTRACTS.md).
  - The handler decrypts `userInfo` to get `alert_id`, persists the ack with `false_alarm=false`, tries one send, then calls the completion handler. The queue retries later.
  - Don't offer "False alarm" on the notification: it needs context, so keep it in the app.
  - Cites [S2][S8][S9][S10][S32]. **ADOPT-TONIGHT** (after the 5.1 gates). Why: very low cost, high stress relief, and it reuses the ack queue.

R3. **Lock-screen hygiene.**
  - Never set `.hiddenPreviewsShowTitle`.
  - PROPOSE to Layer 4 (CONTRACTS.md) that push-visible `title` and `body` never contain heart-rate numbers or the resident's full name.
  - Settings shows rows for "Time Sensitive", "Previews" and "Scheduled Summary", read from `notificationSettings()` (`timeSensitiveSetting`, `showPreviewsSetting`, `scheduledDeliverySetting`), with a button that opens `UIApplication.openNotificationSettingsURLString`.
  - Cites [S2][S8][S12]. **ADOPT-TONIGHT.** Why: privacy cost near zero, and the caregiver can see why an urgent alert might not break through.

R4. **Never silence alert updates** (`update: true`, same collapse ID). Keep the default sound unless the extension can prove the original `alert_id` was already shown. That would need shared storage of shown IDs, which is LATER.
  - Cites [S36]. Reasoning: APNs may store only the latest notification while the phone is offline, so the update could be the first one the caregiver ever sees. **ADOPT-TONIGHT.** Why: safety over neatness.

R5. **Demo phone checklist** (add to the README): Focus and DND off, Debbie's Time Sensitive on, Scheduled Summary off for Debbie, Show Previews "Always" for the demo.
  - Cites [S12][S31]. **ADOPT-TONIGHT.** Why: each of these settings can silently swallow the demo's key moment.

R6. **Critical alerts.** After the hackathon, submit the request form with the use case "possible fall of an older relative living alone".
  - If granted: prime and request `.criticalAlert`; send `interruption-level: "critical"` and `sound: {critical: 1, name, volume}` only for `kind = possible_fall`, never for hub status.
  - Cites [S3][S5][S6][S37]. **LATER.** Why: Apple approval can't be obtained tonight.

R7. **Status widget, the first post-hackathon extra.**
  - A `systemSmall` widget plus `accessoryRectangular`.
  - The app writes a snapshot `{state, confirmedAt, staleAfter}` to the App Group container: no keys, no alert text.
  - The timeline has an entry at `staleAfter` that switches to "Unknown — open Debbie".
  - Show the confirmation time with `Text(confirmedAt, style: .relative)`.
  - Alert lines get `.privacySensitive()`.
  - Mark the background removable for StandBy, and test the red Night mode, tinted and clear renderings.
  - Use custom glyphs only.
  - Optional WidgetKit push later.
  - Cites [S19][S20][S21][S22][S24][S32]. **LATER.** Why: a new target and App Group need `BUNDLE_ID` (missing), and the brief puts extras after 5.1.

R8. **Live Activities.** Don't build them for alerts or for live view. Revisit only if the hub can supply a generic, non-sensitive state (for example "Alert open — not yet acknowledged") and the relay can send `liveactivity` pushes.
  - Cites [S14][S15][S16][S18]. **LATER.** Why: they break end-to-end encryption or add nothing over the notification, need new relay work, and expose content on the Lock Screen.

R9. **Control and App Shortcut** after the widget.
  - App Shortcut phrase including "Debbie" (for example "How's home in Debbie"), answered from the cached status. It must say "I can't confirm" when the heartbeat is stale, and never give a stale all-clear.
  - Use `.requiresLocalDeviceAuthentication`, or `.requiresAuthentication` if Watch use is wanted.
  - No `systemImageName`.
  - No health numbers in the dialogue.
  - Any live-view control requires authentication.
  - Cites [S25][S26][S27][S32]. **LATER.** Why: moderate value, privacy risk from spoken status, and they come after core flows and the widget.

R10. **Communication notifications: none.** Don't use `INSendMessageIntent` to get through Focus.
  - Cites [S3]. **LATER (never).** Why: Debbie's alerts aren't direct messages; Time Sensitive is the correct mechanism.

## Open questions / risks

- **Category from the extension.** Can the extension set `categoryIdentifier` after decrypting, so the relay never needs `aps.category`? Unverified; test on a device [S10].
- **Watch double-tap.** On a caregiver's Apple Watch, double tap runs the first nondestructive action [S2]. Does `.authenticationRequired` change that on the Watch? Untested. Note that "I'm On It" by double tap is probably what the caregiver means.
- **Stored-notification overwrite** [S36]. Ask the relay builders whether a relay notice could say that unfetched alerts exist (they know the fetch cursor). Record this under "For the bridge and relay builders".
- **SNS and `liveactivity`.** Not documented by AWS. Only relevant if R8 is ever revisited [S18].
- **Notification wording is a Layer 4 decision.** R3 is only a proposal [S31].
- **Users can turn off Time Sensitive.** The system periodically asks them to evaluate it [S3]. A family that turns it off loses Focus breakthrough. The R3 settings row makes that visible.

## Sources

[S1] Apple security releases — Apple Support — https://support.apple.com/en-us/100100 — rolling page, newest entry 13 Nov 2026 — accessed 2026-11-14 — primary
[S2] HIG: Notifications — Apple — https://developer.apple.com/design/human-interface-guidelines/notifications — last changed 24 Oct 2023 — accessed 2026-11-14 — primary
[S3] HIG: Managing notifications — Apple — https://developer.apple.com/design/human-interface-guidelines/managing-notifications — undated — accessed 2026-11-14 — primary
[S4] UNNotificationInterruptionLevel (and `.timeSensitive`, `.critical`) — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel — undated — accessed 2026-11-14 — primary
[S5] Critical Alerts entitlement — Apple Developer Documentation — https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts — undated — accessed 2026-11-14 — primary
[S6] UNAuthorizationOptions.criticalAlert — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/unauthorizationoptions/criticalalert — undated — accessed 2026-11-14 — primary
[S7] Xcode 26.6 capability catalogue (`DVTPortalCachedPortalCapabilities.json`: "Time Sensitive Notifications", "Critical Alerts") — Apple, local: /Applications/Xcode.app/Contents/SharedFrameworks/DVTPortal.framework/Versions/A/Resources/ — undated — accessed 2026-11-14 — primary (verified locally)
[S8] iOS 26.5 SDK interfaces and headers (UserNotifications, ActivityKit, WidgetKit, AppIntents, SwiftUI, UIKit) — Apple, Xcode 26.6 (17F113), local: /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk — built Apr 2026 — accessed 2026-11-14 — primary (verified in local SDK)
[S9] Declaring your actionable notification types — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types — undated — accessed 2026-11-14 — primary
[S10] Modifying content in newly delivered notifications — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications — undated — accessed 2026-11-14 — primary
[S11] Send communication and Time Sensitive notifications (WWDC21 session 10091) — Apple — https://developer.apple.com/videos/play/wwdc2021/10091/ — June 2021 — accessed 2026-11-14 — primary
[S12] Change notification settings on iPhone (iPhone User Guide, iOS 27) — Apple Support — https://support.apple.com/guide/iphone/change-notification-settings-iph7c3d96bab/ios — undated — accessed 2026-11-14 — primary
[S13] UNNotificationContent.relevanceScore — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/unnotificationcontent/relevancescore — undated — accessed 2026-11-14 — primary
[S14] HIG: Live Activities — Apple — https://developer.apple.com/design/human-interface-guidelines/live-activities — last changed 13 Oct 2026 — accessed 2026-11-14 — primary
[S15] Starting and updating Live Activities with ActivityKit push notifications — Apple Developer Documentation — https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications — undated — accessed 2026-11-14 — primary
[S16] Displaying live data with Live Activities — Apple Developer Documentation — https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities — undated — accessed 2026-11-14 — primary
[S17] Live Activities essentials (WWDC26 session 223) — Apple — https://developer.apple.com/videos/play/wwdc2026/223/ — June 2026 — accessed 2026-11-14 — primary
[S18] Publishing with platform-specific payloads (Amazon SNS Developer Guide) — AWS — https://docs.aws.amazon.com/sns/latest/dg/sns-send-custom-platform-specific-payloads-mobile-devices.html — undated — accessed 2026-11-14 — primary (AWS vendor documentation)
[S19] HIG: Widgets — Apple — https://developer.apple.com/design/human-interface-guidelines/widgets — last changed 13 Oct 2026 — accessed 2026-11-14 — primary
[S20] Keeping a widget up to date — Apple Developer Documentation — https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date — undated — accessed 2026-11-14 — primary
[S21] Updating widgets with WidgetKit push notifications — Apple Developer Documentation — https://developer.apple.com/documentation/widgetkit/updating-widgets-with-widgetkit-push-notifications — undated — accessed 2026-11-14 — primary
[S22] Creating a widget extension ("Hide sensitive content") — Apple Developer Documentation — https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension — undated — accessed 2026-11-14 — primary
[S23] WidgetKit foundations (WWDC26 session 277) — Apple — https://developer.apple.com/videos/play/wwdc2026/277/ — June 2026 — accessed 2026-11-14 — primary
[S24] Configuring app groups — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/configuring-app-groups — undated — accessed 2026-11-14 — primary
[S25] HIG: Controls — Apple — https://developer.apple.com/design/human-interface-guidelines/controls — 10 Jun 2024 — accessed 2026-11-14 — primary
[S26] HIG: App Shortcuts — Apple — https://developer.apple.com/design/human-interface-guidelines/app-shortcuts — last changed 8 Jun 2026 — accessed 2026-11-14 — primary
[S27] IntentAuthenticationPolicy (and its three cases) — Apple Developer Documentation — https://developer.apple.com/documentation/appintents/intentauthenticationpolicy — undated — accessed 2026-11-14 — primary
[S28] HIG: Siri — Apple — https://developer.apple.com/design/human-interface-guidelines/siri — last changed 8 Jun 2026 — accessed 2026-11-14 — primary
[S29] HIG: Snippets — Apple — https://developer.apple.com/design/human-interface-guidelines/snippets — 8 Jun 2026 — accessed 2026-11-14 — primary
[S30] Discover new capabilities in the App Intents framework (WWDC26 session 345) — Apple — https://developer.apple.com/videos/play/wwdc2026/345/ — June 2026 — accessed 2026-11-14 — primary
[S31] Layer 1 design doc, local snapshot ("Push", "Phone ↔ hub messages", "Prerequisites") — this repo: docs/context/upstream/layer1-join-and-connect.local-snapshot.md — snapshot 2026-11-14 — accessed 2026-11-14 — primary (project source of truth)
[S32] KICKOFF_PROMPT.md §3, §5.1, §8, §9 — this repo (owner's brief) — 2026-11-14 — accessed 2026-11-14 — primary (project requirement)
[S33] WWDC26 videos index (no notifications session) — Apple — https://developer.apple.com/videos/wwdc2026/ — June 2026 — accessed 2026-11-14 — primary
[S34] Platforms State of the Union (WWDC26 session 102) — Apple — https://developer.apple.com/videos/play/wwdc2026/102/ — 8 Jun 2026 — accessed 2026-11-14 — primary
[S35] PROGRESS.md (missing `asc.env`, so no `BUNDLE_ID`) — this repo — 2026-11-14 — accessed 2026-11-14 — primary (local observation)
[S36] Sending notification requests to APNs — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns — undated — accessed 2026-11-14 — primary
[S37] Generating a remote notification (aps keys) — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification — undated — accessed 2026-11-14 — primary
