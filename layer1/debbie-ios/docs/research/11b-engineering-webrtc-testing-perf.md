# 11b Engineering: WebRTC and KVS signalling, command-line testing, push testing, the mock home, performance budgets
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: **iOS 27.2.1** (released 9 Nov 2026). iOS 27.0 shipped on 14 Sep 2026, and iOS 26.7.3 is still being patched alongside it [S1]._

## Questions answered

> Topic 11 (KICKOFF_PROMPT.md §9): "WebRTC on iOS and the KVS signalling protocol; snapshot, UI and motion testing from the command line; performance budgets and how to measure them unattended."

> Brief §6, "Simulator": "It has no camera, so give Debug builds a way to feed in a QR payload. Find out how to test push and the notification extension locally, and document it."

> Brief §6, "The mock home": "A separate local server in this repo, outside the app target, listening on 127.0.0.1 only. Write it in Node, so its cryptography is the independent implementation that checks yours." and "For live view it may stop at the signalling boundary if a real video peer is impractical, but every state must be reachable and tested."

The assignment also quotes an older wording ("Choose the mock's form through research"). The current brief (§6) already fixes the form: a Node server on 127.0.0.1. Section F6 compares the options anyway, as asked. It confirms that form and settles the open lead decision X29. It also flags a conflict between lead decision X27 and the brief.

Scope: architecture, Keychain and NSE internals, HealthKit and route choice are in 11a and the other topic-11 notes. This note covers the live-view library and protocol, how we test, and how we measure.

## Summary

- **Toolchain.** iOS 27.2.1 is current [S1]. Xcode 27 and 27.2 need macOS Tahoe 26.6 or later, and this Mac runs 26.2 [S1][S2]. Everything below works with Xcode 26.6. Two useful Xcode 27 additions are out of reach: `XCUIVoiceOverService` and `simctl reboot` [S2].
- **WebRTC library.** Use `stasel/WebRTC` 157.0.0 (M157, released 5 Nov 2026) [S7]:
  - built from unmodified upstream code, under BSD-3 plus Google's patent grant [S7][S12];
  - a Swift Package Manager binary target, with a device arm64 slice and an arm64 + x86_64 Simulator slice;
  - ships a privacy manifest, contains no bitcode, and has a 12.6 MB device binary;
  - built with Xcode 26.5 against the iOS 26.5 SDK, which matches our toolchain [S8].

  LiveKit's build renames every class (`LKRTC…`), and its last three zips are about 687 MB [S9].
- **KVS viewer protocol.**
  - **Connection.** The app opens the pre-signed `wss://` URL as is. The URL is valid for 299 s from signing [S20].
  - **Frames.** It sends JSON text frames `{action, messagePayload, correlationId?}`, where `messagePayload` is base64 of `{type, sdp}` or `{candidate, sdpMid, sdpMLineIndex}`. It receives `{messageType, messagePayload?, senderClientId?, statusResponse?}` [S14][S16][S20].
  - **Roles.** The viewer sends the offer and never sets `recipientClientId` [S14][S20].
  - **Hard limits:** a 10K payload, 20 ICE candidates per second, 5 offers per second, and TURN credentials that last 5 minutes [S18].
- **Simulator settings, all set unattended and verified on this Mac** [S35][S36]. `simctl ui` sets appearance, content size (up to `accessibility-extra-extra-extra-large`) and Increase Contrast. `simctl ui` has no Reduce Motion option. Instead, `simctl spawn <udid> defaults write com.apple.Accessibility ReduceMotionEnabled -bool true` makes `UIAccessibility.isReduceMotionEnabled` true at the next launch. This corrects note 03's "simctl can't".
- **Push.** `xcrun simctl push` and `.apns` files deliver notifications, but **the Notification Service Extension never runs for them**. Apple documented this in Xcode 11.4, and I reproduced it on Xcode 26.6 with the iOS 26.5 Simulator [S6][S37]. Real APNs sandbox pushes to the Simulator do run extensions (Xcode 14+, macOS 13+, Apple silicon or T2) [S5]. They need an APNs key that the iOS track doesn't have, so the NSE's logic is tested as a pure function and end to end on the device.
- **Snapshots.** Build them without a dependency: `UIHostingController` + `traitOverrides` + `drawHierarchy`, with PNG references in the repo. Point-Free's library is MIT and active, but its manifest pulls `swift-syntax` and `swift-custom-dump` into the graph, and it would need a DECISIONS entry [S34]. `ImageRenderer` can't draw "complex controls and containers" [S23].
- **Mock home.** A Node server (built-ins only) on 127.0.0.1 [S42]:
  - It plays the LAN gateway, the relay and a KVS-shaped signalling WebSocket.
  - It advertises itself by Bonjour with `dns-sd -P … 127.0.0.1`, which I tested [S38].
  - For live view it stops at the signalling boundary, and a Debug-only fake media engine reaches the "playing" state.
  - Separately, an in-process demo transport serves the on-device demo home that the brief allows in TestFlight [S42]. Lead decision X27 currently rejects that demo home; see F6.4.
- **Performance.** Measure with XCTest metrics: launch, signposts, memory, CPU, clock, and the new `XCTHitchMetric` (iOS 26 SDK, verified) [S23][S24]. Check budgets with a script that reads `xcresulttool get test-results metrics`, not with Xcode baselines. Treat Simulator numbers as regression signals only [S29]. Apple's targets:
  - first frame within 400 ms [S27];
  - XCTest hitch ratio under 5 ms/s [S26] (the current Organizer bands are ≤10 / ≤25 / ≤50 ms/s [S25]);
  - NSE: 24 MB in total and at most 30 s [S30][S32].

## Findings

### F1. Current iOS release and what this toolchain can use

- Apple's security page lists **iOS 27.2.1** (9 Nov 2026) as the latest iOS. iOS 27 (14 Sep 2026) supports "iPhone 11 and later". iOS 26.7.3 also shipped on 9 Nov 2026 [S1].
- Xcode 27 (14 Sep 2026) and Xcode 27.2 (29 Oct 2026) require "macOS Tahoe 26.6 and later" [S1][S2]. This Mac runs macOS 26.2 (PROGRESS.md), so D-004 (stay on Xcode 26.6) stands.
- Installed Simulator runtimes: iOS 26.2, 26.4 and 26.5 [S35]. There is no iOS 27 Simulator, so iOS 27 behaviour can only be seen on the owner's iPhone through TestFlight. Reasoning: Simulator runtimes ship with Xcode, and this Xcode tops out at 26.5.

### F2. WebRTC for iOS: maintained community builds

Google stopped publishing mobile binaries at M80, and the old `GoogleWebRTC` pod is the last of them [S7]. Its final versions are 1.1.31999 (27 Aug 2020) and 1.1.32000 (7 Mar 2023) [S11]. AWS's own iOS sample still uses `pod 'GoogleWebRTC', '~> 1.1'` and `Starscream ~> 3.0` [S22], so Debbie shouldn't copy its dependencies.

| | **stasel/WebRTC** | **livekit/webrtc-xcframework** | **webrtc-sdk/Specs** | GoogleWebRTC pod |
|---|---|---|---|---|
| Latest release | `157.0.0` "M157", 2026-11-05 [S7] | `150.7871.06`, 2026-11-10 [S9] | `150.7871.04`, 2026-10-23 [S10] | 1.1.32000, 2023-03-07 [S11] |
| WebRTC milestone | M157 [S7] | M150, plus an M144 maintenance line (`144.7559.15`, 2026-09-05) [S9] | M150 [S10] | about M80 or older [S7] |
| Source changes | "No modifications are made to the source code or the output binaries" [S7] | Built from the `webrtc-sdk` fork. The framework is renamed `LiveKitWebRTC`, ObjC symbols get an `LK` prefix (`LKRTCPeerConnection`), and the NWPathMonitor field trial is always on [S9] | The `webrtc-sdk` fork that LiveKit builds from [S9][S10] | Google's, discontinued |
| Licence | Build scripts BSD-3; WebRTC BSD-3 plus the "Additional IP Rights Grant (Patents)" [S7][S12] | Repository MIT; WebRTC BSD-3 plus patents [S9][S12] | Repository MIT [S10] | BSD |
| Download (zip) | 46.4 MB; dSYMs are a separate 435 MB zip [S7] | 686.9 MB from `150.7871.04` on, 69.1 MB before that (not inspected) [S9] | 686.2 MB (not inspected) [S10] | — |
| Device binary | 12,588,688 bytes, arm64 only (verified locally) [S8] | not inspected | not inspected | — |
| Simulator slice | `ios-x86_64_arm64-simulator`: arm64 + x86_64, 29.8 MB [S7][S8] | arm64 + x64 [S9] | not checked | — |
| SPM | `https://github.com/stasel/WebRTC.git`, product `WebRTC`, binary target with a checksum [S7] | `https://github.com/livekit/webrtc-xcframework.git`, product `LiveKitWebRTC` [S9] | has a `Package.swift` [S10] | CocoaPods only |
| Minimum iOS | README "iOS 15+"; the framework's `MinimumOSVersion` is 12.0 [S7][S8] | iOS 13+ [S9] | not checked | — |
| Cadence | 8 releases, M150 (2026-07-11) to M157 (2026-11-05), following Chromium branches [S7] | 8 releases, 2026-08-21 to 2026-11-10 [S9] | 3 releases, 2026-08-31 to 2026-10-23 [S10] | none |
| Bitcode | none: no `__LLVM` segment in the device binary [S8] | not inspected | — | — |
| Privacy manifest | `PrivacyInfo.xcprivacy` in each iOS slice: SystemBootTime (35F9.1, 8FFB.1) and FileTimestamp (C617.1); `NSPrivacyTracking` false; no collected data [S8] | not inspected | — | — |
| Built with | Xcode 26.5 (17F42), `iphoneos26.5` SDK [S8] | — | — | — |
| Code signature | the xcframework isn't signed; the Simulator slice is ad hoc signed for local use [S7][S8] | — | — | — |

