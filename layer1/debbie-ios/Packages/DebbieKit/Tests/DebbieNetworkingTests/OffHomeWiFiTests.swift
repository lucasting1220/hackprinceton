import CryptoKit
import DebbieCore
import DebbieCrypto
import DebbieSecureStore
@testable import DebbieNetworking
import Foundation
import os
import Testing

/// Off home Wi-Fi the app must reach the relay (D-036). On the owner's iPhone, on cellular, the LAN gateway's
/// hello waited for connectivity forever, so `refresh()` never got to the relay and the app showed
/// "Can't connect to Debbie". The tests share the relay stub, so they run one at a time.
@Suite(.serialized) struct OffHomeWiFiTests {
    @Test func refreshReachesTheRelayWhenTheStoredLANAddressIsUnreachable() async throws {
        // TEST-NET-1 (RFC 5737): never routed, like the home's LAN address seen from cellular.
        let paired = try Fixture.pair(lanAddrs: ["192.0.2.1:7480"])
        RelayStub.answer(["/v1/messages": (200, try Fixture.page(alertID: "alert-1", homeKey: paired.homeKey)),
                          "/v1/home": (200, Fixture.homeBody(online: true, lastContactAt: "2026-11-15T06:00:00Z"))])
        // The production LAN session, as on the phone; only the relay is stubbed.
        let service = NetworkHomeService(store: paired.store, mode: .auto, relaySession: Fixture.relaySession())
        let start = ContinuousClock.now
        let snapshot = await NetworkHomeService.firstOf(deadline: .seconds(15)) { try? await service.refresh() }
        let waited = ContinuousClock.now - start
        let snap = try #require(snapshot ?? nil, "refresh() hadn't returned after \(waited)")
        #expect(snap.route == .internet)
        #expect(snap.alerts.map(\.alertID) == ["alert-1"], "the relay's message was read")
        #expect(waited < .seconds(10), "fell back to the relay quickly: \(waited)")
    }

    @Test func aRemovedPhoneIsToldSo() async throws {
        let paired = try Fixture.pair(lanAddrs: [])
        RelayStub.answer(["/v1/messages": (401, Fixture.errorBody("device_removed"))])
        let service = NetworkHomeService(store: paired.store, mode: .relay, relaySession: Fixture.relaySession())
        await #expect(throws: HomeError.removed) { try await service.refresh() }
    }

    @Test func aRefusalIsATypedErrorNotADecodingError() async throws {
        let paired = try Fixture.pair(lanAddrs: [])
        RelayStub.answer(["/v1/messages": (401, Fixture.errorBody("unauthorized"))])
        let service = NetworkHomeService(store: paired.store, mode: .relay, relaySession: Fixture.relaySession())
        await #expect(throws: HomeError.server("relay 401 unauthorized")) { try await service.refresh() }
    }

    @Test func theRelaysHomeStatusSetsTheHubState() async throws {
        let paired = try Fixture.pair(lanAddrs: [])
        // The messages page says online; /v1/home, read after it, says the hub went offline at 05:40.
        RelayStub.answer(["/v1/messages": (200, try Fixture.page(alertID: nil, homeKey: paired.homeKey)),
                          "/v1/home": (200, Fixture.homeBody(online: false, lastContactAt: "2026-11-15T05:40:00Z"))])
        let service = NetworkHomeService(store: paired.store, mode: .relay, relaySession: Fixture.relaySession())
        let snap = try await service.refresh()
        #expect(snap.hubOnline == false)
        #expect(snap.hubLastContact == ISO8601DateFormatter().date(from: "2026-11-15T05:40:00Z"))
    }

    @Test func theLANSessionNeverWaitsAndTheRelaySessionIsBounded() {
        let lan = NetworkHomeService.lanSessionConfiguration()
        #expect(lan.waitsForConnectivity == false)
        #expect(lan.timeoutIntervalForRequest <= 5)
        #expect(lan.timeoutIntervalForResource <= 10)
        let relay = NetworkHomeService.relaySessionConfiguration()
        #expect(relay.timeoutIntervalForResource <= 30, "inside the 30 s reconnection target")
        #expect(relay.timeoutIntervalForRequest <= relay.timeoutIntervalForResource)
    }
}

