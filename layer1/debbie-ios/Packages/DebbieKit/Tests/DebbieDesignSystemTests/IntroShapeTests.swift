@testable import DebbieDesignSystem
import Foundation
import SwiftUI
import Testing

/// The launch intro stays within CRAFT.md §3.7: a resting rhythm, the mark drawn exactly, an ordered timeline that
/// ends inside four seconds, every pose within bounds, and nothing moving under Reduce Motion.
@MainActor @Suite struct IntroShapeTests {
    typealias I = Motion.Intro
    static let box = CGRect(x: 0, y: 0, width: 100, height: 100)

    @Test func theTimelineIsOrderedAndShort() {
        let order: [TimeInterval] = [0, I.flowEnds, I.stemEntry, I.setBegins, I.wordmarkAt, I.handoffAt, I.arriveAt, I.doneAt]
        for (a, b) in zip(order, order.dropFirst()) { #expect(a < b, "\(a) before \(b)") }
        #expect(I.firstBeat + I.preroll > 0.3, "the first beat is already on the strip, whole, when the app appears")
        #expect(I.firstBeat + I.beatInterval > 0.2, "and the second strikes on screen, early")
        #expect(I.arriveAt + 0.25 <= 2.5, "the buttons are there within two and a half seconds")
        #expect(I.doneAt - I.handoffAt >= 0.8, "the overlays leave only once the present spring has settled (0.8 s)")
        #expect(I.reducedArriveAt >= I.reducedHandoffAt)
        #expect(I.stemEntry + I.flourish <= I.setBegins + 0.1, "the line sets as the outline closes")
        #expect(I.reducedDoneAt <= 1.6)
        #expect(abs(60 / I.beatInterval - 80) < 1, "a resting heart")
        // The third beat is the mark: its upstroke (the paper's stop) falls exactly one beat after the second R.
        #expect(abs(ECGWave.paperStop - (ECGWave.rPeaks[1] + CGFloat(I.beatInterval) * I.paperSpeed)) < 0.001, "an even rhythm into the mark")
        #expect(I.handoffAt <= 2.0, "the mark is finished and on its way within two seconds (owner, 22:55 and 23:30)")
    }

    @Test func theMarkIsDrawnWhereItIsFilled() {
        let outline = MarkGeometry.outline(in: Self.box)
        let b = outline.boundingRect
        #expect(abs(b.minX - 20) < 0.01 && abs(b.maxX - 86) < 0.01 && abs(b.minY - 16) < 0.01 && abs(b.maxY - 84) < 0.01, "\(b)")
        #expect(outline.currentPoint.map { abs($0.x - 20) < 0.01 && abs($0.y - 40) < 0.01 } == true, "closes at the entry")
        // Half-way round, the pen is on the bowl's far side.
        let mid = outline.trimmedPath(from: 0, to: 0.5).currentPoint
        #expect(mid.map { $0.x > 80 } == true, "\(String(describing: mid))")
        let fill = MarkGeometry.fill(in: Self.box).cgPath
        #expect(fill.contains(CGPoint(x: 30, y: 50), using: .evenOdd), "the stem is solid")
        #expect(!fill.contains(CGPoint(x: 49, y: 50), using: .evenOdd), "the window is open")
        #expect(fill.contains(CGPoint(x: 75, y: 50), using: .evenOdd), "the bowl is solid")
        #expect(!fill.contains(CGPoint(x: 10, y: 50), using: .evenOdd) && !fill.contains(CGPoint(x: 90, y: 50), using: .evenOdd))
        // The lead-in starts level on the baseline and ends at the entry, heading up.
        let fillet = MarkGeometry.fillet(in: Self.box)
        let fb = fillet.boundingRect
        #expect(abs(fb.minX - 10) < 0.01 && abs(fb.maxX - 20) < 0.01 && abs(fb.minY - 40) < 0.01 && abs(fb.maxY - 50) < 0.01, "\(fb)")
        #expect(fillet.currentPoint.map { abs($0.x - 20) < 0.01 && abs($0.y - 40) < 0.01 } == true)
    }

    @Test func theRhythmIsAHealthyRestingOne() {
        let v = I.paperSpeed
        let peaks = ECGWave.rPeaks
        #expect(peaks.count == 2 && abs(peaks[1] - peaks[0] - CGFloat(I.beatInterval) * v) < 0.001)
        var highest: CGFloat = 0, lowest: CGFloat = 0
        var u: CGFloat = 0
        while u <= ECGWave.paperStop { highest = max(highest, ECGWave.y(at: u)); lowest = min(lowest, ECGWave.y(at: u)); u += 0.25 }
        #expect(abs(highest - 58) < 0.5, "the R wave is the tallest thing: \(highest)")
        #expect(lowest > -13 && lowest < -11, "the S dip: \(lowest)")
        for r in peaks {
            #expect(abs(ECGWave.y(at: r) - 58) < 0.01)
            #expect(abs(ECGWave.y(at: r + CGFloat(I.beatInterval) * v / 2)) < 0.001, "flat between beats")
            #expect(ECGWave.y(at: r - 0.17 * v) > 5, "a P wave before each beat")
            #expect(ECGWave.y(at: r + 0.27 * v) > 10, "a T wave after each beat")
        }
        #expect(abs(ECGWave.y(at: ECGWave.paperStop - 12)) < 0.001, "level just before the stem")
        #expect(ECGWave.y(at: ECGWave.paperStop - 0.17 * v) > 5, "the third beat's P wave as the paper slows")
    }

    @Test func everyPoseStaysWithinBounds() {
        var previousPaper: CGFloat = -1
        var t: TimeInterval = 0
        while t <= I.doneAt + 0.5 {
            let p = IntroPose.at(t, reduce: false)
            #expect(p.paper >= previousPaper, "the paper never runs backwards")
            previousPaper = p.paper
            for (name, a) in [("trail", p.trailAlpha), ("stroke", p.strokeAlpha), ("fill", p.fillAlpha), ("tile", p.tileAlpha), ("halo", p.haloAlpha),
                              ("pen", p.penAlpha), ("wordmark", p.wordmarkAlpha), ("lockup", p.lockupAlpha), ("fillet", p.fillet), ("outline", p.outline), ("wipe", p.wipe)] {
                #expect((0...1).contains(a), "\(name) at \(t): \(a)")
            }
            #expect((0.5...1.05).contains(p.tileScale), "tile scale at \(t): \(p.tileScale)")
            #expect((3...5).contains(p.strokeWidth))
            t += 1.0 / 60
        }
        let atEntry = IntroPose.at(I.stemEntry, reduce: false)
        #expect(abs(atEntry.paper - ECGWave.paperStop) < 0.001 && atEntry.fillet == 1 && atEntry.outline == 0)
        #expect(IntroPose.at(I.stemEntry - 0.01, reduce: false).outline == 0)
        #expect(IntroPose.at(I.stemEntry + I.flourish, reduce: false).outline == 1)
        let done = IntroPose.at(I.doneAt, reduce: false)
        #expect(abs(done.tileScale - 1) < 0.01 && abs(done.tileShift) < 0.01 && done.fillAlpha == 1 && done.strokeAlpha == 0 && done.wordmarkAlpha == 1
                && done.penAlpha == 0 && done.haloAlpha == 0, "everything has arrived by doneAt")
        let atHandoff = IntroPose.at(I.handoffAt, reduce: false)
        #expect(atHandoff.fillAlpha == 1 && atHandoff.wordmarkAlpha == 1 && abs(atHandoff.tileScale - 1) < 0.01, "the lockup is whole when it starts to glide")
    }

