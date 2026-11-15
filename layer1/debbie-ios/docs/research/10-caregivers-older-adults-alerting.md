# 10 Designing for caregivers, older adults and alerting
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: iOS 27.2.1 (released 9 Nov 2026). iOS 27.0 shipped on 14 Sep 2026, and iOS 26.7.3 is the current update for devices that stay on iOS 26 [S1]. The iOS 27 SDK comes with Xcode 27, which needs macOS Tahoe 26.6 or later [S1]. This Mac runs 26.2, so every API below was checked against the local iOS 26.5 SDK, and none of them needs a newer one. Revised the same day after an independent review (27 findings; see "Review log" at the end)._

## Questions answered

> "Designing for caregivers, older adults and alerting: clarity under stress, urgency without alarm fatigue, and trust and privacy cues such as an unmistakable 'camera is live' indicator." (brief §9, topic 10)

> "Work out from research what these people need in legibility, touch targets, tone, and urgent versus calm states." (brief §5, People)

The assignment also asks about: how stress affects reading and decisions; plain language; alarm fatigue and how to reduce it; Apple's notification guidance; caregiver burden; older adults and smartphones; the resident's dignity and consent; privacy indicators; trust cues for "can't reach home"; tone for urgent and calm states; error messages that offer a way to recover; and regulatory wording.

"These people" are the brief's resident, caregiver and installer [S43 §5]. The installer is covered in §13 and R30. Two cases the concept raises are covered too: the daily "no heart data" gap (§14, R31) and other people the camera can see (§15, R32) [S42].

## Summary

- **Stress shrinks what a caregiver can take in.** Even mild, acute, uncontrollable stress quickly impairs prefrontal cognition, especially working memory and cognitive flexibility [S28][S29]. In a crisis, people simplify messages, remember less, misread confusing instructions and believe the first message they get [S24]. So each Debbie alert carries one main message with what, where and when first, one obvious next step, and an honest line on what is not known [S24][S25].
- **Alarm fatigue is the main risk to the alert channel.** An estimated 85–99% of hospital alarm signals need no clinical response, and alarm fatigue was the most common contributing factor in alarm-related sentinel events [S22]. What helps: fewer and more specific alerts, severity tiers, interruptions only for severe alerts, and human-factors design [S23]. For Debbie that means only the **urgent** tier interrupts and there is one notification per `alert_id`. A wording update replaces the first notification without a second sound only when that first notification is still on the phone. Otherwise the update arrives at full strength, because APNs keeps only one stored notification per app and it may have kept only the update [S44] (R4). Every alert offers "Mark as False Alarm".
- **Apple's interruption levels match this.** Time Sensitive is for things happening now or within the hour. People can switch it off for an app, and the system keeps asking them to review it [S3][S5]. If Debbie used it for status updates, people could switch it off and lose breakthrough for fall alerts too. Critical alerts need an Apple-approved entitlement, so they come later [S3][S8].
- **The relay can't read severity, so the Notification Service Extension (NSE) must set the tier.** Every alert push arrives marked time-sensitive [S41]. After decrypting, the NSE should lower it to `.active` or `.passive` (a settable property in the local SDK [S21]). Whether the system honours that change has to be tested on a device (see Open questions).
- **Trust depends on honest unknowns.** Show "Monitoring is on" only when the connection and the heartbeat are fresh and every sensor the resident agreed to reports running. A sensor the resident declined is named as off by choice and never counts as a fault. Otherwise say "unknown" and give the last-contact time [S41][S43][S24]. "No alerts" always appears next to the monitoring state, so "nothing happened" can't be mistaken for "we don't know".
- **The resident needs much larger targets than Apple's minimums.** In a study of 40 older adults, tap accuracy dropped significantly below 14 mm targets, and swipes needed 17.5 mm or more [S37]. How many points make 14 mm depends on the iPhone: 84–91 pt on the models that run iOS 26 and 27. The iPhone 12 mini and 13 mini need the most (91 pt), because they fit 375 pt across 1,080 pixels at 476 ppi. So the resident's two main controls are 96 pt tall (R22). Assistive Access guidance adds: one or two features, no timed interactions, no hidden gestures, an icon plus a label on each control, and confirmation for actions that are hard to undo [S10][S12].
- **Dignity means the resident controls the camera.** Adult children liked monitoring technology more than their mothers did. They underestimated how well their mothers understood it, and most were sure they could persuade them. For both groups, privacy was the top concern [S38]. So the app never nags the resident, and it uses the same words as the laptop notice ("live view").
- **The "camera is live" cue must not rely on colour.** Apple changes its microphone indicator from a dot to a square when Differentiate Without Color is on [S19]. Debbie's live bar likewise combines a word, a glyph, a countdown, a fixed position and a Stop button, and does not blink [S10][S35].
- **Regulatory wording.** FDA's January 2026 general wellness guidance says a product stops being a wellness product if it names diseases, uses diagnostic thresholds, or sends alerts that recommend clinical action [S39]. Describe Debbie as an "alerting and check-in aid", and treat heart rate as a wellness signal. That guidance covers only general-wellness products. Automatic fall and heart-rate alerting may instead fall under FDA's device software policy, so this goes to a lawyer as a separate question (Open question 9) [S53].
- **Context for the pitch.** About 63 million US adults are family caregivers. Six in ten also work, and nearly half have had a major financial impact, hitting lower-income caregivers hardest [S31]. Only 54% of US adults in households earning under $30,000 a year subscribe to home broadband [S33], so "can't reach home" will be common for Debbie's target families. It needs to be a calm, clear state, not an error.

## Findings

### 1. The current iOS release
- Apple's security-releases page lists iOS 27.2.1 (9 Nov 2026) as the latest iOS. iOS 27 shipped on 14 Sep 2026, for iPhone 11 and later. Apple still ships iOS 26.x updates (26.7.3 on 9 Nov 2026) for devices that stay on iOS 26 [S1].
- Xcode 27 (14 Sep 2026) and Xcode 27.2 (29 Oct 2026) list "macOS Tahoe 26.6 and later" [S1]. This Mac runs macOS 26.2, so the iOS 27 SDK is out of reach. That is why every API here is checked against iOS 26.5.
- Apple's iOS 27 release notes contain nothing that changes app notification APIs. Items that touch this topic: the Home app now combines related accessory alerts into one notification; a Liquid Glass slider runs from "ultra-clear" to "fully tinted"; "Connectivity Assist" smooths Wi-Fi/cellular switching; VoiceOver image understanding and "flexible" Voice Control commands ("tap the gear") [S2]. Section "What changed" covers these.

### 2. Stress and reading or decision-making (peer-reviewed reviews; CDC guidance)
- The prefrontal cortex is the brain region most sensitive to stress. "Even quite mild acute uncontrollable stress can cause a rapid and dramatic loss of prefrontal cognitive abilities" [S28].
- A meta-analysis found that acute stress impaired working memory and cognitive flexibility, with more mixed effects on inhibition. Stress produced "more reactive processing of salient stimuli" [S29]. Reasoning: a stressed caregiver reacts to whatever is most salient, and can't easily hold several facts in mind or switch between them. So the most salient element must be the correct one: what happened and what to do.
- A review of studies from 1985 to 2011 concluded that stress affects decision making, and whether that helps or hurts depends on the task [S30]. Reasoning: we can't count on stress improving judgement, so the interface should make the decision for the caregiver where it safely can, for example by offering one primary action.
- CDC's crisis communication manual (CERC, "Psychology of a Crisis", 2019 update) lists four ways people process information in a crisis. They simplify messages ("Not fully hearing information… Not remembering as much of the information as we normally could… Misinterpreting confusing action messages"). They hold on to current beliefs. They look for additional information and opinions, and want messages confirmed before acting. They believe the first message. Messages should be "simple, credible, and consistent". An effective message must be repeated, come from multiple credible sources, be specific to the emergency, and "Offer a positive course of action that can be executed" [S24].
- On uncertainty, the same chapter says "an over-reassured public isn't the goal", "Acknowledge uncertainty", and tell people "What you know. What you don't know. What process you are using to get answers." In the initial phase: "Don't over-reassure… Emphasize that a process is in place to learn more" [S24]. CERC's "Messages and Audiences" chapter (2018 update) adds: "State what you know, what you don't know, and what you are doing to find out more. Do not speculate", and "Keep the first messages simple and only include immediately relevant information" [S52]. Reasoning: this maps directly to Debbie's unknown states. A first message that says "Fall detected" would anchor a belief that a later update can't fully undo, so first messages must say "Possible fall".

### 3. Plain language (government guidance)
- CDC's Clear Communication Index is a research-based tool with 20 scored items. They include one main message, the main message's location, a call to action, active voice, common words, chunks and headings, and "What we know and don't know" (last reviewed 29 May 2025) [S25].
- The federal plain-language guidance now lives on Digital.gov. It says content is easier to understand with shorter words, short sections, active voice and present tense, and it says to avoid hidden verbs [S26]. PlainLanguage.gov's content has been carried into these guides and archived [S27].
- NIA's (archived) senior-friendly web guidance recommends: minimise jargon and technical terms; write in the active voice; limit each section to one to five messages; leave space around clickable targets; use 12–14 pt body text that is easy to enlarge; use a sans serif face in medium or bold weight; left-justify text; use high contrast; minimise scrolling [S40]. These figures were written for web pages in 2009–2012. Reasoning: the principles still apply, but iOS point sizes come from Apple's Dynamic Type scale (topic 7), not from NIA's print and web points.

### 4. Alarm fatigue and what reduces it
- The Joint Commission (Sentinel Event Alert 50, 8 Apr 2013) found that alarm signals can reach several hundred per patient per day, and that "between 85 and 99 percent of alarm signals do not require clinical intervention". Clinicians "become desensitized" and turn alarms down or off. Of 98 alarm-related sentinel events from 2009 to 2012, 80 resulted in death, and alarm fatigue was "the most common contributing factor". It also reports that ECRI's annual hazard list has consistently ranked clinical alarms first or second [S22]. ECRI's own hazard pages returned 404 when checked, so its ranking is cited through the Joint Commission.
- AHRQ PSNet's primer (reviewed 15 Dec 2024) says alert fatigue grows with exposure. Clinicians ignore both meaningless and critical alerts. The suggested fixes are to "Increase alert specificity", "Tier alerts according to severity", "Make only high-level (severe) alerts interruptive" and apply human-factors principles. It points to aviation, where only highly consequential alerts reach the pilot [S23].
- Apple's notification guidance agrees: "Avoid sending multiple notifications for the same thing, even if someone hasn't responded" [S4].
- The Debbie concept already includes the remaining mitigations: a spoken "Are you okay?" check before alerting, false-alarm feedback to tune thresholds, and escalation to a second contact instead of repeating the same alert [S42]. Layer 1 provides de-duplication by `alert_id`, updates that replace the first notification via the collapse ID, and acknowledgements carrying a `false_alarm` flag [S41].

### 5. Apple's notification model
- **Interruption levels:**
  - Passive: no sound, doesn't light the screen.
  - Active (the default).
  - Time Sensitive: "requires their immediate attention". It overrides scheduled delivery and breaks through Focus, but not the Ring/Silent switch.
  - Critical: "Urgent information about health and safety… extremely rare… apps that help people manage their health or home". It also overrides the Ring/Silent switch and needs an entitlement [S3].

  Apple's `UNNotificationInterruptionLevel` reference and the local SDK header document the same four cases and behaviours [S6][S21].
- **Time Sensitive rules:** "Build trust by accurately representing the urgency." Use it only when the event "is happening now or will happen within an hour". The first Time Sensitive notification makes the system explain the feature and offer to turn it off, and the system "periodically" asks again. "Never use the Time Sensitive interruption level to send a marketing notification." [S3]. WWDC21 10091 adds: "Do not overuse their interruptive nature… there is an option to turn off Time Sensitive alerts". Time Sensitive needs its capability (entitlement), and Time Sensitive notifications are announced by default over AirPods [S5]. The old `UNAuthorizationOptionTimeSensitive` option is deprecated with the note "Use time-sensitive entitlement" [S21].
- **Critical alerts** need the `com.apple.developer.usernotifications.critical-alerts` entitlement, which Apple grants through a request form. With it, the app can play a sound even when the phone is muted or in Do Not Disturb, at a custom volume [S8]. `UNNotificationSound.defaultCriticalSound(withAudioVolume:)` and `criticalSoundNamed(_:withAudioVolume:)` exist in the local SDK [S21].
- **Content rules** [S4]:
  - Titles are short, in title case with no ending punctuation, and readable at a glance, especially on Apple Watch.
  - The body uses complete sentences in sentence case, and is never truncated by hand.
  - Provide generic text for when previews are hidden (`hiddenPreviewsBodyPlaceholder`).
  - Leave out the app name.
  - Avoid sensitive details.
  - A custom sound is fine, but don't rely on it.
  - Up to four actions. Prefer nondestructive ones. Never offer an action that only opens the app.
  - Badges count unread notifications only.
- **Payload keys:** `interruption-level` ("passive", "active", "time-sensitive", "critical"), `relevance-score` (0–1, highest is featured in the summary), `thread-id`. Payloads are limited to 4 KB [S7]. `relevanceScore`, `interruptionLevel`, `threadIdentifier`, `subtitle`, `categoryIdentifier` and `sound` are all writable on `UNMutableNotificationContent` (iOS 15 or earlier). Also in the SDK: `UNNotificationActionIcon(templateImageName:)`; action options `.authenticationRequired`, `.destructive` and `.foreground`; and `UNNotificationSettings.timeSensitiveSetting` and `criticalAlertSetting` [S21].
- Apple's User Notifications "updates" page lists nothing after June 2024 [S9].

### 6. The caregiver
- AARP and the National Alliance for Caregiving (24 Jul 2025) report 63 million US caregivers, nearly 1 in 4 adults. Nearly 1 in 4 provide 40 or more hours of care a week. Six in ten also have a job, and half of those report work disruptions. Nearly half have had at least one major financial impact, worst for younger and lower-income caregivers. Emotional stress has risen since 2020, and nearly 1 in 4 feel socially isolated [S31].
- NIA: for long-distance caregivers, "it may take more effort to find out what's going on and stay up to date" [S32].
- Reasoning: the caregiver is busy, often at work, and dreads the phone buzzing. Every interruption must be worth it, acting on an alert should take one or two taps, and "nothing to do" should look quiet.

### 7. Older adults and phones: legibility, targets, memory
- Pew Research (8 Jan 2026; survey 5 Feb–18 Jun 2025): 78% of adults 65 and older own a smartphone, against 97% of adults under 50. Only 14% of those 65 and older are online "almost constantly". Only 54% of adults in households earning under $30,000 a year subscribe to home broadband, against 94% of the highest-income households [S33].
- W3C WAI lists age-related declines in vision (contrast sensitivity, colour perception, near focus), in dexterity and fine motor control ("difficult to… click small targets"), in hearing (high-pitched sounds) and in cognition ("reduced short-term memory, difficulty concentrating, and being easily distracted") [S34].
- Apple's minimums [S10]:
  - Controls: default 44×44 pt, minimum 28×28 pt on iOS.
  - Spacing: about 12 pt of padding around bezeled elements and 24 pt around borderless ones.
  - Text: default 17 pt, minimum 11 pt, and support enlargement of at least 200%.
  - Contrast: 4.5:1 up to 17 pt, 3:1 at 18 pt or bold.
  - Colour: convey information with more than colour.
  - Timers: "Minimize use of time-boxed interface elements… Prefer dismissing views with an explicit action."
  - Motion: be careful with blinking animations.
