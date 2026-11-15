import XCTest

/// Drives the transitions recorded for the screen gate (brief §8: "screen recordings of every transition and
/// animated state change … including one interrupted mid-flight"). tools/video/record.sh records the Simulator
/// while this runs; tools/video/frames.swift extracts the frames that are inspected.
final class RecordingUITests: XCTestCase {
    @MainActor
    func testTransitionsForRecording() throws {
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_REDUCE_MOTION"] = ProcessInfo.processInfo.environment["DEBBIE_REDUCE_MOTION"] ?? "off"
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launch()
        pause(1)
        app.buttons["tryDemo"].tapWhenReady(); pause(1)                      // welcome → onboarding (cross-fade)
        app.staticTexts["The person at home"].tapWhenReady(); pause(0.6)     // choice card spring
        app.staticTexts["A family member"].tapWhenReady(); pause(0.6)
        app.buttons["roleContinue"].tapWhenReady(); pause(1)                 // push to the name step
        app.buttons["nameContinue"].tapWhenReady()
        app.buttons["pairedContinue"].tapWhenReady(timeout: 12); pause(1)    // code → paired (success settle)
        app.buttons["Continue"].tapWhenReady()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        XCTAssertTrue(app.staticTexts["Possible fall"].waitForExistence(timeout: 20)); pause(1.5)  // urgent alert arrives
        app.buttons["tab.live"].tapWhenReady(); pause(1)                     // tab switch: highlight slides, camera icon pops
        app.buttons["tab.history"].tap(); app.buttons["tab.devices"].tap(); pause(1.2)  // interrupted: retargets mid-flight
        app.buttons["tab.debbie"].tapWhenReady(); pause(3)                   // Debbie: typing dots, then her update arrives
        app.buttons["tab.home"].tapWhenReady(); pause(1)
        app.staticTexts["Possible fall"].tapWhenReady(); pause(1)            // push to the alert
        app.buttons["Back"].tapWhenReady(); pause(1)                         // pop
        app.buttons["settings"].tapWhenReady(); pause(1)                     // gear turns, Settings sheet rises
        app.buttons["Close"].tapWhenReady(); pause(1)
        app.buttons["tab.live"].tapWhenReady(); pause(0.8)
        app.buttons["liveView"].tapWhenReady(); pause(4)                      // requesting → connecting → playing
        app.buttons["stopLive"].tapWhenReady(); pause(1.5)                   // ending → ended
        app.buttons["Done"].tapWhenReady(); pause(1)
        app.buttons["tab.home"].tapWhenReady(); pause(1)
        app.buttons["I'm On It"].firstMatch.tapWhenReady(); pause(1.5)       // acknowledged card leaves
    }

    /// The person at home (S15) for the designer kit's resident.mp4: the demo's resident set-up, the resident screen
    /// with the demo's first reading, then Sync Now (Sending…, the sent line, the heart beats).
    @MainActor
    func testResidentForRecording() throws {
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_REDUCE_MOTION"] = ProcessInfo.processInfo.environment["DEBBIE_REDUCE_MOTION"] ?? "off"
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launch()
        pause(1.5)
        app.buttons["tryDemo"].tapWhenReady(); pause(1)                      // welcome → Set Up (cross-fade)
        app.staticTexts["The person at home"].tapWhenReady(); pause(1)       // choice card spring
        app.buttons["roleContinue"].tapWhenReady(); pause(1.2)               // push to the name step
        app.buttons["nameContinue"].tapWhenReady()                           // the demo laptop confirms the code after 5 s
        XCTAssertTrue(app.buttons["pairedContinue"].waitForExistence(timeout: 12), "the paired step")
        pause(1.5)                                                           // paired: Debbie with the success badge
        app.buttons["pairedContinue"].tapWhenReady(); pause(1.5)             // heart-rate priming
        app.buttons["Continue"].tapWhenReady(); pause(1)                     // → the resident screen
        XCTAssertTrue(app.buttons["syncNow"].waitForExistence(timeout: 8), "the resident screen opens")
        pause(3)                                                             // the demo's first reading arrives; the heart beats
        app.buttons["syncNow"].tapWhenReady(); pause(3.5)                    // Sending… then the sent line updates; the heart beats
    }

