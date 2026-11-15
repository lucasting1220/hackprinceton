// Designer kit helper (used only by tools/design/kit/icons-debbie.sh; nothing here ships).
// Renders Debbie's custom symbols for the designer kit from the symbol templates the app compiles
// (dx.<name>.symbolset, written by Design/scripts/symbols.swift): the filled outline for one weight at the M scale,
// at a text size, centred in a square tile, and checks each glyph against SwiftUI's own rendering of the compiled
// symbol (`Image("dx.<name>", bundle:)` with that font, which is what DIcon draws; symrender.swift renders the review
// sheets the same way).
//
//   icons-debbie-icons <Review.bundle> <Symbols.xcassets> <out-dir> <ink-hex> <accent-hex> <name>...
//
// Tiles (each glyph is the app's own size and weight for that use):
//   24pt  the glyph at 17 pt Semibold (DType.headline, DType.button: buttons, rows, Back, Close, the live bar)
//   28pt  the glyph at 20 pt Medium (DType.tabIcon in the tab bar's 28 pt icon box, Size.tabIcon; DType.cornerIcon)
// For each icon and tile it writes:
//   png/<tile>/<ink|accent>/<name>.png, <name>@2x.png, <name>@3x.png   transparent, 8-bit sRGB
//   svg-outlined/<tile>/<name>.svg   the same outline as vector, in ink
// The glyph's ink box is centred in the tile, as SwiftUI centres a symbol in a frame. (SwiftUI then snaps it to the
// pixel grid, so its own renders sit up to about half a point off centre, differently at each scale; these don't.)
// Checks: every opaque pixel is exactly the requested colour; nothing touches a tile edge; and at @3x the glyph has
// the same ink area (within 2 %), ink box (within 1.5 px) and centre (within 0.5 pt) as SwiftUI's render.
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

struct Tile {
    let name: String
    let pt: CGFloat
    let font: CGFloat
    let weight: Font.Weight
    let variant: String   // the symbol template's group for this weight at the M scale
}

let tiles = [
    Tile(name: "24pt", pt: 24, font: 17, weight: .semibold, variant: "Semibold-M"),
    Tile(name: "28pt", pt: 28, font: 20, weight: .medium, variant: "Medium-M"),
]
let scales: [CGFloat] = [1, 2, 3]
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("icons-debbie-icons: \(message)\n".utf8))
    exit(1)
}

func rgb(_ hex: String) -> (UInt8, UInt8, UInt8) {
    guard hex.hasPrefix("#"), hex.count == 7, let v = Int(hex.dropFirst(), radix: 16) else { fail("bad colour \(hex)") }
    return (UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF))
}

func bitmap(_ w: Int, _ h: Int) -> CGContext {
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: srgb,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("no bitmap context") }
    return ctx
}

/// Premultiplied RGBA bytes, row 0 at the top.
func pixels(_ img: CGImage) -> [UInt8] {
    let ctx = bitmap(img.width, img.height)
    ctx.interpolationQuality = .none
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
    let n = img.width * img.height * 4
    return Array(UnsafeBufferPointer(start: ctx.data!.assumingMemoryBound(to: UInt8.self), count: n))
}

/// The image redrawn into 8-bit sRGB, so every PNG is tagged and stored the same way.
func normalised(_ img: CGImage) -> CGImage {
    let ctx = bitmap(img.width, img.height)
    ctx.interpolationQuality = .none
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
    return ctx.makeImage()!
}

func writePNG(_ img: CGImage, _ path: String) {
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fail("cannot create \(path)")
    }
    CGImageDestinationAddImage(dest, img, nil)
    guard CGImageDestinationFinalize(dest) else { fail("cannot write \(path)") }
}

// MARK: - the symbol template's outline

