#!/usr/bin/env python3
"""Designer kit, part "capture": the helper behind tools/design/kit/capture.sh (python3 -I, stdlib only).

  capture.py watch <file> <out>                      write the epoch second at which <file> appears (the recorder
                                                     creates its output the moment it starts capturing)
  capture.py renders <export-dir> <dest-dir> [names] name exported XCTest attachments from manifest.json and copy the
                                                     gallery sections (UITests/GalleryUITests.swift) to <dest>/<name>.png;
                                                     with names (comma-separated), replace only those
  capture.py indicator <dest-dir>                    print the renders (comma-separated) that show the gallery's scroll
                                                     indicator at their right edge
  capture.py window <name> <xcresult> <test-id> <raw.mp4> <start-epoch> <out.json>
                                                     find the part of a raw recording worth keeping, and when each step
                                                     of the test happens in it
  capture.py doc <recordings-dir> <window-dir>       write <recordings-dir>/recordings.md from the window files and the
                                                     finished MP4s

Run from the repo root. Paths are relative.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

GALLERY_TESTS = "UITests/GalleryUITests.swift"

# ---------------------------------------------------------------------------------------------------------------------
# Recordings: which test drives each one, how it is trimmed, and what the viewer sees at each step.
# Each step: (kind, target, description). kind "tap" matches an XCTest "Tap <target>" activity; "found" matches the
# moment a "Waiting … for <target> to exist" activity succeeds; "launch" is the first frame of the trimmed video;
# "hold" marks the start of a still hold. Steps are matched in order; a step whose activity never happened is left out
# (for example the system's notification prompt, which only shows on a phone that hasn't answered it yet).
# ---------------------------------------------------------------------------------------------------------------------
RECORDINGS = {
    "app-tour": {
        "test": "RecordingUITests/testTransitionsForRecording()",
        "trim": "launch",
        "title": "The caregiver's demo, end to end",
        "summary": "The on-device demo home from a fresh launch: Set Up as a family member, Home with the urgent alert, "
                   "every tab (including a quick double tap), Debbie's chat, an alert pushed and popped, the Settings "
                   "sheet, every live-view state the demo plays, and I'm On It. Motion details for each step are in "
                   "motion.md (section 6); the haptic named at a step plays on a real iPhone (10-haptics/haptics.md).",
        "steps": [
            ("launch", None, "The launch screen: plain `LaunchBackground` #F3F7F5. About 0.8 s later Welcome fades in "
                             "(about 0.25 s). Debbie idles at hero size (148 pt): breathing, a 2° head tilt, a "
                             "blink."),
            ("tap", '"tryDemo" Button', "**Try the Demo.** Welcome cross-fades to Set Up, \"Who uses this iPhone?\" "
                                        "(`Motion.crossFade`, 300 ms)."),
            ("tap", '"The person at home" StaticText', "The \"The person at home\" card is chosen: mint tint and a "
                                                       "2.5 pt outline (`Motion.state`, 423 ms). Haptic "
                                                       "`choiceChanged` (selection)."),
            ("tap", '"A family member" StaticText', "Back to \"A family member\": one card fills as the other empties, "
                                                    "on the same spring."),
            ("tap", '"roleContinue" Button', "**Continue.** The step slides out to the left as \"Name this iPhone\" "
                                             "slides in from the right (`motion.step`, 423 ms)."),
            ("tap", '"nameContinue" Button', "**Continue.** The button shows its spinner, then \"Check the code\" "
                                             "slides in: 4 7 1 9 and \"Waiting for the laptop to confirm…\" with the "
                                             "spinner turning."),
            ("found", '"pairedContinue" Button', "The demo laptop confirms (5 s after the code appears): \"Paired with "
                                                 "Demo Home\" slides in, Debbie with the green check badge. Haptic "
                                                 "`paired` (success). The test moves on at once, so it shows only "
                                                 "while it slides (resident.mp4 holds it)."),
            ("tap", '"pairedContinue" Button', "**Continue.** \"Get alerts even when Debbie is closed\" slides in."),
            ("tap", '"Continue" Button', "**Continue.** Set Up cross-fades to Home. For a split second Home shows "
                                         "\"Can't connect to Debbie\" and \"No alerts received\"; then the first update "
                                         "lands (about 0.6 s after the tap): \"Monitoring is on\", and the red "
                                         "\"Possible fall\" card and the \"No movement noticed\" card slide down from "
                                         "above while fading in (`Motion.arrive` on `Motion.alertArrive`, 475 ms). "
                                         "The Home tab gets its red badge; haptic `alertUrgentArrived` (warning). In "
                                         "the demo the alert is already waiting, so it arrives with Home rather than "
                                         "on a Home that is already open."),
            ("tap", '"Allow" Button', "iOS asks to allow notifications (a system alert, not Debbie's design); the test "
                                      "taps Allow."),
            ("tap", '"tab.live" Button', "**Live tab.** The mint highlight slides from Home to Live "
                                         "(`Motion.tabSelect`, 317 ms), the page cross-fades in place (`Motion.tabFade`, "
                                         "150 ms) and the camera turns filled with its lensPop."),
            ("tap", '"tab.history" Button', "**History, then Devices about 0.3 s later.** The highlight slides to "
                                            "History and the clock rewinds…"),
            ("tap", '"tab.devices" Button', "…and the second tap lands as that slide finishes, so the highlight goes "
                                            "straight on to Devices and the laptop lid dips (lidOpen). The test can't "
                                            "tap faster, so a clearly mid-flight turn doesn't show; motion.md "
                                            "describes it (it keeps its speed and turns from where it is)."),
            ("tap", '"tab.debbie" Button', "**Debbie tab.** The page cross-fades in with the red \"Possible fall · Not "
                                           "answered · Open\" row pinned at the top and her opening update already in "
                                           "place (build 3 answers on the phone at once, so no typing dots show)."),
            ("tap", '"tab.home" Button', "**Home tab.** The house hops."),
            ("tap", '"Possible fall" StaticText', "**Open the alert.** Its screen pushes in from the right (the "
                                                  "system's navigation push)."),
            ("tap", '"Back" Button', "**Back.** Debbie's Back button pops back to Home."),
            ("tap", '"settings" Button', "**Settings.** The gear turns one tooth (250 ms) as the Settings sheet rises "
                                         "(the system's sheet animation)."),
            ("tap", '"Close" Button', "**Close.** The sheet lowers."),
            ("tap", '"tab.live" Button', "**Live tab** again."),
            ("tap", '"liveView" Button', "**Start Live View.** The dark live-view cover rises (the system's full-screen "
                                         "cover). \"Asking home…\" (about 2 s), \"Connecting to the camera…\" (about "
                                         "1 s), then the demo camera plays, with the blue LIVE bar and its countdown "
                                         "on top and the red Stop button below. The panels cross-fade "
                                         "(`Motion.crossFade`); haptic `liveViewStarted` (success) with the first "
                                         "frame."),
            ("tap", '"stopLive" Button', "**Stop.** \"Stopping…\", then \"Live view ended · You stopped live view.\" "
                                         "with Keep Watching and Done."),
            ("tap", '"Done" Button', "**Done.** The cover lowers, back to the Live tab."),
            ("tap", '"tab.home" Button', "**Home tab.** (The demo also scripts a 30 s \"Monitoring is limited\" dip "
                                         "from 60 s after Try the Demo. Home picks it up at its next 10 s check, so "
                                         "depending on timing it shows near the end of this video or just after.)"),
            ("tap", '"I\'m On It" Button', "**I'm On It.** The urgent card is answered: in build 3 it disappears at "
                                           "once and the cards below jump up (motion.md, \"Acknowledged card "
                                           "leaves\"). The \"No movement noticed\" card now leads, with the mint I'm "
                                           "On It. Haptic `acknowledged` (success)."),
        ],
    },
    "icon-animations": {
        "test": "GalleryUITests/testIconAnimationsForRecording()",
        "trim": "hold",
        "title": "Every icon effect",
        "summary": "The component gallery's \"Icon animations\" section, held still: each `DAnimatedIcon` effect on its "
                   "own mint icon, all replayed together every 2 s (in the app each plays once, per tap or event). "
                   "Top row: hop (home), lensPop (camera), rewind (history), lidOpen (laptop). Bottom row: turn "
                   "(gear), beat (heart), spin (sync), pop (ack). Below them, the \"Debbie idling\" section is in "
                   "view too. Each effect step by step: icon-animations.md.",
        "steps": [
            ("hold", None, "The section is still, near the top of the screen. All eight effects play together every "
                           "2 s (the gallery's own timer), each lasting under 0.6 s; the contact sheet catches some "
                           "of them mid-move."),
        ],
    },
    "debbie-idle-app": {
        "test": "GalleryUITests/testDebbieIdleForRecording()",
        "trim": "hold",
        "title": "Debbie idling, as the app draws her",
        "summary": "The gallery's \"Debbie idling\" section: Debbie at hero size (148 pt) drawn live by the app "
                   "(`DebbieAvatar`), to compare with the exported loop in ../07-debbie/idle-animation. The gallery "
                   "ends here, so the section sits mid-screen with the icon section above it (those icons replay "
                   "every 2 s). She breathes (under 1 % over 4.8 s), tilts her head 2° each way over 7.3 s and "
                   "blinks once in every 4.4 s window (240 ms per blink).",
        "steps": [
            ("hold", None, "Still apart from Debbie (and the icons above, every 2 s). Watch for her blinks and the "
                           "slow tilt."),
        ],
    },
    "resident": {
        "test": "RecordingUITests/testResidentForRecording()",
        "trim": "launch",
        "title": "The person at home",
        "summary": "The on-device demo home set up as the person at home, then the resident screen: Debbie's greeting, "
                   "the heart reading as the hero, and Sync Now.",
        "steps": [
            ("launch", None, "The launch screen (#F3F7F5); about 0.8 s later Welcome fades in. Debbie idles at hero "
                             "size."),
            ("tap", '"tryDemo" Button', "**Try the Demo.** Welcome cross-fades to Set Up (`Motion.crossFade`)."),
            ("tap", '"The person at home" StaticText', "The \"The person at home\" card is chosen (`Motion.state`). "
                                                       "Haptic `choiceChanged` (selection)."),
            ("tap", '"roleContinue" Button', "**Continue.** \"Name this iPhone\" slides in from the right "
                                             "(`motion.step`)."),
            ("tap", '"nameContinue" Button', "**Continue.** The button's spinner, then \"Check the code\" (4 7 1 9) "
                                             "slides in."),
            ("found", '"pairedContinue" Button', "The demo laptop confirms after 5 s: \"Paired with Demo Home\" slides "
                                                 "in and holds for 1.5 s. Haptic `paired` (success)."),
            ("tap", '"pairedContinue" Button', "**Continue.** \"Send your heart rate home\" slides in (the demo never "
                                               "asks for Health access)."),
            ("tap", '"Continue" Button', "**Continue.** Set Up cross-fades to the resident screen, and the demo sends "
                                         "a first reading by itself: Sync Now shows \"Sending…\" with its spinner, "
                                         "then the heart turns filled, 68 beats a minute appears and \"Sent to home at "
                                         "…\" settles in. (No haptic: nobody asked for that send.)"),
            ("tap", '"syncNow" Button', "**Sync Now.** The button keeps its mint and shows the spinner with "
                                        "\"Sending…\" for about 0.6 s, then the new reading lands and the heart beats "
                                        "once (lub-dub, 600 ms). The number and the sent time only change if they "
                                        "differ (here they don't). Haptic `syncSucceeded` (success)."),
        ],
    },
}


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


# --------------------------------------------------------------------------------------------------- watch

def watch(path, out, timeout=30.0):
    start = time.time()
    while time.time() - start < timeout:
        if os.path.exists(path):
            with open(out, "w") as f:
                f.write("%.3f\n" % time.time())
            return 0
        time.sleep(0.005)
    return 1


# --------------------------------------------------------------------------------------------------- renders

def gallery_sections():
    text = open(GALLERY_TESTS).read()
    block = re.search(r"static let sections = \[(.*?)\]", text, re.S)
    if not block:
        sys.exit("capture.py: no sections list in " + GALLERY_TESTS)
    return re.findall(r'"([a-z0-9-]+)"', block.group(1))


def renders(export_dir, dest, only=""):
    sections = gallery_sections()
    wanted = [n for n in only.split(",") if n] or sections
    manifest = json.load(open(os.path.join(export_dir, "manifest.json")))
    found = {}
    for test in manifest:
        for a in test.get("attachments", []):
            human = a.get("suggestedHumanReadableName", "")
            name = re.sub(r"_\d+_[0-9A-Fa-f-]{36}\.png$", "", human)
            name = re.sub(r"\.png$", "", name)
            src = os.path.join(export_dir, a["exportedFileName"])
            if name in wanted and os.path.exists(src):
                found[name] = src
    os.makedirs(dest, exist_ok=True)
    if not only:
        for old in os.listdir(dest):
            if old.endswith(".png"):
                os.remove(os.path.join(dest, old))
    for name, src in found.items():
        shutil.copyfile(src, os.path.join(dest, name + ".png"))
    missing = [s for s in wanted if s not in found]
    print("renders: %d of %d sections → %s" % (len(found), len(wanted), dest))
    if missing:
        print("renders: missing " + ", ".join(missing))
        return 1
    return 0


def rgb(path):
    info = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                           "-of", "json", path]))["streams"][0]
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         check=True, capture_output=True).stdout
    return info["width"], info["height"], raw


def has_indicator(path):
    """The gallery's scroll indicator: a grey bar, at least 40 px tall, in the last 26 px of the render (the right
    margin, where the gallery draws nothing), next to light canvas."""
    w, h, raw = rgb(path)
    run_length = 0
    for y in range(h):
        hit = False
        for x in range(w - 26, w - 4):
            o = (y * w + x) * 3
            r, g, b = raw[o], raw[o + 1], raw[o + 2]
            if max(r, g, b) - min(r, g, b) < 14 and 60 <= (r + g + b) / 3 <= 190:
                o2 = (y * w + w - 40) * 3
                if min(raw[o2], raw[o2 + 1], raw[o2 + 2]) >= 215:
                    hit = True
                    break
        run_length = run_length + 1 if hit else 0
        if run_length >= 40:
            return True
    return False


def indicator(dest):
    # In gallery order, so the retake scrolls down the gallery once instead of back and forth.
    names = [n for n in gallery_sections() if os.path.exists(os.path.join(dest, n + ".png"))
             and has_indicator(os.path.join(dest, n + ".png"))]
    print(",".join(names))
    return 0


# --------------------------------------------------------------------------------------------------- window

def activities(xcresult, test_id):
    data = json.loads(run(["xcrun", "xcresulttool", "get", "test-results", "activities",
                           "--path", xcresult, "--test-id", test_id, "--compact"]))
    return data["testRuns"][0]["activities"]


def test_duration(xcresult, test_id):
    data = json.loads(run(["xcrun", "xcresulttool", "get", "test-results", "tests", "--path", xcresult, "--compact"]))
    stack = list(data.get("testNodes", []))
    while stack:
        node = stack.pop()
        if node.get("nodeIdentifier") == test_id:
            return float(node.get("durationInSeconds", 0)), node.get("result", "")
        stack.extend(node.get("children", []))
    sys.exit("capture.py: %s not in %s" % (test_id, xcresult))


def all_times(acts):
    for a in acts:
        yield a["startTime"]
        yield from all_times(a.get("childActivities", []))


def events(acts):
    """Taps (at the synthesized touch), waits (when the element turned up) and the app launch, in order."""
    out = []
    for a in acts:
        title = a["title"]
        if title.startswith("Tap "):
            t = a["startTime"]
            for c in a.get("childActivities", []):
                if c["title"] == "Synthesize event":
                    t = c["startTime"]
                    break
            out.append(("tap", title[4:], t))
        elif title.startswith("Waiting ") and title.endswith(" to exist"):
            # The last existence check inside the wait: the next step can come after a pause.
            target = re.sub(r"^Waiting [\d.]+s for ", "", title)[: -len(" to exist")]
            out.append(("found", target, max(all_times([a]))))
        elif title.startswith("Open ") or title.startswith("Launch "):
            out.append(("open", title.split(" ", 1)[1], a["startTime"]))
    return out


def small_frames(raw, fps=30, w=32, h=70):
    """The raw recording at `fps`, each frame shrunk to w × h RGB bytes. `-fflags +igndts`: the Simulator's H.264 has
    B-frames, and without it ffmpeg soon decides the presentation times are faulty and switches to the decode times,
    which run about 5.6 s early, so every later frame lands at the wrong moment."""
    proc = subprocess.run(["ffmpeg", "-v", "error", "-fflags", "+igndts", "-i", raw, "-vf", "fps=%d,scale=%d:%d" % (fps, w, h),
                           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], check=True, capture_output=True)
    size = w * h * 3
    return [proc.stdout[o:o + size] for o in range(0, len(proc.stdout) - size + 1, size)]


def lightness(frame):
    """Share of near-white pixels: Debbie's light canvas fills the screen; the Home Screen's wallpaper doesn't (0.08)."""
    n = len(frame) // 3
    return sum(1 for p in range(0, len(frame), 3) if min(frame[p], frame[p + 1], frame[p + 2]) >= 200) / n


