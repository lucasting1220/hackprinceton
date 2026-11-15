import Foundation

/// The two URL sessions behind `NetworkHomeService` (D-036).
///
/// The LAN gateway is tried first on every refresh and command. Away from home Wi-Fi its stored address can't be
/// reached, and a session that waits for connectivity never fails that request (only the resource timeout, 7 days
/// by default, ends it), so the relay was never tried. LAN calls therefore never wait for connectivity and have a
/// short resource limit; relay calls may wait for a network to appear, but only as long as `relayResourceTimeout`.
extension NetworkHomeService {
    /// Idle time allowed between packets on a LAN gateway call (requests may set a shorter one).
    public static let lanRequestTimeout: TimeInterval = 3
    /// The longest a LAN gateway call may take in all, whatever its request asks for.
    public static let lanResourceTimeout: TimeInterval = 5
    /// Idle time allowed between packets on a relay call.
    public static let relayRequestTimeout: TimeInterval = 10
    /// The longest a relay call may take in all, waiting for connectivity included: below the 30 s reconnection target.
    public static let relayResourceTimeout: TimeInterval = 20

    /// Fails at once when there is no path to the address (away from home), instead of waiting for one.
    public static func lanSessionConfiguration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = lanRequestTimeout
        config.timeoutIntervalForResource = lanResourceTimeout
        return config
    }

    /// Rides out a moment without a network (leaving home Wi-Fi for cellular), but never for longer than
    /// `relayResourceTimeout`.
    public static func relaySessionConfiguration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = relayRequestTimeout
        config.timeoutIntervalForResource = relayResourceTimeout
        return config
    }
}
