"""The dashboard's side of the sidebar it shares with Layer 1's setup page (contracts/sidebar.json):
the Home group's items, labels, order and icons, drawn on the server. The Laptops group is drawn
by home.html from /api/state, with the laptop icon from LAPTOP_ICON_TEMPLATE."""

import html
import urllib.parse
from typing import Final, Literal, NamedTuple


class Item(NamedTuple):
    """One sidebar item: `page` is the program that serves `path`."""

    id: str
    label: str
    page: Literal["dashboard", "setup"]
    path: str
    icon: str


HOME_ITEMS: Final = (
    Item("overview", "Overview", "dashboard", "/#overview", "overview"),
    Item("setup", "Set up", "setup", "/", "setup"),
    Item("devices", "Devices", "setup", "/devices", "devices"),
)
LAPTOP_ICON: Final = "laptop"

ICON_SVG_ATTRIBUTES: Final = (
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
)
ICONS: Final = {
    "overview": (
        '<rect x="3" y="3" width="8" height="8" rx="2"/>'
        '<rect x="13" y="3" width="8" height="8" rx="2"/>'
        '<rect x="3" y="13" width="8" height="8" rx="2"/>'
        '<rect x="13" y="13" width="8" height="8" rx="2"/>'
    ),
    "setup": '<circle cx="12" cy="12" r="9"/><path d="M12 8 V16 M8 12 H16"/>',
    "devices": '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5 H13"/>',
    "laptop": '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19 H22"/>',
}


def icon_svg(name: str) -> str:
    return f"<svg {ICON_SVG_ATTRIBUTES}>{ICONS[name]}</svg>"


LAPTOP_ICON_TEMPLATE: Final = f'<template id="icon-laptop">{icon_svg(LAPTOP_ICON)}</template>'


def setup_page_origin(bridge_url: str | None) -> tuple[str, str] | None:
    """The scheme and host:port of Layer 1's setup page, served by the bridge at `bridge_url` on
    this laptop, or None unless `bridge_url` is a plain http(s) address on 127.0.0.1 or
    localhost."""
    if bridge_url is None:
        return None
    try:
        parts = urllib.parse.urlsplit(bridge_url)
        port = parts.port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or parts.hostname not in ("127.0.0.1", "localhost"):
        return None
    return parts.scheme, parts.hostname if port is None else f"{parts.hostname}:{port}"


def home_group(bridge_url: str | None) -> str:
    """The Home group's links, in the contract's order. The setup page's items are left out when
    `bridge_url` gives no setup page to link to."""
    origin = setup_page_origin(bridge_url)
    links = []
    for item in HOME_ITEMS:
        if item.page == "dashboard":
            href = item.path
        elif origin is None:
            continue
        else:
            href = urllib.parse.urlunsplit((origin[0], origin[1], item.path, "", ""))
        attributes = (
            f'href="{html.escape(href, quote=True)}" id="nav-{item.id}" data-page="{item.page}"'
        )
        links.append(
            f"  <a {attributes}>{icon_svg(item.icon)}<span>{html.escape(item.label)}</span></a>"
        )
    return "\n".join(links)
