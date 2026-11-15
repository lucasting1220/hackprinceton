import Foundation

// Exact wire formats from docs/CONTRACTS.md. Changing a field name here changes the contract.

/// Pairing QR code (CONTRACTS.md §2.1).
public struct PairingQR: Codable, Sendable, Equatable {
    public let v: Int
    public let addrs: [String]
    public let hubPub: String
    public let secret: String
    public let exp: Int
    enum CodingKeys: String, CodingKey { case v, addrs, hubPub = "hub_pub", secret, exp }

    public enum Problem: Error, Equatable, Sendable { case notDebbie, unsupportedVersion, expired, malformed, joinCode }

    /// Strict parse: Debbie v1 pairing QR, ≤ 1,024 bytes, valid key lengths, not expired.
    public static func parse(_ text: String, now: Date = .now) throws(Problem) -> PairingQR {
        guard text.utf8.count <= 1024, let data = text.data(using: .utf8) else { throw .notDebbie }
        if let any = try? JSONSerialization.jsonObject(with: data) as? [String: Any], (any["kind"] as? String) == "join" {
            throw .joinCode
        }
        guard let qr = try? JSONDecoder().decode(PairingQR.self, from: data) else { throw .notDebbie }
        guard qr.v == 1 else { throw .unsupportedVersion }
        guard Base64URL.decode(qr.hubPub)?.count == 32, Base64URL.decode(qr.secret)?.count == 16, !qr.addrs.isEmpty else { throw .malformed }
        guard Double(qr.exp) > now.timeIntervalSince1970 else { throw .expired }
        return qr
    }
}

/// Add-a-laptop QR code (CONTRACTS.md §6).
public struct JoinQR: Codable, Sendable, Equatable {
    public let v: Int
    public let kind: String
    public let joinID: String
    public let name: String
    public let laptopPub: String
    public let exp: Int
    enum CodingKeys: String, CodingKey { case v, kind, joinID = "join_id", name, laptopPub = "laptop_pub", exp }

    public static func parse(_ text: String, now: Date = .now) throws(PairingQR.Problem) -> JoinQR {
        guard let data = text.data(using: .utf8), let qr = try? JSONDecoder().decode(JoinQR.self, from: data), qr.kind == "join" else { throw .notDebbie }
        guard qr.v == 1 else { throw .unsupportedVersion }
        guard Base64URL.decode(qr.laptopPub)?.count == 32 else { throw .malformed }
        guard Double(qr.exp) > now.timeIntervalSince1970 else { throw .expired }
        return qr
    }
}

/// `POST /v1/pair` body (CONTRACTS.md §4.2).
public struct PairingRequest: Codable, Sendable {
    public let v: Int
    public let phonePub: String
    public let name: String
    public let role: Role
    public let proof: String
    enum CodingKeys: String, CodingKey { case v, phonePub = "phone_pub", name, role, proof }
    public init(phonePub: String, name: String, role: Role, proof: String) {
        self.v = 1; self.phonePub = phonePub; self.name = name; self.role = role; self.proof = proof
    }
}

/// Encrypted envelope (CONTRACTS.md §2.4).
public struct Envelope: Codable, Sendable, Equatable {
    public let v: Int
    public let kid: String
    public let n: String
    public let c: String
    public init(kid: String, n: String, c: String) { self.v = 1; self.kid = kid; self.n = n; self.c = c }
}

/// Pairing responses (CONTRACTS.md §4.2).
public struct PairingResponse: Codable, Sendable {
    public let v: Int?
    public let status: String?
    public let bundle: Envelope?
    public let error: WireError?
}

public struct WireError: Codable, Sendable, Equatable {
    public let code: String
    public let message: String?
}

/// Decrypted pairing bundle (CONTRACTS.md §4.2).
public struct PairingBundle: Codable, Sendable, Equatable {
    public let v: Int
    public let msgID: String
    public let sentAt: Date
    public let homeID: String
    public let deviceID: String
    public let role: Role
    public let deviceCredential: String
    public let relayURL: String
    public let homeKey: String?
    public let homeName: String
    public let lan: LAN
    public struct LAN: Codable, Sendable, Equatable { public let addrs: [String] }
    enum CodingKeys: String, CodingKey {
        case v, msgID = "msg_id", sentAt = "sent_at", homeID = "home_id", deviceID = "device_id", role
        case deviceCredential = "device_credential", relayURL = "relay_url", homeKey = "home_key", homeName = "home_name", lan
    }
    public init(msgID: String, sentAt: Date, homeID: String, deviceID: String, role: Role, deviceCredential: String,
                relayURL: String, homeKey: String?, homeName: String, lanAddrs: [String]) {
        self.v = 1; self.msgID = msgID; self.sentAt = sentAt; self.homeID = homeID; self.deviceID = deviceID; self.role = role
        self.deviceCredential = deviceCredential; self.relayURL = relayURL; self.homeKey = homeKey; self.homeName = homeName
        self.lan = LAN(addrs: lanAddrs)
    }
}

/// Routing wrapper around every encrypted message (CONTRACTS.md §3).
public struct Wrapper: Codable, Sendable, Equatable {
    public let v: Int
    public let msgID: String
    public let type: String
    public let to: String?
    public let collapseID: String?
    public let sentAt: Date
    public let envelope: Envelope
    enum CodingKeys: String, CodingKey { case v, msgID = "msg_id", type, to, collapseID = "collapse_id", sentAt = "sent_at", envelope }
    public init(msgID: String, type: String, to: String? = nil, collapseID: String? = nil, sentAt: Date, envelope: Envelope) {
        self.v = 1; self.msgID = msgID; self.type = type; self.to = to; self.collapseID = collapseID; self.sentAt = sentAt; self.envelope = envelope
    }
}

/// Live-view session resource (CONTRACTS.md §7).
public struct LiveViewSession: Codable, Sendable, Equatable {
    public struct ICEServer: Codable, Sendable, Equatable { public let urls: [String]; public let username: String?; public let credential: String? }
    public struct Viewer: Codable, Sendable, Equatable {
        public let signalingURL: String
        public let clientID: String
        public let iceServers: [ICEServer]
        enum CodingKeys: String, CodingKey { case signalingURL = "signaling_url", clientID = "client_id", iceServers = "ice_servers" }
    }
    public let sessionID: String
    public let state: String
    public let reason: String?
    public let expiresAt: Date?
    public let viewer: Viewer?
    enum CodingKeys: String, CodingKey { case sessionID = "session_id", state, reason, expiresAt = "expires_at", viewer }
    public init(sessionID: String, state: String, reason: String? = nil, expiresAt: Date? = nil, viewer: Viewer? = nil) {
        self.sessionID = sessionID; self.state = state; self.reason = reason; self.expiresAt = expiresAt; self.viewer = viewer
    }
}

public extension JSONEncoder {
    /// Debbie's wire encoder: ISO 8601 UTC dates, sorted keys, unescaped slashes.
    static var debbie: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }
}

public extension JSONDecoder {
    /// Debbie's wire decoder: ISO 8601 dates with or without fractional seconds.
    static var debbie: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let s = try decoder.singleValueContainer().decode(String.self)
            let f1 = ISO8601DateFormatter()
            let f2 = ISO8601DateFormatter(); f2.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = f1.date(from: s) ?? f2.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad date \(s)"))
        }
        return d
    }
}
