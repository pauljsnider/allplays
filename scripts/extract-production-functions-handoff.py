#!/usr/bin/env python3
"""Validate and extract the trusted production Functions runtime handoff."""

from __future__ import annotations

import os
import posixpath
import stat
import sys
import tarfile
from pathlib import Path

MAX_MEMBERS = 50_000
MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
FUNCTIONS_ROOT = "functions"
REQUIRED_BIN_LINK = "functions/node_modules/.bin/firebase-functions"
REQUIRED_BIN_TARGET = "functions/node_modules/firebase-functions/lib/bin/firebase-functions.js"


def fail(message: str) -> None:
    raise ValueError(message)


def is_within_functions(path: str) -> bool:
    return path.startswith(f"{FUNCTIONS_ROOT}/")


def validate_member(member: tarfile.TarInfo, seen: set[str]) -> int:
    name = member.name
    normalized = posixpath.normpath(name)
    if not name or name.startswith("/") or normalized in ("", "."):
        fail(f"unsafe Functions archive path: {name!r}")
    if normalized != name.rstrip("/") or ".." in name.split("/"):
        fail(f"non-canonical Functions archive path: {name}")
    if normalized != FUNCTIONS_ROOT and not is_within_functions(normalized):
        fail(f"Functions archive escaped its fixed root: {name}")
    if normalized in seen:
        fail(f"duplicate Functions archive member: {name}")
    seen.add(normalized)

    if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
        fail(f"special file is forbidden in Functions archive: {name}")

    if member.issym():
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(normalized), member.linkname))
        if posixpath.isabs(member.linkname) or not is_within_functions(resolved):
            fail(f"unsafe Functions symlink: {name} -> {member.linkname}")
    elif member.islnk():
        resolved = posixpath.normpath(member.linkname)
        if posixpath.isabs(member.linkname) or not is_within_functions(resolved):
            fail(f"unsafe Functions hard link: {name} -> {member.linkname}")

    return member.size if member.isfile() else 0


def validate_archive(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = archive.getmembers()
    if not members:
        fail("Functions runtime archive is empty")
    if len(members) > MAX_MEMBERS:
        fail("Functions runtime archive contains too many members")

    seen: set[str] = set()
    total_size = 0
    for member in members:
        total_size += validate_member(member, seen)
        if total_size > MAX_UNCOMPRESSED_BYTES:
            fail("Functions runtime archive exceeds the uncompressed size limit")

    if FUNCTIONS_ROOT not in seen:
        fail("Functions runtime archive is missing its fixed root")
    return members


def validate_extracted_runtime(destination: Path) -> None:
    functions_root = destination / FUNCTIONS_ROOT
    bin_link = destination / REQUIRED_BIN_LINK
    bin_target = destination / REQUIRED_BIN_TARGET
    if functions_root.is_symlink() or not functions_root.is_dir():
        fail("extracted Functions root is not a real directory")
    if not bin_link.is_symlink():
        fail("firebase-functions .bin entry is not a preserved symlink")
    if not bin_target.is_file() or bin_target.is_symlink():
        fail("firebase-functions executable target is missing or unsafe")

    root_real = functions_root.resolve(strict=True)
    link_real = bin_link.resolve(strict=True)
    if os.path.commonpath((str(root_real), str(link_real))) != str(root_real):
        fail("firebase-functions .bin link resolves outside the Functions root")
    if link_real != bin_target.resolve(strict=True):
        fail("firebase-functions .bin link resolves to an unexpected target")
    if not stat.S_IMODE(bin_target.stat().st_mode) & 0o111:
        fail("firebase-functions executable mode was not preserved")
    if not os.access(bin_link, os.X_OK):
        fail("firebase-functions .bin entry is not executable")


def extract_handoff(archive_path: Path, destination: Path) -> None:
    if not archive_path.is_file() or archive_path.is_symlink():
        fail("Functions runtime archive is missing or is a symlink")
    if not destination.is_dir() or destination.is_symlink():
        fail("Functions handoff destination must be a real directory")
    if os.path.lexists(destination / FUNCTIONS_ROOT):
        fail("Functions handoff destination is not empty at the fixed root")

    with tarfile.open(archive_path, mode="r:*") as archive:
        members = validate_archive(archive)
        try:
            archive.extractall(destination, members=members, filter="fully_trusted")
        except TypeError:  # Python versions before extraction filters.
            archive.extractall(destination, members=members)
    validate_extracted_runtime(destination)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f"usage: {argv[0]} ARCHIVE DESTINATION", file=sys.stderr)
        return 2
    try:
        extract_handoff(Path(argv[1]), Path(argv[2]))
    except (OSError, tarfile.TarError, ValueError) as error:
        print(f"production Functions handoff rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
