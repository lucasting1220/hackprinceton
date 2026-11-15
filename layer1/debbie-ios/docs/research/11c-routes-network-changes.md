# 11c Choosing routes at run time and detecting network changes
_Researched 2026-11-14 by the lead to fill a gap: 11a and 11b each deferred "route choice" to the other. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: 27.2.1 (see note 02)._

## Questions answered
Binding brief §9 topic 11: "choosing routes at run time and detecting network changes". Brief §6: "Routes, chosen at run time. For caregivers, the relay is the main path. The LAN gateway is used when the phone is on home Wi-Fi and the gateway answers. If the gateway fails, fall back to the relay without asking and without re-pairing. A stale LAN address after a network change just means 'LAN unavailable'. Pairing, adding a laptop over Wi-Fi, and heart rate need the LAN gateway. When the stored LAN addresses stop answering, find the coordinator's bridge again by Bonjour … confirm it with a request encrypted with the phone's own key, and update the stored addresses. Configuration may only override the choice … Measure reconnection … against the 30-second target."

## Summary
- Apple's rule for user-initiated requests: always attempt the connection. Don't guess whether the network is available, and don't cache that guess. When it fails for a transient reason, retry, and retry automatically when the host becomes reachable again [S1].
- WWDC18 "Introducing Network.framework" asks apps to "avoid using APIs like reachability to check the network state before you establish your connection", because that causes race conditions [S2].
- `NWPathMonitor` is the documented way to "monitor and react to network changes". `NWPath` exposes `status`, `usesInterfaceType(_:)`, `availableInterfaces`, `gateways`, `isExpensive`, `isConstrained` and, in iOS 26, `isUltraConstrained`, `linkQuality` and `unsatisfiedReason` (verified in local SDK) [S3][S4].
- `URLSessionConfiguration.waitsForConnectivity = true` makes a task wait for connectivity instead of failing at once. It applies only while a connection is being established, so a dropped connection still errors (`NSURLErrorNetworkConnectionLost`) [S5].
- An established connection gets "viability" and "better path" events on network changes. URLSession handles these internally; Debbie's job is to re-decide the route on path changes and to retry idempotent requests [S2][S5].

## Findings
- **Preflighting is an anti-pattern.** Apple: "For requests made at the user's behest: Always attempt to make a connection. Do not attempt to guess whether network service is available, and do not cache that determination. … If the connection failed because of a transient error, try making the connection again … your app should retry the connection attempt automatically without user intervention" [S1]. WWDC18 715 repeats it: "Please avoid using APIs like reachability to check the network state before you establish your connection. That will lead to race conditions" [S2].
- **Path changes.** `NWPathMonitor` has `start(queue:)`, `pathUpdateHandler`, `currentPath` and `cancel()`. Initialisers can require or prohibit interface types [S3]. Each update delivers an `NWPath`. A move from Wi-Fi to cellular appears as `usesInterfaceType(.wifi)` turning false. A move to a different Wi-Fi network shows up as changed `gateways` [S4].
- **Waiting versus failing fast.** With `waitsForConnectivity = true`, a task waits and the delegate gets `taskIsWaitingForConnectivity`. With `false`, it fails at once with an error such as `NSURLErrorNotConnectedToInternet` [S5]. Reasoning: a LAN probe should fail fast, because a stale LAN address must just mean "LAN unavailable" (brief §6). Relay calls can wait, within a resource timeout.
- **Dropped connections.** "This property is relevant only during the establishment of a connection. If a connection is established and then drops, the completion handler or delegate receives an error, such as NSURLErrorNetworkConnectionLost" [S5]. Idempotent requests can be retried once. Debbie's commands are idempotent by `msg_id` (CONTRACTS §2.5).
- **Local network rediscovery.** `NWBrowser` with `.bonjour(type: "_debbie._tcp", domain: nil)`, as in 11a R19. The Layer 1 doc puts the first 8 base64url characters of the hub key in the TXT record, so a phone can match its own home [S6].

## What changed in the current iOS release
iOS 26 added `NWPath.isUltraConstrained`, `linkQuality` and `unsatisfiedReason` (present in the local iOS 26.5 SDK) [S4]. Debbie doesn't need them; they're useful for diagnostics only. Nothing relevant changed in iOS 27 that our SDK can use.

## Recommendations for Debbie
- **R1. Never preflight.** Every request goes to the chosen route and handles its own failure. No reachability check gates any request [S1][S2]. *Check:* `grep -rn "SCNetworkReachability" Packages App` prints nothing. ADOPT-TONIGHT.
- **R2. The route decision (`RouteSelector` actor).**
  - Caregivers: if `NWPathMonitor.currentPath.usesInterfaceType(.wifi)`, the phone has stored LAN addresses, and the last LAN probe succeeded **after** the latest path change, use the LAN gateway. Otherwise use the relay. The relay is the default and the fallback [Brief §6].
  - Residents: LAN only.
  - *Check:* unit tests over a fake path monitor and fake probe results, for every combination. ADOPT-TONIGHT.