/// The filled outline symbols.swift wrote for one weight × scale: absolute M/L/Q/C/Z commands in template units
/// (1 unit = 1 pt at a 100 pt text size), x from the ink's left edge, y measured from the baseline (negative = up).
func templatePath(_ catalog: String, _ name: String, _ variant: String) -> CGPath {
    let file = "\(catalog)/dx.\(name).symbolset/dx.\(name).svg"
    guard let text = try? String(contentsOfFile: file, encoding: .utf8) else { fail("cannot read \(file)") }
    let pattern = #"<g id=""# + variant + #"" transform="matrix\(1 0 0 1 [-0-9.]+ [-0-9.]+\)">\s*<path d="([^"]*)"/>"#
    guard let re = try? NSRegularExpression(pattern: pattern),
          let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let r = Range(m.range(at: 1), in: text) else { fail("\(file) has no \(variant) group") }
    let d = String(text[r])
    let tokenRe = try! NSRegularExpression(pattern: #"[MLQCZ]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"#)
    let tokens = tokenRe.matches(in: d, range: NSRange(d.startIndex..., in: d)).map { String(d[Range($0.range, in: d)!]) }
    let p = CGMutablePath()
    var i = 0
    func n() -> CGFloat {
        guard i < tokens.count, let v = Double(tokens[i]) else { fail("bad path data in \(file)") }
        i += 1
        return CGFloat(v)
    }
    while i < tokens.count {
        let cmd = tokens[i]; i += 1
        switch cmd {
        case "M": p.move(to: CGPoint(x: n(), y: n()))
        case "L": p.addLine(to: CGPoint(x: n(), y: n()))
        case "Q": let c = CGPoint(x: n(), y: n()); p.addQuadCurve(to: CGPoint(x: n(), y: n()), control: c)
        case "C":
            let c1 = CGPoint(x: n(), y: n()), c2 = CGPoint(x: n(), y: n())
            p.addCurve(to: CGPoint(x: n(), y: n()), control1: c1, control2: c2)
        case "Z": p.closeSubpath()
        default: fail("unexpected path command \(cmd) in \(file)")
        }
    }
    return p
}

func svgPathData(_ p: CGPath) -> String {
    var out: [String] = []
    func f(_ v: CGFloat) -> String {
        var s = String(format: "%.4f", Double(v))
        while s.contains(".") && (s.hasSuffix("0") || s.hasSuffix(".")) { s.removeLast() }
        return s == "-0" ? "0" : s
    }
    p.applyWithBlock { el in
        let e = el.pointee, pt = e.points
        switch e.type {
        case .moveToPoint: out.append("M\(f(pt[0].x)) \(f(pt[0].y))")
        case .addLineToPoint: out.append("L\(f(pt[0].x)) \(f(pt[0].y))")
        case .addQuadCurveToPoint: out.append("Q\(f(pt[0].x)) \(f(pt[0].y)) \(f(pt[1].x)) \(f(pt[1].y))")
        case .addCurveToPoint: out.append("C\(f(pt[0].x)) \(f(pt[0].y)) \(f(pt[1].x)) \(f(pt[1].y)) \(f(pt[2].x)) \(f(pt[2].y))")
        case .closeSubpath: out.append("Z")
        @unknown default: break
        }
    }
    return out.joined(separator: " ")
}

/// The glyph placed in a tile the way SwiftUI places a symbol image in a frame: its ink box centred.
func placed(_ path: CGPath, _ tile: Tile) -> CGPath {
    let bb = path.boundingBoxOfPath
    let s = tile.font / 100
    var t = CGAffineTransform(translationX: tile.pt / 2, y: tile.pt / 2).scaledBy(x: s, y: s).translatedBy(x: -bb.midX, y: -bb.midY)
    guard let out = path.copy(using: &t) else { fail("transform failed") }
    return out
}

// MARK: - checks

/// Ink area (sum of alpha, in px), ink box (pixels with alpha > 0) and alpha-weighted centre of a square RGBA buffer.
func measure(_ px: [UInt8], _ side: Int) -> (area: Double, box: CGRect, centre: CGPoint) {
    var sx = 0.0, sy = 0.0, sum = 0.0
    var minX = side, minY = side, maxX = -1, maxY = -1
    for y in 0..<side {
        for x in 0..<side {
            let a = Double(px[(y * side + x) * 4 + 3])
            if a == 0 { continue }
            sx += a * (Double(x) + 0.5); sy += a * (Double(y) + 0.5); sum += a
            minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
        }
    }
    guard maxX >= 0 else { fail("empty glyph") }
    return (sum / 255, CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1),
            CGPoint(x: sx / sum, y: sy / sum))
}

// MARK: - main

