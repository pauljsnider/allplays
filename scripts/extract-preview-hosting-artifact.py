#!/usr/bin/env python3
"""Validate and safely extract an untrusted Firebase Hosting artifact."""

import argparse
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import zipfile


MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024
MAX_ENTRIES = 20_000
REQUIRED_FILES = {'.nojekyll', 'index.html', 'app/index.html'}
FORBIDDEN_ROOT_NAMES = {
    '.git',
    '.github',
    'android',
    'apps',
    'firebase.json',
    'firestore.indexes.json',
    'firestore.rules',
    'functions',
    'ios',
    'node_modules',
    'package-lock.json',
    'package.json',
    'scripts',
    'spec',
    'storage.rules',
    'tests',
}
FORBIDDEN_PUBLIC_CLAIMS = {
    '.well-known/apple-app-site-association',
    '.well-known/assetlinks.json',
}
ALLOWED_HIDDEN_PATHS = {
    '.nojekyll',
    '.well-known/allplays-runtime-config.json',
}


class ArtifactValidationError(RuntimeError):
    """Raised when an untrusted artifact fails closed validation."""


def fail(message: str) -> None:
    raise ArtifactValidationError(f'Preview Hosting artifact rejected: {message}')


def normalized_entry_path(info: zipfile.ZipInfo) -> PurePosixPath:
    name = info.filename
    if not name or '\x00' in name or '\\' in name or name.startswith('/'):
        fail('archive contains an empty, absolute, NUL, or backslash path')
    trimmed = name[:-1] if name.endswith('/') else name
    raw_parts = trimmed.split('/')
    if not trimmed or any(part in {'', '.', '..'} for part in raw_parts):
        fail('archive contains an ambiguous or traversing path')
    if any(ord(character) < 32 or ord(character) == 127 for character in name):
        fail('archive contains a control character in a path')
    path = PurePosixPath(trimmed)
    if path.is_absolute() or ':' in path.parts[0]:
        fail('archive contains an absolute or drive-qualified path')
    return path


def validate_entry_type(info: zipfile.ZipInfo) -> None:
    unix_mode = (info.external_attr >> 16) & 0xFFFF
    file_type = stat.S_IFMT(unix_mode)
    allowed_types = {0, stat.S_IFREG, stat.S_IFDIR}
    if file_type not in allowed_types or file_type == stat.S_IFLNK:
        fail('archive contains a symlink or special file')
    if info.is_dir() and file_type == stat.S_IFREG:
        fail('archive directory metadata claims a regular file')
    if not info.is_dir() and file_type == stat.S_IFDIR:
        fail('archive file metadata claims a directory')
    if info.flag_bits & 0x1:
        fail('archive contains an encrypted entry')


def inspect_archive(archive_path: Path) -> tuple[list[tuple[zipfile.ZipInfo, PurePosixPath]], int]:
    archive_size = archive_path.stat().st_size
    if archive_size <= 0 or archive_size > MAX_ARCHIVE_BYTES:
        fail(f'archive size must be between 1 and {MAX_ARCHIVE_BYTES} bytes')

    try:
        archive = zipfile.ZipFile(archive_path)
    except (OSError, zipfile.BadZipFile) as error:
        fail(f'archive is not a valid ZIP: {error}')

    with archive:
        entries = archive.infolist()
        if not entries or len(entries) > MAX_ENTRIES:
            fail(f'archive entry count must be between 1 and {MAX_ENTRIES}')

        inspected = []
        seen = set()
        total_bytes = 0
        file_paths = set()
        for info in entries:
            path = normalized_entry_path(info)
            normalized = path.as_posix()
            if normalized in seen:
                fail('archive contains duplicate normalized paths')
            seen.add(normalized)
            validate_entry_type(info)
            if path.parts[0] in FORBIDDEN_ROOT_NAMES:
                fail(f'archive contains forbidden root path {path.parts[0]}')
            if normalized in FORBIDDEN_PUBLIC_CLAIMS:
                fail(f'archive contains unpublished public association claim {normalized}')
            if any(part.startswith('.') for part in path.parts) and normalized not in ALLOWED_HIDDEN_PATHS:
                fail(f'archive contains unexpected hidden path {normalized}')
            if info.file_size < 0 or info.file_size > MAX_SINGLE_FILE_BYTES:
                fail(f'entry {normalized} exceeds the per-file size limit')
            total_bytes += info.file_size
            if total_bytes > MAX_UNCOMPRESSED_BYTES:
                fail(f'archive exceeds {MAX_UNCOMPRESSED_BYTES} uncompressed bytes')
            if not info.is_dir():
                file_paths.add(normalized)
            inspected.append((info, path))

        missing = sorted(REQUIRED_FILES - file_paths)
        if missing:
            fail(f'archive is missing required Hosting files: {", ".join(missing)}')
        return inspected, total_bytes


def ensure_empty_destination(destination: Path) -> None:
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink() or not destination.is_dir():
            fail('destination must be a real directory')
        if any(destination.iterdir()):
            fail('destination must be empty')
    else:
        destination.mkdir(parents=True, mode=0o700)


def extract_archive(archive_path: Path, destination: Path) -> tuple[int, int]:
    inspected, expected_total = inspect_archive(archive_path)
    ensure_empty_destination(destination)
    destination_resolved = destination.resolve(strict=True)
    extracted_total = 0
    extracted_files = 0

    with zipfile.ZipFile(archive_path) as archive:
        for info, relative_path in inspected:
            target = destination.joinpath(*relative_path.parts)
            target_parent = target if info.is_dir() else target.parent
            target_parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            if target_parent.resolve(strict=True) != destination_resolved and destination_resolved not in target_parent.resolve(strict=True).parents:
                fail('archive extraction target escaped the destination')
            if info.is_dir():
                continue

            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            descriptor = os.open(target, flags, 0o644)
            written = 0
            try:
                with os.fdopen(descriptor, 'wb') as output, archive.open(info, 'r') as source:
                    while True:
                        chunk = source.read(64 * 1024)
                        if not chunk:
                            break
                        written += len(chunk)
                        extracted_total += len(chunk)
                        if written > info.file_size or written > MAX_SINGLE_FILE_BYTES:
                            fail('extracted file exceeded its declared or allowed size')
                        if extracted_total > MAX_UNCOMPRESSED_BYTES:
                            fail('extracted content exceeded the total size limit')
                        output.write(chunk)
            except Exception:
                target.unlink(missing_ok=True)
                raise
            if written != info.file_size:
                fail('extracted file size did not match ZIP metadata')
            extracted_files += 1

    if extracted_total != expected_total:
        fail('extracted total size did not match validated ZIP metadata')

    verified_total = 0
    verified_files = 0
    for root, directories, files in os.walk(destination, followlinks=False):
        root_path = Path(root)
        for name in [*directories, *files]:
            item = root_path / name
            mode = item.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                fail('extracted tree contains a symlink or special file')
        for name in files:
            item = root_path / name
            verified_total += item.stat().st_size
            verified_files += 1

    if verified_total != extracted_total or verified_files != extracted_files:
        fail('extracted tree changed during verification')
    return extracted_files, extracted_total


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--destination', required=True, type=Path)
    args = parser.parse_args()

    archive = args.archive.resolve(strict=True)
    destination = args.destination.resolve(strict=False)
    try:
        file_count, byte_count = extract_archive(archive, destination)
    except Exception:
        if destination.exists() and destination.is_dir() and not destination.is_symlink():
            shutil.rmtree(destination)
        raise
    print(f'Validated and extracted {file_count} Hosting files ({byte_count} bytes).')


if __name__ == '__main__':
    main()
