Local AI Home Caregiver: Concept and Build Roadmap
Summary
The product turns a spare laptop into a private home-monitoring hub for an elderly person, with an iPhone app for the family member or caregiver who looks after them. The hub watches cameras, listens to microphones, and reads heart rate from an Apple Watch. It alerts the caregiver when something looks wrong and can talk with the person at home.
Four design decisions shape everything else:
Local first. Video and audio are processed on the hub and never leave the house. Only alert text and status reach the caregiver's phone.
Small specialist models do the watching. Fall detection, sound detection and heart-rate rules run continuously. A small language model is woken only to interpret events, talk, and summarize.
Emergency alerts are rule-based. The language model adds context but is never the only path between an incident and a notification.
It supplements human care. It is an alerting and check-in aid for people who can mostly live independently, not a replacement for a nursing home or a medical device.
Problem and users
Residential care costs more than many families can pay, and the cheaper options are either an aide by the hour or a pendant the person has to remember to press.
Care option (US national median)
Cost
Assisted living community
6,200permonth(74,000 per year)
Non-medical in-home caregiver
$80,080 per year
Nursing home, semi-private room
$114,975 per year
Nursing home, private room
$129,575 per year

Figures from AHCA/NCAL Assisted Living Facts and Figures, which cites the Genworth Cost of Care Survey.
Three people use the product:
The person at home. Lives mostly independently but is at risk of falls or heart problems. Wears the Apple Watch and must agree to the cameras and microphones.
The caregiver. Usually an adult child or relative who is not in the house. Wants to hear quickly when something is wrong without watching video all day.
The installer. Often the caregiver, and often not technical. The hardware probe and guided setup exist for this person.
The product cannot give physical help such as lifting, bathing or handing over medication, and it is not enough supervision for someone with advanced dementia. It fits people who are safe alone most of the time and need a fast response the few times they are not.
How it works
Sensors feed a hub in the home, the hub decides when to alert, and a small internet relay carries only the alert to the caregiver's iPhone.
[embed: node/0bfb22e2-8e22]
The rules engine sits between the detectors and everything else, so an alert never waits on the language model.
Detectors are small models that run all the time: body-pose and fall detection on camera frames, sound-event detection on audio, and speech-to-text when someone speaks to the hub.
The rules engine turns detector output and heart-rate readings into alerts using fixed thresholds and timers. It also runs the watchdog.
The small language model is woken by events. It writes the alert in plain language, handles spoken check-ins, and produces a daily summary. On Tier A hardware it is absent and alerts use templates.
The push relay is the one cloud component. Apple's push service needs a server to send notifications, and the caregiver needs to reach the hub from outside the home. It carries encrypted alert text and status, never video or audio.
The caregiver app shows current status, alert history, heart-rate trend and sensor health, and lets the caregiver acknowledge alerts, start a live check, or send a spoken message.
The companion apps on the elderly person's iPhone and Watch exist to move heart-rate data to the hub.
Hardware probe and model tiers
The probe should be a plain script, not an agent: it reads the machine's specs, runs a two-minute benchmark, and assigns one of three tiers. A script gives the same answer every time and cannot misread a spec sheet.
What it measures:
CPU model, core count and instruction-set support
RAM, and GPU memory if there is a GPU (unified memory on Apple Silicon)
Free disk space, operating system, and whether the machine can stay awake with the lid closed
Benchmark 1: frames per second of the fall-detection model on a sample clip
Benchmark 2: tokens per second of a small language model
Tier
Typical machine
What runs
A: Sensors only
8 GB RAM, older dual or quad core, no GPU
Fall and sound detection on 1 to 2 cameras, heart-rate rules, alerts with templated text. No language model.
B: Small model
16 GB RAM, recent quad core or Apple Silicon
Tier A plus a 3 to 4 billion parameter quantized language model for summaries and simple conversation, and local speech-to-text.
C: Full
16 GB or more with a 6 GB+ GPU, or Apple Silicon with 16 GB+
3 to 4 cameras, a 7 to 8 billion parameter model, and a vision check on a single frame after an alert.

