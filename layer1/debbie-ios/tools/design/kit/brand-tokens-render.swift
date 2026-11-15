// Designer kit, part "brand-tokens": the image half of the generator (tools/design/kit/brand-tokens.sh compiles
// and runs it; nothing else calls it). AppKit + SwiftUI shapes only, so text is set in the real system fonts
// (SF Pro, SF Pro Rounded, SF Mono) and corners are the same continuous corners iOS draws.
//
// Commands:
//   squircle <w> <h> <r>            SVG path data of RoundedRectangle(cornerRadius: r, style: .continuous)
//   palette  <spec.json> <out.png>  colour swatch sheet (spec written by brand-tokens-data.py)
//   specimen <spec.json> <out.png>  type specimen
//   sheet    <spec.json> <out.png>  brand usage sheet (pairings, clear space, minimum sizes)
//   sample   <png> <x,y> [...]      prints the sRGB hex of pixels (used by the generator's self-checks)

import AppKit
import CoreText
import Foundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

// MARK: Basics

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("brand-tokens-render: \(message)\n".utf8))
    exit(1)
}

func hexColor(_ hex: String, alpha: CGFloat = 1) -> NSColor {
    var s = hex
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { fail("bad colour \(hex)") }
    return NSColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                   blue: CGFloat(v & 0xFF) / 255, alpha: alpha)
}

func num(_ v: CGFloat) -> String {
    let r = (v * 1000).rounded() / 1000
    var s = String(format: "%.3f", Double(r))
    while s.contains(".") && (s.hasSuffix("0") || s.hasSuffix(".")) { s.removeLast() }
    return s == "-0" ? "0" : s
}

/// The exact continuous ("squircle") corner shape SwiftUI and iOS draw.
func continuousRect(_ rect: CGRect, radius: CGFloat) -> CGPath {
    RoundedRectangle(cornerRadius: radius, style: .continuous).path(in: rect).cgPath
}

enum Weight: String, Decodable {
    case regular, medium, semibold, bold
    var ns: NSFont.Weight {
        switch self { case .regular: .regular; case .medium: .medium; case .semibold: .semibold; case .bold: .bold }
    }
}

enum Design: String, Decodable { case `default`, rounded, mono }

func font(_ size: CGFloat, _ weight: Weight = .regular, _ design: Design = .default, monoDigits: Bool = false) -> NSFont {
    var f: NSFont
    switch design {
    case .mono: f = NSFont.monospacedSystemFont(ofSize: size, weight: weight.ns)
    case .default: f = NSFont.systemFont(ofSize: size, weight: weight.ns)
    case .rounded:
        let base = NSFont.systemFont(ofSize: size, weight: weight.ns)
        guard let d = base.fontDescriptor.withDesign(.rounded), let r = NSFont(descriptor: d, size: size) else {
            fail("SF Pro Rounded is not available on this Mac")
        }
        f = r
    }
    if monoDigits {
        let feature: [NSFontDescriptor.FeatureKey: Int] = [.typeIdentifier: kNumberSpacingType, .selectorIdentifier: kMonospacedNumbersSelector]
        let d = f.fontDescriptor.addingAttributes([.featureSettings: [feature]])
        f = NSFont(descriptor: d, size: size) ?? f
    }
    return f
}

func attributed(_ text: String, _ f: NSFont, _ color: NSColor, lineHeight: CGFloat? = nil, align: NSTextAlignment = .left) -> NSAttributedString {
    let p = NSMutableParagraphStyle()
    p.alignment = align
    p.lineBreakMode = .byWordWrapping
    if let lineHeight { p.minimumLineHeight = lineHeight; p.maximumLineHeight = lineHeight }
    return NSAttributedString(string: text, attributes: [.font: f, .foregroundColor: color, .paragraphStyle: p])
}

func measure(_ a: NSAttributedString, width: CGFloat) -> CGSize {
    let r = a.boundingRect(with: CGSize(width: width, height: 100_000), options: [.usesLineFragmentOrigin, .usesFontLeading])
    return CGSize(width: ceil(r.width), height: ceil(r.height))
}

