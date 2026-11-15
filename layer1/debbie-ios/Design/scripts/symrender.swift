// Renders one custom symbol from a compiled asset catalog beside system text, at
// UltraLight 17, Regular 17, Black 17, Regular 34 and Semibold 56 pt, so a reviewer
// can check weight, baseline and optical size against real text (CRAFT.md §2.6).
// Usage: symrender <bundle-path> <symbol-name> <out.png> [--dark]
import AppKit
import SwiftUI

let args = CommandLine.arguments
guard args.count >= 4, let bundle = Bundle(path: args[1]) else {
    print("usage: symrender <bundle> <name> <out.png> [--dark]"); exit(2)
}
let name = args[2], out = args[3], dark = args.contains("--dark")

struct Row: View {
    let bundle: Bundle; let name: String; let weight: Font.Weight; let size: CGFloat
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(name, bundle: bundle)
            Text("Home Hg")
        }
        .font(.system(size: size, weight: weight))
    }
}

struct Sheet: View {
    let bundle: Bundle; let name: String; let dark: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Row(bundle: bundle, name: name, weight: .ultraLight, size: 17)
            Row(bundle: bundle, name: name, weight: .regular, size: 17)
            Row(bundle: bundle, name: name, weight: .black, size: 17)
            Row(bundle: bundle, name: name, weight: .regular, size: 34)
            Row(bundle: bundle, name: name, weight: .semibold, size: 56)
        }
        .foregroundStyle(dark ? Color.white : Color.black)
        .padding(16)
        .background(dark ? Color.black : Color.white)
    }
}

@MainActor func run() {
    let r = ImageRenderer(content: Sheet(bundle: bundle, name: name, dark: dark))
    r.scale = 2
    guard let img = r.cgImage else { print("render failed"); exit(1) }
    let rep = NSBitmapImageRep(cgImage: img)
    guard let data = rep.representation(using: .png, properties: [:]) else { exit(1) }
    do { try data.write(to: URL(fileURLWithPath: out)) } catch { print("write failed: \(error)"); exit(1) }
    print("ok \(img.width)x\(img.height) \(name)")
}
MainActor.assumeIsolated { run() }
