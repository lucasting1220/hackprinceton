import DebbieCareScreens
import DebbieCore
import DebbieCrypto
import DebbieNetworking
import DebbieSecureStore
import Foundation
import HealthKit
import os
import SwiftUI

/// Video for the live view. The demo home supplies a fake engine; the real KVS WebRTC engine is not built
/// tonight (MORNING_REPORT "What I would do next"), so the networked app reports a clear failure instead.
@MainActor
public protocol LiveMediaEngine: AnyObject {
    func start(viewer: LiveViewSession.Viewer?) async throws
    func stop()
    var videoView: AnyView { get }
}

@MainActor
public final class UnavailableMediaEngine: LiveMediaEngine {
    public init() {}
    public func start(viewer: LiveViewSession.Viewer?) async throws { throw HomeError.server("video engine unavailable") }
    public func stop() {}
    public var videoView: AnyView { AnyView(Color.clear) }
}

/// The app's single source of truth (CRAFT.md §8 E4). Implements the care screens' model.
@Observable
@MainActor
public final class AppModel: CareModel {
    public enum Phase: Equatable { case welcome, onboarding, caregiver, resident }

    public var phase: Phase = .welcome
    public private(set) var isDemo = false
    public private(set) var status = HomeStatus(connection: .cantConnect, monitoring: .unknown(lastUpdate: nil), languageModel: .unknown)
    public private(set) var alerts: [HubAlert] = []
    public private(set) var monitoring: MonitoringSnapshot?
    public private(set) var care: CareStatus?
    public private(set) var lastRefresh: Date?
    public private(set) var route: Route = .internet
    public private(set) var homeName = "Home"
    public private(set) var role: Role = .caregiver
    public var residentModeOn = false
    public var liveViewAllowed = false

    // Live view (every state in brief §5.1.5).
    public private(set) var liveState: LiveViewState = .idle
    private var liveSessionID: String?
    private var liveTask: Task<Void, Never>?
    public let mediaEngine: LiveMediaEngine
    private let demoMediaEngine: (() -> LiveMediaEngine)?

    // Resident.
    public private(set) var lastReading: HeartSample?
    public private(set) var lastSent: Date?
    public private(set) var syncNote: String?

    // Haptic triggers (CRAFT.md §4). Each counter changes once per event.
    public private(set) var urgentArrivals = 0
    public private(set) var acknowledgements = 0
    /// After an unpair the home couldn't be told about (the laptop off or away): the welcome says so, so the person
    /// can remove this iPhone on the laptop too. Cleared when they start again.
    public private(set) var unpairNotice: String?
    public func dismissUnpairNotice() { unpairNotice = nil }
    /// True while an unpair is under way: Settings shows "Unpairing…", and a second unpair (Settings closed and
    /// reopened meanwhile) returns at once instead of resetting the app again later.
    public private(set) var isUnpairing = false
    public private(set) var liveEvent: DebbieHapticEvent = .none

    public enum DebbieHapticEvent: Equatable { case none, started(Int), denied(Int), endedByResident(Int), lost(Int) }

    private var service: HomeService
    private let makeNetworkService: () -> HomeService
    private let makeDemoService: (() -> HomeService)?
    private var refreshTask: Task<Void, Never>?
    /// Changes whenever the home does (unpair, the demo starting or ending): a refresh that was already under way when
    /// it changed belongs to the old home, and its answer is dropped.
    private var homeGeneration = 0
    private let heartbeatInterval: TimeInterval
    private var seenAlertIDs = Set<String>()
    private let store = SecureStore()
    private let log = Logger(subsystem: "app.debbie", category: "app")
    /// Set only to replace the home's answers (tests, the offline Debug override); nil asks the home.
    private let assistant: AssistantService?

