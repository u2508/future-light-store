#!/usr/bin/env python3
"""Batch deterministic knowledge-model scoring on Apple Metal through MLX."""

import json
import math
import sys
from pathlib import Path

import mlx.core as mx


FIELD_WEIGHTS = {
    "title": 7,
    "handle": 6,
    "productType": 5,
    "tags": 2,
    "description": 1,
}


def phrase_tokens(value):
    text = " ".join(str(value or "").lower().split())
    text = "".join(character if (character.isascii() and character.isalnum()) else " " for character in text)
    return [token for token in text.split() if len(token) > 1 or any(character.isdigit() for character in token) or token in ("o", "c")]


def prepare_phrases(values):
    prepared = []
    for value in values or []:
        text = " ".join(str(value or "").lower().split())
        tokens = phrase_tokens(text)
        if text and tokens:
            prepared.append({"value": text, "tokens": tokens})
    return prepared


def build_phrase_index(profiles):
    """Index token sequences once so each product does not scan all phrases."""
    phrase_index = {}
    phrase_lengths = set()

    def register(profile_index, bucket, phrase_index_value, phrase, group_index=None):
        tokens = tuple(phrase.get("tokens") or [])
        if not tokens:
            return

        phrase_lengths.add(len(tokens))
        entry = {
            "profile": profile_index,
            "bucket": bucket,
            "index": phrase_index_value,
            "group": group_index,
        }
        phrase_index.setdefault(tokens, []).append(entry)

    for profile_index, profile in enumerate(profiles):
        for bucket in ("positivePhrases", "primaryPhrases", "negativePhrases"):
            for phrase_index_value, phrase in enumerate(profile[bucket]):
                register(profile_index, bucket, phrase_index_value, phrase)
        for group_index, group in enumerate(profile["requiredGroups"]):
            for phrase_index_value, phrase in enumerate(group):
                register(profile_index, "requiredGroups", phrase_index_value, phrase, group_index)

    return phrase_index, sorted(phrase_lengths)


def collect_phrase_matches(fields, phrase_index, phrase_lengths, profile_count):
    """Return only matched phrases/groups, avoiding a 14k x 6k scan."""
    profile_matches = [None] * profile_count

    for field, tokens in fields.items():
        if not tokens:
            continue

        token_count = len(tokens)
        for phrase_length in phrase_lengths:
            if phrase_length > token_count:
                break
            for offset in range(0, token_count - phrase_length + 1):
                entries = phrase_index.get(tuple(tokens[offset:offset + phrase_length]))
                if not entries:
                    continue

                for entry in entries:
                    profile_index = entry["profile"]
                    state = profile_matches[profile_index]
                    if state is None:
                        state = {
                            "positivePhrases": {},
                            "primaryPhrases": {},
                            "negativePhrases": {},
                            "requiredGroups": set(),
                        }
                        profile_matches[profile_index] = state

                    bucket = entry["bucket"]
                    if bucket == "requiredGroups":
                        state["requiredGroups"].add(entry["group"])
                    else:
                        state[bucket].setdefault(entry["index"], set()).add(field)

    return profile_matches


