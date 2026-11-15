import AVFoundation
import DebbieCareScreens
import DebbieCore
import DebbieDesignSystem
import DebbieNetworking
import Network
import SwiftUI
import UserNotifications

// Layer 1's screens (brief §5.1): onboarding and pairing, home, live view, add a laptop, resident, settings.
// Built only from DebbieDesignSystem components and tokens (CRAFT.md §5; lints C1, L1, K1, I1).

public struct RootView: View {
    @State var model: AppModel
    let debugQRPayload: String?
    public init(model: AppModel, debugQRPayload: String? = nil) {
        _model = State(initialValue: model)
        self.debugQRPayload = debugQRPayload
        // The intro plays only when the app opens on the welcome screen (D-033): a caregiver opening to an alert never waits.
        IntroGate.arm(opensOnWelcome: model.phase == .welcome)
    }
    public var body: some View {
        ZStack {
            Color.dCanvas.ignoresSafeArea()
            switch model.phase {
            case .welcome: WelcomeView(model: model).transition(Motion.swap)
            case .onboarding: OnboardingFlow(model: model, debugQRPayload: debugQRPayload).transition(Motion.swap)
            case .caregiver: CaregiverRoot(model: model).transition(Motion.swap)
            case .resident: ResidentView(model: model).transition(Motion.swap)
            }
        }
        .animation(Motion.crossFade, value: model.phase)
        .modifier(MotionPolicyReader(forced: Self.forceReduceMotion))
    }

    /// Debug-only test hook for the screen gate's Reduce Motion pass (CLAUDE.md: no test hooks in Release).
    private static var forceReduceMotion: Bool {
        #if DEBUG
        ProcessInfo.processInfo.environment["DEBBIE_REDUCE_MOTION"] == "on"
        #else
        false
        #endif
    }
}

// MARK: Welcome (S01), and the launch intro (CRAFT.md §3.7; D-033)

/// The intro plays once per process, only when the app opens on the welcome screen, and never with VoiceOver running
/// (it is decorative, and the welcome's words are what matter). Decided once, at the root, before any view appears.
@MainActor enum IntroGate {
    private static var armed = false
    private static var decided = false
    static func arm(opensOnWelcome: Bool) {
        guard !decided else { return }
        decided = true
        armed = opensOnWelcome && !UIAccessibility.isVoiceOverRunning && !offForTests
    }

    /// Debug-only test hook: UI tests that start on the welcome but aren't about the intro turn it off
    /// (`DEBBIE_INTRO=off`), so a tap never meets a button that is still rising into place.
    private static var offForTests: Bool {
        #if DEBUG
        ProcessInfo.processInfo.environment["DEBBIE_INTRO"] == "off"
        #else
        false
        #endif
    }
    /// Whether the welcome should open with the intro. Settled (spent) when the welcome appears.
    static var pending: Bool { armed }
    static func spend() { armed = false }
    /// Tests only: a fresh process.
    static func resetForTesting() { armed = false; decided = false }
}

struct WelcomeView: View {
    let model: AppModel
    @State private var stage: IntroStage
    /// The clock's zero: the first frame the intro is seen (set on appearance, so launch time never eats into it).
    @State private var start: Date?
    /// A tap (or VoiceOver starting) ends the intro the way Reduce Motion plays it: a fade, then the handoff.
    @State private var skipped = false
    /// Plays `unpairIncomplete` when the welcome opens with the notice that the home couldn't be told.
    @State private var unpairIncomplete = 0
    @Namespace private var lockup
    @Environment(\.motion) private var motion

    init(model: AppModel) {
        self.model = model
        _stage = State(initialValue: IntroGate.pending ? .playing : .done)
    }

    var body: some View {
        // One clock drives the intro; the handoff to the layout is a real animation, so the frame change is a spring.
        TimelineView(.animation(paused: stage == .done)) { context in
            scene(at: start.map { context.date.timeIntervalSince($0) } ?? 0)
        }
        .onAppear {
            IntroGate.spend(); if start == nil { start = .now }
            if model.unpairNotice != nil { unpairIncomplete += 1 }
        }
        .debbieHaptic(.unpairIncomplete, trigger: unpairIncomplete)
        .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.voiceOverStatusDidChangeNotification)) { _ in
            if UIAccessibility.isVoiceOverRunning { skip() }
        }
    }

    /// Whether the piece plays as a still fade: the setting, or a skip.
    private var still: Bool { motion.reduce || skipped }

    private func skip() {
        guard stage == .playing, !skipped else { return }
        withAnimation(motion.present) {
            skipped = true
            start = Date.now.addingTimeInterval(-Motion.Intro.reducedHandoffAt)
        }
    }

    /// The stage the clock says we should be in.
    private func dueStage(at t: TimeInterval) -> IntroStage {
        let (handoff, arrive, done) = still
            ? (Motion.Intro.reducedHandoffAt, Motion.Intro.reducedArriveAt, Motion.Intro.reducedDoneAt)
            : (Motion.Intro.handoffAt, Motion.Intro.arriveAt, Motion.Intro.doneAt)
        if t >= done { return .done }
        if t >= arrive { return .arrive }
        if t >= handoff { return .handoff }
        return .playing
    }

    /// Moves forward through every due stage, in order, however late the tick (a hitch, a return from the background).
    private func advance(to due: IntroStage) {
        let order: [IntroStage] = [.playing, .handoff, .arrive, .done]
        guard let from = order.firstIndex(of: stage), let to = order.firstIndex(of: due), to > from else { return }
        for next in order[(from + 1)...to] {
            switch next {
            case .handoff, .arrive: withAnimation(motion.present) { stage = next }
            default: stage = next
            }
        }
    }

    @ViewBuilder private func scene(at t: TimeInterval) -> some View {
        let pose = stage == .playing ? IntroPose.at(t, reduce: still) : IntroPose.finished
        ZStack {
            WelcomeContent(model: model, stage: stage, lockup: lockup, ownsHero: stage != .playing || still)
                .accessibilityHidden(!stage.showsContent)
                .allowsHitTesting(stage.showsContent)
            // The centred slots stay in the tree until the end and merely stop being the source at the handoff: a slot
            // removed while the hero is still gliding would stay alive for its exit and give the hero two sources. On
            // a skip the trace fades and the slots hand over at once.
            if stage != .done && !motion.reduce {
                introStage(pose, owns: stage == .playing && !skipped)
                    .opacity(skipped ? 0 : 1)
                    .contentShape(Rectangle())
                    .onTapGesture { skip() }
                    .allowsHitTesting(stage == .playing && !skipped)
            }
            if stage != .done {
                IntroLockupHero(pose: pose, face: stage != .playing)
                    .matchedGeometryEffect(id: "hero", in: lockup, isSource: false)
                IntroWordmark(pose: pose)
                    .matchedGeometryEffect(id: "wordmark", in: lockup, isSource: false)
            }
            if stage == .playing && !still { IntroPenLayer(pose: pose) }
        }
        .onChange(of: dueStage(at: t), initial: true) { _, due in advance(to: due) }
    }

    /// The trace, and the lockup's slots in the middle of the screen (the hero and wordmark follow these until the handoff).
    private func introStage(_ pose: IntroPose, owns: Bool) -> some View {
        GeometryReader { geo in
            let layout = IntroLayout(size: geo.size)
            ZStack(alignment: .topLeading) {
                HeartbeatTraceLayer(pose: pose)
                Color.clear.frame(width: layout.tile.width, height: layout.tile.height)
                    .matchedGeometryEffect(id: "hero", in: lockup, isSource: owns)
                    .position(x: layout.tile.midX, y: layout.tile.midY)
                Color.clear.frame(width: layout.wordmark.width, height: layout.wordmark.height)
                    .matchedGeometryEffect(id: "wordmark", in: lockup, isSource: owns)
                    .position(x: layout.wordmark.midX, y: layout.wordmark.midY)
            }
        }
        .accessibilityHidden(true)
    }
}

