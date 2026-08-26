"""Validate the repository's mandatory documentation baseline.

Run with --strict only after every required Tier 0/1 document has been accepted.
The default mode keeps the scaffold useful while owner decisions listed in docs/risks.md
are intentionally unresolved.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml
from openapi_spec_validator import validate as validate_openapi


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_PATHS = (
    "README.md",
    "CHANGELOG.md",
    "catalog-info.yaml",
    "mkdocs.yml",
    "docs/index.md",
    "docs/01-context.md",
    "docs/02-containers.md",
    "docs/03-runtime.md",
    "docs/04-quality.md",
    "docs/05-data.md",
    "docs/06-security.md",
    "docs/07-reliability.md",
    "docs/08-change.md",
    "docs/09-testing.md",
    "docs/10-operations.md",
    "docs/11-onboarding.md",
    "docs/glossary.md",
    "docs/risks.md",
    "docs/decisions/index.md",
    "docs/contracts/openapi.yaml",
    "docs/contracts/asyncapi.yaml",
    "docs/contracts/pacts/README.md",
)
DOCUMENTS_WITH_METADATA = tuple(
    path
    for path in REQUIRED_PATHS
    if path.startswith("docs/") and path.endswith(".md") and "/contracts/" not in path
)
FRONT_MATTER = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)


def load_front_matter(path: Path) -> dict[str, object]:
    match = FRONT_MATTER.match(path.read_text(encoding="utf-8"))
    if not match:
        raise ValueError("missing YAML front matter")
    metadata = yaml.safe_load(match.group(1))
    if not isinstance(metadata, dict):
        raise ValueError("front matter is not a mapping")
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="fail if a required document is Draft")
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    for relative in REQUIRED_PATHS:
        if not (ROOT / relative).is_file():
            errors.append(f"missing required file: {relative}")

    for relative in DOCUMENTS_WITH_METADATA:
        path = ROOT / relative
        if not path.is_file():
            continue
        try:
            metadata = load_front_matter(path)
        except ValueError as error:
            errors.append(f"{relative}: {error}")
            continue
        for field in ("id", "title", "status", "owner", "last_reviewed"):
            if not metadata.get(field):
                errors.append(f"{relative}: missing front-matter field {field}")
        if metadata.get("status") == "Draft":
            message = f"{relative}: status is Draft"
            (errors if args.strict else warnings).append(message)

    openapi_path = ROOT / "docs/contracts/openapi.yaml"
    if openapi_path.is_file():
        try:
            openapi = yaml.safe_load(openapi_path.read_text(encoding="utf-8"))
            validate_openapi(openapi)
        except Exception as error:  # validator raises several public exception types
            errors.append(f"docs/contracts/openapi.yaml: invalid OpenAPI: {error}")

    asyncapi_path = ROOT / "docs/contracts/asyncapi.yaml"
    if asyncapi_path.is_file():
        try:
            asyncapi = yaml.safe_load(asyncapi_path.read_text(encoding="utf-8"))
            if not isinstance(asyncapi, dict) or not asyncapi.get("asyncapi"):
                raise ValueError("missing asyncapi version")
            if not asyncapi.get("channels"):
                raise ValueError("no channels declared")
        except Exception as error:
            errors.append(f"docs/contracts/asyncapi.yaml: invalid contract: {error}")

    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        return 1
    print("Documentation structure and contract baseline are valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
