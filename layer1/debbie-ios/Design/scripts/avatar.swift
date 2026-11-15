// Debbie's avatar tool. Used only by Design/scripts/export-avatar.sh; nothing here ships.
// Dependency-free: Foundation (XMLDocument, JSONSerialization), CoreGraphics, CoreText, ImageIO.
// Run from the repo root (the export script does): the sheet reads Design/tokens/colors.json.
//
//   avatar split   <src.svg> <out-dir>          validate the layered source and write one SVG per layer on the
//                                               same 200-unit canvas, one more per appearance rendition a layer
//                                               declares (<out-dir>/<appearance>/<layer>.svg), and the check
//                                               SVGs (viewBox -50 -50 300 300)
//   avatar measure <png> <px-per-unit> [--box] [--max-radius R]
//                                               measure a check render: its bounds, and how far it reaches from
//                                               the circle crop's centre (100, 100)
//   avatar edge    <png> <px-per-unit> <#marker> <name>
//                                               fail if the marker colour (standing in for <name>) touches the
//                                               outer silhouette of a check render
//   avatar pdfsize <pdf>...                     fail unless every page is 200 x 200 pt
//   avatar blink   <catalog> [<app-source-dir>] where the blink's squash frame lands against the closed lids
//   avatar sheet   <catalog> <src.svg> <out.png> <note> [<app-source-dir>]
//                                               review sheet drawn from the shipped PDFs, resolved per appearance
//                                               from each imageset's Contents.json and stacked the way the app
//                                               stacks them
// <app-source-dir> is the design system's source folder. It is only read, for the avatar sizes (Tokens.swift)
// and the blink squash (Persona/DebbieAvatar.swift), so the sheet shows what the app draws.

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let layers = ["body", "hair-back", "head", "cheeks", "eyes-open", "eyes-closed", "brows", "mouth", "hair-front"]
let headLayers = Array(layers.dropFirst())   // everything above body tilts around the neck
let pivot = CGPoint(x: 100, y: 150)          // neck centre in SVG units (y grows downwards)
let side: CGFloat = 200                      // canvas size in SVG units = PDF page size in pt

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("avatar: \(message)\n".utf8))
    exit(1)
}

// MARK: - appearances and palette

/// The four appearances the app's colours resolve in (Design/tokens/colors.json). Light is each layer's universal
/// rendition; a layer may add the other three.
enum Appearance: String, CaseIterable {
    case light, dark, lightHC, darkHC
    var isDark: Bool { self == .dark || self == .darkHC }
    var isHigh: Bool { self == .lightHC || self == .darkHC }
    var label: String {
        switch self {
        case .light: return "Light"
        case .dark: return "Dark"
        case .lightHC: return "Light + Increase Contrast"
        case .darkHC: return "Dark + Increase Contrast"
        }
    }
}
let renditionAppearances: [Appearance] = [.dark, .lightHC, .darkHC]

struct Swatch { let name: String; let hex: String }

