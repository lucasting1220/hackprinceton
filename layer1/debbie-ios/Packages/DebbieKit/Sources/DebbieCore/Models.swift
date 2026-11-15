import Foundation

// Wire models and domain types shared by every module. Field names follow docs/CONTRACTS.md.

/// base64url without padding (CONTRACTS.md §1); decoding accepts padding too.
public enum Base64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ string: String) -> Data? {
        var s = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        s = s.replacingOccurrences(of: "=", with: "")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }
}

public enum Role: String, Codable, Sendable, CaseIterable {
    case caregiver
    case resident
}

/// Alert tiers (CONTRACTS.md §3.1, D-008): anything unknown is shown as urgent.
public enum Severity: String, Codable, Sendable, Comparable {
    case info, attention, urgent

    public init(wire: String) { self = Severity(rawValue: wire) ?? .urgent }

    public init(from decoder: Decoder) throws {
        self = Severity(wire: try decoder.singleValueContainer().decode(String.self))
    }

    private var rank: Int { switch self { case .info: 0; case .attention: 1; case .urgent: 2 } }
    public static func < (a: Severity, b: Severity) -> Bool { a.rank < b.rank }
}

public enum AlertKind: String, Codable, Sendable {
    case fall, noMovement = "no_movement", sound, callForHelp = "call_for_help"
    case heartRateHigh = "heart_rate_high", heartRateLow = "heart_rate_low", checkIn = "check_in", other

    public init(from decoder: Decoder) throws {
        self = AlertKind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
    }
}

/// Layer 4's alert, as decrypted (Layer 1 doc, "Handoff to Layer 4").
public struct HubAlert: Codable, Sendable, Equatable, Identifiable {
    public var id: String { alertID }
    public let alertID: String
    public let kind: AlertKind
    public let severity: Severity
    public let detectedAt: Date
    public var title: String
    public var body: String
    public let update: Bool
    /// When this phone first received it (not on the wire).
    public var receivedAt: Date?
    public var acknowledgedAt: Date?
    public var falseAlarm: Bool = false

    enum CodingKeys: String, CodingKey {
        case alertID = "alert_id", kind, severity, detectedAt = "detected_at", title, body, update
        case receivedAt = "received_at", acknowledgedAt = "acknowledged_at", falseAlarm = "false_alarm"
    }

    public init(alertID: String, kind: AlertKind, severity: Severity, detectedAt: Date, title: String, body: String,
                update: Bool = false, receivedAt: Date? = nil) {
        self.alertID = alertID; self.kind = kind; self.severity = severity; self.detectedAt = detectedAt
        self.title = title; self.body = body; self.update = update; self.receivedAt = receivedAt
    }

    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        alertID = try c.decode(String.self, forKey: .alertID)
        kind = (try? c.decode(AlertKind.self, forKey: .kind)) ?? .other
        severity = (try? c.decode(Severity.self, forKey: .severity)) ?? .urgent
        detectedAt = try c.decode(Date.self, forKey: .detectedAt)
        title = try c.decode(String.self, forKey: .title)
        body = try c.decode(String.self, forKey: .body)
        update = (try? c.decode(Bool.self, forKey: .update)) ?? false
        receivedAt = try? c.decode(Date.self, forKey: .receivedAt)
        acknowledgedAt = try? c.decode(Date.self, forKey: .acknowledgedAt)
        falseAlarm = (try? c.decode(Bool.self, forKey: .falseAlarm)) ?? false
    }

    /// Late when it reached this phone 60 s or more after detection (CRAFT.md §6 V4).
    public var isLate: Bool { (receivedAt?.timeIntervalSince(detectedAt) ?? 0) >= 60 }
}

/// Monitoring health from the hub's heartbeat (CONTRACTS.md §3.2).
public struct MonitoringSnapshot: Codable, Sendable, Equatable {
    public enum SensorState: String, Codable, Sendable { case up, down, declined, none }
    public enum Detection: String, Codable, Sendable { case running, stopped, unplaced }
    public struct Laptop: Codable, Sendable, Equatable, Identifiable {
        public var id: String { nodeID }
        public let nodeID: String
        public let displayName: String
        public let reporting: Bool
        public let lastStatusAt: Date?
        enum CodingKeys: String, CodingKey { case nodeID = "node_id", displayName = "display_name", reporting, lastStatusAt = "last_status_at" }
        public init(nodeID: String, displayName: String, reporting: Bool, lastStatusAt: Date?) {
            self.nodeID = nodeID; self.displayName = displayName; self.reporting = reporting; self.lastStatusAt = lastStatusAt
        }
    }
    public let state: String
    public let laptops: [Laptop]
    public let camera: SensorState
    public let mic: SensorState
    public let fallDetection: Detection
    public let soundDetection: Detection
    public let languageModelAvailable: Bool
    public let sentAt: Date

    enum CodingKeys: String, CodingKey {
        case state, laptops, camera, mic, fallDetection = "fall_detection", soundDetection = "sound_detection"
        case languageModelAvailable = "language_model_available", sentAt = "sent_at"
    }

