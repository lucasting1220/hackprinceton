#!/usr/bin/env python3
"""Fetch an Apple HIG or developer-documentation page as plain text.

Apple's documentation site is a single-page app; its content is served as DocC
JSON. This tool fetches that JSON and renders headings, paragraphs, lists,
tables, asides and code listings as Markdown-ish text.

Usage (run with `python3 -I` so nothing is imported from the current folder):
  python3 -I tools/research/appledoc.py design/human-interface-guidelines/motion
  python3 -I tools/research/appledoc.py documentation/swiftui/spring
  python3 -I tools/research/appledoc.py https://developer.apple.com/documentation/swiftui/spring

Prints the page title, the canonical URL, and the body. Exit code 1 on failure.
"""
import json
import sys
import urllib.request

BASE = "https://developer.apple.com/tutorials/data/"


def to_path(arg: str) -> str:
    arg = arg.strip()
    for prefix in ("https://developer.apple.com/", "http://developer.apple.com/"):
        if arg.startswith(prefix):
            arg = arg[len(prefix):]
    arg = arg.split("#")[0].split("?")[0].strip("/")
    if arg.endswith(".json"):
        arg = arg[:-5]
    return arg


def inline(nodes, refs):
    out = []
    for n in nodes or []:
        t = n.get("type")
        if t == "text":
            out.append(n.get("text", ""))
        elif t == "codeVoice":
            out.append("`" + n.get("code", "") + "`")
        elif t in ("emphasis", "strong", "newTerm", "inlineHead"):
            mark = "**" if t in ("strong", "inlineHead") else "_"
            out.append(mark + inline(n.get("inlineContent"), refs) + mark)
        elif t == "reference":
            ref = refs.get(n.get("identifier", ""), {})
            title = ref.get("title") or n.get("identifier", "").split("/")[-1]
            url = ref.get("url", "")
            if url.startswith("/"):
                url = "https://developer.apple.com" + url
            out.append(f"{title} <{url}>" if url else title)
        elif t == "link":
            out.append(f"{n.get('title', '')} <{n.get('destination', '')}>")
        elif t == "image":
            out.append("[image]")
        else:
            out.append(inline(n.get("inlineContent"), refs))
    return "".join(out)


def blocks(nodes, refs, depth=0):
    lines = []
    pad = "  " * depth
    for n in nodes or []:
        t = n.get("type")
        if t == "heading":
            lines.append("\n" + "#" * min(6, n.get("level", 2) + 1) + " " + n.get("text", ""))
        elif t == "paragraph":
            lines.append(pad + inline(n.get("inlineContent"), refs))
        elif t in ("unorderedList", "orderedList"):
            for i, item in enumerate(n.get("items", []), 1):
                bullet = f"{i}." if t == "orderedList" else "-"
                body = blocks(item.get("content"), refs, depth + 1).strip()
                lines.append(f"{pad}{bullet} {body}")
        elif t == "aside":
            body = blocks(n.get("content"), refs, depth).strip()
            lines.append(f"{pad}> {n.get('style', 'note').upper()}: {body}")
        elif t == "codeListing":
            lines.append(pad + "```" + (n.get("syntax") or ""))
            lines.extend(pad + c for c in n.get("code", []))
            lines.append(pad + "```")
        elif t == "table":
            for row in n.get("rows", []):
                cells = [blocks(c, refs).strip().replace("\n", " ") for c in row]
                lines.append(pad + "| " + " | ".join(cells) + " |")
        elif t == "termList":
            for item in n.get("items", []):
                term = inline(item.get("term", {}).get("inlineContent"), refs)
                definition = blocks(item.get("definition", {}).get("content"), refs).strip()
                lines.append(f"{pad}- **{term}**: {definition}")
        elif t in ("row", "small", "tabNavigator", "links"):
            for key in ("columns", "tabs", "items"):
                for c in n.get(key, []) or []:
                    if isinstance(c, dict):
                        lines.append(blocks(c.get("content"), refs, depth))
            lines.append(inline(n.get("inlineContent"), refs))
        else:
            if "inlineContent" in n:
                lines.append(pad + inline(n.get("inlineContent"), refs))
            if "content" in n and isinstance(n["content"], list):
                lines.append(blocks(n["content"], refs, depth))
    return "\n".join(l for l in lines if l is not None)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    path = to_path(sys.argv[1])
    url = BASE + path + ".json"
    req = urllib.request.Request(url, headers={"User-Agent": "doc-reader/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except Exception as exc:  # noqa: BLE001
        print(f"fetch failed for {url}: {exc}", file=sys.stderr)
        return 1
    refs = data.get("references", {})
    meta = data.get("metadata", {})
    print("TITLE:", meta.get("title", "?"))
    print("URL: https://developer.apple.com/" + path)
    plats = meta.get("platforms") or []
    if plats:
        print("PLATFORMS:", ", ".join(
            f"{p.get('name')} {p.get('introducedAt', '')}" + (" (deprecated)" if p.get("deprecated") else "")
            for p in plats))
    abstract = inline(data.get("abstract"), refs)
    if abstract:
        print("ABSTRACT:", abstract)
    for sec in data.get("primaryContentSections", []):
        kind = sec.get("kind")
        if kind == "declarations":
            for d in sec.get("declarations", []):
                print("DECLARATION:", "".join(tok.get("text", "") for tok in d.get("tokens", [])))
        elif kind == "content":
            print(blocks(sec.get("content"), refs))
        elif kind == "parameters":
            for p in sec.get("parameters", []):
                print(f"- param {p.get('name')}: {blocks(p.get('content'), refs).strip()}")
    for sec in data.get("topicSections", []) or []:
        titles = [refs.get(i, {}).get("title", i.split('/')[-1]) for i in sec.get("identifiers", [])]
        print(f"\n## Topic: {sec.get('title')}\n- " + "\n- ".join(titles))
    return 0


if __name__ == "__main__":
    sys.exit(main())
