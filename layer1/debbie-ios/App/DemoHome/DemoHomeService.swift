#if DEBBIE_DEMO_HOME
import DebbieCore
import DebbieNetworking
import DebbieSecureStore
import Foundation
import os

/// The on-device demo home (DEMO_HOME.md; brief §6): runs entirely on the phone, no network, sample data only,
/// never mixed with a real pairing. Removed by deleting one xcconfig line (DEBBIE_DEMO_HOME).
final class DemoHomeService: HomeService, @unchecked Sendable {
    // @unchecked: all mutable state lives behind `lock`.
    private struct State {
        var started = Date.now
        var alerts: [HubAlert] = []
        var liveRequests = 0
        var sessions: [String: (created: Date, outcome: String)] = [:]
        var liveAllowed = true
    }
    private let lock = OSAllocatedUnfairLock(initialState: State())

    func startPairing(qr: PairingQR, name: String, role: Role) async throws -> PairingAttempt {
        // The demo "laptop" confirms after 5 s: long enough to read and compare the four digits.
        PairingAttempt(code: "4719") {
            try await Task.sleep(for: .seconds(5))
            return HomeConfig(homeID: "demo-home", deviceID: "demo-device", role: role, homeName: "Demo Home",
                              relayURL: "https://demo.invalid", lanAddrs: [], hubPub: qr.hubPub, pairedAt: .now)
        }
    }

    func refresh() async throws -> HomeSnapshot {
        let now = Date.now
        return lock.withLock { s in
            let elapsed = now.timeIntervalSince(s.started)
            if elapsed > 6, !s.alerts.contains(where: { $0.alertID == "demo-fall" }) {
                s.alerts.insert(HubAlert(alertID: "demo-fall", kind: .fall, severity: .urgent, detectedAt: now.addingTimeInterval(-20),
                                         title: "Possible fall (demo)", body: "Sample data: Debbie asked \"Are you okay?\" in the living room and heard no answer.",
                                         receivedAt: now), at: 0)
            }
            if elapsed > 4, !s.alerts.contains(where: { $0.alertID == "demo-late" }) {
                s.alerts.append(HubAlert(alertID: "demo-late", kind: .noMovement, severity: .attention, detectedAt: now.addingTimeInterval(-14 * 60),
                                         title: "No movement noticed (demo)", body: "Sample data: no movement in the kitchen for 2 hours.",
                                         receivedAt: now))
            }
            let degraded = (60..<90).contains(elapsed)
            let laptops = [MonitoringSnapshot.Laptop(nodeID: "n1", displayName: "Kitchen laptop", reporting: !degraded, lastStatusAt: now.addingTimeInterval(degraded ? -40 : -2)),
                           MonitoringSnapshot.Laptop(nodeID: "n2", displayName: "Living room laptop", reporting: true, lastStatusAt: now.addingTimeInterval(-2))]
            let m = MonitoringSnapshot(state: degraded ? "degraded" : "ok", laptops: laptops, camera: .up, mic: .up, fallDetection: .running,
                                       soundDetection: .running, languageModelAvailable: true, sentAt: now.addingTimeInterval(-5))
            let care = CareStatus(heartRateBPM: 72, heartRateAt: now.addingTimeInterval(-300), trend: .steady, noHeartData: false)
            return HomeSnapshot(alerts: s.alerts, monitoring: m, care: care, hubOnline: true, hubLastContact: now.addingTimeInterval(-5), removed: false, route: .demo)
        }
    }

    func acknowledge(alertID: String, falseAlarm: Bool) async throws {
        lock.withLock { s in
            if let i = s.alerts.firstIndex(where: { $0.alertID == alertID }) { s.alerts[i].acknowledgedAt = .now; s.alerts[i].falseAlarm = falseAlarm }
        }
    }

    /// For the presentation every request plays until you stop it or the time limit ends it (owner, 17:40: the
    /// precautions slowed the demo). The other outcomes ("resident", "denied", "lost") stay in the code below.
    func requestLiveView() async throws -> String {
        let id = UUID().uuidString
        lock.withLock { s in
            s.liveRequests += 1
            s.sessions[id] = (Date.now, "normal")
        }
        return id
    }

    func liveViewSession(_ id: String) async throws -> LiveViewSession {
        let (created, outcome) = lock.withLock { $0.sessions[id] ?? (Date.now, "normal") }
        let age = Date.now.timeIntervalSince(created)
        func make(_ state: String, _ reason: String? = nil) -> LiveViewSession {
            LiveViewSession(sessionID: id, state: state, reason: reason, expiresAt: created.addingTimeInterval(300))
        }
        if age < 1.5 { return make("requested") }
        switch outcome {
        case "denied": return make("denied", "live_view_off")
        case "resident" where age > 22: return make("ended", "resident_turned_off")
        case "lost" where age > 12: return make("ended", "lost")
        default: return make("ready")
        }
    }

    func stopLiveView(_ id: String) async { _ = lock.withLock { $0.sessions.removeValue(forKey: id) } }
    func approveLaptop(_ join: JoinQR) async throws { try await Task.sleep(for: .seconds(1)) }
    func sendHeartRate(_ samples: [HeartSample]) async throws -> Int { try await Task.sleep(for: .milliseconds(600)); return samples.count }
    func setLiveViewAllowed(_ allowed: Bool) async throws { lock.withLock { $0.liveAllowed = allowed } }
    func unpair() async -> Bool { true }
}
#endif
