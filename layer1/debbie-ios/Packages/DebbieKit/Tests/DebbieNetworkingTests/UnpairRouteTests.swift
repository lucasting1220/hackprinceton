import DebbieCore
@testable import DebbieNetworking
import DebbieSecureStore
import Foundation
import os
import Testing

/// The real `NetworkHomeService.unpair()` against stubbed HTTP, one test per home state (CRAFT §5 Unpair, D-035). It
/// checks what the welcome screen relies on: whether the home counts as told. The build-8 review found that no test
/// told "either" from "both", that the relay's "removed" answer was never recognised (F1), and that another home's
/// gateway could count as told (F5).
@Suite(.serialized) struct UnpairRouteTests {
    static let lan = "192.168.1.20:7480"
    static let relay = "https://relay.test"
    static let hubPub = "AbCdEfGh1234567890abcdefghijklmnopqrstuvwxy"
    static let hello = #"{"v":1,"service":"debbie-bridge","hub":"AbCdEfGh"}"#
    static let accepted = #"{"v":1,"accepted":true}"#
    static let removedAtRelay = #"{"v":1,"error":{"code":"device_removed","message":"This iPhone was removed from the home."}}"#

    private func service(relay: String) throws -> (NetworkHomeService, MemoryStore) {
        let store = MemoryStore()
        let config = HomeConfig(homeID: "h-test", deviceID: "d-test", role: .caregiver, homeName: "Test Home",
                                relayURL: relay, lanAddrs: [Self.lan], hubPub: Self.hubPub, pairedAt: .now)
        try store.save(JSONEncoder.debbie.encode(config), as: .homeConfig)
        try store.save(Data(repeating: 7, count: 32), as: .phoneKey)
        try store.save(Data("credential".utf8), as: .deviceCredential)
        return (NetworkHomeService(store: store, mode: .auto, lanSession: StubHTTP.session(), relaySession: StubHTTP.session()), store)
    }

    @Test func theLaptopOnWithoutRemoteAccessCountsAsTold() async throws {
        StubHTTP.install(["GET 192.168.1.20/v1/hello": .reply(200, Self.hello),
                          "POST 192.168.1.20/v1/lan/commands": .reply(202, Self.accepted)])
        let (home, store) = try service(relay: "")
        #expect(await home.unpair(), "told by the laptop alone: a home without remote access has no relay to ask")
        #expect(store.isEmpty, "every key is gone")
    }

    @Test func theLaptopIsToldBeforeTheRelayRevokes() async throws {
        StubHTTP.install(["GET 192.168.1.20/v1/hello": .reply(200, Self.hello),
                          "POST 192.168.1.20/v1/lan/commands": .reply(202, Self.accepted),
                          "POST relay.test/v1/unpair": .reply(204, "")])
        let (home, _) = try service(relay: Self.relay)
        #expect(await home.unpair())
        let log = StubHTTP.log
        let laptop = try #require(log.firstIndex(of: "POST 192.168.1.20/v1/lan/commands"))
        let revoke = try #require(log.firstIndex(of: "POST relay.test/v1/unpair"))
        #expect(laptop < revoke, "revoking first makes the laptop refuse the unpair")
    }