    @Test func reduceMotionShowsTheFinishedLockupFadingIn() {
        for t in stride(from: 0.0, through: 2.0, by: 0.1) {
            let p = IntroPose.at(t, reduce: true)
            #expect(p.penAlpha == 0 && p.trailAlpha == 0 && p.tileScale == 1 && p.tileShift == 0, "nothing moves at \(t)")
        }
        #expect(IntroPose.at(0, reduce: true).lockupAlpha == 0)
        #expect(IntroPose.at(0.3, reduce: true).lockupAlpha == 1)
    }

    @Test func thePenStaysOnTheStemAndTheTraceEndsAtThePen() {
        let layout = IntroLayout(size: CGSize(width: 375, height: 667))
        // Times while the paper still flows and before the lead-in begins (the lead-in starts near 0.94 s).
        for t in [0.0, 0.3, 0.7, 0.9] {
            let flowing = IntroPose.at(t, reduce: false)
            let pen = layout.pen(flowing)
            #expect(abs(pen.x - layout.penX) < 0.001, "while the paper moves, the pen does not (\(t) s)")
            let trail = layout.trail(flowing)
            #expect(trail.currentPoint.map { abs($0.x - layout.penX) < 0.001 && abs($0.y - pen.y) < 0.001 } == true, "the trace ends under the pen (\(t) s)")
        }
        #expect(layout.trail(IntroPose.at(0, reduce: false)).boundingRect.width > 60, "the monitor is already running in the first frame")
        #expect(layout.trail(IntroPose.at(0.4, reduce: false)).boundingRect.minX > 0, "the line is still reaching the left edge at 0.4 s")
        #expect(layout.trail(IntroPose.at(1.0, reduce: false)).boundingRect.minX <= 0, "and has reached it by 1 s")
        // When the outline closes, the pen is back at the entry, which is where the lead-in ended.
        let closed = IntroPose.at(I.stemEntry + I.flourish, reduce: false)
        let entry = MarkGeometry.fillet(in: layout.markBox).currentPoint
        let end = layout.pen(closed)
        #expect(entry.map { abs($0.x - end.x) < 0.01 && abs($0.y - end.y) < 0.01 } == true)
        #expect(layout.tile.midX == 187.5 && layout.wordmark.midX == 187.5, "the lockup is centred")
    }

    @Test func theSpikesKeepTheirHeightWhateverTheFrameTiming() {
        // The sample grid is fixed to the paper, so an R peak is drawn at full height whichever sub-point the paper is at.
        let layout = IntroLayout(size: CGSize(width: 375, height: 667))
        var pose = IntroPose.at(1.2, reduce: false)
        for paper: CGFloat in [250.0, 250.13, 250.26, 250.37, 251.49, 262.07] {
            pose.paper = paper
            let top = layout.trail(pose).boundingRect.minY
            #expect(abs((layout.baseline - top) - 58) < 0.05, "R peak height at paper \(paper): \(layout.baseline - top)")
        }
    }
}
