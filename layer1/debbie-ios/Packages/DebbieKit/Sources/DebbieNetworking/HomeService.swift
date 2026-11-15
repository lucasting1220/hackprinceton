import CryptoKit
import DebbieCore
import DebbieCrypto
import DebbieSecureStore
import Foundation
import os

/// Everything the app asks of a home. Implemented by `NetworkHomeService` (LAN gateway + relay) and by the
/// on-device demo home (App/DemoHome, DEMO_HOME.md). Features depend only on this protocol.
public protocol HomeService: Sendable {
    func startPairing(qr: PairingQR, name: String, role: Role) async throws -> PairingAttempt
    func refresh() async throws -> HomeSnapshot
    func acknowledge(alertID: String, falseAlarm: Bool) async throws
    func requestLiveView() async throws -> String
    func liveViewSession(_ id: String) async throws -> LiveViewSession
    func stopLiveView(_ id: String) async
    func approveLaptop(_ join: JoinQR) async throws
    func sendHeartRate(_ samples: [HeartSample]) async throws -> Int
    func setLiveViewAllowed(_ allowed: Bool) async throws
    /// Tells the hub, revokes at the relay, then wipes. Returns false if the home couldn't be told.
    func unpair() async -> Bool
    /// Asks the home a question (`request` with kind `ask`) and returns the body of Layer 4's `reply`, which the home
    /// writes with its own Ollama model.
    func ask(_ question: String) async throws -> String
}

public extension HomeService {
    /// A home without Layer 4 (the demo, test doubles) can't answer a question.
    func ask(_ question: String) async throws -> String { throw AssistantError.notConfigured }
}

public struct HeartSample: Codable, Sendable, Equatable { public let t: Date; public let bpm: Int
    public init(t: Date, bpm: Int) { self.t = t; self.bpm = bpm } }

/// A pairing in progress: the code to compare, and a wait for the laptop's Confirm.
public struct PairingAttempt: Sendable {
    public let code: String
    public let waitForConfirmation: @Sendable () async throws -> HomeConfig
    public init(code: String, waitForConfirmation: @escaping @Sendable () async throws -> HomeConfig) {
        self.code = code; self.waitForConfirmation = waitForConfirmation
    }
}

public struct HomeSnapshot: Sendable, Equatable {
    public var alerts: [HubAlert]
    public var monitoring: MonitoringSnapshot?
    public var care: CareStatus?
    public var hubOnline: Bool
    public var hubLastContact: Date?
    public var removed: Bool
    public var route: Route
    public init(alerts: [HubAlert], monitoring: MonitoringSnapshot?, care: CareStatus?, hubOnline: Bool, hubLastContact: Date?, removed: Bool, route: Route) {
        self.alerts = alerts; self.monitoring = monitoring; self.care = care; self.hubOnline = hubOnline
        self.hubLastContact = hubLastContact; self.removed = removed; self.route = route
    }
}

public enum Route: String, Sendable { case homeWiFi, internet, demo }

public enum HomeError: Error, Equatable, Sendable {
    case expiredCode, usedCode, declined, inProgress, wrongNetwork, localNetworkOff, badProof, removed
    case cantReachHome, forbiddenRoute, notPaired, denied, server(String)
}

/// Plain HTTP only to loopback, RFC 1918, link-local or `.local` hosts; the relay must be HTTPS in Release
/// (brief §6; lead decision X56). `TransportPolicyTests` prove it.
public enum TransportPolicy {
    public static func allows(_ url: URL, isRelay: Bool, isDebug: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return false }
        if scheme == "https" { return true }
        guard scheme == "http" else { return false }
        if isRelay && !isDebug { return false }
        if host == "localhost" || host.hasSuffix(".local") { return true }
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else { return false }
        switch (parts[0], parts[1]) {
        case (127, _), (10, _), (192, 168), (169, 254): return true
        case (172, 16...31): return true
        default: return false
        }
    }
}

/// The real transport: LAN gateway on home Wi-Fi, otherwise the relay (CONTRACTS.md §4–§5).
public final class NetworkHomeService: HomeService, @unchecked Sendable {
    // @unchecked: mutable state is confined to `lock`; URLSession is thread-safe.
    public enum Mode: String, Sendable { case auto, lan, relay, mock }

