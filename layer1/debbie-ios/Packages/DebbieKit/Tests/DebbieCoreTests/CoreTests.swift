@testable import DebbieCore
import Foundation
import Testing

@Suite struct MonitoringStateTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func snap(age: TimeInterval, reporting: Bool = true, fall: MonitoringSnapshot.Detection = .running) -> MonitoringSnapshot {
        MonitoringSnapshot(state: "ok", laptops: [.init(nodeID: "n1", displayName: "Kitchen laptop", reporting: reporting, lastStatusAt: now)],
                           camera: .up, mic: .up, fallDetection: fall, soundDetection: .running, languageModelAvailable: true, sentAt: now.addingTimeInterval(-age))
    }
    @Test func freshHealthyHeartbeatIsOn() { #expect(HomeStatus.monitoring(from: snap(age: 30), now: now, heartbeatInterval: 60) == .on(updated: now.addingTimeInterval(-30))) }
    @Test func staleHeartbeatIsUnknownNeverOn() {
        if case .unknown = HomeStatus.monitoring(from: snap(age: 121), now: now, heartbeatInterval: 60) {} else { Issue.record("stale heartbeat must be unknown") }
        if case .unknown = HomeStatus.monitoring(from: nil, now: now, heartbeatInterval: 60) {} else { Issue.record("no heartbeat must be unknown") }
    }
    @Test func silentLaptopOrStoppedDetectionIsLimited() {
        if case .limited = HomeStatus.monitoring(from: snap(age: 10, reporting: false), now: now, heartbeatInterval: 60) {} else { Issue.record("silent laptop") }
        if case .limited = HomeStatus.monitoring(from: snap(age: 10, fall: .stopped), now: now, heartbeatInterval: 60) {} else { Issue.record("stopped detection") }
    }
    @Test func headlinePrecedence() {
        let removed = HomeStatus(connection: .removed, monitoring: .on(updated: now), languageModel: .available)
        #expect(removed.headline == .removed)
        let offline = HomeStatus(connection: .cantReachHome(lastContact: now), monitoring: .on(updated: now), languageModel: .available)
        #expect(offline.headline == .cantReachHome)
    }
    @Test func unknownSeverityIsUrgent() throws {
        let json = #"{"alert_id":"a","kind":"weird","severity":"panic","detected_at":"2026-11-14T15:12:03Z","title":"t","body":"b","update":false}"#
        let a = try JSONDecoder.debbie.decode(HubAlert.self, from: Data(json.utf8))
        #expect(a.severity == .urgent)
        #expect(a.kind == .other)
    }
    @Test func qrParsing() {
        let ok = #"{"v":1,"addrs":["192.168.1.20:7480"],"hub_pub":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8","secret":"AAECAwQFBgcICQoLDA0ODw","exp":4102444800}"#
        #expect((try? PairingQR.parse(ok)) != nil)
        let expired = ok.replacingOccurrences(of: "4102444800", with: "1000")
        #expect(throws: PairingQR.Problem.expired) { _ = try PairingQR.parse(expired) }
        #expect(throws: PairingQR.Problem.notDebbie) { _ = try PairingQR.parse("hello") }
    }
}

@Suite struct CareStatusWireTests {
    @Test func decodesTheContractExample() throws {
        let json = #"{"heart_rate": {"bpm": 72, "at": "2026-11-14T15:05:00Z", "trend": "steady"}, "no_heart_data": false, "no_heart_data_since": null}"#
        let s = try JSONDecoder.debbie.decode(CareStatus.self, from: Data(json.utf8))
        #expect(s.heartRateBPM == 72 && s.trend == .steady && s.noHeartData == false && s.heartRateAt != nil)
    }
    @Test func nullHeartRateMeansNoData() throws {
        let s = try JSONDecoder.debbie.decode(CareStatus.self, from: Data(#"{"heart_rate": null}"#.utf8))
        #expect(s.heartRateBPM == nil && s.noHeartData)
    }
}
