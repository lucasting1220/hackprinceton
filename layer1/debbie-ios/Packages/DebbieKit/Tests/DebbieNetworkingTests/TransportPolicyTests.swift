@testable import DebbieNetworking
import Foundation
import Testing

@Suite struct TransportPolicyTests {
    @Test func plainHTTPOnlyToLocalAddresses() {
        #expect(TransportPolicy.allows(URL(string: "http://192.168.1.20:7480/v1/hello")!, isRelay: false, isDebug: false))
        #expect(TransportPolicy.allows(URL(string: "http://10.0.0.7:7480/v1/pair")!, isRelay: false, isDebug: false))
        #expect(TransportPolicy.allows(URL(string: "http://debbie-hub.local:7480/")!, isRelay: false, isDebug: false))
        #expect(!TransportPolicy.allows(URL(string: "http://8.8.8.8/")!, isRelay: false, isDebug: false))
        #expect(!TransportPolicy.allows(URL(string: "http://example.com/")!, isRelay: false, isDebug: false))
    }
    @Test func releaseRelayRequiresHTTPS() {
        #expect(!TransportPolicy.allows(URL(string: "http://127.0.0.1:7481/v1/home")!, isRelay: true, isDebug: false))
        #expect(TransportPolicy.allows(URL(string: "http://127.0.0.1:7481/v1/home")!, isRelay: true, isDebug: true))
        #expect(TransportPolicy.allows(URL(string: "https://abc.execute-api.us-east-1.amazonaws.com/v1/home")!, isRelay: true, isDebug: false))
    }
}