    /// The conversation with Debbie (the centre tab). It reads the home's state each time it asks (D-031). Unless an
    /// assistant was given, each question goes to the home, which answers with its own Ollama model.
    @ObservationIgnored public private(set) lazy var chat = DebbieChatModel(
        assistant: assistant ?? HomeAssistant(ask: { [weak self] question in
            guard let self else { throw CancellationError() }
            return try await self.askHome(question)
        }),
        homeData: { [unowned self] in self.homeDataForDebbie() },
        fallback: { [unowned self] question in self.debbieFallback(question: question) })

    public init(network: @escaping () -> HomeService, demo: (() -> HomeService)?, demoMedia: (() -> LiveMediaEngine)?,
                heartbeatInterval: TimeInterval = 60, assistant: AssistantService? = nil) {
        self.makeNetworkService = network
        self.makeDemoService = demo
        self.demoMediaEngine = demoMedia
        self.service = network()
        self.mediaEngine = UnavailableMediaEngine()
        self.heartbeatInterval = heartbeatInterval
        self.assistant = assistant
        if let data = try? store.load(.homeConfig), let config = try? JSONDecoder.debbie.decode(HomeConfig.self, from: data) {
            homeName = config.homeName
            role = config.role
            phase = config.role == .resident ? .resident : .caregiver
        }
    }

    /// The home's answer to a question from the chat. The demo home has no Layer 4, so it answers on this iPhone from
    /// the same facts.
    func askHome(_ question: String) async throws -> String {
        if isDemo { return debbieFallback(question: question) }
        return try await service.ask(question)
    }

    public var demoAvailable: Bool { makeDemoService != nil }
    private var activeEngine: LiveMediaEngine?

    // MARK: Phases

    /// The resident's reading and send state belong to one home: the demo's never shows in a real pairing, and a real
    /// person's never shows in the demo (DEMO_HOME: never mixed).
    private func clearResidentState() {
        lastReading = nil; lastSent = nil; syncNote = nil; liveViewAllowed = false
    }

    /// One home's state, cleared whenever the home changes, so nothing of one home shows in the next. Without
    /// `lastRefresh = nil` the next home's first refresh counted its old urgent alerts as new arrivals and played the
    /// possible-fall haptic, and its status started as the old home's (the build-8 review, F3).
    private func resetHomeState() {
        homeGeneration += 1
        alerts = []; monitoring = nil; care = nil; seenAlertIDs = []
        lastRefresh = nil
        route = .internet
        status = HomeStatus(connection: .cantConnect, monitoring: .unknown(lastUpdate: nil), languageModel: .unknown)
    }

    public func startDemo() {
        guard let makeDemoService else { return }
        stopRefreshing()
        unpairNotice = nil
        clearResidentState()
        service = makeDemoService()
        resetHomeState()
        isDemo = true
        homeName = "Demo Home"
        phase = .onboarding
    }

    public func leaveDemo() {
        stopRefreshing()
        chat.reset()
        clearResidentState()
        isDemo = false
        service = makeNetworkService()
        resetHomeState()
        phase = .welcome
    }

    public func beginPairing(qr: PairingQR, name: String, role: Role) async throws -> PairingAttempt {
        self.role = role
        return try await service.startPairing(qr: qr, name: name, role: role)
    }

    public func paired(_ config: HomeConfig) {
        homeName = config.homeName
        role = config.role
        phase = config.role == .resident ? .resident : .caregiver
    }

    // MARK: Refresh (route chosen by the service; CRAFT.md §8 E8)

