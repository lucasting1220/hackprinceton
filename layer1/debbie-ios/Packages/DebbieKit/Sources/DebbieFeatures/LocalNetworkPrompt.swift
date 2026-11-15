import Network

enum LocalNetworkPrompt {
    /// Browsing for the bridge's Bonjour service brings up the Local Network prompt (TN3179).
    static func trigger() {
        let browser = NWBrowser(for: .bonjour(type: "_debbie._tcp", domain: nil), using: .tcp)
        browser.start(queue: .main)
        Task { try? await Task.sleep(for: .seconds(3)); browser.cancel() }
    }
}