/// The welcome screen itself. Until the intro is over, its hero and wordmark are empty slots the intro's lockup glides
/// into. Its words and buttons are laid out at their final size from the first frame (the column is full width, the
/// action bar full height), unseen, and only rise into view beneath the lockup as it lands (T19): nothing re-wraps.
private struct WelcomeContent: View {
    let model: AppModel
    let stage: IntroStage
    let lockup: Namespace.ID
    let ownsHero: Bool
    @Environment(\.motion) private var motion

    private var shown: Bool { stage.showsContent }
    private var rise: CGFloat { shown || motion.reduce ? 0 : Space.s24 }

    var body: some View {
        ScrollView {
            VStack(spacing: Space.s20) {
                // After an unpair the home couldn't hear, that comes first: it's what the person needs to act on (D-035).
                if shown, let notice = model.unpairNotice {
                    DCard(tint: .dCautionTint) {
                        Text(notice).font(DType.body).foregroundStyle(Color.dText).fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityIdentifier("unpairNotice")
                }
                // Debbie introduces herself (owner direction 16:16): a face, not a logo, is the first thing you see.
                if stage == .done {
                    DebbieAvatar(size: Size.avatarHero)
                    DArt("Brand-wordmark").frame(width: Size.brandWordmarkWidth, height: Size.brandWordmark).foregroundStyle(Color.dText)
                        .accessibilityLabel("debbie").accessibilityAddTraits(.isHeader)
                } else {
                    Color.clear.frame(width: Size.avatarHero, height: Size.avatarHero)
                        .matchedGeometryEffect(id: "hero", in: lockup, isSource: ownsHero)
                    Color.clear.frame(width: Size.brandWordmarkWidth, height: Size.brandWordmark)
                        .matchedGeometryEffect(id: "wordmark", in: lockup, isSource: ownsHero)
                }
                Group {
                    Text("Hi, I'm Debbie.").font(DType.hero).foregroundStyle(Color.dText).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("I help you know that home is all right, and tell you quickly when it isn't.")
                        .font(DType.title).foregroundStyle(Color.dText).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Debbie is an alerting and check-in aid for families. It doesn't replace emergency services or your Apple Watch's Fall Detection and Emergency SOS. Keep those on.")
                        .font(DType.secondary).foregroundStyle(Color.dText2).multilineTextAlignment(.center)
                }
                .opacity(shown ? 1 : 0)
                .offset(y: rise)
                .animation(motion.present, value: shown)
                .accessibilityHidden(!shown)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Space.s20)
            .padding(.top, Space.s32)
        }
        // The one job of this screen is to start (CRAFT.md §1 simplicity budget): the actions stay on screen at every size.
        .debbiePinnedAction {
            Group {
                Button("Get Started") { model.dismissUnpairNotice(); model.phase = .onboarding }
                    .buttonStyle(.debbie(.primary, size: .large)).accessibilityIdentifier("getStarted")
                if model.demoAvailable {
                    Button("Try the Demo") { model.startDemo() }
                        .buttonStyle(.debbie(.quiet, size: .regular)).accessibilityIdentifier("tryDemo")
                }
            }
            .opacity(shown ? 1 : 0)
            .offset(y: rise)
            .animation(motion.present.delay(0.04), value: shown)
            // Untouchable and hidden from assistive tech until shown. Not `.disabled`: its colours would blend into the
            // rise (the fix's review). UI tests start without the intro (DEBBIE_INTRO=off).
            .allowsHitTesting(shown)
            .accessibilityHidden(!shown)
        }
    }
}

// MARK: Onboarding and pairing (S02–S08, S16)

struct OnboardingFlow: View {
    let model: AppModel
    let debugQRPayload: String?
    enum Step: Equatable { case role, localNetwork, camera, scan, name, code(String), paired, notifications, health }
    @State private var step: Step = .role
    @State private var role: Role = .caregiver
    @State private var name = "My iPhone"
    @State private var qr: PairingQR?
    @State private var problem: String?
    @State private var pairedCount = 0
    @State private var failedCount = 0
    @State private var choiceCount = 0
    @State private var scanOK = 0
    @State private var scanBad = 0
    @State private var forward = true
    @State private var pairing: Task<Void, Never>?
    /// Which Continue started the pairing in flight, so a cancelled one finishing late never clears a newer one.
    @State private var pairingRun = 0
    /// Counts step changes, so a deferred one (after a change of direction) never lands on top of a newer one.
    @State private var navigation = 0
    @Environment(\.motion) private var motion

