import XCTest

/// The networked app against the Node mock home (docs/MOCK_HOME.md), through its real transports and crypto:
/// pair from the mock's QR, then cut the LAN gateway and measure how long until the app is fetching through
/// the relay instead (brief §6: reconnect target 30 s; result recorded in PROGRESS.md).
/// Needs `node MockHome/server.mjs --auto-confirm` running; skipped otherwise.
final class MockHomeUITests: XCTestCase {
    private let control = MockHomePorts.control

    private func call(_ action: String, method: String = "POST") async throws -> [String: Any] {
        var req = URLRequest(url: control.appending(path: action), timeoutInterval: 3)
        req.httpMethod = method
        let (data, _) = try await URLSession.shared.data(for: req)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any], "mock home reply")
    }

    @MainActor
    func testPairThenFallBackToRelay() async throws {
        guard let state = try? await call("state", method: "GET"), let pairing = state["pairing"] as? [String: Any],
              let qr = pairing["qr"] as? String else { throw XCTSkip("start the mock home first: node MockHome/server.mjs --auto-confirm") }
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_TRANSPORT"] = "mock"
        app.launchEnvironment["DEBBIE_MOCK_PORT_BASE"] = MockHomePorts.base
        app.launchEnvironment["DEBBIE_DEBUG_QR"] = qr
        app.launch()
        app.buttons["getStarted"].tapWhenReady()
        app.buttons["roleContinue"].tapWhenReady()
        app.buttons["Continue"].tapWhenReady()               // local network priming
        app.buttons["Continue"].tapWhenReady()               // camera priming
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Allow", "OK"] where springboard.alerts.buttons[label].waitForExistence(timeout: 2) { springboard.alerts.buttons[label].tap() }
        app.buttons["nameContinue"].tapWhenReady(timeout: 10)  // the Debug QR was read on the scan step
        XCTAssertTrue(app.staticTexts["Check the code"].waitForExistence(timeout: 5))
        app.buttons["pairedContinue"].tapWhenReady(timeout: 15)
        app.buttons["Continue"].tapWhenReady()
        if springboard.alerts.buttons["Allow"].waitForExistence(timeout: 4) { springboard.alerts.buttons["Allow"].tap() }
        XCTAssertTrue(app.buttons["tab.home"].waitForExistence(timeout: 10), "home screen after pairing with the mock")
        XCTAssertTrue(app.staticTexts["Connected to home"].waitForExistence(timeout: 15), "status via the LAN gateway")

        // Cut the LAN gateway and time the switch to the relay.
        let cut = try await call("lan/unreachable")
        XCTAssertEqual(cut["ok"] as? Bool, true)
        let t0 = Date()
        var seconds: Double?
        while Date().timeIntervalSince(t0) < 40 {
            let s = try await call("state", method: "GET")
            if let relay = s["last_relay_fetch_ms"] as? Double, relay / 1000 > t0.timeIntervalSince1970 {
                seconds = relay / 1000 - t0.timeIntervalSince1970; break
            }
            try await Task.sleep(for: .milliseconds(250))
        }
        let measured = try XCTUnwrap(seconds, "the app never fell back to the relay within 40 s")
        let note = XCTAttachment(string: String(format: "LAN cut → first relay fetch: %.1f s (target ≤ 30 s)", measured))
        note.name = "reconnect-seconds"; note.lifetime = .keepAlways; add(note)
        print(String(format: "DEBBIE_RECONNECT_SECONDS=%.1f", measured))
        XCTAssertLessThanOrEqual(measured, 30)
        XCTAssertTrue(app.staticTexts["Connected to home"].waitForExistence(timeout: 5), "still connected, now through the relay, with no prompt")
        _ = try await call("lan/restore")

        // The gateway moves (new port, Bonjour re-registered): the app must find it again and confirm it with a
        // request encrypted under its own key, then go on using the LAN (brief §6).
        try await Task.sleep(for: .seconds(16))   // past the app's 15 s rediscovery backoff from the cut above
        _ = try await call("lan/moved")
        let t1 = Date()
        var lanSeconds: Double?
        while Date().timeIntervalSince(t1) < 60 {
            let s = try await call("state", method: "GET")
            if let lan = s["last_lan_fetch_ms"] as? Double, lan / 1000 > t1.timeIntervalSince1970 + 0.5 {
                lanSeconds = lan / 1000 - t1.timeIntervalSince1970; break
            }
            try await Task.sleep(for: .milliseconds(250))
        }
        let found = try XCTUnwrap(lanSeconds, "the app never found the moved LAN gateway by Bonjour")
        print(String(format: "DEBBIE_REDISCOVER_SECONDS=%.1f", found))
        let note2 = XCTAttachment(string: String(format: "LAN gateway moved → first LAN fetch at the new address: %.1f s", found))
        note2.name = "rediscovery-seconds"; note2.lifetime = .keepAlways; add(note2)
        _ = try await call("lan/restore")

        // Leave the Simulator unpaired (and exercise unpairing): Settings › Unpair This iPhone › Unpair.
        // Open Settings, tapping the gear again if the first tap was swallowed (as the screen tour does).
        app.buttons["settings"].tapWhenReady()
        if !app.buttons["Close"].waitForExistence(timeout: 3) { app.buttons["settings"].tap() }
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 5), "Settings opened")
        let unpair = app.buttons["unpair"]
        var tries = 0
        while !unpair.isHittable && tries < 6 { app.swipeUp(); tries += 1 }
        unpair.tapWhenReady()
        app.buttons["Unpair"].tapWhenReady()
        XCTAssertTrue(app.buttons["getStarted"].waitForExistence(timeout: 10), "back to the welcome screen after unpairing")
        XCTAssertFalse(app.descendants(matching: .any)["unpairNotice"].exists, "the home heard: no 'couldn't reach the laptop' notice")
        let phones = (try await call("state", method: "GET"))["phones"] as? [[String: Any]] ?? []
        XCTAssertTrue(phones.allSatisfy { $0["removed"] as? Bool == true }, "the mock home was told this iPhone left")
    }
}