def matched_phrases(phrases, matched_fields_by_index):
    return [
        {
            "phrase": phrase["value"],
            "fields": sorted(matched_fields_by_index[index]),
            "tokenLength": len(phrase["tokens"]),
        }
        for index, phrase in enumerate(phrases)
        if index in matched_fields_by_index
    ]


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: catalog-knowledge-model-mlx.py MODEL_JSON INPUT_JSON")

    model = json.loads(Path(sys.argv[1]).read_text())
    records = json.loads(Path(sys.argv[2]).read_text())
    profiles = []
    vocabulary = set()
    for raw in model.get("ruleProfiles", []):
        token_counts = raw.get("tokenCounts") or {}
        vocabulary.update(token_counts.keys())
        profiles.append({
            "raw": raw,
            "tokenCounts": token_counts,
            "vocabularySize": max(1, len(token_counts)),
            "totalTokenCount": float(raw.get("totalTokenCount") or 0),
            "documentCount": float(raw.get("documentCount") or 0),
            "positivePhrases": prepare_phrases(raw.get("positivePhrases")),
            "primaryPhrases": prepare_phrases(raw.get("primaryPhrases")),
            "requiredGroups": [prepare_phrases(group) for group in raw.get("requiredGroups", [])],
            "negativePhrases": prepare_phrases(raw.get("negativePhrases")),
        })

    phrase_index, phrase_lengths = build_phrase_index(profiles)

    vocab = sorted(vocabulary)
    vocab_index = {token: index for index, token in enumerate(vocab)}
    unknown_index = len(vocab)
    total_records = float(model.get("trainingRecords") or 0)
    label_count = len(profiles)
    log_matrix = []
    for profile in profiles:
        denominator = max(1.0, profile["totalTokenCount"] + profile["vocabularySize"])
        row = [math.log((float(profile["tokenCounts"].get(token, 0)) + 1.0) / denominator) for token in vocab]
        row.append(math.log(1.0 / denominator))
        log_matrix.append(row)

    # The large token-evidence multiply is evaluated on the Metal GPU. CPU work
    # remains deterministic phrase/rule evidence and JSON orchestration.
    mx.set_default_device(mx.gpu)
    log_tensor = mx.array(log_matrix, dtype=mx.float32)
    batch_size = 512
    output = {}
    for start in range(0, len(records), batch_size):
        batch = records[start:start + batch_size]
        features = []
        for record in batch:
            vector = [0.0] * (len(vocab) + 1)
            fields = record.get("fields") or {}
            for field, tokens in fields.items():
                weight = FIELD_WEIGHTS.get(field, 1)
                for token in tokens:
                    vector[vocab_index.get(token, unknown_index)] += weight
            features.append(vector)
        score_tensor = mx.array(features, dtype=mx.float32) @ log_tensor.T
        mx.eval(score_tensor)
        matrix = score_tensor.tolist()

        for row_index, record in enumerate(batch):
            fields = record.get("fields") or {}
            matches = collect_phrase_matches(fields, phrase_index, phrase_lengths, label_count)
            scored = []
            for profile_index, profile in enumerate(profiles):
                raw = profile["raw"]
                score = math.log((profile["documentCount"] + 1.0) / max(1.0, total_records + label_count))
                score += float(matrix[row_index][profile_index])
                matched = matches[profile_index] or {
                    "positivePhrases": {},
                    "primaryPhrases": {},
                    "negativePhrases": {},
                    "requiredGroups": set(),
                }
                positive = matched_phrases(profile["positivePhrases"], matched["positivePhrases"])
                primary = matched_phrases(profile["primaryPhrases"], matched["primaryPhrases"])
                required = len(matched["requiredGroups"])
                exclusions = matched_phrases(profile["negativePhrases"], matched["negativePhrases"])
                direct_fields = sum(1 for field in ("title", "handle", "productType") if fields.get(field))
                for match in positive:
                    multiplier = max((FIELD_WEIGHTS.get(field, 1) for field in match["fields"]), default=1)
                    metadata = raw.get("phraseCounts", {}).get(match["phrase"], {})
                    score += float(metadata.get("weight") or 1) * multiplier * min(4, match["tokenLength"])
                score += len(primary) * 6 + required * 5
                score += float(raw.get("priority") or 0) / 20
                if raw.get("generic"):
                    score -= 2
                score -= len(exclusions) * 18
                scored.append({
                    "ruleId": raw.get("ruleId", ""),
                    "score": score,
                    "positivePhraseHits": len(positive),
                    "requiredGroupHits": required,
                    "exclusionHits": len(exclusions),
                    "directFieldCount": direct_fields,
                    "hierarchy": raw.get("hierarchy"),
                })

            scored.sort(key=lambda item: (-item["score"], item["ruleId"]))
            top = scored[0] if scored else None
            second = scored[1] if len(scored) > 1 else None
            margin = (top["score"] - second["score"]) if top and second else 0.0
            normalized_margin = margin / max(1.0, abs(top["score"]) if top else 0.0)
            reliable = bool(
                top
                and top["positivePhraseHits"] > 0
                and top["directFieldCount"] > 0
                and top["exclusionHits"] == 0
                and (top["requiredGroupHits"] > 0 or top["positivePhraseHits"] >= 2)
                and normalized_margin >= 0.08
            )
            output[str(record["key"])] = {
                "modelVersion": model.get("modelVersion", ""),
                "trainingRecords": model.get("trainingRecords", 0),
                "topRuleId": top.get("ruleId", "") if top else "",
                "topScore": top.get("score", 0) if top else 0,
                "secondRuleId": second.get("ruleId", "") if second else "",
                "secondScore": second.get("score", 0) if second else 0,
                "margin": margin,
                "normalizedMargin": normalized_margin,
                "reliable": reliable,
                "featureCount": len(set(token for tokens in fields.values() for token in tokens)),
                "candidates": scored[:3],
            }

    print(json.dumps(output, separators=(",", ":")))


if __name__ == "__main__":
    main()