    /// Back on every step until pairing completes (owner, 17:40: the QR screen had none). Each goes to the step before it,
    /// sliding from the leading edge. Back on the code step cancels the pending pairing.
    private var back: (() -> Void)? {
        switch step {
        case .role: return { model.isDemo ? model.leaveDemo() : (model.phase = .welcome) }
        case .localNetwork: return { go(.role, forward: false) }
        case .camera: return { go(.localNetwork, forward: false) }
        case .scan: return { go(model.isDemo ? .role : .camera, forward: false) }
        case .name: return { pairing?.cancel(); pairing = nil; go(model.isDemo ? .role : .scan, forward: false) }
        case .code: return {
            pairing?.cancel(); pairing = nil
            if model.isDemo {
                go(.name, forward: false)
            } else {
                // The laptop keeps showing this code for this iPhone's first key until someone presses Cancel there, so a
                // retry with a new key would be refused. Start again from a fresh code.
                qr = nil
                failedCode = scanned; canRetry = false
                problem = "If the home laptop still shows a code, press Cancel there. Then show a new code and scan it."
                go(.scan, forward: false)
            }
        }
        case .paired, .notifications, .health: return nil
        }
    }

    /// A removed view keeps the transition from its last render. When the direction changes, the outgoing step must
    /// render once with the new direction before it leaves; otherwise it exits one way while the new step arrives
    /// from the other (CRAFT T6).
    private func go(_ next: Step, forward: Bool = true) {
        navigation += 1
        guard self.forward != forward else { step = next; return }
        self.forward = forward
        let this = navigation
        Task { @MainActor in if navigation == this { step = next } }
    }

    var body: some View {
        VStack(spacing: 0) {
            DebbieTopBar("Set Up", onBack: back) {
                if model.isDemo { DDemoBadge() }
            }
            Group {
                switch step {
                case .role: roleStep
                case .localNetwork:
                    DPriming(icon: "laptop", title: "Let's find your home laptop",
                             message: "I look for the home laptop on this Wi-Fi. iPhone will ask to allow this next.", persona: true) {
                        LocalNetworkPrompt.trigger(); go(.camera)
                    }
                case .camera:
                    DPriming(icon: "qr-scan", title: "Scan the code on the laptop",
                             message: "I use the camera only to read the pairing code. iPhone will ask next.", persona: true) {
                        Task { _ = await AVCaptureDevice.requestAccess(for: .video); go(.scan) }
                    }
                case .scan: scanStep
                case .name: nameStep
                case .code(let code): codeStep(code)
                case .paired: pairedStep
                case .notifications:
                    DPriming(icon: "status-urgent", title: "Get alerts even when Debbie is closed",
                             message: "Urgent alerts, like a possible fall, break through Focus. Keep your ringer on, or my alerts will arrive silently.", persona: true) {
                        Task {
                            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
                            model.phase = .caregiver
                        }
                    }
                case .health:
                    DPriming(icon: "heart", title: "Send your heart rate home",
                             message: "I read your heart rate from Health as your Watch syncs it, and send it to your home laptop over Wi-Fi. iPhone will ask next.", persona: true) {
                        // The demo home uses sample readings only, so it never asks for Health access (DEMO_HOME.md).
                        Task { if !model.isDemo { await HeartRateReader.requestAccess() }; model.phase = .resident }
                    }
                }
            }
            .transition(motion.step(forward: forward))
            .animation(motion.state, value: step)
        }
        .debbieHaptic(.paired, trigger: pairedCount)
        .debbieHaptic(.pairingFailed, trigger: failedCount)
        .debbieHaptic(.choiceChanged, trigger: choiceCount)
        .debbieHaptic(.scanRecognized, trigger: scanOK)
        .debbieHaptic(.scanInvalid, trigger: scanBad)
    }