def fills_screen(frame, w=32, h=70):
    """True when both side edges are the app's light canvas: during the opening and closing zooms, and on the Home
    Screen, the edges show the wallpaper."""
    edge = [(y * w + x) * 3 for y in range(h) for x in (0, w - 1)]
    light = sum(1 for o in edge if min(frame[o], frame[o + 1], frame[o + 2]) >= 225)
    return light >= 0.9 * len(edge)


def window(name, xcresult, test_id, raw, start_epoch, out):
    spec = RECORDINGS[name]
    rec0 = float(start_epoch)
    acts = activities(xcresult, test_id)
    duration, result = test_duration(xcresult, test_id)
    test_start = acts[0]["startTime"]
    test_end = test_start + duration
    evs = events(acts)
    # The test's own steps, without the tear-down that closes the app.
    body = [a for a in acts if a["title"] != "Tear Down"]
    last = max(all_times(body))
    fps = 30
    frames = small_frames(raw, fps)
    shares = [lightness(f) for f in frames]
    total = len(frames) / fps

    def first_frame(after, cond):
        for i in range(max(0, int(after * fps)), len(frames)):
            if cond(i):
                return i
        return None

    # The end: the app's last full-screen frame before it closes after the test (the Home Screen comes back), or the
    # test's end.
    end = min(test_end - rec0, total)
    gone = first_frame(last - rec0, lambda i: shares[i] < 0.5)
    if gone is not None:
        j = gone - 1
        while j > 0 and not fills_screen(frames[j]):
            j -= 1
        # One sample of margin: the 60 fps encode can round a frame to the neighbouring slot.
        end = min(end, (j - 1) / fps)
    opened = next((t for k, _, t in evs if k == "open"), test_start) - rec0
    if spec["trim"] == "launch":
        # The first frame in which the opening zoom has finished: the launch screen fills the screen.
        i = first_frame(opened, lambda i: shares[i] >= 0.6 and fills_screen(frames[i]))
        if i is None:
            sys.exit("capture.py: %s: the app never filled the screen" % name)
        start = (i + 1) / fps   # one sample of margin, as at the end
    else:
        # A hold: the test's last step is the check that the section has stopped scrolling. 2 s later the gallery's
        # scroll indicator has faded too (as for the renders retake).
        start = last - rec0 + 2.0
    if end - start < 1:
        sys.exit("capture.py: %s: nothing left after trimming (%.2f → %.2f)" % (name, start, end))

    # Each step's time in the trimmed video, by its index in RECORDINGS (the doc takes the words from there).
    steps = []
    queue = list(evs)
    for index, (kind, target, _) in enumerate(spec["steps"]):
        if kind in ("launch", "hold"):
            steps.append({"step": index, "t": 0.0})
            continue
        for j, (k, tgt, t) in enumerate(queue):
            if k == kind and tgt == target:
                steps.append({"step": index, "t": round(t - rec0 - start, 2)})
                del queue[: j + 1]
                break
    json.dump({"name": name, "test": test_id, "result": result, "xcresult": xcresult,
               "raw_seconds": round(total, 2), "start": round(start, 3), "end": round(end, 3),
               "steps": steps}, open(out, "w"), indent=2)
    print("%.3f %.3f" % (start, end))
    return 0


