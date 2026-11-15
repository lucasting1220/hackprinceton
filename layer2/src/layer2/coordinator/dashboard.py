"""The coordinator's dashboard page, built to be shown to judges on a projector: headline tiles
(laptops online, memory pooled, jobs running, work not placed), one card per laptop with its
hardware, RAM and CPU use (bars and a two-minute chart) and the jobs placed on it, and the work
that could not be placed. Light, large type; read-only.

It reads /api/state (the Layer 1 contract: status, jobs, dropped work) and /api/hardware
(Layer 2 only: specs and load) every DASHBOARD_POLL_S, never starting a poll before the last
one finished. Staleness is measured against each response's own `updated_at`, never the
browser's clock. Worker-supplied text is set with textContent only. No external scripts, so
it works on a hotspot with no internet.
"""

from importlib.resources import files

from layer2 import settings

_HISTORY_POINTS = 120  # two minutes at one poll a second

PAGE = (
    files("layer2.coordinator")
    .joinpath("dashboard.html")
    .read_text(encoding="utf-8")
    .replace("__STALE_AFTER_MS__", str(int(settings.STALE_AFTER_S * 1000)))
    .replace("__POLL_MS__", str(int(settings.DASHBOARD_POLL_S * 1000)))
    .replace("__HISTORY_POINTS__", str(_HISTORY_POINTS))
)