/// A bitmap in sRGB with a top-left origin, measured in points and rendered at `scale` pixels per point.
final class Canvas {
    let ctx: CGContext
    let scale: CGFloat
    init(width: CGFloat, height: CGFloat, scale: CGFloat, background: NSColor?) {
        guard let cs = CGColorSpace(name: CGColorSpace.sRGB),
              let c = CGContext(data: nil, width: Int((width * scale).rounded()), height: Int((height * scale).rounded()),
                                bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("no bitmap context") }
        ctx = c
        self.scale = scale
        ctx.translateBy(x: 0, y: CGFloat(ctx.height))
        ctx.scaleBy(x: scale, y: -scale)
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
        if let background { fill(CGRect(x: 0, y: 0, width: width, height: height), background) }
    }
    func fill(_ r: CGRect, _ c: NSColor) { ctx.setFillColor(c.cgColor); ctx.fill(r) }
    func fill(_ p: CGPath, _ c: NSColor) { ctx.addPath(p); ctx.setFillColor(c.cgColor); ctx.fillPath() }
    func stroke(_ p: CGPath, _ c: NSColor, width: CGFloat) {
        ctx.addPath(p); ctx.setStrokeColor(c.cgColor); ctx.setLineWidth(width); ctx.strokePath()
    }
    func line(_ a: CGPoint, _ b: CGPoint, _ c: NSColor, width: CGFloat, dash: [CGFloat] = []) {
        ctx.saveGState()
        ctx.setLineDash(phase: 0, lengths: dash)
        ctx.move(to: a); ctx.addLine(to: b); ctx.setStrokeColor(c.cgColor); ctx.setLineWidth(width); ctx.strokePath()
        ctx.restoreGState()
    }
    /// Draws wrapped text with its top-left at `p`; returns the height used.
    @discardableResult func text(_ a: NSAttributedString, at p: CGPoint, width: CGFloat) -> CGFloat {
        let s = measure(a, width: width)
        a.draw(with: CGRect(x: p.x, y: p.y, width: width, height: s.height + 2), options: [.usesLineFragmentOrigin, .usesFontLeading])
        return s.height
    }
    /// The sRGB hex of the pixel under a point (in points), read straight from the bitmap.
    func pixel(_ p: CGPoint) -> String {
        guard let data = ctx.data else { fail("no bitmap data") }
        let x = Int(p.x * scale), y = Int(p.y * scale)
        let bytes = data.bindMemory(to: UInt8.self, capacity: ctx.bytesPerRow * ctx.height)
        let i = y * ctx.bytesPerRow + x * 4
        return String(format: "#%02X%02X%02X", bytes[i], bytes[i + 1], bytes[i + 2])
    }
    func image(_ path: String, in r: CGRect) {
        guard let img = NSImage(contentsOfFile: path) else { fail("can't read \(path)") }
        img.draw(in: r, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    }
    func write(_ path: String) {
        guard let img = ctx.makeImage(),
              let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { fail("can't write \(path)") }
        let dpi = 72 * scale
        CGImageDestinationAddImage(dest, img, [kCGImagePropertyDPIWidth: dpi, kCGImagePropertyDPIHeight: dpi] as CFDictionary)
        if !CGImageDestinationFinalize(dest) { fail("can't finalise \(path)") }
    }
}

func load<T: Decodable>(_ type: T.Type, _ path: String) -> T {
    do { return try JSONDecoder().decode(T.self, from: Data(contentsOf: URL(fileURLWithPath: path))) }
    catch { fail("can't read \(path): \(error)") }
}

// MARK: squircle

func squircle(_ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> String {
    let p = RoundedRectangle(cornerRadius: r, style: .continuous).path(in: CGRect(x: 0, y: 0, width: w, height: h))
    var parts: [String] = []
    p.forEach { el in
        switch el {
        case .move(let to): parts.append("M\(num(to.x)) \(num(to.y))")
        case .line(let to): parts.append("L\(num(to.x)) \(num(to.y))")
        case .quadCurve(let to, let c): parts.append("Q\(num(c.x)) \(num(c.y)) \(num(to.x)) \(num(to.y))")
        case .curve(let to, let c1, let c2):
            parts.append("C\(num(c1.x)) \(num(c1.y)) \(num(c2.x)) \(num(c2.y)) \(num(to.x)) \(num(to.y))")
        case .closeSubpath: parts.append("Z")
        }
    }
    return parts.joined(separator: " ")
}

// MARK: palette

struct PaletteSpec: Decodable {
    struct Sample: Decodable { let fg: String; let text: String; let ratio: String }
    struct Token: Decodable { let name: String; let hex: String; let hc: String; let role: String; let sample: Sample? }
    struct Group: Decodable { let name: String; let note: String; let tokens: [Token] }
    let title: String
    let subtitle: String
    let footer: String
    let scale: CGFloat
    let width: CGFloat
    let columns: Int
    let ink: String
    let ink2: String
    let canvas: String
    let hairline: String
    let groups: [Group]
}

func palette(_ spec: PaletteSpec, out: String) {
    let margin: CGFloat = 48, gap: CGFloat = 16, swatchH: CGFloat = 92
    let cardW = (spec.width - 2 * margin - CGFloat(spec.columns - 1) * gap) / CGFloat(spec.columns)
    let ink = hexColor(spec.ink), ink2 = hexColor(spec.ink2), hairline = hexColor(spec.hairline)
    let titleA = attributed(spec.title, font(28, .bold, .rounded), ink)
    let subA = attributed(spec.subtitle, font(15), ink2, lineHeight: 20)
    let footA = attributed(spec.footer, font(12), ink2, lineHeight: 16)
    func card(_ t: PaletteSpec.Token) -> [(NSAttributedString, CGFloat)] {
        let ic = NSMutableAttributedString(attributedString: attributed("Increase Contrast ", font(11), ink2))
        ic.append(attributed(t.hc == t.hex ? "same" : t.hc, t.hc == t.hex ? font(11) : font(11, .regular, .mono), ink2))
        return [(attributed(t.name, font(13, .semibold, .mono), ink), 2),
                (attributed(t.hex, font(13, .regular, .mono), ink), 1),
                (ic, 6),
                (attributed(t.role, font(12), ink2, lineHeight: 15), 0)]
    }
    var checks: [(CGPoint, String, String)] = []
    func layout(_ c: Canvas?) -> CGFloat {
        var y = margin
        y += c?.text(titleA, at: CGPoint(x: margin, y: y), width: spec.width - 2 * margin) ?? measure(titleA, width: spec.width - 2 * margin).height
        y += 6
        y += c?.text(subA, at: CGPoint(x: margin, y: y), width: spec.width - 2 * margin) ?? measure(subA, width: spec.width - 2 * margin).height
        y += 28
        for g in spec.groups {
            let head = attributed(g.name, font(17, .semibold), ink)
            let note = attributed(g.note, font(13), ink2, lineHeight: 17)
            y += c?.text(head, at: CGPoint(x: margin, y: y), width: spec.width - 2 * margin) ?? measure(head, width: spec.width - 2 * margin).height
            y += 2
            y += c?.text(note, at: CGPoint(x: margin, y: y), width: spec.width - 2 * margin) ?? measure(note, width: spec.width - 2 * margin).height
            y += 12
            var row: [PaletteSpec.Token] = []
            func flush() {
                guard !row.isEmpty else { return }
                var rowH: CGFloat = 0
                for (i, t) in row.enumerated() {
                    let x = margin + CGFloat(i) * (cardW + gap)
                    let rect = CGRect(x: x, y: y, width: cardW, height: swatchH)
                    if let c {
                        let shape = continuousRect(rect, radius: 12)
                        c.fill(shape, hexColor(t.hex))
                        checks.append((CGPoint(x: x + cardW - 24, y: y + 20), t.hex.uppercased(), t.name))
                        c.stroke(continuousRect(rect.insetBy(dx: 0.5, dy: 0.5), radius: 11.5), hairline, width: 1)
                        if let s = t.sample {
                            // "Aa" top-left in the colour that goes on this fill; the pairing and its contrast along the bottom.
                            let fg = hexColor(s.fg)
                            c.text(attributed(s.text, font(22, .semibold), fg), at: CGPoint(x: x + 12, y: y + 10), width: cardW - 24)
                            c.text(attributed(s.ratio, font(11, .medium), fg), at: CGPoint(x: x + 12, y: y + swatchH - 22), width: cardW - 24)
                        }
                    }
                    var ty = y + swatchH + 10
                    for (a, after) in card(t) {
                        ty += (c?.text(a, at: CGPoint(x: x, y: ty), width: cardW) ?? measure(a, width: cardW).height) + after
                    }
                    rowH = max(rowH, ty - y)
                }
                y += rowH + gap
                row = []
            }
            for t in g.tokens {
                row.append(t)
                if row.count == spec.columns { flush() }
            }
            flush()
            y += 16
        }
        y += c?.text(footA, at: CGPoint(x: margin, y: y), width: spec.width - 2 * margin) ?? measure(footA, width: spec.width - 2 * margin).height
        return y + margin
    }
    let height = ceil(layout(nil))
    let c = Canvas(width: spec.width, height: height, scale: spec.scale, background: hexColor(spec.canvas))
    _ = layout(c)
    for (p, hex, name) in checks where c.pixel(p) != hex {
        fail("palette swatch \(name) reads back as \(c.pixel(p)), expected \(hex)")
    }
    c.write(out)
}

// MARK: specimen

struct SpecimenSpec: Decodable {
    struct Row: Decodable {
        let token: String
        let lines: [String]
        let sample: String?
        let size: CGFloat
        let lineHeight: CGFloat
        let weight: Weight
        let design: Design
        let monoDigits: Bool
        let wrapWidth: CGFloat?
    }
    let title: String
    let subtitle: String
    let footer: String
    let scale: CGFloat
    let width: CGFloat
    let labelWidth: CGFloat
    let ink: String
    let ink2: String
    let canvas: String
    let band: String
    let rows: [Row]
}

func specimen(_ spec: SpecimenSpec, out: String) {
    let margin: CGFloat = 40, colGap: CGFloat = 28
    let ink = hexColor(spec.ink), ink2 = hexColor(spec.ink2), band = hexColor(spec.band)
    let sampleX = margin + spec.labelWidth + colGap
    let sampleW = spec.width - sampleX - margin
    let titleA = attributed(spec.title, font(28, .bold, .rounded), ink)
    let subA = attributed(spec.subtitle, font(15), ink2, lineHeight: 20)
    let footA = attributed(spec.footer, font(12), ink2, lineHeight: 16)
    func layout(_ c: Canvas?) -> CGFloat {
        var y = margin
        let full = spec.width - 2 * margin
        y += c?.text(titleA, at: CGPoint(x: margin, y: y), width: full) ?? measure(titleA, width: full).height
        y += 6
        y += c?.text(subA, at: CGPoint(x: margin, y: y), width: full) ?? measure(subA, width: full).height
        y += 24
        for (i, r) in spec.rows.enumerated() {
            if i > 0, let c { c.line(CGPoint(x: margin, y: y - 14), CGPoint(x: spec.width - margin, y: y - 14), band, width: 1) }
            // Label column: token name, then its spec lines.
            var ly = y
            let name = attributed(r.token, font(14, .semibold, .mono), ink)
            ly += (c?.text(name, at: CGPoint(x: margin, y: ly), width: spec.labelWidth) ?? measure(name, width: spec.labelWidth).height) + 3
            for l in r.lines {
                let a = attributed(l, font(12), ink2, lineHeight: 16)
                ly += c?.text(a, at: CGPoint(x: margin, y: ly), width: spec.labelWidth) ?? measure(a, width: spec.labelWidth).height
            }
            // Sample column: the text at its real size, on a band one line-height tall per line.
            var sy = y
            if let sample = r.sample {
                let f = font(r.size, r.weight, r.design, monoDigits: r.monoDigits)
                let a = attributed(sample, f, ink, lineHeight: r.lineHeight)
                let w = min(r.wrapWidth ?? sampleW, sampleW)
                let h = measure(a, width: w).height
                if let c {
                    let lines = max(1, Int((h / r.lineHeight).rounded()))
                    for k in 0..<lines {
                        let bandRect = CGRect(x: sampleX - 6, y: sy + CGFloat(k) * r.lineHeight, width: w + 12, height: r.lineHeight)
                        c.fill(bandRect.insetBy(dx: 0, dy: 0.5), band)
                    }
                    c.text(a, at: CGPoint(x: sampleX, y: sy), width: w)
                    if r.wrapWidth != nil {
                        c.line(CGPoint(x: sampleX + w, y: sy - 4), CGPoint(x: sampleX + w, y: sy + h + 4), ink2, width: 0.75, dash: [3, 3])
                    }
                }
                sy += h
            }
            y = max(ly, sy) + 30
        }
        y += c?.text(footA, at: CGPoint(x: margin, y: y), width: full) ?? measure(footA, width: full).height
        return y + margin
    }
    let height = ceil(layout(nil))
    let c = Canvas(width: spec.width, height: height, scale: spec.scale, background: hexColor(spec.canvas))
    _ = layout(c)
    c.write(out)
}

// MARK: brand usage sheet

struct SheetSpec: Decodable {
    struct Pairing: Decodable { let label: String; let detail: String; let background: String; let image: String; let caption: String }
    /// `mode`: "normal", "stretch" (drawn at the wrong aspect ratio) or "shadow" (drawn with a drop shadow).
    struct Dont: Decodable { let label: String; let detail: String; let background: String; let image: String; let mode: String }
    struct MinSize: Decodable { let label: String; let image: String; let widthPt: CGFloat; let heightPt: CGFloat }
    let title: String
    let subtitle: String
    let footer: String
    let scale: CGFloat
    let width: CGFloat
    let ink: String
    let ink2: String
    let canvas: String
    let accent: String
    let pairings: [Pairing]
    let donts: [Dont]
    /// Clear-space panel: the mark (trimmed) drawn at `clearMarkPt` with a dashed box `clearPad` around it.
    let clearMarkImage: String
    let clearMarkWidthPt: CGFloat
    let clearMarkHeightPt: CGFloat
    let clearPadPt: CGFloat
    let clearCaption: String
    let wordmarkClearImage: String
    let wordmarkClearWidthPt: CGFloat
    let wordmarkClearHeightPt: CGFloat
    let wordmarkClearPadPt: CGFloat
    let wordmarkClearCaption: String
    let minSizes: [MinSize]
    let minCaption: String
}

func sheet(_ spec: SheetSpec, out: String) {
    let margin: CGFloat = 48, gap: CGFloat = 20
    let ink = hexColor(spec.ink), ink2 = hexColor(spec.ink2), accent = hexColor(spec.accent)
    let full = spec.width - 2 * margin
    func layout(_ c: Canvas?) -> CGFloat {
        var y = margin
        func put(_ a: NSAttributedString, _ x: CGFloat, _ w: CGFloat) -> CGFloat {
            c?.text(a, at: CGPoint(x: x, y: y), width: w) ?? measure(a, width: w).height
        }
        y += put(attributed(spec.title, font(28, .bold, .rounded), ink), margin, full) + 6
        y += put(attributed(spec.subtitle, font(15), ink2, lineHeight: 20), margin, full) + 28
        // 1-2. Approved pairings, then things not to do: one tile each, the art fitted inside the middle of the tile.
        func tiles(_ heading: String, _ items: [(label: String, detail: String, background: String, image: String, mode: String)]) {
            y += put(attributed(heading, font(17, .semibold), ink), margin, full) + 12
            let n = CGFloat(items.count)
            let tileW = (full - (n - 1) * gap) / n, tileH = tileW * 0.72
            var captionH: CGFloat = 0
            for (i, p) in items.enumerated() {
                let x = margin + CGFloat(i) * (tileW + gap)
                let rect = CGRect(x: x, y: y, width: tileW, height: tileH)
                if let c {
                    c.fill(continuousRect(rect, radius: 20), hexColor(p.background))
                    c.stroke(continuousRect(rect.insetBy(dx: 0.5, dy: 0.5), radius: 19.5), hexColor("#D3DDD8"), width: 1)
                    guard let img = NSImage(contentsOfFile: p.image) else { fail("can't read \(p.image)") }
                    let s = img.size
                    let k = min(tileW * 0.5 / s.width, tileH * 0.5 / s.height)
                    var dr = CGRect(x: rect.midX - s.width * k / 2, y: rect.midY - s.height * k / 2, width: s.width * k, height: s.height * k)
                    if p.mode == "stretch" { dr = dr.insetBy(dx: -dr.width * 0.35, dy: dr.height * 0.12) }
                    if p.mode == "shadow" {
                        NSGraphicsContext.saveGraphicsState()
                        let sh = NSShadow()
                        sh.shadowColor = NSColor.black.withAlphaComponent(0.45)
                        sh.shadowOffset = NSSize(width: 4, height: -5)
                        sh.shadowBlurRadius = 6
                        sh.set()
                        c.image(p.image, in: dr)
                        NSGraphicsContext.restoreGraphicsState()
                    } else {
                        c.image(p.image, in: dr)
                    }
                }
                var cy = y + tileH + 8
                let l = attributed(p.label, font(14, .semibold), ink)
                let d = attributed(p.detail, font(12), ink2, lineHeight: 16)
                cy += (c?.text(l, at: CGPoint(x: x, y: cy), width: tileW) ?? measure(l, width: tileW).height) + 2
                cy += c?.text(d, at: CGPoint(x: x, y: cy), width: tileW) ?? measure(d, width: tileW).height
                captionH = max(captionH, cy - (y + tileH))
            }
            y += tileH + captionH + 32
        }
        tiles("Approved pairings (CRAFT.md §2.8 B1)", spec.pairings.map { ($0.label, $0.detail, $0.background, $0.image, "normal") })
        tiles("Never", spec.donts.map { ($0.label, $0.detail, $0.background, $0.image, $0.mode) })
        // 2. Clear space: mark and wordmark with their dashed clear-space boxes, side by side.
        y += put(attributed("Clear space", font(17, .semibold), ink), margin, full) + 12
        let colW = (full - gap) / 2
        let panels: [(String, CGFloat, CGFloat, CGFloat, String)] = [
            (spec.clearMarkImage, spec.clearMarkWidthPt, spec.clearMarkHeightPt, spec.clearPadPt, spec.clearCaption),
            (spec.wordmarkClearImage, spec.wordmarkClearWidthPt, spec.wordmarkClearHeightPt, spec.wordmarkClearPadPt, spec.wordmarkClearCaption)]
        var panelH: CGFloat = 0
        for (i, p) in panels.enumerated() {
            let x = margin + CGFloat(i) * (colW + gap)
            let boxW = p.1 + 2 * p.3, boxH = p.2 + 2 * p.3
            let ox = x + (colW - boxW) / 2, oy = y
            if let c {
                let outer = CGRect(x: ox, y: oy, width: boxW, height: boxH)
                c.fill(outer, hexColor("#DDF5EA", alpha: 0.6))
                let inner = CGRect(x: ox + p.3, y: oy + p.3, width: p.1, height: p.2)
                c.image(p.0, in: inner)
                let path = CGPath(rect: outer.insetBy(dx: 0.5, dy: 0.5), transform: nil)
                c.ctx.saveGState(); c.ctx.setLineDash(phase: 0, lengths: [5, 4]); c.stroke(path, accent, width: 1); c.ctx.restoreGState()
                c.stroke(CGPath(rect: inner, transform: nil), hexColor("#7B8A83", alpha: 0.6), width: 0.5)
            }
            let cap = attributed(p.4, font(12), ink2, lineHeight: 16, align: .center)
            let ch = c?.text(cap, at: CGPoint(x: x, y: oy + boxH + 10), width: colW) ?? measure(cap, width: colW).height
            panelH = max(panelH, boxH + 10 + ch)
        }
        y += panelH + 32
        // 3. Minimum sizes, drawn at 2x so they read on the sheet; each labelled with its real minimum.
        y += put(attributed("Minimum sizes", font(17, .semibold), ink), margin, full) + 12
        var x = margin
        var rowH: CGFloat = 0
        for m in spec.minSizes {
            let r = CGRect(x: x, y: y, width: m.widthPt, height: m.heightPt)
            c?.image(m.image, in: r)
            let l = attributed(m.label, font(12), ink2, lineHeight: 16)
            let lw: CGFloat = max(m.widthPt, 120)
            let lh = c?.text(l, at: CGPoint(x: x, y: y + m.heightPt + 8), width: lw) ?? measure(l, width: lw).height
            rowH = max(rowH, m.heightPt + 8 + lh)
            x += lw + 40
        }
        y += rowH + 10
        y += put(attributed(spec.minCaption, font(12), ink2, lineHeight: 16), margin, full) + 28
        y += put(attributed(spec.footer, font(12), ink2, lineHeight: 16), margin, full)
        return y + margin
    }
    let height = ceil(layout(nil))
    let c = Canvas(width: spec.width, height: height, scale: spec.scale, background: hexColor(spec.canvas))
    _ = layout(c)
    c.write(out)
}

// MARK: sample

/// Prints the stored 8-bit values (no colour conversion), so the check sees exactly what's in the file.
func sample(_ path: String, _ points: [String]) {
    guard let data = FileManager.default.contents(atPath: path), let rep = NSBitmapImageRep(data: data) else { fail("can't read \(path)") }
    guard rep.bitsPerSample == 8, rep.samplesPerPixel >= 3 else { fail("\(path) isn't 8-bit RGB(A)") }
    for p in points {
        let xy = p.split(separator: ",").compactMap { Int($0) }
        guard xy.count == 2, xy[0] < rep.pixelsWide, xy[1] < rep.pixelsHigh else { fail("bad point \(p)") }
        var v = [Int](repeating: 255, count: max(4, rep.samplesPerPixel))
        rep.getPixel(&v, atX: xy[0], y: xy[1])
        let alpha = rep.hasAlpha ? v[3] : 255
        print(String(format: "%@ #%02X%02X%02X a=%.2f", p, v[0], v[1], v[2], Double(alpha) / 255))
    }
}

// MARK: main

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { fail("usage: squircle | palette | specimen | sheet | sample") }
switch command {
case "squircle":
    guard args.count == 4, let w = Double(args[1]), let h = Double(args[2]), let r = Double(args[3]) else { fail("squircle <w> <h> <r>") }
    print(squircle(w, h, r))
case "palette":
    guard args.count == 3 else { fail("palette <spec.json> <out.png>") }
    palette(load(PaletteSpec.self, args[1]), out: args[2])
case "specimen":
    guard args.count == 3 else { fail("specimen <spec.json> <out.png>") }
    specimen(load(SpecimenSpec.self, args[1]), out: args[2])
case "sheet":
    guard args.count == 3 else { fail("sheet <spec.json> <out.png>") }
    sheet(load(SheetSpec.self, args[1]), out: args[2])
case "sample":
    guard args.count >= 3 else { fail("sample <png> <x,y> ...") }
    sample(args[1], Array(args.dropFirst(2)))
default:
    fail("unknown command \(command)")
}