    private var roleStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s16) {
                DebbieGuide("Who uses this iPhone?", detail: "I'll set things up to suit.")
                DChoiceCard(title: "A family member", detail: "Get alerts and check on home.", icon: "status-healthy", selected: role == .caregiver) { role = .caregiver; choiceCount += 1 }
                DChoiceCard(title: "The person at home", detail: "Send heart rate from your Watch.", icon: "heart", selected: role == .resident) { role = .resident; choiceCount += 1 }
                Button("Continue") { go(model.isDemo ? .name : .localNetwork) }.buttonStyle(.debbie(.primary, size: .large)).accessibilityIdentifier("roleContinue")
            }
            .padding(Space.s20)
        }
    }

    @State private var pasted = ""
    /// The code read last, and the one whose pairing just failed. The laptop goes on showing that code, so the camera
    /// read it again at once and jumped back to the name step, wiping the reason off the screen (the build-8 review,
    /// SCAN-4). That code is now held back; a new code, or Try Again after a Wi-Fi failure, moves on.
    @State private var scanned: String?
    @State private var failedCode: String?
    /// The failure was the Wi-Fi, not the code: the same code can be tried again once the iPhone is on the home's Wi-Fi.
    @State private var canRetry = false
    private var scanStep: some View {
        VStack(spacing: Space.s16) {
            QRScannerView(onPayload: { handleScan($0) }, cameraLabel: "Camera view for the pairing code")
                .clipShape(RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
            if let problem { Text(problem).font(DType.body).foregroundStyle(Color.dUrgentText).multilineTextAlignment(.center) }
            if canRetry, failedCode != nil, qr != nil {
                Button("Try Again") { failedCode = nil; canRetry = false; problem = nil; go(.name) }
                    .buttonStyle(.debbie(.secondary, size: .regular)).accessibilityIdentifier("tryAgain")
            }
            Text("Point the camera at the code on the home laptop's setup page.").font(DType.body).foregroundStyle(Color.dText2).multilineTextAlignment(.center)
            #if DEBUG
            DTextField("Paste a pairing code (Debug)", placeholder: "{\"v\":1,…}", text: $pasted)
            Button("Use Pasted Code") { handleScan(pasted) }.buttonStyle(.debbie(.secondary, size: .regular))
            #endif
        }
        .padding(Space.s20)
        // Fill the screen from the top, so the Set Up bar stays where every other step has it.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear { if let debugQRPayload { handleScan(debugQRPayload) } }
    }

    /// Whether the code was a pairing code; if not, the scanner keeps looking. The code whose pairing just failed is
    /// held back without a word: its reason stays on screen.
    @discardableResult private func handleScan(_ payload: String) -> Bool {
        guard payload != failedCode else { return false }
        do {
            qr = try PairingQR.parse(payload)
            scanned = payload; failedCode = nil; canRetry = false; problem = nil
            scanOK += 1
            AccessibilityNotification.Announcement("Code read.").post()
            go(.name)
            return true
        }
        catch .expired { reject("This code has expired. Codes work for 10 minutes. On the home laptop, show a new code and scan it.") }
        catch .joinCode { reject("That's a code for adding a laptop. Scan the pairing code instead.") }
        catch { reject("That isn't a Debbie pairing code.") }
        return false
    }

    /// A camera read isn't a tap, so a wrong code's message is announced (CRAFT H4). Its haptic and announcement come
    /// only when the message changes: the camera now keeps looking, and the same message buzzing again with nothing new
    /// on screen was a haptic as the only signal (the build-8 review, SCAN-2).
    private func reject(_ message: String) {
        guard message != problem else { return }
        problem = message
        scanBad += 1
        AccessibilityNotification.Announcement(message).post()
    }

    private var nameStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s16) {
                DebbieGuide("Name this iPhone", detail: "The home laptop shows this name.")
                DTextField("Name shown on the home laptop", placeholder: "Sam's iPhone", text: $name,
                           error: name.trimmingCharacters(in: .whitespaces).isEmpty ? "Enter a name." : nil)
                // One pairing at a time: a second tap while the first send is out does nothing, and the button says it's busy.
                Button("Continue") {
                    guard pairing == nil else { return }
                    pairingRun += 1
                    let run = pairingRun
                    pairing = Task { await pair(); if pairingRun == run { pairing = nil } }
                }
                    .buttonStyle(.debbie(.primary, size: .large, loading: pairing != nil)).accessibilityIdentifier("nameContinue")
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(Space.s20)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private func pair() async {
        let code = qr ?? (model.isDemo ? try? PairingQR.parse(DemoCodes.pairingQR) : nil)
        guard let code else { go(.scan); return }
        do {
            let attempt = try await model.beginPairing(qr: code, name: String(name.prefix(64)), role: role)
            try Task.checkCancellation()
            go(.code(attempt.code))
            let config = try await attempt.waitForConfirmation()
            try Task.checkCancellation()
            model.paired(config)
            pairedCount += 1
            model.phase = .onboarding
            go(.paired)
        } catch {
            // Back on the name or code step cancels this task: the person chose to leave, so there's no error, no haptic
            // and no jump. URLSession reports that as URLError.cancelled rather than CancellationError, so ask the task.
            if Task.isCancelled || error is CancellationError { return }
            failedCode = scanned
            canRetry = false
            let message: String
            switch error as? HomeError {
            case .expiredCode?: message = "This code was already used or has expired. On the home laptop, show a new code."
            case .inProgress?: message = "The home laptop is still showing an earlier code. Press Cancel there, then show a new code and scan it."
            case .declined?: message = "The pairing was cancelled on the home laptop."
            default:
                // CRAFT §5's copy, with its [Try Again].
                message = "Can't find the home laptop. Your iPhone needs to be on the same Wi-Fi as the home laptop."
                canRetry = true
            }
            problem = message
            failedCount += 1
            // It arrives seconds after the tap, on a new step: say it (CRAFT H4).
            AccessibilityNotification.Announcement(message).post()
            go(.scan, forward: false)
        }
    }

    private func codeStep(_ code: String) -> some View {
        ScrollView {
        VStack(spacing: Space.s24) {
            Text("Check the code").font(DType.title).foregroundStyle(Color.dText).accessibilityAddTraits(.isHeader)
            DCodeDisplay(code)
            Text("Make sure the laptop shows the same 4 digits, then press Confirm on the laptop.")
                .font(DType.body).foregroundStyle(Color.dText2).multilineTextAlignment(.center)
            HStack(spacing: Space.s8) {
                DebbieSpinner().foregroundStyle(Color.dAccent)
                Text("Waiting for the laptop to confirm…").font(DType.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(Color.dText2)
        }
        .padding(Space.s20)
        .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.center, for: .alignment)
        .scrollBounceBehavior(.basedOnSize)
    }

    private var pairedStep: some View {
        ScrollView {
            VStack(spacing: Space.s24) {
                DebbieWithBadge(icon: "status-healthy")
                Text("Paired with \(model.homeName)").font(DType.title).foregroundStyle(Color.dText).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                Text("I'll keep an eye on things with you.").font(DType.body).foregroundStyle(Color.dText2)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            }
            .padding(Space.s20)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.center, for: .alignment)
        .scrollBounceBehavior(.basedOnSize)
        .debbiePinnedAction {
            Button("Continue") { go(role == .caregiver ? .notifications : .health) }
                .buttonStyle(.debbie(.primary, size: .large)).accessibilityIdentifier("pairedContinue")
        }
    }
}

/// The demo's fixed pairing payload (demo transport ignores the keys).
public enum DemoCodes {
    public static let pairingQR = #"{"v":1,"addrs":["demo:0"],"hub_pub":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8","secret":"AAECAwQFBgcICQoLDA0ODw","exp":4102444800}"#
    public static let joinQR = #"{"v":1,"kind":"join","join_id":"demo-join","name":"Kitchen laptop","laptop_pub":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8","exp":4102444800}"#
}

// MARK: Caregiver tabs (S09) and navigation

enum CaregiverRoute: Hashable { case alert(String) }

/// The caregiver's five sections (owner direction 15:44 and 16:16; research notes 16 and 17). Each tab has one job:
/// - Home: is everything all right now?
/// - Live: see the home.
/// - Debbie (centre): ask how your loved one is doing.
/// - History: what happened?
/// - Devices: what is set up?
enum CaregiverTab: String, CaseIterable {
    case home, live, debbie, history, devices

    var tab: DebbieTab {
        switch self {
        case .home: DebbieTab(id: rawValue, title: "Home", icon: "home", filledIcon: "home.fill", effect: .hop)
        case .live: DebbieTab(id: rawValue, title: "Live", icon: "camera", filledIcon: "camera.fill", effect: .lensPop, inputLabels: ["Live View"])
        case .debbie: DebbieTab(id: rawValue, title: "Debbie", icon: "", filledIcon: "", effect: .pop, avatar: true, inputLabels: ["Ask Debbie", "Chat"])
        case .history: DebbieTab(id: rawValue, title: "History", icon: "history", filledIcon: "history.fill", effect: .rewind, inputLabels: ["Alerts"])
        case .devices: DebbieTab(id: rawValue, title: "Devices", icon: "laptop", filledIcon: "laptop.fill", effect: .lidOpen, inputLabels: ["Laptops"])
        }
    }
    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }
}

struct CaregiverRoot: View {
    let model: AppModel
    @State private var tab: CaregiverTab = .home
    @State private var homePath: [CaregiverRoute] = []
    @State private var showLive = false
    @State private var showAddLaptop = false
    @State private var showSettings = false
    @State private var composing = false
    /// The bar's measured height. Every page gets exactly this much bottom space, from inside its own stack.
    @State private var barHeight: CGFloat = Size.tabItem + Space.s16
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.motion) private var motion

    private var selection: Binding<String> {
        Binding(get: { tab.rawValue }, set: { tab = CaregiverTab(rawValue: $0) ?? .home })
    }

    /// The bar steps aside only while you type to Debbie on her own tab. Leaving the tab (the urgent row's Open) always
    /// brings it back, even though the keyboard's focus never got the chance to say it ended.
    private var barHidden: Bool { composing && tab == .debbie }

    /// Unanswered urgent alerts, shown as a red count on the Home tab (note 16 R5).
    private var urgentCount: Int { model.alerts.filter { $0.severity == .urgent && $0.acknowledgedAt == nil }.count }

    var body: some View {
        // Only the selected tab exists. Hidden pages kept alive leaked their bars to VoiceOver.
        // - The content cross-fades in place in 0.15 s, as the system's tab bar does (T16; note 16 R7).
        // - The Home tab's navigation path lives here, so it survives switching.
        // - The bar floats over the content (glass shows what scrolls beneath). Each page pads its own safe area by the
        //   bar's measured height, inside its NavigationStack, because a bar attached outside the stack never reached
        //   Home's scroll view: the last card couldn't scroll clear of the bar (owner, 17:24).
        ZStack(alignment: .bottom) {
            ZStack {
                page(tab)
                    .id(tab)
                    .transition(Motion.swap)
            }
            .animation(Motion.tabFade, value: tab)
            // The bar steps aside while you type to Debbie, so the field sits right above the keyboard.
            if !barHidden {
                DebbieTabBar(tabs: CaregiverTab.allCases.map(\.tab), selection: selection, badges: [CaregiverTab.home.rawValue: urgentCount]) { id in
                    if id == CaregiverTab.home.rawValue { homePath = [] }
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { barHeight = $0 }
                .transition(Motion.swap)
            }
        }
        .animation(motion.state, value: barHidden)
        .onChange(of: tab) { composing = false }
        .background(Color.dCanvas.ignoresSafeArea())
        .fullScreenCover(isPresented: $showLive, onDismiss: { model.resetLiveView() }) { LiveViewScreen(model: model) { showLive = false } }
        // Full screen, as CRAFT T4 has the add-laptop scanner: it can't be swiped away mid-approval (the build-8
        // review, SCAN-8).
        .fullScreenCover(isPresented: $showAddLaptop) { AddLaptopSheet(model: model) { showAddLaptop = false } }
        .sheet(isPresented: $showSettings) { SettingsView(model: model) { showSettings = false } }
        .task { model.startRefreshing() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.stopRefreshing(); if case .playing = model.liveState { model.stopLiveView(reason: .leftApp) } }
            if phase == .active { model.startRefreshing() }
        }
        .debbieHaptic(.alertUrgentArrived, trigger: model.urgentArrivals)
        // Played here, and only here: Home's tab may not exist, and the alert's own screen must not play it a second time.
        .debbieHaptic(.acknowledged, trigger: model.acknowledgements)
    }

    @ViewBuilder private func page(_ t: CaregiverTab) -> some View {
        let corner = CornerControls(isDemo: model.isDemo) { showSettings = true }
        let clearance = barHidden ? 0 : barHeight
        switch t {
        case .home:
            NavigationStack(path: $homePath) {
                HomeTab(model: model, corner: corner, open: { homePath.append(.alert($0)) })
                    .safeAreaPadding(.bottom, clearance)
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationDestination(for: CaregiverRoute.self) { route in
                        switch route {
                        case .alert(let id):
                            AlertDetailView(model: model, alertID: id, onBack: { homePath.removeLast() }, onLiveView: { showLive = true })
                                .safeAreaPadding(.bottom, clearance)
                                .toolbar(.hidden, for: .navigationBar)
                        }
                    }
            }
        case .live: LiveTab(model: model, corner: corner) { showLive = true }.safeAreaPadding(.bottom, clearance)
        case .debbie:
            DebbieChatScreen(model: model, corner: corner, composing: $composing) { id in
                // Opening the urgent row's alert is a deep link: Home, with the alert pushed (note 16 R5).
                homePath = [.alert(id)]
                composing = false
                withAnimation(motion.tabSelect) { tab = .home }
            }
            .safeAreaPadding(.bottom, clearance)
        case .history:
            DebbieTabScreen("History") { corner } content: { HistoryContent(model: model) }.safeAreaPadding(.bottom, clearance)
        case .devices:
            DebbieTabScreen("Devices", subtitle: "What's set up at \(model.homeName)") { corner } content: {
                DevicesContent(model: model) { showAddLaptop = true }
            }
            .safeAreaPadding(.bottom, clearance)
        }
    }
}

