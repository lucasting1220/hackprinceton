// Extracts frames from a screen recording (e.g. `xcrun simctl io <udid> recordVideo`) so a
// reviewer can inspect a transition frame by frame for jumps, flashes, layout pops and dropped
// frames (brief §8 screen gate; CRAFT.md §3 motion verification). Dependency-free (AVFoundation).
//
// Usage:
//   swift tools/video/frames.swift <video> <out-dir> [--fps 30] [--start 0.0] [--duration 2.0] [--width 390]
// Writes <out-dir>/frame-0000.png … and prints a per-frame change score (mean absolute pixel
// difference from the previous frame, 0–255). A frame identical to its predecessor in the middle
// of motion shows as 0.00, which marks a held frame; a spike marks a jump or flash.
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

var args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else {
    print("usage: frames.swift <video> <out-dir> [--fps 30] [--start s] [--duration s] [--width px]"); exit(2)
}
let input = URL(fileURLWithPath: args.removeFirst())
let outDir = URL(fileURLWithPath: args.removeFirst())
var fps = 30.0, start = 0.0, duration = -1.0, width = 390.0
while !args.isEmpty {
    let k = args.removeFirst(); let v = Double(args.isEmpty ? "" : args.removeFirst()) ?? 0
    switch k { case "--fps": fps = v; case "--start": start = v; case "--duration": duration = v; case "--width": width = v; default: break }
}
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let asset = AVURLAsset(url: input)
let semaphore = DispatchSemaphore(value: 0)
var total = 0.0
Task {
    total = (try? await asset.load(.duration).seconds) ?? 0
    semaphore.signal()
}
semaphore.wait()
if duration < 0 { duration = max(0, total - start) }
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: width, height: 0)

func pixels(_ img: CGImage) -> [UInt8] {
    let w = img.width, h = img.height
    var buf = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return buf
}

var previous: [UInt8]? = nil
var index = 0
var t = start
print("video \(input.lastPathComponent): \(String(format: "%.2f", total)) s; extracting \(String(format: "%.2f", duration)) s at \(Int(fps)) fps")
while t <= start + duration + 1e-6 {
    let time = CMTime(seconds: t, preferredTimescale: 600)
    guard let img = try? gen.copyCGImage(at: time, actualTime: nil) else { t += 1 / fps; continue }
    let url = outDir.appendingPathComponent(String(format: "frame-%04d.png", index))
    if let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) {
        CGImageDestinationAddImage(dest, img, nil); CGImageDestinationFinalize(dest)
    }
    let px = pixels(img)
    var score = 0.0
    if let p = previous, p.count == px.count {
        var sum = 0
        var i = 0
        while i < px.count { sum += abs(Int(px[i]) - Int(p[i])); i += 4 } // red channel sample is enough to rank change
        score = Double(sum) / Double(px.count / 4)
    }
    print(String(format: "frame %04d  t=%6.3fs  change=%6.2f", index, t, score))
    previous = px
    index += 1
    t += 1 / fps
}
print("wrote \(index) frames to \(outDir.path)")
