import XCTest

/// Screen-gate tour (brief §8; CRAFT.md §9): walks every demo-home screen and attaches a screenshot of each,
/// named "<config>__<NN-screen>". tools/screens/tour.sh runs it across SE/Max × light/dark × default/AX5,
/// plus Reduce Motion and Increase Contrast, and tiles the results.
final class ScreenTourUITests: XCTestCase {
    private var app: XCUIApplication!
    private var config: String { ProcessInfo.processInfo.environment["DEBBIE_GATE_CONFIG"] ?? "local" }

    override func setUp() { continueAfterFailure = true }

    @MainActor
    private func launch() {
        app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_REDUCE_MOTION"] = ProcessInfo.processInfo.environment["DEBBIE_REDUCE_MOTION"] ?? "off"
        // Debbie answers on the phone unless the run asks for the build's Gemini key (DEBBIE_TOUR_ASSISTANT=gemini).
        if ProcessInfo.processInfo.environment["DEBBIE_TOUR_ASSISTANT"] != "gemini" { app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline" }
        app.launch()
    }

    @MainActor
    func testCaregiverTour() throws {
        launch()
        snap("01-welcome", after: app.buttons["tryDemo"])
        go(app.buttons["tryDemo"], then: app.buttons["roleContinue"])
        snap("02-role", after: app.buttons["roleContinue"])
        go(app.buttons["roleContinue"], then: app.buttons["nameContinue"])
        snap("03-name", after: app.buttons["nameContinue"])
        go(app.buttons["nameContinue"], then: app.staticTexts["Check the code"])
        snap("04-code", after: app.staticTexts["Check the code"])
        snap("05-paired", after: app.buttons["pairedContinue"], timeout: 10)
        go(app.buttons["pairedContinue"], then: app.staticTexts["Get alerts even when Debbie is closed"])
        snap("06-notifications", after: app.buttons["Continue"])
        app.buttons["Continue"].tapWhenReady()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 4) { allow.tap() }
        snap("07-home-alert", after: app.staticTexts["Possible fall"], timeout: 20)
        go(app.staticTexts["Possible fall"], then: app.buttons["Mark as False Alarm"])
        snap("08-alert-detail", after: app.buttons["Back"])
        app.buttons["Back"].tapWhenReady()
        go(app.buttons["tab.devices"], then: app.buttons["addLaptop"])
        snap("09-devices", after: app.buttons["addLaptop"])
        // The button sits below the fold, behind the floating bar: scroll it into the clear first.
        app.swipeUp()
        tapScrolling(app.buttons["addLaptop"])
        snap("10-add-laptop", after: app.buttons["Close"])
        dismissSheet()
        go(app.buttons["tab.history"], then: app.staticTexts["History"])
        snap("11-history", after: app.staticTexts["History"])
        // Send appears only once there's text (as in Messages), so wait for the field and her opening update.
        let reply = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Debbie: '")).firstMatch
        go(app.buttons["tab.debbie"], then: app.descendants(matching: .any)["debbieMessage"])
        snap("12-debbie", after: reply, timeout: 25)
        go(app.buttons["tab.live"], then: app.buttons["liveView"])
        snap("13-live-tab", after: app.buttons["liveView"])
        app.buttons["liveView"].tapWhenReady()
        snap("14-live-requesting", after: app.staticTexts["Asking home…"], timeout: 3)
        snap("15-live-playing", after: app.buttons["stopLive"], timeout: 10)
        app.buttons["stopLive"].tapWhenReady()
        snap("16-live-ended", after: app.buttons["keepWatching"], timeout: 6)
        app.buttons["keepWatching"].tapWhenReady()
        snap("17-live-again", after: app.buttons["stopLive"], timeout: 10)
        app.buttons["stopLive"].tapWhenReady()
        app.buttons["Done"].tapWhenReady()
        go(app.buttons["tab.home"], then: app.descendants(matching: .any)["statusHeader"])
        let ack = app.buttons["I'm On It"].firstMatch
        if ack.waitForExistence(timeout: 3) { ack.tap() }
        snap("18-home-acknowledged", after: app.descendants(matching: .any)["statusHeader"])
        go(app.buttons["settings"], then: app.buttons["Close"])
        snap("19-settings", after: app.buttons["Close"])
        tapScrolling(app.buttons["demoControls"])
        snap("20-demo-controls", after: app.staticTexts["Feel each haptic"])
    }

    @MainActor
    func testResidentTour() throws {
        launch()
        go(app.buttons["tryDemo"], then: app.buttons["roleContinue"])
        app.staticTexts["The person at home"].tapWhenReady()
        snap("21-role-resident", after: app.buttons["roleContinue"])
        go(app.buttons["roleContinue"], then: app.buttons["nameContinue"])
        go(app.buttons["nameContinue"], then: app.staticTexts["Check the code"])
        app.buttons["pairedContinue"].tapWhenReady(timeout: 10)
        snap("22-health", after: app.buttons["Continue"])
        go(app.buttons["Continue"], then: app.buttons["syncNow"])
        snap("23-resident", after: app.buttons["syncNow"], timeout: 8)
        let sent = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Sent to home'")).firstMatch
        go(app.buttons["syncNow"], then: sent)
        snap("24-resident-synced", after: sent, timeout: 6)
    }

    // MARK: Helpers

    @MainActor
    private func snap(_ name: String, after element: XCUIElement, timeout: TimeInterval = 6) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(name): \(element) never appeared")
        // Let the transition settle (CRAFT.md §3: springs settle within ~0.5 s) so the shot shows the resting state.
        Thread.sleep(forTimeInterval: 0.9)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "\(config)__\(name)"
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Tap when hittable; if `next` doesn't appear (a tap swallowed mid-transition on a loaded machine), tap once more.
    @MainActor
    private func go(_ element: XCUIElement, then next: XCUIElement) {
        element.tapWhenReady()
        if !next.waitForExistence(timeout: 4), element.exists, element.isHittable { element.tap() }
        XCTAssertTrue(next.waitForExistence(timeout: 6), "\(next) never appeared after tapping \(element)")
    }

    @MainActor
    private func tapScrolling(_ element: XCUIElement) {
        var tries = 0
        while !element.isHittable && tries < 6 { app.swipeUp(); tries += 1 }
        element.tapWhenReady()
    }

    @MainActor
    private func dismissSheet() {
        if app.buttons["Close"].exists { app.buttons["Close"].tap() } else { app.swipeDown(velocity: .fast) }
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
