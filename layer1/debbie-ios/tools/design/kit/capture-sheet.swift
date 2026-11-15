// Designer kit, part "capture": a contact sheet for a screen recording. One frame every `--step` seconds (default 1),
// each labelled with its time, in a grid under a title. Dependency-free (AVFoundation, CoreGraphics, CoreText).
//
//   swift tools/design/kit/capture-sheet.swift <video.mp4> <out.png> [--title "…"] [--columns 10] [--width 180] [--step 1]
import AVFoundation
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

var args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else {
    print("usage: capture-sheet.swift <video> <out.png> [--title t] [--columns n] [--width px] [--step s]")
    exit(2)
}
let input = URL(fileURLWithPath: args.removeFirst())
let output = URL(fileURLWithPath: args.removeFirst())
var title = input.lastPathComponent
var columns = 10
var cellWidth = 180.0
var step = 1.0
while args.count >= 2 {
    let key = args.removeFirst(), value = args.removeFirst()
    switch key {
    case "--title": title = value
    case "--columns": columns = max(1, Int(value) ?? columns)
    case "--width": cellWidth = Double(value) ?? cellWidth
    case "--step": step = max(0.1, Double(value) ?? step)
    default: break
    }
}

let asset = AVURLAsset(url: input)
let duration = try await asset.load(.duration).seconds
guard let track = try await asset.loadTracks(withMediaType: .video).first else { print("no video track"); exit(1) }
let natural = try await track.load(.naturalSize)
let cellHeight = (cellWidth * natural.height / natural.width).rounded()

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
generator.maximumSize = CGSize(width: cellWidth * 2, height: cellHeight * 2)

// Frames at 0, step, 2·step … and the last frame.
var times: [Double] = []
var t = 0.0
while t < duration - 0.05 { times.append(t); t += step }
times.append(max(0, duration - 1.0 / 60.0))

var frames: [(Double, CGImage)] = []
for time in times {
    if let image = try? await generator.image(at: CMTime(seconds: time, preferredTimescale: 600)).image {
        frames.append((time, image))
    }
}

let margin = 24.0, gap = 12.0, labelHeight = 26.0, titleHeight = 56.0
let rows = Int((Double(frames.count) / Double(columns)).rounded(.up))
let width = margin * 2 + Double(columns) * cellWidth + Double(columns - 1) * gap
let height = margin * 2 + titleHeight + Double(rows) * (cellHeight + labelHeight) + Double(max(0, rows - 1)) * gap
let scale = 1.0
let space = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(data: nil, width: Int(width * scale), height: Int(height * scale), bitsPerComponent: 8,
                          bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(1) }
ctx.scaleBy(x: scale, y: scale)
// A neutral mid grey, so the light app screens stand out from the sheet.
ctx.setFillColor(CGColor(srgbRed: 0.557, green: 0.557, blue: 0.576, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

func text(_ string: String, size: CGFloat, weight: CGFloat, at point: CGPoint, centredIn widthLimit: Double? = nil) {
    let base = CTFontCreateUIFontForLanguage(.system, size, nil)!
    let traits = [kCTFontWeightTrait: weight] as CFDictionary
    let descriptor = CTFontDescriptorCreateCopyWithAttributes(CTFontCopyFontDescriptor(base),
                                                              [kCTFontTraitsAttribute: traits] as CFDictionary)
    let font = CTFontCreateWithFontDescriptor(descriptor, size, nil)
    let attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 1, alpha: 1),
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: string, attributes: attributes))
    var x = point.x
    if let widthLimit {
        let w = CTLineGetTypographicBounds(line, nil, nil, nil)
        x += (widthLimit - w) / 2
    }
    ctx.textPosition = CGPoint(x: x, y: point.y)
    CTLineDraw(line, ctx)
}

// CoreGraphics counts y from the bottom.
text(title, size: 24, weight: 0.4, at: CGPoint(x: margin, y: height - margin - 30))
text(String(format: "%@ · %.1f s · one frame every %@ s", input.lastPathComponent, duration,
            step == step.rounded() ? String(Int(step)) : String(step)),
     size: 14, weight: 0, at: CGPoint(x: margin, y: height - margin - 50))

for (index, frame) in frames.enumerated() {
    let row = index / columns, column = index % columns
    let x = margin + Double(column) * (cellWidth + gap)
    let top = height - margin - titleHeight - Double(row) * (cellHeight + labelHeight + gap)
    let rect = CGRect(x: x, y: top - cellHeight, width: cellWidth, height: cellHeight)
    ctx.draw(frame.1, in: rect)
    let seconds = frame.0
    let label = String(format: "%d:%04.1f", Int(seconds) / 60, seconds.truncatingRemainder(dividingBy: 60))
    text(label, size: 15, weight: 0.3, at: CGPoint(x: x, y: rect.minY - 19), centredIn: cellWidth)
}

guard let image = ctx.makeImage(),
      let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { exit(1) }
print("sheet: \(output.path) (\(frames.count) frames, \(Int(width * scale)) × \(Int(height * scale)) px)")
