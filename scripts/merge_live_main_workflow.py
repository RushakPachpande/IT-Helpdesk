#!/usr/bin/env python3
"""Merge live OpenRouter/folder/workbook IDs into rebuilt Main workflow (no table:update)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USER = ROOT / "IT_Ticketing_Main.json"
NEW = ROOT / "workflows" / "IT_Ticketing_Main.json"
SCRIPTS = ROOT / "scripts" / "IT_Ticketing_Main.json"


def main() -> None:
    user = json.loads(USER.read_text(encoding="utf-8"))
    new = json.loads(NEW.read_text(encoding="utf-8"))

    user_by_name = {n["name"]: n for n in user["nodes"]}
    new_by_name = {n["name"]: n for n in new["nodes"]}

    if "OpenRouter Chat Model" in user_by_name and "OpenRouter Chat Model" in new_by_name:
        u = user_by_name["OpenRouter Chat Model"]
        n = new_by_name["OpenRouter Chat Model"]
        if u.get("credentials"):
            n["credentials"] = u["credentials"]
        for key in ("model", "options"):
            if key in u.get("parameters", {}):
                n["parameters"][key] = u["parameters"][key]
        print("Preserved OpenRouter credentials/model")

    for name, unode in user_by_name.items():
        params = unode.get("parameters", {})
        if (
            unode.get("type") == "n8n-nodes-base.microsoftOutlook"
            and params.get("operation") == "move"
            and name in new_by_name
            and params.get("folderId")
        ):
            new_by_name[name]["parameters"]["folderId"] = params["folderId"]
            print(
                "Preserved folder:",
                name,
                "->",
                params["folderId"].get("cachedResultName"),
            )

    template = None
    for unode in user["nodes"]:
        if (
            unode.get("type") == "n8n-nodes-base.microsoftExcel"
            and unode.get("parameters", {}).get("workbook")
        ):
            template = unode["parameters"]
            break

    for n in new["nodes"]:
        if n.get("type") != "n8n-nodes-base.microsoftExcel":
            continue
        if n["name"] in user_by_name:
            up = user_by_name[n["name"]]["parameters"]
            for key in ("workbook", "worksheet", "table"):
                if key in up:
                    n["parameters"][key] = up[key]
        elif template and n["parameters"].get("operation") == "getRows":
            n["parameters"]["workbook"] = template["workbook"]
            n["parameters"]["worksheet"] = template["worksheet"]
            n["parameters"]["table"] = template["table"]
            print("Applied workbook template to", n["name"])

    excel_ops = [
        (n["name"], n["parameters"].get("operation"))
        for n in new["nodes"]
        if n.get("type") == "n8n-nodes-base.microsoftExcel"
    ]
    print("Excel operations:", excel_ops)
    for name, op in excel_ops:
        if op == "update":
            raise SystemExit(f"FAIL: still has update on {name}")

    http_nodes = [
        n["name"]
        for n in new["nodes"]
        if n.get("type") == "n8n-nodes-base.httpRequest"
    ]
    print("HTTP patch nodes:", http_nodes)
    if len(http_nodes) < 8:
        raise SystemExit(f"FAIL: expected 8 HTTP patch nodes, got {len(http_nodes)}")

    if user.get("settings", {}).get("errorWorkflow"):
        new.setdefault("settings", {})["errorWorkflow"] = user["settings"]["errorWorkflow"]
    for key in ("id", "versionId", "meta"):
        if key in user:
            new[key] = user[key]

    out = json.dumps(new, indent=2, ensure_ascii=False) + "\n"
    USER.write_text(out, encoding="utf-8")
    NEW.write_text(out, encoding="utf-8")
    SCRIPTS.write_text(out, encoding="utf-8")
    print("Wrote fixed IT_Ticketing_Main.json (root + workflows + scripts)")


if __name__ == "__main__":
    main()