# --------------------------------------------------------------------------------------------------- doc

def probe(path):
    data = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                           "stream=width,height,r_frame_rate,codec_name,nb_frames:format=duration,size",
                           "-of", "json", path]))
    s, f = data["streams"][0], data["format"]
    num, den = s["r_frame_rate"].split("/")
    return {"w": s["width"], "h": s["height"], "fps": round(int(num) / int(den)), "codec": s["codec_name"],
            "seconds": float(f["duration"]), "mb": int(f["size"]) / 1e6}


def stamp(t):
    t = max(0.0, t)
    return "%d:%04.1f" % (int(t // 60), t - 60 * int(t // 60))


def doc(rec_dir, win_dir):
    lines = [
        "# Screen recordings",
        "",
        "Real screen recordings of build 3's code on the iPhone 17 Pro Max Simulator (\"Debbie Max\"): 1320 × 2868 px, "
        "the phone's 440 × 956 pt screen at 3x. Light appearance (the app is light only, D-032), default text size, "
        "Increase Contrast off, Reduce Motion off. The status bar is fixed at 9:41 with full signal and battery.",
        "",
        "- **Format.** H.264 MP4, a constant 60 fps, no sound. The Simulator captures only when something changes; "
        "the gaps are filled with repeats of the frame on screen. Colour is tagged BT.709 with the sRGB transfer, as "
        "the Simulator writes it.",
        "- **Don't colour-pick from the videos.** The Simulator's capture decodes about 3 levels dark on every channel "
        "(mint #6CDCB0 comes back as #69D9AD, white as #FCFCFC; the re-encode keeps exactly what was captured). Take "
        "colours from 02-color and the renders in 08-components.",
        "- **What's not in the picture.** No device frame or rounded corners (the full rectangular screen; the Dynamic "
        "Island shows as a black pill), and no touch indicators: taps come from UI tests, so add your own tap marks at "
        "the times below. Haptics don't show either; each step names the one that plays (10-haptics/haptics.md).",
        "- **Contact sheets.** Each video has `<name>-1fps.png` beside it: one frame per second, labelled with its "
        "time, to find a moment fast.",
        "- **Times** are from the start of each video and good to about ±0.1 s. They come from the UI test's own log "
        "of each tap; the screen answers a frame or two later.",
        "- **Data.** Everything shown is the demo home's sample data (\"Demo Home\", the Demo badge). Debbie's words "
        "come from the on-device wording, not the AI.",
        "",
        "| File | Length | What it shows | Driven by |",
        "|---|---|---|---|",
    ]
    order = [n for n in RECORDINGS if os.path.exists(os.path.join(win_dir, n + ".json"))]
    info = {}
    for n in order:
        w = json.load(open(os.path.join(win_dir, n + ".json")))
        p = probe(os.path.join(rec_dir, n + ".mp4"))
        info[n] = (w, p)
        lines.append("| `%s.mp4` | %s (%.1f MB) | %s | `UITests/%s` |" % (
            n, stamp(p["seconds"]), p["mb"], RECORDINGS[n]["title"], w["test"].replace("()", "")))
    lines.append("")
    for n in order:
        w, p = info[n]
        spec = RECORDINGS[n]
        lines += [
            "## `%s.mp4`: %s" % (n, spec["title"]),
            "",
            "%s × %s px · %d fps · %s · %.1f s · contact sheet `%s-1fps.png`" % (
                p["w"], p["h"], p["fps"], p["codec"].upper(), p["seconds"], n),
            "",
            spec["summary"],
            "",
            "| Time | What happens |",
            "|---|---|",
        ]
        for s in w["steps"]:
            lines.append("| %s | %s |" % (stamp(s["t"]), spec["steps"][s["step"]][2]))
        lines.append("")
    lines += [
        "## How these were made",
        "",
        "`tools/design/kit/capture.sh recordings`, run from the repo root, records the Simulator with "
        "`tools/video/record.sh` while each UI test runs. It trims each video to the app: from the first frame in "
        "which the launch screen fills the screen (or, for the two gallery holds, from 2 s after the scroll stops, "
        "once the scroll indicator has faded) to the app's last full-screen frame before it closes. Then it "
        "re-encodes at a constant 60 fps (libx264, CRF 18) and draws the contact sheet "
        "(`tools/design/kit/capture-sheet.swift`). The step times come from the test's result bundle. A re-run "
        "replaces these files, and the times can move by a few tenths of a second.",
        "",
    ]
    with open(os.path.join(rec_dir, "recordings.md"), "w") as f:
        f.write("\n".join(lines))
    print("doc: %s/recordings.md (%d recordings)" % (rec_dir, len(order)))
    return 0


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd, args = argv[1], argv[2:]
    if cmd == "watch":
        return watch(*args)
    if cmd == "renders":
        return renders(*args)
    if cmd == "indicator":
        return indicator(*args)
    if cmd == "window":
        return window(*args)
    if cmd == "doc":
        return doc(*args)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