- WCAG 2.2 [S35]:
  - 2.5.8 (AA): targets of at least 24×24 CSS px; 2.5.5 (AAA): 44×44.
  - 1.4.6 (AAA): 7:1 for text, 4.5:1 for large text.
  - 1.4.11: 3:1 for UI components and their states.
  - 1.4.1: colour is never the only visual means.
  - 2.2.1: for time limits, warn and allow extension with at least 20 seconds to respond, unless the limit is real-time or essential.
  - 2.2.2: blinking that starts automatically and lasts more than 5 seconds needs a way to pause it.
  - 2.3.1: no more than three flashes in any one second.
  
  2.5.8 exists for hand tremor and similar conditions [S36].
- Leitão & Silva (2012) tested 40 older adults on a smartphone. For taps, "mean accuracy was significantly lower for button sizes below 14 mm", and targets above 14 mm square reached more than 97% accuracy. Swipes needed 17.5 mm or more. Spacing between targets had no significant effect in their tasks, and the results agree with Jin et al. (2007) and Kobayashi et al. (2011) [S37].
- Assistive Access (WWDC25 session 238; developer docs) [S11][S12]:
  - Pick the one or two most important features.
  - Reduce the options on screen.
  - Avoid hidden gestures and nested UI.
  - "Avoid timed interactions."
  - Build step-by-step flows.
  - "Include both an icon and a label."
  - Ask twice before actions that are hard to recover from.

  The SwiftUI `AssistiveAccess` scene (iOS 26), `accessibilityAssistiveAccessEnabled` (iOS 18) and the `UISupportsFullScreenInAssistiveAccess` key are in the local SDK and docs [S21][S11].

### 8. Dignity, consent and who controls the camera
- Berridge & Wetle (2020) interviewed older women who are Meals on Wheels clients and their adult children:
  - The children "preferred each technology more than their mothers did".
  - They "underestimated both their mothers' ability to comprehend the functions of the technologies and the importance of engaging them fully in decision making".
  - "Most were confident that they could persuade their mothers to adopt."
  - For both groups, privacy was the most-cited concern, and it overlapped with independence, identity and freedom.
  - The authors call for shared decision-making to "prevent conflict and caregiver overreach" [S38].
- Layer 1's design gives the resident control. Live view is off until the resident turns it on, and they can turn it off at any time on the setup page, on the laptop's live notice, or in resident mode. While someone watches, the camera laptop shows a full-screen "Live: your caregiver is watching" notice with a Turn off live view button. Sessions last up to 5 minutes [S41].
- The concept doc adds: consent for each sensor, a visible indicator when sensors are live, no cameras in bedrooms or bathrooms by default, and pausing monitoring (after the hackathon) [S42].
- Apple: request access only when needed. A custom screen shown before a permission prompt has one button that opens the system alert, must not be titled "Allow", and must not offer a way out [S17].

### 9. Privacy indicators
- iPhone shows an orange dot when the microphone is in use and a green dot for the camera (or camera and microphone). With Differentiate Without Color on, the orange dot becomes an orange **square**. Apple changes the shape, not just the colour (article republished 22 Oct 2026) [S19].
- WCAG 1.4.1, 2.2.2 and 2.3.1 [S35], together with Apple's warning about blinking animations [S10]: the live cue must not depend on hue, must not blink continuously, and must never flash.
- Debbie's camera is in the resident's home, not on the phone, so the iPhone's own indicator never lights during live view. Reasoning: the in-app cue is the caregiver's only reminder that a real person is being watched now. The laptop notice is the resident's cue. Both must describe the same period ("Live" from "ready" until stop) using the same term ("live view") [S41].
- Apple's HIG says not to use the same colour for different meanings [S18]. So mint, which is the brand and the calm colour, can't also mean "live".

### 10. Trust cues when the home can't be reached
- Rules from the brief (§5.1 item 4) [S43]:
  - "Never show an all-clear you can't confirm." Layer 1 says the same for an unreachable relay: the app "never shows an all-clear it can't confirm" [S41].
  - "If the heartbeat is older than two intervals, show monitoring as unknown, never as healthy."
  - "Can't reach home", "monitoring degraded" and "this phone was removed from the home" are first-class states.
