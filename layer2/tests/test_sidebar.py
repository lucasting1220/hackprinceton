"""The dashboard draws the sidebar that contracts/sidebar.json gives, shared with Layer 1."""

import json
import re
import shutil
import subprocess

from conftest import contract
from fastapi.testclient import TestClient
from starlette.websockets import WebSocket

from layer2.coordinator.registry import Registry
from layer2.coordinator.server import create_dashboard_app
from layer2.coordinator.sidebar import (
    HOME_ITEMS,
    ICON_SVG_ATTRIBUTES,
    ICONS,
    LAPTOP_ICON,
    icon_svg,
)

NODE_TIMEOUT_S = 20


def served_page() -> str:
    registry: Registry[WebSocket] = Registry()
    app = create_dashboard_app(registry, bridge_url=contract("coordinator.json")["bridge_url"])
    text: str = TestClient(app, base_url="http://127.0.0.1").get("/").text
    return text


def test_the_sidebar_module_matches_the_contract() -> None:
    sidebar = contract("sidebar.json")
    home, laptops = sidebar["groups"]
    assert home["title"] == "Home" and laptops["title"] == "Laptops"
    fields = ("id", "label", "page", "path", "icon")
    assert [tuple(item[f] for f in fields) for item in home["items"]] == [
        tuple(item) for item in HOME_ITEMS
    ]
    assert laptops["icon"] == LAPTOP_ICON
    assert sidebar["icons"] == ICONS
    assert sidebar["icon_svg_attributes"] == ICON_SVG_ATTRIBUTES


def test_the_page_draws_the_home_group_in_the_contracts_order() -> None:
    page = served_page()
    nav = page[page.index("<nav>") : page.index("</nav>")]
    sidebar = contract("sidebar.json")
    assert f'<div class="brand">{sidebar["brand"]}</div>' in nav
    places = [nav.index(f'id="nav-{item["id"]}"') for item in sidebar["groups"][0]["items"]]
    assert places == sorted(places)
    assert places[-1] < nav.index('<div class="group">Laptops</div>')
    for item in sidebar["groups"][0]["items"]:
        link = nav[nav.index(f'id="nav-{item["id"]}"') :].split("</a>")[0]
        assert icon_svg(item["icon"]) in link
        assert f"<span>{item['label']}</span>" in link
    assert f'<template id="icon-laptop">{icon_svg(LAPTOP_ICON)}</template>' in page


def test_only_the_set_up_item_is_named_for_setup() -> None:
    page = served_page()
    headings = re.findall(r'el\("h2", "[^"]*", "([^"]*)"\)', page)
    labels = re.findall(
        r"<span>([^<]*)</span></a>", page[page.index("<nav>") : page.index("</nav>")]
    )
    assert "Missing" in headings and "Set up" in labels
    named = [t for t in headings + labels if re.search("set ?up", t, re.I) and t != "Set up"]
    assert named == [], "a heading or label besides Set up names setup"


def test_the_laptops_group_is_sorted_by_name_then_node_id() -> None:
    node = shutil.which("node")
    assert node is not None, "Node.js must be on PATH (CLAUDE.md)"
    script = served_page().split("<script>")[1].split("</script>")[0]
    functions = re.search(r"function byCodePoint.*?\nconst sidebarOrder = .*?;\n", script, re.S)
    assert functions is not None
    laptops = [
        {"display_name": "kitchen", "node_id": "b"},
        {"display_name": "Kitchen", "node_id": "b"},
        {"display_name": "Kitchen", "node_id": "a"},
        {"display_name": "\U0001f600 den", "node_id": "c"},
        {"display_name": "Ａ hall", "node_id": "d"},
    ]
    program = (
        functions.group(0)
        + f"process.stdout.write(JSON.stringify({json.dumps(laptops)}.sort(sidebarOrder)));"
    )
    ran = subprocess.run(
        [node, "-e", program],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=NODE_TIMEOUT_S,
        check=True,
    )
    expected = sorted(laptops, key=lambda laptop: (laptop["display_name"], laptop["node_id"]))
    assert json.loads(ran.stdout) == expected
