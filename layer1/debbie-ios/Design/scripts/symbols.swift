// Debbie custom symbol generator.
//
// Reads stroke-based icon sources (Design/symbols/src/*.svg) and writes one
// `dx.<name>.symbolset` per icon into an asset catalog, as an SF Symbols
// "Template v.3.0" with ALL 27 variants (9 weights × S/M/L scales) drawn
// explicitly. Explicit variants avoid relying on master interpolation, which
// needs identical outline topology across weights. Strokes are outlined with
// CoreGraphics, so the template contains filled paths only.
//
// Source convention (docs/research/08-icons-logos-app-icons.md R10, F9):
//   - SVG viewBox "0 0 100 100" = the M scale at a 100 pt type size.
//   - Baseline at y = 85.23, so y = 50 is the cap-height midline (cap height 70.46).
//   - Elements: <path d>, <line>, <circle>, <rect> (rx allowed), <polyline>.
//     Stroked by default (round caps and joins). An element with
//     data-role="dot" is a filled circle whose radius grows with the weight.
//   - Region roles, for the filled variants that mark a selected or active state
//     (CRAFT.md I3). Every element is still drawn on the same centreline at the same
//     weight, so a `.fill` icon keeps its outline sibling's silhouette exactly:
//       data-role="fill"  closed element: its interior is added to the ink and its
//                         stroke is drawn as usual (a filled heart, screen or house body).
//       data-role="solid" closed element: only its interior is added, with no stroke, so
//                         its edge stays put at every weight (a dial inside a ring, which
//                         must stay clear of strokes that thicken around it).
//       data-role="cut"   its stroke is removed from the ink: a knocked-out line that
//                         follows the weight like a drawn one (hands on a filled dial).
//       data-role="hole"  closed element: its counter (interior minus its stroke) is
//                         removed: the opening an outline of that shape would leave,
//                         which narrows as the weight grows like every counter (a door).
//     Ink = strokes ∪ dots ∪ fills ∪ solids, then cuts and holes are removed. Each element is
//     normalised on its own before the boolean steps, so path direction never matters.
//     Icons without these roles take the original stroke-only path unchanged.
//   - Path commands: M L H V C S Q T A Z, absolute and relative.
//
// Stroke widths per 100 pt (F9, measured against system symbols on this Mac):
//   S/M/L columns; geometry scales 0.783 / 1.0 / 1.29 from M.
//
// Usage:
//   swift Design/scripts/symbols.swift <src-dir> <xcassets-dir>
import CoreGraphics
import Foundation

let weights = ["Ultralight", "Thin", "Light", "Regular", "Medium", "Semibold", "Bold", "Heavy", "Black"]
let strokeTable: [String: [Double]] = [ // [S, M, L]
    "Ultralight": [2.21, 2.35, 2.44], "Thin": [3.40, 3.69, 3.95], "Light": [5.73, 6.32, 6.88],
    "Regular": [7.50, 8.30, 9.09], "Medium": [8.70, 9.94, 11.14], "Semibold": [9.63, 11.20, 12.70],
    "Bold": [10.85, 12.85, 14.77], "Heavy": [12.62, 15.25, 17.77], "Black": [14.20, 17.39, 20.17],
]
let scales: [(name: String, factor: Double, baseline: Double)] = [("S", 0.783, 696), ("M", 1.0, 1126), ("L", 1.29, 1556)]
let capHeight = 70.459
let sourceBaseline = 85.23

enum SymbolError: Error, CustomStringConvertible {
    case parse(String)
    var description: String { if case let .parse(m) = self { return m }; return "error" }
}

// MARK: - Minimal SVG parsing (attributes of self-closing or paired elements)

struct Element {
    var name: String
    var attrs: [String: String]
}

func parseElements(_ svg: String) -> [Element] {
    var out: [Element] = []
    let pattern = #"<(path|line|circle|rect|polyline)\b([^>]*)/?>"#
    let re = try! NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators])
    let attrRe = try! NSRegularExpression(pattern: #"([a-zA-Z_:-]+)\s*=\s*"([^"]*)""#)
    let ns = svg as NSString
    for m in re.matches(in: svg, range: NSRange(location: 0, length: ns.length)) {
        let name = ns.substring(with: m.range(at: 1))
        let attrText = ns.substring(with: m.range(at: 2))
        var attrs: [String: String] = [:]
        let ans = attrText as NSString
        for a in attrRe.matches(in: attrText, range: NSRange(location: 0, length: ans.length)) {
            attrs[ans.substring(with: a.range(at: 1))] = ans.substring(with: a.range(at: 2))
        }
        out.append(Element(name: name, attrs: attrs))
    }
    return out
}