    private let store: any PairingStore
    /// The LAN gateway's session never waits for connectivity; the relay's waits, but only for a while (D-036).
    private let lanSession: URLSession
    private let relaySession: URLSession
    private let mode: Mode
    private let isDebug: Bool
    private let lock = OSAllocatedUnfairLock(initialState: State())
    private let log = Logger(subsystem: "app.debbie", category: "network")

    private struct State { var cursor: String?; var seen: [String] = []; var alerts: [String: HubAlert] = [:]
        var monitoring: MonitoringSnapshot?; var care: CareStatus?; var lastRediscovery: Date?
        /// Layer 4's answers by `request_id`, until `ask` takes them.
        var replies: [String: String] = [:] }

    /// A `reply` from the hub: Layer 4's answer to one of this phone's requests (phone-hub.md §3).
    private struct Reply: Decodable { let requestID: String; let body: String
        enum CodingKeys: String, CodingKey { case requestID = "request_id", body } }

    public init(store: any PairingStore = SecureStore(), mode: Mode = .auto, isDebug: Bool = false,
                lanSession: URLSession? = nil, relaySession: URLSession? = nil) {
        self.store = store; self.mode = mode; self.isDebug = isDebug
        self.lanSession = lanSession ?? URLSession(configuration: Self.lanSessionConfiguration())
        self.relaySession = relaySession ?? URLSession(configuration: Self.relaySessionConfiguration())
    }

    // MARK: Pairing (CONTRACTS.md §4.2)

    public func startPairing(qr: PairingQR, name: String, role: Role) async throws -> PairingAttempt {
        guard let secret = Base64URL.decode(qr.secret) else { throw HomeError.badProof }
        let hubPub = try ContractCrypto.publicKey(fromBase64URL: qr.hubPub)
        let priv = ContractCrypto.newPrivateKey()
        let shared = try ContractCrypto.sharedSecret(priv, hubPub)
        let phonePub = priv.publicKey.rawRepresentation
        let request = PairingRequest(phonePub: Base64URL.encode(phonePub), name: name, role: role,
                                     proof: Base64URL.encode(ContractCrypto.proof(secret: secret, phonePublic: phonePub, role: role, name: name)))
        let body = try JSONEncoder.debbie.encode(request)
        let addrs = Self.mockLAN.map { mockActive ? [$0] : qr.addrs } ?? qr.addrs
        let code = ContractCrypto.pairingCode(shared: shared, secret: secret)
        let phoneKey = ContractCrypto.phoneKey(shared: shared, secret: secret)
        // First send: the laptop shows its code once the proof checks out.
        _ = try await postPairing(addrs: addrs, body: body)
        let store = self.store
        let wait: @Sendable () async throws -> HomeConfig = { [self] in
            while true {
                let response = try await self.postPairing(addrs: addrs, body: body)
                if response.status == "confirmed", let env = response.bundle {
                    let plain = try ContractCrypto.open(env, key: phoneKey, homeID: nil, type: "pair")
                    let bundle = try JSONDecoder.debbie.decode(PairingBundle.self, from: plain)
                    let config = HomeConfig(homeID: bundle.homeID, deviceID: bundle.deviceID, role: bundle.role, homeName: bundle.homeName,
                                            relayURL: bundle.relayURL, lanAddrs: bundle.lan.addrs, hubPub: qr.hubPub, pairedAt: .now)
                    try store.save(priv.rawRepresentation, as: .phonePrivateKey)
                    try store.save(phoneKey.rawData, as: .phoneKey)
                    try store.save(Data(bundle.deviceCredential.utf8), as: .deviceCredential)
                    if let hk = bundle.homeKey, let raw = Base64URL.decode(hk) { try store.save(raw, as: .homeKey) }
                    try store.save(try JSONEncoder.debbie.encode(config), as: .homeConfig)
                    return config
                }
                try await Task.sleep(for: .seconds(2) + .milliseconds(Int.random(in: 0...500)))
            }
        }
        return PairingAttempt(code: code, waitForConfirmation: wait)
    }

