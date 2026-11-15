// Contact sheet for the designer kit's screen sets (DesignerKit/11-screens/contact-sheets).
// Part of tools/design/kit/screens.sh; dependency-free (CoreGraphics, CoreText, ImageIO).
//
// Usage (from the repo root):
//   swift tools/design/kit/screens-sheet.swift --out <sheet.png> --title <text> --subtitle <text>
//        [--columns 8] [--height 260] [--corner 0] "<image.png>|<label>" ...
//
// - Drawn in points at 2x (every point is 2 px) and saved at 144 dpi, so Preview and Keynote show it at point size.
// - Each screen is scaled to --height points tall, keeps its aspect ratio, and gets a 1 pt hairline.
//   --corner rounds the screen's corners as a fraction of its width (0.125 matches iPhone 17 Pro Max's display).
// - Under each screen: the label, then the file name in the kit.
// - Colours are Debbie's light tokens (Design/tokens/colors.json): bg.surface page, text.primary and
//   text.secondary words, separator hairlines. Type is the system font (SF Pro), as in the app.

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Options {
    var out = ""
    var title = ""
    var subtitle = ""
    var columns = 8
    var height: CGFloat = 260
    var corner: CGFloat = 0
    var items: [(path: String, label: String)] = []
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("screens-sheet: \(message)\n".data(using: .utf8)!)
    exit(1)
}

func parse() -> Options {
    var o = Options()
    var args = Array(CommandLine.arguments.dropFirst())
    func value(_ flag: String) -> String {
        guard !args.isEmpty else { fail("\(flag) needs a value") }
        return args.removeFirst()
    }
    while !args.isEmpty {
        let a = args.removeFirst()
        switch a {
        case "--out": o.out = value(a)
        case "--title": o.title = value(a)
        case "--subtitle": o.subtitle = value(a)
        case "--columns": o.columns = Int(value(a)) ?? 8
        case "--height": o.height = CGFloat(Double(value(a)) ?? 260)
        case "--corner": o.corner = CGFloat(Double(value(a)) ?? 0)
        default:
            let parts = a.split(separator: "|", maxSplits: 1).map(String.init)
            o.items.append((parts[0], parts.count > 1 ? parts[1] : (parts[0] as NSString).lastPathComponent))
        }
    }
    if o.out.isEmpty { fail("--out is required") }
    if o.items.isEmpty { fail("no images") }
    return o
}

func color(_ hex: String) -> CGColor {
    let v = UInt32(hex.dropFirst(), radix: 16) ?? 0
    return CGColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                   blue: CGFloat(v & 0xFF) / 255, alpha: 1)
}

// Debbie's light tokens (Design/tokens/colors.json).
let page = color("#EEF3F0")      // bg.surface
let ink = color("#14201B")       // text.primary
let ink2 = color("#3F4D47")      // text.secondary
let hairline = color("#D3DDD8")  // separator

func font(_ size: CGFloat, bold: Bool) -> CTFont {
    CTFontCreateUIFontForLanguage(bold ? .emphasizedSystem : .system, size, nil)
        ?? CTFontCreateWithName("Helvetica" as CFString, size, nil)
}

func line(_ text: String, size: CGFloat, bold: Bool, color: CGColor) -> CTLine {
    let attrs: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font(size, bold: bold),
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    ]
    return CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
}

func width(_ l: CTLine) -> CGFloat { CGFloat(CTLineGetTypographicBounds(l, nil, nil, nil)) }

/// Draws `text` with its baseline at `baseline` (y measured from the top of the sheet), left-aligned at `x` or
/// centred in `centre` when given. Too wide: truncated in the middle, never overflowing.
func draw(_ text: String, in ctx: CGContext, sheetHeight: CGFloat, x: CGFloat, baseline: CGFloat, maxWidth: CGFloat,
          size: CGFloat, bold: Bool, color: CGColor, centred: Bool) {
    var l = line(text, size: size, bold: bold, color: color)
    if width(l) > maxWidth {
        l = CTLineCreateTruncatedLine(l, Double(maxWidth), .middle, line("…", size: size, bold: bold, color: color)) ?? l
    }
    let w = min(width(l), maxWidth)
    ctx.textPosition = CGPoint(x: centred ? x + (maxWidth - w) / 2 : x, y: sheetHeight - baseline)
    CTLineDraw(l, ctx)
}

/// Splits text into lines that fit `maxWidth`: at spaces, or after hyphens for file names (`atHyphens`), so a file
/// name is always shown whole.
func wrap(_ text: String, size: CGFloat, bold: Bool = false, maxWidth: CGFloat, atHyphens: Bool = false) -> [String] {
    var pieces: [String] = []
    if atHyphens {
        var piece = ""
        for ch in text { piece.append(ch); if ch == "-" { pieces.append(piece); piece = "" } }
        if !piece.isEmpty { pieces.append(piece) }
    } else {
        pieces = text.split(separator: " ").map(String.init)
    }
    let joiner = atHyphens ? "" : " "
    var lines: [String] = [], current = ""
    for p in pieces {
        let candidate = current.isEmpty ? p : current + joiner + p
        if width(line(candidate, size: size, bold: bold, color: ink2)) > maxWidth, !current.isEmpty {
            lines.append(current); current = p
        } else { current = candidate }
    }
    if !current.isEmpty { lines.append(current) }
    return lines
}