func paletteEntries(_ css: String) -> [Swatch] {
    let regex = try! NSRegularExpression(pattern: #"\.([A-Za-z][\w-]*)\s*\{\s*fill\s*:\s*(#[0-9A-Fa-f]{6})\s*;?\s*\}"#)
    return regex.matches(in: css, range: NSRange(css.startIndex..., in: css)).map {
        Swatch(name: String(css[Range($0.range(at: 1), in: css)!]), hex: String(css[Range($0.range(at: 2), in: css)!]).uppercased())
    }
}

/// The source's palette: base colours, plus appearance colours named `<base>-<appearance>` (hair-dark, deep-darkHC …).
/// An appearance colour applies only to the layers whose group lists that appearance in data-appearances.
struct Palette {
    var base: [Swatch] = []
    var variants: [Appearance: [String: String]] = [:]   // appearance → base class → hex
    var variantSwatches: [Swatch] = []

    init(css: String) {
        let all = paletteEntries(css)
        let names = Set(all.map(\.name))
        for swatch in all {
            if let ap = renditionAppearances.first(where: {
                swatch.name.hasSuffix("-\($0.rawValue)") && names.contains(String(swatch.name.dropLast($0.rawValue.count + 1)))
            }) {
                variants[ap, default: [:]][String(swatch.name.dropLast(ap.rawValue.count + 1))] = swatch.hex
                variantSwatches.append(swatch)
            } else {
                base.append(swatch)
            }
        }
    }

    /// A class's colour in a rendition for `ap`, falling back as the asset catalog does (darkHC → dark → base).
    func hex(_ name: String, _ ap: Appearance) -> String? {
        let fallback = base.first { $0.name == name }?.hex
        switch ap {
        case .light: return fallback
        case .dark: return variants[.dark]?[name] ?? fallback
        case .lightHC: return variants[.lightHC]?[name] ?? fallback
        case .darkHC: return variants[.darkHC]?[name] ?? variants[.dark]?[name] ?? fallback
        }
    }

    /// The <style> written into each exported layer: base classes only, in `ap`'s colours.
    func style(_ ap: Appearance, replacing: [String: String] = [:]) -> String {
        "<style>" + base.map { ".\($0.name){fill:\(replacing[$0.name] ?? hex($0.name, ap)!)}" }.joined() + "</style>"
    }
}

// MARK: - split

func split(source: String, outDir: String) {
    guard let doc = try? XMLDocument(contentsOf: URL(fileURLWithPath: source), options: []) else {
        fail("cannot parse \(source)")
    }
    guard let root = doc.rootElement(), root.localName == "svg" else { fail("the root element must be <svg>") }
    guard root.attribute(forName: "viewBox")?.stringValue == "0 0 200 200" else {
        fail("the viewBox must be \"0 0 200 200\"")
    }
    let comments = (try? doc.nodes(forXPath: "//comment()")) ?? []
    guard comments.contains(where: { ($0.stringValue ?? "").contains("(100, 150)") }) else {
        fail("note the neck pivot (100, 150) in an SVG comment")
    }
    // The brief's style: flat vector, no outlines, no gradients, no text or raster art.
    for name in ["linearGradient", "radialGradient", "text", "image", "filter", "pattern", "mask", "use", "foreignObject"] {
        if !((try? doc.nodes(forXPath: "//*[local-name()='\(name)']")) ?? []).isEmpty {
            fail("<\(name)> is not allowed: the avatar is flat vector (no gradients, text, raster art or filters)")
        }
    }
    // One palette, kept in the <style> block: no inline paint, and no strokes (no outlines).
    for attr in ["fill", "stroke", "style", "opacity", "fill-opacity"] {
        if !((try? doc.nodes(forXPath: "//*[@\(attr)]")) ?? []).isEmpty {
            fail("inline \(attr)= found; colour every shape with a palette class from the <style> block")
        }
    }
    var groups: [String: XMLElement] = [:]
    var order: [String] = []
    var renditions: [String: [Appearance]] = [:]
    var style: XMLElement?
    for case let element as XMLElement in root.children ?? [] {
        switch element.localName ?? "" {
        case "g":
            let id = element.attribute(forName: "id")?.stringValue ?? "(no id)"
            groups[id] = element
            order.append(id)
            if let list = element.attribute(forName: "data-appearances")?.stringValue {
                renditions[id] = list.split(separator: " ").map { word in
                    guard let ap = Appearance(rawValue: String(word)), ap != .light else {
                        fail("\(id): data-appearances takes dark, lightHC and darkHC (light is the universal rendition); found \(word)")
                    }
                    return ap
                }
            }
        case "style": style = element
        case "title", "desc", "metadata": break
        default: fail("<\(element.localName ?? "?")> sits outside the layer groups; every shape belongs to a <g id>")
        }
    }
    guard order == layers else {
        fail("the layer groups must be exactly, bottom to top: \(layers.joined(separator: ", ")); found \(order.joined(separator: ", "))")
    }
    if ((try? doc.nodes(forXPath: "//*[@data-appearances]")) ?? []).count != renditions.count {
        fail("data-appearances belongs on a layer's <g id>, nowhere else")
    }
    let css = style?.stringValue ?? ""
    if css.contains("stroke") { fail("the <style> block may only set fill (no outlines)") }
    let palette = Palette(css: css)
    let baseNames = Set(palette.base.map(\.name))

    func classes(under node: XMLNode) -> Set<String> {
        var found = Set<String>()
        for case let element as XMLElement in (try? node.nodes(forXPath: "descendant-or-self::*[@class]")) ?? [] {
            for name in (element.attribute(forName: "class")?.stringValue ?? "").split(separator: " ") { found.insert(String(name)) }
        }
        return found
    }
    let used = classes(under: root)
    let undefined = used.subtracting(baseNames)
    if !undefined.isEmpty {
        fail("classes used but not in the palette (appearance colours are applied by the export, not by shapes): \(undefined.sorted().joined(separator: ", "))")
    }
    let unused = baseNames.subtracting(used)
    if !unused.isEmpty { fail("palette classes never used: \(unused.sorted().joined(separator: ", "))") }
    // Every appearance colour must change a layer that declares that appearance, and every declared appearance
    // must change at least one colour in its layer.
    var applied = Set<String>()
    for (id, aps) in renditions {
        let inLayer = classes(under: groups[id]!)
        for ap in aps {
            let changed = inLayer.filter { palette.hex($0, ap) != palette.hex($0, .light) }
            if changed.isEmpty { fail("\(id) declares \(ap.rawValue), but none of its colours has a \(ap.rawValue) variant") }
            for name in changed { applied.insert("\(name)-\(ap.rawValue)") }
            if ap == .darkHC { for name in changed where palette.variants[.darkHC]?[name] == nil { applied.insert("\(name)-dark") } }
        }
    }
    for swatch in palette.variantSwatches {
        let ap = renditionAppearances.first { swatch.name.hasSuffix("-\($0.rawValue)") }!
        let baseName = String(swatch.name.dropLast(ap.rawValue.count + 1))
        if swatch.hex == palette.hex(baseName, .light) { fail("\(swatch.name) repeats \(baseName)'s colour; drop it") }
        if !applied.contains(swatch.name) { fail("\(swatch.name) is never applied: no layer using .\(baseName) declares \(ap.rawValue)") }
    }

    func group(_ id: String) -> String {
        let copy = groups[id]!.copy() as! XMLElement
        copy.removeAttribute(forName: "display")            // eyes-closed is hidden in the source's preview
        copy.removeAttribute(forName: "data-appearances")   // read here; nothing downstream needs it
        return copy.xmlString
    }
    func write(_ name: String, viewBox: String, pixels: Int, style: String, _ body: String) {
        let text = """
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="\(viewBox)" width="\(pixels)" height="\(pixels)">
        \(style)
        \(body)
        </svg>

        """
        let path = (outDir as NSString).appendingPathComponent(name)
        try? FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        do {
            try text.write(toFile: path, atomically: true, encoding: .utf8)
        } catch {
            fail("cannot write \(name): \(error)")
        }
    }
    let lightStyle = palette.style(.light)
    for id in layers {
        write("\(id).svg", viewBox: "0 0 200 200", pixels: 200, style: lightStyle, group(id))
        for ap in renditions[id] ?? [] {
            write("\(ap.rawValue)/\(id).svg", viewBox: "0 0 200 200", pixels: 200, style: palette.style(ap), group(id))
        }
    }
    let wide = "-50 -50 300 300"   // a 50-unit margin all round, so anything off the canvas shows up
    write("check-all.svg", viewBox: wide, pixels: 600, style: lightStyle, layers.map(group).joined(separator: "\n"))
    write("check-body.svg", viewBox: wide, pixels: 600, style: lightStyle, group("body"))
    let head = headLayers.map(group).joined(separator: "\n")
    for (name, degrees) in [("rest", 0), ("minus3", -3), ("plus3", 3)] {
        write("check-head-\(name).svg", viewBox: wide, pixels: 600, style: lightStyle,
              "<g transform=\"rotate(\(degrees) \(Int(pivot.x)) \(Int(pivot.y)))\">\n\(head)\n</g>")
    }
    // The rest pose with 'deep' in a marker colour: deep sits close to the dark circles, so it must never be the edge.
    guard baseNames.contains("deep") else { fail("the palette needs its 'deep' class (eyes, back hair)") }
    write("check-deep-edge.svg", viewBox: wide, pixels: 1200, style: palette.style(.light, replacing: ["deep": "#FF00FF"]),
          layers.filter { $0 != "eyes-closed" }.map(group).joined(separator: "\n"))

    print("source: \(layers.count) layer groups in composite order; pivot noted; no strokes, gradients, text or inline paint")
    print("palette: \(palette.base.count) colours: " + palette.base.map { "\($0.name) \($0.hex)" }.joined(separator: ", "))
    let declared = layers.compactMap { id in renditions[id].map { "\(id) (\($0.map(\.rawValue).joined(separator: ", ")))" } }
    if !declared.isEmpty {
        print("appearance renditions: " + declared.joined(separator: "; ") + "; colours "
              + palette.variantSwatches.map { "\($0.name) \($0.hex)" }.joined(separator: ", "))
    }
}

// MARK: - measure and edge

func pixels(_ png: String) -> (w: Int, h: Int, rgba: [UInt8]) {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: png) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("cannot read \(png)") }
    let w = image.width, h = image.height
    var rgba = [UInt8](repeating: 0, count: w * h * 4)
    rgba.withUnsafeMutableBytes { buffer in
        guard let ctx = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("no bitmap context") }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    return (w, h, rgba)   // premultiplied RGBA; row 0 is the top of the image
}