- **R3. A path change invalidates the LAN verdict.**
  - On every `pathUpdateHandler` call where the interface type or `gateways` differ from the previous path, set LAN = unknown and route caregivers to the relay.
  - Then, if on Wi-Fi, probe the LAN gateway in the background with `GET /v1/hello`: `waitsForConnectivity = false`, 1.5 s timeout, each stored address in turn.
  - Reasoning: the relay works on any network, so it's the safe default while the LAN is unknown [S1][S3][S4]. ADOPT-TONIGHT.
- **R4. Rediscovery.**
  - When every stored address fails while on Wi-Fi, browse `_debbie._tcp` for 5 s. Keep services whose TXT `hub` matches the stored hub-key prefix.
  - Resolve each, and confirm with an encrypted `fetch` (phone key). Only a success updates the stored addresses.
  - Never trust an address that hasn't passed the encrypted check [Brief §6][S6]. ADOPT-TONIGHT.
- **R5. Session configuration.**
  - Relay: `waitsForConnectivity = true`, `timeoutIntervalForRequest = 10`, `timeoutIntervalForResource = 25` (under the relay's 30 s HTTP limit [L1]).
  - LAN: `waitsForConnectivity = false`, `timeoutIntervalForRequest = 3`.
  - Retry `.networkConnectionLost`, `.timedOut` and `.cannotConnectToHost` up to 3 times with 0.5/1/2 s backoff. Re-seal each command with a fresh `sent_at` and the same `msg_id` (11a R19) [S5].
  - ADOPT-TONIGHT.
- **R6. Fall back without asking.** A failed LAN request for a caregiver is retried once on the relay before any error is shown. No alert or prompt, no re-pairing [Brief §6]. ADOPT-TONIGHT.
- **R7. Heart rate is LAN-only.** No relay fallback. Readings queue (protected file, 11a R16) and the screen says "Will send when you're home" [Brief §5.1.7]. ADOPT-TONIGHT.
- **R8. Configuration only overrides.** `DebbieTransportMode` is `auto` (R2), `lan`, `relay` or (Debug only) `mock`. Overrides skip the decision but not the failure handling [Brief §6]. ADOPT-TONIGHT.
- **R9. Measure reconnection (simulated).**
  - Scenario: the mock home's "gateway unreachable" or "gateway moved" control fires mid-session, while a UI test waits for the next alert.
  - Measure the time from the control to the alert being on screen. Target ≤ 30 s [L1 "When things fail"].
  - Record it in PROGRESS as a simulated measurement. The real Wi-Fi-to-cellular test is a step for the owner in MORNING_REPORT.
  - ADOPT-TONIGHT.
- **R10. Show the route, don't ask about it.** Settings › Home shows "Connected through: Home Wi-Fi" or "Internet". The home status never says "Wi-Fi" or "relay" (internal terms; voice rules). Reasoning: helps support without adding a decision for the user. ADOPT-TONIGHT.
- **R11. Live view and path changes.** WebRTC's ICE handles interface changes during a session. If the peer connection fails, the session ends with "The connection was lost", and Keep Watching starts a new request [11b R6]. ADOPT-TONIGHT.

## Open questions / risks
- iOS may delay the Local Network prompt's effect on the first request. 11a R19's retry covers it. The Simulator doesn't enforce local network privacy, so this is tested on a device only.

## Sources
- [S1] Networking Overview — "Avoid Common Networking Mistakes" / "Why Networking Is Hard" — Apple Developer Documentation Archive — https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/NetworkingOverview/WhyNetworkingIsHard/WhyNetworkingIsHard.html — undated (archive) — accessed 2026-11-14 — primary
- [S2] Introducing Network.framework (WWDC18 session 715) — Apple — https://developer.apple.com/videos/play/wwdc2018/715/ — June 2018 — accessed 2026-11-14 — primary
- [S3] NWPathMonitor — Apple Developer Documentation — https://developer.apple.com/documentation/network/nwpathmonitor — undated (iOS 12+) — accessed 2026-11-14 — primary
- [S4] NWPath — Apple Developer Documentation — https://developer.apple.com/documentation/network/nwpath — undated — accessed 2026-11-14 — primary (members verified in the local iOS 26.5 SDK)
- [S5] waitsForConnectivity — Apple Developer Documentation — https://developer.apple.com/documentation/foundation/urlsessionconfiguration/waitsforconnectivity — undated (iOS 11+) — accessed 2026-11-14 — primary
- [S6] Layer 1 design doc, "Discovery" and "When things fail" — team repository `layer-1@fa56475` — 2026-11-14 — primary (project source)