    /// Not while unpairing: coming back to the app mid-unpair would otherwise start refreshing the home being
    /// forgotten, and the loop would outlive the unpair (the build-8 review, F4).
    public func startRefreshing(every seconds: TimeInterval = 10) {
        guard !isUnpairing else { return }
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(seconds))
            }
        }
    }

    public func stopRefreshing() { refreshTask?.cancel(); refreshTask = nil }

    public func refresh() async {
        let generation = homeGeneration
        do {
            let snap = try await service.refresh()
            guard generation == homeGeneration else { return }   // the home changed while this was out
            let now = Date.now
            let newUrgent = snap.alerts.contains { $0.severity == .urgent && $0.acknowledgedAt == nil && !seenAlertIDs.contains($0.alertID) && lastRefresh != nil }
            seenAlertIDs.formUnion(snap.alerts.map(\.alertID))
            alerts = snap.alerts
            monitoring = snap.monitoring
            care = snap.care
            route = snap.route
            lastRefresh = now
            let connection: HomeStatus.Connection = snap.removed ? .removed
                : (snap.hubOnline ? .connected(lastContact: snap.hubLastContact ?? now) : .cantReachHome(lastContact: snap.hubLastContact))
            let lm: HomeStatus.LanguageModel = snap.monitoring.map { $0.languageModelAvailable ? .available : .unavailable } ?? .unknown
            status = HomeStatus(connection: connection,
                                monitoring: HomeStatus.monitoring(from: snap.monitoring, now: now, heartbeatInterval: heartbeatInterval),
                                languageModel: lm)
            if newUrgent { urgentArrivals += 1 }
        } catch HomeError.removed {
            guard generation == homeGeneration else { return }
            status = HomeStatus(connection: .removed, monitoring: .unknown(lastUpdate: monitoring?.sentAt), languageModel: .unknown)
        } catch {
            guard generation == homeGeneration else { return }
            status = HomeStatus(connection: .cantConnect, monitoring: .unknown(lastUpdate: monitoring?.sentAt), languageModel: status.languageModel)
        }
    }

    public func acknowledge(_ alert: HubAlert, falseAlarm: Bool) async {
        if let i = alerts.firstIndex(where: { $0.alertID == alert.alertID }) {
            alerts[i].acknowledgedAt = .now
            alerts[i].falseAlarm = falseAlarm
        }
        acknowledgements += 1
        do { try await service.acknowledge(alertID: alert.alertID, falseAlarm: falseAlarm) }
        catch { let reason = String(describing: error); log.notice("acknowledgement queued: \(reason, privacy: .public)") }
    }

    // MARK: Live view state machine

    public func startLiveView() {
        liveTask?.cancel()
        liveState = .requesting
        let engine = isDemo ? (demoMediaEngine?() ?? mediaEngine) : mediaEngine
        activeEngine = engine
        liveTask = Task { [weak self] in await self?.runLiveView(engine: engine) }
    }

    private func runLiveView(engine: LiveMediaEngine) async {
        do {
            let id = try await service.requestLiveView()
            liveSessionID = id
            let deadline = Date.now.addingTimeInterval(15)
            var session = try await service.liveViewSession(id)
            while session.state == "requested" && Date.now < deadline {
                try await Task.sleep(for: .seconds(1))
                session = try await service.liveViewSession(id)
            }
            switch session.state {
            case "denied": liveState = .denied; liveEvent = .denied(Int.random(in: 1...Int.max)); return
            case "ready": break
            default: liveState = .failed("The home camera didn't respond."); liveEvent = .lost(Int.random(in: 1...Int.max)); return
            }
            liveState = .ready
            liveState = .connecting
            try await engine.start(viewer: session.viewer)
            let endsAt = session.expiresAt ?? Date.now.addingTimeInterval(300)
            liveState = .playing(endsAt: endsAt)
            liveEvent = .started(Int.random(in: 1...Int.max))
            while !Task.isCancelled {
                try await Task.sleep(for: .seconds(1))
                if Date.now >= endsAt { await endLive(.timeLimit); return }
                if let s = try? await service.liveViewSession(id), s.state == "ended" {
                    let reason: LiveViewState.EndReason = s.reason == "resident_turned_off" ? .residentTurnedOff : (s.reason == "lost" ? .connectionLost : .timeLimit)
                    await endLive(reason); return
                }
            }
        } catch is CancellationError {
        } catch {
            engine.stop()
            liveState = .failed("Couldn't start live view. Try again in a minute.")
            liveEvent = .lost(Int.random(in: 1...Int.max))
        }
    }

    /// Stop calls the relay before tearing down (brief §5.1.5).
    public func stopLiveView(reason: LiveViewState.EndReason = .stoppedByYou) {
        liveTask?.cancel()
        Task { await endLive(reason) }
    }

    private func endLive(_ reason: LiveViewState.EndReason) async {
        liveState = .ending
        if let id = liveSessionID { await service.stopLiveView(id) }
        activeEngine?.stop()
        liveSessionID = nil
        liveState = .ended(reason)
        if reason == .residentTurnedOff { liveEvent = .endedByResident(Int.random(in: 1...Int.max)) }
        if reason == .connectionLost { liveEvent = .lost(Int.random(in: 1...Int.max)) }
    }

    public func resetLiveView() { liveTask?.cancel(); liveState = .idle }
    public var liveVideoView: AnyView { activeEngine?.videoView ?? AnyView(Color.clear) }

    // MARK: Add a laptop

    public func approveLaptop(_ join: JoinQR) async throws { try await service.approveLaptop(join) }

    // MARK: Resident (heart rate only over the LAN gateway)

    public func syncHeartRate(samples provided: [HeartSample]? = nil) async -> Bool {
        let samples: [HeartSample]
        if let provided { samples = provided } else { samples = await HeartRateReader.readSince(lastSent ?? Date.now.addingTimeInterval(-86_400)) }
        if let latest = samples.max(by: { $0.t < $1.t }) { lastReading = latest }
        guard !samples.isEmpty else { syncNote = "No heart readings yet"; return true }
        do {
            _ = try await service.sendHeartRate(samples)
            lastSent = .now
            syncNote = nil
            return true
        } catch {
            syncNote = "Will send when you're home." + (lastSent.map { " Last sent \($0.formatted(date: .omitted, time: .shortened))." } ?? "")
            return false
        }
    }

    public func setLiveViewAllowed(_ on: Bool) async {
        liveViewAllowed = on
        try? await service.setLiveViewAllowed(on)
    }

    // MARK: Settings

    /// Returns false if the home couldn't be told (the screen then says to remove it on the laptop).
    public func unpair() async -> Bool {
        guard !isUnpairing else { return true }
        isUnpairing = true
        defer { isUnpairing = false }
        stopRefreshing()
        let told = isDemo ? true : await service.unpair()
        stopRefreshing()
        store.deleteAll()
        chat.reset()
        clearResidentState()
        isDemo = false
        service = makeNetworkService()
        resetHomeState()
        // CRAFT §5 Unpair, the failure copy [research note 10 R13].
        unpairNotice = told ? nil : "This iPhone is unpaired. Debbie couldn't reach the home laptop, so it may still list this iPhone. On the laptop's setup page, under Phones, press Remove next to this iPhone."
        phase = .welcome
        return told
    }
}

/// Reads heart rate synced from the Watch (research note 11a R15–R16). Denied looks like no data.
public enum HeartRateReader {
    public static let store = HKHealthStore()

    public static func requestAccess() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        try? await store.requestAuthorization(toShare: [], read: [HKQuantityType(.heartRate)])
    }

    public static func readSince(_ start: Date) async -> [HeartSample] {
        guard HKHealthStore.isHealthDataAvailable() else { return [] }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate)
        let descriptor = HKSampleQueryDescriptor(predicates: [.quantitySample(type: HKQuantityType(.heartRate), predicate: predicate)],
                                                 sortDescriptors: [SortDescriptor(\.startDate)], limit: 500)
        guard let samples = try? await descriptor.result(for: store) else { return [] }
        let unit = HKUnit.count().unitDivided(by: .minute())
        return samples.map { HeartSample(t: $0.startDate, bpm: Int($0.quantity.doubleValue(for: unit).rounded())) }
    }
}
