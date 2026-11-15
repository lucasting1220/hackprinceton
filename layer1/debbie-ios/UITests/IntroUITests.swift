import XCTest

/// The launch intro (CRAFT.md §3.7; D-033): it plays on a cold launch to the welcome screen, ends in the welcome with
/// its buttons, and a tap skips it. `testIntroForRecording` only waits, for tools/video/record-intro.sh.
final class IntroUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    func testIntroEndsOnTheWelcome() {
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launch()
        // That the intro plays, and that its words stay unseen until the handoff, is shown by the recordings
        // (tools/video/record-intro.sh) and IntroShapeTests: XCUITest lists accessibility-hidden elements and ignores
        // SwiftUI hit-testing, so it can't tell an unseen button from a shown one. Here: the welcome arrives and works.
        let getStarted = app.buttons["getStarted"]
        XCTAssertTrue(getStarted.waitForExistence(timeout: 8), "the welcome arrives")
        let deadline = Date().addingTimeInterval(6)
        while !getStarted.isHittable && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        XCTAssertTrue(getStarted.isHittable, "and its buttons can be pressed")
        XCTAssertTrue(app.buttons["tryDemo"].exists)
        XCTAssertTrue(app.staticTexts["Hi, I'm Debbie."].exists)
        XCTAssertTrue(app.images["Debbie"].waitForExistence(timeout: 3), "the mark has become Debbie")
    }

    @MainActor
    func testATapSkipsToTheWelcome() {
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launch()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)).tap()
        XCTAssertTrue(app.buttons["getStarted"].waitForExistence(timeout: 2.5), "a tap brings the welcome straight away")
    }

    @MainActor
    func testIntroForRecording() {
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launchEnvironment["DEBBIE_REDUCE_MOTION"] = ProcessInfo.processInfo.environment["DEBBIE_REDUCE_MOTION"] ?? "off"
        app.launch()
        Thread.sleep(forTimeInterval: 5.5)
        XCTAssertTrue(app.buttons["getStarted"].exists)
    }
}
