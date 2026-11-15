/**
 * The setup page's stylesheet, served at html.ts's STYLE_PATH: the look of Layer 2's dashboard
 * (its colours, sidebar, hero and panels) for the setup page's own markup. Styles come from this
 * file only, since the page's CSP allows no inline style, and no font or image is loaded.
 */
export const SETUP_CSS = `:root { --bg: #1c1c1e; --side: #262628; --panel: #2c2c2e; --raise: #3a3a3c; --track: #3a3a3c;
  --dim: #48484a; --text: #f2f2f7; --muted: #98989f; --blue: #0a84ff; --pink: #ff375f;
  --orange: #ff9f0a; --green: #30d158; --red: #ff453a; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { display: flex; background: #000; color: var(--text);
  font: 17px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; }
nav { width: 260px; flex: none; background: var(--side); border-right: 1px solid #000; padding: 1.2rem 0;
  display: flex; flex-direction: column; }
nav .brand { padding: 0 1.4rem 1rem; font-weight: 700; font-size: 1.15rem; letter-spacing: .02em; }
nav .group { padding: 1rem 1.4rem .35rem; color: var(--muted); font-size: .8rem; font-weight: 600; }
nav a { display: flex; align-items: center; gap: .75rem; padding: .7rem 1.4rem; color: var(--text);
  text-decoration: none; font-size: 1.05rem; }
nav a:hover { background: #303032; }
nav a.on { background: var(--raise); }
nav a svg { width: 22px; height: 22px; flex: none; color: var(--muted); }
nav a.on svg { color: var(--text); }
main { flex: 1; min-width: 0; background: var(--bg); overflow-y: auto; padding: 2.2rem 2.6rem; }
a { color: var(--blue); }
code, pre { font: .9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
code { background: var(--raise); padding: .1em .4em; border-radius: 6px; overflow-wrap: anywhere; }
pre { background: var(--bg); padding: .8rem 1rem; border-radius: 10px; white-space: pre-wrap;
  overflow-wrap: anywhere; margin: .6rem 0 0; }
strong { font-weight: 600; }

.hero { display: flex; gap: 2.2rem; align-items: center; margin-bottom: 2rem; }
.hero svg.machine { width: 190px; flex: none; }
.hero-text { flex: 1; min-width: 0; }
.hero h1 { margin: 0; font-size: 2.1rem; }
.hero-text > p { color: var(--orange); font-weight: 600; margin: .5rem 0 0; }
.hero .sub { color: var(--muted); font-size: 1.15rem; margin: .2rem 0 1rem; }
.facts { border-top: 1px solid var(--dim); }
.facts p { margin: 0; padding: .45rem 0; border-bottom: 1px solid var(--dim); position: relative; }
.facts p:has(.dot) { padding-right: 1.6rem; }
.facts .dot { position: absolute; right: .2rem; top: 50%; margin-top: -4.5px; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--dim); }
.dot.ok { background: var(--green); } .dot.wait { background: var(--orange); } .dot.off { background: var(--red); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(440px, 100%), 1fr)); gap: 1.4rem;
  align-items: start; }
.card, .panel { background: var(--panel); border-radius: 14px; padding: 1.4rem 1.6rem; }
.card { max-width: 760px; }
.card > :first-child, .panel > :first-child { margin-top: 0; }
.card > :last-child, .panel > :last-child { margin-bottom: 0; }
h2 { margin: 1.4rem 0 1.1rem; font-size: 1.25rem; }
.panel > h2:first-child { margin-top: 0; }
p { margin: .7rem 0; }
.muted { color: var(--muted); }

ul { list-style: none; padding: 0; margin: .8rem 0; border-top: 1px solid var(--dim); }
li { padding: .55rem 0; border-bottom: 1px solid var(--dim); display: flow-root; }
li ul { margin: .3rem 0 0 1rem; border-top: 0; }
li li { padding: .2rem 0; border-bottom: 0; color: var(--orange); font-size: .9rem; }
li:has(> form) { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
li > form { margin: 0; flex: none; }

.device { display: flex; align-items: center; gap: .9rem; padding: .65rem 0; border-top: 1px solid var(--dim); }
.device:last-of-type { border-bottom: 1px solid var(--dim); }
.device .dot { width: 11px; height: 11px; }
.device-text { min-width: 0; overflow-wrap: anywhere; }
.device-text .muted { font-size: .9rem; }

form { display: inline-block; margin: .5rem .6rem .5rem 0; vertical-align: middle; }
form:has(input:not([type="hidden"])) { display: block; margin-right: 0; }
label { display: flex; flex-direction: column; gap: .35rem; color: var(--muted); font-size: .9rem; }
label:has(input[type="checkbox"]) { flex-direction: row; align-items: center; gap: .6rem; color: var(--text);
  font-size: 1rem; }
input:not([type="checkbox"]):not([type="hidden"]) { font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--dim); border-radius: 10px; padding: .6rem .8rem; width: 100%; max-width: 420px; }
input:focus { outline: 2px solid var(--blue); outline-offset: 1px; border-color: transparent; }
input[type="checkbox"] { width: 20px; height: 20px; accent-color: var(--blue); margin: 0; }
button, .action a { font: inherit; font-weight: 600; font-size: 1rem; color: #fff; background: var(--blue);
  border: 0; border-radius: 10px; padding: .6rem 1.2rem; cursor: pointer; display: inline-block;
  text-decoration: none; }
button:hover, .action a:hover { filter: brightness(1.12); }
button:focus-visible, .action a:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.action a, form[action$="/cancel"] button, form[action="/join/reset"] button,
form[action="/join/check"] button { background: var(--raise); color: var(--text); }
form[action="/phones/remove"] button { background: var(--raise); color: var(--red); padding: .35rem .9rem;
  font-size: .9rem; }
details { margin: .8rem 0; color: var(--muted); }
summary { cursor: pointer; }

.qr { display: inline-block; background: #fff; border-radius: 14px; padding: .4rem; margin: .4rem 0; line-height: 0; }
.qr svg { display: block; }
.code h2 { font-size: 3.2rem; font-weight: 600; letter-spacing: .25em; font-variant-numeric: tabular-nums;
  margin: .6rem 0; }

@media (max-width: 1100px) {
  .hero { gap: 1.4rem; }
  .hero svg.machine { width: 130px; }
}
@media (max-width: 900px) {
  .hero { flex-direction: column; align-items: stretch; gap: 1rem; }
  .hero svg.machine { width: 120px; align-self: flex-start; }
}
@media (max-width: 760px) {
  body { flex-direction: column; font-size: 16px; }
  nav { width: auto; flex-direction: row; flex-wrap: wrap; padding: .5rem; }
  nav .brand, nav .group { display: none; }
  nav a { padding: .5rem .8rem; border-radius: 8px; }
  main { padding: 1.2rem; }
  .hero { flex-direction: column; align-items: stretch; gap: 1rem; }
  .hero svg.machine { width: 120px; align-self: flex-start; }
  .grid { grid-template-columns: 1fr; }
}
`;