func measure(png: String, pxPerUnit: Double, box: Bool, maxRadius: Double?) {
    let (w, h, rgba) = pixels(png)
    // Check renders use viewBox -50 -50 300 300, so canvas unit u sits at pixel (u + 50) * pxPerUnit.
    var minX = Double.infinity, minY = Double.infinity, maxX = -Double.infinity, maxY = -Double.infinity
    var radius = 0.0
    for row in 0..<h {
        for col in 0..<w {
            let alpha = rgba[(row * w + col) * 4 + 3]
            if alpha == 0 { continue }
            let x0 = Double(col) / pxPerUnit - 50, x1 = Double(col + 1) / pxPerUnit - 50
            let y0 = Double(row) / pxPerUnit - 50, y1 = Double(row + 1) / pxPerUnit - 50
            minX = min(minX, x0); maxX = max(maxX, x1); minY = min(minY, y0); maxY = max(maxY, y1)
            if alpha >= 16 {   // ignore the faintest anti-aliasing when measuring against the crop
                let dx = (x0 + x1) / 2 - 100, dy = (y0 + y1) / 2 - 100
                radius = max(radius, (dx * dx + dy * dy).squareRoot())
            }
        }
    }
    guard minX.isFinite else { fail("\(png) is empty") }
    let name = (png as NSString).lastPathComponent
    print(String(format: "%@: bounds x %.1f to %.1f, y %.1f to %.1f; reaches %.1f from the crop centre (crop radius 100)",
                 name, minX, maxX, minY, maxY, radius))
    let slack = 1 / pxPerUnit   // one pixel of edge coverage
    if box && (minX < -slack || minY < -slack || maxX > 200 + slack || maxY > 200 + slack) {
        fail("\(name): artwork extends outside the 200 x 200 canvas")
    }
    if let limit = maxRadius, radius > limit {
        fail(String(format: "%@: reaches %.1f from the crop centre; the limit is %.1f", name, radius, limit))
    }
}

/// Fails if any pixel in the marker colour lies on the outer silhouette: partly transparent itself, or beside a
/// transparent pixel. Inside the artwork every pixel is opaque, so interior edges never count.
func edge(png: String, pxPerUnit: Double, markerHex: String, name: String) {
    let (w, h, rgba) = pixels(png)
    let m = rgb255(markerHex)
    var hits = 0, sample: (Double, Double)?
    for row in 0..<h {
        for col in 0..<w {
            let i = (row * w + col) * 4
            let a = Int(rgba[i + 3])
            if a == 0 { continue }
            let r = Int(rgba[i]) * 255 / a, g = Int(rgba[i + 1]) * 255 / a, b = Int(rgba[i + 2]) * 255 / a
            let d = Double((r - m.0) * (r - m.0) + (g - m.1) * (g - m.1) + (b - m.2) * (b - m.2)).squareRoot()
            guard d < 100 else { continue }   // mostly marker: the marked colour dominates this pixel
            var outer = a < 255
            if !outer {
                neighbours: for dy in -1...1 {
                    for dx in -1...1 where dx != 0 || dy != 0 {
                        let y = row + dy, x = col + dx
                        if y < 0 || y >= h || x < 0 || x >= w || rgba[(y * w + x) * 4 + 3] == 0 { outer = true; break neighbours }
                    }
                }
            }
            if outer {
                hits += 1
                if sample == nil { sample = (Double(col) / pxPerUnit - 50, Double(row) / pxPerUnit - 50) }
            }
        }
    }
    let file = (png as NSString).lastPathComponent
    if let sample {
        fail(String(format: "%@: '%@' forms the outer silhouette (%d px, first near canvas %.1f, %.1f); keep it inside the hair",
                    file, name, hits, sample.0, sample.1))
    }
    print("\(file): '\(name)' never touches the outer silhouette (0 edge pixels in its marker colour)")
}

// MARK: - pdf

var openDocuments: [CGPDFDocument] = []   // keeps each document alive while its pages are drawn

func pdfPage(_ path: String) -> CGPDFPage {
    guard let doc = CGPDFDocument(URL(fileURLWithPath: path) as CFURL), let page = doc.page(at: 1) else {
        fail("cannot open \(path)")
    }
    openDocuments.append(doc)
    return page
}

func pdfSize(_ paths: [String]) {
    for path in paths {
        let box = pdfPage(path).getBoxRect(.mediaBox)
        guard box.width == side, box.height == side else {
            fail("\((path as NSString).lastPathComponent) is \(box.width) x \(box.height) pt, not 200 x 200")
        }
    }
    print("pdf: \(paths.count) single-page PDFs, each 200 x 200 pt")
}

// MARK: - catalog

/// One image entry in an imageset's Contents.json.
struct Rendition { let file: String; let luminosity: String?; let contrast: String? }

func renditions(_ setDir: String) -> [Rendition] {
    let path = "\(setDir)/Contents.json"
    guard let data = FileManager.default.contents(atPath: path),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let images = json["images"] as? [[String: Any]] else { fail("cannot read \(path)") }
    return images.compactMap { image in
        guard let file = image["filename"] as? String else { return nil }
        var luminosity: String?, contrast: String?
        for entry in image["appearances"] as? [[String: String]] ?? [] {
            switch entry["appearance"] {
            case "luminosity": luminosity = entry["value"]
            case "contrast": contrast = entry["value"]
            default: fail("\(path): unknown appearance \(entry)")
            }
        }
        return Rendition(file: file, luminosity: luminosity, contrast: contrast)
    }
}

