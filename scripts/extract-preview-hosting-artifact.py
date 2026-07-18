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


def require_fd_relative_filesystem_support() -> None:
    required_flags = ('O_DIRECTORY', 'O_NOFOLLOW')
    if any(not hasattr(os, flag) for flag in required_flags):
        fail('platform lacks required no-follow filesystem controls')
    required_dir_fd_operations = (os.mkdir, os.open, os.stat, os.unlink)
    if any(operation not in os.supports_dir_fd for operation in required_dir_fd_operations):
        fail('platform lacks required directory-relative filesystem controls')
    if os.listdir not in os.supports_fd:
        fail('platform cannot verify an extracted tree through directory descriptors')


def directory_open_flags() -> int:
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, 'O_CLOEXEC', 0)


def open_child_directory(parent_fd: int, name: str, *, create: bool) -> int:
    if create:
        try:
            os.mkdir(name, mode=0o755, dir_fd=parent_fd)
        except FileExistsError:
            pass
        except OSError as error:
            fail(f'could not safely create artifact directory: {error}')
    try:
        child_fd = os.open(name, directory_open_flags(), dir_fd=parent_fd)
    except OSError as error:
        fail(f'could not safely open artifact directory without following links: {error}')
    if not stat.S_ISDIR(os.fstat(child_fd).st_mode):
        os.close(child_fd)
        fail('artifact path component is not a directory')
    return child_fd


def open_relative_directory(root_fd: int, parts: tuple[str, ...], *, create: bool) -> int:
    current_fd = os.dup(root_fd)
    try:
        for part in parts:
            next_fd = open_child_directory(current_fd, part, create=create)
            os.close(current_fd)
            current_fd = next_fd
        return current_fd
    except Exception:
        os.close(current_fd)
        raise


def verify_extracted_tree(root_fd: int) -> tuple[int, int]:
    verified_files = 0
    verified_total = 0
    pending: list[tuple[str, ...]] = [()]
    while pending:
        relative_directory = pending.pop()
        directory_fd = open_relative_directory(root_fd, relative_directory, create=False)
        try:
            for name in os.listdir(directory_fd):
                item = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if stat.S_ISREG(item.st_mode):
                    verified_files += 1
                    verified_total += item.st_size
                elif stat.S_ISDIR(item.st_mode):
                    pending.append((*relative_directory, name))
                else:
                    fail('extracted tree contains a symlink or special file')
        finally:
            os.close(directory_fd)
    return verified_files, verified_total


def extract_archive(archive_path: Path, destination: Path) -> tuple[int, int]:
    inspected, expected_total = inspect_archive(archive_path)
    ensure_empty_destination(destination)
    require_fd_relative_filesystem_support()
    extracted_total = 0
    extracted_files = 0

    try:
        root_fd = os.open(destination, directory_open_flags())
    except OSError as error:
        fail(f'could not safely open the extraction destination without following links: {error}')
    try:
        with zipfile.ZipFile(archive_path) as archive:
            for info, relative_path in inspected:
                parts = relative_path.parts
                if info.is_dir():
                    directory_fd = open_relative_directory(root_fd, parts, create=True)
                    os.close(directory_fd)
                    continue

                parent_fd = open_relative_directory(root_fd, parts[:-1], create=True)
                try:
                    flags = (
                        os.O_WRONLY
                        | os.O_CREAT
                        | os.O_EXCL
                        | os.O_NOFOLLOW
                        | getattr(os, 'O_CLOEXEC', 0)
                    )
                    try:
                        descriptor = os.open(parts[-1], flags, 0o644, dir_fd=parent_fd)
                    except OSError as error:
                        fail(f'could not safely create artifact file without following links: {error}')
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
                        try:
                            os.unlink(parts[-1], dir_fd=parent_fd)
                        except FileNotFoundError:
                            pass
                        raise
                    if written != info.file_size:
                        fail('extracted file size did not match ZIP metadata')
                    extracted_files += 1
                finally:
                    os.close(parent_fd)

        if extracted_total != expected_total:
            fail('extracted total size did not match validated ZIP metadata')

        verified_files, verified_total = verify_extracted_tree(root_fd)
    finally:
        os.close(root_fd)

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