func num(_ s: String?) -> Double { Double(s ?? "") ?? 0 }

// MARK: - Path data → CGPath

func tokens(_ d: String) -> [String] {
    var out: [String] = []
    let re = try! NSRegularExpression(pattern: #"[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?"#)
    let ns = d as NSString
    for m in re.matches(in: d, range: NSRange(location: 0, length: ns.length)) { out.append(ns.substring(with: m.range)) }
    return out
}

func addArc(_ p: CGMutablePath, from: CGPoint, rx rx0: Double, ry ry0: Double, phi: Double, large: Bool, sweep: Bool, to: CGPoint) {
    // SVG elliptical arc → cubic Béziers (W3C implementation notes F.6).
    var rx = abs(rx0), ry = abs(ry0)
    if rx == 0 || ry == 0 { p.addLine(to: to); return }
    let cphi = cos(phi * .pi / 180), sphi = sin(phi * .pi / 180)
    let dx = (from.x - to.x) / 2, dy = (from.y - to.y) / 2
    let x1p = cphi * dx + sphi * dy, y1p = -sphi * dx + cphi * dy
    let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if lam > 1 { rx *= sqrt(lam); ry *= sqrt(lam) }
    let num0 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    var coef = sqrt(max(0, num0 / den))
    if large == sweep { coef = -coef }
    let cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx
    let cx = cphi * cxp - sphi * cyp + (from.x + to.x) / 2
    let cy = sphi * cxp + cphi * cyp + (from.y + to.y) / 2
    func ang(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
        let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a
    }
    let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    var dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if !sweep && dt > 0 { dt -= 2 * .pi } else if sweep && dt < 0 { dt += 2 * .pi }
    let segs = Int(ceil(abs(dt) / (.pi / 2)))
    let delta = dt / Double(segs)
    let k = 4.0 / 3.0 * tan(delta / 4)
    var t = t1
    for _ in 0..<segs {
        let c1 = cos(t), s1 = sin(t), c2 = cos(t + delta), s2 = sin(t + delta)
        let p1 = (c1 - k * s1, s1 + k * c1), p2 = (c2 + k * s2, s2 - k * c2), p3 = (c2, s2)
        func map(_ q: (Double, Double)) -> CGPoint {
            let x = rx * q.0, y = ry * q.1
            return CGPoint(x: cphi * x - sphi * y + cx, y: sphi * x + cphi * y + cy)
        }
        p.addCurve(to: map(p3), control1: map(p1), control2: map(p2))
        t += delta
    }
}

func pathFrom(_ d: String) throws -> CGMutablePath {
    let p = CGMutablePath()
    var toks = tokens(d)[...]
    var cmd = "M"
    var cur = CGPoint.zero, start = CGPoint.zero, lastCtrl: CGPoint? = nil, lastCmd = ""
    func nextNum() throws -> Double {
        guard let t = toks.first, Double(t) != nil else { throw SymbolError.parse("expected number in \(d)") }
        toks = toks.dropFirst(); return Double(t)!
    }
    while !toks.isEmpty {
        if let t = toks.first, Double(t) == nil { cmd = t; toks = toks.dropFirst() }
        let rel = cmd == cmd.lowercased() && cmd.uppercased() != "Z"
        func pt(_ x: Double, _ y: Double) -> CGPoint { rel ? CGPoint(x: cur.x + x, y: cur.y + y) : CGPoint(x: x, y: y) }
        switch cmd.uppercased() {
        case "M":
            cur = pt(try nextNum(), try nextNum()); start = cur; p.move(to: cur); cmd = rel ? "l" : "L"; lastCtrl = nil
        case "L": cur = pt(try nextNum(), try nextNum()); p.addLine(to: cur); lastCtrl = nil
        case "H": let x = try nextNum(); cur = CGPoint(x: rel ? cur.x + x : x, y: cur.y); p.addLine(to: cur); lastCtrl = nil
        case "V": let y = try nextNum(); cur = CGPoint(x: cur.x, y: rel ? cur.y + y : y); p.addLine(to: cur); lastCtrl = nil
        case "C":
            let c1 = pt(try nextNum(), try nextNum()), c2 = pt(try nextNum(), try nextNum()), e = pt(try nextNum(), try nextNum())
            p.addCurve(to: e, control1: c1, control2: c2); lastCtrl = c2; cur = e
        case "S":
            let c1 = (lastCmd == "C" || lastCmd == "S") ? CGPoint(x: 2 * cur.x - (lastCtrl?.x ?? cur.x), y: 2 * cur.y - (lastCtrl?.y ?? cur.y)) : cur
            let c2 = pt(try nextNum(), try nextNum()), e = pt(try nextNum(), try nextNum())
            p.addCurve(to: e, control1: c1, control2: c2); lastCtrl = c2; cur = e
        case "Q":
            let c = pt(try nextNum(), try nextNum()), e = pt(try nextNum(), try nextNum())
            p.addQuadCurve(to: e, control: c); lastCtrl = c; cur = e
        case "T":
            let c = (lastCmd == "Q" || lastCmd == "T") ? CGPoint(x: 2 * cur.x - (lastCtrl?.x ?? cur.x), y: 2 * cur.y - (lastCtrl?.y ?? cur.y)) : cur
            let e = pt(try nextNum(), try nextNum()); p.addQuadCurve(to: e, control: c); lastCtrl = c; cur = e
        case "A":
            let rx = try nextNum(), ry = try nextNum(), phi = try nextNum(), large = try nextNum() != 0, sweep = try nextNum() != 0
            let e = pt(try nextNum(), try nextNum())
            addArc(p, from: cur, rx: rx, ry: ry, phi: phi, large: large, sweep: sweep, to: e); cur = e; lastCtrl = nil
        case "Z": p.closeSubpath(); cur = start; lastCtrl = nil
        default: throw SymbolError.parse("unsupported command \(cmd)")
        }
        lastCmd = cmd.uppercased()
    }
    return p
}

// MARK: - Build one variant

struct Glyph {
    var stroked: CGMutablePath          // every drawn centreline, combined (stroke-only icons)
    var dots: [(CGPoint, Double)]
    var parts: [CGPath] = []            // the same centrelines one element at a time (region icons)
    var fills: [CGPath] = []            // interiors added: `fill` and `solid` (the stroke is in `parts` for `fill` only)
    var cuts: [CGPath] = []
    var holes: [CGPath] = []
    var usesRegions: Bool { !(fills.isEmpty && cuts.isEmpty && holes.isEmpty) }
}

/// One element's centreline in source units, or nil for an element the format ignores.
func shape(_ e: Element) throws -> CGMutablePath? {
    let a = e.attrs
    let p = CGMutablePath()
    switch e.name {
    case "path": p.addPath(try pathFrom(a["d"] ?? ""))
    case "line":
        p.move(to: CGPoint(x: num(a["x1"]), y: num(a["y1"])))
        p.addLine(to: CGPoint(x: num(a["x2"]), y: num(a["y2"])))
    case "circle":
        p.addEllipse(in: CGRect(x: num(a["cx"]) - num(a["r"]), y: num(a["cy"]) - num(a["r"]), width: 2 * num(a["r"]), height: 2 * num(a["r"])))
    case "rect":
        let r = CGRect(x: num(a["x"]), y: num(a["y"]), width: num(a["width"]), height: num(a["height"]))
        let rx = min(num(a["rx"] ?? a["ry"]), min(r.width, r.height) / 2)
        p.addRoundedRect(in: r, cornerWidth: rx, cornerHeight: rx)
    case "polyline":
        let ns = (a["points"] ?? "").split(whereSeparator: { $0 == " " || $0 == "," }).compactMap { Double($0) }
        for i in stride(from: 0, to: ns.count - 1, by: 2) {
            let pnt = CGPoint(x: ns[i], y: ns[i + 1]); i == 0 ? p.move(to: pnt) : p.addLine(to: pnt)
        }
    default: return nil
    }
    return p
}

func load(_ url: URL) throws -> Glyph {
    let svg = try String(contentsOf: url, encoding: .utf8)
    var glyph = Glyph(stroked: CGMutablePath(), dots: [])
    for e in parseElements(svg) {
        let a = e.attrs
        if a["data-role"] == "dot", e.name == "circle" {
            glyph.dots.append((CGPoint(x: num(a["cx"]), y: num(a["cy"])), num(a["r"]))); continue
        }
        guard let p = try shape(e) else { continue }
        switch a["data-role"] {
        case nil, "dot": glyph.stroked.addPath(p); glyph.parts.append(p)
        case "fill": glyph.stroked.addPath(p); glyph.parts.append(p); glyph.fills.append(p)
        case "solid": glyph.fills.append(p)
        case "cut": glyph.cuts.append(p)
        case "hole": glyph.holes.append(p)
        case let role?: throw SymbolError.parse("unknown data-role \"\(role)\" on <\(e.name)>")
        }
    }
    return glyph
}

/// Ink for an icon that uses region roles, in template units: strokes ∪ dots ∪ fills/solids − cuts − holes.
/// Each piece is normalised on its own (non-zero winding) so the boolean steps never depend on
/// the direction a path was drawn in, and the result is weakly simple (fills the same either rule).
func regionInk(_ g: Glyph, transform: CGAffineTransform, width w: Double, dots: [CGPath]) -> CGPath {
    var t = transform
    func placed(_ p: CGPath) -> CGPath { p.copy(using: &t) ?? p }
    func stroke(_ p: CGPath) -> CGPath {
        p.copy(strokingWithWidth: w, lineCap: .round, lineJoin: .round, miterLimit: 4).normalized(using: .winding)
    }
    var ink: CGPath = CGMutablePath()
    for p in g.parts { ink = ink.union(stroke(placed(p)), using: .winding) }
    for d in dots { ink = ink.union(d.normalized(using: .winding), using: .winding) }
    for p in g.fills { ink = ink.union(placed(p).normalized(using: .winding), using: .winding) }
    for p in g.cuts { ink = ink.subtracting(stroke(placed(p)), using: .winding) }
    for p in g.holes {
        let q = placed(p)
        ink = ink.subtracting(q.normalized(using: .winding).subtracting(stroke(q), using: .winding), using: .winding)
    }
    return ink.normalized(using: .winding)
}

/// Outline for one weight and scale, in template units: x from 0, y relative to the baseline (negative = up).
func variant(_ g: Glyph, weight: String, scaleIndex: Int) -> (path: CGPath, minX: Double, maxX: Double) {
    let f = scales[scaleIndex].factor
    let w = strokeTable[weight]![scaleIndex]
    let regular = strokeTable["Regular"]![scaleIndex]
    // Source → baseline-relative: y' = (y - sourceBaseline) * f, x' = x * f
    var t = CGAffineTransform(scaleX: f, y: f).translatedBy(x: 0, y: -sourceBaseline)
    let dotRect = { (c: CGPoint, r: Double) -> CGRect in
        let rr = r * f + (w - regular) / 2
        let cc = CGPoint(x: c.x * f, y: (c.y - sourceBaseline) * f)
        return CGRect(x: cc.x - rr, y: cc.y - rr, width: 2 * rr, height: 2 * rr)
    }
    let ink: CGPath
    if g.usesRegions {
        ink = regionInk(g, transform: t, width: w, dots: g.dots.map { CGPath(ellipseIn: dotRect($0.0, $0.1), transform: nil) })
    } else {
        let centre = g.stroked.copy(using: &t) ?? CGMutablePath()
        let outline = CGMutablePath()
        if !centre.isEmpty {
            outline.addPath(centre.copy(strokingWithWidth: w, lineCap: .round, lineJoin: .round, miterLimit: 4))
        }
        for (c, r) in g.dots { outline.addEllipse(in: dotRect(c, r)) }
        ink = outline
    }
    let b = ink.boundingBoxOfPath
    var shift = CGAffineTransform(translationX: -b.minX, y: 0)
    let placed = ink.copy(using: &shift) ?? ink
    return (placed, 0, Double(b.width))
}

func svgPath(_ p: CGPath) -> String {
    var s = ""
    func f(_ v: CGFloat) -> String { String(format: "%.7f", Double(v)) }
    p.applyWithBlock { el in
        let e = el.pointee, pts = e.points
        switch e.type {
        case .moveToPoint: s += "M\(f(pts[0].x)) \(f(pts[0].y)) "
        case .addLineToPoint: s += "L\(f(pts[0].x)) \(f(pts[0].y)) "
        case .addQuadCurveToPoint: s += "Q\(f(pts[0].x)) \(f(pts[0].y)) \(f(pts[1].x)) \(f(pts[1].y)) "
        case .addCurveToPoint: s += "C\(f(pts[0].x)) \(f(pts[0].y)) \(f(pts[1].x)) \(f(pts[1].y)) \(f(pts[2].x)) \(f(pts[2].y)) "
        case .closeSubpath: s += "Z "
        @unknown default: break
        }
    }
    return s.trimmingCharacters(in: .whitespaces)
}

func template(for g: Glyph) -> String {
    var guides = ""
    var symbols = ""
    for (si, sc) in scales.enumerated() {
        guides += "  <line id=\"Baseline-\(sc.name)\" style=\"fill:none;stroke:#27AAE1;opacity:1;stroke-width:0.5;\" x1=\"263\" x2=\"3036\" y1=\"\(sc.baseline)\" y2=\"\(sc.baseline)\"/>\n"
        let cap = sc.baseline - capHeight * sc.factor
        guides += "  <line id=\"Capline-\(sc.name)\" style=\"fill:none;stroke:#27AAE1;opacity:1;stroke-width:0.5;\" x1=\"263\" x2=\"3036\" y1=\"\(String(format: "%.3f", cap))\" y2=\"\(String(format: "%.3f", cap))\"/>\n"
        for (wi, wname) in weights.enumerated() {
            let x0 = 263.0 + Double(wi) * 300.0 + 40.0
            let v = variant(g, weight: wname, scaleIndex: si)
            let id = "\(wname)-\(sc.name)"
            guides += "  <line id=\"left-margin-\(id)\" style=\"fill:none;stroke:#00AEEF;stroke-width:0.5;opacity:1.0;\" x1=\"\(String(format: "%.3f", x0))\" x2=\"\(String(format: "%.3f", x0))\" y1=\"\(sc.baseline - 96)\" y2=\"\(sc.baseline + 24)\"/>\n"
            guides += "  <line id=\"right-margin-\(id)\" style=\"fill:none;stroke:#00AEEF;stroke-width:0.5;opacity:1.0;\" x1=\"\(String(format: "%.3f", x0 + v.maxX))\" x2=\"\(String(format: "%.3f", x0 + v.maxX))\" y1=\"\(sc.baseline - 96)\" y2=\"\(sc.baseline + 24)\"/>\n"
            symbols += "  <g id=\"\(id)\" transform=\"matrix(1 0 0 1 \(String(format: "%.3f", x0)) \(sc.baseline))\">\n   <path d=\"\(svgPath(v.path))\"/>\n  </g>\n"
        }
    }
    return """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="3300" height="2200">
     <g id="Notes">
      <rect height="2200" id="artboard" style="fill:white;opacity:1" width="3300" x="0" y="0"/>
      <text id="template-version" style="stroke:none;fill:black;font-family:sans-serif;font-size:13;" transform="matrix(1 0 0 1 3036 1933)">Template v.3.0</text>
     </g>
     <g id="Guides">
    \(guides) </g>
     <g id="Symbols">
    \(symbols) </g>
    </svg>

    """
}

// MARK: - Main

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("usage: symbols.swift <src-dir> <xcassets-dir>\n".data(using: .utf8)!)
    exit(2)
}
let src = URL(fileURLWithPath: args[1]), assets = URL(fileURLWithPath: args[2])
let fm = FileManager.default
try fm.createDirectory(at: assets, withIntermediateDirectories: true)
let catalogContents = assets.appendingPathComponent("Contents.json")
if !fm.fileExists(atPath: catalogContents.path) {
    try #"{"info":{"author":"xcode","version":1}}"#.write(to: catalogContents, atomically: true, encoding: .utf8)
}
var count = 0
for file in try fm.contentsOfDirectory(at: src, includingPropertiesForKeys: nil).filter({ $0.pathExtension == "svg" }).sorted(by: { $0.path < $1.path }) {
    let name = "dx." + file.deletingPathExtension().lastPathComponent
    do {
        let g = try load(file)
        let dir = assets.appendingPathComponent("\(name).symbolset")
        try? fm.removeItem(at: dir)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try template(for: g).write(to: dir.appendingPathComponent("\(name).svg"), atomically: true, encoding: .utf8)
        let contents = "{\n  \"info\" : { \"author\" : \"xcode\", \"version\" : 1 },\n  \"symbols\" : [ { \"filename\" : \"\(name).svg\", \"idiom\" : \"universal\" } ]\n}\n"
        try contents.write(to: dir.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
        count += 1
    } catch {
        FileHandle.standardError.write("✗ \(file.lastPathComponent): \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}
print("wrote \(count) symbolsets to \(assets.path)")
