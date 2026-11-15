import XCTest

/// Two bugs the owner found on an iPhone at 23:5x, reproduced here so they stay fixed:
/// - Add a Laptop showed no camera: the live camera view has no size of its own and collapsed inside the sheet's
///   scroll view. `DEBBIE_FAKE_CAMERA=1` swaps in a stand-in that behaves the same, since the Simulator has no camera.
/// - "Unpair This iPhone" seemed to do nothing once the laptop was switched off: it waited on the home with no sign
///   of progress. The mock home's `home/off` makes the LAN gateway and the relay stop answering.
final class DeviceBugsUITests: XCTestCase {
    private let control = MockHomePorts.control
    override func setUp() { continueAfterFailure = false }

    @discardableResult
    private func call(_ action: String, method: String = "POST") async throws -> [String: Any] {
        var req = URLRequest(url: control.appending(path: action), timeoutInterval: 3)
        req.httpMethod = method
        let (data, _) = try await URLSession.shared.data(for: req)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any], "mock home reply")
    }

    @MainActor
    func testAddALaptopShowsTheCamera() {
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_FAKE_CAMERA"] = "1"
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launch()
        app.buttons["tryDemo"].tapWhenReady(timeout: 10)
        app.buttons["roleContinue"].tapWhenReady()
        app.buttons["nameContinue"].tapWhenReady()
        app.buttons["pairedContinue"].tapWhenReady(timeout: 12)
        app.buttons["Continue"].tapWhenReady()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        app.buttons["tab.devices"].tapWhenReady(timeout: 10)
        // Add a Laptop sits below the fold, behind the floating tab bar: scroll it clear before tapping, or the tap
        // lands on the bar (as the screen tour does).
        XCTAssertTrue(app.buttons["addLaptop"].waitForExistence(timeout: 5))
        let bar = app.buttons["tab.home"].frame.union(app.buttons["tab.devices"].frame)
        var tries = 0
        while app.buttons["addLaptop"].frame.maxY > bar.minY - 4 && tries < 6 { app.swipeUp(); tries += 1 }
        app.buttons["addLaptop"].tapWhenReady()
        let camera = app.descendants(matching: .any)["cameraView"]
        XCTAssertTrue(camera.waitForExistence(timeout: 5), "the sheet shows a camera")
        Thread.sleep(forTimeInterval: 0.8)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "add-a-laptop"; shot.lifetime = .keepAlways; add(shot)
        XCTAssertGreaterThanOrEqual(camera.frame.height, 200, "the camera has room to show the code (was \(camera.frame.height) pt)")
    }

    @MainActor
    func testUnpairAfterTheHomeRemovedThisPhone() async throws {
        guard let state = try? await call("state", method: "GET"), let pairing = state["pairing"] as? [String: Any],
              let qr = pairing["qr"] as? String else { throw XCTSkip("start the mock home first: node MockHome/server.mjs --auto-confirm") }
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_TRANSPORT"] = "mock"
        app.launchEnvironment["DEBBIE_MOCK_PORT_BASE"] = MockHomePorts.base
        app.launchEnvironment["DEBBIE_DEBUG_QR"] = qr
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launch()
        app.buttons["getStarted"].tapWhenReady(timeout: 10)
        app.buttons["roleContinue"].tapWhenReady()
        app.buttons["Continue"].tapWhenReady()               // local network priming
        app.buttons["Continue"].tapWhenReady()               // camera priming
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Allow", "OK"] where springboard.alerts.buttons[label].waitForExistence(timeout: 2) { springboard.alerts.buttons[label].tap() }
        app.buttons["nameContinue"].tapWhenReady(timeout: 10)
        app.buttons["pairedContinue"].tapWhenReady(timeout: 15)
        app.buttons["Continue"].tapWhenReady()
        if springboard.alerts.buttons["Allow"].waitForExistence(timeout: 4) { springboard.alerts.buttons["Allow"].tap() }
        XCTAssertTrue(app.buttons["tab.home"].waitForExistence(timeout: 10), "paired with the mock home")

        // The coordinator removes this iPhone on the laptop; the person then unpairs. The home already knows, so the
        // welcome must not say it couldn't be told (the fix's review, 00:40).
        try await call("phone/remove")
        defer { Task { _ = try? await self.call("reset") } }
        app.buttons["settings"].tapWhenReady()
        if !app.buttons["Close"].waitForExistence(timeout: 3) { app.buttons["settings"].tap() }
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 5), "Settings opened")
        let unpair = app.buttons["unpair"]
        var tries = 0
        while !unpair.isHittable && tries < 6 { app.swipeUp(); tries += 1 }
        unpair.tapWhenReady()
        app.buttons["Unpair"].tapWhenReady()
        XCTAssertTrue(app.buttons["getStarted"].waitForExistence(timeout: 8), "back on the welcome")
        XCTAssertFalse(app.descendants(matching: .any)["unpairNotice"].exists, "no 'couldn't reach the laptop' notice")
    }

    @MainActor
    func testUnpairWithTheLaptopSwitchedOff() async throws {
        guard let state = try? await call("state", method: "GET"), let pairing = state["pairing"] as? [String: Any],
              let qr = pairing["qr"] as? String else { throw XCTSkip("start the mock home first: node MockHome/server.mjs --auto-confirm") }
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_TRANSPORT"] = "mock"
        app.launchEnvironment["DEBBIE_MOCK_PORT_BASE"] = MockHomePorts.base
        app.launchEnvironment["DEBBIE_DEBUG_QR"] = qr
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launch()
        app.buttons["getStarted"].tapWhenReady(timeout: 10)
        app.buttons["roleContinue"].tapWhenReady()
        app.buttons["Continue"].tapWhenReady()               // local network priming
        app.buttons["Continue"].tapWhenReady()               // camera priming
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Allow", "OK"] where springboard.alerts.buttons[label].waitForExistence(timeout: 2) { springboard.alerts.buttons[label].tap() }
        app.buttons["nameContinue"].tapWhenReady(timeout: 10)
        app.buttons["pairedContinue"].tapWhenReady(timeout: 15)
        app.buttons["Continue"].tapWhenReady()
        if springboard.alerts.buttons["Allow"].waitForExistence(timeout: 4) { springboard.alerts.buttons["Allow"].tap() }
        XCTAssertTrue(app.buttons["tab.home"].waitForExistence(timeout: 10), "paired with the mock home")

        try await call("home/off")
        defer { Task { _ = try? await self.call("home/on"); _ = try? await self.call("reset") } }

        // Open Settings, tapping the gear again if the first tap was swallowed (as the screen tour does).
        app.buttons["settings"].tapWhenReady()
        if !app.buttons["Close"].waitForExistence(timeout: 3) { app.buttons["settings"].tap() }
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 5), "Settings opened")
        let unpair = app.buttons["unpair"]
        var tries = 0
        while !unpair.isHittable && tries < 6 { app.swipeUp(); tries += 1 }
        unpair.tapWhenReady()
        app.buttons["Unpair"].tapWhenReady()
        let tapped = Date()
        let welcome = app.buttons["getStarted"]
        XCTAssertTrue(welcome.waitForExistence(timeout: 8), "back on the welcome within 8 s with the laptop off")
        let seconds = Date().timeIntervalSince(tapped)
        let note = XCTAttachment(string: String(format: "Unpair with the laptop off: welcome after %.1f s", seconds))
        note.name = "unpair-seconds"; note.lifetime = .keepAlways; add(note)
        print(String(format: "DEBBIE_UNPAIR_SECONDS=%.1f", seconds))
        let notice = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'couldn' AND label CONTAINS 'laptop'")).firstMatch
        XCTAssertTrue(notice.waitForExistence(timeout: 3), "the welcome says the laptop couldn't be told")
        XCTAssertTrue(app.windows.firstMatch.frame.contains(notice.frame), "and it's on screen without scrolling (\(notice.frame))")
        try await Task.sleep(for: .milliseconds(800))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "unpaired-welcome"; shot.lifetime = .keepAlways; add(shot)
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
