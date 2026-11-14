"""The dashboard page. It polls /api/state and /api/hardware every DASHBOARD_POLL_S, lists
each laptop's hardware and latest load, and shows a laptop in red as
"not reporting" when its last status is older than STALE_AFTER_S. Staleness is measured
against the response's own `updated_at`, never the browser's clock. Text is set with
textContent only, because names and reasons come from workers."""

from layer2 import settings

PAGE = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Layer 2 laptops</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; background: #fff; }}
  table {{ border-collapse: collapse; width: 100%; }}
  th, td {{ text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; }}
  tr.quiet td {{ color: #b00020; }}
  #error {{ color: #b00020; }}
</style>
</head>
<body>
<h1>Laptops</h1>
<p id="error"></p>
<table>
  <thead><tr>
    <th>Name</th><th>Status</th><th>Last report</th><th>Sensors</th><th>Missing</th>
  </tr></thead>
  <tbody id="laptops"></tbody>
</table>
<h2>Hardware</h2>
<table>
  <thead><tr>
    <th>Name</th><th>OS</th><th>CPU</th><th>Cores</th><th>Memory</th><th>GPU</th>
    <th>Ollama</th><th>llama.cpp</th><th>CPU load</th><th>Free memory</th>
  </tr></thead>
  <tbody id="hardware"></tbody>
</table>
<script>
const STALE_AFTER_MS = {int(settings.STALE_AFTER_S * 1000)};
const POLL_MS = {int(settings.DASHBOARD_POLL_S * 1000)};

function cell(row, text) {{
  const td = document.createElement("td");
  td.textContent = text;
  row.appendChild(td);
}}

function markAllUnknown() {{
  for (const row of document.getElementById("laptops").rows) {{
    row.className = "quiet";
    row.cells[1].textContent = "unknown";
  }}
  for (const row of document.getElementById("hardware").rows) {{
    row.className = "quiet";
    row.cells[8].textContent = "unknown";
    row.cells[9].textContent = "unknown";
  }}
}}

function yesNo(value) {{
  return value ? "yes" : "no";
}}

function load(value, unit, quiet) {{
  if (quiet || value === null) return "unknown";
  return (Math.round(value * 10) / 10) + unit;
}}

async function refreshHardware() {{
  const response = await fetch("/api/hardware", {{ cache: "no-store" }});
  if (!response.ok) throw new Error("status " + response.status);
  const state = await response.json();
  const now = Date.parse(state.updated_at);
  const body = document.getElementById("hardware");
  body.replaceChildren();
  for (const laptop of state.laptops) {{
    const quiet = now - Date.parse(laptop.last_status_at) > STALE_AFTER_MS;
    const row = document.createElement("tr");
    if (quiet) row.className = "quiet";
    cell(row, laptop.display_name);
    cell(row, laptop.specs.os + " " + laptop.specs.os_version);
    cell(row, laptop.specs.cpu);
    cell(row, String(laptop.specs.cores));
    cell(row, laptop.specs.memory_gb + " GB");
    cell(row, laptop.specs.gpu);
    cell(row, yesNo(laptop.tools.ollama));
    cell(row, yesNo(laptop.tools.llama_cpp));
    cell(row, load(laptop.cpu_percent, " %", quiet));
    cell(row, load(laptop.memory_free_gb, " GB", quiet));
    body.appendChild(row);
  }}
}}

async function refresh() {{
  const error = document.getElementById("error");
  try {{
    const response = await fetch("/api/state", {{ cache: "no-store" }});
    if (!response.ok) throw new Error("status " + response.status);
    const state = await response.json();
    const now = Date.parse(state.updated_at);
    const body = document.getElementById("laptops");
    body.replaceChildren();
    for (const laptop of state.laptops) {{
      const age = now - Date.parse(laptop.last_status_at);
      const quiet = age > STALE_AFTER_MS;
      const row = document.createElement("tr");
      if (quiet) row.className = "quiet";
      cell(row, laptop.display_name);
      cell(row, quiet ? "not reporting" : "reporting");
      cell(row, Math.round(age / 1000) + " s ago");
      cell(row, laptop.sensors.join(", ") || "none");
      cell(row, laptop.missing.map((item) => item.id).join(", ") || "nothing");
      body.appendChild(row);
    }}
    await refreshHardware();
    error.textContent = "";
  }} catch (problem) {{
    markAllUnknown();
    error.textContent = "Cannot reach the coordinator. Laptop status is unknown.";
  }}
}}

refresh();
setInterval(refresh, POLL_MS);
</script>
</body>
</html>
"""
