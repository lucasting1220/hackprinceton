import XCTest

/// The demo home's main caregiver path (brief §8 screen gate: "a UI test for the main path"):
/// welcome → try the demo → role → name → code → paired → notifications → home → urgent alert → I'm On It,
/// with Xcode's accessibility audit on the home screen.
final class MainPathUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    func testDemoCaregiverMainPath() throws {
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"   // Debbie answers on the phone: no network in tests
        app.launch()
        app.buttons["tryDemo"].tapWhenReady()
        app.buttons["roleContinue"].tapWhenReady()
        app.buttons["nameContinue"].tapWhenReady()
        XCTAssertTrue(app.staticTexts["Check the code"].waitForExistence(timeout: 5))
        app.buttons["pairedContinue"].tapWhenReady(timeout: 10)
        app.buttons["Continue"].tapWhenReady()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 5) { allow.tap() }
        XCTAssertTrue(app.buttons["tab.home"].waitForExistence(timeout: 10), "the caregiver tabs appear after onboarding")
        let fall = app.staticTexts["Possible fall"]
        XCTAssertTrue(fall.waitForExistence(timeout: 15), "the demo's urgent alert should arrive")
        // The tab bar's frame, so the waiver below covers its items whatever identifier the audit reports for them.
        let bar = app.buttons["tab.home"].frame.union(app.buttons["tab.devices"].frame)
        try app.performAccessibilityAudit(for: [.dynamicType, .sufficientElementDescription, .hitRegion, .elementDetection, .trait]) { issue in
            let id = issue.element?.identifier ?? ""
            // System-drawn elements (status bar) are not Debbie's to fix.
            if id.hasPrefix("sb") { return true }
            // The tab bar and the corner Settings button clamp at xLarge, as the system's bars do, and show the Large
            // Content Viewer beyond that (research note 16 R6; D-029). Only that check is waived, only for those elements.
            let inBar = issue.element.map { bar.contains(CGPoint(x: $0.frame.midX, y: $0.frame.midY)) } ?? false
            if issue.auditType == .dynamicType, id.hasPrefix("tab.") || id == "settings" || inBar { return true }
            return false
        }
        // Home scrolls all the way: its last card ends above the floating tab bar (owner, 17:24).
        for _ in 0..<4 { app.swipeUp() }
        let lastCard = app.descendants(matching: .any)["heartRateCard"]
        XCTAssertTrue(lastCard.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(lastCard.frame.maxY, bar.minY + 1, "the heart-rate card scrolls clear of the tab bar")
        for _ in 0..<4 { app.swipeDown() }
        // Every tab is reachable from the bar and shows its one job.
        app.buttons["tab.live"].tapWhenReady()
        XCTAssertTrue(app.buttons["liveView"].waitForExistence(timeout: 5), "Live tab: Start Live View")
        app.buttons["tab.history"].tapWhenReady()
        XCTAssertTrue(app.staticTexts["History"].waitForExistence(timeout: 5), "History tab")
        app.buttons["tab.debbie"].tapWhenReady()
        let reply = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Debbie: '")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 8), "Debbie tab: she opens with an update")
        XCTAssertTrue(reply.label.contains("urgent alert"), "the unanswered urgent alert comes first")
        app.buttons["tab.devices"].tapWhenReady()
        XCTAssertTrue(app.buttons["addLaptop"].waitForExistence(timeout: 5), "Devices tab: Add a Laptop")
        XCTAssertTrue(app.buttons["tab.devices"].isSelected, "the tapped tab reports itself selected to VoiceOver")
        app.buttons["tab.home"].tapWhenReady()
        // Pushed screens go back with Debbie's Back button. (The edge swipe doesn't work with the system bar hidden;
        // D-014 outcome, listed in MORNING_REPORT.)
        fall.tapWhenReady()
        app.buttons["Back"].tapWhenReady()
        XCTAssertTrue(app.buttons["tab.home"].isSelected && fall.waitForExistence(timeout: 5), "Back returns to Home")
        app.buttons["I'm On It"].firstMatch.tapWhenReady()
        XCTAssertTrue(app.staticTexts["No alerts"].waitForExistence(timeout: 10) || !fall.exists)
    }
}

private extension XCUIElement {
    func tapWhenReady(timeout: TimeInterval = 5, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(waitForExistence(timeout: timeout), "\(self) never appeared", file: file, line: line)
        let deadline = Date().addingTimeInterval(timeout)
        while (!isHittable || !isEnabled) && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        tap()
    }
}