/// A paired caregiver phone, and the relay's replies.
private enum Fixture {
    static let homeID = "home-test", deviceID = "device-test"

    struct Paired { let store: MemoryStore; let homeKey: SymmetricKey }

    static func pair(lanAddrs: [String]) throws -> Paired {
        let store = MemoryStore()
        let homeKey = SymmetricKey(size: .bits256)
        let config = HomeConfig(homeID: homeID, deviceID: deviceID, role: .caregiver, homeName: "Test home",
                                relayURL: "https://\(RelayStub.host)", lanAddrs: lanAddrs, hubPub: "not-a-real-hub-key", pairedAt: .now)
        try store.save(try JSONEncoder.debbie.encode(config), as: .homeConfig)
        try store.save(Data(repeating: 7, count: 32), as: .phoneKey)
        try store.save(Data("test-device-credential".utf8), as: .deviceCredential)
        try store.save(homeKey.withUnsafeBytes { Data($0) }, as: .homeKey)
        return Paired(store: store, homeKey: homeKey)
    }

    static func relaySession() -> URLSession {
        let config = NetworkHomeService.relaySessionConfiguration()
        config.protocolClasses = [RelayStub.self]
        return URLSession(configuration: config)
    }

    private struct Page: Encodable { let v = 1; let messages: [Wrapper]; let next: String?; let hub: Hub
        struct Hub: Encodable { let online: Bool; let last_contact_at: String } }

    /// A messages page as the relay sends it, with one encrypted alert (or none).
    static func page(alertID: String?, homeKey: SymmetricKey) throws -> Data {
        var messages: [Wrapper] = []
        if let alertID {
            let alert = HubAlert(alertID: alertID, kind: .fall, severity: .urgent, detectedAt: .now, title: "Possible fall", body: "Kitchen")
            let env = try ContractCrypto.seal(try JSONEncoder.debbie.encode(alert), key: homeKey, kid: "hub", homeID: homeID, type: "alert")
            messages.append(Wrapper(msgID: "msg-\(alertID)", type: "alert", sentAt: .now, envelope: env))
        }
        return try JSONEncoder.debbie.encode(Page(messages: messages, next: "cursor-1", hub: .init(online: true, last_contact_at: "2026-11-15T06:00:00Z")))
    }

    /// `GET /v1/home` exactly as layer1/relay/src/phone-api.ts sends it.
    static func homeBody(online: Bool, lastContactAt: String) -> Data {
        Data(#"{"v":1,"home_id":"\#(homeID)","hub":{"online":\#(online),"last_contact_at":"\#(lastContactAt)"},"push":{"state":"ok","since":null}}"#.utf8)
    }

    static func errorBody(_ code: String) -> Data {
        Data(#"{"v":1,"error":{"code":"\#(code)","message":"The relay refused this request."}}"#.utf8)
    }
}

// The in-memory `PairingStore` (`MemoryStore`) is shared with UnpairRouteTests: a package test bundle can't use the
// Keychain on the Simulator.

/// Answers requests to the fake relay host only; anything else (the LAN gateway) goes to the real network.
final class RelayStub: URLProtocol, @unchecked Sendable {
    typealias Reply = (status: Int, body: Data)
    static let host = "relay.debbie.test"
    private static let replies = OSAllocatedUnfairLock<[String: Reply]>(initialState: [:])

    static func answer(_ byPath: [String: Reply]) { replies.withLock { $0 = byPath } }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == host }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let reply = Self.replies.withLock { $0[url.path] } ?? (404, Data(#"{"v":1,"error":{"code":"not_found","message":"no such path"}}"#.utf8))
        if let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) {
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        }
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