/// The rendition the asset catalog serves in `ap`: the most specific entry whose traits all match. A tie is
/// ambiguous, so it fails rather than guess.
func resolve(_ list: [Rendition], _ ap: Appearance, in setDir: String) -> Rendition {
    let matching = list.filter {
        ($0.luminosity == nil || $0.luminosity == (ap.isDark ? "dark" : "light")) && ($0.contrast == nil || ($0.contrast == "high" && ap.isHigh))
    }
    func score(_ r: Rendition) -> Int { (r.luminosity == nil ? 0 : 1) + (r.contrast == nil ? 0 : 1) }
    guard let best = matching.max(by: { score($0) < score($1) }) else { fail("\(setDir) has no rendition for \(ap.rawValue)") }
    if matching.filter({ score($0) == score(best) }).count > 1 { fail("\(setDir): \(ap.rawValue) matches two renditions equally") }
    return best
}

struct Catalog {
    var pages: [Appearance: [String: CGPDFPage]] = [:]
    var files: [String: [Appearance: String]] = [:]
    /// Each layer's renditions in catalog order: (file, appearances it serves, page).
    var sets: [String: [(file: String, serves: [Appearance], page: CGPDFPage)]] = [:]

    init(_ catalog: String) {
        for id in layers {
            let dir = "\(catalog)/Debbie-\(id).imageset"
            guard FileManager.default.fileExists(atPath: dir) else { fail("missing \(dir)") }
            let list = renditions(dir)
            var loaded: [String: CGPDFPage] = [:]
            for r in list {
                guard FileManager.default.fileExists(atPath: "\(dir)/\(r.file)") else { fail("missing \(dir)/\(r.file)") }
                loaded[r.file] = pdfPage("\(dir)/\(r.file)")
            }
            for ap in Appearance.allCases {
                let r = resolve(list, ap, in: dir)
                pages[ap, default: [:]][id] = loaded[r.file]
                files[id, default: [:]][ap] = r.file
            }
            sets[id] = list.map { r in (r.file, Appearance.allCases.filter { files[id]![$0] == r.file }, loaded[r.file]!) }
        }
    }
}

// MARK: - the app's numbers (read only)

func appText(_ appDir: String?, _ relative: String) -> String? {
    guard let appDir else { return nil }
    return try? String(contentsOfFile: "\(appDir)/\(relative)", encoding: .utf8)
}

func firstMatch(_ pattern: String, in text: String) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let m = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
    return (1..<m.numberOfRanges).map { String(text[Range(m.range(at: $0), in: text)!]) }
}