func load(_ path: String) -> CGImage {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("can't read \(path)") }
    return img
}

let o = parse()
let images = o.items.map { load($0.path) }
let scale: CGFloat = 2
let margin: CGFloat = 32, gapX: CGFloat = 20, gapY: CGFloat = 28
let titleSize: CGFloat = 22, subtitleSize: CGFloat = 12.5, labelSize: CGFloat = 12, fileSize: CGFloat = 10.5
let labelLeading = labelSize * 1.25, fileLeading = fileSize * 1.3
let cellW = images.map { CGFloat($0.width) / CGFloat($0.height) * o.height }.max() ?? o.height
let cols = max(1, min(o.columns, images.count))
let rows = Int(ceil(Double(images.count) / Double(cols)))
let sheetW = (2 * margin + CGFloat(cols) * cellW + CGFloat(cols - 1) * gapX).rounded(.up)
let titleLines = wrap(o.title, size: titleSize, bold: true, maxWidth: sheetW - 2 * margin)
let subtitleLines = wrap(o.subtitle, size: subtitleSize, maxWidth: sheetW - 2 * margin)
// Labels wrap rather than truncate: the label at spaces, the file name after its hyphens. Every cell gets the
// tallest label's block, so the rows stay even.
let labelWidth = cellW + gapX - 4
let labelLines = o.items.map { wrap($0.label, size: labelSize, bold: true, maxWidth: labelWidth) }
let fileLines = o.items.map { wrap(($0.path as NSString).lastPathComponent, size: fileSize, maxWidth: labelWidth, atHyphens: true) }
let labelBlock = 8 + CGFloat(labelLines.map(\.count).max() ?? 1) * labelLeading + 2
    + CGFloat(fileLines.map(\.count).max() ?? 1) * fileLeading + 2
let headerH = CGFloat(titleLines.count) * titleSize * 1.3 + 8 + CGFloat(subtitleLines.count) * subtitleSize * 1.4 + 24
let gridTop = margin + headerH
let sheetH = (gridTop + CGFloat(rows) * (o.height + labelBlock) + CGFloat(rows - 1) * gapY + margin).rounded(.up)

guard let ctx = CGContext(data: nil, width: Int(sheetW * scale), height: Int(sheetH * scale), bitsPerComponent: 8,
                          bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fail("can't make a canvas") }
ctx.scaleBy(x: scale, y: scale)
ctx.interpolationQuality = .high
ctx.setFillColor(page)
ctx.fill(CGRect(x: 0, y: 0, width: sheetW, height: sheetH))

// Header: the wrapped title, then the wrapped subtitle.
var baseline = margin + titleSize
for (n, t) in titleLines.enumerated() {
    if n > 0 { baseline += titleSize * 1.3 }
    draw(t, in: ctx, sheetHeight: sheetH, x: margin, baseline: baseline, maxWidth: sheetW - 2 * margin,
         size: titleSize, bold: true, color: ink, centred: false)
}
baseline += 8 + subtitleSize * 1.4
for s in subtitleLines {
    draw(s, in: ctx, sheetHeight: sheetH, x: margin, baseline: baseline, maxWidth: sheetW - 2 * margin,
         size: subtitleSize, bold: false, color: ink2, centred: false)
    baseline += subtitleSize * 1.4
}

// Grid: each screen top-aligned in its cell, label and file name underneath.
for (i, img) in images.enumerated() {
    let r = i / cols, c = i % cols
    let w = CGFloat(img.width) / CGFloat(img.height) * o.height
    let x = margin + CGFloat(c) * (cellW + gapX) + (cellW - w) / 2
    let top = gridTop + CGFloat(r) * (o.height + labelBlock + gapY)
    let rect = CGRect(x: x, y: sheetH - top - o.height, width: w, height: o.height)
    let radius = o.corner * w
    let shape = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    ctx.draw(img, in: rect)
    ctx.restoreGState()
    ctx.addPath(shape)
    ctx.setStrokeColor(hairline)
    ctx.setLineWidth(1)
    ctx.strokePath()

    let labelX = margin + CGFloat(c) * (cellW + gapX) - (gapX - 4) / 2
    var y = top + o.height + 8 + labelSize
    for l in labelLines[i] {
        draw(l, in: ctx, sheetHeight: sheetH, x: labelX, baseline: y, maxWidth: labelWidth, size: labelSize, bold: true,
             color: ink, centred: true)
        y += labelLeading
    }
    y += 2 + fileSize - labelSize
    for l in fileLines[i] {
        draw(l, in: ctx, sheetHeight: sheetH, x: labelX, baseline: y, maxWidth: labelWidth, size: fileSize, bold: false,
             color: ink2, centred: true)
        y += fileLeading
    }
}

guard let out = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: o.out) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fail("can't write \(o.out)") }
CGImageDestinationAddImage(dest, out, [kCGImagePropertyDPIWidth: 144, kCGImagePropertyDPIHeight: 144] as CFDictionary)
guard CGImageDestinationFinalize(dest) else { fail("can't write \(o.out)") }
print("wrote \(o.out) (\(Int(sheetW * scale))×\(Int(sheetH * scale)) px, \(images.count) screens)")
