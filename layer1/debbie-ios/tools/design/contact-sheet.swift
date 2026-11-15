// Contact sheet: tiles images into one labelled PNG so a reviewer can see many
// renders or screenshots at once. Dependency-free (CoreGraphics, ImageIO, CoreText).
//
// Usage:
//   swift tools/design/contact-sheet.swift --out sheet.png [--columns 4] [--cell 360]
//        [--background "#FFFFFF"] [--title "Icon review"] image1.png[=Label] image2.png[=Label] ...
//
// Each image is scaled to fit a square cell (aspect preserved) on the chosen
// background, with its label (default: file name) underneath.

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Options {
    var out = "contact-sheet.png"
    var columns = 4
    var cell: CGFloat = 360
    var background = "#FFFFFF"
    var title: String?
    var inputs: [(path: String, label: String)] = []
}

func parse() -> Options {
    var o = Options()
    var args = Array(CommandLine.arguments.dropFirst())
    while !args.isEmpty {
        let a = args.removeFirst()
        switch a {
        case "--out": o.out = args.removeFirst()
        case "--columns": o.columns = Int(args.removeFirst()) ?? 4
        case "--cell": o.cell = CGFloat(Double(args.removeFirst()) ?? 360)
        case "--background": o.background = args.removeFirst()
        case "--title": o.title = args.removeFirst()
        default:
            let parts = a.split(separator: "=", maxSplits: 1).map(String.init)
            let path = parts[0]
            let label = parts.count > 1 ? parts[1] : (path as NSString).lastPathComponent
            o.inputs.append((path, label))
        }
    }
    return o
}

func color(_ hex: String) -> CGColor {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    let v = UInt32(s, radix: 16) ?? 0xFFFFFF
    return CGColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                   blue: CGFloat(v & 0xFF) / 255, alpha: 1)
}

func isDark(_ c: CGColor) -> Bool {
    guard let comps = c.components, comps.count >= 3 else { return false }
    return (0.2126 * comps[0] + 0.7152 * comps[1] + 0.0722 * comps[2]) < 0.5
}

func loadImage(_ path: String) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

func drawText(_ text: String, in ctx: CGContext, rect: CGRect, size: CGFloat, color: CGColor, bold: Bool = false) {
    let font = CTFontCreateWithName((bold ? "Helvetica-Bold" : "Helvetica") as CFString, size, nil)
    let attrs: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
    let width = CTLineGetTypographicBounds(line, nil, nil, nil)
    let truncated = width > Double(rect.width)
        ? (CTLineCreateTruncatedLine(line, Double(rect.width), .middle, nil) ?? line) : line
    let w = min(CGFloat(CTLineGetTypographicBounds(truncated, nil, nil, nil)), rect.width)
    ctx.textPosition = CGPoint(x: rect.midX - w / 2, y: rect.minY + (rect.height - size) / 2 + size * 0.2)
    CTLineDraw(truncated, ctx)
}

let o = parse()
guard !o.inputs.isEmpty else {
    FileHandle.standardError.write("no input images\n".data(using: .utf8)!)
    exit(1)
}
let labelH: CGFloat = 34
let pad: CGFloat = 16
let titleH: CGFloat = o.title == nil ? 0 : 52
let cols = max(1, min(o.columns, o.inputs.count))
let rows = Int(ceil(Double(o.inputs.count) / Double(cols)))
let W = CGFloat(cols) * (o.cell + pad) + pad
let H = CGFloat(rows) * (o.cell + labelH + pad) + pad + titleH
guard let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpace(name: CGColorSpace.sRGB)!,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
let bg = color(o.background)
let fg = isDark(bg) ? CGColor(gray: 0.92, alpha: 1) : CGColor(gray: 0.15, alpha: 1)
let rule = isDark(bg) ? CGColor(gray: 1, alpha: 0.12) : CGColor(gray: 0, alpha: 0.10)
ctx.setFillColor(bg)
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
if let t = o.title {
    // Shrink the title until it fits the sheet width (never truncate a review title).
    var size: CGFloat = 24
    while size > 11 {
        let font = CTFontCreateWithName("Helvetica-Bold" as CFString, size, nil)
        let attrs: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): font]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: t, attributes: attrs))
        if CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil)) <= W - 2 * pad { break }
        size -= 1
    }
    drawText(t, in: ctx, rect: CGRect(x: pad, y: H - titleH, width: W - 2 * pad, height: titleH), size: size, color: fg, bold: true)
}
for (i, input) in o.inputs.enumerated() {
    let r = i / cols, c = i % cols
    let x = pad + CGFloat(c) * (o.cell + pad)
    let yTop = H - titleH - pad - CGFloat(r) * (o.cell + labelH + pad)
    let cellRect = CGRect(x: x, y: yTop - o.cell, width: o.cell, height: o.cell)
    ctx.setStrokeColor(rule)
    ctx.setLineWidth(1)
    ctx.stroke(cellRect.insetBy(dx: -0.5, dy: -0.5))
    if let img = loadImage(input.path) {
        let iw = CGFloat(img.width), ih = CGFloat(img.height)
        let s = min(o.cell / iw, o.cell / ih)
        let dw = iw * s, dh = ih * s
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: cellRect.midX - dw / 2, y: cellRect.midY - dh / 2, width: dw, height: dh))
    } else {
        drawText("missing: \(input.path)", in: ctx, rect: cellRect, size: 14, color: CGColor(srgbRed: 0.8, green: 0.1, blue: 0.1, alpha: 1))
    }
    drawText(input.label, in: ctx, rect: CGRect(x: x, y: yTop - o.cell - labelH, width: o.cell, height: labelH), size: 15, color: fg)
}
guard let out = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: o.out) as CFURL, UTType.png.identifier as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(dest, out, nil)
guard CGImageDestinationFinalize(dest) else { exit(1) }
print("wrote \(o.out) (\(Int(W))×\(Int(H)), \(o.inputs.count) images)")