/// The top-right corner of every main screen: the demo badge (in the demo) and the Settings gear.
struct CornerControls: View {
    let isDemo: Bool
    let onSettings: () -> Void
    var body: some View {
        HStack(spacing: Space.s8) {
            if isDemo { DDemoBadge() }
            DebbieCornerButton(icon: "gear", label: "Settings", effect: .turn, action: onSettings)
                .accessibilityIdentifier("settings")
        }
    }
}

/// Home: is everything all right right now? The status, any open alerts, and the latest heart rate.
struct HomeTab: View {
    let model: AppModel
    let corner: CornerControls
    let open: (String) -> Void
    @Environment(\.motion) private var motion

    var body: some View {
        // The status headline is this tab's title (note 16 R13), so the top row only names the home.
        DebbieTabScreen(nil, subtitle: model.homeName) { corner } content: {
            StatusHeaderView(status: model.status, lastRefresh: model.lastRefresh)
            // Urgent first, then newest first: the card that leads is always the one that matters most.
            let active = model.alerts.filter { $0.acknowledgedAt == nil && $0.severity != .info }
                .sorted { ($0.severity == .urgent ? 0 : 1, $1.detectedAt) < ($1.severity == .urgent ? 0 : 1, $0.detectedAt) }
            if active.isEmpty {
                DEmptyState(art: "no-alerts", title: model.status.headline == .monitoringOn ? "No alerts" : "No alerts received",
                            message: model.status.headline == .monitoringOn ? "Monitoring is on. \(CareCopy.ago(model.lastRefresh))." : "Debbie can't confirm monitoring right now.")
            } else {
                ForEach(Array(active.enumerated()), id: \.element.alertID) { index, alert in
                    AlertCardView(alert: alert, emphasised: index == 0) { Task { await model.acknowledge(alert, falseAlarm: false) } }
                        .onTapGesture { open(alert.alertID) }
                        .transition(motion.alertCard)
                }
            }
            HeartRateCard(care: model.care)
        }
        // Keyed on acknowledgement as well as identity, so a card answered with I'm On It leaves with its fade (T8).
        .animation(motion.arriveAnimation, value: model.alerts.map { "\($0.alertID)|\($0.acknowledgedAt != nil)" })
    }
}

