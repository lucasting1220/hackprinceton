import XCTest

/// Every setup step that has somewhere to go back to has Back (owner, 17:40: "when you get to the QR code screen,
/// there is no back button"). Walks the real pairing path to Scan the Code, then backs out step by step to the
/// first screen. Each step's screenshot is kept as evidence.
final class OnboardingBackUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    func testBackFromEveryStepUpToScanTheCode() {
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launch()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

        app.buttons["getStarted"].tapWhenReady()
        app.buttons["roleContinue"].tapWhenReady()
        XCTAssertTrue(app.staticTexts["Let's find your home laptop"].waitForExistence(timeout: 5), "local network priming")
        app.buttons["Continue"].tapWhenReady()
        XCTAssertTrue(app.staticTexts["Scan the code on the laptop"].waitForExistence(timeout: 5), "camera priming")
        app.buttons["Continue"].tapWhenReady()
        for label in ["Allow", "OK"] where springboard.alerts.buttons[label].waitForExistence(timeout: 3) { springboard.alerts.buttons[label].tap() }
        let scanHint = app.staticTexts["Point the camera at the code on the home laptop's setup page."]
        XCTAssertTrue(scanHint.waitForExistence(timeout: 8), "the Scan the Code step")
        keep("scan-step")

        // Scan → camera priming → local network priming → role → the first screen.
        back(expecting: app.staticTexts["Scan the code on the laptop"], "Back from Scan the Code")
        back(expecting: app.staticTexts["Let's find your home laptop"], "Back from the camera priming")
        back(expecting: app.buttons["roleContinue"], "Back from the local network priming")
        back(expecting: app.buttons["getStarted"], "Back from the role step")
    }

    @MainActor
    private func back(expecting next: XCUIElement, _ what: String) {
        let app = XCUIApplication()
        XCTAssertTrue(app.buttons["Back"].waitForExistence(timeout: 5), "\(what): the Back button exists")
        app.buttons["Back"].tapWhenReady()
        XCTAssertTrue(next.waitForExistence(timeout: 5), "\(what) arrives at the step before")
        Thread.sleep(forTimeInterval: 0.6)
        keep(what)
    }

    @MainActor
    private func keep(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
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