These tier boundaries are starting assumptions; Phase 0 benchmarks on real old laptops should replace them. A machine below Tier A gets a clear "not suitable" message.
An agent is still useful after the probe, for walking the installer through setup and diagnosing camera or driver problems.
Laptop-specific points to handle:
The battery is a free backup power supply during short outages, but swollen old batteries are a fire risk, so the probe should report battery health.
Running at load around the clock stresses old cooling systems. The hub should log temperature and throttle camera frame rate before it overheats.
Sleep, lid-close and automatic OS updates must be configured so the hub never goes quiet without the watchdog noticing.
Apple Watch heart rate
An Apple Watch cannot stream heart rate to the hub directly or continuously, so the design needs a slow always-on feed plus a live mode that is switched on only when needed. This is the largest technical risk in the project and should be tested first.
The platform limits:
No direct link from Watch to hub. Apple's developer support says a watchOS app's requests to a server on the local network won't work by default. Data has to go Watch to paired iPhone to hub, or Watch to an internet relay to hub.
Fast readings need a workout session. An Apple engineer confirmed in a developer forum thread that no API other than an active workout session triggers high-frequency sampling. The same thread reports readings every 1 to 5 seconds in a session, and about 4 updates per hour from background delivery without one.
Workout sessions have side effects. They move the Activity rings, create a workout record, and use more battery, so running one all day is not practical.
Fall events need Apple's approval. Third-party apps can receive the Watch's own fall detections through CMFallDetectionManager, which requires an entitlement Apple grants on request. A developer using it reports the app is told only after Apple's own emergency flow finishes.
The design that fits those limits:
Baseline feed. A companion app on the elderly person's iPhone reads heart rate from HealthKit as the Watch syncs it, and forwards it to the hub over home Wi-Fi. Readings arrive minutes apart. Good for trends, resting-rate drift and noticing the Watch is not being worn.
Live mode. When the hub suspects a problem (a possible fall, a cry for help, or the caregiver tapping "check now"), the Watch app starts a short workout session and streams readings every few seconds through the iPhone. Whether the hub can start this reliably while the Watch app is in the background needs a Phase 0 test.
Apple's own safety features stay on. Fall Detection, high and low heart-rate notifications and Emergency SOS work even when the hub is down. Treat them as an independent layer, and apply for the fall-detection entitlement early.
Consequences for the product:
The elderly person needs an iPhone at home paired with the Watch, not only a Watch.
The Watch needs charging every day, which leaves a daily gap. The hub should show "no heart data" as a status, not raise it as an alarm.
Wrist heart rate is a wellness signal. The product should not present it as a diagnosis.
Safety, privacy and consent
The system has to fail loudly, alert on rules instead of model judgment, and leave the person at home in control of being watched.
Alerting
A detector fires (fall posture, no movement for a set time, a cry or thud, heart rate outside limits).
The hub asks aloud, "Are you okay?" and listens for an answer.
No clear answer within a short window: the caregiver gets a push alert saying what was detected and when.
No acknowledgment from the caregiver: the alert goes to a second contact.
Calling emergency services stays a human decision, or the Watch's own Emergency SOS.
Failing loudly
The hub sends a heartbeat to the relay every minute. If it stops, the relay tells the caregiver the hub is offline.
The app shows camera offline, microphone offline and Watch not worn as visible states.
Every alert has a "false alarm" button, and that feedback is used to tune thresholds for the household.
Privacy
Video and audio are processed in memory and discarded. Nothing is uploaded.
Saving a short clip around an alert is off by default, and stored encrypted on the hub if the household turns it on.
No cameras in bathrooms or bedrooms by default. Use microphones or radar-type presence sensors there, since those rooms are where privacy matters most and falls are common.
A physical mute switch and a visible indicator show when sensors are live.
Consent
The person at home agrees to each sensor during setup and can pause monitoring.
If the person cannot give informed consent, the family needs proper legal authority. Get legal advice before supporting that case.
Visitors and paid aides are also recorded. Audio-recording consent laws differ by state, so the product needs a notice and guidance.
Security
Encrypted disk, automatic updates, no open inbound ports on the home network.
Caregiver phones pair with the hub by QR code, and alerts are encrypted end to end so the relay cannot read them.
Regulatory framing
Claims that the product detects or diagnoses medical conditions can bring medical-device regulation into play. Describing it as an alerting and check-in aid is safer, and a lawyer should review the wording before any launch. I am not a lawyer, and this section is not legal advice.
Roadmap
Build in six phases, starting with the two things most likely to sink the project: getting Apple Watch heart rate to the hub, and running fall detection fast enough on old hardware.
[embed: node/84fa7648-9214]
Phases run left to right, top row first. Do not start a phase until the gate before it passes. As a rough guide, one or two developers should expect six to nine months to reach the pilot; that estimate needs your team size to firm up.
Phase 0: Prove the risky parts
A throwaway Watch and iPhone app that gets heart rate onto a laptop on the same Wi-Fi, in both baseline and live mode. Measure latency and Watch battery drain over a full day.
Apply for Apple's fall-detection entitlement.
Run a pose and fall model on three real old laptops and record frames per second and temperature.
Run a small language model on the same machines and record tokens per second.
Gate: a written go or no-go on the Apple Watch path, and measured numbers to set the hardware tiers.
Phase 1: Hub and hardware probe
The probe script and tier assignment, with a plain-language result screen.
Hub service that starts on boot, stays awake, and updates itself.
Ingest from one camera and one microphone, and an event log.
Gate: the hub runs for 7 days on an old laptop with no restart and no manual fixes.
Phase 2: Detection and alerts
Fall detection, no-movement timer, sound events, and heart-rate rules.
The rules engine with the spoken "Are you okay?" step and escalation.
Watchdog heartbeat and sensor-health states.
A test set of staged falls and normal activity (sitting down hard, lying on the sofa, dropping things, TV audio) to measure misses and false alarms.
Gate: staged falls are caught, and a week of normal living produces few enough false alarms that you would tolerate them yourself.
Phase 3: iPhone and Watch apps
Caregiver app: status, alerts, acknowledge, heart-rate trend, sensor health.
Push relay with end-to-end encrypted alert text.
QR-code pairing between hub and phones.
Production versions of the Watch and elder-side iPhone companion apps.
Gate: an alert raised in the home reaches a phone on mobile data, and a hub that is unplugged produces an "offline" notification.
Phase 4: Language model
Plain-language alert text and daily summaries.
Spoken check-ins and simple conversation, with speech-to-text and text-to-speech on the hub.
Tier A fallback to templates.
Gate: with the language model stopped or overloaded, every alert still arrives on time.
Phase 5: Home pilot
Consent flow, pause control, privacy settings, and visitor notice.
Guided installer a non-technical caregiver can finish alone.
Run in a few real homes with families who know it is a pilot and have a backup plan.
Legal review of claims and terms before anything wider.
Gate: pilot families choose to keep using it, and no emergency was missed without the system flagging its own gap.
Risks and open questions
The risk that matters most is a missed emergency, followed by families trusting the system more than it deserves.
Risk
Mitigation
A fall or emergency is missed
Layer camera, sound, Watch and no-movement detection. Publish what the system cannot detect. Keep Apple's own Fall Detection on.
Too many false alarms, so alerts get ignored
Voice check before alerting, per-household threshold tuning, false-alarm feedback.
Apple changes or restricts heart-rate access
Test on each new watchOS release. Keep the baseline HealthKit feed as a fallback. Support a Bluetooth chest strap as a second source later.
The old laptop fails
Watchdog, battery-health and temperature checks, a published minimum spec.
Camera or audio data leaks
Local processing, nothing stored by default, encrypted disk, no inbound ports.
A family relies on it in place of care the person needs
Clear positioning, onboarding that states the limits, legal review of terms.

Open questions that change the plan:
Does the person at home have an iPhone, or only a Watch set up by a family member?
Which cameras: existing Wi-Fi cameras, or USB webcams wired to the hub?
Which hub operating system first: Windows, macOS or Linux?
Is this an open-source project or a product to sell? That changes the regulatory work and who pays for the relay.
Who is building it and how many hours a week? The roadmap has no dates until this is known.
Which spoken languages must voice check-ins support?
Sources
AHCA/NCAL Assisted Living Facts and Figures: Finance
Apple Developer Forums: How to monitor heart rate in background without affecting Activity Rings?
Apple Developer Forums: Do watchOS apps support IP request communication within a local area network?
Apple Developer Documentation: CMFallDetectionManager
Apple Developer Forums: Delayed reports from CMFallDetectionManager
