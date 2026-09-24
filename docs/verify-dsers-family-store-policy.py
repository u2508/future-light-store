#!/usr/bin/env python3
"""Verify the machine-readable DSers policy against the supplied source DOCX."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / "config/dsers-family-store-search-policy.json"
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def paragraph_text(paragraph: ElementTree.Element) -> str:
    parts: list[str] = []
    for element in paragraph.iter():
        if element.tag == f"{{{NS['w']}}}t":
            parts.append(element.text or "")
        elif element.tag == f"{{{NS['w']}}}tab":
            parts.append("\t")
        elif element.tag in {f"{{{NS['w']}}}br", f"{{{NS['w']}}}cr"}:
            parts.append("\n")
    return "".join(parts).strip()


def table_rows(table: ElementTree.Element) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in table.findall("./w:tr", NS):
        cells: list[str] = []
        for cell in row.findall("./w:tc", NS):
            cell_paragraphs = [paragraph_text(p) for p in cell.findall(".//w:p", NS)]
            cells.append("\n".join(value for value in cell_paragraphs if value))
        rows.append(cells)
    return rows


def require_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise ValueError(f"Source-policy mismatch for {label}.\nDOCX: {actual!r}\nPolicy: {expected!r}")


def section_after(paragraphs: list[str], heading: str, count: int) -> list[str]:
    try:
        index = paragraphs.index(heading)
    except ValueError as error:
        raise ValueError(f"DOCX section heading is missing: {heading}") from error
    values = [value for value in paragraphs[index + 1 :] if value]
    if len(values) < count:
        raise ValueError(f"DOCX section {heading!r} has fewer than {count} entries")
    return values[:count]


def check() -> dict[str, int | str]:
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    source_path = (ROOT / policy["sourceDocument"]).resolve()
    if source_path.parent != (ROOT / "docs").resolve() or not source_path.is_file():
        raise ValueError("Policy sourceDocument must point to the supplied DOCX directly inside docs/.")
    source_bytes = source_path.read_bytes()
    source_sha = hashlib.sha256(source_bytes).hexdigest()
    require_equal(source_sha, policy["sourceSha256"], "source SHA-256")

    with zipfile.ZipFile(source_path) as archive:
        document = ElementTree.fromstring(archive.read("word/document.xml"))
    body = document.find("./w:body", NS)
    if body is None:
        raise ValueError("DOCX body is missing")

    paragraphs = [paragraph_text(item) for item in body.findall("./w:p", NS)]
    tables = [table_rows(item) for item in body.findall("./w:tbl", NS)]
    if len(tables) != 4:
        raise ValueError(f"Expected four source tables; found {len(tables)}")

    require_equal(paragraphs[3], policy["sourceObjective"], "source objective")
    require_equal(paragraphs[4], policy["sourcePlanningNote"], "source planning note")
    require_equal(tables[0][0][0], policy["sourceOperatingBoundary"], "source operating boundary")
    require_equal(paragraphs[37], policy["sourceReferenceNote"], "source reference note")
    source_references = []
    for line in paragraphs[38:43]:
        label, separator, url = line.partition(": ")
        if not separator:
            raise ValueError(f"Malformed DOCX reference line: {line!r}")
        source_references.append({"label": label, "url": url})
    require_equal(source_references, policy["sourceReferences"], "source references")

    lanes = policy["collectionLanes"]
    source_lanes = [[row[0], int(row[1]), row[2]] for row in tables[1][1:-1]]
    policy_lanes = [[item["name"], item["slots"], item["whatBelongsHere"]] for item in lanes]
    require_equal(source_lanes, policy_lanes, "collection lanes")
    require_equal(tables[1][-1][0:2], ["Total", "679"], "lane total")

    source_families = []
    for row in tables[2][1:]:
        source_families.append(
            {
                "name": row[0],
                "terms": [term.strip() for term in row[1].split(";")],
                "selectionIntent": row[2],
            }
        )
    policy_families = [
        {"name": item["name"], "terms": item["terms"], "selectionIntent": item["selectionIntent"]}
        for item in policy["searchFamilies"]
    ]
    require_equal(source_families, policy_families, "search families, exact terms, and selection intent")

    source_batches = []
    for row in tables[3][1:]:
        match = re.fullmatch(r"Batch\s+(\d+)", row[0])
        if not match:
            raise ValueError(f"Unexpected DOCX batch label: {row[0]!r}")
        source_batches.append([int(match.group(1)), row[1], int(row[2]), row[3]])
    policy_batches = [
        [item["id"], item["sourceLane"], item["ceiling"], item["sourceGate"]]
        for item in policy["batches"]
    ]
    require_equal(source_batches, policy_batches, "source batch labels, ceilings, and gates")

    exclusion_heading = "4. Hard exclusions"
    exclusions = section_after(paragraphs, exclusion_heading, 6)
    require_equal(exclusions, policy["sourceHardExclusions"], "hard exclusions")

    score_block = section_after(paragraphs, "5. Product qualification score", 6)
    require_equal(
        score_block[0],
        "Use the following order of operations for every DSers result. A high score never overrides a hard exclusion.",
        "qualification-score preamble",
    )
    score_paragraphs = score_block[1:]
    score_rows = []
    for line in score_paragraphs:
        match = re.fullmatch(r"([^(:]+) \(0[–-](\d+)\): (.*)", line)
        if not match:
            raise ValueError(f"Unexpected qualification-score source row: {line!r}")
        score_rows.append([match.group(1), int(match.group(2)), match.group(3)])
    policy_scores = [
        [item["label"], item["max"], item["sourceCriterion"]]
        for item in policy["qualificationScore"]["dimensions"]
    ]
    require_equal(score_rows, policy_scores, "qualification-score criteria")

    sequence = section_after(paragraphs, "6. DSers operating sequence", 6)
    sequence = [re.sub(r"^\d+\.\s*", "", item) for item in sequence]
    require_equal(sequence, policy["operatingSequence"], "six-step operating sequence")

    seo_lines = section_after(paragraphs, "7. SEO / GEO / AEO copy rules", 6)
    labels = {
        "Title": "title",
        "Description": "description",
        "Facts": "facts",
        "Questions": "questions",
        "GEO/AEO": "geoAeo",
        "Image alt text": "imageAlt",
    }
    seo = {}
    for line in seo_lines:
        label, separator, value = line.partition(": ")
        if not separator or label not in labels:
            raise ValueError(f"Unexpected SEO/GEO/AEO source row: {line!r}")
        seo[labels[label]] = value
    require_equal(seo, policy["copyRules"]["sourceSeoGeoAeo"], "SEO/GEO/AEO source rules")

    term_count = sum(len(item["terms"]) for item in source_families)
    lane_total = sum(row[1] for row in source_lanes)
    batch_total = sum(row[2] for row in source_batches)
    if term_count != 116 or lane_total != 679 or batch_total != 679:
        raise ValueError(f"Unexpected source totals: terms={term_count}, lanes={lane_total}, batches={batch_total}")
    return {"sourceSha256": source_sha, "families": len(source_families), "searchTerms": term_count, "lanes": len(source_lanes), "batches": len(source_batches), "planningSlots": lane_total}


if __name__ == "__main__":
    try:
        print("DSers DOCX source fidelity verified: " + json.dumps(check(), sort_keys=True))
    except Exception as error:
        print(f"DSers DOCX source fidelity failed: {error}", file=sys.stderr)
        sys.exit(1)