    private func postPairing(addrs: [String], body: Data) async throws -> PairingResponse {
        var lastError: Error = HomeError.wrongNetwork
        for addr in addrs {
            guard let url = URL(string: "http://\(addr)/v1/pair"), TransportPolicy.allows(url, isRelay: false, isDebug: isDebug) else { continue }
            var req = URLRequest(url: url, timeoutInterval: 3)
            req.httpMethod = "POST"; req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                let (data, resp) = try await lanSession.data(for: req)
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let decoded = (try? JSONDecoder.debbie.decode(PairingResponse.self, from: data))
                switch (status, decoded?.error?.code) {
                case (200, _), (202, _): if let decoded { return decoded }
                case (_, "expired"): throw HomeError.expiredCode
                case (_, "declined"): throw HomeError.declined
                case (_, "in_progress"): throw HomeError.inProgress
                case (_, "bad_proof"): throw HomeError.badProof
                default: throw HomeError.server("pair \(status)")
                }
            } catch let e as HomeError { throw e } catch { lastError = error }
        }
        throw (lastError as? HomeError) ?? HomeError.wrongNetwork
    }

    // MARK: Messages

    private func config() throws -> HomeConfig {
        guard let data = try? store.load(.homeConfig) else { throw HomeError.notPaired }
        return try JSONDecoder.debbie.decode(HomeConfig.self, from: data)
    }
    private func key(_ account: SecureStore.Account) throws -> SymmetricKey {
        guard let d = try? store.load(account) else { throw HomeError.notPaired }
        return SymmetricKey(data: d)
    }

    private func relayBase(_ c: HomeConfig) -> String { mockActive ? (Self.mockRelay ?? c.relayURL) : c.relayURL }
    private func lanBase(_ c: HomeConfig) -> String? {
        c.lanAddrs.first.map { "http://\($0)" } ?? (mockActive ? Self.mockLAN.map { "http://\($0)" } : nil)
    }

    // The mock home (docs/MOCK_HOME.md) exists only in Debug builds: in Release these are nil and
    // `mockActive` is false, so no mock address is compiled in (checked by tools/ci/check-release-clean.sh).
    #if DEBUG
    /// 7570 unless `DEBBIE_MOCK_PORT_BASE` moves the mock (as MockHome/server.mjs reads it): the LAN gateway is 10 above
    /// the base, the relay 11. Never the real bridge's 7470 and 7480, so the two can run on one Mac (the build-8 review).
    private static let mockPortBase = Int(ProcessInfo.processInfo.environment["DEBBIE_MOCK_PORT_BASE"] ?? "") ?? 7570
    private static let mockLAN: String? = "127.0.0.1:\(mockPortBase + 10)"
    private static let mockRelay: String? = "http://127.0.0.1:\(mockPortBase + 11)"
    private var mockActive: Bool { mode == .mock }
    #else
    private static let mockLAN: String? = nil
    private static let mockRelay: String? = nil
    private var mockActive: Bool { false }
    #endif

    private func relayRequest(_ path: String, method: String = "GET", body: Data? = nil) async throws -> (Data, Int) {
        let c = try config()
        guard let url = URL(string: relayBase(c) + path), TransportPolicy.allows(url, isRelay: true, isDebug: isDebug) else { throw HomeError.forbiddenRoute }
        var req = URLRequest(url: url)
        req.httpMethod = method; req.httpBody = body
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(c.deviceID, forHTTPHeaderField: "X-Debbie-Device")
        if let cred = try? store.load(.deviceCredential) { req.setValue("Bearer \(String(decoding: cred, as: UTF8.self))", forHTTPHeaderField: "Authorization") }
        let (data, resp) = try await relaySession.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if Self.isDeviceRemoved(status: status, body: data) { throw HomeError.removed }
        return (data, status)
    }

    /// The relay's answer for a revoked iPhone: `401 {"v":1,"error":{"code":"device_removed",…}}` (CONTRACTS.md §1;
    /// the relay answers `unauthorized` for a phone it doesn't know). Read through a wrapper: decoding the whole body as
    /// `[String: WireError]` failed on its `"v":1`, so "removed" was never recognised on the relay route (the build-8
    /// review, F1).
    static func isDeviceRemoved(status: Int, body: Data) -> Bool {
        struct Reply: Decodable { let error: WireError? }
        return status == 401 && (try? JSONDecoder.debbie.decode(Reply.self, from: body))?.error?.code == "device_removed"
    }

    /// `GET /v1/hello` answered as this home's gateway: a 200 carrying this home's tag, the first 8 characters of its
    /// `hub_pub` (phone-hub.md §4.1). Another home's gateway at the same address doesn't count, so its "unknown phone"
    /// can never read as "removed", and an unpair is never counted as told by the wrong home (the build-8 review, F5).
    static func helloIsThisHome(status: Int, body: Data, hubPub: String) -> Bool {
        struct Hello: Decodable { let hub: String? }
        guard status == 200, let tag = (try? JSONDecoder.debbie.decode(Hello.self, from: body))?.hub else { return false }
        return !tag.isEmpty && tag == String(hubPub.prefix(8))
    }

    private func lanRequest(_ path: String, type: String, plaintext: [String: Any], base override: String? = nil) async throws -> (Data, Int) {
        let c = try config()
        guard let base = override ?? lanBase(c), let url = URL(string: base + path), TransportPolicy.allows(url, isRelay: false, isDebug: isDebug) else { throw HomeError.forbiddenRoute }
        var payload = plaintext
        let msgID = UUID().uuidString.lowercased()
        payload["msg_id"] = msgID; payload["sent_at"] = ISO8601DateFormatter().string(from: .now); payload["type"] = type
        let env = try ContractCrypto.seal(try JSONSerialization.data(withJSONObject: payload), key: try key(.phoneKey), kid: c.deviceID, homeID: c.homeID, type: type)
        let wrapper = Wrapper(msgID: msgID, type: type, sentAt: .now, envelope: env)
        var req = URLRequest(url: url, timeoutInterval: 3)
        req.httpMethod = "POST"; req.httpBody = try JSONEncoder.debbie.encode(wrapper)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, resp) = try await lanSession.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 403 { throw HomeError.removed }
        return (data, status)
    }

    private struct MessagesPage: Decodable { let messages: [Wrapper]; let next: String?; let hub: Hub?
        struct Hub: Decodable { let online: Bool; let lastContactAt: Date?; enum CodingKeys: String, CodingKey { case online, lastContactAt = "last_contact_at" } } }
    /// `GET /v1/home`: `{v, home_id, hub: {online, last_contact_at}, push}`; only the hub is read.
    private struct HomeBody: Decodable { let hub: MessagesPage.Hub }
    /// Every refusal, from the relay or the LAN gateway: `{"v":1,"error":{"code":"…","message":"…"}}`.
    private struct ErrorBody: Decodable { let error: WireError }
    private static func errorCode(_ data: Data) -> String? { (try? JSONDecoder.debbie.decode(ErrorBody.self, from: data))?.error.code }

    /// A refused fetch becomes a typed error carrying the route, status and error code, logged without the request.
    private func refused(_ route: String, status: Int, body: Data) -> HomeError {
        let code = Self.errorCode(body) ?? "none"
        log.error("messages refused by the \(route, privacy: .public): status \(status, privacy: .public), code \(code, privacy: .public)")
        return .server("\(route) \(status) \(code)")
    }

    private func useLAN(_ c: HomeConfig, rediscover: Bool = true) async -> Bool {
        switch mode {
        case .lan: return true
        case .relay: return false
        case .auto, .mock:
            if let base = lanBase(c), let url = URL(string: base + "/v1/hello") {
                var req = URLRequest(url: url, timeoutInterval: 1.5)
                req.httpMethod = "GET"
                if let (data, resp) = try? await lanSession.data(for: req),
                   Self.helloIsThisHome(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, body: data, hubPub: c.hubPub) { return true }
            }
            return rediscover ? await rediscoverLAN(c) != nil : false
        }
    }

    /// The stored LAN address stopped answering: find the gateway again by Bonjour, accept a candidate only if it
    /// answers a request encrypted with this phone's own key, then store the new address (brief §6). At most one
    /// attempt every 15 s, so being away from home costs nothing noticeable.
    private func rediscoverLAN(_ c: HomeConfig) async -> String? {
        let now = Date.now
        let due = lock.withLock { s -> Bool in
            if let last = s.lastRediscovery, now.timeIntervalSince(last) < 15 { return false }
            s.lastRediscovery = now
            return true
        }
        guard due else { return nil }
        for addr in await BonjourLookup.find(type: "_debbie._tcp", hubTag: String(c.hubPub.prefix(8))) where !c.lanAddrs.prefix(1).contains(addr) {
            guard let (_, status) = try? await lanRequest("/v1/lan/messages", type: "fetch", plaintext: ["after": NSNull(), "limit": 1], base: "http://\(addr)"),
                  status == 200 else { continue }
            var updated = c
            updated.lanAddrs = [addr] + c.lanAddrs.filter { $0 != addr }
            if let data = try? JSONEncoder.debbie.encode(updated) { try? store.save(data, as: .homeConfig) }
            log.notice("LAN gateway found again by Bonjour")
            return addr
        }
        return nil
    }

    public func refresh() async throws -> HomeSnapshot {
        let c = try config()
        let homeKey = try? key(.homeKey)
        let phoneKey = try? key(.phoneKey)
        let lan = await useLAN(c) || c.role == .resident   // residents have no relay messages to read
        let cursor = lock.withLock { $0.cursor }
        let (data, status): (Data, Int)
        if lan {
            (data, status) = try await lanRequest("/v1/lan/messages", type: "fetch", plaintext: ["after": cursor as Any? ?? NSNull(), "limit": 50])
        } else {
            (data, status) = try await relayRequest("/v1/messages?limit=50" + (cursor.map { "&after=\($0)" } ?? ""))
        }
        guard (200..<300).contains(status) else { throw refused(lan ? "lan" : "relay", status: status, body: data) }
        let page = try JSONDecoder.debbie.decode(MessagesPage.self, from: data)
        var online = page.hub?.online ?? true, last = page.hub?.lastContactAt
        if !lan, let (d, s) = try? await relayRequest("/v1/home"), s == 200,
           let home = try? JSONDecoder.debbie.decode(HomeBody.self, from: d).hub { online = home.online; last = home.lastContactAt }
        for w in page.messages {
            guard lock.withLock({ !$0.seen.contains(w.msgID) }) else { continue }
            lock.withLock { $0.seen.append(w.msgID); if $0.seen.count > 1000 { $0.seen.removeFirst() } }
            // A message for this phone alone (`reply`) is sealed with its own key, kid its device ID; the rest with the home key.
            let forThisPhone = w.envelope.kid == c.deviceID && w.to == c.deviceID
            guard let openKey = forThisPhone ? phoneKey : homeKey,
                  let plain = try? ContractCrypto.open(w.envelope, key: openKey, homeID: c.homeID, type: w.type) else {
                log.notice("dropped a message that didn't decrypt (type \(w.type, privacy: .public))"); continue
            }
            switch w.type {
            case "alert":
                if let decoded = try? JSONDecoder.debbie.decode(HubAlert.self, from: plain) {
                    let now = Date.now
                    lock.withLock { s in
                        var a = decoded
                        if let old = s.alerts[a.alertID] { a.acknowledgedAt = old.acknowledgedAt; a.falseAlarm = old.falseAlarm; a.receivedAt = old.receivedAt }
                        else { a.receivedAt = now }
                        s.alerts[a.alertID] = a
                    }
                }
            case "heartbeat", "monitoring": if let m = try? JSONDecoder.debbie.decode(MonitoringSnapshot.self, from: plain) { lock.withLock { $0.monitoring = m } }
            case "care_status": if let cs = try? JSONDecoder.debbie.decode(CareStatus.self, from: plain) { lock.withLock { $0.care = cs } }
            case "reply" where forThisPhone:
                if let r = try? JSONDecoder.debbie.decode(Reply.self, from: plain) { lock.withLock { $0.replies[r.requestID] = r.body } }
            default: break
            }
        }
        let next = page.next
        lock.withLock { $0.cursor = next ?? $0.cursor }
        let hubOnline = online, hubLast = last, route: Route = lan ? .homeWiFi : .internet
        return lock.withLock { s in
            HomeSnapshot(alerts: s.alerts.values.sorted { $0.detectedAt > $1.detectedAt }, monitoring: s.monitoring, care: s.care,
                         hubOnline: hubOnline, hubLastContact: hubLast, removed: false, route: route)
        }
    }

    private func command(_ type: String, _ fields: [String: Any], rediscover: Bool = true) async throws {
        let c = try config()
        if await useLAN(c, rediscover: rediscover) {
            let (_, s) = try await lanRequest("/v1/lan/commands", type: type, plaintext: fields)
            if (200..<300).contains(s) { return }
        }
        var payload = fields
        let msgID = UUID().uuidString.lowercased()
        payload["msg_id"] = msgID; payload["sent_at"] = ISO8601DateFormatter().string(from: .now); payload["type"] = type
        let env = try ContractCrypto.seal(try JSONSerialization.data(withJSONObject: payload), key: try key(.phoneKey), kid: c.deviceID, homeID: c.homeID, type: type)
        let (_, s) = try await relayRequest("/v1/commands", method: "POST", body: try JSONEncoder.debbie.encode(Wrapper(msgID: msgID, type: type, sentAt: .now, envelope: env)))
        guard (200..<300).contains(s) else { throw HomeError.cantReachHome }
    }

    public func acknowledge(alertID: String, falseAlarm: Bool) async throws {
        lock.withLock { s in s.alerts[alertID]?.acknowledgedAt = .now; s.alerts[alertID]?.falseAlarm = falseAlarm }
        try await command("ack", ["alert_id": alertID, "acked_at": ISO8601DateFormatter().string(from: .now), "false_alarm": falseAlarm])
    }

    public func requestLiveView() async throws -> String {
        let c = try config()
        let msgID = UUID().uuidString.lowercased()
        let plain: [String: Any] = ["msg_id": msgID, "sent_at": ISO8601DateFormatter().string(from: .now), "type": "live_view_request",
                                    "request_id": UUID().uuidString.lowercased(), "viewer_client_id": UUID().uuidString.lowercased()]
        let env = try ContractCrypto.seal(try JSONSerialization.data(withJSONObject: plain), key: try key(.phoneKey), kid: c.deviceID, homeID: c.homeID, type: "live_view_request")
        let (data, _) = try await relayRequest("/v1/live-view/sessions", method: "POST", body: try JSONEncoder.debbie.encode(Wrapper(msgID: msgID, type: "live_view_request", sentAt: .now, envelope: env)))
        guard let id = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["session_id"] as? String else { throw HomeError.cantReachHome }
        return id
    }

    public func liveViewSession(_ id: String) async throws -> LiveViewSession {
        try JSONDecoder.debbie.decode(LiveViewSession.self, from: try await relayRequest("/v1/live-view/sessions/\(id)").0)
    }

    public func stopLiveView(_ id: String) async { _ = try? await relayRequest("/v1/live-view/sessions/\(id)", method: "DELETE") }

    public func approveLaptop(_ join: JoinQR) async throws {
        try await command("laptop_approval", ["join_id": join.joinID, "laptop_pub": join.laptopPub, "name": join.name, "approve": true])
    }

    /// Heart rate goes only to the LAN gateway, never the relay (brief §5.1.7).
    public func sendHeartRate(_ samples: [HeartSample]) async throws -> Int {
        let c = try config()
        guard await useLAN(c) else { throw HomeError.forbiddenRoute }
        let rows: [[String: Any]] = samples.map { ["t": ISO8601DateFormatter().string(from: $0.t), "bpm": $0.bpm] }
        let (data, s) = try await lanRequest("/v1/lan/heart-rate", type: "heart_rate", plaintext: ["samples": rows])
        guard (200..<300).contains(s) else { throw HomeError.cantReachHome }
        return ((try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["accepted"] as? Int) ?? samples.count
    }

    public func setLiveViewAllowed(_ allowed: Bool) async throws { try await command("live_view_setting", ["enabled": allowed]) }

    /// How long `ask` waits for Layer 4's reply. The home's Ollama model can take a while on a laptop.
    public static let replyWait: Duration = .seconds(45)
    /// How often `ask` fetches messages while it waits for the reply.
    public static let replyPoll: Duration = .seconds(1)

    /// Sends the question as a `request` with kind `ask` (phone-hub.md §3), then fetches messages until the `reply` with
    /// the same `request_id` arrives. Throws `AssistantError.slow` if none comes within `replyWait`.
    public func ask(_ question: String) async throws -> String {
        try await ask(question, requestID: UUID().uuidString.lowercased())
    }

    func ask(_ question: String, requestID: String) async throws -> String {
        try await command("request", ["request_id": requestID, "kind": "ask", "text": question])
        let deadline = ContinuousClock.now + Self.replyWait
        while ContinuousClock.now < deadline {
            try await Task.sleep(for: Self.replyPoll)
            if let answer = takeReply(requestID) { return answer }
            _ = try await refresh()
            if let answer = takeReply(requestID) { return answer }
        }
        throw AssistantError.slow
    }

    private func takeReply(_ requestID: String) -> String? { lock.withLock { $0.replies.removeValue(forKey: requestID) } }

    /// How long unpairing waits to tell the home before forgetting it anyway. With the laptop switched off the
    /// attempts could take half a minute with nothing on screen (owner, 23:5x: "unpair this iPhone is not working").
    public static let unpairDeadline: Duration = .seconds(4)
    /// The hub gets the first part of it; revoking at the relay gets the rest.
    public static let hubUnpairDeadline: Duration = .milliseconds(2500)

    /// Tells the hub first (so the laptop's Phones list updates), then revokes the credential at the relay, within
    /// `unpairDeadline` in all, and deletes every key whatever the answers. The order matters: revoking first made
    /// the hub refuse the unpair as "device removed" (the fix's review, 00:40). Returns whether the home heard,
    /// from either side, or already knew (it had removed this iPhone itself).
    public func unpair() async -> Bool {
        let hub = await Self.firstOf(deadline: Self.hubUnpairDeadline) { [self] in await self.tellHubUnpaired() } ?? false
        let relay = await Self.firstOf(deadline: Self.unpairDeadline - Self.hubUnpairDeadline) { [self] in await self.revokeAtRelay() } ?? false
        store.deleteAll()
        lock.withLock { $0 = State() }
        return hub || relay
    }

    /// The hub heard, or already knew: "device removed" means the home removed this iPhone first. No Bonjour search:
    /// away from home it would spend the whole time looking for a laptop that isn't there.
    private func tellHubUnpaired() async -> Bool {
        do { try await command("unpair", [:], rediscover: false); return true }
        catch HomeError.removed { return true }
        catch { return false }
    }

    /// The relay forgot this iPhone's credential, or already had. A home without remote access has no relay.
    private func revokeAtRelay() async -> Bool {
        guard let c = try? config(), !relayBase(c).isEmpty else { return false }
        do {
            let (_, status) = try await relayRequest("/v1/unpair", method: "POST")
            return (200..<300).contains(status)
        } catch HomeError.removed { return true }
        catch { return false }
    }

    /// Runs `work` but stops waiting at `deadline` (nil) and cancels it. Unlike a task group, the caller never waits
    /// for the work to wind down: a Bonjour browse or a socket timeout finishes on its own, in the background.
    static func firstOf<T: Sendable>(deadline: Duration, _ work: @escaping @Sendable () async -> T) async -> T? {
        let once = OSAllocatedUnfairLock(initialState: false)
        return await withCheckedContinuation { (cont: CheckedContinuation<T?, Never>) in
            let worker = Task {
                let value = await work()
                if once.withLock({ done in defer { done = true }; return !done }) { cont.resume(returning: value) }
            }
            Task {
                try? await Task.sleep(for: deadline)
                if once.withLock({ done in defer { done = true }; return !done }) { worker.cancel(); cont.resume(returning: nil) }
            }
        }
    }
}