Other facts verified on the M157 zip [S8]:
- Its SHA-256 equals the `checksum:` in stasel's `Package.swift` (`ffb1221b…a328`) [S7].
- The bundled `LICENSE` is 1,511 bytes and covers WebRTC only. Notices for WebRTC's vendored code aren't included.
- The headers declare every API Debbie needs (verified in the M157 headers):
  - `RTCPeerConnectionFactory`;
  - `RTCConfiguration.sdpSemantics`, which defaults to Unified Plan;
  - `iceTransportPolicy` and `continualGatheringPolicy`;
  - `RTCIceServer initWithURLStrings:username:credential:`;
  - `addTransceiverOfType:init:`, `RTCRtpTransceiverDirectionRecvOnly` and `setCodecPreferences:error:`;
  - `offerForConstraints:completionHandler:`, `setLocalDescription`, `setRemoteDescription` and `addIceCandidate:completionHandler:` (the variant without a handler is deprecated);
  - `restartIce`, `statisticsWithCompletionHandler:` and `RTCMTLVideoView`;
  - `RTCAudioSession.useManualAudio` and `isAudioEnabled`.

Reasoning on the choice: Debbie needs the newest upstream security fixes (WebRTC ships its own DTLS, SRTP and TLS code [S42]), standard `RTC…` names that match AWS's samples and every tutorial, a small download on a Mac with 22 GB free, and a Simulator slice for unattended tests. stasel meets all four. LiveKit's rename and its huge zip buy nothing for a receive-only viewer.

### F3. KVS WebRTC signalling as a viewer, with a pre-signed WSS URL

**F3.1 Connection URL.**
- `ConnectAsViewer` takes the channel ARN and the client ID as query parameters: `X-Amz-ChannelARN` and `X-Amz-ClientId` [S13].
- `X-Amz-ClientId` allows 1–256 characters from `[a-zA-Z0-9_.-]`, and it "can't start with `AWS_`". A lowercase UUID fits.
- "If there is an existing connection with the same ClientId … the new connection takes precedence" [S13]. That is one more reason for a fresh viewer client ID per session [S41].
- AWS's JS signer builds `wss://<host><path>?<query>` and signs these parameters [S20]:
  - `X-Amz-Algorithm`, `X-Amz-Credential` (`<access key id>/<yyyymmdd>/<region>/kinesisvideo/aws4_request`), `X-Amz-Date`, **`X-Amz-Expires=299`** and `X-Amz-SignedHeaders=host`;
  - `X-Amz-Security-Token`, when the credentials have a session token, which "KVS Signaling Service requires" in the canonical request;
  - and finally `X-Amz-Signature`.
- Reasoning: the relay Lambda signs with its role's temporary credentials, so expect `X-Amz-Security-Token` in the URL. The URL is therefore a bearer secret for its lifetime.

