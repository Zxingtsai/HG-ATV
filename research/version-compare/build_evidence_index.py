"""Index retained REA records without publishing source, captures or credentials."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def records(value):
    if isinstance(value, dict):
        if all(k in value for k in ("evidence_id", "predicate_type", "operation", "normalized_result", "subject")):
            yield value
        else:
            for child in value.values():
                yield from records(child)
    elif isinstance(value, list):
        for child in value:
            yield from records(child)


def build(scope):
    found = {}
    for path in sorted(scope.rglob("*.json")):
        if path.name in {"evidence-index.json", "rea-tools.json", "rea-tools-resume.json"}:
            continue
        try:
            raw = path.read_bytes()
            value = json.loads(raw)
        except (OSError, ValueError):
            continue
        for evidence in records(value):
            eid = evidence["evidence_id"]
            item = found.setdefault(eid, {
                "evidence_id": eid,
                "operation": evidence["operation"],
                "predicate_type": evidence["predicate_type"],
                "provider": evidence.get("provider"),
                "subject_sha256": (evidence.get("subject") or {}).get("digest", {}).get("sha256"),
                "confidence": evidence.get("confidence"),
                "authority": evidence.get("authority"),
                "records": [],
            })
            result = evidence.get("normalized_result") or {}
            for key in ("engine", "class_name", "method", "representation", "body_status", "fell_back", "markers"):
                if key in result:
                    item[key] = result[key]
            if isinstance(result.get("source"), dict):
                item["source_status"] = result["source"].get("status")
            item["records"].append({"local_relative_file": str(path.relative_to(ROOT)), "file_sha256": hashlib.sha256(raw).hexdigest()})
    result = {
        "date": "2026-10-22",
        "scope": "Metadata of complete retained REA records only. No application source, APK, credentials or captured traffic included. Files referenced are local research artifacts, not promised public downloads. Independent retained records from interrupted sessions do not restore their complete original session ledger.",
        "count": len(found),
        "evidence": sorted(found.values(), key=lambda item: item["evidence_id"]),
    }
    (scope / "evidence-index.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


if __name__ == "__main__":
    print("account records:", build(ROOT / "account-library")["count"])
    print("all records:", build(ROOT)["count"])
