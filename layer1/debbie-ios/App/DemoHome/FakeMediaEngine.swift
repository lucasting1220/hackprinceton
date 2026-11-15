#if DEBBIE_DEMO_HOME
import DebbieCore
import DebbieDesignSystem
import DebbieFeatures
import DebbieNetworking
import SwiftUI

/// Demo-only video: a calm, abstract animated room labelled "Demo camera" (DEMO_HOME.md). Never used by a real pairing.
@MainActor
final class FakeMediaEngine: LiveMediaEngine {
    func start(viewer: LiveViewSession.Viewer?) async throws { try await Task.sleep(for: .milliseconds(900)) }
    func stop() {}
    var videoView: AnyView { AnyView(DemoCameraView()) }
}

private struct DemoCameraView: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 15.0)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color.dSunken))
                ctx.fill(Path(CGRect(x: 0, y: size.height * 0.72, width: size.width, height: size.height * 0.28)), with: .color(Color.dMintTint))
                let x = size.width * (0.5 + 0.3 * sin(t / 6))
                ctx.fill(Path(ellipseIn: CGRect(x: x - 22, y: size.height * 0.45, width: 44, height: 44)), with: .color(Color.dMint))
                ctx.fill(Path(roundedRect: CGRect(x: size.width * 0.12, y: size.height * 0.30, width: size.width * 0.22, height: size.height * 0.42), cornerRadius: Radius.r12), with: .color(Color.dSurface))
            }
            .overlay(alignment: .bottomLeading) {
                Text("Demo camera").font(DType.secondary).foregroundStyle(Color.dText).padding(Space.s8)
                    .background(Color.dSurface, in: Capsule()).padding(Space.s12)
            }
        }
        .aspectRatio(4.0 / 3.0, contentMode: .fit)
    }
}
#endif
