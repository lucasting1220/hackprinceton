import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  HOME_ITEMS,
  ICON_SVG_ATTRIBUTES,
  ICONS,
  page,
  html,
  sidebar,
  withHomeSidebar,
} from "../bridge/src/html.ts";

const contractFile = path.join(import.meta.dirname, "..", "..", "contracts", "sidebar.json");

type ContractItem = { id: string; label: string; page: string; path: string; icon: string };
type Contract = {
  brand: string;
  groups: [
    { title: string; items: (ContractItem & { home_laptop_only: boolean })[] },
    { title: string; icon: string; path: string; home_laptop_only: boolean },
  ];
  icon_svg_attributes: string;
  icons: Record<string, string>;
};

async function contract(): Promise<Contract> {
  return JSON.parse(await readFile(contractFile, { encoding: "utf8" })) as Contract;
}

const HOME = { dashboard: "http://127.0.0.1:7450", laptops: [] };

test("the sidebar's items, order and icons are contracts/sidebar.json's", async () => {
  const { groups, icon_svg_attributes, icons } = await contract();
  const [homeGroup, laptops] = groups;
  assert.equal(homeGroup.title, "Home");
  assert.deepEqual(
    HOME_ITEMS.map(({ id, label, page, path, icon, homeLaptopOnly }) => ({
      id,
      label,
      page,
      path,
      icon,
      home_laptop_only: homeLaptopOnly,
    })),
    homeGroup.items,
  );
  assert.equal(laptops.title, "Laptops");
  assert.equal(laptops.icon, "laptop");
  assert.equal(laptops.home_laptop_only, true);
  assert.deepEqual({ ...ICONS }, icons);
  assert.equal(ICON_SVG_ATTRIBUTES, icon_svg_attributes);
});

test("a laptop with no home shows only Set up and Devices", async () => {
  const { brand } = await contract();
  const nav = sidebar("setup");
  assert.ok(nav.startsWith(`<nav data-active="setup"><div class="brand">${brand}</div>`));
  assert.deepEqual(
    [...nav.matchAll(/id="nav-([a-z]+)"/g)].map((m) => m[1]),
    ["setup", "devices"],
  );
  assert.ok(!nav.includes(">Laptops</div>"));
});

test("the home laptop adds Overview first and its laptops sorted by name, then node ID", () => {
  const laptops = [
    { nodeId: "b", displayName: "kitchen" },
    { nodeId: "b", displayName: "Kitchen" },
    { nodeId: "a/1", displayName: "Kitchen" },
    { nodeId: "c", displayName: "\u{1F600} den" },
    { nodeId: "d", displayName: "Ａ <hall>" },
  ];
  const nav = sidebar("devices", { dashboard: "http://localhost:7450", laptops });
  const ids = [...nav.matchAll(/id="nav-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["overview", "setup", "devices"]);
  assert.ok(nav.includes('<a href="http://localhost:7450/#overview" id="nav-overview">'));
  assert.ok(nav.includes('<a href="/devices" id="nav-devices" class="on">'));
  const names = [...nav.matchAll(/<span>([^<]*)<\/span><\/a>/g)].map((m) => m[1]).slice(3);
  assert.deepEqual(names, ["Kitchen", "Kitchen", "kitchen", "Ａ &#60;hall&#62;", "\u{1F600} den"]);
  assert.ok(nav.includes('href="http://localhost:7450/#a%2F1"'), "the node ID isn't URL-encoded");
  assert.ok(nav.indexOf(">Laptops</div>") > nav.indexOf('id="nav-devices"'));
});

test("withHomeSidebar keeps the page's highlighted item and the rest of the page", () => {
  for (const active of ["setup", "devices"] as const) {
    const plain = page("Devices", html`<p>body</p>`, undefined, { active });
    const homed = withHomeSidebar(plain, HOME);
    assert.ok(homed.includes(sidebar(active, HOME)), active);
    assert.equal(homed.replace(sidebar(active, HOME), sidebar(active)), plain);
  }
  assert.equal(withHomeSidebar("<p>no sidebar</p>", HOME), "<p>no sidebar</p>");
});