    /// Designer kit (tools/design/kit/capture.sh): captures the gallery sections named in KIT_SECTIONS (comma-separated,
    /// passed as TEST_RUNNER_KIT_SECTIONS) the way GalleryUITests.testCaptureEverySection does, but holds each one still
    /// for 2 s first. That run's screenshots come right after scrolling, so some show the gallery's scroll indicator;
    /// capture.sh finds those and retakes them here.
    @MainActor
    func testGallerySectionsWithoutScrollIndicator() throws {
        let names = (ProcessInfo.processInfo.environment["KIT_SECTIONS"] ?? "").split(separator: ",").map(String.init)
        try XCTSkipIf(names.isEmpty, "Name the sections in TEST_RUNNER_KIT_SECTIONS")
        let app = XCUIApplication()
        app.launchEnvironment["DEBBIE_RESET"] = "1"   // start unpaired
        app.launchEnvironment["DEBBIE_INTRO"] = "off"   // the intro has its own tests
        app.launchEnvironment["DEBBIE_GALLERY"] = "1"
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launchEnvironment["DEBBIE_REDUCE_MOTION"] = "off"
        app.launch()
        let header = app.descendants(matching: .any)["galleryHeader"]
        XCTAssertTrue(header.waitForExistence(timeout: 15), "The gallery didn't open")
        let gallery = KitGallery(app: app, header: header)
        for name in names {
            let section = app.descendants(matching: .any).matching(identifier: "gallery.\(name)").firstMatch
            guard gallery.reveal(section) else {
                XCTFail("gallery.\(name) never came fully into view")
                continue
            }
            pause(2)
            let shot = XCTAttachment(screenshot: section.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
    }

    private func pause(_ s: TimeInterval) { Thread.sleep(forTimeInterval: s) }
}

/// GalleryUITests' framing, unchanged: scroll a section until it sits fully inside the clear band (below the status bar,
/// above the home indicator), its top just below the band's top.
@MainActor
private struct KitGallery {
    let app: XCUIApplication
    let band: CGRect

    init(app: XCUIApplication, header: XCUIElement) {
        self.app = app
        let window = app.windows.firstMatch.frame
        let top = max(header.frame.minY, window.minY)
        let bottom = window.maxY - (top - window.minY > 24 ? 34 : 0)
        band = CGRect(x: window.minX, y: top, width: window.width, height: bottom - top)
    }

    func reveal(_ element: XCUIElement) -> Bool {
        guard element.waitForExistence(timeout: 5) else { return false }
        var frame = settledFrame(of: element)
        var stuck = 0
        for _ in 0..<30 {
            if fits(frame) { return true }
            drag(by: frame.minY - (band.minY + 16))
            let next = settledFrame(of: element)
            if abs(next.minY - frame.minY) < 0.5 {
                stuck += 1
                if stuck >= 2 { return next.minY >= band.minY - 1 }
            } else {
                stuck = 0
            }
            frame = next
        }
        return fits(frame)
    }

    private func fits(_ f: CGRect) -> Bool {
        if f.height > band.height { return f.minY >= band.minY - 1 && f.minY <= band.minY + 40 }
        return f.minY >= band.minY - 1 && f.maxY <= band.maxY + 1
    }

    private func settledFrame(of element: XCUIElement) -> CGRect {
        var last = element.frame
        for _ in 0..<10 {
            Thread.sleep(forTimeInterval: 0.2)
            let now = element.frame
            if abs(now.minY - last.minY) < 0.5 { return now }
            last = now
        }
        return last
    }

    private func drag(by dy: CGFloat) {
        let limit = band.height - 140
        var distance = max(-limit, min(limit, dy))
        if abs(distance) < 24 { distance = distance < 0 ? -24 : 24 }
        let window = app.windows.firstMatch
        let origin = window.coordinate(withNormalizedOffset: .zero)
        let fromY = (distance > 0 ? band.maxY - 70 : band.minY + 70) - window.frame.minY
        let from = origin.withOffset(CGVector(dx: 10, dy: fromY))
        let to = origin.withOffset(CGVector(dx: 10, dy: fromY - distance))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.2)
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