    @Test func awayFromHomeTheRelayRevocationCounts() async throws {
        StubHTTP.install(["GET 192.168.1.20/v1/hello": .refuse,
                          "POST relay.test/v1/commands": .reply(503, #"{"v":1,"error":{"code":"hub_offline"}}"#),
                          "POST relay.test/v1/unpair": .reply(204, "")])
        let (home, _) = try service(relay: Self.relay)
        #expect(await home.unpair(), "the relay forgot the iPhone, and tells the laptop when it's back")
    }

    @Test func aPhoneRemovedOnTheLaptopCountsAsToldAwayFromHome() async throws {
        StubHTTP.install(["GET 192.168.1.20/v1/hello": .refuse,
                          "POST relay.test/v1/commands": .reply(401, Self.removedAtRelay),
                          "POST relay.test/v1/unpair": .reply(401, Self.removedAtRelay)])
        let (home, _) = try service(relay: Self.relay)
        #expect(await home.unpair(), "the relay's device_removed means the home already knows")
    }

    @Test func aPhoneRemovedOnTheLaptopCountsAsToldAtHome() async throws {
        StubHTTP.install(["GET 192.168.1.20/v1/hello": .reply(200, Self.hello),
                          "POST 192.168.1.20/v1/lan/commands": .reply(403, #"{"v":1,"error":{"code":"device_removed"}}"#)])
        let (home, _) = try service(relay: "")
        #expect(await home.unpair())
    }

    @Test func anotherHomesGatewayIsNeverCountedAsTold() async throws {
        StubHTTP.install(["GET 192.168.1.20/v1/hello": .reply(200, #"{"v":1,"service":"debbie-bridge","hub":"ZzZzZzZz"}"#),
                          "POST 192.168.1.20/v1/lan/commands": .reply(403, #"{"v":1,"error":{"code":"unknown_device"}}"#)])
        let (home, _) = try service(relay: "")
        #expect(!(await home.unpair()), "another home's \"unknown phone\" isn't this home being told")
        #expect(!StubHTTP.log.contains("POST 192.168.1.20/v1/lan/commands"), "the command never goes to another home")
    }

    @Test func withTheLaptopOffNothingIsToldAndItEndsInFourSeconds() async throws {
        StubHTTP.install(["GET 192.168.1.20/v1/hello": .hang,
                          "POST relay.test/v1/commands": .hang,
                          "POST relay.test/v1/unpair": .hang])
        let (home, store) = try service(relay: Self.relay)
        let clock = ContinuousClock()
        let start = clock.now
        let told = await home.unpair()
        let took = clock.now - start
        #expect(!told, "the welcome then says how to remove the iPhone on the laptop")
        #expect(took < .milliseconds(4600), "at most about 4 s (took \(took))")
        #expect(store.isEmpty, "the keys go even when the home never answers")
    }

    // The two answers the routes above depend on, with the exact bodies the relay and the bridge send.

    @Test func theRelaysRemovedAnswerIsRecognised() {
        #expect(NetworkHomeService.isDeviceRemoved(status: 401, body: Data(Self.removedAtRelay.utf8)))
        #expect(NetworkHomeService.isDeviceRemoved(status: 401, body: Data(#"{"error":{"code":"device_removed"}}"#.utf8)))
        #expect(!NetworkHomeService.isDeviceRemoved(status: 401, body: Data(#"{"v":1,"error":{"code":"unauthorized","message":"x"}}"#.utf8)))
        #expect(!NetworkHomeService.isDeviceRemoved(status: 403, body: Data(Self.removedAtRelay.utf8)))
        #expect(!NetworkHomeService.isDeviceRemoved(status: 401, body: Data()))
    }

    @Test func onlyThisHomesHelloCounts() {
        #expect(NetworkHomeService.helloIsThisHome(status: 200, body: Data(Self.hello.utf8), hubPub: Self.hubPub))
        #expect(NetworkHomeService.helloIsThisHome(status: 200, body: Data(#"{"v":1,"hub":"AbCdEfGh"}"#.utf8), hubPub: Self.hubPub), "the mock's shape")
        #expect(!NetworkHomeService.helloIsThisHome(status: 200, body: Data(#"{"v":1,"hub":"ZzZzZzZz"}"#.utf8), hubPub: Self.hubPub))
        #expect(!NetworkHomeService.helloIsThisHome(status: 200, body: Data(#"{"v":1,"service":"debbie-bridge"}"#.utf8), hubPub: Self.hubPub))
        #expect(!NetworkHomeService.helloIsThisHome(status: 404, body: Data(Self.hello.utf8), hubPub: Self.hubPub))
    }
}

/// The service's Keychain items, held in memory.
final class MemoryStore: PairingStore {
    private let items = OSAllocatedUnfairLock(initialState: [SecureStore.Account: Data]())
    func save(_ data: Data, as account: SecureStore.Account) throws(SecureStore.Failure) { items.withLock { $0[account] = data } }
    func load(_ account: SecureStore.Account) throws(SecureStore.Failure) -> Data {
        guard let data = items.withLock({ $0[account] }) else { throw .notFound }
        return data
    }
    func deleteAll() { items.withLock { $0 = [:] } }
    var isEmpty: Bool { items.withLock { $0.isEmpty } }
}

/// Answers the service's requests: each "METHOD host/path" gets a reply, a refused connection, or no answer at all
/// (a laptop switched off, or a relay that accepts and never replies). Requests are logged in the order they arrive.
final class StubHTTP: URLProtocol, @unchecked Sendable {
    enum Behaviour: Sendable { case reply(Int, String), refuse, hang }
    private struct Routes: Sendable { var table: [String: Behaviour] = [:]; var log: [String] = [] }
    private static let routes = OSAllocatedUnfairLock(initialState: Routes())

    static func install(_ table: [String: Behaviour]) { routes.withLock { $0 = Routes(table: table) } }
    static var log: [String] { routes.withLock { $0.log } }
    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubHTTP.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let key = "\(request.httpMethod ?? "GET") \(url.host ?? "")\(url.path)"
        let behaviour = Self.routes.withLock { r -> Behaviour in r.log.append(key); return r.table[key] ?? .refuse }
        switch behaviour {
        case .hang:
            return
        case .refuse:
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
        case .reply(let status, let body):
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