@MainActor func run() {
    let args = CommandLine.arguments
    guard args.count >= 7, let bundle = Bundle(path: args[1]) else {
        fail("usage: icons-debbie-icons <Review.bundle> <Symbols.xcassets> <out-dir> <ink-hex> <accent-hex> <name>...")
    }
    let catalog = args[2], out = args[3]
    let colours: [(name: String, hex: String)] = [("ink", args[4].uppercased()), ("accent", args[5].uppercased())]
    let names = Array(args.dropFirst(6))
    var worstShift = 0.0, worstShiftAt = "", worstArea = 0.0, worstBox: CGFloat = 0, pngs = 0, svgs = 0

    for name in names {
        for tile in tiles {
            let outline = placed(templatePath(catalog, name, tile.variant), tile)
            let svg = """
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \(Int(tile.pt)) \(Int(tile.pt))" width="\(Int(tile.pt))" height="\(Int(tile.pt))">
              <!-- Debbie icon \(name), \(tile.name) tile: the glyph at \(Int(tile.font)) pt \(tile.variant.replacingOccurrences(of: "-M", with: "")), as the app draws it. Generated by tools/design/kit/icons-debbie.sh. -->
              <path fill="\(colours[0].hex)" d="\(svgPathData(outline))"/>
            </svg>

            """
            let svgFile = "\(out)/svg-outlined/\(tile.name)/\(name).svg"
            try? FileManager.default.createDirectory(atPath: "\(out)/svg-outlined/\(tile.name)", withIntermediateDirectories: true)
            do { try svg.write(toFile: svgFile, atomically: true, encoding: .utf8) } catch { fail("cannot write \(svgFile)") }
            svgs += 1

            for colour in colours {
                let (r, g, b) = rgb(colour.hex)
                let fill = Color(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255, opacity: 1)
                for k in scales {
                    let side = Int(tile.pt * k)
                    let ctx = bitmap(side, side)
                    ctx.translateBy(x: 0, y: CGFloat(side))   // SVG space: y grows downwards
                    ctx.scaleBy(x: k, y: -k)
                    ctx.addPath(outline)
                    ctx.setFillColor(CGColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1))
                    ctx.fillPath(using: .winding)
                    let img = ctx.makeImage()!
                    let px = pixels(img)
                    var opaque = 0, wrong = 0
                    for i in stride(from: 0, to: px.count, by: 4) where px[i + 3] == 255 {
                        opaque += 1
                        if px[i] != r || px[i + 1] != g || px[i + 2] != b { wrong += 1 }
                    }
                    guard opaque > 0, wrong == 0 else { fail("dx.\(name) \(colour.name) @\(Int(k))x: \(wrong) of \(opaque) opaque pixels are not \(colour.hex)") }
                    for x in 0..<side {
                        for y in [0, side - 1] where px[(y * side + x) * 4 + 3] > 0 || px[(x * side + y) * 4 + 3] > 0 {
                            fail("dx.\(name) touches the edge of the \(tile.name) tile")
                        }
                    }
                    let suffix = k == 1 ? "" : "@\(Int(k))x"
                    writePNG(img, "\(out)/png/\(tile.name)/\(colour.name)/\(name)\(suffix).png")
                    pngs += 1
                    guard k == 3 && colour.name == "ink" else { continue }
                    // The same glyph as SwiftUI draws it from the compiled catalog.
                    let view = Image("dx.\(name)", bundle: bundle)
                        .font(.system(size: tile.font, weight: tile.weight))
                        .foregroundStyle(fill)
                        .frame(width: tile.pt, height: tile.pt)
                    let renderer = ImageRenderer(content: view)
                    renderer.scale = k
                    renderer.isOpaque = false
                    guard let raw = renderer.cgImage else { fail("SwiftUI could not render dx.\(name)") }
                    let ui = pixels(normalised(raw))
                    guard raw.width == side, raw.height == side else { fail("SwiftUI rendered dx.\(name) at \(raw.width)x\(raw.height)") }
                    let mine = measure(px, side), theirs = measure(ui, side)
                    let areaDiff = abs(mine.area - theirs.area) / max(theirs.area, 1)
                    let boxDiff = max(abs(mine.box.width - theirs.box.width), abs(mine.box.height - theirs.box.height))
                    let shift = Double(hypot(mine.centre.x - theirs.centre.x, mine.centre.y - theirs.centre.y)) / Double(k)
                    if areaDiff > 0.02 || boxDiff > 1.5 || shift > 0.5 {
                        fail(String(format: "dx.%@ %@: differs from SwiftUI's render (area %.1f %%, box %.1f px, centre %.2f pt)",
                                    name, tile.name, areaDiff * 100, boxDiff, shift))
                    }
                    worstArea = max(worstArea, areaDiff); worstBox = max(worstBox, boxDiff)
                    if shift > worstShift { worstShift = shift; worstShiftAt = "\(name) \(tile.name)" }
                }
            }
        }
    }
    print(String(format: "icons: %d PNGs and %d outline SVGs; every opaque pixel exactly its colour, nothing touching a tile edge; "
                 + "against SwiftUI's render at @3x: ink area within %.2f %%, ink box within %.1f px, centre within %.2f pt (%@: pixel snapping)",
                 pngs, svgs, worstArea * 100, worstBox, worstShift, worstShiftAt))
}

MainActor.assumeIsolated { run() }