- Rules from Layer 1 [S41]:
  - The relay writes the "hub offline" push itself, carrying the last contact as a Unix time. The phone's notification extension formats that time in the phone's time zone ("Debbie hasn't heard from home since 3:12 PM" is the doc's example).
  - If the home internet drops, monitoring carries on locally, and alerts wait in the outbox and arrive on reconnect.
  - "A sleeping worker must never look healthy."
- CERC: "Don't over-reassure", acknowledge uncertainty, and tell people what you know, what you don't know and what process you are using to get answers [S24][S52]. CDC CCI: state "what we know and don't know" [S25].
- Reasoning: three situations look the same in a naive UI and need different words:
  - "No alerts because monitoring ran and nothing happened."
  - "No alerts reached this phone, and we can't confirm monitoring."
  - "This phone itself is offline."

### 11. Tone of voice and error messages
- Apple [S13][S14][S15]:
  - Match tone to context.
  - Be clear, and use plain language without jargon.
  - Put the most important information first.
  - Be action oriented: button labels are almost always verbs.
  - Error messages sit close to the problem, avoid blame, and say how to fix it ("oops!"/"uh-oh" sound insincere).
  - Empty states give clear next steps, with a button.
  - In alerts, "be direct, and use a neutral, approachable tone… avoid being oblique or accusatory, or masking the severity".
  - Titles describe what happened.
  - Buttons are one- or two-word verbs. Avoid "OK" unless the alert is purely informational, and avoid Yes/No.
  - Use exclamation points sparingly; the WWDC22 example of a celebratory exclamation is a fitness record, not a warning.
- Reasoning on tone for Debbie:
  - **Urgent** copy is calm and factual: specific time and place, "possible", no adjectives such as "serious" or "emergency", no exclamation marks, no reassurance ("Don't worry") [S24]. Tense: what happened goes in the simple past, tied to its time ("The home hub asked 'Are you okay?' and heard no answer"), and what is true now goes in the present ("Live view is off at home"). Digital.gov's advice to prefer the present tense [S26] is for general explanations and instructions. A report of an event that has already happened reads naturally in the past tense, and putting it in the present would blur when it happened.
  - **Calm** copy uses complete, warm sentences in the second person.
  - **Resident** copy speaks to an adult: "look through the camera", not "monitor you".

### 12. Regulatory wording (FDA guidance)
- FDA, "General Wellness: Policy for Low Risk Devices", issued 6 Jan 2026, replacing the 2019 version [S39]:
  - Products are not general wellness products "when they are intended to measure, estimate, or report physiologic values for medical or clinical purposes, including screening, diagnosis, monitoring, alerting, or management of a disease or condition".
  - Nor when their "labeling, advertising, user interface, or functionality" includes "references to specific diseases, clinical conditions, or diagnostic thresholds; … alerts, alarms, or prompts that recommend or require specific clinical action".
  - A wellness product may say that "evaluation by a healthcare professional may be helpful", provided it does not name a disease, call the output abnormal, cite clinical thresholds, or provide ongoing alerts intended to manage a condition.
- The wellness guidance covers only products "intended for only general wellness use". Debbie's main job is something else: telling a family member about a possible fall or a call for help. FDA's "Policy for Device Software Functions and Mobile Medical Applications" (28 Sep 2022, the current version) is the framework that addresses alerting software [S53]:
  - Appendix B lists functions where FDA "intends to exercise enforcement discretion". They include "Software functions that enable a patient or caregiver to create and send an alert or general emergency notification to first responders", functions "intended to allow a user to initiate a pre-specified nurse call or emergency call", and "historical trending and comparison of vital signs (e.g., body temperature, heart rate…)".
  - The functions it treats as devices include software that "analyzes patient-specific medical information to detect a life-threatening and/or time critical condition… and generate an alarm or an alert to notify a health care professional", and software that "analyzes readings… and alerts the user of readings outside a predetermined range".
  - Debbie sits between these examples. Its alerts are automatic, not created by a person, and they go to a family member, not to a health care professional or first responders. "Heart rate outside limits" [S42] reads close to the "outside a predetermined range" example. Reasoning: so the wellness-guidance wording alone doesn't settle Debbie's status. Open question 9 frames it for a lawyer.
- The concept doc already says that wrist heart rate "is a wellness signal… should not [be presented] as a diagnosis", that the product is "an alerting and check-in aid", and that a lawyer should review the wording [S42]. This is not legal advice.

### 13. The installer
- The brief lists the installer as one of Debbie's people: "often the caregiver, often not technical" [S43 §5]. The concept adds: "The hardware probe and guided setup exist for this person" [S42].
- In the app, the installer meets the Local Network prompt, the camera for the QR code, a 4-digit code to confirm at the laptop, the notification prompt and, on a resident phone, Health access. Layer 1 brings up the Local Network prompt first and retries, "because iOS may refuse the first request while that prompt is showing" [S41]. The brief asks for "permission priming before each system prompt (camera, local network, notifications, Health)" and for errors "with a way to recover" [S43 §5.2].
- Apple on onboarding: make it "fast, fun, and optional"; "design a brief, enjoyable experience that doesn't require people to memorize a lot of information"; "Postpone nonessential setup flows". If the app needs access before it can work, put the request in onboarding and say why; otherwise ask when the feature is first used [S54].
- Apple on pre-alert screens: "Include only one button and make it clear that it opens the system alert", titled something like "Continue" or "Next", never "Allow". Purpose strings are "a brief, complete sentence" in sentence case, in the active voice, ending with a period [S17].
- Assistive Access guidance, written for cognitive disabilities, also suits a nervous first-timer: "Build step-by-step flows" [S12].
- Reasoning: setup moves between two devices, the laptop and the phone. So each step says where to act, and each error says which device to fix and how. The person who installs may not be the person who gets the alerts, so the alert checks (R7, R28) run on the caregiver's own phone after pairing.

### 14. "No heart data" is a status, not an alarm
- The Watch needs charging every day, which leaves a daily gap. The concept says "The hub should show 'no heart data' as a status, not raise it as an alarm", and that the app shows "Watch not worn" as a visible state [S42]. Layer 4's care status carries `no_heart_data` and `no_heart_data_since` (CONTRACTS §3.3).
- HealthKit can't be read while the resident's phone is locked, so readings arrive in bursts after an unlock [S41]. A gap therefore also appears when that phone just stays locked.
- Reasoning: a gap that happens every day and interrupted the caregiver would be exactly the nuisance signal that teaches people to ignore alerts [S22][S23]. It gets the info tier, never a push.

### 15. Other people in view
- "Visitors and paid aides are also recorded… the product needs a notice and guidance." The concept's pilot phase lists a "visitor notice" [S42].
- Live view is video only, with no audio, and the camera laptop's full-screen notice is visible to anyone in the room [S41].
- Reasoning: the caregiver should be told once that other people may be on camera. The visitor notice itself (wording, placement, state-law guidance) is a pilot-phase item for the whole product, not for tonight's app.

## What changed in the current iOS release

- **iOS 27 is current (27.2.1). The iOS 27 SDK is not available on this Mac** (Xcode 27 needs macOS 26.6 or later) [S1]. Nothing recommended here needs it; every API is in the iOS 26.5 SDK [S21].
- **Notification APIs: no change.** Apple's User Notifications updates page has no entry after June 2024 [S9]. The HIG Notifications page last changed on 24 Oct 2023 [S4]. The HIG "What's new" log lists no 2026 changes to the Notifications, Managing notifications, Alerts, Accessibility or Privacy pages [S20]. Writing last changed on 16 Dec 2025 (language patterns, possessive pronouns) [S13][S20]. The Accessibility page last changed on 9 Jun 2025, when Assistive Access guidance was added [S10].
- **iOS 27, Home app:** "Summarized activity notifications combine related alerts across accessories into a single notification" [S2]. This is a system app feature, not an API. It confirms the direction Debbie takes with one notification per `alert_id`.
- **iOS 26.1, already on Debbie's iOS 26 baseline:** a "Liquid Glass setting gives you the option to choose between the default clear look or a new tinted look which increases opacity of the material in apps and notifications on the Lock Screen". iOS 26.2 adds a Lock Screen time option "giving the Liquid Glass material more or less opacity" [S47]. Flag: translucency already varies per user on iOS 26, not only on iOS 27. That includes Debbie's Lock Screen notifications.
- **iOS 27, Liquid Glass slider** from "ultra-clear to fully tinted" [S2]. Flag: any translucent surface behind alert or status text will vary per user. Alert, status and live-bar text sits on opaque surfaces, which are checked under Clear and Tinted on iOS 26 and at both ends of the iOS 27 slider (R25).
- **iOS 27, Connectivity Assist** smooths Wi-Fi/cellular transitions [S2]. Debounce "can't reach home" anyway (R15).
- **iOS 27, accessibility:** VoiceOver image understanding and Voice Control "flexible inputs" ("tap the gear") [S2]. Flag: the visible words and the accessibility labels must match, and controls must not be icon-only (R22, R26).
- **Notification summaries (Apple Intelligence), from iOS 18:** summaries are rewrites by a model. In iOS 18.3 Apple gave summarized notifications an "Updated style… using italicized text as well as the glyph", and made "Notification summaries for News & Entertainment apps… temporarily unavailable" [S46]. Apple's note gives no reason. The press reported that it followed complaints about "inaccurate summaries of news stories", after which Apple told the BBC an update would "further clarify when the text being displayed is summarization provided by Apple Intelligence" [S59]. iOS 18.1 added "Reduce Interruptions… a new Focus that ensures the most urgent notifications get through to you while silencing potential distractions" [S46]. Two vendor blogs say iOS 27's newer on-device models summarize and filter more confidently, and that there is no developer opt-out [S56][S57]. Apple's iOS 27 notes don't mention summaries [S2], so that part is unverified.
- **No API affects these summaries.** A grep of the iOS 26.5 UserNotifications headers finds only:
  - `summaryArgument` and `summaryArgumentCount`, deprecated (`"… is ignored"`, iOS 12.0–15.0);
  - `categorySummaryFormat` (iOS 12+, not deprecated). It sets the text of a grouped stack of notifications ("A format string for the summary description used when the system groups the category's notifications") and has nothing to do with Apple Intelligence summaries [S21].

  Treated as a risk in Open question 4.

## Recommendations for Debbie

### A. Alert policy: tiers, interruption, de-duplication

**R1. Three display tiers, set from the kind and the voice check, and an unknown severity is treated as urgent.**
- Debbie shows every hub message in one of three tiers:
  - `urgent` interrupts, using Time Sensitive.
  - `attention` lights the screen but doesn't break through Focus.
  - `info` is a quiet record.
- Layer 4's `severity` field uses exactly `"urgent" | "attention" | "info"` (CONTRACTS §3.1).
- PROPOSED to Layer 4, for CONTRACTS §3.1: set `severity` from the `kind` and from the outcome of the spoken "Are you okay?" check, which the concept runs for every detector [S42]:

| `kind` (CONTRACTS §3.1) | Answered "I'm okay" | No clear answer | Asked for help | Check couldn't run (mic down, or not attempted) |
|---|---|---|---|---|
| `fall` | attention | urgent | urgent | urgent |
| `no_movement` | info | urgent | urgent | urgent |
| `sound` (a cry or a thud) | info | urgent | urgent | urgent |
| `call_for_help` | urgent | urgent | urgent | urgent |
| `heart_rate_high`, `heart_rate_low` | info | urgent, worded as the missed answer and never as a heart-rate reading (R27) | urgent | attention |
| `check_in` | info | urgent | urgent | attention |
| `other` | attention | urgent | urgent | urgent |

  Status messages are not alerts and keep their own tiers: hub offline and monitoring limited are `attention`; back online, monitoring restored and confirmations are `info`.
- Reasoning, by column:
  - **No clear answer, or asked for help:** urgent for every kind. A person who can't answer may also be unable to call, and the concept's worst risk is a missed emergency [S42]. So a long stillness with no answer is urgent. CONTRACTS §3.1 currently lists "no movement for a long time" as attention, and needs reconciling.
  - **Answered:** not interruptive. The advice is to tier alerts by severity and interrupt only for severe ones [S23]. A fall the resident answered is still `attention`, because the caregiver may want to call, but it doesn't break through Focus.
  - **Check couldn't run:** a fall or a long stillness can't be ruled out, so it is urgent. A heart-rate or check-in event alone is `attention`: wrist heart rate is a wellness signal [S42], and wording heart-rate alerts as clinical is a regulatory risk [S39][S53].
  - **`call_for_help`:** always urgent, even if an answer comes later, because the person asked for help.
- Tonight's phone rule: the phone shows whatever `severity` says and never second-guesses Layer 4's tier. A missing or unknown value is shown as `urgent` and logged as a contract error, without its content.
- PROPOSED optional alert field `voice_check`: `"answered_ok" | "no_answer" | "asked_for_help" | "not_run"`. It lets the detail screen state what is and isn't known (R9).
- Check: a unit test over the phone's mapping, covering each tier and the missing and unknown values. Layer 4 tests its own table.
- Source: [S23] (tier by severity), [S42] ("the risk that matters most is a missed emergency"; the voice check), [S39][S53].
- ADOPT-TONIGHT for the phone's mapping, since every later rule depends on the tier. PROPOSED for Layer 4's table.

**R2. Interruption level by tier, and Time Sensitive only for urgent.**

| Tier | Interruption level | `relevanceScore` | `threadIdentifier` | Category |
|---|---|---|---|---|
| urgent | `.timeSensitive` | 1.0 | `alerts` | `debbie.urgent` |
| attention | `.active` | 0.6 | `home-status` | `debbie.attention` |
| info | `.passive` | 0.2 | `home-status` | `debbie.info` |

- Debbie sends no marketing or promotional notifications of any kind.
- Add the Time Sensitive Notifications capability (entitlement `com.apple.developer.usernotifications.time-sensitive`).
- All APIs verified in the local SDK [S21].
- Check: a unit test on the NSE's content builder for every tier.
- Source: [S3][S5][S6][S7].
- ADOPT-TONIGHT: protects the one level that has to keep working, the fall alert.

**R3. The NSE sets the tier and fails safe.**
- The relay marks every alert push time-sensitive because it can't read severity [S41].
- After decrypting, the NSE sets `interruptionLevel`, `relevanceScore`, `threadIdentifier`, `categoryIdentifier`, `title`, `subtitle`, `body` and `sound` from the decrypted alert.
- **Fail-safe content:** title "Alert from Home", body "Details can't be shown in this notification.", `.timeSensitive`, default sound, and nothing else. The NSE uses it in three cases:
  - decryption fails;
  - the alert is too large (`truncated`);
  - `serviceExtensionTimeWillExpire()` is called. There the NSE delivers the decrypted content if it is ready, and the fail-safe otherwise [S21].

  The copy names no app and asks for no task inside the app [S4].
- If the NSE crashes or can't run, iOS shows the relay's own `aps.alert`. That covers, for example, the time before the first unlock, when the Keychain items are unreadable [S41]. Today there are three different texts: S41's "New alert from Debbie", CONTRACTS §8's "New alert from Debbie. Open the app to see what happened.", and this note's. PROPOSED for CONTRACTS §8: the relay's placeholder is exactly the fail-safe text above, so the caregiver only ever sees one wording.
- The NSE never adds attachments, images or heart-rate numbers to a notification.
- Check:
  - NSE unit tests that feed valid, corrupt and oversize envelopes, and call `serviceExtensionTimeWillExpire()` before decryption finishes;
  - a device test of the level changes and of R4's update cases (Open question 1).
- Source: [S4] (no sensitive info, safe generic text), [S21], [S41].
- ADOPT-TONIGHT. Cut-order item 4 ("Decrypting inside the push") would remove in-push decryption [S43 §8], but the fail-safe path is the same code.

**R4. One notification per event, and push is treated as lossy.**
- Notification identifier and `apns-collapse-id` = `alert_id` [S41].
- **An `update: true` message** (new wording, same `alert_id`) never clears the acknowledgement [S43 §5.1]. It is presented in one of three ways:
  - **The original is still on the phone** (`deliveredNotifications()` contains `alert_id`; the API is in the SDK with no extension restriction [S21]): show the update at the original's level, so an urgent one stays `.timeSensitive`, and set only `sound = nil`. It keeps its Focus and Scheduled Summary breakthrough. A passive update would lose both [S3]. Time Sensitive "lights up screen" [S21], so the screen may wake again, silently.
  - **The original isn't there:** show the update at its full tier, with sound. "APNs stores only one notification per bundle ID… In most cases, the latest notification is stored" [S44]. For a phone that was offline, the update may be the first notification the caregiver gets.
  - **Debbie is in the foreground:** `willPresent` returns `[]` for an update to an alert that is already on screen or acknowledged, and the card's text changes in place (R6).

  This replaces the earlier rule that every update is `.passive`. It matches lead decision [X33]. CONTRACTS §8 still says `.passive` for the found case and needs the same change.
- **Known cost:** if the delivered original is gone and the app is in the background, the update sounds once more. The original goes when the caregiver opens or clears it, or when the badge reaches zero, which removes Debbie's notifications [S4]. The fix is LATER: an App Group store of the `alert_id`s the caregiver has seen, so the NSE can present `.passive` for those. There is no App Group tonight (note 11a).
- **Push is lossy.** On launch and on every return to the foreground, the app fetches from its cursor (relay or LAN gateway) before it calls any state current. Any unacknowledged urgent alert is pinned and announced (R6, R9), even if no push for it was seen. APNs may also store, throttle or drop notifications [S44].
- **PROPOSED to the relay:** send alert updates (a repeated `collapse_id`) and the relay-written "hub offline" and "back online" pushes with `apns-expiration: 0`. Through SNS that is the `AWS.SNS.MOBILE.APNS.TTL` attribute (and `…APNS_SANDBOX.TTL`) set to 0 [S45]. APNs then "attempts to deliver the notification only once and doesn't store it" [S44], so these pushes can never push a stored, undelivered urgent alert out of APNs's single slot. A phone that was offline still gets the update's wording, and the hub status, from the fetch on next open. First pushes of an alert keep normal storage.
- LATER: once an App Group records which `alert_id`s the NSE presented, a background refresh can post a local `.timeSensitive` notification for an urgent alert that never arrived by push. It never does this for one that did arrive [S4].
- Debbie never sends reminder pushes for the same `alert_id`. Escalation to a second contact comes later, with several caregivers [S42].
- Propose to the relay: "hub offline" and "back online" share the collapse ID `hub-status-{home_id}`, and "back online" is `passive`.
- Check:
  - deliver the same `alert_id` twice, and `getDeliveredNotifications` returns 1 [S21];
  - device tests:
    - put the phone in Airplane Mode while the mock hub sends an urgent alert and then its update, then turn Airplane Mode off. Expect exactly one notification, at urgent level, with sound;
    - the same with a Focus on;
    - the same with Scheduled Summary on and Debbie in the summary;
    - the original delivered and unopened, then the update. Expect no second sound, still Time Sensitive;
    - with the relay's expiration 0, a "hub offline" push sent while the phone is offline doesn't displace a stored urgent alert.
- Source: [S4] ("avoid sending multiple notifications for the same thing"), [S3], [S44], [S45], [S22][S23].
- ADOPT-TONIGHT for the app and NSE side; PROPOSED for the relay.

**R5. Lock-screen actions: one gated acknowledgement, and nothing a stray double tap can misuse.**
- Lead decision [X50]: notification actions are a topic-13 extra, built only after 5.1 passes its gates. Then `debbie.urgent` gets **one** action, "I'm On It", with `.authenticationRequired`, which sends the acknowledgement in the background once the iPhone is unlocked. "Call {name}" and "Open Live View" stay in the app (R9). `debbie.attention` and `debbie.info` have no actions.
- "Mark as False Alarm" is in-app only (R10), never a lock-screen action.
- No action exists only to open the app [S4].
- Action icons use `UNNotificationActionIcon(templateImageName:)` with Debbie's own glyphs, never `systemImageName` [S43 §3].
- Reasoning on double tap: "When a person responds to a notification with a double tap, the system selects the first nondestructive action as the response" [S4]. As the only action, "I'm On It" is the one a Watch double tap selects. A single, possibly accidental, double tap must never acknowledge a possible fall the caregiver hasn't read. That would unpin the alert, turn its card neutral (R9, R17) and, later, stop escalation. This note's earlier order ("Call {name}" first) didn't prevent it, because "Call" exists only with a saved number (R11).
- X50 relies on `.authenticationRequired` to block that. No Apple source says how `.authenticationRequired` behaves when an iPhone app's notification is answered on Apple Watch (Open question 12; note 13 asks the same). So:
  - **Release gate:** the action ships only if a device test shows that, with the iPhone locked, a Watch double tap on an urgent alert doesn't send an acknowledgement. Test it with and without a saved number.
  - If the test fails, the urgent category ships with no action, and acknowledgement stays in-app (R9), where the caregiver has read the alert.
- Check: a test that asserts the registered categories; the Watch device test above, recorded in Open question 12.
- Source: [S4] (actions, icons, nondestructive, double tap), [S21], [X50].
- ADOPT after the 5.1 gates [X50], behind the Watch device test.

**R6. Foreground presentation by tier.**
- In `userNotificationCenter(_:willPresent:)`:
  - urgent returns `[.banner, .list, .sound]`;
  - attention returns `[.list]`;
  - info returns `[]`;
  - an update to an alert that is already on screen or acknowledged returns `[]` (R4).
- In every tier, the app also inserts or updates the in-app card.
- When an urgent alert is inserted in-app, post `AccessibilityNotification.Announcement` with `accessibilitySpeechAnnouncementPriority = .high` (both in the local SDK [S21]). It reads "Urgent alert. Possible fall, living room." When the alert has no place (Open question 5), it reads "Urgent alert. Possible fall at 3:12 PM."
- Check: a unit test of the delegate mapping, and a VoiceOver check on a device.
- Source: [S4] ("handle notifications gracefully when your app is in the foreground"), [S21].
- ADOPT-TONIGHT.

**R7. Hidden-preview text, and a check on notification settings.**
- Set `hiddenPreviewsBodyPlaceholder` to "Urgent alert from home" for urgent and "Update from home" for attention. Do not set `.hiddenPreviewsShowTitle` or `.hiddenPreviewsShowSubtitle`.
- Request authorization with `[.alert, .sound, .badge]` (`.badge` for R9). Never ask for `.provisional`, which delivers quietly.
- On each launch and each return to the foreground, read `UNNotificationSettings` (every property below is in the local SDK [S21]).
  - If any row below matches, Home shows the lead's single line, "Alerts from home may not reach you", as a heading above the status header [X52]. Its detail is the reason from the first matching row, and it has an "Open Settings" button.
  - The Settings screen lists every matching reason.
  - "Open Settings" opens `UIApplication.openNotificationSettingsURLString` (iOS 15.4+ [S21]), which is Debbie's notification settings. A button is better than describing where the setting is [S13].
  - X52 lists five properties. The review asked for `soundSetting` and `scheduledDeliverySetting` too, because each quietly weakens urgent alerts, so they are added here and flagged to the lead.

| Condition (in this order) | Reason shown |
|---|---|
| `authorizationStatus` is `.denied`, `.provisional`, or still `.notDetermined` after onboarding | "Notifications are off for Debbie." |
| `alertSetting == .disabled` | "Alerts are turned off for Debbie." |
| `scheduledDeliverySetting == .enabled` and `timeSensitiveSetting != .enabled` | "Urgent alerts will wait for your scheduled summary." |
| `lockScreenSetting == .disabled` | "Alerts won't show on the Lock Screen." |
| `soundSetting == .disabled` | "Alerts won't make a sound." |
| `timeSensitiveSetting != .enabled` (scheduled delivery off) | "Urgent alerts won't break through Focus." |
| `notificationCenterSetting == .disabled` | "Alerts won't stay in Notification Center." |

- Ring/Silent switch: Time Sensitive "Overrides Ring/Silent switch: No" [S3]. The iOS 26.5 SDK headers mention the ringer switch only in audio-session playback rules and Critical alerts, and none of them reports its state (grep, [S21]). So the app can't detect it. Onboarding, the R28 test alert and Settings all say: "Keep your ringer on, or Debbie's alerts will arrive silently." [X41]. Critical Alerts (R29) is the real fix.
- Check: a unit test for each mocked combination (each property `.enabled`, `.disabled` or `.notSupported`, and each authorization status), asserting which line shows and the order; a string test for the ringer line in all three places.
- Source: [S3][S4][S13][S21], [X41][X52]. Reasoning: a caregiver who thinks they are covered when they aren't is a false all-clear. Each of these settings quietly weakens urgent alerts.
- ADOPT-TONIGHT.

### B. Alert anatomy and copy

**R8. Push anatomy, with authoring limits.**
- Title = what happened. 30 characters or fewer, title case, no ending punctuation. Taken from Debbie's own `kind` table, never from model-written text, for known kinds.
- Subtitle = where and when, 40 characters or fewer: "Living room · 3:12 PM". Absolute time in the phone's locale and time zone, never relative. Layer 4's alerts have no place field yet (Open question 5). Without a place, the subtitle is the time alone ("3:12 PM"), never a guessed place.
- Body = what is known or not known, 110 characters or fewer, complete sentences.
- Check: a unit test that measures every app-authored string, and a device screenshot at the default and largest text sizes.
- Source: [S4] (titles readable at a glance, including on Apple Watch; the system truncates); Reasoning for the numbers: the title must fit one line of a Lock Screen banner and a Watch short look on the narrowest supported iPhone. Confirm on a device and tighten if it wraps.
- ADOPT-TONIGHT.

**R9. In-app alert detail anatomy, in fixed order.**
1. Tier label: glyph plus word ("Urgent", "Needs attention", "Update").
2. Headline, 30 characters or fewer ("Possible fall").
3. Place and time: "Living room · 3:12 PM (4 min ago)", or the time alone when there is no place (R8). If arrival minus `detected_at` is 60 seconds or more, add "Arrived 3:20 PM, 8 min after it was noticed."
4. Detail: at most two sentences and 160 characters, including what is not known.
5. Primary button, full width and at least 56 pt tall:
   - "Call {name}" if a number is saved;
   - otherwise "Open Live View";
   - otherwise "I'm On It", but only when a fresh heartbeat says live view is off.

   The phone can't know the resident's live-view setting before it asks: the hub checks consent on every request [S41], and today's monitoring object has no live-view field. So "Open Live View" is always offered, and "denied" is handled (R19). PROPOSED: `live_view_enabled` in the heartbeat's monitoring object. When it is `false`, the button is replaced by the line "Live view is off at home." with no button and no request to the resident (R21).
6. Up to two secondary buttons, from "Open Live View" and "I'm On It".
7. One text button: "Mark as False Alarm".
8. Acknowledgement line: "You responded at 3:15 PM." / "Saved on this iPhone. It will send when this iPhone is back online."

- At most 3 buttons plus 1 text button. Labels follow R12; "I'm On It" is the lead's acknowledgement label [X35].
- VoiceOver reads in the same order.
- Alerts sort by `detected_at`. Unacknowledged urgent alerts stay pinned above everything else until acknowledged.
- **Badge:** it counts *unread* urgent and attention alerts. An alert is read once its card has been on screen in Debbie. This follows Apple: "Use a badge only to show people how many unread notifications they have", and "Update your app's badge as soon as people open the corresponding notifications" [S4].
  - It is set with `setBadgeCount` (iOS 16+ [S21]) after asking for `.badge` (R7).
  - Apple notes that "reducing a badge's count to zero removes all related notifications from Notification Center" [S4]. That is accepted: the alerts stay in Debbie's history, and R4 covers the update case it affects.
  - Unacknowledged urgent alerts stay visible through the pinned card, never through the badge alone. Apple: "Make sure badging isn't the only method you use to communicate essential information" [S4].
- Check: a snapshot test at the default text size and AX5; a UI test that counts buttons; a unit test of the badge count as alerts are read; a UI test of the live-view-off line.
- Source: [S24][S25] (main message first, call to action, what we know and don't know), [S4] (badges), [S14], [S41]. Reasoning on 60 s: Layer 1's target is delivery within 10 s [S41], so 60 s means the alert is clearly late.
- ADOPT-TONIGHT.

**R10. False alarm flow.**
- "Mark as False Alarm" opens a confirmation:
  - title "Mark as a false alarm?";
  - body "This tells the home hub that nothing was wrong.";
  - buttons "Mark False Alarm" and "Cancel".
- It then sends the acknowledgement with `false_alarm: true` and shows "Marked as a false alarm at 3:16 PM."
- Never promise tuning the app can't confirm (no "Debbie will learn from this").
- Check: a UI test.
- Source: [S41][S42][S14]. Reasoning: a stressed mis-tap would mislabel a real fall and feed the hub's tuning, so one confirmation is worth its cost.
- ADOPT-TONIGHT.

**R11. Make the alert actionable with a "Call" number.**
- Settings gets two optional fields, stored only on this iPhone and never sent anywhere:
  - "Name to use in alerts" (for example "Mum", "Rosa");
  - "Phone number to call".
- When both are set, urgent and attention alerts offer "Call {name}", which opens `tel:`.
- When unset, copy uses name-free forms and the alert shows a text button "Add a Number to Call".
- Check: a UI test with the fields set and unset.
- Source: [S24] (a positive, executable course of action), [S23] (actionable, specific alerts), [S32].
- ADOPT-TONIGHT: small, and it turns every urgent alert into a next step. List it under "Decisions to confirm".

**R12. Copy rules, enforced by a test over the string catalog.**

All user-facing strings must:
- have no "!";
- have no "oops" or "uh-oh";
- have no "OK" button label except in purely informational sheets;
- write every button label, of every kind (in-app, dialog, notification action), in Apple's title-style capitalisation with no ending punctuation. In-app headings, status lines and body text use sentence case [S4][X10]. HIG pages differ on this (Alerts says sentence-style for alert buttons, Buttons and Notifications say title-style), so the lead's single rule [X10] applies, and HIG Writing asks to "Choose a style for each UI element type and use it consistently" [S13];
- start button labels with a verb, except "Done", "Not Now", "I'm On It", and links that open another Debbie screen. Those are labelled with that screen's title (for example the resident's "Settings" text button, R22). Reasoning: a link names a place, not an action. "Open Settings" is kept for the button that opens iOS Settings, so the two can't be confused;
- use "Possible …" for every detection, never "Fall detected" or "{name} fell";
- contain none of "abnormal", "arrhythmia", "AFib", "atrial", "tachycardia", "bradycardia", "cardiac", "heart attack", "diagnos", "emergency detected";
- contain none of "all clear", "all quiet", "everything's fine", "she's safe", "he's safe" [X5];
- use "live view" for the feature, never "camera feed", "stream" or "spy";
- in notification titles, subtitles and bodies, never contain "Debbie": the system already shows the app's icon [S4]. In-app text names Debbie only as the app itself ("Notifications are off for Debbie"), never as the one who asks, hears or watches. That is "the home hub";
- in notifications, never tell people to do something inside the app ("Open Debbie to…") [S4];
- address the reader in the second person only. The phone in hand is "this iPhone" (never "your iPhone" or "my iPhone"), and there is no "we", "our" or "us". Apple: "Use possessive pronouns sparingly… try not to switch perspectives. Avoid using we altogether" [S13].

Exception, "I'm On It": the acknowledgement keeps the lead's label [X35]. It says, in the caregiver's own words, that they are dealing with it. HIG Writing says a verb is "almost always" best for a button, not always [S13]. Voice Control and VoiceOver also get "Acknowledge" through `accessibilityInputLabels` [X35].

Tense, checked in review rather than by the lint: what happened goes in the simple past with its time, and what is true now goes in the present (§11).

Check: a unit test that scans `Localizable.xcstrings`. Keys are prefixed by element type (`button.`, `notification.`, `text.`), so each rule applies to the right strings. Every string in R13 must pass.

Source: [S13][S14][S15] (no interjections, verbs on buttons, sparing exclamation points, possessives, consistent capitalisation), [S4] (no app name, no in-app tasks in notifications), [S24] (don't over-reassure; first message sticks), [S39] (no disease names or diagnostic framing), [S41] (the laptop says "live view"), [X5][X10][X35].

ADOPT-TONIGHT: cheap and fully checkable.

**R13. Debbie's copy deck v0.** Every recovery message follows [what happened] + [why, if known] + [what to do] + [one button that does it], in three sentences or fewer, shown near the problem, with no error codes in the main text [S13][S14]. `{name}` falls back to name-free wording. Every string here passes R12.

*Pushes* (R8 limits; with no place, the subtitle is the time alone)

| Tier | Title | Subtitle | Body |
|---|---|---|---|
| urgent | Possible Fall | Living room · 3:12 PM | The home hub asked "Are you okay?" and heard no answer. |
| urgent | Possible Call for Help | Kitchen · 3:12 PM | The home hub heard someone call for help. |
| urgent (update; presented per R4) | Possible Fall | Living room · 3:12 PM | *(Layer 4's improved wording, same `alert_id`)* |
| attention (relay-written; the NSE adds the subtitle) | Can't Reach Home | Since 3:12 PM | The home internet or power may be off. |
| attention | Monitoring Is Limited | Since 3:05 PM | The kitchen laptop stopped reporting. Falls in the living room may be missed. |
| info (passive, replaces "Can't Reach Home") | Home Is Back Online | — | Home connected again at 3:40 PM. |
| fallback (R3: decryption fails, the alert is too large, or time runs out; PROPOSED as the relay's own placeholder) | Alert from Home | — | Details can't be shown in this notification. |
| test (local only, R28) | Test Alert | — | This is how urgent alerts will look. Nothing has happened at home. |

S41 gives "Debbie hasn't heard from home since 3:12 PM" as an *example* of the hub-offline text. What it fixes is the behaviour: the relay sends a Unix time, and the extension shows it in the phone's time zone. The deck keeps that behaviour (the subtitle) and drops the app name from the body [S4]. The relay's plaintext version, with no time, is "Can't Reach Home" / "The home internet or power may be off." (PROPOSED for CONTRACTS §8).

*Status header.* It has three independent rows, always shown in a fixed order, each with its own glyph, words and age. They match the brief's three states [S43 §5.1] and the lead's decision [X54]: Connection, Monitoring, and Extra detail (the language model). Within each row, the first matching input wins. R14 sets the inputs and R15 sets the delays.

Connection row:

| Input | Line | Detail |
|---|---|---|
| The relay rejects this phone's credential (removed) | This iPhone was removed from the home | Someone removed it on the home laptop. Pair again to get alerts. [Pair Again] |
| Up to 10 s after returning to the foreground, before the first response | Checking home… | Last contact from home 3:12 PM. |
| No network path on this iPhone | Can't reach home | This iPhone is offline. Alerts will arrive when it's back online. Last contact from home 3:12 PM. |
| A network path, but neither the relay nor the LAN gateway answers | Can't reach home | Debbie's alert service isn't answering. Trying again every 30 seconds. Last contact from home 3:12 PM. |
| The relay answers and reports the hub offline | Can't reach home | Home last connected at 3:12 PM (18 min ago). The home internet or power may be off. If monitoring is still running there, alerts will arrive when home reconnects. |
| Otherwise | Connected to home | Last contact 1 min ago. |

Every relay-unreachable case keeps Layer 1's words, "can't reach home" [S41]. The detail starts with the cause, so the three situations in §10 still read differently, and no deviation from S41 needs a DECISIONS entry.

Monitoring row:

| Input | Line | Detail |
|---|---|---|
| Connection isn't "Connected to home", or the heartbeat is older than 2 intervals, or `state` is `"starting"` | Monitoring status unknown | No update from home since 3:12 PM. |
| A sensor the resident agreed to is down, its detection isn't running, or a laptop isn't reporting | Monitoring is limited | Kitchen laptop not reporting since 3:05 PM. Falls in the living room may be missed. |
| Neither camera nor mic is in use (each `"declined"` or `"none"`) | Fall and sound detection are off | {name} chose not to use the camera or microphone. *(or, for `"none"`: No camera or microphone is set up.)* |
| Only one of camera or mic is in use, and it's up and running | Monitoring is on: camera only *(or: sound only)* | Sound detection is off at {name}'s choice. *(or: No microphone is set up.)* Last update 1 min ago. |
| Camera and mic both up and running | Monitoring is on | Camera and sound. Last update 1 min ago. |

Extra-detail row (the language model, from Layer 4's health in the heartbeat):

| Input | Line | Detail |
|---|---|---|
| The Monitoring row is "unknown" (no fresh heartbeat) | Extra detail status unknown | No update from home since 3:12 PM. |
| `language_model: "unavailable"` | Extra detail is off | Alerts still arrive as usual. |
| `language_model: "available"` | Extra detail is on | Last update 1 min ago. |

Headline precedence, used for the header's glyph, its colour and what VoiceOver reads first: This iPhone was removed > Checking home… > Can't reach home > Monitoring status unknown > Monitoring is limited > Fall and sound detection are off > Monitoring is on. This is X54's order (removed > can't reach home > monitoring unknown > limited > on) with two states added: the transient "Checking home…" (F10) and "Fall and sound detection are off" for a home where the resident declined both sensors (F11). The lead should add both to X54. The Extra-detail row never sets the headline.

*Empty and unknown states*

| Where | Heading | Text |
|---|---|---|
| Alerts, monitoring confirmed | No alerts | Monitoring is on. Last update from home 1 min ago. |
| Alerts, not confirmed | No alerts received | Debbie can't confirm monitoring right now. Last update from home 3:12 PM. |
| Alerts, first run | Alerts will show here | If the home hub notices a possible fall or a call for help, you'll get a notification and see it here. [Send a Test Alert] |
| Resident, no readings (every cause, R23) | No heart readings yet | Readings appear after your Watch syncs with this iPhone. Wear your Watch and unlock this iPhone. If readings still don't appear, check that Debbie can read heart rate in Settings. [Open Settings] |
| Caregiver, no heart data (R31) | No heart readings since 7:40 AM | The Watch may be off, charging or not synced yet. |

*Errors with recovery*

| Situation | Heading | Text | Button |
|---|---|---|---|
| QR expired | This code has expired | Codes work for 10 minutes. On the home laptop, show a new code and scan it. | Scan Again |
| QR already used | This code was already used | Each code works once. On the home laptop, show a new code. | Scan Again |
| Wrong network | Can't find the home laptop | This iPhone needs to be on the same Wi-Fi as the home laptop. Check Wi-Fi, then try again. | Try Again |
| Local Network denied | Local Network is off for Debbie | Debbie needs it to find the home laptop on your Wi-Fi. | Open Settings |
| Acknowledgement queued | Saved on this iPhone | It will send when this iPhone is back online. | — |
| Unpair, hub unreachable | This iPhone is unpaired | Debbie couldn't reach the home laptop, so it may still list this iPhone. On the laptop, open Paired phones and remove it. | Done |
| Laptop approval failed | Couldn't approve the laptop | Debbie couldn't reach home. Try again on the home Wi-Fi or when this iPhone is online. | Try Again |
| A notification setting weakens alerts (R7) | Alerts from home may not reach you | *(R7's reason, for example "Alerts won't make a sound.")* | Open Settings |

Source: [S13][S14][S15][S24][S25][S41][S43].

ADOPT-TONIGHT: CRAFT.md §6 and the screens can take these as written. Wording changes stay within R12.

### C. Status and trust

**R14. The conditions for an all-clear.**
- The status header shows the brief's three states as three independent rows, always visible: Connection, Monitoring, and Extra detail (the language model). R13 gives each row's lines and the headline precedence [S43 §5.1][X54].
- **Foreground poll interval: 30 s.** While Debbie is active, it calls the relay (or the LAN gateway) every 30 s. Reasoning: this matches Layer 1's 30 s reconnection target [S41]. Polling faster than the 60 s heartbeat adds no monitoring information. In the background there is no polling; push and the R4 catch-up fetch cover it.
- "Monitoring is on", with the healthy glyph, requires all of:
  - the last successful relay or gateway response is at most 2 poll intervals (60 s) old;
  - the latest decrypted heartbeat is at most 2 heartbeat intervals old. The interval is 60 s, or 20 s in the demo [S41] (CONTRACTS §3.2);
  - every laptop reports, and every sensor the resident agreed to is up with its detection running. A camera or mic that is `"declined"` (or `"none"`) is not counted as missing. The line names what is off ("Monitoring is on: camera only", "Sound detection is off at {name}'s choice."), because a "no" leaves that device unconfigured by design [S41] and declining shouldn't be punished [S38].
- **Returning to the foreground:** until the first response arrives (at most the 10 s relay timeout, CONTRACTS §5), the Connection row shows "Checking home…" with the last-known times. It is neutral and never shows the healthy glyph.
- Any missing or stale input gives "Monitoring status unknown": neutral colour, a question-mark glyph, never the healthy glyph or colour.
- Every row shows its last-update time.
- PROPOSED for CONTRACTS §3.2: the hub's `state` is `"ok"` when every *agreed* sensor is up and running, so a `"declined"` sensor never makes it `"degraded"`. Until that's agreed, the phone works out health from the fields, not from `state`. Also PROPOSED: an optional `live_view_enabled` field (R9).
- Check: state-machine unit tests covering:
  - each input made stale in turn;
  - combined faults. For example, relay down + stale heartbeat + phone offline gives Connection "Can't reach home" with the "This iPhone is offline" detail, Monitoring "unknown", headline "Can't reach home";
  - the language model down alongside each of those;
  - camera and mic each in `up` / `down` / `declined` / `none`;
  - the 10 s after returning to the foreground.
- Source: [S43] (three states, the two-interval rule, never an unconfirmed all-clear), [S41] (heartbeat, resident consent, "A sleeping worker must never look healthy"), [S38], [S24].
- ADOPT-TONIGHT.

**R15. Each bad state has its own input and delay, and recovery is instant.**

| State (R13) | Input | Shown after |
|---|---|---|
| This iPhone was removed | The relay rejects this phone's credential [S41]. The exact removed-phone signal is still a contract gap [S43 §6] | Two consecutive rejections |
| Can't reach home: this iPhone is offline | The phone's network path is unsatisfied (`NWPathMonitor`) | 30 s unsatisfied, or two failed calls at least 30 s apart |
| Can't reach home: alert service not answering | Relay and LAN calls fail while the path is satisfied | Two consecutive failures at least 30 s apart |
| Can't reach home: home offline | The relay's `hub.online: false` and `last_contact_at`, or its "hub offline" push | At once: the relay's watchdog has already waited 3 minutes (1 minute in the demo) [S41] |
| Monitoring status unknown | Heartbeat age more than 2 intervals | At once: the two intervals are the delay [S43] |
| Monitoring is limited | The hub's `monitoring` message or heartbeat | At once: the hub has already waited 30 s [S41] |
| Extra detail is off | `language_model` in a fresh heartbeat | At once |

- The 30 s matches Layer 1's 30 s reconnection target [S41], so a Wi-Fi-to-cellular switch never shows "Can't reach home".
- Go back to the confirmed state on the first success.
- No haptic or sound for status changes.
- Check: a unit test per row, plus a simulated Wi-Fi-to-cellular switch.
- Source: [S41][S43]; [S22][S23] (nuisance signals cause desensitisation); [S16] ("Avoid overusing haptics").
- ADOPT-TONIGHT.

**R16. "Nothing happened" vs "we don't know".**
- The alerts empty state always sits next to the current monitoring state (R13 table), never alone.
- Never write "No alerts today" unless monitoring was confirmed for the whole period.
- The healthy state is labelled "Monitoring is on" everywhere. "All quiet" is never used, in any form, because it reads as reassurance (R12) [X5][X30]. Note 06 F7 still gives "All quiet" as the OK label, and the lead should update it to match.
- Later: keep a local log of heartbeat coverage and show gaps ("Monitoring was off 1:10–1:40 PM").
- Source: [S24][S25][S41].
- ADOPT-TONIGHT for the copy rule; LATER for coverage gaps, which need a heartbeat history store.

**R17. Tier visuals do not rely on colour.**
- Five status glyphs with distinct silhouettes, all custom and outside SF Symbols: urgent, attention, info, unknown (question mark), healthy.
- Each glyph is always paired with its word.
- Check: render all five in greyscale at 50% size. Each must be identifiable, and glyphs must reach at least 3:1 against their background [S35].
- The urgent colour appears only on **unacknowledged** urgent alerts. The newest gets the filled urgent surface (`urgent.fill`). Older unacknowledged ones get the urgent tint (`urgent.tint`).
- After acknowledgement, the card and its history row are neutral. The urgent glyph's *shape*, in the neutral glyph colour, still shows what kind of alert it was, next to "You responded at 3:15 PM."
- Exact hues come from topic 6. Note 06 F8 assigns `urgent.tint` to "Acknowledged-alert history rows". This note asks the lead to reassign it to older unacknowledged urgent alerts, so that both notes give one treatment.
- Source: [S10][S18][S35] (1.4.1, 1.4.11), [S22]. Reasoning: limiting red keeps the palette calm and keeps urgency meaningful. A history of past alerts tinted red would wear down the one loud colour.
- ADOPT-TONIGHT.

### D. Live view

**R18. Live indicator spec.**
- **Position:** a full-width bar pinned to the top of the viewer, below the safe area. It never auto-hides, never overlaps the video, and nothing in the app can cover it.
- **Content, in reading order:**
  - live glyph (custom ring and dot, at least 12 pt);
  - the word "Live", semibold, at least 17 pt;
  - place ("Living room camera"; fallback "Home camera");
  - countdown "4:12 left" with `monospacedDigit()`;
  - a "Stop" button, at least 44×44 pt.
- **Large text:** at AX sizes the bar wraps to two lines and never truncates "Live" or the countdown.
- **Colour:** a dedicated `live` token, used for nothing else. It is not mint and not the urgent hue. Text contrast is at least 7:1 and glyph contrast at least 3:1. The bar is opaque.
- **Motion:** no looping or blinking animation. At most one entrance animation per session, skipped under Reduce Motion.
- **Timing:** the bar shows "Live" from the hub's "ready" until stop, the same period the laptop notice is up. While requesting, it shows "Asking home…" and never "Live".
- **VoiceOver:** the bar is the first element, labelled "Live view on. Living room camera. 4 minutes 12 seconds left.", with trait `.updatesFrequently`. Announcements fire only at start, at 1 minute left and at the end.
- **Haptics:** topic 4's live-view events [X3]:
  - `liveViewStarted` plays `.success` when the first decoded video frame is on screen;
  - nothing plays when the caregiver taps Stop or the time limit ends;
  - `.warning` plays when the request is denied or the resident turns live view off;
  - `.error` plays when the connection is lost.

  `SensoryFeedback.start` and `.stop` exist in the SDK, but their doc comment says "Only plays feedback on watchOS", so Debbie never uses them [S21] (R26).
- **Check:** snapshot tests in light, dark, Increase Contrast and AX5; a frame inspection of a recording showing no blinking; a VoiceOver check.
- Source: [S10] (blinking, more than colour), [S19] (Apple adds a shape cue), [S35] (1.4.1, 1.4.6, 1.4.11, 2.2.2, 2.3.1), [S41], [S16][S21].
- ADOPT-TONIGHT.

**R19. Time limit and end reasons.**
- At 1:00 left, show the inline line "1 minute left" with a [Keep Watching] button, and post one announcement. No haptic (note 04 R3).
- "Keep Watching" sends a new request, which can come back "denied" [S43 §5.1][S41]. Tapped during the last minute, the new request is sent when the current session ends, so the hub never runs two sessions at once. KVS allows "one sender per channel" [S41].
- At 0:00 the session ends.
- End screens:
  - time limit: "Live view ended. Sessions last up to 5 minutes." [Keep Watching] [Done];
  - you stopped: "You stopped live view." [Done];
  - resident turned it off: "Live view was turned off at home." [Done];
  - connection lost: "The connection to the home camera was lost." [Try Again];
  - denied: "Live view is off at home." [Done];
  - failed: "Couldn't start live view. The home camera didn't respond. Try again in a minute." [Try Again].
- Reasoning on the time limit: Layer 1 sets 5-minute sessions because KVS's TURN credentials "last 5 minutes. Hence 5-minute sessions" [S41]. So it isn't "essential" in WCAG's sense ("extending it would invalidate the activity"). Debbie therefore meets 2.2.1's **Extend** option: "warned before time expires and given at least 20 seconds to extend the time limit with a simple action… allowed to extend the time limit at least ten times" [S35]. The button is there for the whole last 60 s, and new sessions have no cap.
- Reasoning on the two shortened lines: "Only {name} can turn it back on" isn't guaranteed, because the coordinator's setup page can change the setting too [S41]. Next to a [Call {name}] button, it also nudged the caregiver to press the resident, which is the "caregiver overreach" [S38] that R21 rules out.
- Check: the mock-home live-view states each end on the right screen (UI test); "Keep Watching" is present from 1:00 left to the end screen.
- Source: [S35] (2.2.1), [S41], [S14], [S38].
- ADOPT-TONIGHT.

**R20. No hidden watching.**
- Dismissing the viewer, or the scene entering `.background`, calls the relay's Stop (`DELETE /v1/live-view/sessions/{id}`) at once, before tearing down. Apple: "Expect an app that enters the background phase to terminate" [S50].
- `.inactive` doesn't stop the session [X53]. `.inactive` means "The scene is in the foreground but should pause its work" [S50]. UIKit enters it "for temporary interruptions, such as when displaying system alerts", and reactivates the app when a system panel is dismissed [S51]: Notification Center, Control Center, an incoming-call banner, the app switcher. Ending live view on every glance at Control Center would be noise. A scene that leaves through the app switcher reaches `.background`, which stops the session. A session left open some other way is caught by the sender backstop below.
- When the scene leaves `.active`, begin a background task (`UIApplication.beginBackgroundTask(withName:expirationHandler:)`), and end it when Stop completes or the session ends. That way the DELETE reaches the relay even if the app is then suspended. Apple: "Don't wait until your app moves to the background to call" it. `applicationDidEnterBackground` has about five seconds [S51]. (`ProcessInfo.performExpiringActivity` is the extension equivalent [S51][S21].)
- PROPOSED backstop for Layer 1 (CONTRACTS §7): the live-view sender ends the session and closes its window when the viewer's WebRTC connection has been disconnected or failed for 10 s, or when no viewer connects within 30 s of "ready". Then the laptop never says "watching" with nobody connected, even if Stop never arrives.
- After returning, the end screen says "Live view stopped when you left Debbie."
- While connecting, show this line once: "The camera laptop shows a notice while you watch." The notice is on the camera laptop [S41]. Whether the resident is in the room to see it isn't known, so the line says only what is certain.
- Make no claim about recording until Layer 1's "never recorded" question is settled [S41].
- Check: device tests that, mid-session, (a) background the app, (b) lock the phone, and (c) open Control Center and close it again. Each checks the session state the mock home (or the real laptop) reports: (a) and (b) end within a few seconds, and (c) continues. A UI test can't reproduce suspension, so this needs a device.
- Source: [S41], [S50], [S51], [X53]. Reasoning: the laptop must never say "watching" while no one is looking.
- ADOPT-TONIGHT for the app side; PROPOSED for the sender backstop.

**R21. The resident controls the camera, and nothing nags them.**
- Resident-mode switch label: "Live view".
  - On: "Your family can look through the home camera for up to 5 minutes at a time. The laptop shows a notice while they look."
  - Off: "No one can open live view." A stronger promise ("No one can look through the camera") waits until the recording question is settled, because Layer 2 may keep recordings [S41] (R20).
- Turning it **off** takes effect at once, with no confirmation.
- Turning it **on** asks once:
  - title "Turn on live view?";
  - body "Your family can look through the home camera for up to 5 minutes at a time. The laptop shows a notice while someone is looking. You can turn this off at any time.";
  - buttons [Turn On] [Not Now].
- The caregiver app has no "ask {name} to turn it on" action and sends no prompts to the resident.
- Check: UI tests.
- Source: [S38] (caregiver overreach, shared decisions), [S41] (resident control), [S12] (confirm consequential actions).
- Later: show the resident who is watching, both on the laptop ("Live: Anna's iPhone is looking through this camera") and in resident mode. That needs a PROPOSED contract field.
- ADOPT-TONIGHT for the switch and the no-nag rule; LATER for showing who is watching.

### E. Resident mode

**R22. Rules for simplicity and size.**
- One screen with no tabs and no navigation stack.
- At most 3 interactive controls: "Send Now" (the brief's Sync now), the "Live view" switch, and a "Settings" text button.
- The two primary controls are at least 96 pt tall and full width, with at least 24 pt between them. Each has an icon and a text label [X21].
- The "Settings" text button has a hit region of at least 44×44 pt and its label at the base text size. It sits at the bottom of the screen, at least 24 pt from the nearest primary control. Reasoning: it is for the caregiver or installer (unpair, resident mode off), so it is deliberately quieter than the two primary controls. 44×44 pt is Apple's default control size [S10]. At about 6.8 mm it is below [S37]'s 14 mm threshold, which is accepted for a control the resident rarely needs.
- Base text at least 20 pt at the default size; the heart-rate value at least 34 pt; label weight medium or heavier.
- Text contrast at least 7:1 (AAA).
- No timers or auto-dismiss, no gesture-only actions, no swipe actions.
- Works at AX5: scrolling is allowed, truncation is not.
- Write the unit as "beats a minute", not "bpm".
- Check: a UI test that counts controls; frame size assertions; contrast entries in CRAFT.md; snapshot tests at AX5.
- Source: [S37] (≥14 mm for taps; swipes worse), [S55] (screen densities), [S10] (spacing, timers, gesture alternatives, contrast, 44 pt default), [S12] (one or two features, icon plus label, no timed interactions), [S34][S40] (vision, memory, medium/bold type, jargon), [S35] (1.4.6), [X6][X21].
- Reasoning for 96 pt:
  - The formula is mm per pt = 25.4 × (physical pixels per point) ÷ ppi.
  - Apple's tech specs and the Xcode 26.6 simulator device profiles give, for iPhones that run iOS 26/27 [S55]:
    - iPhone 12 mini and 13 mini: 1,080 px across 375 pt at 476 ppi, so 2.88 px per pt and 0.1537 mm per pt;
    - iPhone 11 and SE (2nd and 3rd gen): @2x at 326 ppi, 0.1558 mm per pt;
    - @3x models at 458–460 ppi: 0.1657–0.1664 mm per pt.
  - So 14 mm needs 84–91 pt. The worst case is the minis, at 91.1 pt.
  - 96 pt gives at least 14.75 mm on every supported iPhone (about 15 mm on @2x screens). Display Zoom only makes points larger.
- "Send Now" replaces "Sync" because "sync" is jargon [S26][S40]. List the label under "Decisions to confirm" [X7].
- ADOPT-TONIGHT.

**R23. Resident copy.**
- Heart card: "72", "beats a minute", "Read at 3:10 PM".
- After sending: "Sent to home at 3:12 PM".
- Off home Wi-Fi: "Will send when you're home. Last sent 9:40 AM." [S41].
- **No readings, for any cause, is one state** (R13): "No heart readings yet", the lead's wording [X51] (11a R15 has the same rule). The text is "Readings appear after your Watch syncs with this iPhone. Wear your Watch and unlock this iPhone. If readings still don't appear, check that Debbie can read heart rate in Settings." Button: [Open Settings], which opens `UIApplication.openSettingsURLString`, Debbie's page in Settings [S21].
- Reasoning:
  - "your app doesn't know whether someone granted or denied permission to read data from HealthKit. If they denied permission, attempts to read data… return only samples that your app successfully saved" [S48]. A "permission denied" state can't be detected. It would either never appear or appear for the wrong cause (Watch off, not synced, phone locked).
  - Apple says to manage Health access "solely through the system's privacy settings" [S49], and to give a button rather than describe where a setting is [S13].
  - Whether Debbie's page in Settings leads to its Health access on iOS 26 needs a device check (Open question 13). If it doesn't, the last sentence names the app as Apple asks ("check in Apple Health that Debbie can read heart rate") [S49].
- The app tracks only whether the request has been shown, never whether it was granted. `getRequestStatusForAuthorization(toShare:read:)` returning `.shouldRequest` means show the priming screen and then the request. `.unnecessary` means it was already asked [S21][S48].
- No medical judgement words (R12).
- Check: a unit test that the only Health states are "never asked", "no readings yet" and "readings present".
- Note 15-flows-and-states lists "Health denied → how to allow in Settings" as a separate state (row S15). This note asks the lead to fold it into "No heart readings yet".
- Source: [S39][S41][S40][S48][S49][S13], [X51].
- ADOPT-TONIGHT.

**R24. Assistive Access.**
- Add `UISupportsFullScreenInAssistiveAccess = YES` once resident mode lays out correctly in the reduced and full-screen frames. The key "allows your app's standard UI to expand into all the available space above the Back button in Assistive Access" and lists the app as Optimized for Assistive Access [S11].
- Don't adopt the SwiftUI `AssistiveAccess` scene (iOS 26). "When a scene is active, an app's native SwiftUI controls are displayed in the distinctive Assistive Access design" [S12]. That conflicts with the brief's rule that every control the app can style uses Debbie's own component, "never the system's default look" [S43 §3]. No Apple source says what the scene does to custom controls.
- If the scene is ever adopted, it also needs the `UISupportsAssistiveAccess` Info.plist key set to true [S11][S12].
- Source: [S11][S12][S21][S43].
- LATER: needs testing inside Assistive Access, which a trusted supporter sets up.

### F. Caregiver legibility, haptics and sound

**R25. Caregiver baseline.**
- Every tap target at least 44×44 pt; alert primary actions full width and at least 56 pt tall.
- At least 12 pt between bezeled controls and 24 pt around borderless ones.
- Body text 17 pt by default, and nothing below 13 pt.
- Contrast at least 4.5:1 for text (3:1 for text 18 pt and larger, or bold), at least 7:1 under Increase Contrast, and at least 3:1 for glyphs and control boundaries.
- Alert, status and live text never sits on a translucent material.
- Check: CRAFT.md contrast table; UI tests on frame sizes. On a device, check alert, status and live-bar text, and Debbie's Lock Screen notifications, under Liquid Glass **Clear** and **Tinted** on iOS 26.1 or later [S47], and at both ends of the iOS 27 slider [S2].
- Source: [S10][S35]; Reasoning: stress impairs working memory and favours reactions to salient stimuli [S28][S29], so the next step should be the biggest, easiest target. Translucent legibility already varies per user on iOS 26 (Clear or Tinted [S47]), and more so with the iOS 27 slider [S2].
- ADOPT-TONIGHT.

**R26. Haptics and sound mapped to meaning.**

Topic 4 owns the haptic tokens. This table uses its named events (note 04 R2) and its iPhone-only rule (note 04 R4) [X3][X4].

| Event (note 04 name) | Feedback |
|---|---|
| Urgent alert arrives (`alertUrgentArrived`) | The system notification sound and vibration, via R6. In the foreground, the app adds `.warning` only if the system presented no sound for that `alert_id`, so one cause gives one feeling [X4]. |
| "I'm On It" or "Mark as False Alarm" committed (`acknowledged`) | `.success` once |
| Live view: first decoded video frame on screen (`liveViewStarted`) | `.success` once |
| Live view: the hub replies "denied" (`liveViewDenied`) | `.warning` |
| Live view: the resident turns it off mid-session (`liveViewEndedByResident`) | `.warning` |
| Live view: the connection fails, drops or never starts (`liveViewLost`) | `.error` |
| Live view: the caregiver taps Stop; the time limit; the 1-minute warning | none (note 04 R3) |
| Laptop approval fails (`laptopApprovalFailed`) | `.error` |
| Status changes, wording updates, list refresh, info tier | none |

- `SensoryFeedback.start` and `.stop` are never used. Both symbols exist in the SDK, but their doc comments say "Only plays feedback on watchOS" [S21], and the HIG lists Start and Stop only among watchOS haptics, with notification, impact and selection for iOS [S16]. Note 04 R4 bans them.
- Push sound: `"default"` for urgent tonight. Attention and info carry no sound (the NSE sets `sound = nil`).
- Check: topic 4's lint, which allows haptics only through named events, and its allow-list test (note 04 R4).
- Source: [S16] (consistent, complementary, not overused; per-platform haptics), [S4] (a custom sound must be short, distinctive and professionally produced; don't rely on sound), [S21], note 04 R2–R4.
- ADOPT-TONIGHT for the mapping; LATER for a custom urgent sound, which is a designed asset that needs its own review.

### G. Regulatory wording, and the second safety layer

**R27. An alerting and check-in aid, not a medical device.**
- Onboarding, App Store text, the pitch and the UI describe Debbie as "an alerting and check-in aid for families".
- Heart rate appears only as values, trends and the "No heart readings since…" status (R31). Debbie sends no heart-rate push of its own.
- If Layer 4 sends a heart-related alert, the app shows its text without adding clinical thresholds, disease names or "abnormal". R1's table words an unanswered heart-rate event as the missed answer, not as a reading. Before Layer 4 ships any "heart rate outside limits" alert, it needs the legal read in Open question 9, because FDA lists alerts on "readings outside a predetermined range" among device functions [S53].
- Onboarding, one sentence: "Debbie doesn't replace emergency services or your Apple Watch's Fall Detection and Emergency SOS. Keep those on."
- Check: R12 lint, plus a review of the store and pitch text.
- Source: [S39][S42][S53].
- ADOPT-TONIGHT for the copy; LATER for legal review before any launch.

**R28. A test alert in Settings and on first run.**
- "Send a Test Alert" posts a local `.timeSensitive` notification: title "Test Alert", body "This is how urgent alerts will look. Nothing has happened at home."
- The caregiver then meets the system's first-time Time Sensitive explanation in a calm moment, not during a real fall.
- The test-alert screen also says: "Keep your ringer on, or Debbie's alerts will arrive silently." Time Sensitive doesn't override the Ring/Silent switch [S3], and the app can't detect the switch (R7) [X41].
- Source: [S3] (first Time Sensitive notification triggers the system explanation; Ring/Silent), [S21], [X41].
- ADOPT-TONIGHT: one local notification, and it doubles as a demo aid.

**R29. Critical alerts.**
- Apply for the Critical Alerts entitlement for the urgent tier only, specifically a possible fall with no answer.
- Add an in-app opt-in that explains Critical alerts sound even when the phone is muted, plus a volume setting (`defaultCriticalSound(withAudioVolume:)`).
- Source: [S3][S8][S21].
- LATER: Apple must approve the entitlement. Time Sensitive covers the demo.

### H. The installer, heart-data gaps and other people in view

**R30. A setup flow for a non-technical installer.**
- One task per screen. A step indicator ("Step 2 of 3, Confirm the code", the `DebbieStepIndicator` from note 09) [S12][S54].
- Every step that involves the laptop names the device first ("On the home laptop, show the pairing code."). Every pairing error says which device to act on and gives a button (R13 errors table).
- Each system permission is asked at the step that needs it, after a pre-alert screen with one "Continue" button and no skip [S17][S54]:
  - Local Network before the first pairing request, then retry [S41];
  - camera when the scanner opens;
  - notifications after pairing as a caregiver, followed by R7's check and R28's test alert;
  - Health when resident mode starts.
- Purpose strings, each "a brief, complete sentence" in sentence case ending with a period [S17]:
  - `NSLocalNetworkUsageDescription`: "Debbie uses your Wi-Fi to find and pair with the home laptop."
  - `NSCameraUsageDescription`: "Debbie uses the camera to scan the pairing code on the home laptop."
  - `NSHealthShareUsageDescription`: "Debbie reads your heart rate from Apple Health and sends it to the home hub over your home Wi-Fi."

  These read Apple's way ("Apple Health" [S49]). Note 01's plist lint checks the ending period.
- The 4-digit code is shown large, with `monospacedDigit()`, and VoiceOver reads it digit by digit, because it is read at arm's length next to the laptop (Reasoning).
- Check: a UI test for each pairing error state and each permission-denied path; the R12 lint; note 01's priming-screen test (one button, then the system prompt).
- Source: [S43 §5, §5.2], [S42], [S41], [S17], [S54], [S12], [S49].
- ADOPT-TONIGHT: it is the pairing flow the brief already requires, written for the person who actually does it.

**R31. "No heart data" is an info-tier status, never a push.**
- On the caregiver's home screen, below the status header, Layer 4's `no_heart_data` shows as one neutral line: "No heart readings since 7:40 AM", with the detail "The Watch may be off, charging or not synced yet." (R13). It has no button, no haptic, no sound and no notification, and the line isn't the caution colour.
- It doesn't change the Monitoring row (R14). A daily charging gap would otherwise make "Monitoring is limited" appear every day.
- Check: a unit test that `no_heart_data: true` produces the line and never a notification request.
- Source: [S42] ("show 'no heart data' as a status, not raise it as an alarm"; "Watch not worn" as a visible state), [S41], [S22][S23], [S24] (say what isn't known).
- ADOPT-TONIGHT.

**R32. Other people in view.**
- The first time a caregiver opens live view, and in Settings' live-view explainer, show once: "Anyone in the room, such as visitors or aides, may be on camera."
- LATER (the concept's pilot phase): a visitor notice and guidance for the home, covering wording, placement and state recording-consent law. That is product scope, not app scope [S42].
- Source: [S42], [S41] (video only, with an on-screen notice at the camera laptop).
- ADOPT-TONIGHT for the one line; LATER for the visitor notice.

## Open questions / risks

1. **Does the system honour an NSE that lowers `interruptionLevel`, and do updates behave as R4 says?** The property is writable [S21], but no Apple document confirms that the extension can downgrade a time-sensitive push to `.passive` or `.active`. Test on a device:
   - a time-sensitive payload whose decrypted tier is `info`, with a Focus on;
   - R4's update cases: the original delivered and unopened (no second sound, still Time Sensitive); the phone offline during an alert and its update, then back online (one notification, at full tier, with sound), repeated with a Focus on and with Scheduled Summary on.

   APNs keeps only one stored notification per app, usually the latest [S44], so any later push can displace an undelivered urgent one. R4's catch-up fetch and the PROPOSED `apns-expiration: 0` limit the damage.
   - If the downgrade isn't honoured, the fallback is a one-bit hint from the hub to the relay ("urgent or not"). That leaks only that bit, but the relay would see when urgent events happen. Contract decision for `docs/CONTRACTS.md`.
2. **Severity and kind values are not yet defined by Layer 4** [S41]. R1 proposes them. Until agreed, the app treats unknown values as urgent, which over-alerts by design.
3. **Repeat notifications vs escalation.** Apple advises against repeating notifications for the same thing [S4]. Clinical practice relies on escalation [S22]. Debbie's answer is a second contact, not repeats [S42], but several caregivers come after the hackathon, so tonight an unanswered urgent alert simply stays pinned in the app.
4. **Notification summaries and Reduce Interruptions.** Apple Intelligence summaries are rewrites by a model. Apple restyled them in iOS 18.3 and paused them for News & Entertainment apps [S46], after reports of inaccurate news summaries [S59]. A summary may present a possible event as fact, for example by dropping "Possible", which R12 and the CERC first-message argument rely on [S24]. iOS 18.1's Reduce Interruptions Focus lets a model decide which notifications get through [S46]. Whether a Time Sensitive alert always passes it isn't documented. No SDK API lets an app opt out of summaries [S21]. Vendor blogs report the same and say iOS 27 summarizes more confidently [S56][S57]; Apple hasn't confirmed this. So:
   - Settings, and the step after the R28 test alert, offer one line: "Summaries can reword alerts. To see alerts from home word for word, turn off summaries for Debbie." [Open Settings]. The button opens `openNotificationSettingsURLString` [S21]. Whether the per-app summary switch is on that page needs a device check.
   - Device tests: a possible-fall alert with summaries on, and with Reduce Interruptions on. Record the wording shown and whether it broke through.
5. **Place and live-view state are not fields.** The Layer 4 alert fields have no room or location [S41], and the monitoring object has no live-view setting (CONTRACTS §3.2). The hub checks consent on each request [S41]. Until then, use the fallbacks: a time-only subtitle and announcement (R6, R8), and an "Open Live View" button that handles "denied" (R9). PROPOSED: an optional alert `place` string, and an optional `live_view_enabled` in the monitoring object.
6. **Live view and phone calls.** R20 stops live view when the scene enters the background, which also happens when the caregiver starts a call from Debbie. Watching while on a call might be valuable. Revisit with the owner (Picture in Picture would need a privacy review).
7. **Lower-income homes may lack broadband.** 46% of adults in households earning under $30,000 a year don't subscribe to home broadband [S33], so hubs may run on phone hotspots. "Can't reach home" will be frequent. The copy must stay calm and accurate (R13, R15), and the pitch should say so honestly.
8. **Resident without an iPhone.** 22% of adults 65 and older don't own a smartphone [S33]. Resident mode assumes an iPhone paired with the Watch [S42]. This is a product risk, not an app fix.
9. **Regulatory: questions for a lawyer.** This is not legal advice.
   - (a) **Which FDA framework governs automatic fall and emergency alerting to a family member?** FDA's "Policy for Device Software Functions and Mobile Medical Applications" (28 Sep 2022) [S53] puts under enforcement discretion an alert or emergency notification that a patient or caregiver *creates and sends* to first responders, and a "pre-specified nurse call or emergency call". It treats as device functions software that analyzes data to detect a time-critical condition and "generate an alarm or an alert to notify a health care professional", and software that "alerts the user of readings outside a predetermined range". Debbie detects automatically and alerts a family member, so it fits none of these examples exactly.
   - (b) **Heart rate, separately.** "Heart rate outside limits" alerts [S42] could look like "alerting… of a disease or condition" under the wellness guidance [S39], and like the "outside a predetermined range" example [S53]. "Historical trending and comparison of vital signs" is under enforcement discretion [S53].
   - R1 and R27 keep the app's own wording safe in the meantime.
10. **The 96 pt resident targets and AX5 text** may not fit three controls on an SE-class screen without scrolling. Scrolling is allowed (R22), but check the layout in the Phase 6 screen gate.
11. **"Name to use in alerts" and "Phone number to call"** (R11) add two Settings fields. They are small and local, but they are new scope under "whatever else your research says belongs here". List under "Decisions to confirm".
12. **Apple Watch and notification actions for an iPhone-only app.** No Apple source found says:
    - whether a Watch double tap can send an `.authenticationRequired` action while the iPhone is locked (R5's release gate for X50's "I'm On It"; note 13 asks the same);
    - whether the Watch shows `.foreground` actions for an app with no watchOS app;
    - what a double tap does when a notification has no custom action.

    Record the observed behaviour from R5's device test here, with and without a saved number. If the acknowledgement can be sent that way, the urgent category ships with no action.
13. **Does Debbie's page in Settings lead to its Health access on iOS 26?** HealthKit offers no documented deep link to Health access. R23's button opens Debbie's page in Settings (`openSettingsURLString`). Check on a device, and if it doesn't lead there, use R23's Apple Health wording.
14. **Live-view sender backstop** (R20, PROPOSED). Ending a session when the viewer's WebRTC connection drops needs Layer 1's sender to watch the peer connection state. That's for the laptop track to agree in CONTRACTS §7.

## Sources

Labels: **primary** means the originating organisation's own guidance, specification, data or study. **Secondary** means a summary, review or commentary on others' work. In [S21], "verified" means the symbol, its availability and its doc comment were read in the local iOS 26.5 SDK. Behaviour that needs a device is listed under Open questions.

- [S1] Apple security releases — Apple Support — https://support.apple.com/en-us/100100 — latest entry 13 Nov 2026 (iOS 27.2.1: 9 Nov 2026; iOS 27: 14 Sep 2026; Xcode 27/27.2 requirements) — accessed 2026-11-14 — primary
- [S2] About iOS 27 Updates — Apple Support — https://support.apple.com/en-us/149076 — published 9 Nov 2026 — accessed 2026-11-14 — primary
- [S3] Human Interface Guidelines: Managing notifications — Apple — https://developer.apple.com/design/human-interface-guidelines/managing-notifications — undated (no change log on page) — accessed 2026-11-14 — primary
- [S4] Human Interface Guidelines: Notifications — Apple — https://developer.apple.com/design/human-interface-guidelines/notifications — last changed 24 Oct 2023 — accessed 2026-11-14 — primary
- [S5] Send communication and Time Sensitive notifications (WWDC21 session 10091) — Apple — https://developer.apple.com/videos/play/wwdc2021/10091/ — June 2021 — accessed 2026-11-14 — primary
- [S6] UNNotificationInterruptionLevel — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel — undated — accessed 2026-11-14 — primary
- [S7] Generating a remote notification — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification — undated — accessed 2026-11-14 — primary
- [S8] Critical Alerts entitlement — Apple Developer Documentation — https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts — undated — accessed 2026-11-14 — primary
- [S9] User Notifications updates — Apple Developer Documentation — https://developer.apple.com/documentation/updates/usernotifications — latest entry June 2024 — accessed 2026-11-14 — primary
- [S10] Human Interface Guidelines: Accessibility — Apple — https://developer.apple.com/design/human-interface-guidelines/accessibility — last changed 9 Jun 2025 — accessed 2026-11-14 — primary
- [S11] Optimizing your app for Assistive Access (and the Assistive Access overview) — Apple Developer Documentation — https://developer.apple.com/documentation/accessibility/optimizing-your-app-for-assistive-access — undated — accessed 2026-11-14 — primary
- [S12] Customize your app for Assistive Access (WWDC25 session 238) — Apple — https://developer.apple.com/videos/play/wwdc2025/238/ — June 2025 — accessed 2026-11-14 — primary
- [S13] Human Interface Guidelines: Writing — Apple — https://developer.apple.com/design/human-interface-guidelines/writing — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
- [S14] Human Interface Guidelines: Alerts — Apple — https://developer.apple.com/design/human-interface-guidelines/alerts — last changed 2 Feb 2024 — accessed 2026-11-14 — primary
- [S15] Writing for interfaces (WWDC22 session 10037) — Apple — https://developer.apple.com/videos/play/wwdc2022/10037/ — June 2022 — accessed 2026-11-14 — primary
- [S16] Human Interface Guidelines: Playing haptics — Apple — https://developer.apple.com/design/human-interface-guidelines/playing-haptics — last changed 7 May 2024 (change log) — accessed 2026-11-14 — primary
- [S17] Human Interface Guidelines: Privacy — Apple — https://developer.apple.com/design/human-interface-guidelines/privacy — last changed 21 Jun 2023 — accessed 2026-11-14 — primary
- [S18] Human Interface Guidelines: Color — Apple — https://developer.apple.com/design/human-interface-guidelines/color — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
- [S19] About the orange and green indicators in your iPhone status bar — Apple Support — https://support.apple.com/en-us/108331 — published 22 Oct 2026 — accessed 2026-11-14 — primary
- [S20] Design: What's new — Apple — https://developer.apple.com/design/whats-new/ — latest entry 6 Nov 2026 — accessed 2026-11-14 — primary
- [S21] iOS 26.5 SDK interfaces (Xcode 26.6), read in the local SDK:
  - `UserNotifications.framework/Headers/{UNNotificationContent,UNNotificationSound,UNNotificationSettings,UNUserNotificationCenter,UNNotificationAction,UNNotificationActionIcon,UNNotificationCategory,UNNotificationServiceExtension}.h`. This covers:
    - the interruption-level comments (Passive: "does not light up screen or play sound"; Time Sensitive: "Lights up screen and may play a sound");
    - every `UNNotificationSetting` property, including `alertSetting`, `soundSetting`, `lockScreenSetting`, `notificationCenterSetting`, `scheduledDeliverySetting` and `timeSensitiveSetting`;
    - `getDeliveredNotifications` with no extension restriction, `setBadgeCount` (iOS 16), `UNAuthorizationOptionBadge`, `serviceExtensionTimeWillExpire`;
    - `categorySummaryFormat` (iOS 12, not deprecated) and `summaryArgument`/`summaryArgumentCount` (deprecated "is ignored", iOS 12.0–15.0);
    - no API that reports the Ring/Silent switch (grep of the UIKit, AVFAudio, AudioToolbox and UserNotifications headers).
  - `SwiftUI.swiftmodule`:
    - `AssistiveAccess` scene (iOS 26), `accessibilityAssistiveAccessEnabled` (iOS 18), `sensoryFeedback(_:trigger:)`;
    - `SensoryFeedback.success/.warning/.error` (iOS 17). `.start`/`.stop` exist (iOS 17), but their doc comments in `arm64e-apple-ios.swiftdoc` say "Only plays feedback on watchOS", so Debbie doesn't use them;
    - `ScenePhase` (`background`, `inactive`, `active`).
  - `SwiftUICore.swiftmodule` (`accessibilityDifferentiateWithoutColor`, `accessibilityReduceMotion`, `AccessibilityTraits.updatesFrequently`, `monospacedDigit()`).
  - `Accessibility.swiftmodule` (`AccessibilityNotification.Announcement` iOS 17, `accessibilitySpeechAnnouncementPriority`).
  - UIKit `UINotificationFeedbackGenerator.h`, `UIAccessibilityConstants.h`, and `UIApplication.h` (`openSettingsURLString`; `openNotificationSettingsURLString` iOS 15.4; `beginBackgroundTask(withName:expirationHandler:)`).
  - Foundation `NSProcessInfo.h` (`performExpiringActivity`).
  - HealthKit `HKHealthStore.h` (`getRequestStatusForAuthorization`) and `HKDefines.h` (`HKAuthorizationRequestStatus`).

  Apple — /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk — SDK files dated 18 Apr 2026 — accessed 2026-11-14 — primary
- [S22] Sentinel Event Alert, Issue 50: Medical device alarm safety in hospitals — The Joint Commission — https://www.jointcommission.org/sea_issue_50 (PDF: https://digitalassets.jointcommission.org/api/public/content/f65e5c9df2b94000a99445e0a7877007) — 8 Apr 2013 — accessed 2026-11-14 — primary (the Joint Commission's own alert and sentinel-event data)
- [S23] Alert Fatigue (primer) — AHRQ PSNet, UC Davis PSNet Editorial Team — https://psnet.ahrq.gov/primer/alert-fatigue — 15 Dec 2024 (last reviewed 2024) — accessed 2026-11-14 — secondary
- [S24] CERC: Psychology of a Crisis, 2019 update (current edition; replaces the 2014 version at https://stacks.cdc.gov/view/cdc/60292 that this note first cited) — U.S. Centers for Disease Control and Prevention — https://www.cdc.gov/cerc/media/pdfs/CERC_Psychology_of_a_Crisis.pdf (listed as "Last updated 2019" in the CERC Manual index, https://www.cdc.gov/cerc/php/cerc-manual/index.html) — 2019 — accessed 2026-11-14 — primary. Quotes re-checked against this edition: the four processing patterns, "simple, credible, and consistent", "Offer a positive course of action that can be executed", "an over-reassured public isn't the goal", "What you know / What you don't know / What process you are using to get answers", "Don't over-reassure". The phrase "Offer only what you know" is not in it.
- [S25] CDC Clear Communication Index — U.S. Centers for Disease Control and Prevention — https://www.cdc.gov/ccindex/index.html — last reviewed 29 May 2025 — accessed 2026-11-14 — primary
- [S26] Writing for understanding (Plain language guide series) — Digital.gov, U.S. GSA — https://digital.gov/guides/plain-language/writing/ — published 15 Sep 2025 — accessed 2026-11-14 — primary
- [S27] Plain language guide series (successor to PlainLanguage.gov; original content archived) — Digital.gov, U.S. GSA — https://digital.gov/guides/plain-language/ — published 23 Sep 2025 (page metadata `article:published_time`) — accessed 2026-11-14 — primary
- [S28] Arnsten AFT. Stress signalling pathways that impair prefrontal cortex structure and function. Nat Rev Neurosci 10(6):410–422 — https://doi.org/10.1038/nrn2648 — June 2009 — accessed 2026-11-14 — secondary
- [S29] Shields GS, Sazma MA, Yonelinas AP. The effects of acute stress on core executive functions: a meta-analysis and comparison with cortisol. Neurosci Biobehav Rev 68:651–668 — https://doi.org/10.1016/j.neubiorev.2016.06.038 — Sep 2016 — accessed 2026-11-14 — secondary
- [S30] Starcke K, Brand M. Decision making under stress: a selective review. Neurosci Biobehav Rev 36(4):1228–1248 — https://doi.org/10.1016/j.neubiorev.2012.02.003 — Apr 2012 — accessed 2026-11-14 — secondary
- [S31] New Report Reveals Crisis Point for America's 63 Million Family Caregivers (Caregiving in the U.S. 2025) — AARP and National Alliance for Caregiving — https://www.aarp.org/press/releases/2025-07-24-new-report-reveals-crisis-point-for-americas-63-million-family-caregivers — 24 Jul 2025 — accessed 2026-11-14 — primary (the publishers' release of their own report)
- [S32] What Is Long-Distance Caregiving? — National Institute on Aging — https://www.nia.nih.gov/health/long-distance-caregiving/what-long-distance-caregiving — content reviewed 12 Oct 2023 — accessed 2026-11-14 — secondary
- [S33] What we know about internet use, smartphone ownership and digital divides in the U.S. — Pew Research Center — https://www.pewresearch.org/short-reads/2026/01/08/internet-use-smartphone-ownership-digital-divides-in-u-s/ — 8 Jan 2026 — accessed 2026-11-14 — primary (Pew's own survey data)
- [S34] Older Users and Web Accessibility: Meeting the Needs of Ageing Web Users — W3C Web Accessibility Initiative — https://www.w3.org/WAI/older-users/ — updated 20 Nov 2025 — accessed 2026-11-14 — secondary
- [S35] Web Content Accessibility Guidelines (WCAG) 2.2 — W3C — https://www.w3.org/TR/WCAG22/ — W3C Recommendation 12 Dec 2024 — accessed 2026-11-14 — primary (the specification)
- [S36] Understanding Success Criterion 2.5.8: Target Size (Minimum) — W3C WAI — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html — updated 2 Nov 2026 (page "Date: Updated 02 November 2026") — accessed 2026-11-14 — primary (W3C's own explanation of its criterion)
- [S37] Leitão R, Silva PA. Target and spacing sizes for smartphone user interfaces for older adults: design patterns based on an evaluation with users. PLoP 2012 — https://mural.maynoothuniversity.ie/6045/ — 2012 — accessed 2026-11-14 — primary (original study)
- [S38] Berridge C, Wetle TF. Why older adults and their children disagree about in-home surveillance technology, sensors, and tracking. The Gerontologist 60(5):926–934 — https://doi.org/10.1093/geront/gnz068 — Jul 2020 — accessed 2026-11-14 — primary (original study)
- [S39] General Wellness: Policy for Low Risk Devices (guidance; supersedes 27 Sep 2019 version) — U.S. Food and Drug Administration — https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices (PDF https://www.fda.gov/media/90652/download) — 6 Jan 2026 — accessed 2026-11-14 — primary (the guidance itself)
- [S40] Making Your Website Senior Friendly (tip sheet; archived capture of 15 Sep 2012) — National Institute on Aging / National Library of Medicine, via UNT Web Archive — https://webarchive.library.unt.edu/web/20120915102518/http://www.nia.nih.gov/health/publication/making-your-website-senior-friendly — undated (archived 2012) — accessed 2026-11-14 — secondary
- [S41] Layer 1: Join and connect (local snapshot; source of truth for networking, crypto, push and live view) — Debbie team — docs/context/upstream/layer1-join-and-connect.local-snapshot.md — undated draft (snapshot 2026-11-14) — accessed 2026-11-14 — primary (project)
- [S42] Local AI Home Caregiver: Concept and Build Roadmap — Debbie team — docs/context/concept-roadmap.md — undated — accessed 2026-11-14 — primary (project)
- [S43] Debbie iOS: overnight kickoff brief (§3 non-negotiables, §5 People, §5.1 item 4 status rules, §5.2 states, §6 contract gaps, §8 cut order) — the owner — KICKOFF_PROMPT.md — 14 Nov 2026 — accessed 2026-11-14 — primary (project)
- [S44] Sending notification requests to APNs — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns — undated — accessed 2026-11-14 — primary. "APNs stores only one notification per bundle ID… In most cases, the latest notification is stored"; `apns-expiration` 0: "APNs attempts to deliver the notification only once and doesn't store it".
- [S45] Using the Amazon SNS time to live message attribute for mobile push notifications — Amazon Web Services — https://docs.aws.amazon.com/sns/latest/dg/sns-ttl.html — undated — accessed 2026-11-14 — primary (for SNS's own behaviour). `AWS.SNS.MOBILE.APNS.TTL` / `…APNS_SANDBOX.TTL`; 0 has APNs's meaning.
- [S46] About iOS 18 Updates — Apple Support — https://support.apple.com/en-us/121161 — published 9 Nov 2026 (iOS 18.1 and 18.3 entries) — accessed 2026-11-14 — primary
- [S47] About iOS 26 Updates — Apple Support — https://support.apple.com/en-us/123075 — published 9 Nov 2026 (iOS 26.1 and 26.2 entries) — accessed 2026-11-14 — primary
- [S48] Authorizing access to health data — Apple Developer Documentation — https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data — undated — accessed 2026-11-14 — primary
- [S49] Human Interface Guidelines: HealthKit — Apple — https://developer.apple.com/design/human-interface-guidelines/healthkit — undated (no change log in the fetched text) — accessed 2026-11-14 — primary. Covers "Manage health data sharing solely through the system's privacy settings" and "Refer to the Health app as Apple Health".
- [S50] ScenePhase, ScenePhase.inactive, ScenePhase.background — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/scenephase — undated — accessed 2026-11-14 — primary
- [S51] sceneWillResignActive(_:); Preparing your UI to run in the background; Extending your app's background execution time — Apple Developer Documentation — https://developer.apple.com/documentation/uikit/uiscenedelegate/scenewillresignactive(_:), https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-background, https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time — undated — accessed 2026-11-14 — primary
- [S52] CERC: Messages and Audiences, 2018 update — U.S. Centers for Disease Control and Prevention — https://www.cdc.gov/cerc/media/pdfs/CERC_Messages_and_Audiences.pdf — 2018 — accessed 2026-11-14 — primary
- [S53] Policy for Device Software Functions and Mobile Medical Applications (final guidance; Appendix B items 9, 10 and 12, and the device-function examples in section V.A) — U.S. Food and Drug Administration — https://www.fda.gov/regulatory-information/search-fda-guidance-documents/policy-device-software-functions-and-mobile-medical-applications (PDF https://www.fda.gov/media/80958/download) — 28 Sep 2022 — accessed 2026-11-14 — primary
- [S54] Human Interface Guidelines: Onboarding — Apple — https://developer.apple.com/design/human-interface-guidelines/onboarding — last changed 10 Jun 2024 — accessed 2026-11-14 — primary
- [S55] Screen densities. Apple Support tech specs: iPhone 12 mini https://support.apple.com/en-us/111877 and iPhone 13 mini https://support.apple.com/en-us/111873 ("2340‑by‑1080-pixel resolution at 476 ppi"), iPhone SE (2nd generation) https://support.apple.com/en-us/111882 ("1334-by-750… 326 ppi"), iPhone 11 https://support.apple.com/en-us/111865 ("1792-by-828… 326 ppi"). Also the Xcode 26.6 simulator device profiles in `/Library/Developer/CoreSimulator/Profiles/DeviceTypes/*.simdevicetype/Contents/Resources/profile.plist` (`mainScreenWidth`, `mainScreenScale`, `mainScreenWidthDPI`, `defaultCanvasWidth`; for example iPhone 13 mini 1080 px, scale 3, 476 dpi, canvas 1125) — Apple — undated — accessed 2026-11-14 — primary
- [S56] "Apple Intelligence finally got smart. Here's how it changes the notifications your users see" — Emily Lane, Courier (vendor blog) — https://www.courier.com/blog/apple-intelligence-notifications — 22 Jul 2026 — accessed 2026-11-14 — secondary (unverified claims about Apple's behaviour)
- [S57] "iOS 27 notification changes for marketers: notification summaries, Focus filters, and what they mean for your push copy" — Pushwoosh Team (vendor blog) — https://www.pushwoosh.com/blog/ios-27-notification-changes-push-copy/ — 8 Sep 2026 — accessed 2026-11-14 — secondary (unverified claims about Apple's behaviour)
- [S58] Lead decisions on cross-note conflicts, cited as [X<n>] (X3, X4, X5, X6, X7, X10, X21, X30, X33, X35, X41, X50, X51, X52, X53, X54) — Debbie iOS lead — docs/research/lead-decisions.md — 14 Nov 2026 — accessed 2026-11-14 — primary (project)
- [S59] "Apple Promises iOS 18 Update With Important Fix in 'Coming Weeks'" — Joe Rossignol, MacRumors — https://www.macrumors.com/2025/01/15/ios-18-update-in-coming-weeks/ — 15 Jan 2025 — accessed 2026-11-14 — secondary (press report quoting Apple's statement to the BBC)

## Review log

Independent review, 2026-11-14: 27 findings (3 high, 12 medium, 12 low). All 27 were checked against primary evidence before any change, and all 27 were confirmed and fixed. None was rejected.

While this pass was running, the lead recorded decisions X50–X54 on F03, F05, F06, F07 and F09–F11 (lead-decisions.md, commit 5024131). Where they chose a different fix, the note now follows the lead and keeps the finding's concern as a check or gate (F03, F07). Additions beyond X52 and X54 are flagged below.

This pass edited only this file. Follow-ups that other files need are listed after the table.

| ID | Severity | Resolution |
|---|---|---|
| F01 | high | **Fixed.** Confirmed in the local SDK: the `SwiftUI.swiftmodule/arm64e-apple-ios.swiftdoc` comment for `SensoryFeedback.start` and `.stop` says "Only plays feedback on watchOS". The Apple doc pages say the same, and HIG Playing haptics lists Start and Stop only under watchOS. R18 and R26 now use topic 4's events: `.success` on the first video frame; nothing on Stop, the time limit or the 1-minute warning; `.warning` for denied or turned off by the resident; `.error` when lost. R26 also follows X4 for urgent arrival. S21 now says what "verified" means (symbol, availability and doc comment), and the Sources header defines it. |
| F02 | high | **Fixed.** Confirmed in "Sending notification requests to APNs" (S44): only one stored notification per bundle ID, usually the latest. Rewrote R4 (matches lead decision X33): (1) An update is silent only when `deliveredNotifications()` holds its `alert_id`, and even then it keeps the original's level (`.timeSensitive` for urgent) with only `sound = nil`. Otherwise it gets its full tier with sound. (2) In the foreground, `willPresent` returns `[]`. (3) Push is lossy: a catch-up fetch on launch and on foreground pins unacknowledged urgent alerts. (4) PROPOSED `apns-expiration: 0` (SNS TTL 0, S45) for updates and hub-status pushes, so they can't displace a stored urgent alert. (5) A LATER App Group store for seen IDs and a background re-raise. (6) Device tests: offline, Focus, Scheduled Summary. Summary, copy deck and Open question 1 aligned. "Background fetch" re-raising was made LATER rather than tonight: without an App Group the app can't tell "never delivered" from "dismissed", and HIG says not to repeat notifications [S4]. |
| F03 | high | **Fixed.** Confirmed in HIG Notifications [S4] (double tap runs the first nondestructive action) and in R11 (the number is optional). R5 now follows the lead's resolution of this finding [X50]: after the 5.1 gates, `debbie.urgent` gets one action, "I'm On It" with `.authenticationRequired`, and "Call" and "Open Live View" stay in the app. Because no Apple source says how `.authenticationRequired` behaves on Apple Watch, the finding's safety condition becomes a release gate. The action ships only if a device test shows that a Watch double tap with the iPhone locked can't acknowledge (tested with and without a saved number). Otherwise urgent notifications carry no action and acknowledgement stays in-app. The Watch behaviour is recorded in Open question 12. An interim draft of this fix (no lock-screen acknowledgement, foreground Call and Open Live View) was replaced to match X50. |
| F04 | medium | **Fixed.** Recomputed from Apple's tech specs (12 mini and 13 mini: 2340×1080 at 476 ppi) and the Xcode 26.6 simulator device profiles (13 mini: 1080 px, scale 3, canvas 1125, 476 dpi). That gives 0.1537 mm per pt, so 14 mm = 91.1 pt; @2x is 0.1558; @3x is 0.1657–0.1664. R22 now states the formula and the worst case and uses 96 pt (≥ 14.75 mm everywhere; matches X21). The Summary sentence is corrected (the minis need the most points). The Settings text button now has an explicit ≥ 44×44 pt hit region, base text size, and ≥ 24 pt from the primary controls, with reasoning. R12 got a navigation-link exception so "Settings" passes the lint. Open question 10 updated. New source S55. |
| F05 | medium | **Fixed.** Confirmed in "Authorizing access to health data" (S48): read denial is undetectable. R23 and R13 now have one state, "No heart readings yet" (the lead's wording [X51], matching 11a R15). Its hint covers the Watch, sync and access causes, and it has an [Open Settings] button (`openSettingsURLString`). HIG HealthKit (S49) says to use the system privacy settings and the name "Apple Health". The app tracks only `getRequestStatusForAuthorization` (verified in `HKHealthStore.h`). Open question 13 covers whether the Settings page links to Health access. Note 15's separate "Health denied" state is flagged. |
| F06 | medium | **Fixed.** All the properties were verified in `UNNotificationSettings.h`. R7 follows [X52]: if any check fails, Home shows "Alerts from home may not reach you" with [Open Settings] (`openNotificationSettingsURLString`, iOS 15.4, verified). The detail and the Settings screen give the specific reason, in an ordered table covering `.provisional` or denied, `alertSetting`, `scheduledDeliverySetting` with `timeSensitiveSetting`, `lockScreenSetting`, `soundSetting` and `notificationCenterSetting`. `soundSetting` and `scheduledDeliverySetting`, which the finding asked for, aren't in X52's list; they are added and flagged to the lead. The Ring/Silent line (X41 wording) goes in onboarding, R28 and Settings, after a grep showed no SDK API reports the switch. Unit tests cover every mocked combination. |
| F07 | medium | **Fixed.** Confirmed in Apple's ScenePhase docs (S50; ".inactive… in the foreground but should pause its work"; "Expect an app that enters the background phase to terminate") and in UIKit's resign-active and background-time docs (S51). R20 now follows [X53]: (1) Stop on `.background`; (2) `.inactive` doesn't stop the session; (3) the Stop call is wrapped in `beginBackgroundTask` from the moment the scene leaves `.active`; (4) a PROPOSED sender backstop ends the session when the WebRTC viewer disconnects (Open question 14). Device tests (background, lock, Control Center) replace the UI test that couldn't catch either case. An interim 15 s `.inactive` timeout was dropped to match X53. |
| F08 | medium | **Fixed.** Deleted "which survives any summary". Open question 4 now states that a summary may present a possible event as fact. It cites About iOS 18 Updates (S46): the 18.3 italic style and the News & Entertainment pause; Reduce Interruptions in 18.1. MacRumors (S59) is cited for the accuracy problems behind the pause. It recommends a Settings line offering to turn off summaries for Debbie, plus device tests with summaries and with Reduce Interruptions on. The previously uncited blogs are now cited as S56 and S57, labelled secondary and unverified. |
| F09 | medium | **Fixed.** R15 is now a table giving each state its input and its delay. Hub offline comes from the relay's `hub.online` and last contact, and shows at once because the watchdog has already waited. Phone offline and relay down need two failures ≥ 30 s apart. Removed, stale, limited and Extra detail each have their own rule. The S41 deviation is resolved by keeping S41's wording: every relay-unreachable case reads "Can't reach home", with the cause first in the detail. So no DECISIONS entry is needed. |
| F10 | medium | **Fixed.** R13 and R14 now show the brief's three states as three independent, always-visible rows (Connection, Monitoring, Extra detail), each with its own glyph, words and age, as the lead decided [X54]. Each row has ordered inputs. The headline follows X54's precedence, plus two additions flagged to the lead: "Checking home…" (up to 10 s after returning to the foreground) and "Fall and sound detection are off" (from F11). Removed > Checking home… > Can't reach home > Monitoring status unknown > Monitoring is limited > Fall and sound detection are off > Monitoring is on. A 30 s foreground poll is defined (so "2 poll intervals" = 60 s), with state-machine tests for combined faults. |
| F11 | medium | **Fixed.** Confirmed in S41 (a "no" leaves the device unconfigured) and CONTRACTS §3.2 (`declined`). R14 now judges health only against agreed sensors, so declined is shown as declined, not degraded [X54]. The R13 Monitoring row adds "Monitoring is on: camera only" with "Sound detection is off at {name}'s choice.", and "Fall and sound detection are off" when neither sensor is in use. There are tests for each up/down/declined/none combination, and a PROPOSED CONTRACTS §3.2 `state` rule. |
| F12 | medium | **Fixed.** R1 is now a kind × voice-check table covering every `kind` in CONTRACTS §3.1, with reasoning per column. No answer or a request for help is urgent for all kinds, including `no_movement`. Answered events don't interrupt. Heart-rate kinds are worded as the missed answer (R27, S53). An optional `voice_check` field is PROPOSED. The table is PROPOSED to Layer 4, and the phone keeps the unknown → urgent rule. CONTRACTS §3.1's "no movement → attention" is flagged for reconciling. |
| F13 | medium | **Fixed.** Got the current CDC CERC chapters through the manual index ("Psychology of a Crisis: Last updated 2019"; "Messages and Audiences: 2018"). Text extracted and searched: "Offer only what you know" isn't in the 2019 edition either, and "say when you'll know more" has no exact match. §2 and §10 now quote the real wording ("What you know / What you don't know / What process you are using to get answers"; "an over-reassured public isn't the goal"; 2018: "what you are doing to find out more"). S24 is re-pointed to the 2019 edition with every quote re-checked, and S52 was added. |
| F14 | medium | **Fixed.** R12 lint now covers: (1) title case for every button (X10, with the HIG inconsistency noted); (2) verb-first labels with named exceptions ("I'm On It", per X35 and HIG Writing's "almost always"); (3) no "Debbie" in notifications and no Debbie-as-speaker ("the home hub"); (4) no in-app instructions in notifications; (5) second person only, with "this iPhone" and no "we". §11's tense rule is corrected (past for the event, present for the current state, with reasoning). Copy deck, R5, R9, R10, R11 and R26 are relabelled ("I'm On It", "Open Live View", "Mark as False Alarm", "Add a Number to Call"), and every push body is rewritten without the app name. |
| F15 | medium | **Fixed.** Added Findings §13 (installer: brief §5, S42, HIG Onboarding S54, HIG Privacy S17, S41's Local Network retry) and R30 (step-by-step setup, priming order, purpose strings). Added §14 and R31 ("No heart readings since…": info tier, never a push, doesn't touch the Monitoring row). Added §15 and R32 (a one-time "Anyone in the room… may be on camera" line; visitor notice LATER, per S42's pilot phase). |
| F16 | low | **Fixed.** Confirmed in About iOS 26 Updates (S47): 26.1 added Clear and Tinted Liquid Glass, raising "opacity of the material in apps and notifications on the Lock Screen", and 26.2 added Lock Screen time opacity. Flagged in "What changed". R25 now tests opaque surfaces and Lock Screen notifications under Clear and Tinted on iOS 26 and at both ends of the iOS 27 slider. |
| F17 | low | **Fixed.** Confirmed in `UNNotificationCategory.h` (`categorySummaryFormat API_AVAILABLE(ios(12.0))`, no deprecation) and `UNNotificationContent.h` (only `summaryArgument` and `summaryArgumentCount` deprecated, "is ignored", iOS 12.0–15.0). "What changed" is corrected: `categorySummaryFormat` sets a grouped stack's text, and no API affects Apple Intelligence summaries. |
| F18 | low | **Fixed.** Confirmed in WCAG 2.2 SC 2.2.1. R19 now offers [Keep Watching] from the 1-minute warning, available for 60 s with no cap on new sessions. A tap queues a new request for when the current session ends (KVS allows one sender per channel). It stays on the end screen. The reasoning cites the real source of the limit (KVS's 5-minute TURN credentials) and claims the Extend option instead of "essential". |
| F19 | low | **Fixed.** The suggested lines are adopted: (1) "Live view was turned off at home." [Done]; denied is now "Live view is off at home." [Done]. Both drop [Call {name}] and "Only {name} can…", which the setup page contradicts (S41) and which nudged overreach (S38). (2) "The camera laptop shows a notice while you watch." (3) "No one can open live view." until the recording question is settled. |
| F20 | low | **Fixed.** Confirmed in S41 ("New alert from Debbie") and CONTRACTS line 280. R3 now delivers the fail-safe content from `serviceExtensionTimeWillExpire()` (verified in `UNNotificationServiceExtension.h`) at `.timeSensitive`. The fallback copy is now "Alert from Home" / "Details can't be shown in this notification." (no app name, no in-app task), PROPOSED as the relay's placeholder, and listed in the R13 deck. |
| F21 | low | **Fixed.** R8, R6 and R9 now fall back to a time-only subtitle and announcement when there is no place. The primary button always offers "Open Live View" and handles "denied". PROPOSED optional `place` (alert) and `live_view_enabled` (monitoring object). With `false`, a quiet "Live view is off at home." line replaces the button. Open question 5 updated. |
| F22 | low | **Fixed.** Confirmed by grep: the S41 snapshot has no "two intervals", "first-class" or "phone was removed", while the brief §5.1 item 4 has all three. Added the brief as S43 and cited it in §10, R14 and R15. Corrected the time-zone sentence (the relay sends a Unix time and the extension formats it). Changed "cut-order item 1" to "item 4" ("Decrypting inside the push", brief §8). |
| F23 | low | **Fixed.** Added dates: S16 (change log, 7 May 2024), S27 (`article:published_time` 23 Sep 2025), S36 ("Updated 02 November 2026"). Relabelled S22, S35, S37, S38 and S39 as primary. Applying the label definition now at the top of Sources, also relabelled as primary the agencies' and publishers' own guidance and data: S24, S25, S26, S27, S31 and S33. The PSNet primer (S23), W3C WAI overview (S34), NIA pages (S32, S40), the reviews (S28–S30) and the blogs stay secondary. Section headings were adjusted to match. |
| F24 | low | **Fixed.** R9's badge now counts *unread* urgent and attention alerts (read means the card has been on screen), following HIG [S4]. The zero-count side effect (it removes notifications from Notification Center) is noted, with its link to R4, and the "badge isn't the only method" rule is met by the pinned card. R7 requests the `.badge` option (`UNAuthorizationOptionBadge`, verified). |
| F25 | low | **Fixed.** Replaced the unsourced claim with WWDC25 session 238 ("native SwiftUI controls are displayed in the distinctive Assistive Access design") set against the brief's custom-control rule [S43 §3]. Added the `UISupportsAssistiveAccess` requirement if the scene is ever adopted, and quoted the full-screen key from S11. |
| F26 | low | **Fixed.** Read FDA's "Policy for Device Software Functions and Mobile Medical Applications" (28 Sep 2022, current, S53): Appendix B items 9, 10 and 12, and the section V.A device examples. Added them to §12, framed Open question 9 as separate lawyer questions for fall and emergency alerting and for heart rate, and linked R1 and R27 to it. Not legal advice. |
| F27 | low | **Fixed in this note.** The healthy label is "Monitoring is on" everywhere, and "All quiet" is banned in any form (R12, R16; X5 and X30). One acknowledged-alert treatment: neutral card and history row with the glyph shape kept. `urgent.tint` is reserved for older *unacknowledged* urgent alerts, so the newest keeps `urgent.fill` (R17). Note 06 still needs the matching edit (below). |

Follow-ups outside this note. This pass's edit scope was this file only, so these are for the lead:
- `docs/CONTRACTS.md`:
  - §3.1: R1's severity table, including `no_movement` + no answer → urgent; optional `place` and `voice_check`.
  - §3.2: `state` judged against agreed sensors; optional `live_view_enabled`.
  - §7: the sender backstop; "Keep Watching" queued for the session's end.
  - §8: an update keeps the original's level with no sound instead of `.passive`; the relay's placeholder equals the R3 fail-safe text; the hub-offline relay body; `apns-expiration: 0` (SNS TTL 0) for updates and hub-status pushes.
- `docs/research/06-colour.md` F7 and F8: "All quiet" → "Monitoring is on"; `urgent.tint` → older unacknowledged urgent alerts, not acknowledged history rows.
- `docs/research/13-platform-extras.md` R2 already matches X50. Add R5's release gate: the action ships only if a Watch double tap with the iPhone locked can't acknowledge.
- `docs/research/15-flows-and-states.md` S15: fold "Health denied" into "No heart readings yet" (R23, X51).
- `docs/research/lead-decisions.md`:
  - X6 still says the resident's primary controls are "≥90 pt tall". X21 and R22 say 96 pt, which the F04 arithmetic supports (90 pt is 13.8 mm on the 12 mini and 13 mini).
  - X50's premise, that `.authenticationRequired` stops a Watch double tap, is untested. R5 gates on it.
  - X52 should add `soundSetting` and `scheduledDeliverySetting`, per F06.
  - X54's precedence should add "Checking home…" and "Fall and sound detection are off".
- `docs/DECISIONS.md`: nothing needed for F09, because S41's "can't reach home" wording is kept.