/// The avatar sizes from Tokens.swift (Size.tabAvatar, avatarSmall, avatarGuide, avatarHero), so the sheet tests what
/// ships. DebbieWithBadge draws the hero at 0.75.
struct AvatarSizes {
    var tab: CGFloat = 30, small: CGFloat = 44, guide: CGFloat = 64, hero: CGFloat = 148
    var source = "built-in defaults (Tokens.swift not read)"
    init(_ appDir: String?) {
        guard let text = appText(appDir, "Tokens/Tokens.swift") else { return }
        func value(_ name: String) -> CGFloat? {
            firstMatch(#"\b"# + name + #"\s*:\s*CGFloat\s*=\s*([0-9.]+)"#, in: text).flatMap { Double($0[0]) }.map { CGFloat($0) }
        }
        guard let t = value("tabAvatar"), let s = value("avatarSmall"), let g = value("avatarGuide"), let h = value("avatarHero") else { return }
        (tab, small, guide, hero, source) = (t, s, g, h, "Tokens.swift")
    }
}

/// The blink's squash frame: the open eyes scaled to `factor` vertically around UnitPoint y `anchor`.
struct Squash { let factor: CGFloat; let anchor: CGFloat }

/// The squash DebbieAvatar.swift applies, read from `layer("eyes-open").scaleEffect(x: 1, y: … ? f : 1, anchor: UnitPoint(x: …, y: a))`.
func appSquash(_ appDir: String?) -> Squash? {
    guard let text = appText(appDir, "Persona/DebbieAvatar.swift"),
          let m = firstMatch(#"layer\("eyes-open"\)\s*\.scaleEffect\(\s*x:\s*1\s*,\s*y:[^?]*\?\s*([0-9.]+)\s*:\s*1\s*,\s*anchor:\s*UnitPoint\(\s*x:\s*[0-9.]+\s*,\s*y:\s*([0-9.]+)\s*\)"#, in: text),
          let f = Double(m[0]), let a = Double(m[1]) else { return nil }
    return Squash(factor: CGFloat(f), anchor: CGFloat(a))
}

// MARK: - blink

/// The vertical centre of a layer's dark mass, in canvas units: alpha weighted by darkness, so white catch-lights
/// don't count.
func darkCentre(_ page: CGPDFPage) -> CGFloat {
    let k: CGFloat = 10                                          // px per canvas unit
    let region = CGRect(x: 60, y: 70, width: 80, height: 40)     // canvas units (y down) around the eyes
    let w = Int(region.width * k), h = Int(region.height * k)
    let ctx = bitmap(w, h)
    ctx.translateBy(x: -region.minX * k, y: -(side - region.maxY) * k)   // PDF space is y-up
    ctx.scaleBy(x: k, y: k)
    ctx.drawPDFPage(page)
    guard let data = ctx.data else { fail("no bitmap data") }
    let bytes = data.bindMemory(to: UInt8.self, capacity: ctx.bytesPerRow * h)
    var sum = 0.0, weighted = 0.0
    for row in 0..<h {
        for col in 0..<w {
            let i = row * ctx.bytesPerRow + col * 4
            let weight = Double(bytes[i + 3]) - (Double(bytes[i]) + Double(bytes[i + 1]) + Double(bytes[i + 2])) / 3
            if weight <= 0 { continue }
            sum += weight
            weighted += weight * (Double(region.minY) + (Double(row) + 0.5) / Double(k))   // row 0 is the top
        }
    }
    guard sum > 0 else { fail("the eye layers are empty") }
    return CGFloat(weighted / sum)
}

struct Blink {
    let open: CGFloat, closed: CGFloat
    let app: Squash?
    let proposed: Squash
    init(_ pages: [String: CGPDFPage], appDir: String?) {
        open = darkCentre(pages["eyes-open"]!)
        closed = darkCentre(pages["eyes-closed"]!)
        app = appSquash(appDir)
        let f = app?.factor ?? 0.4
        // An affine squash moves the centre to a + f (open - a); solve for the anchor a that lands it on the lids.
        let a = (closed - f * open) / (1 - f)
        proposed = Squash(factor: f, anchor: (a / side * 1000).rounded() / 1000)
    }
    func lands(_ s: Squash) -> CGFloat { s.anchor * side + s.factor * (open - s.anchor * side) }
    var summary: String {
        var line = String(format: "blink: the open eyes' dark mass centres at y %.2f, the closed lids' at %.2f (canvas units).", open, closed)
        if let app {
            let hop = closed - lands(app)
            line += String(format: " DebbieAvatar.swift squashes the eyes to %.1f around UnitPoint y %.3f, so they land at %.2f: %.2f units (%.1f pt at 148 pt) %@ the lids.",
                           app.factor, app.anchor, lands(app), abs(hop), abs(hop) * 148 / side, hop >= 0 ? "above" : "below")
        } else {
            line += " (DebbieAvatar.swift's squash could not be read.)"
        }
        line += String(format: " Anchor UnitPoint(x: 0.5, y: %.3f) lands the squash at %.2f, on the lids.", proposed.anchor, lands(proposed))
        return line
    }
}

// MARK: - drawing

func color(_ hex: String) -> CGColor {
    let (r, g, b) = rgb255(hex)
    return CGColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
}

func rgb255(_ hex: String) -> (Int, Int, Int) {
    let v = Int(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
    return ((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF)
}

func bitmap(_ w: Int, _ h: Int) -> CGContext {
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("no bitmap context") }
    return ctx
}

enum Eyes {
    case open, closed, squash(Squash)
    var isClosed: Bool { if case .closed = self { return true } else { return false } }
}

/// Draws the layer PDFs into `rect` the way DebbieAvatar stacks them: one PDF per layer in composite order, inside a
/// filled circle that also clips, with the head layers tilted around the neck and the eyes squashed or closed.
/// `only` draws a single layer with no circle.
func drawAvatar(_ ctx: CGContext, _ pages: [String: CGPDFPage], in rect: CGRect, circle: CGColor?,
                tilt: CGFloat = 0, eyes: Eyes = .open, only: String? = nil) {
    ctx.saveGState()
    ctx.translateBy(x: rect.minX, y: rect.minY)
    ctx.scaleBy(x: rect.width / side, y: rect.height / side)
    if let circle {
        let disc = CGPath(ellipseIn: CGRect(x: 0, y: 0, width: side, height: side), transform: nil)
        ctx.setFillColor(circle)
        ctx.addPath(disc)
        ctx.fillPath()
        ctx.addPath(disc)
        ctx.clip()
    }
    for id in layers {
        if let only, id != only { continue }
        if only == nil && id == (eyes.isClosed ? "eyes-open" : "eyes-closed") { continue }
        ctx.saveGState()
        if id != "body" && tilt != 0 {
            // PDF space is y-up, so the pivot (100, 150) sits at (100, 50), and a clockwise tilt
            // on screen (a positive angle in SwiftUI) is a negative rotation here.
            ctx.translateBy(x: pivot.x, y: side - pivot.y)
            ctx.rotate(by: -tilt * .pi / 180)
            ctx.translateBy(x: -pivot.x, y: -(side - pivot.y))
        }
        if id == "eyes-open", only == nil, case let .squash(s) = eyes {
            let y = side - s.anchor * side
            ctx.translateBy(x: 0, y: y)
            ctx.scaleBy(x: 1, y: s.factor)
            ctx.translateBy(x: 0, y: -y)
        }
        ctx.drawPDFPage(pages[id]!)
        ctx.restoreGState()
    }
    ctx.restoreGState()
}

/// A ring drawn inside `rect`, as SwiftUI's strokeBorder draws it.
func ring(_ ctx: CGContext, in rect: CGRect, width: CGFloat, color c: CGColor) {
    ctx.saveGState()
    ctx.setStrokeColor(c)
    ctx.setLineWidth(width)
    ctx.strokeEllipse(in: rect.insetBy(dx: width / 2, dy: width / 2))
    ctx.restoreGState()
}

struct Theme {
    let ap: Appearance
    let canvas: CGColor, circle: CGColor, text: CGColor, subtle: CGColor, accent: CGColor, border: CGColor
    let circleHex: String
}

func loadThemes() -> [Appearance: Theme] {
    let path = "Design/tokens/colors.json"
    guard let data = FileManager.default.contents(atPath: path),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let tokens = json["tokens"] as? [String: [String: Any]] else { fail("cannot read \(path) (run from the repo root)") }
    func hex(_ name: String, _ ap: Appearance) -> String {
        guard let v = tokens[name]?[ap.rawValue] as? String, v.hasPrefix("#") else { fail("\(path): \(name) has no \(ap.rawValue) colour") }
        return v
    }
    var out: [Appearance: Theme] = [:]
    for ap in Appearance.allCases {
        out[ap] = Theme(ap: ap, canvas: color(hex("bg.canvas", ap)), circle: color(hex("mint.tint", ap)),
                        text: color(hex("text.primary", ap)), subtle: color(hex("text.secondary", ap)),
                        accent: color(hex("accent.text", ap)), border: color(hex("border.control", ap)),
                        circleHex: hex("mint.tint", ap).uppercased())
    }
    return out
}

/// A sheet laid out from the top-left (CoreGraphics measures from the bottom-left).
struct Sheet {
    let ctx: CGContext
    let height: CGFloat

    func rect(_ x: CGFloat, _ top: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
        CGRect(x: x, y: height - top - h, width: w, height: h)
    }

    func fill(_ r: CGRect, _ c: CGColor, radius: CGFloat = 0) {
        ctx.setFillColor(c)
        ctx.addPath(CGPath(roundedRect: r, cornerWidth: min(radius, r.width / 2, r.height / 2),
                           cornerHeight: min(radius, r.width / 2, r.height / 2), transform: nil))
        ctx.fillPath()
    }

    func text(_ s: String, x: CGFloat, top: CGFloat, size: CGFloat, color c: CGColor, bold: Bool = false,
              centredIn width: CGFloat? = nil) {
        let font = CTFontCreateWithName((bold ? "Helvetica-Bold" : "Helvetica") as CFString, size, nil)
        let attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): c,
        ]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
        let w = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
        let dx = width.map { ($0 - w) / 2 } ?? 0
        ctx.textPosition = CGPoint(x: x + dx, y: height - top - size)
        CTLineDraw(line, ctx)
    }

    func checkerboard(_ r: CGRect, _ a: CGColor, _ b: CGColor, cell: CGFloat = 10) {
        for row in 0..<Int(r.height / cell) {
            for col in 0..<Int(r.width / cell) {
                fill(CGRect(x: r.minX + CGFloat(col) * cell, y: r.minY + CGFloat(row) * cell, width: cell, height: cell),
                     (row + col) % 2 == 0 ? a : b)
            }
        }
    }
}

// MARK: - sheet

func sheet(catalog: String, source: String, out: String, note: String, appDir: String?) {
    let cat = Catalog(catalog)
    let palette = Palette(css: (try? String(contentsOfFile: source, encoding: .utf8)) ?? "")
    let themes = loadThemes()
    let sizes = AvatarSizes(appDir)
    let blink = Blink(cat.pages[.light]!, appDir: appDir)

    let pad: CGFloat = 32, inner: CGFloat = 28, gap: CGFloat = 20
    let ink = color("#14201B"), muted = color("#3F4D47"), page = color("#E8EFEB")

    // Section 1 tiles: every size the app draws her at, at @3x and @2x. The selected tab avatar sits on the tab's
    // mint.tint highlight with a 2 pt accent.text ring; the unselected one has a 1 pt border.control ring at 35 %
    // (DebbieTabBar.glyph). Both rings are drawn inside the circle, as strokeBorder draws them.
    enum Kind { case plain, selected, unselected }
    struct Spec { let pt: CGFloat; let role: String; let kind: Kind }
    struct Tile { let spec: Spec; let scale: CGFloat }
    let specs = [
        Spec(pt: sizes.hero, role: "hero", kind: .plain), Spec(pt: sizes.hero * 0.75, role: "badge view", kind: .plain),
        Spec(pt: sizes.guide, role: "guide", kind: .plain), Spec(pt: sizes.small, role: "chat", kind: .plain),
        Spec(pt: sizes.tab, role: "tab, selected", kind: .selected), Spec(pt: sizes.tab, role: "tab", kind: .unselected),
    ]
    let highlight = (x: CGFloat(12), y: CGFloat(6))   // pt of mint.tint highlight around the selected tab avatar
    func tileSize(_ s: Spec, _ scale: CGFloat) -> CGSize {
        s.kind == .selected ? CGSize(width: (s.pt + 2 * highlight.x) * scale, height: (s.pt + 2 * highlight.y) * scale)
                            : CGSize(width: s.pt * scale, height: s.pt * scale)
    }
    let tiles: [Tile] = specs.flatMap { s -> [Tile] in [Tile(spec: s, scale: 3), Tile(spec: s, scale: 2)] }
    let zoomScale: CGFloat = 2, zoom: CGFloat = 4
    let zoomW: CGFloat = sizes.tab * zoomScale * zoom
    let tallest: CGFloat = tiles.map { (t: Tile) -> CGFloat in tileSize(t.spec, t.scale).height }.max()!
    let tileWidths: CGFloat = tiles.map { (t: Tile) -> CGFloat in tileSize(t.spec, t.scale).width }.reduce(0, +)
    let row1W: CGFloat = tileWidths + CGFloat(tiles.count) * gap + zoomW
    let sizesH: CGFloat = inner + 40 + tallest + 58 + inner

    // Section 2: idle frames at the hero size, @2x.
    let frameScale: CGFloat = 2
    let f = sizes.hero * frameScale
    let frames: [(label: String, tilt: CGFloat, eyes: Eyes)] = [
        ("rest", 0, .open), ("blink: eyes-closed", 0, .closed), ("tilt −3°", -3, .open), ("tilt +3°", 3, .open),
    ]
    let framePanelW = CGFloat(frames.count) * f + CGFloat(frames.count - 1) * gap + 2 * inner
    let framesH = inner + 40 + f + 36 + inner

    // Section 3: the blink, close up (Light), so the squash frame can be compared with the closed lids.
    let eyeRegion = CGRect(x: 72, y: 80, width: 62, height: 20)   // canvas units, y down
    let eyeK: CGFloat = 7
    var blinkFrames: [(label: String, detail: String, eyes: Eyes, centre: CGFloat)] = [
        ("open", String(format: "dark mass at y %.2f", blink.open), .open, blink.open),
    ]
    if let app = blink.app {
        blinkFrames.append((String(format: "squash, app anchor y %.3f", app.anchor),
                            String(format: "lands at %.2f, %.2f from the lids", blink.lands(app), abs(blink.closed - blink.lands(app))),
                            .squash(app), blink.lands(app)))
    }
    blinkFrames.append((String(format: "squash, anchor y %.3f (proposed)", blink.proposed.anchor),
                        String(format: "lands at %.2f", blink.lands(blink.proposed)), .squash(blink.proposed), blink.lands(blink.proposed)))
    blinkFrames.append(("closed", String(format: "dark mass at y %.2f", blink.closed), .closed, blink.closed))
    let eyeW = eyeRegion.width * eyeK, eyeH = eyeRegion.height * eyeK
    let blinkW = CGFloat(blinkFrames.count) * eyeW + CGFloat(blinkFrames.count - 1) * gap + 2 * inner
    let blinkH = inner + 40 + eyeH + 58 + inner

    // Section 4: every PDF in the imagesets, bottom to top; appearance renditions on a dark checkerboard.
    let layerTiles: [(id: String, file: String, serves: [Appearance], page: CGPDFPage)] = layers.flatMap { id in
        cat.sets[id]!.map { (id, $0.file, $0.serves, $0.page) }
    }
    let tile: CGFloat = 120, tileGap: CGFloat = 34
    let layersW = CGFloat(layerTiles.count) * (tile + tileGap) - tileGap + 2 * inner
    let layersH = inner + 40 + tile + 58 + inner

    // Section 5: palette and the export script's checks.
    let swatches = palette.base + palette.variantSwatches
    let noteLines = note.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) } + [blink.summary]
    let paletteW = CGFloat(swatches.count) * 168 + 2 * inner
    let paletteH = inner + 40 + 60 + 24 + CGFloat(noteLines.count) * 22 + inner

    let contentW = max(row1W + 2 * inner, 2 * framePanelW + pad, blinkW, layersW, paletteW)
    let W = (contentW + 2 * pad).rounded()
    let H = (104 + 4 * (sizesH + pad) + 2 * (framesH + pad) + blinkH + pad + layersH + pad + paletteH + pad).rounded()
    let s = Sheet(ctx: bitmap(Int(W), Int(H)), height: H)
    s.fill(CGRect(x: 0, y: 0, width: W, height: H), page)
    s.text("Debbie avatar: the layer PDFs in Art.xcassets, resolved per appearance and stacked as DebbieAvatar stacks them",
           x: pad, top: 22, size: 26, color: ink, bold: true)
    s.text("Neck pivot (100, 150) on the 200-unit canvas, UnitPoint(x: 0.5, y: 0.75): the head layers tilt, the body stays. "
           + "Each circle is mint.tint in its appearance. px are device pixels. Sizes: \(sizes.source).",
           x: pad, top: 60, size: 16, color: muted)

    // 1. Sizes, per appearance.
    var top: CGFloat = 104
    for ap in Appearance.allCases {
        let theme = themes[ap]!
        let pages = cat.pages[ap]!
        s.fill(s.rect(pad, top, contentW, sizesH), theme.canvas, radius: 20)
        let hair = cat.files["hair-front"]![ap]!
        s.text("\(ap.label): mint.tint \(theme.circleHex); hair from \(hair)", x: pad + inner, top: top + inner - 6,
               size: 17, color: theme.text, bold: true)
        var x = pad + inner
        let baseline = top + inner + 40 + tallest
        for t in tiles {
            let size: CGSize = tileSize(t.spec, t.scale)
            let box: CGRect = s.rect(x, baseline - size.height, size.width, size.height)
            let d: CGFloat = t.spec.pt * t.scale
            let inset: CGFloat = t.spec.kind == .selected ? highlight.y * t.scale : 0
            let face = CGRect(x: box.midX - d / 2, y: box.maxY - d - inset, width: d, height: d)
            if t.spec.kind == .selected { s.fill(box, theme.circle, radius: box.height / 2) }
            drawAvatar(s.ctx, pages, in: face, circle: theme.circle)
            switch t.spec.kind {
            case .plain: break
            case .selected: ring(s.ctx, in: face, width: 2 * t.scale, color: theme.accent)
            case .unselected: ring(s.ctx, in: face, width: 1 * t.scale, color: theme.border.copy(alpha: 0.35)!)
            }
            let labelW: CGFloat = max(size.width, 96)
            let labelX: CGFloat = x + size.width / 2 - labelW / 2
            let pxLabel: String = "\(t.spec.role), \(Int(d)) px"
            s.text(String(format: "%g pt @%gx", Double(t.spec.pt), Double(t.scale)), x: labelX, top: baseline + 12,
                   size: 13, color: theme.text, centredIn: labelW)
            s.text(pxLabel, x: labelX, top: baseline + 30, size: 12, color: theme.subtle, centredIn: labelW)
            x += size.width + gap
        }
        // The selected tab avatar at @2x, enlarged pixel for pixel, on its highlight.
        let px = Int(sizes.tab * zoomScale)
        let small = bitmap(px, px)
        small.setFillColor(theme.circle)
        small.fill(CGRect(x: 0, y: 0, width: px, height: px))
        let smallRect = CGRect(x: 0, y: 0, width: px, height: px)
        drawAvatar(small, pages, in: smallRect, circle: theme.circle)
        ring(small, in: smallRect, width: 2 * zoomScale, color: theme.accent)
        if let image = small.makeImage() {
            s.ctx.saveGState()
            s.ctx.interpolationQuality = CGInterpolationQuality.none
            s.ctx.draw(image, in: s.rect(x, baseline - zoomW, zoomW, zoomW))
            s.ctx.restoreGState()
        }
        s.text(String(format: "%g pt @%gx, selected", Double(sizes.tab), Double(zoomScale)), x: x, top: baseline + 12, size: 13, color: theme.text, centredIn: zoomW)
        s.text("enlarged \(Int(zoom))x, pixel for pixel", x: x, top: baseline + 30, size: 12, color: theme.subtle, centredIn: zoomW)
        top += sizesH + pad
    }

    // 2. Idle frames at the hero size, per appearance (two panels a row).
    for (i, ap) in Appearance.allCases.enumerated() {
        let theme = themes[ap]!
        let x0 = pad + CGFloat(i % 2) * (framePanelW + pad)
        let y0 = top + CGFloat(i / 2) * (framesH + pad)
        s.fill(s.rect(x0, y0, framePanelW, framesH), theme.canvas, radius: 20)
        s.text(String(format: "%@: idle frames at %g pt @%gx (a positive tilt is clockwise, as in SwiftUI)", ap.label, sizes.hero, frameScale),
               x: x0 + inner, top: y0 + inner - 6, size: 17, color: theme.text, bold: true)
        var x = x0 + inner
        for frame in frames {
            drawAvatar(s.ctx, cat.pages[ap]!, in: s.rect(x, y0 + inner + 40, f, f), circle: theme.circle, tilt: frame.tilt, eyes: frame.eyes)
            s.text(frame.label, x: x, top: y0 + inner + 40 + f + 12, size: 13, color: theme.subtle, centredIn: f)
            x += f + gap
        }
    }
    top += 2 * (framesH + pad)

    // 3. The blink, close up.
    let light = themes[.light]!
    s.fill(s.rect(pad, top, contentW, blinkH), light.canvas, radius: 20)
    s.text("Blink, close up (Light, \(Int(eyeK)) px per canvas unit). The dashed line is the closed lids' centre; each frame's own centre is the solid tick.",
           x: pad + inner, top: top + inner - 6, size: 17, color: ink, bold: true)
    var x = pad + inner
    for frame in blinkFrames {
        let r = s.rect(x, top + inner + 40, eyeW, eyeH)
        s.ctx.saveGState()
        s.ctx.clip(to: r)
        let k: CGFloat = eyeK
        let fullX: CGFloat = r.minX - eyeRegion.minX * k
        let fullY: CGFloat = r.maxY + eyeRegion.minY * k - side * k
        let full = CGRect(x: fullX, y: fullY, width: side * k, height: side * k)
        drawAvatar(s.ctx, cat.pages[.light]!, in: full, circle: light.circle, eyes: frame.eyes)
        func yAt(_ canvasY: CGFloat) -> CGFloat { r.maxY - (canvasY - eyeRegion.minY) * k }
        s.ctx.setStrokeColor(light.accent)
        s.ctx.setLineWidth(1.5)
        s.ctx.setLineDash(phase: 0, lengths: [6, 5])
        s.ctx.strokeLineSegments(between: [CGPoint(x: r.minX, y: yAt(blink.closed)), CGPoint(x: r.maxX, y: yAt(blink.closed))])
        s.ctx.setLineDash(phase: 0, lengths: [])
        s.ctx.setStrokeColor(ink)
        s.ctx.setLineWidth(3)
        s.ctx.strokeLineSegments(between: [CGPoint(x: r.minX, y: yAt(frame.centre)), CGPoint(x: r.minX + 18, y: yAt(frame.centre)),
                                           CGPoint(x: r.maxX - 18, y: yAt(frame.centre)), CGPoint(x: r.maxX, y: yAt(frame.centre))])
        s.ctx.restoreGState()
        s.text(frame.label, x: x, top: top + inner + 40 + eyeH + 12, size: 13, color: ink, centredIn: eyeW)
        s.text(frame.detail, x: x, top: top + inner + 40 + eyeH + 30, size: 12, color: muted, centredIn: eyeW)
        x += eyeW + gap
    }
    top += blinkH + pad

    // 4. Every PDF in the imagesets.
    s.fill(s.rect(pad, top, contentW, layersH), light.canvas, radius: 20)
    s.text("The imagesets, bottom to top: each PDF is 200 x 200 pt on the same canvas. Dark checkerboard: a dark-appearance rendition.",
           x: pad + inner, top: top + inner - 6, size: 17, color: ink, bold: true)
    x = pad + inner
    for t in layerTiles {
        let r = s.rect(x, top + inner + 40, tile, tile)
        let darkTile = t.serves.allSatisfy(\.isDark)
        s.checkerboard(r, darkTile ? color("#0E1412") : color("#F3F7F5"), darkTile ? color("#1C2622") : color("#DDE5E1"))
        drawAvatar(s.ctx, [t.id: t.page], in: r, circle: nil, only: t.id)
        let labelTop: CGFloat = top + inner + 40 + tile
        let labelX: CGFloat = x - tileGap / 2, labelW: CGFloat = tile + tileGap
        let serves: String = t.serves.count == Appearance.allCases.count ? "all appearances" : t.serves.map(\.rawValue).joined(separator: ", ")
        s.text("Debbie-\(t.id)", x: labelX, top: labelTop + 12, size: 12, color: ink, centredIn: labelW)
        s.text(serves, x: labelX, top: labelTop + 30, size: 12, color: muted, centredIn: labelW)
        x += tile + tileGap
    }
    top += layersH + pad

    // 5. Palette and checks.
    s.fill(s.rect(pad, top, contentW, paletteH), light.canvas, radius: 20)
    s.text("Palette: the <style> block of Design/avatar/src/debbie.svg (appearance colours apply only to the layers that declare them)",
           x: pad + inner, top: top + inner - 6, size: 17, color: ink, bold: true)
    x = pad + inner
    for swatch in swatches {
        let r = s.rect(x, top + inner + 36, 44, 44)
        s.fill(r, color(swatch.hex), radius: 10)
        s.ctx.setStrokeColor(color("#D3DDD8"))
        s.ctx.setLineWidth(1)
        s.ctx.addPath(CGPath(roundedRect: r, cornerWidth: 10, cornerHeight: 10, transform: nil))
        s.ctx.strokePath()
        s.text(swatch.name, x: x + 54, top: top + inner + 40, size: 14, color: ink, bold: true)
        s.text(swatch.hex, x: x + 54, top: top + inner + 60, size: 13, color: muted)
        x += 168
    }
    var lineTop = top + inner + 40 + 60 + 24
    for line in noteLines {
        s.text(line, x: pad + inner, top: lineTop, size: 14, color: muted)
        lineTop += 22
    }

    guard let image = s.ctx.makeImage(),
          let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fail("cannot create \(out)") }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fail("cannot write \(out)") }
    print("sheet: \(out) (\(Int(W)) x \(Int(H)) px)")
}