Illustrative shape (placeholders in angle brackets; the relay's own parameter order and encoding are kept exactly):
```
wss://<viewer-endpoint-host>/?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-ChannelARN=arn%3Aaws%3Akinesisvideo%3A<region>%3A<account>%3Achannel%2F<name>%2F<creation-ms>
  &X-Amz-ClientId=<viewer_client_id>
  &X-Amz-Credential=<AKID>%2F20261114%2F<region>%2Fkinesisvideo%2Faws4_request
  &X-Amz-Date=20261114T151203Z&X-Amz-Expires=299
  &X-Amz-Security-Token=<session token>&X-Amz-SignedHeaders=host&X-Amz-Signature=<hex>
```
(Line breaks are for reading only.)

**F3.2 Frames.**
- Messages are JSON in WebSocket **text** frames. The JS SDK sends `JSON.stringify({action, messagePayload, recipientClientId, correlationId})` and drops undefined keys. `messagePayload` is `btoa(JSON.stringify(object))`, where the object is an `RTCSessionDescription` or an `RTCIceCandidate` [S20]. The AWS iOS sample writes the same `Codable` shape with `socket.write(string:)` [S22].
- **Who offers.** "Typically, the 'VIEWER' sends an SDP offer and its ICE candidates and then listens for ICE candidates and SDP answers from the 'MASTER'" [S20]. A viewer "is only allowed to send an offer to a master client app" [S14].
- **`recipientClientId`.** For a viewer it is "not necessary to specify … and any specified value … is ignored" [S14][S15]. The JS SDK throws if a viewer sets one [S20], so Debbie never sends it.
- **Server→client events:** `{senderClientId, messageType, messagePayload, statusResponse{correlationId, errorType, statusCode, description}}`. `messageType` is one of `SDP_OFFER, SDP_ANSWER, ICE_CANDIDATE, GO_AWAY, RECONNECT_ICE_SERVER, STATUS_RESPONSE`. `messagePayload` is base64, at most 10K [S16].
- Messages from the master may arrive with no `senderClientId` (the JS SDK substitutes `'MASTER'`), and the AWS iOS sample passes `""` for an answer [S20][S22].
- **Errors.** `correlationId` matches `[a-zA-Z0-9_.-]{1,256}`. "If the service encounters an error and if the correlationId is specified in the request, the error details are returned as a STATUS_RESPONSE message"; otherwise nothing comes back [S14][S16][S20].
- **Disconnect notices** [S17]:
  - `GO_AWAY` "is used to initiate the connection shutdown. It enables a client to gracefully process previous messages, disconnect, and reconnect … if needed."
  - `RECONNECT_ICE_SERVER` "is used to initiate the relay connection shutdown and enables a client to gracefully disconnect, obtain a new ICE server configuration, and reconnect to the relay servers if needed."
  - The JS SDK's enum handles only `SDP_ANSWER, SDP_OFFER, ICE_CANDIDATE, STATUS_RESPONSE` and silently ignores the other two [S20].
- **Defensive parsing** (from AWS's own code):
  - The iOS sample drops a candidate that has no `candidate`, or neither `sdpMid` nor `sdpMLineIndex`.
  - It retries base64 decoding with `==` appended, because "some of java base64 encode options might break ios base64 decode" [S22].
  - The browser example ignores candidates whose `candidate` string is empty [S21].
  - Browsers serialise `RTCIceCandidate` with extra fields such as `usernameFragment`. Reasoning: so decode leniently and ignore unknown keys.

**F3.3 Exact messages.**
- Every base64 value below was computed from the JSON shown (compact JSON, no escaped slashes).
- The SDP is shortened to `v=0\r\n` so the examples stay exact. A real offer is the full SDP text with `\r\n` line ends.
- Formats come from [S14][S15][S16][S20].

Viewer → KVS, the offer. Payload JSON `{"type":"offer","sdp":"v=0\r\n"}`:
```json
{"action":"SDP_OFFER","messagePayload":"eyJ0eXBlIjoib2ZmZXIiLCJzZHAiOiJ2PTBcclxuIn0=","correlationId":"offer-1"}
```
Viewer → KVS, one trickled candidate. Payload JSON `{"candidate":"candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0","sdpMid":"0","sdpMLineIndex":0}`:
```json
{"action":"ICE_CANDIDATE","messagePayload":"eyJjYW5kaWRhdGUiOiJjYW5kaWRhdGU6MSAxIHVkcCAyMTIyMjYwMjIzIDE5Mi4xNjguMS4yMCA1NDMyMSB0eXAgaG9zdCBnZW5lcmF0aW9uIDAiLCJzZHBNaWQiOiIwIiwic2RwTUxpbmVJbmRleCI6MH0="}
```
KVS → viewer, the answer. Payload `{"type":"answer","sdp":"v=0\r\n"}`; `senderClientId` may be absent:
```json
{"messageType":"SDP_ANSWER","messagePayload":"eyJ0eXBlIjoiYW5zd2VyIiwic2RwIjoidj0wXHJcbiJ9"}
```
KVS → viewer, a candidate from the master. Same payload shape as the viewer's; browsers may add `usernameFragment`:
```json
{"messageType":"ICE_CANDIDATE","messagePayload":"<base64 of {\"candidate\":\"candidate:…\",\"sdpMid\":\"0\",\"sdpMLineIndex\":0,\"usernameFragment\":\"…\"}>"}
```
KVS → viewer, an error. This only arrives because the offer carried `correlationId`:
```json
{"messageType":"STATUS_RESPONSE","statusResponse":{"correlationId":"offer-1","errorType":"InvalidArgumentException","statusCode":"400","description":"…"}}
```
KVS → viewer, disconnect notices. Treat `messagePayload` as optional for both:
```json
{"messageType":"GO_AWAY"}
{"messageType":"RECONNECT_ICE_SERVER"}
```

**F3.4 Viewer sequence (trickle ICE, receive-only video, no audio).**
- AWS's browser viewer adds `addTransceiver('video', {direction: 'recvonly'})`. It creates and sets the offer, sends it as soon as the socket is open, then sends each ICE candidate as it is generated [S21].
- The JS client buffers remote ICE candidates until the remote SDP has arrived [S20].
- The browser example also asks for audio (`offerToReceiveAudio: true`) [S21]. Debbie must not: the Layer 1 doc says "Video only: no room audio and no talk-back" [S41].
- A pending, undelivered offer for the same client "is overwritten with the new offer" [S14], so send exactly one offer per connection.

**F3.5 ICE servers.**
- `GetIceServerConfig` returns `{"IceServerList":[{"Password","Ttl","Uris":[…],"Username"}]}`. `Service` is `TURN`, the only valid value [S19].
- STUN isn't in that list. AWS's example adds `stun:stun.kinesisvideo.<region>.amazonaws.com:443` itself, and maps each TURN entry to `{urls: Uris, username: Username, credential: Password}` [S21].
- CONTRACTS.md §7 already uses that W3C shape (`urls`, `username`, `credential`), so the relay does the mapping and the app copies it 1:1 into `RTCIceServer`.

**F3.6 Limits that shape the client** [S18] (h = hard, s = soft):

| Quota | Value |
|---|---|
| `ConnectAsViewer` | 3 TPS per channel (h); 10 concurrent viewers (s); maximum connection 1 hour (h); idle timeout 10 minutes (h); `GO_AWAY` grace period 1 minute (h) |
| `SendSDPOffer` | 5 TPS per WebSocket connection (h); payload 10k (h) |
| `SendICECandidate` | **20 TPS per WebSocket connection** (h); payload 10k (h) |
| TURN | bit rate 5 Mbps (h); **credential lifecycle 5 minutes** (h); 50 allocations per channel (h); `GetIceServerConfig` 5 TPS per channel (h) |

**F3.7 iOS building blocks** (verified in local SDK) [S23]:
- `URLSessionWebSocketTask` (iOS 13): `webSocketTask(with:)`, `send(_:) async throws`, `receive() async throws`, `sendPing(pongReceiveHandler:)`, `cancel(with:reason:)` and `maximumMessageSize`. A built-in client is enough; no Starscream.
- `JSONEncoder.OutputFormatting.withoutEscapingSlashes` exists. Reasoning: SDP lines contain `/` (`UDP/TLS/RTP/SAVPF`), and without this option Swift writes `\/`, which inflates the payload toward the 10K limit.
- `RTCRtpTransceiver setCodecPreferences:error:` and `RTCPeerConnectionFactory rtpReceiverCapabilitiesForKind:` exist in M157 [S8]. They are the lever if the offer outgrows 10K: stasel's build adds VP9, H264, AV1 and H.265 SDP support [S7].

### F4. Testing from the command line

**F4.1 `xcodebuild test` flags present on Xcode 26.6** (`xcodebuild -help`) [S35]:
- `-destination` and `-destination-timeout`;
- `-resultBundlePath`, `-derivedDataPath` and `-testPlan`;
- `-only-testing:` and `-skip-testing:`;
- `-parallel-testing-enabled YES|NO`, `-parallel-testing-worker-count` and `-maximum-parallel-testing-workers`;
- `-test-timeouts-enabled`, `-default-test-execution-time-allowance` and `-maximum-test-execution-time-allowance`;
- `-test-iterations`, `-retry-tests-on-failure` and `-run-tests-until-failure`;
- `-collect-test-diagnostics on-failure|never`, `-enableCodeCoverage`, `-testLanguage` and `-testRegion`.

Environment variables named `TEST_RUNNER_<VAR>` reach the test runner as `<VAR>`, for example `TEST_RUNNER_Foo=Bar` [S35].

**F4.2 `xcresulttool` (version 24757, Xcode 16+ interface)** [S4][S35]:
- `get test-results summary | tests | test-details | activities | insights | metrics`, each with `--path`, `--compact`, `--test-id` and `--schema`;
- `export attachments --path <xcresult> --output-path <dir> [--test-id <id>] [--only-failures]`. It writes the files plus `manifest.json`, which lists for each test `exportedFileName`, `suggestedHumanReadableName`, `isAssociatedWithFailure`, `configurationName`, `deviceName`, `deviceId` and `repetitionNumber`;
- `merge` and `compare`.

`graph` and `formatDescription` are deprecated. Xcode 16 introduced the new interface "to streamline the extraction of test and other results data" [S4].

**F4.3 UI-test APIs.**
- `XCUIApplication` now lives in `XCUIAutomation.framework`, re-exported by XCTest, on this SDK. It has `launchArguments`, `launchEnvironment`, `openURL(_:)` (iOS 16.4), `resetAuthorizationStatus(for:)` and `performAccessibilityAudit(for:_:)` (iOS 17) [S23].
- `XCTAttachment(screenshot:)` exists, but the default lifetime is `.deleteOnSuccess`: "change the value of the `lifetime` property to .keepAlways" to keep screenshots from passing tests [S23].
- Swift Testing can attach images on this SDK: `Attachment.record(_:named:as:)` with `UIImage: AttachableAsImage` (iOS 14 overlay) and `.png` [S23]. Xcode 26 includes Swift Testing attachments in `.xcresult` bundles [S3].

**F4.4 Simulator settings, set unattended.** `xcrun simctl ui` supports exactly `appearance`, `increase_contrast` and `content_size` [S35]. I verified each one with a probe app on a throwaway iPhone 17e / iOS 26.5 Simulator. The probe printed the UIKit values at launch [S36].

| Setting | Command (verified) | What the app saw at next launch [S36] |
|---|---|---|
| Dark mode | `xcrun simctl ui <udid> appearance dark` | `userInterfaceStyle` = 2 (dark) |
| Largest text | `xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large` (`increment`/`decrement` also work) | `UICTContentSizeCategoryAccessibilityXXXL` |
| Increase Contrast | `xcrun simctl ui <udid> increase_contrast enabled` | `UIAccessibility.isDarkerSystemColorsEnabled == true` (stored as `DarkenSystemColors = 1`) |
| **Reduce Motion** | `xcrun simctl spawn <udid> defaults write com.apple.Accessibility ReduceMotionEnabled -bool true` (not a `simctl ui` option) | `UIAccessibility.isReduceMotionEnabled == true`; writing `false` turned it off again |
| Status bar | `xcrun simctl status_bar <udid> override --time … --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100` (flags from help) [S35] | not probed |
| Permissions | `xcrun simctl privacy <udid> grant\|revoke\|reset <service> <bundle>`. The services are `calendar`, `contacts(-limited)`, `location(-always)`, `photos(-add)`, `media-library`, `microphone`, `motion`, `reminders` and `siri`. **Camera, notifications and Local Network aren't in the list** [S35], so UI tests answer those system prompts with `addUIInterruptionMonitor(withDescription:handler:)` (verified in local SDK) [S23] | not probed |
| Recording | `xcrun simctl io <udid> recordVideo --codec=h264 --force <file>`. It prints "Recording started" to stderr and stops on SIGINT [S35] | — |

The defaults route changes the real system setting, so system components respond as well as Debbie's code. Note 03 R10's Debug-only `-DebbieReduceMotion` override is still useful inside in-process snapshot tests, but the screen gate can use the real setting.

**F4.5 Snapshot testing options.**
- **Point-Free `swift-snapshot-testing`.** MIT; release 1.19.7 on 2026-10-21; actively maintained [S34]. Its `Package.swift` (tools 6.0) also declares `swift-custom-dump` and `swift-syntax` `509.0.0..<605.0.0` for its other products [S34]. It would need a DECISIONS entry, and it adds two more packages to review.
- **Dependency-free.** Everything needed is in the SDK (verified in local SDK) [S23]:
  - `UIHostingController` in a `UIWindow`;
  - `traitOverrides` (iOS 17) with `userInterfaceStyle`, `preferredContentSizeCategory` and `accessibilityContrast`;
  - `drawHierarchy(in:afterScreenUpdates:)` inside `UIGraphicsImageRenderer`.
- **`ImageRenderer` (iOS 16) isn't enough.** Its output "does not include views whose contents are composited by Core Animation layers, such as more complex controls and containers … and most types of UIKit and AppKit views. In those cases, `ImageRenderer` displays a placeholder image" [S23].
- SwiftUI's public `accessibilityReduceMotion` and `colorSchemeContrast` are get-only. Only the underscored `_accessibilityReduceMotion` and `_colorSchemeContrast` have setters (verified in local SDK) [S23]. Reasoning: so inject Debbie's own `MotionPolicy` environment value (03 R10) in tests rather than use underscored API.

**F4.6 Screen recordings.** `simctl io recordVideo` covers the brief's screen-gate recordings [S35]. Reasoning: frame extraction and inspection belong to note 03/05's motion checks; this note only confirms the tool and its flags.

### F5. Push and the Notification Service Extension, locally

- **Simulated push.** Xcode 11.4 added it: drag an APNs JSON file onto the Simulator, or run `xcrun simctl push <device> com.example.my-app ExamplePush.apns` [S6].
  - The file needs `aps` and a top-level `"Simulator Target Bundle"` string. If that key is present, the bundle argument may be left out; if both are given, the argument wins [S6][S35].
  - The payload must be a top-level object of at most 4096 bytes [S35].
  - "Only application remote push notifications are supported. VoIP, Complication, File Provider, and other types are not supported" [S35].
- **NSE and simulated push.** The Xcode 11.4 known issue reads: "Notification Service Extensions do not work in simulated push notifications. The `mutable-content` key is not honored" [S6]. Xcode 14 says: "Remote Notifications support more features (like Notification Service Extensions) than locally simulated notifications using `.apns` payload files or the `simctl` push command" [S5]. The Xcode 15, 16, 26, 26.4, 26.5, 26.6 and 27 release notes contain no change to this [S2][S3][S4].
- **Reproduced on this toolchain** [S37]:
  - I built an app plus a Notification Service Extension that rewrites the title to "MODIFIED BY NSE" and logs `NSEPROBE`, and confirmed with `pluginkit -m` that PlugInKit had registered the extension.
  - I sent `xcrun simctl push` with `"mutable-content": 1`. The notification arrived with its original title, and there was no `NSEPROBE` log line.
  - Caveat: authorisation was provisional (status 3), because the full prompt needs a tap.
- **Real APNs to the Simulator.** "Simulator now supports remote notifications in iOS 16 when running in macOS 13 on Mac computers with Apple silicon or T2 processors". It works only against the APNs **sandbox** (`api.sandbox.push.apple.com`), and tokens are "unique to the combination of that simulator and the Mac hardware" and of variable length [S5].
  - This path runs NSEs [S5]. It needs a signed build with the push entitlement and an APNs auth key to send from.
  - The iOS track has neither tonight: `asc.env` is missing, and the team's APNs key sits with the relay (Layer 1 "SNS → APNs") [S41].
- **NSE limits.** The extension has "no more than 30 seconds" to call the content handler. It "may also modify the alert text as long as you don't remove it", and if the content has no alert text "the system ignores your modifications" [S30]. The extension runs only when the payload has `mutable-content: 1` and an alert [S31]. Memory: "The Notification Service Extension is limited to 24 MB … which includes your code, any linked libraries/frameworks, and in-process allocation". Going over is "a jetsam event … not … a crash log" (Apple WWDR engineer, Nov 2025) [S32].
- **Debugging from the command line.**
  - In the Simulator: `xcrun simctl spawn <udid> log stream --level debug --predicate 'subsystem == "<bundle id>" AND category == "nse"'`, or after the fact `xcrun simctl spawn <udid> log show --last 5m --predicate …`. I used `log show` this way in [S37].
  - On a device, macOS has `/usr/bin/log collect --device-udid <UDID> --last 10m --output <x>.logarchive`, then `log show <archive> --predicate …` [S35]. In zsh, `log` is a shell builtin, so call `/usr/bin/log` (seen locally).

### F6. The mock home's form

**F6.1 Options against the brief's criteria.**

| Criterion | (a) In-process mock behind the transport protocol | (b) `URLProtocol` interceptor in-process | (c) Local server on the Mac (Node; or Swift `NWListener`) | (d) (c) for the Simulator + (a) for the on-device demo and fast tests |
|---|---|---|---|---|
| Runs the real code paths | No: skips URLSession, ATS, JSON on the wire, timeouts, Bonjour | Partly: the real HTTP client and encoding run, but no sockets, ATS, Bonjour or WebSocket. Reasoning: `URLProtocol` models request/response loading, and I found no Apple statement that it serves `URLSessionWebSocketTask`, so treat that as unsupported | **Yes**: real URLSession over loopback, ATS rules [S33], WebSocket signalling, Bonjour (F6.3), and a second, independent crypto implementation in Node [S42] | Yes, where it matters |
| Unattended UI tests | Yes | Yes | Yes. The lane starts the server, passes its URL through `launchEnvironment`, and stops it afterwards. The Simulator uses the Mac's network connection [S29] | Yes |
| TestFlight build on a device | Yes, as the brief's on-device demo home [S42] | Would put a mock in Release: forbidden [S42] | **No.** The brief says "listening on 127.0.0.1 only" [S42], and Release requires HTTPS for the relay, which the mock relay doesn't speak [S42] | Yes, via (a) |
| Keeps mocks out of Release | Needs `#if` or a build setting (the demo home is the brief's one exception) [S42] | Same | Nothing to exclude except the Debug-only base-URL override | Yes |
| Effort tonight | Low | Medium | Medium–high, but the brief requires it, and its crypto doubles as the Node vector check [S42] | Sum of (a) and (c) |
| Value to the bridge team | None | None | **High**: a runnable Node reference of the PROPOSED contract in their own runtime, built on Node's built-in `crypto` (X25519, ChaCha20-Poly1305 and HKDF present on Node 25.6.0) [S35] | High |

Swift `NWListener` (c, Swift variant) would lose the independent second implementation that the brief asks for [S42], so Node it is.

**F6.2 Live view at the signalling boundary.**
- Node 25.6.0 has a global `WebSocket` *client* [S35]. Reasoning: Node's standard library has no WebSocket server API, but a minimal RFC 6455 server fits in about 120 lines on `node:http`'s `upgrade` event with `node:crypto`:
  - `Sec-WebSocket-Accept` = base64(SHA-1(key + `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`));
  - unmask client frames;
  - send text frames, ping and pong.
- That lets the mock speak the exact KVS frames in F3.3, route them viewer ↔ "master" the way KVS does, and send `GO_AWAY`, `STATUS_RESPONSE` and `RECONNECT_ICE_SERVER` on demand.
- Node has no built-in WebRTC peer, so "playing" needs one of two things. Reasoning:
  - a Debug-only fake media engine in the app, behind a `LiveViewMediaEngine` protocol, that turns the mock's canned answer into a "playing" test pattern; or, later,
  - a Debug-only loopback sender (a second `RTCPeerConnection` with a synthetic `RTCVideoSource`) talking through the mock's socket.

  The brief allows stopping at the signalling boundary as long as every state is reachable and tested [S42].

**F6.3 Bonjour from a server bound to 127.0.0.1.** macOS ships `/usr/bin/dns-sd`, and its `-P` mode registers a *proxy* service with an explicit host and IP. I tested `dns-sd -P "Research Probe" _debbieprobe._tcp local 7489 research-probe.local 127.0.0.1 hub=TESTONLY` [S38]:
- `dns-sd -L` resolved it to `research-probe.local.:7489` with the TXT record `hub=TESTONLY`.
- `dns-sd -G v4` resolved the host to `127.0.0.1` on interface 1 (loopback) *and* interface 14.

So the mock can advertise `_debbie._tcp` [S41] while still listening only on 127.0.0.1. "Moving" the gateway means re-registering with a new port. One side effect: the record is also announced on the LAN interface (F-risks).

**F6.4 Conflict with lead decision X27.**
- X27 rejects the on-device demo home ("No demo/mock in any Release build"). It suggests that a TestFlight build "can pair with [the Node mock] over the LAN like a real bridge".
- The brief says otherwise:
  - §3: "MUST keep mocks … out of Release builds. **The one exception is the on-device demo home described in section 6**".
  - §6: "TestFlight builds SHOULD include a demo home … It can be removed with one build setting", while the mock listens "on 127.0.0.1 only" [S42].
- Pairing a TestFlight build with the mock would need the mock bound to the Mac's LAN address, which breaks §6. It would also reach only the LAN-gateway route, because Release forbids plain HTTP to the relay [S42].
- Recommendation: keep the brief's split (R15). If the lead still prefers X27, record the §6 deviation in DECISIONS.md and add a separate `--lan` mode to the mock that binds only the gateway side to the Mac's Wi-Fi address.

### F7. Performance budgets measured unattended

**F7.1 What XCTest measures here** (verified in local SDK) [S23]:
- `XCTClockMetric` and `XCTCPUMetric` (`init(limitingToCurrentThread:)`, plus `init(application:)` for UI tests).
- `XCTMemoryMetric` and `XCTStorageMetric`, each also with `init(application:)`.
- `XCTApplicationLaunchMetric(waitUntilResponsive:)` (iOS 14), which measures "the amount of time it takes for an application to display its first frame … and for its main thread to be ready to accept user input".
- `XCTOSSignpostMetric(subsystem:category:name:)`, plus `navigationTransitionMetric` and `customNavigationTransitionMetric` (iOS 14) and `scrollingAndDecelerationMetric` (iOS 15).
  - `scrollDecelerationMetric` and `scrollDraggingMetric` are deprecated, and `applicationLaunchMetric` is deprecated in favour of `XCTApplicationLaunchMetric`.
  - For an *animation* signpost interval, `XCTOSSignpostMetric` also reports frame rate, frame count, number of hitches, total hitch time, and hitch time ratio in ms/s.
- **`XCTHitchMetric`**, new: iOS 26.0, unavailable on visionOS, with `init(application:)` only [S23][S24].
- `XCTMeasureOptions.iterationCount` defaults to 5, and "the block is actually invoked `iterationCount` + 1 times, and the first iteration is discarded". `invocationOptions` has `.manuallyStart` and `.manuallyStop` [S23].

**F7.2 Apple's targets.**
- **Launch:** "we need to hit the goal of rendering our first frame within 400 milliseconds". About 100 ms of that is system work, which leaves about 300 ms for the app (WWDC19 423) [S27]. Each embedded third-party framework adds to launch time [S28]; WebRTC is one, a 12.6 MB binary [S8].
- **Hitches.** In XCTest, a hitch time ratio "of less than five milliseconds per second is good". Between 5 and 10 ms/s, users "will start to notice". At 10 ms/s or more, "take immediate action" (WWDC20 10077) [S26]. Apple's current article on the Organizer's Hitches metric uses wider field bands: "at or below 10 ms/s is good; at or below 25 ms/s is a warning; at or below 50 ms/s is critical" [S25]. In Xcode 27 that metric "replaces the Scrolling metric … displaying animation hitches for all animations" [S2].
- **Discrete interactions:** "only a delay on the order of 100 ms or more on the main thread becomes noticeable" [S25].
- **How to run performance tests:** select "the release build configuration and disable the debugger", and turn off the diagnostic options (Runtime Sanitization, API Checking, Memory Management) [S26].

**F7.3 The Simulator isn't a performance device.** "The simulator is not an accurate test of an app's performance, memory usage, and networking speed … always test the performance of your app's user interface on a device" (Apple's archived Simulator guide, 2018) [S29]. A 2024 secondary source reports that for animation signpost metrics the Simulator returns only Duration, while devices also return frame count, frame rate and hitch figures [S39]. So unattended Simulator budgets are *regression gates*, and the absolute targets in F7.2 are *device* checks.

**F7.4 Baselines vs budgets from the CLI.**
- `xcresulttool get test-results metrics --path <x> --compact` returns, per test run, `device`, `testPlanConfiguration` and `metrics[]` entries with `displayName`, `unitOfMeasurement`, `measurements[]` and `identifier`.
- When Xcode baselines exist, it also returns `baselineAverage`, `maxPercentRegression`, `maxStandardDeviation` and `polarity` [S35].
- Baselines are normally set from a test report ("set this average value … as our baseline") [S26]. Reasoning: they are stored per device inside the project and set from the GUI. A budgets file in the repo, checked by a script against `measurements`, is explicit, reviewable and works unattended.

**F7.5 Recording traces unattended.**
- `xcrun xctrace record --template <name> --device <name|UDID> [--launch -- <app>|--attach <pid|name>|--all-processes] --time-limit <t> --output <path> --no-prompt` (xctrace 16.0, 17F113) [S35].
- Templates include "App Launch", "Animation Hitches", "SwiftUI", "Time Profiler", "Allocations", "Leaks", "Swift Concurrency" and "Network" [S35].
- Xcode 26 redesigned the Animation Hitches instrument "to address correctness and performance issues" [S3].
- fastlane 2.240.1's `run_tests` accepts `configuration`, `destination`, `result_bundle`, `result_bundle_path`, `parallel_testing`, `xcargs`, `only_testing` and `number_of_retries` [S40].

## What changed in the current iOS release

- **iOS 27 shipped** (27.0 on 14 Sep 2026; now 27.2.1), and **Xcode 27 needs macOS 26.6 or later** [S1][S2]. This Mac (26.2) can't run it, so nothing below depends on the iOS 27 SDK. The owner's demo iPhone is likely on iOS 27.x, so live view, push and the NSE must be checked there through TestFlight.
- **Needs the newer SDK (LATER):**
  - `XCUIVoiceOverService`, "a new UI testing API for verifying VoiceOver behavior", ships with Xcode 27 [S2];
  - `simctl reboot` is new in Xcode 27 and isn't in this `simctl` [S2][S35];
  - Xcode 27 Instruments requires iOS 17 or later on target devices [S2]. That doesn't affect Debbie.
- **Hitch guidance moved.** Xcode 27 Organizer's Hitches metric now covers all animations [S2]. Apple's hitch article gives field bands of ≤10 / ≤25 / ≤50 ms/s [S25], looser than WWDC20's XCTest bands of <5 / 5–10 / ≥10 ms/s [S26]. Debbie keeps the stricter test band (R17).
- **Available on our SDK and new in the iOS 26 cycle:**
  - `XCTHitchMetric` [S23][S24];
  - Swift Testing attachments in `.xcresult` [S3] and image attachments [S23];
  - `XCUIApplication` moved into `XCUIAutomation.framework` (re-exported by XCTest) [S23];
  - the redesigned Animation Hitches instrument [S3].
- **No change found:** simulated push still doesn't run NSEs (release notes [S2][S3][S4]; tested [S37]). The KVS signalling message set is the six types in the AWS guide [S16]; the JS SDK's latest release is v2.9.0 (20 Aug 2026), and its `SignalingClient.ts` last changed on 11 Jun 2026 [S20]. WebRTC M157 is built against the iOS 26.5 SDK [S8]. Reasoning: apps built with an older SDK run on newer iOS (D-004).

## Recommendations for Debbie

**R1. WebRTC package.**
- Add `https://github.com/stasel/WebRTC.git` pinned **`exact: "157.0.0"`**, product `WebRTC`, to `DebbieLiveView` only (11a's module table).
- Check: `Package.resolved` shows `157.0.0`. The zip's SHA-256 is `ffb1221be2138ecc6bc92300ae4f0157e18694d652db9921e4251992ea91a328` (the Package.swift checksum; SwiftPM verifies it).
- [S7][S8] — **ADOPT-TONIGHT**: newest milestone, unmodified upstream, Simulator slice and privacy manifest present, built with our SDK version.

**R2. DECISIONS.md entry (ready to paste).**
- *Purpose:* receive-only H.264/VP8 video for live view over KVS WebRTC. The Layer 1 doc requires a maintained community build of Google's WebRTC [S41].
- *Alternatives:*
  - LiveKit `webrtc-xcframework` 150.7871.06: renamed `LK` symbols, 687 MB zip;
  - `webrtc-sdk/Specs` 150.7871.04: a fork, 686 MB zip;
  - building M157 ourselves. Reasoning: a Chromium-scale `gclient` checkout and a multi-hour `gn`/`ninja` build, on a Mac with 22 GB free;
  - the `GoogleWebRTC` pod: discontinued, last real release 2020 [S7][S9][S10][S11].
- *Maintenance:* 8 releases in Jul–Nov 2026, tracking Chromium milestones; built by open GitHub Actions; dSYMs published [S7].
- *Licence:* scripts BSD-3; WebRTC BSD-3 plus the Additional IP Rights Grant (Patents) [S7][S12]. The bundled LICENSE covers WebRTC only [S8], so the third-party notices list is LATER (see risks).
- *Warnings:* any linker warnings from the prebuilt binary are recorded word for word (brief §3).
- **ADOPT-TONIGHT**: the brief makes this entry a precondition for the dependency.

**R3. Keep WebRTC away from the NSE.**
- The NSE links no `WebRTC.framework` and no SwiftUI or design-system code.
- Lane check: `otool -L <NSE binary>` lists only `/System/` and `/usr/lib/` paths, and the NSE executable is ≤ 2 MB.
- [S32] plus Reasoning: 24 MB *includes linked code*; WebRTC alone is a 12.6 MB binary [S8]. — **ADOPT-TONIGHT**: a cheap static check that prevents jetsam kills.

**R4. Signalling codec (`DebbieLiveView`).**
- `URLSessionWebSocketTask` with text frames only. `Codable` structs with optional fields omitted when nil. `JSONEncoder` uses `.withoutEscapingSlashes`.
- Outgoing actions are only `SDP_OFFER` and `ICE_CANDIDATE`. **Never** a `recipientClientId`.
- `correlationId` is set on the offer only (`"offer-1"`), to get a `STATUS_RESPONSE` on error.
- Decoding is lenient: re-pad base64 to a multiple of 4; ignore unknown keys (`usernameFragment`); drop candidates with an empty `candidate` or with neither `sdpMid` nor `sdpMLineIndex`; treat `messagePayload` and `senderClientId` as optional.
- Unit tests decode and encode every example in F3.3 byte for byte.
- [S14][S15][S16][S20][S21][S22][S23] — **ADOPT-TONIGHT**: this is the riskiest interop surface, and fixtures make it testable without AWS.

**R5. Peer connection setup.**
- Before creating the factory: `RTCAudioSession.sharedInstance().useManualAudio = true` and `isAudioEnabled = false`.
- One `addTransceiver(of: .video, init:)` with direction `.recvOnly`, and **no audio transceiver**.
- `RTCIceServer(urlStrings:username:credential:)` built 1:1 from the relay's `ice_servers`.
- Remote candidates are queued until `setRemoteDescription` succeeds.
- Outgoing candidates are rate-limited to **≤ 15 per second** (token bucket, burst 15; KVS's hard limit is 20 [S18]), unit-tested with a fake clock.
- A unit test asserts the base64 offer payload is **≤ 10,000 characters** [S14][S18]. If it fails, restrict codecs with `setCodecPreferences(_:error:)` to H.264 + VP8.
- [S8][S18][S21][S41] plus Reasoning: no audio session means live view never interrupts the caregiver's own audio. — **ADOPT-TONIGHT**: these are the limits most likely to break the demo.

**R6. Timing and server notices.**
- **Timing:**
  - Open the signalling URL as soon as it is fetched, with no retry after 299 s from `X-Amz-Date` [S20].
  - Connecting budget: **30 s** from `ready` to the first decoded frame, then `failed("couldn't connect")`. Reasoning: the Layer 1 doc's 30 s reconnection target [S41].
  - "Playing" starts on the first rendered frame, not on ICE `connected`.
- **Server notices:**
  - `STATUS_RESPONSE` → `failed`, with `statusCode` logged.
  - `GO_AWAY` → finish processing, close the socket, and keep the session if media is already flowing (signalling is only needed for setup); otherwise `failed`.
  - `RECONNECT_ICE_SERVER` → end with "connection lost" and offer **Keep watching**. The phone holds no AWS credentials, so it can't fetch new ICE servers itself [S17][S41].
- **Stop:** call the relay's `DELETE` first, then `peerConnection.close()`, then `cancel(with: .normalClosure, reason: nil)` [S41].
- **ADOPT-TONIGHT**: every one of these maps to a live-view state the brief requires.

**R7. Treat the signalling URL as a secret.**
- Log only `wss://<host>/?<redacted>`. Never log query items, SDP or candidates; candidates contain local IPs.
- A unit test asserts that `URL(string: s)!.absoluteString == s` for a fixture URL, so the app never re-encodes it.
- Reasoning: the URL carries an STS session token (F3.1) [S20]; CLAUDE.md requires logs without secrets. — **ADOPT-TONIGHT**: free to do now.

**R8. Gate simulators and settings script.**
- `tools/sim/gate.sh` creates its own devices with `simctl create` and never touches others: "Debbie SE" (iPhone SE 3rd generation) and "Debbie Max" (iPhone 17 Pro Max), on runtime `com.apple.CoreSimulator.SimRuntime.iOS-26-5` (X18).
- Per configuration it applies:
  - `simctl ui <udid> appearance light|dark`;
  - `simctl ui <udid> content_size large|accessibility-extra-extra-extra-large`;
  - `simctl ui <udid> increase_contrast enabled|disabled`;
  - `simctl spawn <udid> defaults write com.apple.Accessibility ReduceMotionEnabled -bool true|false`;
  - one fixed `status_bar override`.
- Then it relaunches the app.
- Check: the script reads each value back (`simctl ui <udid> appearance` and so on, and `defaults read com.apple.Accessibility ReduceMotionEnabled`) and fails on a mismatch.
- [S35][S36] — **ADOPT-TONIGHT**: the screen gate's light/dark, AX-size and Reduce Motion screenshots need this.

**R9. Test lane commands.**
- `xcodebuild test -scheme Debbie -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath build/DerivedData -resultBundlePath build/results/<lane>-<yyyyMMdd-HHmmss>.xcresult -test-timeouts-enabled YES -maximum-test-execution-time-allowance 300`.
- Add `-parallel-testing-enabled NO` for gate and perf runs. Reasoning: per-device settings from R8 must apply to the one device that runs.
- Afterwards:
  - `xcrun xcresulttool get test-results summary --path <x> --compact` (fail on any failed test);
  - `export attachments --path <x> --output-path Design/reviews/<run>/`.
- No `-retry-tests-on-failure` in gating lanes. Reasoning: retries hide flakiness.
- [S35] — **ADOPT-TONIGHT**: the brief requires unattended lanes.

**R10. Screen-gate screenshots and audits in UI tests.**
- Each gated screen calls `XCUIScreen.main.screenshot()` → `XCTAttachment(screenshot:)` with `lifetime = .keepAlways` and `name = "<screenID>-<device>-<appearance>-<size>-<contrast>-<motion>"`, for example `S09-max-dark-ax5-ic-rm`.
- It then runs `try app.performAccessibilityAudit()`.
- The exported `manifest.json`, which records `suggestedHumanReadableName` and `deviceName`, is the review index.
- [S23][S35] — **ADOPT-TONIGHT**: this produces the evidence the screen gate asks for.

**R11. Snapshot tests without a dependency.**
- A ~150-line `SnapshotAssert` in the test support code:
  - host the view in a `UIHostingController` inside a `UIWindow`;
  - set `traitOverrides.userInterfaceStyle`, `.preferredContentSizeCategory` and `.accessibilityContrast`;
  - inject `MotionPolicy` (03 R10) for Reduce Motion;
  - render with `UIGraphicsImageRenderer` + `drawHierarchy(in:afterScreenUpdates: true)`.
- Compare against `Tests/Snapshots/__Reference__/<test>.<config>.png`. Pass if **≤ 0.1 % of pixels differ by more than 4/255 in any channel**.
- Record with `TEST_RUNNER_DEBBIE_RECORD_SNAPSHOTS=1`.
- References are made on "Debbie Max", iOS 26.5. The test fails, with a message, on any other device or OS.
- On failure, attach reference, actual and diff (`XCTAttachment` or `Attachment.record`).
- Never snapshot `RTCMTLVideoView`; the fake media engine supplies a static frame.
- [S23][S34][S35] plus Reasoning: the tolerance absorbs anti-aliasing drift but catches a 1 pt shift (thousands of edge pixels). — **ADOPT-TONIGHT**: Phase 5 needs light, dark and large-type snapshots, and this adds no dependency.

**R12. Push fixtures, `simctl push`, and NSE logic tests.**
- Put `.apns` fixtures in `Tests/Fixtures/push/`: `alert-encrypted.apns`, `alert-update.apns`, `alert-truncated.apns`, `hub-offline.apns` and `back-online.apns`.
- Each has `"Simulator Target Bundle"` and is **≤ 4096 bytes**, checked by a unit test.
- Use them two ways:
  - **(a)** `xcrun simctl push <udid> <bundle> <file>` to test the app's foreground and tap handling;
  - **(b)** as input to a pure `NotificationRenderer.render(payload:keys:now:timeZone:) -> RenderedNotification` in the NSE's shared module. Unit tests cover decrypt success, decrypt failure (the safe generic text), a hub-offline time in the phone's time zone, and a truncated message.
- The NSE logs through `Logger(subsystem: <bundle id>, category: "nse")` and never logs plaintext. Debug it with `xcrun simctl spawn <udid> log stream --level debug --predicate 'subsystem == "<bundle id>" AND category == "nse"'` once real pushes reach it.
- [S5][S6][S30][S35][S37] — **ADOPT-TONIGHT**: simulated push can't exercise the NSE, so its logic must be testable on its own.

**R13. End-to-end NSE check.**
- On the owner's iPhone, using the TestFlight build and the relay team's push test (Layer 1 build step 0b), or on the Simulator via the APNs sandbox once a signed development build and an APNs key exist.
- Steps for the owner go in MORNING_REPORT.md.
- [S5][S41] — **LATER**: blocked tonight by missing `asc.env` and an APNs key the iOS track doesn't hold.

**R14. The mock home (Node, built-ins only, `tools/mock-home/`).**
- **Listening:** `node:http` on 127.0.0.1 only:
  - LAN gateway on **7480** (Layer 1 port);
  - relay (plain HTTP; the app accepts it in Debug only) and its control API on **7481**;
  - a KVS-shaped WebSocket at `ws://127.0.0.1:7481/kvs` (F6.2).
- **Bonjour:** `dns-sd -P "Debbie Mock Home" _debbie._tcp local 7480 debbie-mock.local 127.0.0.1 hub=<first 8 base64url chars of a random mock hub key>`. "Gateway moved" re-registers on 7483; "unreachable" closes the listener, and a "black hole" mode accepts connections but never answers.
- **Controls** (`POST /_mock/…`): trigger an alert, an update, late delivery (`detected_at` minus N minutes), heartbeat stale, monitoring degraded, hub offline / back online, removed phone, gateway unreachable / moved, live view `deny | ready | answer | go_away | status_error | reconnect_ice | end(expired|stopped|resident_turned_off)`, and `confirm pairing code`. `GET /_mock/qr` returns the pairing QR JSON.
- **Lane lifecycle:** start the mock with a pid file before `xcodebuild` and stop it in an `ensure` block. The app reads `DEBBIE_MOCK_HOME_URL` and `DEBBIE_DEBUG_QR` from `launchEnvironment` only in Debug.
- [S29][S33][S35][S38][S41][S42] — **ADOPT-TONIGHT**: the brief requires it, and it settles X29.

**R15. Keep the brief's split for TestFlight.**
- The on-device demo home is an in-process `DemoHomeTransport` behind the same transport protocol. It is chosen explicitly in onboarding and labelled as a demo, and one build setting removes it (11a R6's `DEBBIE_DEMO_HOME`).
- Fast unit tests use the same in-process transport.
- No `URLProtocol` mock goes in the app target.
- Raise the X27 conflict (F6.4) with the lead before Phase 4.
- [S42] plus Reasoning (F6.1). — **ADOPT-TONIGHT**: the brief allows exactly this exception, and the alternative breaks §6.

**R16. Every live-view state reachable and tested.**
- A `LiveViewMediaEngine` protocol with `WebRTCMediaEngine` (real) and a Debug-only `FakeMediaEngine`. The fake emits a canned offer, accepts the mock's answer and renders a mint test pattern, which yields "playing".
- One UI test per state, driven by mock controls: requesting, denied, ready, connecting, playing, ended by time limit, ended by you, ended by the resident, failed. Each asserts the on-screen reason text.
- One Simulator integration test runs the **real** `WebRTCMediaEngine` against the mock socket. It asserts the mock's validation: exactly one `m=video`, `a=recvonly`, no `m=audio`, no `recipientClientId`, payload ≤ 10,000 characters. It also asserts that "answer but no media" ends in `failed` after the 30 s budget.
- [S14][S18][S41][S42] — **ADOPT-TONIGHT**: the brief requires every state to be "reachable and tested".

**R17. Performance budgets and the lane that checks them.**
- **Setup:** a `DebbiePerfTests` UI-test target and a scheme run with `-parallel-testing-enabled NO`, no debugger and no diagnostics [S26].
- **Configuration:**
  - Launch runs in **Release** (`run_tests(configuration: "Release")`): an unpaired launch needs no mock.
  - Data-driven tests run in Debug with `SWIFT_OPTIMIZATION_LEVEL=-O SWIFT_COMPILATION_MODE=wholemodule` passed on the command line, against the mock. Reasoning: Release contains no mock, and 11a fixes two configurations.
- **Measurement:** `XCTMeasureOptions.iterationCount = 5` [S23].
- **Checking:** budgets live in `Tests/Perf/budgets.json`. `tools/perf/check-budgets.mjs` (Node built-ins) runs `xcrun xcresulttool get test-results metrics --path <x> --compact`, takes the **median** of `measurements` for each `identifier`, and exits 1 on any breach. The fastlane `test` lane runs it after `run_tests(result_bundle: true, result_bundle_path: …)` [S35][S40].

| Budget | Measured with | Where | Threshold | Gate |
|---|---|---|---|---|
| Cold launch, unpaired, to responsive | `XCTApplicationLaunchMetric(waitUntilResponsive: true)` | "Debbie Max" Simulator, Release | median ≤ **1,000 ms**. Reasoning: a Simulator regression gate that catches synchronous work before the first frame [S29] | fail lane, tonight |
| Cold launch to first frame | Instruments "App Launch" or the same metric | owner's iPhone | ≤ **400 ms** [S27] | LATER |
| Tap to visible response (acknowledge, open alert, start live view) | `XCTOSSignpostMetric(subsystem: <bundle id>, category: "interaction", name: …)` around the handler | Simulator, Debug -O | median ≤ **100 ms** [S25] | fail lane, tonight |
| Navigation and custom transitions | `XCTOSSignpostMetric.navigationTransitionMetric` / `.customNavigationTransitionMetric` + `XCTHitchMetric(application:)` | Simulator: record only. Device: gate | hitch ratio ≤ **5 ms/s** [S26] (Organizer field ≤ 10 ms/s [S25]) | record tonight; device LATER |
| Alert-list scrolling | `.scrollingAndDecelerationMetric` + `XCTHitchMetric` | same | ≤ **5 ms/s** [S26] | record tonight; device LATER |
| NSE render | `XCTClockMetric` + `XCTMemoryMetric` on `NotificationRenderer.render` (unit test) | Simulator | median ≤ **50 ms**; peak-memory growth ≤ **2,048 kB** [S30][S32] | fail lane, tonight |
| NSE linkage and size | `otool -L`; `stat -f%z` | build lane | system libraries only; ≤ **2 MB** [S32] | fail lane, tonight |
| App size | `du -sk` of `Debbie.app` in the Release archive | build lane | ≤ **60 MB** uncompressed. Reasoning: WebRTC is 12.6 MB [S8]; families on limited data plans | fail lane, tonight |
| Memory during a 5-minute live view | `XCTMemoryMetric(application:)` / Instruments "Allocations" | owner's iPhone | peak ≤ **150 MB**. Reasoning: older supported iPhones have less RAM; Simulator memory isn't representative [S29] | LATER |
| Live-view ready to first frame | signpost `liveview.firstFrame` | owner's iPhone, Wi-Fi and cellular | ≤ **10 s**, and always inside R6's 30 s budget. Reasoning: TURN plus DTLS setup; measure in rehearsal | LATER |

**ADOPT-TONIGHT** for the Simulator gates (unattended, cheap); **LATER** for device targets (no device attached).

**R18. Trace capture for investigation.**
- `xcrun xctrace record --template 'App Launch' --device <udid> --time-limit 15s --no-prompt --output build/traces/launch-<stamp>.trace --launch -- <path to Debbie.app>`.
- Use "Animation Hitches" or "SwiftUI" on the owner's device when a budget fails.
- [S3][S35] — **LATER**: diagnosis, not gating.

**R19. Hitch numbers on the Simulator.**
- On the first perf run, read `xcresulttool … metrics`. If `XCTHitchMetric` or the signpost metrics return only Duration in the Simulator, keep them record-only and say so in CRAFT.md.
- [S39] (secondary) — **ADOPT-TONIGHT**: settles an open question with one command.

**R20. VoiceOver automation.**
- Adopt `XCUIVoiceOverService` when the toolchain moves to Xcode 27 (needs macOS 26.6+). Until then, use `performAccessibilityAudit` (R10) plus manual VoiceOver checks.
- [S2][S23] — **LATER**: needs the iOS 27 SDK.

## Open questions / risks

1. **Simulator perf fidelity.** It's unknown whether `XCTHitchMetric` reports hitch values in the Simulator. A 2024 secondary source says animation metrics give only Duration there [S39]. R19 resolves it on the first run.
2. **Snapshot fidelity for glass and materials.** `drawHierarchy` output for Liquid Glass and blur surfaces is unverified. If it is wrong, snapshot those screens with `XCUIScreen` screenshots in UI tests instead (Reasoning).
3. **Bonjour in the Simulator.** It's unverified whether the Simulator's `NWBrowser` sees services registered on the Mac with `dns-sd -P`, and whether the Local Network prompt appears in the Simulator at all. Verify in Phase 6. `simctl privacy` has no Local Network service [S35].
4. **The mock is visible on the venue Wi-Fi.** `dns-sd -P` also announces the 127.0.0.1 record on the LAN interface [S38]. Real Debbie phones ignore it only because the `hub` TXT prefix won't match their stored hub key (CONTRACTS §4), so always use a random mock hub key and the name "Debbie Mock Home".
5. **Offer size.** With stasel's extra codecs (VP9, AV1, H.265 SDP) [S7], the base64 offer might approach the 10K cap [S14]. R5's test catches it, and `setCodecPreferences` is the fix [S8].
6. **Interoperability with the real sender** (the Chrome KVS JS master) is proven only in the team's build step 0b, especially TURN over cellular [S41]. Our fixtures follow AWS's code [S20][S21], not a live capture.
7. **`GO_AWAY` and `RECONNECT_ICE_SERVER` payloads aren't documented** [S16][S17]. The parser must not require a payload.
8. **The xcframework is unsigned** [S8]. Integrity rests on the SwiftPM checksum [S7]. Reasoning: acceptable for an exact-pinned binary from a public release.
9. **Third-party notices.** WebRTC vendors other open-source code, but the bundled LICENSE covers WebRTC only [S8]. Shipping an acknowledgements file is LATER. Reasoning: BSD-3 requires notices "in the documentation and/or other materials" of binary redistributions [S7].
10. **LiveKit and webrtc-sdk zips jumped from about 69 MB to about 687 MB** in their latest releases [S9][S10]. The cause wasn't investigated, and it doesn't matter for R1.
11. **NSE authorisation in the probe was provisional** [S37]. A fully authorised app might behave differently, but Apple's notes say simulated pushes don't run NSEs [S5][S6].
12. **X27 vs the brief** (F6.4) needs a lead decision before Phase 4.
13. **Note 03's claim** that Reduce Motion can't be set from the command line is superseded by [S36]. The lead should reconcile 03 R10 with R8 here.

## Sources

Primary means the vendor's or project's own documentation, source code or tool output for the thing described, plus Apple's documentation and first-hand local tests. Secondary means third-party commentary.

- [S1] Apple security releases (lists latest iOS 27.2.1, iOS 27 / Xcode 27 dates and macOS requirements) — Apple Support — https://support.apple.com/en-us/100100 — updated 13 Nov 2026 (latest entry) — accessed 2026-11-14 — primary
- [S2] Xcode 27 Release Notes (and Xcode 27.2 Release Notes) — Apple — https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes — undated (Xcode 27 released 14 Sep 2026 per S1) — accessed 2026-11-14 — primary
- [S3] Xcode 26 Release Notes (also 26.4, 26.5, 26.6 notes checked) — Apple — https://developer.apple.com/documentation/xcode-release-notes/xcode-26-release-notes — undated — accessed 2026-11-14 — primary
- [S4] Xcode 16 Release Notes, "xcresulttool" (Xcode 15 Release Notes also checked for push changes: https://developer.apple.com/documentation/xcode-release-notes/xcode-15-release-notes) — Apple — https://developer.apple.com/documentation/xcode-release-notes/xcode-16-release-notes — undated — accessed 2026-11-14 — primary
- [S5] Xcode 14 Release Notes, Simulator "New Features" (remote notifications, 60974170) — Apple — https://developer.apple.com/documentation/xcode-release-notes/xcode-14-release-notes — undated (2022) — accessed 2026-11-14 — primary
- [S6] Xcode 11.4 Release Notes, Simulator (8164566; known issue 55822721) — Apple — https://developer.apple.com/documentation/xcode-release-notes/xcode-11_4-release-notes — undated (2020) — accessed 2026-11-14 — primary
- [S7] stasel/WebRTC: README, LICENSE.md, Package.swift, scripts/build.sh, Releases (157.0.0 "M157") — GitHub — https://github.com/stasel/WebRTC — release published 2026-11-05 — accessed 2026-11-14 — primary (project's own repository)
- [S8] Local inspection of `WebRTC-M157.xcframework.zip` (SHA-256, Info.plist slices, `lipo`, sizes, `otool -l` for `__LLVM`, `codesign -dv`, `PrivacyInfo.xcprivacy`, LICENSE, headers) — this Mac — 2026-11-14 — accessed 2026-11-14 — primary (first-hand)
- [S9] livekit/webrtc-xcframework: README, Package.swift, Releases (150.7871.06) — GitHub — https://github.com/livekit/webrtc-xcframework — release published 2026-11-10 — accessed 2026-11-14 — primary
- [S10] webrtc-sdk/Specs: repository and Releases (150.7871.04) — GitHub — https://github.com/webrtc-sdk/Specs — release published 2026-10-23 — accessed 2026-11-14 — primary
- [S11] GoogleWebRTC pod versions — CocoaPods Trunk API — https://trunk.cocoapods.org/api/v1/pods/GoogleWebRTC — 1.1.31999 (2020-08-27), 1.1.32000 (2023-03-07) — accessed 2026-11-14 — primary
- [S12] WebRTC Software License and Additional IP Rights Grant (Patents) — webrtc.org — https://webrtc.org/support/license — undated — accessed 2026-11-14 — primary
- [S13] ConnectAsViewer — Amazon KVS WebRTC Developer Guide — https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/ConnectAsViewer.html — undated — accessed 2026-11-14 — primary
- [S14] SendSdpOffer — Amazon KVS WebRTC Developer Guide — https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/SendSdpOffer.html — undated — accessed 2026-11-14 — primary
- [S15] SendIceCandidate — Amazon KVS WebRTC Developer Guide — https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/SendIceCandidate.html — undated — accessed 2026-11-14 — primary
- [S16] Asynchronous message reception — Amazon KVS WebRTC Developer Guide — https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/async-message-reception-api.html — undated — accessed 2026-11-14 — primary
- [S17] Disconnect (GO_AWAY, RECONNECT_ICE_SERVER) — Amazon KVS WebRTC Developer Guide — https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/kvswebrtc-websocket-apis6.html — undated — accessed 2026-11-14 — primary
- [S18] Amazon Kinesis Video Streams with WebRTC service quotas — AWS — https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/kvswebrtc-limits.html — undated — accessed 2026-11-14 — primary
- [S19] GetIceServerConfig — Amazon KVS API Reference — https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/API_signaling_GetIceServerConfig.html — undated — accessed 2026-11-14 — primary
- [S20] Amazon KVS WebRTC SDK for JavaScript: `src/SignalingClient.ts` (last changed 2026-06-11, commit 4423262) and `src/SigV4RequestSigner.ts`; latest release v2.9.0 (2026-08-20) — AWS Labs, GitHub — https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-js — accessed 2026-11-14 — primary
- [S21] Amazon KVS WebRTC SDK for JavaScript, `examples/viewer.js` — AWS Labs, GitHub — https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-js/blob/master/examples/viewer.js — undated (master as of 2026-11-14) — accessed 2026-11-14 — primary
- [S22] Amazon KVS WebRTC iOS sample: `Swift/KVSiOSApp/Message.swift`, `Event.swift`, `SignalingClient.swift`, `Swift/Podfile` — AWS Labs, GitHub — https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-ios — last pushed 2025-12-22 — accessed 2026-11-14 — primary
- [S23] Local SDK interfaces (verified in local SDK). XCTest/XCUIAutomation headers: `XCTMetric.h`, `XCTMetric+UIAutomation.h`, `XCTMeasureOptions.h`, `XCTestCase.h`, `XCTAttachment.h`, `XCTAttachment+XCUIScreenshot.h`, `XCUIApplication.h`. `Testing.framework` and `_Testing_UIKit` swiftinterfaces. UIKit `UIView.h`/`UITraitCollection.h`/`UIAccessibility.h`. SwiftUICore and Foundation swiftinterfaces. `NSURLSession.h`. The ImageRenderer documentation page — Xcode 26.6 (17F113), iOS 26.5 SDK, and https://developer.apple.com/documentation/swiftui/imagerenderer — accessed 2026-11-14 — primary
- [S24] XCTHitchMetric — Apple Developer Documentation — https://developer.apple.com/documentation/xctest/xcthitchmetric — undated (iOS 26.0+) — accessed 2026-11-14 — primary
- [S25] Understanding hitches in your app — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app — undated — accessed 2026-11-14 — primary
- [S26] Eliminate animation hitches with XCTest — WWDC20 session 10077 — https://developer.apple.com/videos/play/wwdc2020/10077/ — June 2020 — accessed 2026-11-14 — primary
- [S27] Optimizing App Launch — WWDC19 session 423 — https://developer.apple.com/videos/play/wwdc2019/423/ — June 2019 — accessed 2026-11-14 — primary
- [S28] Reducing your app's launch time — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/reducing-your-app-s-launch-time — undated — accessed 2026-11-14 — primary
- [S29] Testing and Debugging in Simulator (Simulator User Guide, archived) — Apple — https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/iOS_Simulator_Guide/TestingontheiOSSimulator/TestingontheiOSSimulator.html — updated 2018-02-15 — accessed 2026-11-14 — primary (archived)
- [S30] didReceive(_:withContentHandler:) — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension/didreceive(_:withcontenthandler:) — undated — accessed 2026-11-14 — primary
- [S31] UNNotificationServiceExtension — Apple Developer Documentation — https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension — undated — accessed 2026-11-14 — primary
- [S32] "Notification Service Extension is killed during startup", reply by an Apple WWDR engineer ("limited to 24 MB") — Apple Developer Forums — https://developer.apple.com/forums/thread/807554 — Nov 2025 — accessed 2026-11-14 — primary (Apple staff, forum rather than documentation)
- [S33] NSAllowsLocalNetworking — Apple Developer Documentation — https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking — undated — accessed 2026-11-14 — primary
- [S34] pointfreeco/swift-snapshot-testing: repository (MIT), Releases (1.19.7), `Package.swift` at 1.19.7 — GitHub — https://github.com/pointfreeco/swift-snapshot-testing — release published 2026-10-21 — accessed 2026-11-14 — primary
- [S35] Local tool help and checks on this toolchain:
  - `xcrun simctl help` (ui, push, status_bar, privacy, io) and `simctl list runtimes`;
  - `xcrun xcresulttool` 24757 help and `--schema` (get test-results metrics, export attachments);
  - `xcrun xctrace help record` and `xctrace list templates` (xctrace 16.0, 17F113);
  - `xcodebuild -help` and `man xcodebuild` (`TEST_RUNNER_`);
  - `/usr/bin/log help collect`; `dns-sd` usage; the Node 25.6.0 crypto and WebSocket check

  — this Mac — 2026-11-14 — accessed 2026-11-14 — primary (verified locally)
- [S36] Local experiment A. A probe app printing `UIAccessibility.isReduceMotionEnabled`, `isDarkerSystemColorsEnabled`, `preferredContentSizeCategory` and `userInterfaceStyle`, run on a throwaway "iPhone 17e" / iOS 26.5 Simulator before and after `simctl ui …` and `defaults write com.apple.Accessibility ReduceMotionEnabled`. The device was deleted afterwards — this Mac — 2026-11-14 — accessed 2026-11-14 — primary (first-hand)
- [S37] Local experiment B. A probe app plus a Notification Service Extension (registered per `pluginkit -m`), sent a `mutable-content: 1` payload with `simctl push`. Delivered title unchanged; no extension log line — this Mac — 2026-11-14 — accessed 2026-11-14 — primary (first-hand)
- [S38] Local experiment C. `dns-sd -P … 127.0.0.1 hub=TESTONLY`, resolved with `dns-sd -L` and `dns-sd -G v4` — this Mac — 2026-11-14 — accessed 2026-11-14 — primary (first-hand)
- [S39] "Running iOS Performance Testing on CI" — Alexey Alter-Pesotskiy (testableapple) — https://testableapple.pages.dev/xctmetric — 2024-07-31 — accessed 2026-11-14 — secondary
- [S40] fastlane `run_tests` (scan) options — fastlane 2.240.1 gem source, `scan/lib/scan/options.rb` (Homebrew Cellar) — local — accessed 2026-11-14 — primary (tool's own source)
- [S41] Layer 1: Join and connect (sections "Live view", "Push", "Ports", "Remote connection (AWS)", "When things fail"; snapshot of layer-1@fa56475) — project team — `docs/context/upstream/layer1-join-and-connect.local-snapshot.md` — undated draft — accessed 2026-11-14 — primary (project source of truth)
- [S42] Debbie kickoff brief, §3 "Engineering" and §6 "The mock home", "Simulator", "On-device demo home" — project owner — `KICKOFF_PROMPT.md` — undated — accessed 2026-11-14 — primary (binding brief)
