import XCTest

/// Captures the Debug-only component gallery (App/DebbieDebugTools/DebbieGallery.swift) for the designer kit.
/// - `testCaptureEverySection` scrolls to each `gallery.<name>` container until it is fully on screen and attaches a
///   screenshot of just that container, named exactly `<name>`. The capture step saves them as
///   DesignerKit/08-components/renders/<name>.png, and as renders/increase-contrast/<name>.png on a run with
///   Increase Contrast on.
/// - The two recording tests hold an animated section still on screen while the Simulator is recorded.
final class GalleryUITests: XCTestCase {
    /// Every gallery section, top to bottom. Keep in step with DebbieGallery (the first test checks the count).
    static let sections = [
        "buttons", "buttons-primary", "buttons-secondary", "buttons-quiet", "buttons-destructive", "buttons-urgent",
        "button-labels", "resident-sync",
        "switch", "choice-cards", "text-field", "cards",
        "status-rows-state", "status-rows-inline", "status-rows-labelled",
        "status-header-on", "status-header-limited", "status-header-unknown", "status-header-cant-connect",
        "status-header-cant-reach", "status-header-removed",
        "alert-card-urgent", "alert-card-acknowledged", "alert-card-attention", "alert-card-info", "alert-card-late",
        "heart-rate-card", "reading",
        "tab-bar", "tab-bar-over-content", "corner-button", "top-bar", "sheet-header", "confirm-sheet",
        "confirm-sheet-destructive", "tab-screen-header", "tab-screen-home", "pinned-action", "live-bar",
        "chat-bubbles", "typing-indicator", "suggestion-chips", "composer",
        "avatar-sizes", "debbie-guide", "debbie-with-badge",
        "empty-state", "priming", "code-display", "spinner",
        "icons", "icons-filled", "icon-animations", "debbie-idle",
    ]

    private var app: XCUIApplication!
    /// Where content is fully visible: below the status bar and above the home indicator, in screen points.
    private var band = CGRect.zero

    override func setUp() { continueAfterFailure = true }

    @MainActor
    func testCaptureEverySection() {
        launch()
        let containers = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'gallery.'"))
        XCTAssertEqual(containers.count, Self.sections.count, "GalleryUITests.sections is out of step with DebbieGallery")
        for name in Self.sections {
            let section = element(name)
            guard reveal(section) else {
                XCTFail("gallery.\(name) never came fully into view")
                continue
            }
            let shot = XCTAttachment(screenshot: section.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
    }

    /// Every icon effect replays every 2 s; record the Simulator during the 14 s hold.
    @MainActor
    func testIconAnimationsForRecording() {
        launch()
        XCTAssertTrue(reveal(element("icon-animations")), "gallery.icon-animations never came fully into view")
        Thread.sleep(forTimeInterval: 14)
    }

    /// Debbie idles at hero size; record the Simulator during the 12 s hold.
    @MainActor
    func testDebbieIdleForRecording() {
        launch()
        XCTAssertTrue(reveal(element("debbie-idle")), "gallery.debbie-idle never came fully into view")
        Thread.sleep(forTimeInterval: 12)
    }

    // MARK: Helpers

    @MainActor
    private func launch() {
        app = XCUIApplication()
        app.launchEnvironment["DEBBIE_GALLERY"] = "1"
        app.launchEnvironment["DEBBIE_ASSISTANT"] = "offline"
        app.launchEnvironment["DEBBIE_REDUCE_MOTION"] = ProcessInfo.processInfo.environment["DEBBIE_REDUCE_MOTION"] ?? "off"
        app.launch()
        let header = app.descendants(matching: .any)["galleryHeader"]
        XCTAssertTrue(header.waitForExistence(timeout: 15), "The gallery didn't open")
        // Before any scrolling, the header's top edge is where the safe area starts. Phones with a top inset this deep
        // also have a 34 pt home-indicator inset at the bottom.
        let window = app.windows.firstMatch.frame
        let top = max(header.frame.minY, window.minY)
        let bottom = window.maxY - (top - window.minY > 24 ? 34 : 0)
        band = CGRect(x: window.minX, y: top, width: window.width, height: bottom - top)
    }

    @MainActor
    private func element(_ name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "gallery.\(name)").firstMatch
    }

    /// Scrolls until `element` is fully inside the clear band, aiming its top just below the band's top.
    /// A section taller than the band is shown from its top.
    @MainActor
    private func reveal(_ element: XCUIElement) -> Bool {
        guard element.waitForExistence(timeout: 5) else { return false }
        var frame = settledFrame(of: element)
        var stuck = 0
        for _ in 0..<30 {
            if fits(frame) { return true }
            drag(by: frame.minY - (band.minY + 16))
            let next = settledFrame(of: element)
            if abs(next.minY - frame.minY) < 0.5 {
                // Twice without moving: the very top or bottom of the gallery. Take it if its top is on screen.
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

    /// The frame once scrolling has stopped (two reads 0.2 s apart agree).
    @MainActor
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

    /// Moves the content up by `dy` points (down when negative) with a slow drag that ends still, so nothing flings.
    /// The drag runs down the left margin, clear of every control.
    @MainActor
    private func drag(by dy: CGFloat) {
        let limit = band.height - 140
        var distance = max(-limit, min(limit, dy))
        // A drag shorter than the pan's slop doesn't scroll at all.
        if abs(distance) < 24 { distance = distance < 0 ? -24 : 24 }
        let window = app.windows.firstMatch
        let origin = window.coordinate(withNormalizedOffset: .zero)
        let fromY = (distance > 0 ? band.maxY - 70 : band.minY + 70) - window.frame.minY
        let from = origin.withOffset(CGVector(dx: 10, dy: fromY))
        let to = origin.withOffset(CGVector(dx: 10, dy: fromY - distance))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.2)
    }
}
