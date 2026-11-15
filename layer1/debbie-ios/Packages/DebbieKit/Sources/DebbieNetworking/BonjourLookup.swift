import Foundation
import Network
import os

/// Finds the home's LAN gateway by Bonjour (`_debbie._tcp`, TXT `hub=<first 8 b64url chars of the hub key>`;
/// CONTRACTS.md §5; Layer 1 doc). Returns resolved "host:port" strings; the caller confirms each one with a
/// request encrypted under the phone's own key before trusting it (brief §6).
enum BonjourLookup {
    static func find(type: String, hubTag: String, timeout: Duration = .seconds(3)) async -> [String] {
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: type, domain: nil), using: .tcp)
        let once = OSAllocatedUnfairLock(initialState: false)
        let matches: [NWBrowser.Result] = await withCheckedContinuation { cont in
            browser.browseResultsChangedHandler = { results, _ in
                let matches = results.filter { r in
                    if case .bonjour(let txt) = r.metadata { return txt["hub"] == hubTag }
                    return false
                }
                guard !matches.isEmpty, once.withLock({ done in defer { done = true }; return !done }) else { return }
                cont.resume(returning: Array(matches))
            }
            browser.start(queue: .global(qos: .utility))
            Task {
                try? await Task.sleep(for: timeout)
                if once.withLock({ done in defer { done = true }; return !done }) { cont.resume(returning: []) }
            }
        }
        browser.cancel()
        var found: [String] = []
        for result in matches { if let addr = await resolve(result.endpoint, on: result.interfaces) { found.append(addr) } }
        return found
    }

    /// Resolves a Bonjour service to an address by opening (and immediately closing) a TCP connection, one per
    /// interface the service was seen on; the first to become ready wins. Pinning the interface matters: the
    /// default route can stall in "preparing" for a service reached only on another interface (found 12:22 against
    /// the mock home, which is on loopback; on a home network the interface is Wi-Fi).
    static func resolve(_ endpoint: NWEndpoint, on interfaces: [NWInterface]) async -> String? {
        let connections: [NWConnection] = (interfaces.isEmpty ? [nil] : interfaces.map { Optional($0) }).map { interface in
            let parameters = NWParameters.tcp
            if let interface { parameters.requiredInterface = interface }
            return NWConnection(to: endpoint, using: parameters)
        }
        let once = OSAllocatedUnfairLock(initialState: false)
        let address: String? = await withCheckedContinuation { cont in
            for connection in connections {
                connection.stateUpdateHandler = { state in
                    guard case .ready = state, case .hostPort(let host, let port) = connection.currentPath?.remoteEndpoint,
                          once.withLock({ done in defer { done = true }; return !done }) else { return }
                    cont.resume(returning: format(host, port))
                }
                connection.start(queue: .global(qos: .utility))
            }
            Task {
                try? await Task.sleep(for: .seconds(3))
                if once.withLock({ done in defer { done = true }; return !done }) { cont.resume(returning: nil) }
            }
        }
        connections.forEach { $0.cancel() }
        return address
    }

    private static func format(_ host: NWEndpoint.Host, _ port: NWEndpoint.Port) -> String {
        switch host {
        case .ipv4(let a): return "\(a):\(port.rawValue)"
        case .ipv6(let a): return "[\("\(a)".replacingOccurrences(of: "%", with: "%25"))]:\(port.rawValue)"
        case .name(let n, _): return "\(n):\(port.rawValue)"
        @unknown default: return "\(host):\(port.rawValue)"
        }
    }
}
