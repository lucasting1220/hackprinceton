# 01 Featured-app craft
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: **iOS 27.2.1** (released 9 Nov 2026). iOS 27.0 shipped 14 Sep 2026, and iOS 26.7.3 is still being patched alongside it [S1]. Revised the same day after an independent review: see the Review log at the end._

## Questions answered

> Topic 1: "What Apple Design Award winners and the apps Apple features on the App Store (recent years, especially health, family, safety and home apps) share in visual design, motion, haptics, onboarding, copy and craft. List concrete, observable techniques."

> Brief §4.2: "Find out what Apple's featured and award-winning apps do that ordinary apps don't ... Find out what else those apps have in common, and decide with reasons what Debbie adopts tonight and what goes on the later list."

This note also covers the assignment's sub-questions: onboarding (progressive disclosure, permission priming), copy, empty states, delight that never undermines seriousness, and which techniques suit an urgent-care context and which don't.

Scope: springs, haptics, transitions, colour, type, icons, controls and platform extras each have their own topic note (3–9 and 13). In this note they appear only as patterns that run across the award winners. The numeric tokens come from those notes.

## Summary

- **Current release.** iOS 27.2.1 is the current public iOS, and iOS 27 still supports iPhone 11 and later, the same devices as iOS 26 [S1]. iOS 27.1 shipped only for iPhone Duo, Apple's first folding iPhone [S1][S3]. watchOS 27 needs Apple Watch Series 9 or later, so older Watches stay on watchOS 26.6.x [S1]. Debbie builds with the iOS 26.5 SDK. Xcode 27 needs macOS 26.6 or later, and this Mac runs 26.2 [S1][S48]. Everything recommended for tonight builds with the current toolchain. Items that need the iOS 27 SDK are on the later list.
- **Apple's lens.** On 8 June 2026 Apple republished its design principles: Purpose, Agency, Responsibility, Familiarity, Flexibility, Simplicity, Craft and Delight. Apple says plainly that delight "isn't confetti" but "the natural result of getting everything else right" [S4][S5]. Reasoning: the principles came out six days after the 2026 awards were announced [S3][S9], and the award categories are different (Delight and Fun, Inclusivity, Innovation, Interaction, Social Impact, Visuals and Graphics) [S8]. So this note doesn't claim that juries judge through the principles. It uses them as its own lens, because they suit a care app and the jury texts below praise the same qualities.
- **What the jury texts praise.** Reasoning, a synthesis of the jury texts in F3: looks matter (visuals have a whole award category, and Flighty's text opens with "beautifully designed") [S8][S12]. But for apps close to Debbie's purpose, the texts keep returning to five things:
  - key information that is always on screen (Flighty);
  - data that is interpreted, not just shown (Gentler Streak, Harvee, The Outsiders);
  - accessibility designed into the app itself (Guitar Wiz, Pine Hearts, oko);
  - restraint (grug, Primary);
  - haptics tied to a specific meaning: PowerWash Simulator's "specific haptic feedback for each hose nozzle", oko's haptic signal, and Opal's haptic for one event, unlocking a "gem" [S8][S10][S11].
  - For contrast, Denim, Vocabulary and (Not Boring) Habits are praised for haptics as delight ("custom haptics", "a nice touch", "playful haptics"), which is the use F9 limits [S10][S13].
- **Safety apps are praised for reliability under stress, as well as looks.** Watch Duty's jury calls its functions "impressive in their own right", then says "the best thing that can be said is that the app continued to step up when it needed to" [S10]. Flighty's jury praises its look and "key information where you need it most" [S12], and its founder says "we really have to shine when things go awry" [S14].
- **Apple's own copy is the model for alerts.** Two first-party examples set the pattern [S39][S40]:
  - The Apple Watch fall prompt: "It looks like you've taken a hard fall" (calm and clear).
  - The high heart rate notification: the headline "High heart rate", then one factual sentence with the value, the duration and the time.
- **Brand in content, familiar chrome.** WWDC26 guidance says to express the brand in the content layer and keep navigation familiar, and warns that custom utilitarian components can look "less native — or even dated" [S6][S7]. This conflicts with the brief's rule that every control is custom. The way through is custom styling with system behaviour: the same placement, size, gestures and transitions, measured against the system component (R12). iPhone Duo raises the cost: the system moves standard bars to the side of its outer display, but not custom ones [S56][S57].
- **Summary before video.** In iOS 27, the Home app describes what happened in camera footage before you watch it, and it combines related activity notifications [S2]. This supports Debbie's premise that the caregiver shouldn't have to watch video all day. So the summary comes first and live view second.
- **Alerts must still reach a silenced or offline phone.** Time Sensitive breaks through Focus but not the Ring/Silent switch, and the system offers to turn it off the first time one arrives [S35]. APNs stores only one notification per app for a phone it can't reach, usually the latest [S53]. So Debbie sends a calm test alert during setup, tells caregivers to keep the ringer on, and silences a wording update only when the original notification is still on screen (R16).
- **Onboarding and permissions.** Winning onboarding is short and interactive, and accessible from the first screen: Pine Hearts shows its accessibility options before play begins [S8][S20]. Debbie follows the iPhone's own accessibility settings instead of duplicating them, and says so on its welcome screen [S61] (R10). A permission priming screen has exactly one button, which opens the system prompt, and no way to leave [S27] (R9).
- **Recommendations.** R1–R27 below: 19 ADOPT-TONIGHT and 8 LATER.

## Findings

### F1. Current release, and what it means for this research
- The latest iOS and iPadOS is 27.2.1, released 9 Nov 2026 [S1]. The 27 releases so far:

  | Release | Date | Devices |
  |---|---|---|
  | iOS 27 | 14 Sep 2026 | iPhone 11 and later |
  | 27.0.1 | 28 Sep 2026 | iPhone 11 and later |
  | 27.1 | 23 Oct 2026 | iPhone Duo only. iPhone Duo is "the first folding iPhone" and came with its own release (see "What changed") [S1][S3] |
  | 27.2 | 26 Oct 2026 | iPhone 11 and later |
  | 27.2.1 | 9 Nov 2026 | iPhone 11 and later |

- iOS 26.7.3 shipped the same day as 27.2.1, also for "iPhone 11 and later" [S1]. So iOS 27 drops no iPhone, and a family's older iPhone may stay on iOS 26.x.
- **Apple Watch splits where iPhone doesn't.** watchOS 27.2.1 is for "Apple Watch Series 9 and later". watchOS 26.6.1 shipped the same day for "Apple Watch Series 6, Apple Watch Series 7, Apple Watch Series 8, Apple Watch SE (2nd generation), and Apple Watch Ultra" (the first Ultra model) [S1]. The resident's heart rate comes from an Apple Watch, so an older Watch stays on watchOS 26 while the iPhone may run iOS 27. This is passed to topic 11 (HealthKit and Watch sync) as an assumption to test: heart-rate samples from a watchOS 26.6 Watch still reach HealthKit on an iPhone running iOS 27, where resident mode reads them. Not researched here.
- Xcode 27 (14 Sep 2026) and Xcode 27.2 (29 Oct 2026) both require "macOS Tahoe 26.6 and later" [S1]. This Mac runs macOS 26.2 with Xcode 26.6 and the iOS 26.5 SDK [S48]. Building against the iOS 27 SDK therefore needs a macOS update, which is outside tonight's limits.

### F2. The lens Apple applies: its 2026 design principles
Apple's eight principles [S4], with the WWDC26 session that introduced them [S5]:

| Principle | What Apple says (quoted or close paraphrase) | Source |
|---|---|---|
| Purpose | "Every feature you add to your product asks something of the person using it. It asks for their time, their attention, and their trust." | [S5] |
| Agency | Flows should be "easy to skip or escape"; "help people recover from mistakes". Use interruptions "only when someone is about to make a big mistake". | [S4][S5] |
| Responsibility | Interfaces "throw permission prompts the second you launch them. Long before you've figured out what the app actually does." For model-generated content, "anticipate that a model might generate something unexpected or inaccurate" and add safeguards. | [S5] |
| Familiarity | "Things that look the same should behave the same." Don't reuse a well-known metaphor, such as the trash can, for a different meaning. | [S5] |
| Flexibility | "Adapt to diverse contexts and needs." "Treat accessibility as a priority from the start." "Preserve a person's context ... use natural animations to ease transitions." "Consider a variety of input methods." The session adds: "let people personalize their experience when no single solution fits everyone". | [S4][S5] |
| Simplicity | "Simplicity isn't minimalism." "Sometimes, simple means adding context and information, so people can make informed decisions." | [S4][S5] |
| Craft | Shoddy software: "You tap a button and you just have to wait ... Scrolling is jittery. Icons are misaligned." Crafted software has "responsive animations that feel fluid and provide immediate, natural feedback." | [S5] |
| Delight | "Identify the emotion you want to inspire ... a meditation app might calm." "Don't mistake delight for decoration." | [S4] |

Debbie applies Flexibility through R13 (accessibility drawn into the design), R18 (resident mode) and R10 (following the iPhone's own accessibility settings).

### F3. Award and editorial evidence, 2021–2026 (entries relevant to Debbie)
W = winner, F = finalist. The descriptions are Apple's jury or editorial text. The 2026 awards were announced on 2 Jun 2026: 12 winners chosen from 36 finalists across six categories [S9].

| Year · category | App | What Apple named | Src |
|---|---|---|---|
| 2026 · Social Impact F | Harvee | Turns Apple Watch HRV, resting heart rate and sleep into "actionable guidance". A "friendly little guy ... serves as an avatar for a person's state". On-device models keep "sensitive health data" secure. | [S8] |
| 2026 · Interaction F | The Outsiders: Athlete Tracker | A readiness score shown as "a beautiful data visualization" of training load next to sleep and resting heart rate. | [S8] |
| 2026 · Interaction W | Moonlitt | "Simple elegance", "best-in-class Liquid Glass integration, and easy onboarding". The team's own words: "how much complexity disappears into the experience". | [S8][S19] |
| 2026 · Visuals and Graphics W | Tide Guide | "Integrates the new design and Liquid Glass" and "custom animations". Data shown "in a crisp, clear manner". "Palette ... designed to match the color of the sky throughout the day." | [S8] |
| 2026 · Inclusivity W | Guitar Wiz | VoiceOver, Dynamic Type, Increase Contrast and Differentiate Without Color. With Increase Contrast on, it redraws diagrams in black and white rather than relying on the system change. It uses progressive disclosure. | [S8][S18] |
| 2026 · Inclusivity W (game) | Pine Hearts | "Clearly communicates its inclusivity options even before play begins, through settings that let players enhance text legibility, customize controls, and ease both motion and sensory feedback." | [S8][S20] |
| 2026 · Interaction W (game) | Sago Mini Jinja's Garden | "Interactions that require no reading." | [S8] |
| 2026 · Delight and Fun W | grug | "No login, no cloud syncing, nothing extraneous." | [S8] |
| 2026 · Delight and Fun F (game) | PowerWash Simulator | "Specific haptic feedback for each hose nozzle." | [S8] |
| 2026 · Social Impact W | Primary | Covers news "without once resorting to sensationalism or clickbait", with "a properly minimal UI". | [S8][S21] |
| 2026 · Inclusivity F | Structured | "Visually sharp and easy to scan ... simple layout." | [S8] |
| 2025 · Social Impact W | Watch Duty | "Clearly and reliably offering updates, resources, and real-time guidance." Its functions are "impressive in their own right", but "the best thing that can be said is that the app continued to step up when it needed to." More than 150 volunteer firefighters, dispatchers and first responders "monitor official sources around the clock". | [S10][S22] |
| 2025 · Social Impact F | Ground News | Every design element "carefully crafted to inspire trust, transparency". | [S10] |
| 2025 · Social Impact F | Opal | "Haptics when unlocking 'gems'". | [S10] |
| 2025 · Inclusivity W | Speechify | "Worked to reduce cognitive load all throughout the app." | [S10] |
| 2025 · Inclusivity F | Evolve | "Friendly and straightforward tone, inclusive language." | [S10] |
| 2025 · Delight and Fun F | Lumy | "Simple design, carefully curated color palette, and elegant widgets and Live Activities." | [S10] |
| 2025 · Delight and Fun F | Denim | "Smooth scroll transitions ... custom haptics." | [S10] |
| 2025 · Visuals and Graphics F | Vocabulary | "Charming, consistent illustrations ... clean visual style and rhythm"; haptics "a nice touch". "Quietly does everything right." | [S10] |
| 2025 · Interaction F | Mela | In cooking mode, steps are "dimmed and highlighted at the proper time". | [S10] |
| 2025 · Interaction F (game) | Skate City | "Patient onboarding." | [S10] |
| 2025 · Innovation F | Capybara | "A relaxed little capybara hangs out on the screen while the app is doing its thing." | [S10] |
| 2024 · Inclusivity W | oko | "Alerts pedestrians to the state of lighted signals through haptic and audio feedback ... a critical safety scenario ... flawless VoiceOver and Dynamic Type." | [S11] |
| 2024 · Social Impact W | Gentler Streak | "Not by insistent reminders but an optimistic and encouraging vibe." "Subtle and consistently pleasing design language." Its summary is "less about hard comparisons and more about progress". The cofounder: "Statistics are just numbers. Without knowing how to interpret them, they are meaningless." | [S11][S16] |
| 2024 · Interaction W | Crouton | Recipe apps "rise and fall on their organization and information hierarchy"; Crouton keeps people's "focus on the counter rather than their screen". | [S11] |
| 2024 · Interaction W (game) | Rytmos | "The onboarding makes gameplay instantly clear." | [S11] |
| 2024 · finalists | Tiimo, How We Feel, Ahead, Sunlitt, Meditate | Tiimo later became the 2025 iPhone App of the Year. | [S11][S23] |
| 2023 · Interaction W | Flighty | "Beautifully designed." "Key information where you need it most." "A look that mirrors time-honored airport design conventions." Live-shares a flight "with anyone, whether they have the app installed or not". The founder: "boringly obvious" and "comforting about information always being there". | [S12][S14] |
| 2023 · Social Impact W | Headspace | "Recognizable, comfortable illustration style." Collections "clearly labeled with understandable purposes". After user research, the team cut its tabs back to a Today tab: "simplicity at the surface ... depth of content underneath". | [S12][S15] |
| 2023 · Inclusivity W | Universe; stitch. | Universe: "consistently reducing complexity". stitch.: options for colour blindness, low vision and "motion sensitivities". | [S12] |
| 2022 · Inclusivity W | Procreate | "Tremor and motion filtering ... audio feedback, and color blindness settings." | [S13] |
| 2022 · Delight and Fun W | (Not Boring) Habits | "Playful haptics." | [S13] |
| 2022 · Interaction W | Slopes | "Packed with a mountain of data but as easy to navigate as a nice green run." | [S13] |
| 2022 · Visuals and Graphics W | Halide Mark II | "Focuses on the essentials ... uncluttered, smartly organized UI mimics a film camera." | [S13] |
| 2025 · App Store Awards | Tiimo; Be My Eyes | Tiimo was iPhone App of the Year: "an impressive visual planner". Be My Eyes was a Cultural Impact winner. | [S23] |
| 2024 · App Store HOW TO story | Get Your Family Organized (Picniic, Trello, FamCal, Cozi, Treehouse, Calroo) | FamCal: "There's nothing fancy about the calendar, to-do list, and notes ... which is the whole point." Treehouse: "a handy day-at-a-glance view", and a feed that "culls essential info from your family members". Calroo: "an emphasis on permissions and collaboration": some events stay "private from some members", and asking a family member for help takes "a single swipe", with replying "just as easy". Picniic: "Family Locator lets loved ones share their whereabouts in real time." | [S51] |
| 2023 · App Store collection | Apps for Older Adults | Features Medisafe, Gentler Streak, How We Feel and SilverSneakers GO. It is a list only, with no technique commentary. | [S24] |
| 2021 · App Store featured collection | HomeKit 🏠 | Home+ 6, HomePass, HomeCam ("Multiple Live Cameras"), HomeDash, nuanco. A list only, with no technique commentary. | [S52] |

**Coverage gaps, by category.** Topic 1 asks especially for health, family, safety and home apps. What I found:
- **Caregiving and remote elder monitoring:** no App Store editorial story. Searches returned only individual app listings and third-party lists, and I didn't use those.
- **Family coordination:** one App Store HOW TO story with real technique commentary [S51]. No ADA winner or finalist in 2022–2026 is a family app (I checked all five award pages [S8][S10][S11][S12][S13]).
- **Family safety** (location sharing, check-ins): no App Store editorial story and no ADA entry found. Only app listings, which I didn't use.
- **Smart home and home cameras:** one 2021 featured collection that is a list only [S52], plus Apple's own Home app and the HomeKit HIG (F8). No ADA winner or finalist in 2022–2026 is a smart-home or home-camera app.

So the caregiving evidence here comes from neighbouring categories: safety alerting (Watch Duty, oko), health data (Gentler Streak, Harvee), status at a glance (Flighty) and family coordination [S51].

### F4. What these apps do that ordinary apps don't
1. **The answer is always visible.** Flighty treats constant visibility as comfort for people under stress: "There's something comforting about information always being there" [S14]. Apple's Feedback guidance says the same: put status "near the items it describes" [S29]. Apple's Weather app puts a one-line summary above its chart [S38].
2. **They lean on a real-world convention.** Flighty models its screens on airport departure boards ("they've had 50 years of figuring out what's important") [S14]. Halide models a film camera [S13]. Apple's principle: "Build on what people know" [S4].
3. **They are designed for failure.** Flighty assumes "we won't see them again until they land" and switches its display to match [S14]. Watch Duty was honoured for performing during a crisis [S10].
4. **They interpret data instead of dumping it.** Gentler Streak frames statistics against your own history [S11][S16]. Harvee turns Watch data into guidance [S8]. Apple's own high heart rate notification gives the value, the duration and the time in one sentence [S40].
5. **Simple surface, depth underneath.** Guitar Wiz uses "progressive disclosure" [S18]. Headspace shows "simplicity at the surface" [S15]. Tide Guide's maker: "The more time you spend with it, the more you can dig into different layers" [S17]. Apple defines progressive disclosure as "showing only what's necessary upfront" [S42].
6. **Accessibility is part of the design, not a mode.** Guitar Wiz: "inclusive without making accessibility feel separate" [S18]. oko delivers its safety signal through haptics and audio [S11]. Pine Hearts asks about accessibility in onboarding [S20]. Apple notes that "about one in seven people has a disability" and asks designers to cover sight, hearing, touch, voice and cognition [S43].
7. **Brand goes in the content, familiar patterns in the chrome.** Gentler Streak's navigation is all native, while its identity lives in illustrations and data visualisations. Moonlitt's custom calendar uses iOS design language. Slack uses its tint colour sparingly [S6]. The HIG: "Express your brand with familiar components" and "Ensure branding always defers to content" [S7].
8. **Restraint.** grug has "nothing extraneous" [S8]. Primary keeps a "properly minimal UI" that "gets out of the way" [S8][S21].
9. **Motion carries meaning.** Gentler Streak's springs "emphasize hierarchy". NYT Cooking's zoom transitions "connect the tap target to the transition state" [S6]. Apple's fluid-interface principles are response, constant redirection and interruption, and spatial consistency: "if something disappears one way, we expect it to emerge from where it came" [S44]. The HIG: "Add motion purposefully" and "Let people cancel motion" [S31].
10. **Haptics carry a specific meaning.** PowerWash plays a different haptic for each nozzle [S8]. oko uses haptics as the signal itself [S11]. Apple says to keep a "clear, causal relationship between each haptic and the action that causes it", and that the best haptics are ones people "may not be conscious of, but miss when it's turned off" [S32].
11. **A small palette with rules.** Lumy's palette is "carefully curated" [S10]. Apple's foundations session picks a palette and sets "some simple rules to use it" [S42]. Tide Guide's palette follows the sky [S8].
12. **They show up outside the app.** Widgets, Live Activities, the Dynamic Island and Apple Watch support recur across winners: Flighty, Tide Guide, Lumy, Mela and Guitar Wiz [S12][S8][S10][S18].
13. **Their makers explore widely.** Flighty sketches 20 concepts before choosing [S14]. Apple's Craft principle: "Experiment and iterate" [S4].
14. **Each person keeps control.** Calroo lets a family keep some events "private from some members" and makes asking for help "a single swipe" [S51]. Flighty shares status even with people who don't have the app [S12].

### F5. Onboarding and permission priming
- The HIG says onboarding should be "fast, fun, and optional". Teach "through interactivity". Prefer tips in context to one long flow. "Postpone nonessential setup flows" [S25].
- Agency means a guided flow must be "easy to skip or escape" [S4].
- Pine Hearts puts accessibility choices "before gameplay begins", through "settings that let players enhance text legibility, customize controls, and ease both motion and sensory feedback" [S8][S20]. Apple's Settings guidance asks apps to "respect people's systemwide settings and avoid including redundant versions of them", naming "accessibility accommodations" among the global options people manage in the Settings app [S61]. R10 decides how Debbie handles this.
- Rytmos, Skate City, stitch. and Moonlitt are each praised for onboarding: "instantly clear", "patient", "fun" and "easy" [S11][S10][S12][S8].
- A splash or branding moment belongs at the start of onboarding, not in the launch screen [S26][S7]. The launch screen should be "nearly identical to the first screen". Apple says to avoid text on it, and that it "isn't a branding opportunity": no logos "unless they're a fixed part of your app's first screen" [S26].
- **Rules for permission priming screens** [S27]:
  - Request at the moment of need.
  - The pre-alert screen has "only one button", titled with a term like "Continue" or "Next", never "Allow".
  - The screen has no close or cancel option: "don't provide a way for people to leave the screen or window without viewing the system alert".
  - It must never "confuse or mislead", or App Review will reject the app.
  - Purpose strings are "a brief, complete sentence", active voice, sentence case, ending with a period.
- **Local Network is a special case** [S55]. "There's no API to explicitly bring up the local network alert"; only a local-network operation brings it up, and Apple's own trigger code says "There's no guarantee that it'll actually trigger the alert". "The simulator doesn't support local network privacy", so the alert can only be tested on a device.
- For Health, explain why in the system sheet's message, and avoid custom screens "that replicate the standard permission screen's behavior or content" [S37]. In copy, refer to "Apple Health" or "the Apple Health app", and "Don't use the term HealthKit" [S37].
- For a custom tips system, TipKit `Tip`, `TipView` and `tipViewStyle(_:)` are available from iOS 17.0 (verified in local SDK) [S45].

### F6. Copy patterns
- **One voice, changing tone.** Apple compares two Apple Watch moments [S39]:
  - The fall prompt "It looks like you've taken a hard fall", answered with "I'm okay": "calm and clear in what could be a stressful moment".
  - A Move-streak record: celebratory, with an exclamation mark. Apple adds: "Be careful how often you use those."
- **Facts for health news.** For news "that could have negative implications about their health", the headline is "High heart rate", followed by "Your heart rate rose above 120 BPM while you seemed to be inactive for 10 minutes starting at 9:59 AM", which "gives you all the details and the data" [S40].
- **Alert tone.** Be "direct, and use a neutral, approachable tone ... avoid being oblique or accusatory, or masking the severity of the issue" [S33].
- **Cut filler** [S41]:
  - "Uh oh", "oops" and "oh no!" make it "sound like you're not taking the problem seriously".
  - "We're sorry" "sounds insincere".
  - Remove repetition, as in "Delivery delayed 10 minutes".
  - "Lead with the why".
  - Keep a word list, and use "the same button name for the same action".
- **Avoid "we".** Use "Unable to load content" instead of "We're having trouble…" [S28].
- **Labels and steps.** Button labels are verbs. Multi-step flows use consistent Next/Continue labels and end with "Done" [S28].
- **"Please", "sorry" and idioms.** Apple says "please" and "sorry" "can sound insincere. Use them sparingly", and an idiom "might not be universally understood or translate well" [S39].
- **Notifications have their own rules** [S34]:
  - a short title with "title-style capitalization and no ending punctuation";
  - body text in "complete sentences, sentence case, and proper punctuation";
  - no app name, because the system already shows the icon;
  - no "sensitive, personal, or confidential information";
  - no instructions: "avoid telling people what to do", and offer notification actions for simple tasks instead.
  - In-app text may use sentence case for its own element types, as long as each type is used consistently [S28].

### F7. Empty, loading, error and offline states
- **Empty.** "Provide clear next steps on any blank screens." Remember "empty states are usually temporary, so don't show crucial information that could then disappear" [S28]. An empty state can educate, or even celebrate, "depending on context" [S39].
- **Loading.** "Show something as soon as possible." A blank screen reads as a fault [S30].
- **Errors.** Show errors close to the problem, without blame, with how to fix it [S28]. Use an alert, not a notification, for an error [S34]. Avoid alerts at app start, for example for a missing network [S33].
- **Offline.** This is where trust is earned. Flighty assumes it will lose contact and designs for it [S14].

### F8. Apple's first-party health, safety and home patterns (evidence of technique only, not to copy)
- **Fall prompt.** Calm wording, an explicit "I'm okay" answer [S39]. Debbie's acknowledgement with a `false_alarm` flag is the caregiver-side counterpart [S46].
- **High heart rate.** Headline plus one factual sentence with the value, the duration and the time [S40].
- **Home app on iOS 27.** It combines related activity notifications and describes what happened in footage "before you watch". This needs an Apple Intelligence iPhone and a home hub [S2].
- **HomeKit camera guidance.** "Don't block camera images." Show a microphone button "only if the camera supports bidirectional audio" [S36].
- **Weather charts.** A title and subtitle summarise the chart, so people needn't read it [S38].
- **Activity rings.** Apps may show the Activity ring element (`HKActivityRingView`, verified in local SDK [S45]) for Move, Exercise and Stand only, for one person, never as decoration or branding. Other ring-like elements are allowed if they're clearly differentiated: "Differentiate other ring-like elements from Activity rings" [S37]. Reasoning for Debbie's stricter choice, no ring-like progress for heart rate: heart rate has no goal to fill, and a ring would invite confusion with Activity rings.
- **Interruption levels.** There are four: Passive, Active, Time Sensitive and Critical [S35].
  - Time Sensitive overrides scheduled delivery and breaks through Focus, but does **not** override the Ring/Silent switch on iPhone [S35]. The SDK describes it as "may play a sound; May be presented during Do Not Disturb"; only Critical "Bypasses mute switch" (verified in local SDK) [S45].
  - "The first time a Time Sensitive notification arrives from your app, the system describes how such a notification works and gives people a way to turn it off". Then "the system periodically gives people additional opportunities to evaluate" it [S35].
  - Critical is for "health and safety" and "typically" comes from public agencies or apps that "manage their health or home". It needs an entitlement that Apple must approve [S35][S64]. It also has its own permission prompt: people "will have to accept a prompt ... asking them specifically whether they want to accept critical alerts", and its own section in notification settings [S63].
  - The HIG says to "build trust by accurately representing the urgency of each notification" [S35]. It also says not to rely on a notification sound for important information, "because people may not hear it" [S34].

### F9. Delight that never undermines seriousness
Apple's position: delight comes from identifying the right emotion. For a calm app that emotion is calm, and delight is never decoration [S4][S5]. Bounciness can read as "playful", and Apple uses it to hint and to teach [S44]. Apple's rule for overshoot depends on what drives the motion, not on which screen it's on: "we recommend starting with 100% damping, or no overshoot"; "if the gesture that's driving the motion itself has momentum, then you should reward that momentum with a little bit of overshoot", because without it the motion "can often feel broken or unsatisfying". In Music, tapping to open Now Playing uses 100% damping, and swiping it closed uses 80% [S44]. Overused haptics become "tiresome" [S32]. Reasoning: Debbie has two emotional registers. One is setup and success, which can be warm. The other is alerts, status and live view, which must be steady.

| Technique | Setup and success moments (pairing confirmed, laptop added, first sync) | Urgent and trust moments (possible fall, can't reach home, monitoring degraded, camera live) |
|---|---|---|
| Spring overshoot | Tap- and state-driven motion, including the success moment itself, never overshoots: critical damping [S44]. A gesture that carried momentum ends with a slight overshoot: note 03's `settle` (damping ratio 0.85, gentler than Apple's 80% example) [S44][S67] | The same rule. Alert arrival, acknowledge, status changes and live-view start or stop are tap- or state-driven, so they never overshoot. A swipe or drag release, such as drag-down to close the live view, ends with `settle` [S44][S67] |
| Celebration (confetti, particles, mascot reaction) | Never in Debbie [S5] | Never |
| Exclamation mark or emoji | At most one "!" per flow; no emoji. Reasoning: Apple allows "occasional exclamation marks and emoji" for a brand that conveys encouragement [S7], and warns that exclamation marks "can look silly when they're frequent" [S39]. Debbie's voice is calm, and its users include older adults under stress | Never [S33][S41] |
| Haptic | The single meaning-mapped "success" event [S32] | Only the meaning-mapped alert or warning events; no decorative patterns [S32] |
| Whimsical empty-state copy or idioms | Avoid; they don't translate [S39] | Never |
| Illustration or character | No illustrations tonight (R25, LATER); no character anywhere (R21) | Never on alert, status, live or resident surfaces (R21, R25) |
| Colour | Mint as identity accent [S7] | Urgency token plus text label plus shape; colour is never the only signal [S29][S49] |

### Technique table

| # | Technique | Where observed | Why it works | Debbie applicability |
|---|---|---|---|---|
| T1 | The status answer is always visible at the top | Flighty Live Activities and Dynamic Island [S12][S14]; HIG status feedback [S29] | People under stress re-check; visible status removes the need to work it out again [S14] | Status headline first on the caregiver home (R2) |
| T2 | A familiar real-world convention as the information model | Flighty airport boards [S14]; Halide film camera [S13] | Decades-tested hierarchy, nothing new to learn [S4][S5] | Alert history as a time-ordered log, one line per event, ordered by `detected_at` [S46]. Debbie's own visual design. |
| T3 | Design the failure states first | Flighty offline handling [S14]; Watch Duty in crisis [S10] | Trust is earned when things break | "Can't reach home", degraded, removed, offline states (R8) |
| T4 | Interpret numbers | Gentler Streak [S16]; Harvee, The Outsiders [S8]; Apple's heart rate copy [S40]; Weather chart summary [S38] | People act on meaning, not raw data | Heart-rate card and trend (R14) |
| T5 | Progressive disclosure | Guitar Wiz [S18]; Headspace [S15]; Tide Guide [S17]; WWDC25 [S42] | Lowers cognitive load without removing capability | Answer first, detail one tap deeper (R1); headline, then rows (R2); alert card, then detail, then live view (R7) |
| T6 | Accessibility drawn by design | Guitar Wiz black-and-white high-contrast diagrams [S18]; Pine Hearts accessibility onboarding [S20]; oko haptic and audio signals [S11]; stitch., Procreate [S12][S13] | Inclusivity winners do this; 1 in 7 people has a disability [S43] | R13; R10 (follow the iPhone's own settings rather than copying them in the app) |
| T7 | Brand in the content layer, familiar chrome | Gentler Streak, Moonlitt, Slack [S6]; HIG Branding [S7] | No learning curve; the brand shows where it counts | Custom-styled controls with system behaviour (R12) |
| T8 | Restraint: nothing extraneous, no login | grug [S8]; Primary [S8][S21] | Every feature costs time, attention and trust [S5] | Resident mode (R18) |
| T9 | Calm, factual, non-sensational tone | Primary [S21]; Ground News [S10]; Apple fall and heart rate copy [S39][S40] | Credibility under stress | Alert and status copy (R4, R5) |
| T10 | Physically based, interruptible motion that explains change | WWDC18 fluid interfaces [S44]; Gentler Streak springs and NYT Cooking zoom [S6]; Denim [S10] | Feels like "an extension of your mind"; keeps space consistent [S44] | Motion tokens (topics 3 and 5). Row to detail is a standard push tonight. The zoom transition (`matchedTransitionSource` / `.navigationTransition(.zoom(...))`, iOS 18.0, verified in local SDK [S45]) is LATER until a device check clears an iOS 26.0–26.1 flicker regression (note 05 R5, lead decision X12) [S66][S67] |
| T11 | Haptics mapped to meaning | PowerWash per-nozzle haptics [S8]; oko's haptic signal [S11]; Opal's gem-unlock haptic [S10]. Contrast: Denim, Vocabulary and (Not Boring) Habits are praised for haptics as delight [S10][S13] | Clear cause and effect [S32] | Haptic event table (topic 4); `sensoryFeedback(_:trigger:)` iOS 17.0+ (verified in local SDK) [S45] |
| T12 | A small, curated palette with rules | Lumy [S10]; WWDC25 foundations [S42]; Tide Guide [S8] | Consistent, recognisable | Mint palette (topic 6) |
| T13 | System type for variety and legibility | Gentler Streak uses system fonts only, mixing widths and SF Rounded [S6] | Dynamic Type comes free | Topic 7 |
| T14 | A consistent illustration style | Vocabulary [S10]; Headspace [S12][S15]; Bears Gratitude [S11] | Warmth and recognition | None tonight (R25, LATER) |
| T15 | A character as an avatar for state | Harvee [S8]; Gentler Streak's mascot [S16]; Capybara [S10] | Emotional connection | None anywhere tonight (R6, R21) |
| T16 | Short, interactive onboarding | Rytmos [S11]; Skate City [S10]; stitch. [S12]; Moonlitt [S8]; HIG [S25] | Gets people to value fast | The pairing flow is the onboarding (R10) |
| T17 | Permission requests in context, with one-button priming | HIG Privacy [S27]; WWDC26 [S5]; HealthKit HIG [S37] | Trust; meets App Review rules [S27] | R9 |
| T18 | Widgets, Live Activities, Dynamic Island, Watch | Flighty, Tide Guide, Lumy, Mela, Guitar Wiz [S12][S8][S10][S18] | Information where people already look | Later list (R19) |
| T19 | Share status with people who don't have the app | Flighty live-share [S12][S14] | Family coordination | Later; more than one caregiver is out of scope (§5.4) [S46] |
| T20 | Visible provenance behind alerts | Watch Duty: humans verify official sources [S22] | Trust in the alert | Every alert shows its source kind and detection time (R3) |
| T21 | Summary before video; group related notifications | iOS 27 Home app [S2] | Saves attention | Summary first (R7); one notification per `alert_id`, grouped by `threadIdentifier` (R16) |
| T22 | Wide concept exploration | Flighty's 20 concepts [S14]; HIG Craft [S4] | Avoids settling on the first idea | R17 |
| T23 | Honest camera controls | HomeKit HIG [S36] | No dead or misleading controls | Video-only live view with no microphone control (R7) |
| T24 | Family coordination at a glance, with each person in control | Treehouse's day-at-a-glance view; Calroo's private events and one-swipe requests [S51] | Families share care across people, and each person decides what others see | Status headline first (R2); only the resident controls live view (R18); `ask` and `check_now` requests later (brief §5.3) [S46] |

## What changed in the current iOS release

- **iOS 27 shipped on 14 Sep 2026, and the current release is 27.2.1** [S1]. Device support is unchanged from iOS 26: iPhone 11 and later [S1]. watchOS 27 drops Apple Watch Series 6, 7 and 8, SE (2nd generation) and the first Ultra, which stay on watchOS 26.6.x (F1) [S1].
- **iPhone Duo, the first folding iPhone, with iOS 27.1** [S1][S3]:
  - On the outer display "the system places toolbars and tab bars on the side", and "if you use standard system components, you receive this layout automatically" [S56].
  - Custom bars don't get this. Apple says to use the navigation containers' bar support "instead of creating a custom bar for your view based on UIToolbar, UINavigationBar, or UITabBar", and "if your item uses a custom view rather than a title or icon, the system doesn't present it vertically" [S57].
  - "When you build with Xcode 26 and earlier, your app doesn't extend under the status bar and camera" [S57].
  - The adaptation APIs (`toolbarVerticalEdge`, `toolbarVerticalBehavior(_:)`, `ReservedRegion`, all iOS 27.1 [S68]) have 0 matches in the iOS 26.5 SDK (verified in local SDK) [S45]. **NEEDS NEWER SDK** (R22).
  - The HIG gained the "Designing for iPhone Duo" page, and the Layout page was updated, both on 9 Sep 2026 [S3].
  - For Debbie: R12's bar placement now holds "on standard iPhones", and the brief's all-custom-controls rule costs more (Open question 1).
- **Toolchain gap. NEEDS NEWER SDK:**
  - Debbie cannot use any iOS 27-only API with Xcode 26.6 and the iOS 26.5 SDK.
  - Xcode 27 needs macOS 26.6 or later, and this Mac runs 26.2 [S1][S48].
  - Rendering changes without a new SDK, though: "Apps already using Liquid Glass get these improvements automatically when they run on this year's releases without even needing to recompile" [S62]. So a 26.5-SDK Debbie on an iOS 27 phone shows the new glass and the user's slider setting. Check it on a device (R26; Open questions, item 8).
- **The HIG design principles were reintroduced on 8 June 2026**, with the WWDC26 session "Principles of great design" (250) [S3][S4][S5]. This is new framing, not a new API, and it applies tonight.
- **New WWDC26 brand guidance.** Session 251 says to put the brand in the content layer and use standard components for the UI layer, warning that custom utilitarian components can look "dated" [S6]. The HIG Branding page was refined on 9 Sep 2026: use the accent colour "judiciously ... for primary actions or status indicators" and "consider moving it into the content layer" [S3][S7]. Debbie must reconcile this with the brief's all-custom-controls rule (R12).
- **Liquid Glass changes in iOS 27** [S2]:
  - "more uniform refraction and improved contrast";
  - app icons are "sharper and more detailed";
  - "a new slider lets you easily customize how Liquid Glass looks, from ultraclear to fully tinted". Debbie's glass decision and the on-device slider check are R26.
  - On 8 June 2026 Apple released Icon Composer 2 beta and updated the app-icon guidance; the app-icon page added "app icon format options" on 28 Oct 2026 [S3].
  - **NEEDS NEWER SDK / toolchain** to adopt the iOS 27 icon refinements (Icon Composer 2 targets the 27 releases; topic 8 should confirm whether its output needs Xcode 27).
- **The Home app now summarises before you watch.** It describes HomeKit Secure Video footage before playback and combines related activity notifications [S2]. These are system features, not APIs Debbie can call. Their value to Debbie is as evidence for the summary-first pattern.
- **The craft bar now includes the new design.** 2026 ADA juries praise "best-in-class Liquid Glass integration" (Moonlitt) and apps that "integrate the new design" (Tide Guide) [S8]. R26 decides where Debbie uses glass.
- **Live Activities, in the iOS 27 cycle.** The Live Activities HIG added guidance for "limited width layouts" on 13 Oct 2026 [S3][S65]. Its API, `isDynamicIslandLimitedInWidth`, is iOS 27.0 [S68] and absent from the iOS 26.5 SDK (verified in local SDK) [S45]. **NEEDS NEWER SDK.** Topic 13 owns Live Activities (R19).
- **Earlier in the iOS 26 cycle** [S3][S28]:
  - Writing guidance changed on 16 Dec 2025: use possessive pronouns sparingly and avoid "we".
  - Typography added emphasized weights on 16 Dec 2025.
  - **Assistive Access for third-party apps.** iOS 26 lets an app provide its own streamlined Assistive Access UI: the SwiftUI `AssistiveAccess` scene and the `UISupportsAssistiveAccess` key, both iOS 26.0 [S60]. The scene and `UIWindowSceneSessionRoleAssistiveAccessApplication` are verified in local SDK [S45]. The HIG Accessibility page added Assistive Access guidance on 9 Jun 2025 [S49]. Decision: R27 (LATER), with R18 covering tonight.
  - **Back swipe from anywhere.** UIKit's `interactiveContentPopGestureRecognizer` (iOS 26.0) "recognizes on the entire content area", alongside the leading-edge gesture (verified in local SDK) [S45]. R12.
  - **Button Shapes is now Show Borders in the API.** `accessibilityShowButtonShapes` is deprecated and "renamed: accessibilityShowBorders", which is back-deployed (verified in local SDK) [S45]. Apple tells custom controls to draw "clearly visible edges" when it's on [S68]. R13.
  - **Sheets** (24 Mar 2026): a Done button is always paired with Cancel or Back [S3][S59]. R12.
- **Unchanged guidance.** The HIG Onboarding and Launching pages were last revised on 10 June 2024, and Privacy on 21 June 2023 [S25][S26][S27]. That shows Apple's guidance for onboarding and permission priming hasn't changed since then. It doesn't show that iOS 27 left the system's permission prompts unchanged, which this note didn't research.
- **Also noted:** iOS 27 "more seamlessly chooses the best available Wi‑Fi or cellular connection" [S2]. Reasoning: this doesn't replace Debbie's own route choice between the LAN gateway and the relay, which the brief requires [S46]. It is flagged for topic 11.

## Recommendations for Debbie

APIs named in ADOPT-TONIGHT recommendations are **verified in local SDK** (iPhoneOS 26.5 SDK) [S45]. LATER items that need the iOS 27 SDK say so, and their APIs are marked absent. The minimum iOS is 26.0 (DECISIONS.md D-005) [S66], so every API below is available without an `if #available` check. If the owner lowers the minimum (D-005 lists an iOS 18 resident build as LATER), guard each API and use its fallback:

| API | Available from | Fallback below that |
|---|---|---|
| `sensoryFeedback(_:trigger:)` (the haptic tokens) | iOS 17.0 | The same named tokens, played through `UIImpactFeedbackGenerator`, `UINotificationFeedbackGenerator` or `UISelectionFeedbackGenerator`; note 04 lists the UIKit equivalent for every event [S67] |
| `matchedTransitionSource` / `.navigationTransition(.zoom(...))` | iOS 18.0 | A standard push, which is tonight's plan anyway (lead decision X12) [S66]; a crossfade under Reduce Motion |
| TipKit `Tip`, `TipView`, `tipViewStyle(_:)` | iOS 17.0 | R24 is LATER. Below iOS 17 there are no tips, and the hint becomes a line of text on its screen |
| `AccessibilityNotification.Announcement`, `accessibilitySpeechAnnouncementPriority` | iOS 17.0 | `UIAccessibility.post(notification: .announcement, argument:)`. Urgent announcements then queue instead of interrupting |
| `ContentTransition.numericText(value:)` | iOS 17.0 | `.numericText(countsDown:)` (iOS 16.0) |
| `glassEffect(_:in:)` and the other Liquid Glass APIs | iOS 26.0 | R26's opaque surface tokens; note 02 R18 plans standard materials in `Chrome/` [S67] |
| `AssistiveAccess` scene | iOS 26.0 | R27 is LATER; `UISupportsFullScreenInAssistiveAccess` works from iOS 17.0 [S60] |
| `accessibilityShowBorders` | iOS 14.0 (back-deployed) | None needed |

**R1. One job, one primary action per screen.** ADOPT-TONIGHT: costs nothing and shapes every screen.
- CRAFT.md lists every screen with a one-sentence job and its single primary action.
- No screen has more than one filled, mint-accented primary button.
- **Progressive disclosure (T5).** The answer to the screen's job comes first, and detail sits one tap deeper, "showing only what's necessary upfront" [S42][S18]: the Home headline, then the status rows (R2); the alert card, then the alert detail, then live view (R7). Reasoning: two taps keeps every detail reachable under stress without crowding Home.
- Check: screenshot review counts filled buttons per screen; a UI test reaches every detail screen from Home in 2 taps or fewer.
- Sources: [S4] Purpose and Simplicity, [S5], [S42], [S11] Crouton's hierarchy.

**R2. Status header: one headline first, then one row per dimension.** ADOPT-TONIGHT: it is the caregiver's first question, and Flighty-style constant visibility lowers stress.
- The brief and the Layer 1 doc define three independent dimensions [S46][S47]:
  - Connection: whether the relay is reachable, and the hub's last contact, from the relay;
  - Monitoring: from the latest decrypted heartbeat;
  - Language model: from Layer 4's health.
  - The removed-phone state sits above all three.
- **Headline.** The first element on the caregiver home, both at the top and first in VoiceOver order, is one headline of 6 words or fewer from a closed set. The worst state wins, in this order:
  1. this iPhone was removed from the home;
  2. can't reach home (the relay is unreachable, or it reports the hub offline);
  3. monitoring status unknown (heartbeat older than 2 intervals, or none yet);
  4. monitoring is limited (the heartbeat reports degraded);
  5. monitoring is on.
  - The wording follows lead decision X5: "Monitoring is on", "Monitoring status unknown", "Monitoring is limited", "Can't reach home", plus "This iPhone was removed" [S66].
- The language model never changes the headline. Reasoning: alerts still arrive without it. Layer 4 sends the rule's alert at once, and better wording only later as an update [S47].
- **Rows.** Under the headline, one row per dimension, each with its state and what it means for the caregiver:
  - Connection: "Home reachable · last contact 9:41 AM" or "Can't reach home · last contact 9:12 AM";
  - Monitoring: "On", "Limited: the kitchen laptop isn't reporting", or "Status unknown · last heard 9:12 AM";
  - Language model, labelled by what it changes for the caregiver, for example "Alert wording: detailed" or "Alert wording: basic. Alerts still arrive." Reasoning: the caregiver needs the consequence, not the component's name, and Apple asks for plain language without jargon [S28].
- "Monitoring is on" appears only when the connection is up and the decrypted heartbeat is no older than 2 intervals [S46].
- Check:
  - a unit test of the state → copy mapping over all 54 combinations: removed or not × 3 connection states (relay reachable and hub online; relay reachable and hub offline; relay unreachable) × 3 monitoring states (fresh and ok; fresh and degraded; stale or none) × 3 language-model states (available, unavailable, unknown). It asserts that the headline is the worst state, that every row shows its own dimension, and that no combination shows "Monitoring is on" unless the connection is up and the heartbeat is fresh;
  - a UI test asserts the first accessibility element is the headline.
- Sources: [S14][S29][S38][S46][S47]; the 2-interval rule comes from the brief [S46]. Reasoning: 6 words keeps the headline glanceable, as HIG notification titles should be "read at a glance" [S34].

**R3. Debbie's own fixed frame around the hub's alert text.** ADOPT-TONIGHT: Layer 4's model may reword an alert later.
- Every alert card and the alert detail screen render app-owned facts in a fixed order, as named accessibility elements:
  1. **Alert header:** the severity treatment (a colour token plus a text label plus a shape) and the kind label, mapped from `kind` and localised by the app. One accessibility element, read severity first, for example "Urgent. Possible fall." (as in note 10 R6 and R9) [S67].
  2. **Time line:** "Detected 9:52 PM", from `detected_at`, plus "· Received 10:07 PM" when receipt is more than 2 minutes after `detected_at`. One element.
  3. **Hub title**, then 4. **hub body**, both from Layer 4. An update replaces the wording [S47].
- If the notification extension can't decrypt an alert, the caregiver sees R16's fallback text ("There's a new alert from home."), which never puts the app name in the text [S34].
- Check: snapshot tests with an empty title, a 200-character title and an updated alert; a UI test asserts that the detail screen's first accessibility element is the alert header and that the hub title is the third.
- Sources: [S5] (safeguards for model output), [S46] (show both times when late), [S47]. Reasoning: 2 minutes is enough to ignore normal push jitter and still flag a delivery that was really late.

**R4. App-owned copy rules for alerts and status, split by where the words appear. Also proposed to Layer 4 in `docs/CONTRACTS.md`.** ADOPT-TONIGHT: a string lint is cheap and protects tone under pressure.
- **In-app alert cards and status (sentence case).** Kind labels and headlines are 30 characters or fewer, name the event, use sentence case, and have no "!" and no emoji: "Possible fall". Bodies are 1–2 sentences in this order: what, where, when, then what the caregiver can do, because the card carries the buttons that do it. This follows Apple's high heart rate pattern [S40] and its fall prompt [S39]. Sentence case is fine in-app when each element type uses it consistently [S28] (lead decision X10 [S66]).
- **Push notifications (title case).** Titles are 30 characters or fewer, with "title-style capitalization and no ending punctuation": "Possible Fall" [S34]. Bodies are complete sentences in sentence case: what, where and when, and nothing else [S34]. They never tell the caregiver what to do in the app; the next steps are notification actions ("Call {name}", "I'm On It"; note 10 R5, lead decision X35) [S34][S66][S67]. No app name, no resident name, no heart-rate numbers and no medical words [S34][S67].
- **Decision: the room appears on the Lock Screen.** The push subtitle carries the room, for example "Living room · 9:52 PM" (note 10 R8), taken only from an explicit `place` field (PROPOSED in note 10, Open question 5), never parsed from model text [S67].
  - Reasoning: Apple says to avoid sensitive information because others may see the screen [S34]. But where to go, or what to tell emergency services, is the caregiver's first actionable fact. A room name alone is less sensitive than a name or a health value. And people who want more privacy can hide previews, which then show only the generic placeholder (R16) [S34].
  - For the lead to list under "Decisions to confirm".
- Reasoning for 30 characters: a title should fit one line of a Lock Screen banner and an Apple Watch short look on the narrowest supported iPhone (note 10 R8) [S67]; Apple asks for titles people "can read at a glance, especially on Apple Watch" [S34]. Confirm on a device.
- **Banned tokens** in strings whose keys start with `alert.`, `status.`, `live.`, `error.` or `push.`:
  - matched per locale, case-insensitive, on word boundaries, never as substrings. English: `\b(we|we['’]re|we['’]ve|we['’]ll|us|our|ours|oops|uh[- ]?oh|oh no|sorry|please)\b`, plus the character "!";
  - emoji, found by Unicode property rather than a list: any Character with a scalar whose `isEmojiPresentation` is true, or with U+FE0F (verified in local SDK) [S45]. Digits and "#" on their own don't match;
  - a locale without its own pattern list fails the lint, so a new language can't ship unchecked.
  - Reasoning: a naive grep for "we" also hits "well", "Wednesday", "between" and "answer", and the lint fails builds.
- Check: a unit test runs the patterns over `Localizable.xcstrings`, with fixtures that must pass ("Wednesday", "well", "between", "answer", "Room 3 #2") and fixtures that must fail ("We're sorry", "Oops!", "😀", "⚠️").
- Sources: [S33][S41][S28][S39][S34].

**R5. Two tone registers, one voice, one word list.** ADOPT-TONIGHT: consistency builds trust.
- **Steady register:** alerts, status, errors and live view.
- **Warm register:** onboarding, pairing success and empty states. It allows at most one "!" per flow. Reasoning: Apple's own celebratory screen gets one, and Apple says exclamation marks "can look silly when they're frequent" [S39][S40].
- CRAFT.md §6 holds the word list: approved terms with short definitions, and the synonyms or alternatives to avoid [S41]. It has no size cap, because Apple expects the list to grow a word at a time [S41].
- Every step-forward button says "Continue", and the end of a flow says "Done" [S28].
- Check: a lint compares button labels and steady-register strings with the word list, and fails on any term listed to avoid.
- Sources: [S39][S40][S28][S41].

**R6. A delight budget.** ADOPT-TONIGHT: Apple's principle that delight isn't decoration, and the urgent-care fit.
- Warm success moments are exactly three: pairing confirmed, laptop approved, and the first heart-rate send succeeded. Reasoning: these are the three moments where setup visibly works.
- Each gets the single meaning-mapped success haptic (`SensoryFeedback.success`) and a no-overshoot spring (note 03's `present` or `state`) [S67]. No bounce: the success moment is state-driven, and Apple keeps overshoot for gestures that carry momentum [S44].
- The only overshoot in Debbie, on any surface, is note 03's `settle` (damping ratio 0.85) at the end of a gesture that carried momentum, such as drag-down to close the live view [S44][S67].
- No confetti, particles or mascot anywhere tonight (R21).
- Alert arrival, acknowledge, false alarm, offline or degraded, and live-view start and stop get no celebratory feedback. Acknowledge gets one quiet confirmation, because the HIG says to confirm significant completed actions [S29]: the `acknowledged` haptic event (`.success`, note 04) and the acknowledgement line (note 10 R9) appearing with the `state` spring [S67].
- Check: the haptic table in CRAFT.md has an "allowed surfaces" column; a unit test asserts that `settle` is the only spring token with bounce above 0 (note 03 R2); a lint fails on `Motion.settle` anywhere except the design system's drag-release helper (note 03 R4) [S67].
- Sources: [S4][S5][S29][S32][S44].

**R7. Summary before video, and an honest live view.** ADOPT-TONIGHT: the caregiver "doesn't want to watch video all day" [S46], and this matches the iOS 27 Home app [S2].
- The alert detail screen leads with the text summary. "Watch live" is a secondary action that never starts by itself.
- Live view has no microphone control, because it is video only [S36][S46].
- The live cue, the remaining-time label and Stop sit outside the video frame, never over it [S36].
- Remaining time uses `Text(timerInterval:countsDown:)` (iOS 16.0+).
- Check: UI tests assert that the first accessibility element on the detail screen is the alert header (R3), and that no element in the live view is labelled for a microphone.

**R8. Failure states first.** ADOPT-TONIGHT: this is where trust is earned [S14][S10].
- Every screen that depends on the network has these states designed and snapshotted:
  - loading, showing the last-known data plus "Checking…", never blank [S30];
  - can't reach home, with the last contact time;
  - monitoring degraded;
  - phone removed from the home;
  - an error that says what someone can do to fix it [S28], with exactly one primary action (R1) and at most one secondary, such as "Not Now", as in Apple's own example [S39].
- Check: the mock home triggers each state, with snapshots in light, dark and AX5.

**R9. Permission priming that follows Apple's rules.** ADOPT-TONIGHT: the brief requires priming [S46], and App Review rejects misleading priming [S27].
- There is one priming screen per permission (local network, camera, notifications, Health), shown immediately before its system prompt.
- Each has exactly one button, labelled "Continue", and no close, skip or Back. While a priming screen is on top, the edge and content-area back gestures (R12) are off and the VoiceOver escape gesture doesn't leave it; alternatively, the priming sequence is a full-screen cover with no close control. Reasoning: a Back control is "a way for people to leave the screen or window without viewing the system alert" [S27].
- **Local Network.** No API shows this alert [S55]. So "Continue" starts a local-network operation that should bring it up: an `NWBrowser` for the Layer 1 Bonjour service `_debbie._tcp` (lead decision X26; note 11a R19) [S66][S67], because "All Bonjour operations require local network access" [S55]. Apple warns: "There's no guarantee that it'll actually trigger the alert" [S55].
  - After the alert, onboarding moves on to camera priming, whatever the answer.
  - Every LAN request uses `waitsForConnectivity`, because the first operation may be denied "before the user has responded to the alert" [S55]. The Layer 1 doc asks for the same retry [S47].
  - Denied (the browser waits with `kDNSServiceErr_PolicyDenied`, or an `NWConnection` waits with `.localNetworkDenied`; both verified in local SDK [S45][S55]): the pairing screen says "Local Network is off for Debbie. Debbie uses it to find your home's laptop on this Wi-Fi." with one button, "Open Settings" (`UIApplication.openSettingsURLString`).
  - Undetermined, or no answer after 10 s: "Still looking for your home's laptop. Check that this iPhone is on the same Wi-Fi as the laptop." with "Try Again", which repeats the request. Reasoning: there's "no general API" that reports the state [S55], so access counts as granted only after the first LAN answer; 10 s matches the LAN request timeout in note 11a R19 [S67].
- The Health priming screen explains why heart rate is needed but does not copy the Health sheet's per-type toggles [S37]. Its copy says "Apple Health" or "the Apple Health app", capitalised exactly so, and never "HealthKit" [S37].
- Every purpose string is one active sentence, in sentence case, ending with a period, saying what is accessed and why [S27].
- Check:
  - a Simulator UI test asserts that each priming screen has exactly one button and no Back or close element, and that a back swipe from the edge and from mid-screen leaves it in place;
  - the Local Network alert can't appear in the Simulator ("The simulator doesn't support local network privacy") [S55], so whether it appears on "Continue" is an on-device check in the owner's morning list (Open questions, item 8). The other prompts are checked in the Simulator UI test where the Simulator presents them, and on a device otherwise;
  - a plist lint checks that each `NS…UsageDescription` ends with "." and doesn't contain "better experience";
  - the R4 string lint fails on "HealthKit" in any user-facing string, and on "Apple Health" capitalised any other way.
- Sources: [S27][S37][S5][S55].

**R10. The pairing is the onboarding.** ADOPT-TONIGHT: Apple's onboarding guidance [S25] and the agency principle [S4].
- The flow is: one welcome screen, the only place the logo and wordmark appear large [S7][S26]; then the role choice (Caregiver, Resident, Try the demo); then the real task.
- No feature carousel. Everything that isn't essential is deferred [S25].
- Priming screens inside this flow follow R9: no Back, and the back gestures are off.
- **Accessibility in onboarding (Pine Hearts, T6).** ADOPT: the welcome screen carries one line, "Text size, contrast and motion follow your iPhone's settings." Debbie builds no in-app accessibility options.
  - Reasoning: Debbie honours every system setting (R13); Apple asks apps not to include "redundant versions" of systemwide settings such as accessibility accommodations [S61]; another onboarding screen would break this recommendation's 4-screen budget; and a change made in Settings helps the person in every app, not just Debbie.
  - LATER: after the first pilot families, check whether residents need help finding those settings.
- Check: a UI test reaches the QR scanner in 4 screens or fewer from first launch: welcome, role, local-network priming, camera priming.

**R11. The launch screen is a solid colour.** ADOPT-TONIGHT: Apple's launch-screen rules [S26].
- The launch screen is one solid colour: the first screen's background token, in light and dark, with no logo and no text.
- It still counts as a custom asset, because the colour comes from Debbie's palette. Record this in `docs/DECISIONS.md`.
- Reasoning: Apple says to avoid text and allows a logo only if it's "a fixed part of your app's first screen" [S26]. A returning caregiver's first screen is Home, which has no logo (lead decision X17) [S66], so the launch screen has none.
- Check: `UILaunchScreen` contains only a colour.
- Sources: [S26][S7].

**R12. Custom-styled controls keep system behaviour, checked against the system component.** ADOPT-TONIGHT: reconciles WWDC26 brand guidance [S6][S7] with the brief's all-custom-controls rule [S46].
- Apple's condition for customising a component: "ensure that details like sizing, placement, and behavior continue to preserve a familiar experience" [S7].
- **Values come from the system, not from memory.** Each component's sizes and insets are measured from the system component it replaces, rendered in the same Simulator, size class and text size; the snapshot overlay test fails on a difference of more than 1 pt. Reasoning: typed-in numbers drift between releases (iOS 27 refined the glass; iPhone Duo moves bars), and the HIG Toolbars, Tab bars and Layout pages state no iOS bar heights [S58].

| Component | System equivalent | Must match | Gestures | Accessibility |
|---|---|---|---|---|
| Top bar | Navigation bar or toolbar inside a `NavigationStack` | Height, leading and trailing insets and title position; floats over the scrolling content [S6] | Back works from the leading edge and, on iOS 26, from the whole content area (`interactiveContentPopGestureRecognizer`) [S45]. Debbie adds no horizontal swipe on pushed screens tonight; any later one must let the system back gestures win, which is what that recognizer is for: it "should only be used to set up failure requirements with it" [S45] | Bar items that can't grow with Dynamic Type show the Large Content Viewer (`accessibilityShowsLargeContentViewer()`, iOS 15.0) [S45]; Show Borders draws their edges (R13) |
| Back button | System back button | Top leading position; hit target at least 44×44 pt [S49] | As for the top bar. Hidden on priming screens, where the back gestures are off too (R9) | The VoiceOver escape gesture goes back (`AccessibilityActionKind.escape`, iOS 13.0, where the container doesn't already provide it) [S45] |
| Sheet header | Sheet toolbar | Cancel on the leading edge, Done on the trailing edge [S59]. Done is never alone: "always pair it with a Cancel button ... or a Back button", and never all three together [S59] | Swipe down dismisses: "Support swiping to dismiss a sheet". With unsaved changes, confirm with an action sheet [S59] | As for the top bar |
| Tab bar | `TabView` tab bar | Not used tonight (lead decision X19; note 02 R10) [S66][S67]. If one is added: it floats above content at the bottom on standard iPhones [S58], and minimises on scroll only if it has an accessory, which is optional [S58] | Tap only | "When the type is set to larger accessibility sizes, the tab labels and icons appear larger in the center of the screen" [S6]. A custom bar gets this from `UILargeContentViewerInteraction`, which UIKit suggests for "a custom tab bar" [S45] |
| Buttons and toggles | `Button`, `Toggle` | Hit target at least 44×44 pt (the HIG lists 44×44 pt as the iOS default and 28×28 pt as the minimum) [S49]; sizes per lead decision X21 [S66] | Tap | Show Borders; switches also show On/Off Labels (`UIAccessibility.isOnOffSwitchLabelsEnabled`, iOS 13.0) [S45] |

- Cancel leading and the primary action trailing in a row of buttons, as the HIG puts it for alerts [S33].
- Mint is an accent for primary actions, selection and status, never a full-width bar fill [S7].
- Common actions keep familiar metaphors in Debbie's custom icons [S5].
- The logo appears only on the welcome screen and in About.
- **iPhone Duo.** On standard iPhones, bars sit at the top and bottom. On iPhone Duo's outer display the system moves standard bars to the side, but not custom ones [S56][S57]. Adapting needs the iOS 27 SDK (R22). Tonight's 26.5-SDK build runs there without extending under the status bar and camera [S57].
- Check:
  - the snapshot overlay test for each component in use, at the default text size and AX5, plus a Show Borders snapshot;
  - one UI test per gesture: edge back swipe, content-area back swipe, sheet swipe-down, and sheet swipe-down with unsaved changes showing the confirmation;
  - the Large Content Viewer is checked by long-pressing each bar item at AX5 in the screen gate.

**R13. Accessibility drawn into the design.** ADOPT-TONIGHT: Inclusivity winners do this [S18][S20], and the brief treats accessibility as a hard requirement [S46].
- Every status chip shows colour plus a text label plus a shape by default (R3, F9) [S49]. When `accessibilityDifferentiateWithoutColor` is on, Debbie adds reinforcement beyond that: any remaining fill that differs only by colour gains a pattern or an outline.
- When `colorSchemeContrast == .increased`, custom graphics (status glyphs, the heart-rate chart, the live cue) switch to dedicated high-contrast drawings, not just darker colours.
- When `accessibilityShowBorders` is on (the renamed Button Shapes value, back-deployed; verified in local SDK), custom buttons and controls draw "clearly visible edges" [S45][S68].
- When `accessibilityReduceMotion` is on, crossfades replace movement.
- When `accessibilityReduceTransparency` is on, surfaces become opaque.
- State changes are announced with `AccessibilityNotification.Announcement` (iOS 17.0). The announced string carries `accessibilitySpeechAnnouncementPriority` (iOS 17.0, cases `.low`, `.default`, `.high`; verified in local SDK) [S45]:
  - `.high` for steady-register urgent changes (possible fall, can't reach home), so they interrupt current speech instead of queuing behind it (as in note 10 R6) [S67];
  - `.default` for everything else.
- Check: snapshot tests for each environment value, including Show Borders; a unit test on the announcement builder asserts `.high` for urgent states and `.default` for the rest.
- Sources: [S18][S43][S45][S49][S68].

**R14. Numbers with meaning for heart rate.** ADOPT-TONIGHT: Gentler Streak and Harvee's lesson [S16][S8].
- Show the value, unit and age together, such as "72 BPM · 4 min ago".
- A one-line summary title sits above any trend chart [S38].
- Value changes use `.contentTransition(.numericText(value:))` (iOS 17.0, verified in local SDK [S45]), so the digits roll up when the heart rate rises and down when it falls.
- Never use diagnostic words. A wrist heart rate is a wellness signal [S50]. The banned list matches note 10 R12 [S67]: "abnormal", "arrhythmia", "AFib", "atrial", "tachycardia", "bradycardia", "cardiac", "heart attack", "diagnos…" (any word starting so) and "emergency detected". It is matched case-insensitively on word boundaries by the R4 lint, in every user-facing string.
- "No heart data" is a neutral status, not an alarm [S50].
- Check: VoiceOver labels include the value and its age; the chart has a summary title; the R4 lint fixtures include each diagnostic term.

**R15. Empty states that teach and never falsely reassure.** ADOPT-TONIGHT: empty states are cheap and seen by every new user.
- Each empty state has one sentence saying what will appear here, plus at most one action [S28].
- The empty alert history shows "No alerts yet" together with the live monitoring status line. It never says "All clear" by itself, because empty states are temporary and must not carry crucial information [S28].
- Empty states use type and Debbie's own glyphs, not illustrations (R25).
- No idioms [S39].
- Check: snapshots of each empty state with monitoring both healthy and unknown.

**R16. Notification urgency and delivery match reality.** ADOPT-TONIGHT: needed for the alert demo, and a silent or missing fall alert is a missed emergency.
- **Entitlement.** The app carries `com.apple.developer.usernotifications.time-sensitive`. The old authorization option is deprecated with the note "Use time-sensitive entitlement" (verified in local SDK) [S45]. Xcode's capability catalogue lists "Time Sensitive Notifications" as a capability that needs no Apple approval [S64]. The brief requires it in the first upload [S46], and the Layer 1 doc assumes it [S47].
- **Levels.** The relay can't read severity, because alerts are end-to-end encrypted, so it sends every alert push as time-sensitive [S47]. After decrypting, the notification service extension sets the level from `severity` (DECISIONS.md D-008) [S66]:
  - `urgent` → `.timeSensitive`; `attention` → `.active`; `info` → `.passive`; an unknown value → `urgent`.
  - It only ever lowers the level. Whether iOS honours a lowered level is still a device test (note 10, Open question 1) [S67].
- **Relay notices.** "Hub offline" is `.active`. "Back online" is `.passive` with no sound, and replaces it through the shared collapse ID `hub-status-{home_id}` (lead decision X34) [S66].
  - Reasoning for `.active`: "hub offline" means alerts are delayed, not lost. When the home internet drops, "Monitoring carries on locally. Alerts wait in the outbox and arrive on reconnect" [S47]. The notice still lights the screen and plays a sound, and the status header shows "Can't reach home" at once (R2). It doesn't break through Focus, because a flaky connection would otherwise teach caregivers to switch Time Sensitive off for Debbie, and that switch also silences fall alerts [S35].
  - Risk accepted, for the lead to list for the owner: a caregiver in a Focus learns of an outage later.
- **Updates (`update: true`).** The extension calls `deliveredNotifications()`, the async form of `getDeliveredNotifications(completionHandler:)` [S45][S54], and looks for a notification whose `request.identifier` equals the `alert_id`. For a remote notification, "the system sets this property to the value of the `apns-collapse-id`" [S54], and Debbie's collapse ID is the `alert_id` [S47].
  - Found: present silently (`.passive`, `sound = nil`), replacing the text.
  - Not found: present at the alert's full tier, with sound. Reasoning: "APNs stores only one notification per bundle ID ... In most cases, the latest notification is stored" [S53]. For a phone that was offline when the first push went out, the update may be the only notification that ever arrives.
  - Accepted cost: if the caregiver already cleared the first notification, the update sounds again (lead decision X33) [S66].
- **What Time Sensitive can't do** [S35]. It breaks through Focus and scheduled summaries, but not the Ring/Silent switch, so a silenced phone makes no sound for a possible fall. And the first one that arrives brings up the system's explanation, with a way to turn the feature off, which the system offers again from time to time. So:
  - right after notification permission is granted, onboarding offers "Send a Test Alert": a local `.timeSensitive` notification that says nothing has happened at home (note 10 R28) [S67]. The system's one-time explanation then appears in a calm moment, not during the first real fall;
  - the notification priming screen and Settings say "Keep your ringer on, or Debbie's alerts will arrive silently." (lead decision X41) [S66];
  - Settings reads `timeSensitiveSetting` and says plainly when it's off (note 10 R7) [S67];
  - Critical Alerts, which do bypass the mute switch, are R20 (LATER).
- **Grouping.** One notification per `alert_id`, through the collapse ID. The extension sets `threadIdentifier` to `alerts` for urgent and `home-status` for everything else (note 10 R2; CONTRACTS.md §8) [S66][S67]. This is Debbie's version of the iOS 27 Home app combining related notifications [S2].
- **Hidden previews.** The alert categories set `hiddenPreviewsBodyPlaceholder` to generic text with no name or room, such as "Urgent alert from home" and "Update from home" (note 10 R7) [S34][S67].
- **Failure modes.** PROPOSED for `docs/CONTRACTS.md` §8: the relay's placeholder follows S34 too, so whichever layer fails, the caregiver sees the same honest text.

| Situation | What the caregiver sees | Level |
|---|---|---|
| Decrypted normally | App-owned title from `kind` (R4), a subtitle with room and time, and Layer 4's body | By severity, as above |
| Decryption fails, unknown version, or `truncated: true` | The extension's fallback: no title, so the system shows the app name, as S34 suggests for a generic title; body "There's a new alert from home." | `.timeSensitive` (fail safe) |
| The extension runs out of time | `serviceExtensionTimeWillExpire()` hands back the best-attempt content, which starts as that same fallback [S54] | `.timeSensitive` |
| The extension crashes or never calls its handler | "The system displays the original content" [S54]: the relay's placeholder. PROPOSED: the same no-title text, "There's a new alert from home.", instead of Layer 1's "New alert from Debbie", which puts the app name in the text [S47][S34] | Time-sensitive, as sent |
| Previews hidden | The app icon, the default title and the category's placeholder [S34]. The relay sets `aps.category`, so this works even if the extension fails (PROPOSED in note 13 R2) [S67] | As above |

  - The same rule applies to the relay's "hub offline" text: "No contact with home since 3:12 PM." instead of "Debbie hasn't heard from home since 3:12 PM" [S47][S34]. This also replaces note 10 R3's fallback body, "Open Debbie to see what happened.", which names the app and gives an instruction [S34][S67].
- APIs: `interruptionLevel`, `threadIdentifier`, `hiddenPreviewsBodyPlaceholder`, `getDeliveredNotifications(completionHandler:)`, `timeSensitiveSetting` (verified in local SDK) [S45].
- Check:
  - unit tests on the extension's content builder for each `kind` and tier; for an update whose original is still delivered (silent); **for an update that arrives first, with no delivered original (full tier, with sound)**; for decryption failure; and for timeout;
  - on-device checks in the owner's morning list: the test alert brings up the system's Time Sensitive explanation, and with the Ring/Silent switch set to silent an urgent alert arrives without sound, so the ringer line in the copy is accurate.

**R17. Explore widely for the two highest-stakes surfaces.** ADOPT-TONIGHT: Phase 3 already asks for several directions [S46].
- The alert card and the status header each get at least 6 rendered alternatives, compared side by side, with the choice logged in `docs/DECISIONS.md`.
- Sources: [S14] (Flighty sketches 20), [S4] Craft. Reasoning: 6 is a time-boxed version of Flighty's practice that fits Phase 3.

**R18. Resident mode with grug-level restraint.** ADOPT-TONIGHT: residents need the simplest possible app [S46].
- Resident mode is one screen with no tab bar, no navigation bar and no login [S8].
- It has three blocks: the last reading with its time, "Sync Now" (the brief's "Sync now", title-cased per lead decision X7), and the live-view switch. Add "Will send when you're home" only when it applies [S46][S66].
- **Interactive elements: exactly 3.** The two primary controls ("Sync Now" and the live-view switch, sized per lead decision X21) and one low-emphasis "Settings" text button [S66]. The brief requires Settings to stay reachable: a resident-paired phone must be able to unpair, and a caregiver phone must be able to turn resident mode off [S46]. The Layer 1 doc lists Settings next to resident mode [S47].
  - The Settings button stays out of the resident's way. It comes last, in layout and in reading order; it sits at least 24 pt below the primary controls; it is a plain text button with no fill and a 44×44 pt hit target; and Unpair inside Settings still asks for confirmation (note 09 R1) [S67]. This matches lead decision X6 and note 10 R22 [S66][S67].
- Everything fits without scrolling at the default text size on the smallest supported iPhone (iPhone SE, 375×667 pt), and the screen scrolls at AX5. Reasoning: an older resident shouldn't have to find hidden content, and at AX5 scrolling keeps every word readable instead of truncating it (note 10 R22) [S67]. (grug's jury text praises "nothing extraneous" [S8], not fitting on one screen.)
- **Assistive Access, tonight.** An app that doesn't opt in runs "in a reduced frame" that "matches the dimensions of a smaller iPhone or iPad screen" [S60], so the SE-size layout above is also the Assistive Access layout. The `AssistiveAccess` scene is R27 (LATER).
- Check: a UI test counts exactly 3 interactive elements, with Settings last in reading order; screenshot review; and an on-device check with Assistive Access turned on, in the owner's morning list. A test can't fake that mode, because `accessibilityAssistiveAccessEnabled` is read-only (verified in local SDK) [S45].

**R19. Live Activity and widget for status and the live-view countdown.** LATER: the brief's cut order puts platform extras last [S46].
- These are common among winners [S12][S8][S10].
- Build them only after §5.1 passes its gates.
- Topic 13 owns the decision. Its note puts a status widget first and advises against Live Activities for alerts or live view (note 13 R7–R8) [S67].
- Limited-width Live Activity layouts (HIG, 13 Oct 2026) need `isDynamicIslandLimitedInWidth`, which is iOS 27.0 and absent from the local SDK: **NEEDS NEWER SDK** [S3][S45][S65][S68].

**R20. Critical Alerts for possible falls.** LATER: the entitlement needs Apple's approval and can't be granted tonight [S35][S64].
- Critical is meant for apps that "manage their health or home" [S35], and it is the only level that overrides the Ring/Silent switch [S35][S45].
- It needs its own permission. Requesting `.criticalAlert` (`UNAuthorizationOptionCriticalAlert`, iOS 12.0, verified in local SDK [S45]) brings up a separate prompt "asking them specifically whether they want to accept critical alerts" [S63]. So it gets its own priming screen, following R9: one "Continue" button, no way out, and copy that says these alerts sound even when the iPhone is silenced or in a Focus.
- Urgent tier only (a possible fall with no answer), never hub status (note 10 R29; note 13 R6) [S67]. The entitlement is `com.apple.developer.usernotifications.critical-alerts`, requested through Apple's form [S64]. The push sends `interruption-level: critical` with a critical `sound`; local tests use `UNNotificationSound.defaultCriticalSound(withAudioVolume:)` (verified in local SDK) [S45].
- Use Time Sensitive until then (R16), with the ringer line.

**R21. No character or mascot.** LATER, as a question for after the hackathon: none tonight, anywhere (R6).
- If one is ever proposed, it belongs only in onboarding and empty states, never on alert, status, live-view or resident screens.
- Reasoning: resident mode must stay as simple as the app can be (R18) [S46]. Harvee and Gentler Streak use characters for wellness motivation [S8][S16]. A character reacting to a possible fall would break Apple's "don't mistake delight for decoration" principle [S4] and the steady register (R5).

**R22. iOS 27 polish.** LATER: NEEDS NEWER SDK, Xcode 27 and macOS 26.6 or later [S1].
- Adopt the Icon Composer 2 icon refinements [S2][S3].
- iPhone Duo: vertical bars and reserved regions for Debbie's custom chrome, using `toolbarVerticalEdge`, `toolbarVerticalBehavior(_:)` and `ReservedRegion` (all iOS 27.1, absent from the iOS 26.5 SDK) [S45][S57][S68], and a build with Xcode 27 so the app extends under the status bar and camera [S57].
- Check the WWDC26 SwiftUI additions.
- The Liquid Glass slider check needs no new SDK, so it moved to R26.

**R23. Share status with relatives who don't have the app, Flighty-style.** LATER: more than one caregiver is out of scope tonight (§5.4) [S12][S46].

**R24. Tips in context instead of a tour.** LATER: not demo-critical, and the tips need custom styling.
- Use TipKit (`Tip`, `TipView`, `tipViewStyle(_:)`, iOS 17.0+) for secondary features, for example "Keep watching starts a new request, which can be declined" [S25][S45][S46].

**R25. Illustrations: none tonight.** LATER.
- Empty states and onboarding use type and Debbie's own glyphs from the icon set (topic 8), not illustrations. CRAFT.md §2 records that no illustration style is adopted, so Phase 3 makes no illustrations.
- Reasoning: the brief asks for "any illustrations your research calls for" [S46], and this research doesn't call for any tonight:
  - winners use illustration for warmth in wellness and learning apps (Vocabulary, Headspace, Gentler Streak) [S10][S12][S6], not on care or alert surfaces;
  - Debbie's empty states sit next to live status (R15), where a cheerful drawing could read as reassurance;
  - each illustration would need light, dark and dedicated increased-contrast drawings (R13), a vector source and an export script, on a night when the logo, app icon and full icon set already fill Phase 3.
- Revisit after the hackathon, for onboarding only, if testing shows the welcome screen needs more warmth.

**R26. Glass only on chrome, opaque behind care content, checked at both ends of the slider.** ADOPT-TONIGHT: Liquid Glass is part of the 2026 craft bar [S8], but on iOS 27 the user's slider changes how it looks [S2].
- Custom chrome (the top bar, the floating action bar, the live-view controls) uses the system material, `glassEffect(_:in:)` (iOS 26.0, verified in local SDK [S45]), following topic 2 (note 02 R3–R4; lead decision X20) [S66][S67]. Never a hand-made blur.
- Alert cards, status rows, the status header's text and the live-view status bar sit on opaque surface tokens, never on glass. Note 10 R25: "Alert, status and live text never sits on a translucent material" [S67].
- Text and glyphs on glass must meet CRAFT.md's contrast thresholds at both ends of the iOS 27 slider ("ultraclear" and "fully tinted") [S2], over the busiest content they float above. Any pairing that fails at either end gets an opaque fallback surface. With Reduce Transparency on, every glass surface becomes opaque (R13).
- Reasoning: Apple says apps that already use Liquid Glass get the iOS 27 refinements "without even needing to recompile" [S62], so tonight's 26.5-SDK build shows the slider's effect on any iOS 27 phone. The demo phone's iOS version is unknown (`DEMO_IOS_VERSION` is missing), but iOS 27 runs on every iPhone that runs iOS 26 [S1], so it probably runs iOS 27.
- Check: note 02 R3's lint allows `glassEffect` only in `DesignSystem/Chrome/` [S67]; CRAFT.md records the contrast of each glass pairing; and the owner's morning list includes looking at Debbie's chrome at both slider ends on an iOS 27 phone, which needs no new SDK.

**R27. An Assistive Access scene for resident mode.** LATER.
- iOS 26 lets an app provide a streamlined UI for Assistive Access: the `AssistiveAccess` scene with `UISupportsAssistiveAccess = YES` (both iOS 26.0; the scene verified in local SDK) [S45][S60]. Without it, the system draws the app "in a reduced frame" [S60]. A trusted supporter, "such as a family member or caregiver", sets the mode up and chooses the apps [S60].
- Apple's guidance for this mode: keep the core functions, "focus on a single interaction per screen", and "ask for confirmation twice" before hard-to-undo actions [S49]. Resident mode already meets the first two (R18).
- Reasoning for LATER:
  - the scene's main gain is a UI that can "match the prominent style of Assistive Access controls" [S60]. Reasoning: that style comes from the system's controls, and Debbie's controls are custom by the brief's rule, so the gain is small (note 10 R24) [S67];
  - adding a scene changes the app's scene structure for every role, which risks the demo flows;
  - no test tonight can render Debbie as it looks inside Assistive Access, because `accessibilityAssistiveAccessEnabled` is read-only [S45].
- Tonight: resident mode fits the reduced frame (R18), and the morning list includes trying it inside Assistive Access on a device.
- When adopted: first `UISupportsFullScreenInAssistiveAccess` (iOS 17.0), then the scene for resident mode only, with Unpair confirmed twice [S49][S60].

## Open questions / risks

1. **Brief versus WWDC26 brand guidance.** The brief demands custom versions of every stylable system control [S46]. Apple warns that custom utilitarian components can look "less native — or even dated" [S6].
   - R12 lowers the risk, but judges and testers may still sense non-native chrome.
   - iPhone Duo adds a concrete cost: standard bars move to the side automatically, while custom bars and custom-view bar items don't [S56][S57], and adapting them needs the iOS 27 SDK (R22). Having no tab bar tonight (lead decision X19) limits the exposure to the top bar and sheet headers [S66].
   - Owner decision to confirm: keep all-custom, as the brief binds. Log it in `docs/DECISIONS.md`.
2. **Launch screen versus the custom-asset rule.** The HIG says to avoid text on the launch screen and allows a logo only if it's "a fixed part of your app's first screen" [S26]. The brief lists the launch screen among custom assets [S46]. R11 reads "custom" as "palette-derived solid colour", which is stricter than Apple requires (Reasoning in R11). Record this.
3. **iOS 27 rendering of an iOS 26.5-SDK build.** Apple says apps using Liquid Glass get the iOS 27 refinements without recompiling [S62]. What Debbie actually looks like on iOS 27 is an on-device check that needs no new SDK (R26; item 8). Topic 2 owns anything beyond glass.
4. **When the iOS 27 SDK becomes mandatory for uploads.** Not researched here.
   - Reasoning: Apple has historically required the newest SDK for uploads some months after a major release.
   - Topic 12 should check Apple's "Upcoming requirements" page before the final upload.
5. **Time Sensitive delivery. Resolved.** The `com.apple.developer.usernotifications.time-sensitive` entitlement is required: the old authorization option is deprecated with "Use time-sensitive entitlement" [S45], Xcode's capability catalogue lists it with no Apple approval needed [S64], the brief requires it in the first upload [S46], and the Layer 1 doc assumes it [S47] (R16). Topics 12 and 13 still list the capability in `PROGRESS.md` before enabling it [S46].
6. **Thin editorial evidence for caregiving, family safety and home apps.** F3 lists the gaps by category. The caregiving patterns are inferred from safety, health and family-coordination evidence. Topic 10's research on caregiver needs should test these inferences.
7. **Layer 4 owns alert wording.** R4's copy rules bind Debbie's own strings only. For hub `title` and `body` they are a PROPOSAL in `docs/CONTRACTS.md` [S47]. R3's fixed frame is the safeguard if Layer 4 doesn't adopt them. The relay placeholder text in R16 is likewise a PROPOSAL to Layer 1.
8. **On-device checks for the owner's morning list.** None needs the iOS 27 SDK:
   - the Local Network alert appears when "Continue" is tapped on its priming screen (R9);
   - the test alert brings up the system's Time Sensitive explanation, and an urgent alert stays silent with the Ring/Silent switch on silent (R16);
   - whether iOS honours a level lowered by the extension (R16; note 10, Open question 1) [S67];
   - Debbie's chrome at both ends of the Liquid Glass slider on iOS 27 (R26);
   - resident mode inside Assistive Access (R18, R27).

## Sources

[S1] About Apple security releases (list of releases and the "latest version" statements) — Apple Support — https://support.apple.com/en-us/100100 — continuously updated (entries through 13 Nov 2026) — accessed 2026-11-14 — primary
[S2] iOS 27 (overview page: "OS improvements", "Smarter Home") — Apple — https://www.apple.com/ios/ — undated (iOS 27 page) — accessed 2026-11-14 — primary
[S3] What's new (design guidance change log) — Apple Developer — https://developer.apple.com/design/whats-new/ — entries dated through 6 Nov 2026 — accessed 2026-11-14 — primary
[S4] Human Interface Guidelines: Design principles — Apple — https://developer.apple.com/design/human-interface-guidelines/design-principles — 8 Jun 2026 — accessed 2026-11-14 — primary
[S5] Principles of great design (WWDC26 session 250) — Apple — https://developer.apple.com/videos/play/wwdc2026/250/ — June 2026 — accessed 2026-11-14 — primary
[S6] Communicate your brand identity on iOS (WWDC26 session 251) — Apple — https://developer.apple.com/videos/play/wwdc2026/251/ — June 2026 — accessed 2026-11-14 — primary
[S7] Human Interface Guidelines: Branding — Apple — https://developer.apple.com/design/human-interface-guidelines/branding — updated 9 Sep 2026 — accessed 2026-11-14 — primary
[S8] Apple Design Awards: 2026 winners and finalists — Apple Developer — https://developer.apple.com/design/awards/ — June 2026 — accessed 2026-11-14 — primary
[S9] Apple reveals winners of the 2026 Apple Design Awards — Apple Newsroom — https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/ — 2 Jun 2026 — accessed 2026-11-14 — primary
[S10] Apple Design Awards: 2025 winners and finalists — Apple Developer — https://developer.apple.com/design/awards/2025/ — undated (2025 awards) — accessed 2026-11-14 — primary
[S11] Apple Design Awards: 2024 winners and finalists — Apple Developer — https://developer.apple.com/design/awards/2024/ — undated (2024 awards) — accessed 2026-11-14 — primary
[S12] Apple Design Awards: 2023 winners and finalists — Apple Developer — https://developer.apple.com/design/awards/2023/ — undated (2023 awards) — accessed 2026-11-14 — primary
[S13] Apple Design Awards: 2022 winners and finalists — Apple Developer — https://developer.apple.com/design/awards/2022/ — undated (2022 awards) — accessed 2026-11-14 — primary
[S14] Behind the Design: Flighty — Apple Developer — https://developer.apple.com/news/?id=970ncww4 — 5 Jun 2023 — accessed 2026-11-14 — primary
[S15] Behind the Design: Headspace — Apple Developer — https://developer.apple.com/news/?id=fkfnhq8u — 5 Jun 2023 — accessed 2026-11-14 — primary
[S16] Behind the Design: How Gentler Streak approaches fitness with "humanity" — Apple Developer — https://developer.apple.com/news/?id=3m0ht22s — 11 Jul 2024 — accessed 2026-11-14 — primary
[S17] 'I taught myself': Tucker MacDonald and the rise of Tide Guide — Apple Developer — https://developer.apple.com/news/?id=4r9b23wx — 9 May 2024 — accessed 2026-11-14 — primary
[S18] ADA Q&A: Off to see the Guitar Wiz — Apple Developer — https://developer.apple.com/news/?id=5zi5a25j — 16 May 2026 — accessed 2026-11-14 — primary
[S19] ADA Q&A: What a little Moonlitt can do — Apple Developer — https://developer.apple.com/news/?id=v1nphz91 — 16 May 2026 — accessed 2026-11-14 — primary
[S20] ADA Q&A: Loss and love in the world of Pine Hearts — Apple Developer — https://developer.apple.com/news/?id=p9gxlwd0 — 16 May 2026 — accessed 2026-11-14 — primary
[S21] ADA Q&A: Primary sources — Apple Developer — https://developer.apple.com/news/?id=n7uhd8gz — 16 May 2026 — accessed 2026-11-14 — primary
[S22] Meet the 2025 Apple Design Award Winners (App Store story) — Apple App Store — https://apps.apple.com/us/story/id1808994124 — 2025 (page metadata datePublished 2025-09-16) — accessed 2026-11-14 — primary
[S23] Apple unveils the winners of the 2025 App Store Awards — Apple Newsroom — https://www.apple.com/newsroom/2025/12/apple-unveils-the-winners-of-the-2025-app-store-awards/ — 4 Dec 2025 — accessed 2026-11-14 — primary
[S24] Apps for Older Adults (App Store collection) — Apple App Store — https://apps.apple.com/us/story/id1697357046 — 2023 (page metadata datePublished 2023-09-22) — accessed 2026-11-14 — primary
[S25] Human Interface Guidelines: Onboarding — Apple — https://developer.apple.com/design/human-interface-guidelines/onboarding — last changed 10 Jun 2024 — accessed 2026-11-14 — primary
[S26] Human Interface Guidelines: Launching — Apple — https://developer.apple.com/design/human-interface-guidelines/launching — last changed 10 Jun 2024 — accessed 2026-11-14 — primary
[S27] Human Interface Guidelines: Privacy (Requesting permission; Pre-alert screens) — Apple — https://developer.apple.com/design/human-interface-guidelines/privacy — last changed 21 Jun 2023 — accessed 2026-11-14 — primary
[S28] Human Interface Guidelines: Writing — Apple — https://developer.apple.com/design/human-interface-guidelines/writing — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
[S29] Human Interface Guidelines: Feedback — Apple — https://developer.apple.com/design/human-interface-guidelines/feedback — undated — accessed 2026-11-14 — primary
[S30] Human Interface Guidelines: Loading — Apple — https://developer.apple.com/design/human-interface-guidelines/loading — last changed 9 Jun 2025 — accessed 2026-11-14 — primary
[S31] Human Interface Guidelines: Motion — Apple — https://developer.apple.com/design/human-interface-guidelines/motion — last changed 9 Sep 2025 — accessed 2026-11-14 — primary
[S32] Human Interface Guidelines: Playing haptics — Apple — https://developer.apple.com/design/human-interface-guidelines/playing-haptics — last changed 7 May 2024 — accessed 2026-11-14 — primary
[S33] Human Interface Guidelines: Alerts — Apple — https://developer.apple.com/design/human-interface-guidelines/alerts — last changed 2 Feb 2024 — accessed 2026-11-14 — primary
[S34] Human Interface Guidelines: Notifications — Apple — https://developer.apple.com/design/human-interface-guidelines/notifications — last changed 24 Oct 2023 — accessed 2026-11-14 — primary
[S35] Human Interface Guidelines: Managing notifications — Apple — https://developer.apple.com/design/human-interface-guidelines/managing-notifications — undated — accessed 2026-11-14 — primary
[S36] Human Interface Guidelines: HomeKit (Cameras) — Apple — https://developer.apple.com/design/human-interface-guidelines/homekit — last changed 2 May 2023 — accessed 2026-11-14 — primary
[S37] Human Interface Guidelines: HealthKit (permission screen, Activity rings, Editorial guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/healthkit — undated — accessed 2026-11-14 — primary
[S38] Human Interface Guidelines: Charts — Apple — https://developer.apple.com/design/human-interface-guidelines/charts — 23 Sep 2022 — accessed 2026-11-14 — primary
[S39] Writing for interfaces (WWDC22 session 10037) — Apple — https://developer.apple.com/videos/play/wwdc2022/10037/ — June 2022 — accessed 2026-11-14 — primary
[S40] Add personality to your app through UX writing (WWDC24 session 10140) — Apple — https://developer.apple.com/videos/play/wwdc2024/10140/ — June 2024 — accessed 2026-11-14 — primary
[S41] Make a big impact with small writing changes (WWDC25 session 404) — Apple — https://developer.apple.com/videos/play/wwdc2025/404/ — June 2025 — accessed 2026-11-14 — primary
[S42] Design foundations from idea to interface (WWDC25 session 359) — Apple — https://developer.apple.com/videos/play/wwdc2025/359/ — June 2025 — accessed 2026-11-14 — primary
[S43] Principles of inclusive app design (WWDC25 session 316) — Apple — https://developer.apple.com/videos/play/wwdc2025/316/ — June 2025 — accessed 2026-11-14 — primary
[S44] Designing Fluid Interfaces (WWDC18 session 803) — Apple — https://developer.apple.com/videos/play/wwdc2018/803/ — June 2018 — accessed 2026-11-14 — primary
[S45] Local SDK interfaces, iPhoneOS 26.5 SDK in Xcode 26.6 (17F113) — Apple — /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.5.sdk — SDK 26.5 — accessed 2026-11-14 — primary (verified in local SDK). Contents checked:
  - SwiftUI.swiftinterface: `sensoryFeedback` iOS 17.0, `SensoryFeedback.success/.warning/.error/.impact(weight:intensity:)`, `matchedTransitionSource` and `navigationTransition` iOS 18.0, `ContentUnavailableView` iOS 17.0, `AssistiveAccess` scene iOS 26.0, environment `accessibilityAssistiveAccessEnabled` iOS 18.0 (get-only), `accessibilityShowsLargeContentViewer()` iOS 15.0, `AccessibilityActionKind.escape` iOS 13.0, `TabBarMinimizeBehavior` iOS 26.0.
  - SwiftUICore.swiftinterface: `glassEffect(_:in:)` iOS 26.0; `ContentTransition.numericText(countsDown:)` iOS 16.0 and `numericText(value:)` iOS 17.0; `Text(timerInterval:pauseTime:countsDown:showsHours:)`; environment `accessibilityReduceMotion`, `accessibilityDifferentiateWithoutColor`, `accessibilityReduceTransparency`, `colorSchemeContrast`; `accessibilityShowButtonShapes` "deprecated: 1000, renamed: accessibilityShowBorders"; `accessibilityShowBorders` iOS 14.0 with `@backDeployed(before: iOS 26.1)`.
  - Accessibility.swiftinterface: `AccessibilityNotification.Announcement` iOS 17.0; `accessibilitySpeechAnnouncementPriority` iOS 17.0 with `.low`, `.default`, `.high`. AXSettings.h: `AccessibilitySettings.isAssistiveAccessEnabled` iOS 18.0.
  - UserNotifications headers: `UNNotificationInterruptionLevel` Passive/Active/TimeSensitive/Critical with their comments (TimeSensitive "may play a sound; May be presented during Do Not Disturb"; Critical "Bypasses mute switch") and `interruptionLevel` iOS 15.0; `threadIdentifier`; `hiddenPreviewsBodyPlaceholder` iOS 11.0; `getDeliveredNotificationsWithCompletionHandler:`; `UNAuthorizationOptionCriticalAlert` iOS 12.0; `UNAuthorizationOptionTimeSensitive` `API_DEPRECATED("Use time-sensitive entitlement", ios(15.0, 15.0))`; `timeSensitiveSetting` and `criticalAlertSetting`; `defaultCriticalSoundWithAudioVolume:` iOS 12.0.
  - UIKit headers: `interactiveContentPopGestureRecognizer` iOS 26.0 ("recognizes on the entire content area"; "should only be used to set up failure requirements with it"); `UIWindowSceneSessionRoleAssistiveAccessApplication` iOS 26.0; `UILargeContentViewerInteraction` iOS 13.0 ("such as a custom tab bar"); `UIAccessibilityIsOnOffSwitchLabelsEnabled` iOS 13.0; `UIApplicationOpenSettingsURLString`.
  - Network.swiftinterface: `NWBrowser`; `NWPath.UnsatisfiedReason.localNetworkDenied` iOS 14.2. dns_sd.h: `kDNSServiceErr_PolicyDenied` (−65570). NSURLSession.h: `waitsForConnectivity` iOS 11.0.
  - HealthKitUI: `HKActivityRingView`. TipKit.swiftinterface: `Tip`, `TipView`, `tipViewStyle(_:)` iOS 17.0; `popoverTip(_:isPresented:...)` iOS 26.0. Swift.swiftinterface: `Unicode.Scalar.Properties.isEmojiPresentation` and `isEmoji` iOS 10.2.
  - Absent (0 matches in SwiftUI, SwiftUICore and UIKit): `toolbarVerticalEdge`, `ReservedRegion`, `toolbarVerticalBehavior`, `verticalBarEdge`, `ArrangementView`, `preferredVerticalBarBehavior`, `isDynamicIslandLimitedInWidth`.
[S46] Debbie overnight kickoff brief (KICKOFF_PROMPT.md, §3, §4, §5, §7, §8) — project owner — /Users/chava/Desktop/debbie-ios/KICKOFF_PROMPT.md — undated — accessed 2026-11-14 — primary (project context)
[S47] Layer 1 design doc, local snapshot ("Screens", "Handoff to Layer 4", "Push", "When things fail") — Debbie team — /Users/chava/Desktop/debbie-ios/docs/context/upstream/layer1-join-and-connect.local-snapshot.md — undated (snapshot 2026-11-14) — accessed 2026-11-14 — primary (project context)
[S48] PROGRESS.md environment table (macOS 26.2, Xcode 26.6, iOS 26.5 SDK) — this project — /Users/chava/Desktop/debbie-ios/PROGRESS.md — 2026-11-14 — accessed 2026-11-14 — primary (project context)
[S49] Human Interface Guidelines: Accessibility (hit-target table; "Convey information with more than color alone"; Assistive Access guidance) — Apple — https://developer.apple.com/design/human-interface-guidelines/accessibility — last changed 9 Jun 2025 — accessed 2026-11-14 — primary
[S50] Local AI Home Caregiver: concept and build roadmap (wrist heart rate is a wellness signal; "no heart data" is a status) — project owner — /Users/chava/Desktop/debbie-ios/docs/context/concept-roadmap.md — undated — accessed 2026-11-14 — primary (project context)
[S51] Get Your Family Organized (App Store HOW TO story) — Apple App Store — https://apps.apple.com/us/story/id1333945667 — page metadata datePublished 2024-06-24 — accessed 2026-11-14 — primary
[S52] HomeKit 🏠 (App Store featured collection) — Apple App Store — https://apps.apple.com/us/story/id1433141699 — page metadata datePublished 2021-04-08 — accessed 2026-11-14 — primary
[S53] Sending notification requests to APNs ("APNs stores only one notification per bundle ID") — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns — undated — accessed 2026-11-14 — primary
[S54] User Notifications reference: UNNotificationRequest.identifier (remote notifications take the `apns-collapse-id`); getDeliveredNotifications(completionHandler:); UNNotificationServiceExtension ("If you don't update the notification content before time expires, the system displays the original content"); Modifying content in newly delivered notifications; UNAuthorizationOptions.criticalAlert — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/unnotificationrequest/identifier, https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/getdeliverednotifications(completionhandler:), https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension, https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications, https://developer.apple.com/documentation/usernotifications/unauthorizationoptions/criticalalert — undated — accessed 2026-11-14 — primary
[S55] TN3179: Understanding local network privacy — Apple Developer Documentation — https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy — undated (mentions macOS 27.2) — accessed 2026-11-14 — primary
[S56] Human Interface Guidelines: Designing for iPhone Duo — Apple — https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo — new page 9 Sep 2026 — accessed 2026-11-14 — primary
[S57] Preparing your app for iPhone Duo — Apple Developer Documentation — https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo — undated — accessed 2026-11-14 — primary
[S58] Human Interface Guidelines: Tab bars (and, for the bar-height check in R12, Toolbars https://developer.apple.com/design/human-interface-guidelines/toolbars and Layout https://developer.apple.com/design/human-interface-guidelines/layout, updated 9 Sep 2026) — Apple — https://developer.apple.com/design/human-interface-guidelines/tab-bars — last changed 8 Jun 2026 — accessed 2026-11-14 — primary
[S59] Human Interface Guidelines: Sheets — Apple — https://developer.apple.com/design/human-interface-guidelines/sheets — last changed 24 Mar 2026 — accessed 2026-11-14 — primary
[S60] Assistive Access developer documentation: Assistive Access; Optimizing your app for Assistive Access; UISupportsAssistiveAccess (iOS 26.0); UISupportsFullScreenInAssistiveAccess (iOS 17.0); AssistiveAccess (SwiftUI, iOS 26.0) — Apple Developer Documentation — https://developer.apple.com/documentation/accessibility/assistive-access, https://developer.apple.com/documentation/accessibility/optimizing-your-app-for-assistive-access, https://developer.apple.com/documentation/bundleresources/information-property-list/uisupportsassistiveaccess, https://developer.apple.com/documentation/bundleresources/information-property-list/uisupportsfullscreeninassistiveaccess, https://developer.apple.com/documentation/swiftui/assistiveaccess — undated — accessed 2026-11-14 — primary
[S61] Human Interface Guidelines: Settings ("Respect people's systemwide settings and avoid including redundant versions of them") — Apple — https://developer.apple.com/design/human-interface-guidelines/settings — last changed 10 Jun 2024 — accessed 2026-11-14 — primary
[S62] Platforms State of the Union (WWDC26 session 102) — Apple — https://developer.apple.com/videos/play/wwdc2026/102/ — June 2026 — accessed 2026-11-14 — primary
[S63] What's New in User Notifications (WWDC18 session 710) — Apple — https://developer.apple.com/videos/play/wwdc2018/710/ — June 2018 — accessed 2026-11-14 (transcript read through the nonstrict.eu WWDC index, https://nonstrict.eu/wwdcindex/wwdc2018/710/) — primary
[S64] Xcode 26.6 capability catalogue (`DVTPortalCachedPortalCapabilities.json`: "Time Sensitive Notifications", profile key `com.apple.developer.usernotifications.time-sensitive`, `isPublic: true`, `editable: true`, no request form; "Critical Alerts", profile key `com.apple.developer.usernotifications.critical-alerts`, `isPublic: false`, with a request form URL) — Apple — /Applications/Xcode.app/Contents/SharedFrameworks/DVTPortal.framework/Versions/A/Resources/ — undated — accessed 2026-11-14 — primary (verified locally)
[S65] Human Interface Guidelines: Live Activities ("Support limited width presentations") — Apple — https://developer.apple.com/design/human-interface-guidelines/live-activities — last changed 13 Oct 2026 — accessed 2026-11-14 — primary
[S66] Project decisions: docs/research/lead-decisions.md (X5, X6, X7, X10, X12, X17, X19, X20, X21, X26, X33, X34, X35, X41); docs/DECISIONS.md (D-005 minimum iOS 26.0, D-008 severity tiers); docs/CONTRACTS.md §8 (push) — this project — /Users/chava/Desktop/debbie-ios/docs/ — 2026-11-14 — accessed 2026-11-14 — primary (project context)
[S67] Sibling research notes: 02-ios-design-language.md (R3, R4, R10, R18), 03-motion-springs.md (R2, R4, spring tokens), 04-haptics.md (haptic event table), 05-transitions.md (R5), 09-buttons-controls.md (R1), 10-caregivers-older-adults-alerting.md (R2–R10, R12, R22, R24, R25, R28, R29, Open questions 1 and 5), 11a-engineering-architecture.md (R19), 13-platform-extras.md (R2, R3, R6–R8) — this project — /Users/chava/Desktop/debbie-ios/docs/research/ — 2026-11-14 — accessed 2026-11-14 — primary (project context)
[S68] SwiftUI reference pages: accessibilityShowBorders ("draw interactive custom controls such as buttons with clearly visible edges"); toolbarVerticalEdge, ReservedRegion and toolbarVerticalBehavior(_:) (iOS 27.1); isDynamicIslandLimitedInWidth (iOS 27.0) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityshowborders, https://developer.apple.com/documentation/swiftui/environmentvalues/toolbarverticaledge, https://developer.apple.com/documentation/swiftui/reservedregion, https://developer.apple.com/documentation/swiftui/view/toolbarverticalbehavior(_:), https://developer.apple.com/documentation/swiftui/environmentvalues/isdynamicislandlimitedinwidth — undated — accessed 2026-11-14 — primary

## Review log

Independent review of 2026-11-14: 31 findings. All 31 were fixed; none was rejected. Each fix was re-checked against the primary source or the local SDK named below.

| ID | Severity | Resolution |
|---|---|---|
| F01 | high | **Fixed.** R16 now silences an update only when `deliveredNotifications()` holds a notification whose identifier is the `alert_id` (remote notifications take their identifier from `apns-collapse-id` [S54]); otherwise it is presented at full tier with sound. Cites the APNs storage rule [S53]. Adds a unit test for the update that arrives first. Now consistent with CONTRACTS.md §8 and lead decision X33. |
| F02 | medium | **Fixed.** R16 restated: the relay sends every alert time-sensitive, and the extension only lowers the level by decrypted severity. Open question 5 closed: the time-sensitive entitlement is required and needs no Apple approval [S45][S64][S46][S47]. Hub offline stays `.active`, now with written reasoning: alerts wait in the hub's outbox while the internet is down [S47], and a flaky connection must not teach caregivers to switch Time Sensitive off [S35]. |
| F03 | medium | **Fixed.** F8 and R16 state that Time Sensitive doesn't override the Ring/Silent switch and that the system offers to turn it off on first arrival and periodically after [S35]. R16 adds the onboarding test alert and the ringer line. R20 adds the separate `.criticalAlert` prompt [S63] and its own priming screen. |
| F04 | medium | **Fixed.** R4 split into in-app copy (sentence case, may include next steps) and push copy (title case, no instructions, notification actions instead, no app name) [S34][S28]. The room-on-Lock-Screen decision is recorded with reasoning and flagged for the owner. F6 adds the notification rules. |
| F05 | medium | **Fixed.** The F9 spring row is keyed to what drives the motion, citing S44's Music example: tap- and state-driven motion never overshoots, on any surface; a gesture with momentum ends with note 03's `settle` (damping ratio 0.85), on any surface. R6's success moments lost their bounce for the same reason. "One restrained use per moment" was removed rather than relabelled, because S44 gives state-driven motion no overshoot at all. |
| F06 | medium | **Fixed.** R2 is now a priority-ordered headline plus one row per dimension, including the language model, described by what it means for the caregiver (alerts still arrive; wording is basic). The unit test covers all 54 combinations. |
| F07 | medium | **Fixed.** R18 allows a third, low-emphasis Settings text button (last in reading order, at least 24 pt from the primary controls, no fill), as brief §5.1.7–5.1.8 requires; the UI test now counts 3. Consistent with lead decision X6 and note 10 R22. |
| F08 | medium | **Fixed.** R9 names the trigger (`NWBrowser` for `_debbie._tcp`), requires `waitsForConnectivity`, and defines copy for denied and undetermined states [S55]. The Simulator UI test now asserts only one button and no way out; the prompt itself is an on-device check (Open questions, item 8). |
| F09 | medium | **Fixed.** F1 explains that 27.1 is iPhone Duo's release. "What changed" adds the Duo facts [S56][S57], with the adaptation APIs confirmed absent from the local SDK. R12 places bars "on standard iPhones". Open question 1 adds the Duo cost, and R22 adds the LATER item for vertical bars and reserved regions. |
| F10 | medium | **Fixed.** Flagged as an iOS 26 change. Decision: the `AssistiveAccess` scene is LATER (R27), with reasons. Tonight R18 targets the reduced frame, which matches a smaller iPhone [S60]. The resident-mode check with Assistive Access on is an on-device morning check, because `accessibilityAssistiveAccessEnabled` is read-only and can't be faked in an automated test [S45]. |
| F11 | medium | **Fixed.** R12's checklist line became a per-component table checked by snapshot overlays against the system component at the default size and AX5, plus one UI test per gesture. It covers floating bars, Large Content Viewer, and Done paired with Cancel or Back [S58][S59][S6][S45]. Two corrections to the finding: tab-bar minimising is optional and tied to an accessory [S58], and Debbie has no tab bar tonight (lead decision X19). Bar heights are measured from the system component, because I found no Apple page that states them for iOS 26. |
| F12 | low | **Fixed.** R12 requires both edge and content-area back swipes (`interactiveContentPopGestureRecognizer`, iOS 26.0) and says custom horizontal gestures yield to them. R13 adds Show Borders (`accessibilityShowBorders`) and its snapshot [S45][S68]. |
| F13 | medium | **Fixed.** Searched App Store editorial. Added the 2024 "Get Your Family Organized" story, which has technique commentary [S51], and the 2021 HomeKit collection, which is a list only [S52]. The coverage gap is now stated for each category, including family safety (nothing found). Added F4 item 14 and T24. |
| F14 | medium | **Fixed.** The slider check moved out of R22 into the new R26, as an on-device morning check that needs no new SDK, because Apple says apps get the iOS 27 glass "without even needing to recompile" [S62]. Open question 3 updated. R26 decides glass on chrome only, with contrast measured at both slider ends and an opaque fallback. |
| F15 | low | **Fixed.** R13 makes label plus shape the default on every status chip; Differentiate Without Color only adds reinforcement [S49]. |
| F16 | low | **Fixed.** R3 names each accessibility element (the alert header is severity plus kind label; the hub title is third), and R7's UI test now asserts the alert header, matching R3. |
| F17 | low | **Fixed.** R16 adds a table of what the caregiver sees in each failure mode (decryption failure, timeout, crash, hidden previews) [S54]. It proposes a relay placeholder with no title and the body "There's a new alert from home." [S34]. R3 points to it. |
| F18 | low | **Fixed.** F2 has a Flexibility row [S4][S5], linked to R10, R13 and R18. |
| F19 | low | **Fixed.** The jury-lens claim was dropped and replaced with a labelled Reasoning (the principles postdate the 2026 awards). "Seldom point to visual flourish" and "not on looks" were reworded using Flighty's and Watch Duty's actual jury text and the Visuals and Graphics category. |
| F20 | low | **Fixed.** Haptics-with-meaning evidence is now PowerWash, oko and Opal only. Denim, Vocabulary and (Not Boring) Habits are in a separate "haptics for delight" line, in the Summary and T11. |
| F21 | low | **Fixed.** The launch-screen and Activity-ring conditions are quoted accurately [S26][S37]. Debbie's stricter choices are labelled Reasoning (R11, F8). The Apple Health naming rules were added to F5, R9 and the string lint [S37]. |
| F22 | low | **Fixed.** Push and in-app titles are now 30 characters or fewer, with Reasoning (was 4 words, unsourced). The 20-term word-list cap was dropped [S41]. The per-moment limit was removed (F05). "No emoji" is now Reasoning, noting that S7 allows occasional emoji. R8 now asks for at least one way to recover, with an optional secondary such as "Not Now" [S39]. R18's no-scroll rule is now Reasoning. |
| F23 | low | **Fixed.** R14 lists the banned diagnostic terms (matching note 10 R12) in the R4 lint, R6 names the acknowledge confirmation (`acknowledged` haptic plus the `state` spring), and R14 uses `numericText(value:)`, which is iOS 17.0 (verified in local SDK) and below the iOS 26.0 minimum. |
| F24 | low | **Fixed.** R4's lint is now per-locale, case-insensitive, word-boundary regexes. Emoji are found by Unicode property (`isEmojiPresentation` or U+FE0F, verified in local SDK). There are pass and fail fixtures, and a locale with no pattern list fails the lint. |
| F25 | low | **Fixed.** Added R25 (illustrations: LATER, with reasons). R21 no longer allows a mascot in resident mode. R16 gains the `threadIdentifier` grouping rule that T21 points to. T5 now maps to R1's new progressive-disclosure rule. |
| F26 | low | **Fixed.** R9: priming screens have no Back, the edge and content-area back gestures are off, and the VoiceOver escape gesture doesn't leave (or the sequence is a full-screen cover). Its UI test asserts that edge and mid-screen swipes leave the screen in place. R10 and R12 point to R9. |
| F27 | low | **Fixed.** The Live Activities limited-width entry moved to the iOS 27 cycle, with the SDK caveat (`isDynamicIslandLimitedInWidth` is iOS 27.0 and absent locally), for topic 13. The "Unchanged" claim is narrowed to HIG guidance. |
| F28 | low | **Fixed.** F1 notes that watchOS 27 needs Series 9 or later and that Series 6–8, SE (2nd generation) and the first Ultra stay on watchOS 26.6.1 [S1]. Passed to topic 11 as an assumption to test. |
| F29 | low | **Fixed.** The Recommendations preamble now has a fallback table for each API. With the iOS 26.0 minimum (D-005) none is needed tonight; the table applies if the owner lowers the minimum. |
| F30 | low | **Fixed.** R13 sets `accessibilitySpeechAnnouncementPriority` to `.high` for urgent steady-register announcements and `.default` for the rest, verified in local SDK, with a unit test. |
| F31 | low | **Fixed.** R10 decides: one line on the welcome screen saying text size, contrast and motion follow the iPhone's settings, and no in-app accessibility options, because Apple asks apps not to duplicate systemwide settings [S61]. |