// MARK: - main

var args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { fail("usage: avatar split|measure|edge|pdfsize|blink|sheet …") }
args.removeFirst()
switch command {
case "split" where args.count == 2:
    split(source: args[0], outDir: args[1])
case "measure" where args.count >= 2:
    var limit: Double?
    if let i = args.firstIndex(of: "--max-radius"), i + 1 < args.count { limit = Double(args[i + 1]) }
    measure(png: args[0], pxPerUnit: Double(args[1]) ?? 2, box: args.contains("--box"), maxRadius: limit)
case "edge" where args.count == 4:
    edge(png: args[0], pxPerUnit: Double(args[1]) ?? 4, markerHex: args[2], name: args[3])
case "pdfsize" where !args.isEmpty:
    pdfSize(args)
case "blink" where args.count == 1 || args.count == 2:
    print(Blink(Catalog(args[0]).pages[.light]!, appDir: args.count == 2 ? args[1] : nil).summary)
case "sheet" where args.count == 4 || args.count == 5:
    sheet(catalog: args[0], source: args[1], out: args[2], note: args[3], appDir: args.count == 5 ? args[4] : nil)
default:
    fail("usage: avatar split <src.svg> <dir> | measure <png> <px-per-unit> [--box] [--max-radius R] | edge <png> <px-per-unit> <#marker> <name> | pdfsize <pdf>… | blink <catalog> [<app-dir>] | sheet <catalog> <src.svg> <out.png> <note> [<app-dir>]")
}
