# Debbie iOS: status against the full brief

14 Nov 2026, 15:50 EST. This compares the repo with everything `KICKOFF_PROMPT.md` asks for, not only the two-hour pivot (D-015).

The source is a read-only audit of **374 requirements**. Four auditors each covered one group of brief sections, and an adversarial verifier then checked each auditor's work. A delivery reviewer read the vendored fastlane source. Every item, with its evidence, is in `docs/research/gap-audit-2026-11-14.md`. The headline claims below were spot-checked by hand.

| Met | Partial | Not met | Deviation | Blocked |
|---|---|---|---|---|
| 168 | 153 | 24 | 14 | 15 (14 were TestFlight access, now resolved) |

## TestFlight

**Build 1 (0.1.0) is on TestFlight.**
- **History:** uploaded 15:37 EST; VALID at 15:45; What to Test notes attached 15:47.
- **Who gets it:** the internal group "Princeton Hacks", which has automatic distribution, so it reaches you without further steps.
- **How to try it:** install it from the TestFlight app and tap **Try the Demo** on the first screen.
- **Known issues:** listed in `fastlane/what-to-test.txt`.
- **How it got there:** the pipeline needed 14 fixes from the review and 2 more from the first real runs (listed below).
- **One slip, fixed:** the key ID, issuer ID and key path, never the key itself, landed in Xcode's intermediates under the gitignored `build/`. They were deleted and the cause was fixed (PROGRESS, 15:38).

## Done, with evidence
- **CRAFT.md** has all 10 sections. There are research notes for all 13 brief topics, plus 3 more.
- **Brand:**
  - logo and wordmark;
  - app icon in Any, Dark and Tinted;
  - 20 custom symbols, each in 27 variants;
  - 2 illustrations and the launch screen;
  - a mint palette with 49 measured contrast pairings.
- **Separate modules** for the design system and the care screens. A 24-rule lint fails the build on any raw animation or haptic outside the design system.
- **The app:**
  - caregiver and resident roles;
  - pairing with real crypto and the 4-digit code;
  - alerts decrypted with the home key;
  - the status header;
  - every live-view state (in the demo);
  - add a laptop, resident Sync Now, and unpair;
  - the notification extension decrypting pushes.
- **On-device demo home**, removable with one build setting.
- **Contracts:** test vectors match Node's crypto 35/35. The Node mock home passes its smoke test 22/22. The real app against the mock:
  - after a LAN cut, it was fetching through the relay in 4–8 s (target 30 s);
  - after the gateway moved, it found it again by Bonjour in 4 s;
  - unpairing was recorded by the mock.
- **Screens:** 22 screens × 8 configurations, and a main-path UI test that includes Xcode's accessibility audit.
- **Release build:** 0 warnings, no mock code, and no demo code when the setting is off.

## Missing or partial

These are the reviewers' rough estimates for one agent. Together they come to about 40 hours, plus 1–2 days for live video.

### Demo-critical flows (brief §5.1)
| # | Gap | Effort |
|---|---|---|
| 1 | **No push-token registration.** The app never registers for remote notifications, so no real push arrives, and Layer 1's push test can't target the build | 1–1.5 h |
| 2 | **No live video.** There is no WebRTC engine (D-016); every state around it exists | 1–2 days, needs Layer 1's sender |
| 3 | Alert history, the fetch cursor and seen IDs aren't persisted across launches. Acknowledgements aren't queued (a failed send is only logged) | 2.5–3.5 h |
| 4 | Heart rate:<br>• no background delivery (cut but not recorded);<br>• "since last check" isn't anchored or persisted;<br>• "Will send when you're home" isn't driven by the route;<br>• **the MUST test that the relay rejects heart rate is missing** | 3–4 h |
| 5 | Status:<br>• the `/v1/home` and heartbeat decoding differ from CONTRACTS.md;<br>• a removed phone has no Pair Again flow;<br>• nothing downgrades a stale status on a timer | ~3 h |
| 6 | Pairing errors (expired or used code, wrong network, Local Network denied) share one message and aren't tested | ~2 h |
| 7 | Live-view end reasons and the failed state aren't tested against the mock, which can't reach connecting or playing | 2–3 h |
| 8 | An alert update can change its severity; it should change only the wording | 15 min |

### Craft and accessibility (brief §4, §8 Phases 5–7)
| Gap | Effort |
|---|---|
| Motion:<br>• nothing carries gesture velocity;<br>• no interruption;<br>• no recording of an interrupted transition;<br>• three jumps or flashes in the recording | 3–4 h |
| Edge-swipe back doesn't work with the custom top bar | 2–3 h |
| No Debug component gallery and no snapshot tests. Five CRAFT components aren't built, and there are no material tokens | 4–6 h |
| Accessibility:<br>• no VoiceOver announcements for urgent alerts or live view;<br>• the status header breaks words at AX5;<br>• the spinner ignores Reduce Motion | 3–4 h |
| Haptics aren't timed to motion landings or rate-limited per alert | ~1 h |
| Performance budgets were never measured | 2–3 h |
| CRAFT's simplicity and copy checks aren't built; Home with two alerts exceeds its element budget | ~2 h |

### Process and documents
| Gap | Effort |
|---|---|
| Phase 2 (CRAFT) and Phase 7 (the three-screen audit) had self-reviews, not independent ones. The research review left 5 high findings open | 3–4 h with fresh reviewers |
| CRAFT.md has drifted from the code | 1–2 h |
| **The Layer 1 doc changed on GitHub at 14:15 and 14:27 today** (fd7db72, 2c7526e), after this work, so CONTRACTS.md needs a re-sync | 1–2 h, plus app changes |
| Phase 0 deviations, both already disclosed: caffeinate started 62 min late, and the keychain was listed once at 09:13 | none |

### Report statements corrected today
- "No flashes or layout jumps": wrong (MORNING_REPORT §2).
- "Gestures carry their velocity": wrong (§3).
- "The pipeline is ready": it had 14 first-run defects, now fixed (below).
- "iPhone only": the build was universal; fixed.
- "The app reports its push environment": not built (CONTRACTS §8.1).

## Fixed this afternoon (delivery)
Each fix was checked against the vendored fastlane 2.241.2 source (D-026–D-028).
- **Capabilities** are enabled with the public API (`create_capability`). The old call needed a web session.
- **Certificate checks** are pinned to the dedicated keychain, and profiles are bound to the certificate the lane creates. Nothing lists or imports into the login keychain.
- **Uploads** use `altool --p8-file-path`, so no copy of the key is ever written. Nothing waits on processing, and every lane has a time limit.
- **The project** is regenerated after signing, so the committed project never carries signing.
- **`DEMO_IOS_VERSION`** is compared with the minimum iOS instead of being required.
- **`beta_notes`** uses real API calls, and a new read-only `build_status` lane reports processing.
- **The app** now has `NSHealthUpdateUsageDescription` and an iPhone-only device family, and `validate-ipa.sh` checks both.
- **The pre-commit hook** no longer opens the key.
- **Bugs found on the first real runs:** `sigh` refuses `adhoc: false` together with `development: false`, and actions run one directory above the current one, so `build_app` now gets an absolute project path.