    public init(state: String, laptops: [Laptop], camera: SensorState, mic: SensorState, fallDetection: Detection,
                soundDetection: Detection, languageModelAvailable: Bool, sentAt: Date) {
        self.state = state; self.laptops = laptops; self.camera = camera; self.mic = mic
        self.fallDetection = fallDetection; self.soundDetection = soundDetection
        self.languageModelAvailable = languageModelAvailable; self.sentAt = sentAt
    }
}

/// Layer 4's care status (CONTRACTS.md §3.3).
public struct CareStatus: Codable, Sendable, Equatable {
    public enum Trend: String, Codable, Sendable { case steady, rising, falling }
    public let heartRateBPM: Int?
    public let heartRateAt: Date?
    public let trend: Trend?
    public let noHeartData: Bool
    public init(heartRateBPM: Int?, heartRateAt: Date?, trend: Trend?, noHeartData: Bool) {
        self.heartRateBPM = heartRateBPM; self.heartRateAt = heartRateAt; self.trend = trend; self.noHeartData = noHeartData
    }

    // Wire shape (CONTRACTS.md §3.3): {"heart_rate": {"bpm", "at", "trend"} | null, "no_heart_data", "no_heart_data_since"}.
    private enum CodingKeys: String, CodingKey { case heartRate = "heart_rate", noHeartData = "no_heart_data" }
    private struct Reading: Codable { let bpm: Int; let at: Date?; let trend: Trend? }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let r = try c.decodeIfPresent(Reading.self, forKey: .heartRate)
        heartRateBPM = r?.bpm; heartRateAt = r?.at; trend = r?.trend
        noHeartData = try c.decodeIfPresent(Bool.self, forKey: .noHeartData) ?? (r == nil)
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(heartRateBPM.map { Reading(bpm: $0, at: heartRateAt, trend: trend) }, forKey: .heartRate)
        try c.encode(noHeartData, forKey: .noHeartData)
    }
}

/// The three-row status header (CRAFT.md §5 StatusHeader, lead decision X54). Never an
/// unconfirmed all-clear: "on" needs a fresh heartbeat that says everything is running.
public struct HomeStatus: Sendable, Equatable {
    public enum Connection: Sendable, Equatable { case connected(lastContact: Date), cantReachHome(lastContact: Date?), cantConnect, removed }
    public enum Monitoring: Sendable, Equatable { case on(updated: Date), limited(reason: String, since: Date), unknown(lastUpdate: Date?) }
    public enum LanguageModel: Sendable, Equatable { case available, unavailable, unknown }
    public enum Headline: Sendable, Equatable { case removed, cantReachHome, cantConnect, monitoringUnknown, monitoringLimited, monitoringOn }

    public let connection: Connection
    public let monitoring: Monitoring
    public let languageModel: LanguageModel

    public init(connection: Connection, monitoring: Monitoring, languageModel: LanguageModel) {
        self.connection = connection; self.monitoring = monitoring; self.languageModel = languageModel
    }

    /// Worst row wins: removed > can't reach home > can't connect > unknown > limited > on.
    public var headline: Headline {
        switch connection {
        case .removed: return .removed
        case .cantReachHome: return .cantReachHome
        case .cantConnect: return .cantConnect
        case .connected: break
        }
        switch monitoring {
        case .unknown: return .monitoringUnknown
        case .limited: return .monitoringLimited
        case .on: return .monitoringOn
        }
    }

    /// Derives monitoring from the latest heartbeat. Stale (older than two intervals) → unknown.
    public static func monitoring(from snapshot: MonitoringSnapshot?, now: Date, heartbeatInterval: TimeInterval) -> Monitoring {
        guard let s = snapshot else { return .unknown(lastUpdate: nil) }
        if now.timeIntervalSince(s.sentAt) > 2 * heartbeatInterval { return .unknown(lastUpdate: s.sentAt) }
        if let down = s.laptops.first(where: { !$0.reporting }) {
            return .limited(reason: "\(down.displayName) not reporting", since: down.lastStatusAt ?? s.sentAt)
        }
        if s.camera == .down || s.mic == .down || s.fallDetection != .running || s.soundDetection != .running {
            return .limited(reason: s.fallDetection != .running ? "Fall detection isn't running" : "A sensor isn't working", since: s.sentAt)
        }
        return .on(updated: s.sentAt)
    }
}

/// Every live-view state the brief requires (§5.1.5, §6).
public enum LiveViewState: Equatable, Sendable {
    public enum EndReason: String, Sendable { case timeLimit, stoppedByYou, residentTurnedOff, connectionLost, leftApp }
    case idle
    case requesting
    case denied
    case ready
    case connecting
    case playing(endsAt: Date)
    case ending
    case ended(EndReason)
    case failed(String)
}

/// A screen's state with exactly one recovery action (CRAFT.md §8 E5).
public enum ScreenState<Value: Sendable>: Sendable {
    case loading
    case loaded(Value)
    case empty
    case failed(message: String, recovery: String)
}