/// Live: see the home. What live view is and what it promises, with one action to start it.
struct LiveTab: View {
    let model: AppModel
    let corner: CornerControls
    let start: () -> Void
    @State private var plays = 0

    var body: some View {
        DebbieTabScreen("Live View") { corner } content: {
            DCard(tint: .dMintTint) {
                VStack(alignment: .leading, spacing: Space.s12) {
                    DAnimatedIcon("camera", filled: "camera.fill", effect: .lensPop, trigger: plays, active: true)
                        .font(DType.hero).foregroundStyle(Color.dAccent)
                    Text("See the home now").font(DType.title).foregroundStyle(Color.dText)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Look through the home camera for up to 5 minutes at a time.").font(DType.body).foregroundStyle(Color.dText2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            VStack(alignment: .leading, spacing: Space.s12) {
                LiveFact(icon: "laptop", text: "The laptop at home shows a notice while you watch.")
                LiveFact(icon: "stop", text: "Video only, no sound. Stop whenever you like.")
            }
        }
        .debbiePinnedAction {
            Button { plays += 1; start() } label: { DButtonLabel("Start Live View", icon: "camera", effect: .lensPop, plays: plays) }
                .buttonStyle(.debbie(.primary, size: .large)).accessibilityIdentifier("liveView")
        }
    }
}

private struct LiveFact: View {
    let icon: String
    let text: String
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s12) {
            DIcon(icon).font(DType.headline).foregroundStyle(Color.dAccent)
            Text(text).font(DType.body).foregroundStyle(Color.dText).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: Live view (S13)

struct LiveViewScreen: View {
    let model: AppModel
    let close: () -> Void
    @State private var stops = 0
    @Environment(\.motion) private var motion

    var body: some View {
        ZStack {
            Color.dLiveScrim.ignoresSafeArea()
            ScrollView {
            VStack(spacing: Space.s16) {
                switch model.liveState {
                case .playing:
                    model.liveVideoView
                        .clipShape(RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
                        .accessibilityLabel("Video from the home camera")
                        .transition(Motion.swap)
                    Text("The person at home sees a notice on the laptop screen while you watch.")
                        .font(DType.secondary).foregroundStyle(Color.dOnLive).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                case .idle, .requesting:
                    panel(title: "Asking home…", message: "Live view starts only if it's turned on at home.", spinner: true)
                    Button("Cancel") { model.stopLiveView(); close() }.buttonStyle(.debbie(.quiet, size: .regular))
                case .ready, .connecting:
                    panel(title: "Connecting to the camera…", message: "This can take a few seconds.", spinner: true)
                case .ending:
                    panel(title: "Stopping…", message: "", spinner: true)
                case .denied:
                    panel(title: "Live view is off at home", message: "Only the person at home can turn it on.", spinner: false)
                    Button("Done", action: close).buttonStyle(.debbie(.primary, size: .large))
                case .ended(let reason):
                    panel(title: "Live view ended", message: endMessage(reason), spinner: false)
                    if reason == .timeLimit || reason == .stoppedByYou {
                        Button("Keep Watching") { model.startLiveView() }.buttonStyle(.debbie(.primary, size: .large)).accessibilityIdentifier("keepWatching")
                    }
                    Button("Done", action: close).buttonStyle(.debbie(.quiet, size: .regular))
                case .failed(let message):
                    panel(title: "Couldn't start live view", message: message, spinner: false)
                    Button("Try Again") { model.startLiveView() }.buttonStyle(.debbie(.primary, size: .large))
                    Button("Done", action: close).buttonStyle(.debbie(.quiet, size: .regular))
                }
            }
            .padding(Space.s20)
            .animation(Motion.crossFade, value: stateKey)
            }
            .defaultScrollAnchor(.center, for: .alignment)
            .scrollBounceBehavior(.basedOnSize)
            // While watching, "LIVE" and Stop never scroll away (privacy: you always know it's live and can stop it).
            .safeAreaInset(edge: .top) {
                if case .playing(let endsAt) = model.liveState {
                    DebbieLiveBar(place: "Home camera", endsAt: endsAt).padding(.horizontal, Space.s20).padding(.top, Space.s8)
                        .transition(Motion.swap)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if case .playing = model.liveState {
                    Button { stops += 1; model.stopLiveView() } label: { DButtonLabel("Stop", icon: "stop", plays: stops) }
                        .buttonStyle(.debbie(.urgent, size: .prominent)).accessibilityIdentifier("stopLive")
                        .padding(.horizontal, Space.s20).padding(.bottom, Space.s8)
                        .transition(Motion.swap)
                }
            }
        }
        .environment(\.colorScheme, .dark)
        .task { if model.liveState == .idle { model.startLiveView() } }
        .debbieHaptic(trigger: model.liveEvent) { _, new in
            switch new { case .started: .liveViewStarted; case .denied: .liveViewDenied; case .endedByResident: .liveViewEndedByResident; case .lost: .liveViewLost; case .none: nil }
        }
    }

    private var stateKey: String { String(describing: model.liveState).components(separatedBy: "(").first ?? "" }

    private func panel(title: String, message: String, spinner: Bool) -> some View {
        VStack(spacing: Space.s12) {
            Spacer()
            if spinner { DebbieSpinner().foregroundStyle(Color.dOnLive) }
            Text(title).font(DType.title).foregroundStyle(Color.dOnLive).multilineTextAlignment(.center).accessibilityAddTraits(.isHeader)
            if !message.isEmpty { Text(message).font(DType.body).foregroundStyle(Color.dOnLive).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true) }
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func endMessage(_ r: LiveViewState.EndReason) -> String {
        switch r {
        case .timeLimit: "Sessions last up to 5 minutes."
        case .stoppedByYou: "You stopped live view."
        case .residentTurnedOff: "Live view was turned off at home."
        case .connectionLost: "The connection to the home camera was lost."
        case .leftApp: "Live view stopped when you left Debbie."
        }
    }
}

// MARK: Add a laptop (S14)

struct AddLaptopSheet: View {
    let model: AppModel
    let close: () -> Void
    @State private var join: JoinQR?
    @State private var problem: String?
    @State private var sending = false
    @State private var approved = 0
    @State private var failed = 0
    @State private var pasted = ""
    @State private var scanOK = 0
    @State private var scanBad = 0

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s16) {
            // Close and Cancel wait while Approve is out, so its result is always seen.
            DebbieSheetHeader("Add a Laptop", onClose: close).disabled(sending)
            ScrollView {
            VStack(alignment: .leading, spacing: Space.s16) {
                if let join {
                    Text("Add \(join.name) to your home?").font(DType.title).foregroundStyle(Color.dText)
                    Text("It will start helping with monitoring once it joins.").font(DType.body).foregroundStyle(Color.dText2)
                    Button("Approve") { Task { await approve(join) } }.buttonStyle(.debbie(.primary, size: .large, loading: sending))
                    Button("Cancel", action: close).buttonStyle(.debbie(.quiet, size: .regular)).disabled(sending)
                } else {
                    QRScannerView(onPayload: { handle($0) }, maxCameraHeight: Size.scannerSheet,
                                  cameraLabel: "Camera view for the laptop's code", inDemo: model.isDemo)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
                    Text("Scan the code on the new laptop's screen.").font(DType.body).foregroundStyle(Color.dText2)
                    if model.isDemo { Button("Use the Demo Laptop") { handle(DemoCodes.joinQR) }.buttonStyle(.debbie(.secondary, size: .regular)) }
                    #if DEBUG
                    DTextField("Paste a laptop code (Debug)", placeholder: "{\"v\":1,\"kind\":\"join\",…}", text: $pasted)
                    Button("Use Pasted Code") { handle(pasted) }.buttonStyle(.debbie(.quiet, size: .regular))
                    #endif
                }
                if let problem { Text(problem).font(DType.body).foregroundStyle(Color.dUrgentText) }
            }
            .padding(.horizontal, Space.s20)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(Color.dCanvas.ignoresSafeArea())
        .debbieHaptic(.laptopApproved, trigger: approved)
        .debbieHaptic(.laptopApprovalFailed, trigger: failed)
        .debbieHaptic(.scanRecognized, trigger: scanOK)
        .debbieHaptic(.scanInvalid, trigger: scanBad)
    }

    /// Whether the code was a laptop's join code; if not, the scanner keeps looking. As in pairing, a camera read is
    /// announced, and a wrong code buzzes only when the message changes (CRAFT H4; the build-8 review, SCAN-2).
    @discardableResult private func handle(_ text: String) -> Bool {
        do {
            let code = try JoinQR.parse(text)
            join = code; problem = nil; scanOK += 1
            AccessibilityNotification.Announcement("Found \(code.name).").post()
            return true
        } catch {
            let message = "That isn't a Debbie laptop code."
            guard message != problem else { return false }
            problem = message; scanBad += 1
            AccessibilityNotification.Announcement(message).post()
            return false
        }
    }

    private func approve(_ j: JoinQR) async {
        sending = true; defer { sending = false }
        do { try await model.approveLaptop(j); approved += 1; close() }
        catch { failed += 1; problem = "Couldn't approve the laptop. Debbie couldn't reach home. Try again on the home Wi-Fi or when you're online." }
    }
}

// MARK: Resident (S15)

/// The person at home: one calm screen (brief §5.1.7 "as simple as the app can be"; owner, 17:40: "more aesthetic").
/// - Debbie greets them, the heart rate is the hero, and one large button sends it home. Settings sits in the corner.
/// - There's no live-view switch: removed at the owner's direction for the presentation (D-032).
struct ResidentView: View {
    let model: AppModel
    @State private var syncing = false
    @State private var synced = 0
    @State private var syncFailed = 0
    @State private var spins = 0
    @State private var beats = 0
    @State private var showSettings = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        DebbieTabScreen(nil) {
            CornerControls(isDemo: model.isDemo) { showSettings = true }
        } content: {
            greeting
            heartCard
            if let sent = model.lastSent { sentPill(sent) }
            if let note = model.syncNote {
                Text(note).font(DType.residentBody).foregroundStyle(Color.dText).fixedSize(horizontal: false, vertical: true)
            }
        }
        .debbiePinnedAction { syncButton }
        // The demo shows a reading straight away, so the screen never opens empty in a presentation.
        .task { if model.isDemo && model.lastReading == nil { await sync(quiet: true) } }
        .onChange(of: model.lastReading?.t) { beats += 1 }
        .debbieHaptic(.syncSucceeded, trigger: synced)
        .debbieHaptic(.syncFailed, trigger: syncFailed)
        .sheet(isPresented: $showSettings) { SettingsView(model: model) { showSettings = false } }
    }

    private var greeting: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.s12))
            : AnyLayout(HStackLayout(alignment: .center, spacing: Space.s16))
        return layout {
            DebbieAvatar(size: Size.avatarGuide)
            VStack(alignment: .leading, spacing: Space.s4) {
                Text(Self.hello(.now)).font(DType.hero).foregroundStyle(Color.dText)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text("I share your heart rate with your family.").font(DType.residentBody).foregroundStyle(Color.dText2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var heartCard: some View {
        VStack(spacing: Space.s8) {
            DAnimatedIcon("heart", filled: "heart.fill", effect: .beat, trigger: beats, active: model.lastReading != nil)
                .font(DType.hero).foregroundStyle(Color.dAccent)
            if let r = model.lastReading {
                DReading("\(r.bpm)")
                Text("beats a minute").font(DType.residentLabel).foregroundStyle(Color.dText)
                Text("Read at \(r.t.formatted(date: .omitted, time: .shortened))").font(DType.residentBody).foregroundStyle(Color.dText2)
            } else {
                Text("No heart readings yet").font(DType.residentLabel).foregroundStyle(Color.dText)
                Text("Readings appear after your Watch syncs with this iPhone. Keep your Watch on and unlock your iPhone.")
                    .font(DType.residentBody).foregroundStyle(Color.dText2)
            }
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity)
        .padding(.vertical, Space.s24)
        .padding(.horizontal, Space.s16)
        .background(Color.dMintTint, in: RoundedRectangle(cornerRadius: Radius.r28, style: .continuous))
        .overlay {
            // Tint on white is about 1.2:1, so Increase Contrast draws the card's edge (CRAFT C9).
            if contrast == .increased { RoundedRectangle(cornerRadius: Radius.r28, style: .continuous).strokeBorder(Color.dBorder, lineWidth: 1.5) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("residentHeart")
    }

    private func sentPill(_ sent: Date) -> some View {
        HStack(spacing: Space.s8) {
            DIcon("status-healthy").foregroundStyle(Color.dAccent)
            Text("Sent to home at \(sent.formatted(date: .omitted, time: .shortened))").foregroundStyle(Color.dText)
        }
        .font(DType.residentBody)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Space.s16)
        .padding(.vertical, Space.s12)
        // A rounded rectangle, not a capsule: at the largest sizes the words wrap, and a capsule's ends would cut them.
        .background(Color.dSurface, in: RoundedRectangle(cornerRadius: Radius.r20, style: .continuous))
        .overlay {
            if contrast == .increased { RoundedRectangle(cornerRadius: Radius.r20, style: .continuous).strokeBorder(Color.dBorder, lineWidth: 1.5) }
        }
        .frame(maxWidth: .infinity)
    }

    private var syncButton: some View {
        // While it sends, the button keeps its colour and says so; the icon's turn (§3.5) is the working signal, so it
        // stays put rather than giving way to a spinner, which would have hidden the turn it was asked to play.
        Button { guard !syncing else { return }; Task { await sync(quiet: false) } } label: {
            HStack(spacing: Space.s12) {
                DAnimatedIcon("sync", effect: .spin, trigger: spins)
                Text(syncing ? "Sending…" : "Sync Now")
            }
        }
        .buttonStyle(.debbie(.primary, size: .resident))
        .accessibilityIdentifier("syncNow")
        .accessibilityHint("Sends your heart readings to home")
    }

    /// `quiet`: the demo's automatic first send plays no haptic, because the person didn't ask for it.
    private func sync(quiet: Bool) async {
        spins += 1
        syncing = true
        let ok = await model.syncHeartRate(samples: model.isDemo ? demoSamples() : nil)
        syncing = false
        if ok { if !quiet { synced += 1 }; spins += 1 } else if !quiet { syncFailed += 1 }
    }

    static func hello(_ now: Date) -> String {
        switch Calendar.current.component(.hour, from: now) {
        case 5..<12: "Good morning"
        case 12..<18: "Good afternoon"
        default: "Good evening"
        }
    }

    private func demoSamples() -> [HeartSample] {
        let now = Date.now
        return (0..<6).map { HeartSample(t: now.addingTimeInterval(Double(-$0 * 600)), bpm: 68 + ($0 % 3) * 3) }
    }
}

// MARK: Settings (S17) and unpair (S18)

struct SettingsView: View {
    let model: AppModel
    let onBack: () -> Void
    @State private var confirmUnpair = false
    @State private var notificationsOK = true
    @State private var showDemoControls = false

    var body: some View {
        VStack(spacing: 0) {
            DebbieSheetHeader("Settings", onClose: onBack)
            ScrollView {
                VStack(alignment: .leading, spacing: Space.s16) {
                    DCard {
                        VStack(alignment: .leading, spacing: Space.s8) {
                            Text("This iPhone").font(DType.headline).foregroundStyle(Color.dText)
                            Text(model.role == .caregiver ? "Paired as a family member" : "Paired as the person at home").font(DType.body).foregroundStyle(Color.dText2)
                            if model.role == .caregiver {
                                Toggle("Resident mode on this iPhone", isOn: Binding(get: { model.phase == .resident }, set: { on in model.phase = on ? .resident : .caregiver }))
                                    .toggleStyle(DebbieSwitchStyle())
                            }
                        }
                    }
                    DCard {
                        VStack(alignment: .leading, spacing: Space.s8) {
                            Text("Home").font(DType.headline).foregroundStyle(Color.dText)
                            Text(model.homeName).font(DType.body).foregroundStyle(Color.dText)
                            Text("Connected through: \(model.route == .homeWiFi ? "Home Wi-Fi" : (model.route == .demo ? "Demo" : "Internet"))").font(DType.secondary).foregroundStyle(Color.dText2)
                        }
                    }
                    DCard(tint: notificationsOK ? .dSurface : .dCautionTint) {
                        VStack(alignment: .leading, spacing: Space.s8) {
                            Text("Notifications").font(DType.headline).foregroundStyle(Color.dText)
                            Text(notificationsOK ? "Alerts can reach you. Keep your ringer on, or Debbie's alerts will arrive silently." : "Notifications are off for Debbie. You won't get alerts from home.")
                                .font(DType.body).foregroundStyle(Color.dText2)
                            if !notificationsOK, let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                                Link("Open iPhone Settings", destination: url).font(DType.button).foregroundStyle(Color.dAccent).frame(minHeight: Size.minTarget)
                            }
                        }
                    }
                    DCard {
                        VStack(alignment: .leading, spacing: Space.s8) {
                            Text("What Debbie can see").font(DType.headline).foregroundStyle(Color.dText)
                            Text("Video and sound are processed on the home laptops. Alerts are end-to-end encrypted, so Debbie's servers can't read them. Live view works only when the person at home has turned it on, and the laptop shows a notice while someone watches.")
                                .font(DType.body).foregroundStyle(Color.dText2)
                        }
                    }
                    if model.isDemo {
                        Button("Demo Controls") { showDemoControls = true }
                            .buttonStyle(.debbie(.secondary, size: .large)).accessibilityIdentifier("demoControls")
                    }
                    // Unpairing takes up to `NetworkHomeService.unpairDeadline` when the home doesn't answer: the button says so.
                    Button(model.isDemo ? "Leave Demo" : (model.isUnpairing ? "Unpairing…" : "Unpair This iPhone")) {
                        guard !model.isUnpairing else { return }
                        model.isDemo ? model.leaveDemo() : (confirmUnpair = true)
                    }
                    .buttonStyle(.debbie(.destructive, size: .large, loading: model.isUnpairing)).padding(.top, Space.s32)
                    .accessibilityIdentifier("unpair")
                    Text("Debbie \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                        .font(DType.footnote).foregroundStyle(Color.dText2)
                }
                .padding(Space.s20)
            }
        }
        .background(Color.dCanvas.ignoresSafeArea())
        .task { notificationsOK = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .authorized }
        .sheet(isPresented: $showDemoControls) { DemoControlsSheet { showDemoControls = false } }
        .sheet(isPresented: $confirmUnpair) {
            DConfirmSheet(title: "Unpair This iPhone?", message: "Debbie will delete this phone's keys. You'll need to pair again.",
                          actionTitle: "Unpair", destructive: true,
                          onConfirm: { confirmUnpair = false; Task { _ = await model.unpair() } },
                          onCancel: { confirmUnpair = false })
        }
    }
}
