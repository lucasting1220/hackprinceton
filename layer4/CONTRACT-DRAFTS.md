# Layer 4 contract drafts, for Lucas

These are proposals, not merged contracts. They follow CLAUDE.md section 9: snake_case fields, a `type` on every message, a `schema_version` on every file, `_at` times in ISO 8601 UTC, and string IDs with no meaning in their format. Each would land as one example file in `contracts/`, through a shared-files pull request that the affected owners approve.

## 1. `contracts/alert.json`: Layer 4 to Layer 1 (`POST /v1/alerts`, carried by Layer 2's coordinator)

```json
{
  "schema_version": 1,
  "type": "alert",
  "alert_id": "6f1c2a8e-3b7d-4f0a-9c55-2e8d1a4b7f90",
  "kind": "heart_rate",
  "severity": "urgent",
  "detected_at": "2026-11-14T03:12:00Z",
  "title": "Heart rate alert",
  "body": "Heart rate of 142 recorded at 10:12 PM on Nov 13",
  "update": false
}
```

- `kind` is one of `fall`, `help`, `heart_rate` or `monitoring`.
- `severity` is always `urgent`. Nothing below a threshold produces an alert.
- `detected_at` is when the event happened. For heart rate that is the reading's `measured_at`, and for monitoring it is when the thing stopped. It is written to whole seconds with a `Z` suffix, as in `2026-11-14T03:12:00Z`. The serializer drops microseconds and never writes `+00:00`.
- `update: false` is the template alert, sent immediately. A language model's rewrite follows later, with the same `alert_id` and `update: true`. Only `title` and `body` may change in an update. The phone replaces the earlier text.
- The body contains a clock time in the home's local zone. Layer 4 builds the text, and the phone shows it as received.

## 2. `contracts/event-log-entry.json`: Layer 4 writes, through Layer 2's `log` call, stored on the coordinator

```json
{
  "schema_version": 1,
  "type": "event",
  "event_id": "b2e7c0d4-91a3-4c8e-8f21-5d6a7e9b0c13",
  "kind": "fall",
  "detected_at": "2026-11-14T03:12:00Z",
  "recorded_at": "2026-11-14T03:12:01Z",
  "node_id": "node-uuid",
  "urgent": true,
  "alert_id": "6f1c2a8e-3b7d-4f0a-9c55-2e8d1a4b7f90",
  "details": {
    "confidence": 0.91
  }
}
```

- One entry is written per signal the upper tier sees, urgent or not. That is the doc's "Anything else: event log only".
- `alert_id` is `null` when no alert was sent.
- `details` depends on `kind`:
  - `fall`: `confidence`
  - `help`: `is_call_for_help`
  - `heart_rate`: `bpm` and `measured_at`
  - `monitoring`: `what_stopped`, `stopped_at` and `checked_at`
- Privacy: an entry never holds video, audio or a transcript. A help event stores only the verdict. This matches "No video or audio is stored" in CLAUDE.md section 2.

## Questions for the owners

1. **Home time zone (Layer 1 and Layer 4).** Today alert text uses the zone of whichever worker runs the upper tier. Two reviewers flagged this. If the laptops' zones differ, the same event can read differently. The text also carries no zone label, so a remote caregiver can't tell which zone a time is in. Proposal: the setup page records the home's IANA zone in `worker.json` as `home_time_zone`, and Layer 4 passes it to the rules.
2. **Watch bpm type (Layer 3).** Layer 4 accepts only a whole-number `bpm` and rejects `142.0`. Proposal: the watch-reading contract pins `bpm` as an integer, and Layer 3 rounds the HealthKit Double before handing it on.
3. **Event log retention (Layer 2).** How long entries are kept, and whether the daily report deletes anything once it has used it.