/// After a pairing that failed for the Wi-Fi, the laptop still shows the same code. The camera read it again at once
/// and jumped back to the name step, wiping "Can't find the home laptop" off the screen (the build-8 review, SCAN-4).
/// Here the Debug QR plays the camera: it's read again each time the scan step appears.
final class PairingRetryUITests: XCTestCase {
    private let control = MockHomePorts.control
    override func setUp() { continueAfterFailure = false }

    private func call(_ action: String, method: String = "POST") async throws -> [String: Any] {
        var req = URLRequest(url: control.appending(path: action), timeoutInterval: 3)
        req.httpMethod = method
        let (data, _) = try await URLSession.shared.data(for: req)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any], "mock home reply")
    }

    @MainActor
    func testAWiFiFailureKeepsItsReasonAndTryAgainPairs() async throws {
        guard let state = try? await call("state", method: "GET"), let pairing = state["pairing"] as? [String: Any],
              let qr = pairing["qr"] as? String else { throw XCTSkip("start the mock home first: node MockHome/server.mjs --auto-confirm") }
        _ = try await call("lan/unreachable")
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_TRANSPORT"] = "mock"
        app.launchEnvironment["DEBBIE_MOCK_PORT_BASE"] = MockHomePorts.base
        app.launchEnvironment["DEBBIE_DEBUG_QR"] = qr
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launch()
        app.buttons["getStarted"].tapWhenReady()
        app.buttons["roleContinue"].tapWhenReady()
        app.buttons["Continue"].tapWhenReady()               // local network priming
        app.buttons["Continue"].tapWhenReady()               // camera priming
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Allow", "OK"] where springboard.alerts.buttons[label].waitForExistence(timeout: 2) { springboard.alerts.buttons[label].tap() }
        app.buttons["nameContinue"].tapWhenReady(timeout: 10)  // the Debug QR was read on the scan step

        let reason = app.staticTexts["Can't find the home laptop. Your iPhone needs to be on the same Wi-Fi as the home laptop."]
        XCTAssertTrue(reason.waitForExistence(timeout: 12), "the Wi-Fi failure's reason")
        Thread.sleep(forTimeInterval: 2)   // the scan step has read the same code again by now
        XCTAssertTrue(reason.exists, "the reason stays: the code that just failed is held back")
        XCTAssertFalse(app.buttons["nameContinue"].exists, "no silent jump back to the name step")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "wifi-failure-try-again"; shot.lifetime = .keepAlways; add(shot)

        _ = try await call("lan/restore")
        app.buttons["tryAgain"].tapWhenReady()
        app.buttons["nameContinue"].tapWhenReady(timeout: 5)
        XCTAssertTrue(app.staticTexts["Check the code"].waitForExistence(timeout: 10), "the same code pairs once the Wi-Fi is right")
        app.buttons["pairedContinue"].tapWhenReady(timeout: 15)
    }
}

private extension XCUIElement {
    func tapWhenReady(timeout: TimeInterval = 6, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(waitForExistence(timeout: timeout), "\(self) never appeared", file: file, line: line)
        let deadline = Date().addingTimeInterval(timeout)
        while (!isHittable || !isEnabled) && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        tap()
    }
}

/// Where the mock home is: 7570, as MockHome/server.mjs defaults, unless the run moves it with
/// `TEST_RUNNER_DEBBIE_MOCK_PORT_BASE` (xcodebuild hands the runner `DEBBIE_MOCK_PORT_BASE`). Never the real bridge's
/// 7470 and 7480. The app gets the same base, so its Debug mock addresses follow (docs/MOCK_HOME.md).
enum MockHomePorts {
    static let base = ProcessInfo.processInfo.environment["DEBBIE_MOCK_PORT_BASE"] ?? "7570"
    static let control = URL(string: "http://127.0.0.1:\(base)/control/")!
}
