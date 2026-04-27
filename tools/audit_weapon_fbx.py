"""Audit weapon FBX geometry stats with no external dependencies.

Scans the repo's weapon-model folders, reads each FBX's vertex control
points, computes an overall bounding-box size, and prints the results
sorted by on-disk file size.

Defaults target only weapon-like categories:
  - Assets/models/weapons
  - Assets/models/melee
  - Assets/models/lowpolyguns
  - Assets/models/lowpolyguns_accessories

Usage:
    python tools/audit_weapon_fbx.py
    python tools/audit_weapon_fbx.py --root Assets/models --category weapons --category melee
    python tools/audit_weapon_fbx.py --csv
"""
from __future__ import annotations

import argparse
import csv
import math
import re
import struct
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_CATEGORIES = (
    "weapons",
    "melee",
    "lowpolyguns",
    "lowpolyguns_accessories",
)
FBX_BINARY_MAGIC = b"Kaydara FBX Binary  \x00\x1a\x00"


@dataclass
class FbxStats:
    vertices: int = 0
    min_x: float = math.inf
    min_y: float = math.inf
    min_z: float = math.inf
    max_x: float = -math.inf
    max_y: float = -math.inf
    max_z: float = -math.inf

    def absorb(self, coords: Iterable[float]) -> None:
        values = list(coords)
        if len(values) < 3:
            return
        self.vertices += len(values) // 3
        for i in range(0, len(values) - 2, 3):
            x = float(values[i])
            y = float(values[i + 1])
            z = float(values[i + 2])
            if x < self.min_x:
                self.min_x = x
            if y < self.min_y:
                self.min_y = y
            if z < self.min_z:
                self.min_z = z
            if x > self.max_x:
                self.max_x = x
            if y > self.max_y:
                self.max_y = y
            if z > self.max_z:
                self.max_z = z

    @property
    def valid(self) -> bool:
        return self.vertices > 0 and self.min_x != math.inf

    @property
    def size_x(self) -> float:
        return 0.0 if not self.valid else self.max_x - self.min_x

    @property
    def size_y(self) -> float:
        return 0.0 if not self.valid else self.max_y - self.min_y

    @property
    def size_z(self) -> float:
        return 0.0 if not self.valid else self.max_z - self.min_z


class BinaryFbxReader:
    def __init__(self, data: bytes):
        self.data = data
        self.version = struct.unpack_from("<I", data, 23)[0]
        self.header_len = 27
        self.node_header_len = 25 if self.version >= 7500 else 13

    def parse(self) -> FbxStats:
        stats = FbxStats()
        self._walk(self.header_len, len(self.data), (), stats)
        return stats

    def _walk(self, offset: int, end: int, parents: tuple[str, ...], stats: FbxStats) -> int:
        while offset + self.node_header_len <= end:
            header = self.data[offset : offset + self.node_header_len]
            if header == b"\0" * self.node_header_len:
                return offset + self.node_header_len
            node_end, prop_count, prop_len, name, body_offset = self._read_node_header(offset)
            if node_end <= offset:
                break
            values, after_props = self._read_properties(body_offset, prop_count)
            lineage = parents + (name,)
            if name == "Vertices" and "Geometry" in parents and values:
                first = values[0]
                if isinstance(first, (list, tuple)):
                    stats.absorb(first)
            if after_props < node_end:
                self._walk(after_props, node_end, lineage, stats)
            offset = node_end
        return offset

    def _read_node_header(self, offset: int):
        if self.version >= 7500:
            end_offset, prop_count, prop_len = struct.unpack_from("<QQQ", self.data, offset)
            name_len = self.data[offset + 24]
            name_start = offset + 25
        else:
            end_offset, prop_count, prop_len = struct.unpack_from("<III", self.data, offset)
            name_len = self.data[offset + 12]
            name_start = offset + 13
        name = self.data[name_start : name_start + name_len].decode("utf-8", errors="replace")
        body_offset = name_start + name_len
        return end_offset, prop_count, prop_len, name, body_offset

    def _read_properties(self, offset: int, prop_count: int):
        values = []
        for _ in range(prop_count):
            value, offset = self._read_property(offset)
            values.append(value)
        return values, offset

    def _read_property(self, offset: int):
        kind = chr(self.data[offset])
        offset += 1
        if kind == "Y":
            return struct.unpack_from("<h", self.data, offset)[0], offset + 2
        if kind == "C":
            return bool(self.data[offset]), offset + 1
        if kind == "I":
            return struct.unpack_from("<i", self.data, offset)[0], offset + 4
        if kind == "F":
            return struct.unpack_from("<f", self.data, offset)[0], offset + 4
        if kind == "D":
            return struct.unpack_from("<d", self.data, offset)[0], offset + 8
        if kind == "L":
            return struct.unpack_from("<q", self.data, offset)[0], offset + 8
        if kind in ("f", "d", "i", "l", "b"):
            return self._read_array(kind, offset)
        if kind in ("S", "R"):
            size = struct.unpack_from("<I", self.data, offset)[0]
            offset += 4
            return self.data[offset : offset + size], offset + size
        raise ValueError(f"unsupported FBX property type: {kind!r}")

    def _read_array(self, kind: str, offset: int):
        length, encoding, compressed_len = struct.unpack_from("<III", self.data, offset)
        offset += 12
        raw = self.data[offset : offset + compressed_len]
        offset += compressed_len
        if encoding == 1:
            raw = zlib.decompress(raw)
        fmt = {
            "f": "f",
            "d": "d",
            "i": "i",
            "l": "q",
            "b": "?",
        }[kind]
        return struct.unpack(f"<{length}{fmt}", raw), offset


ASCII_VERTICES_RE = re.compile(
    r"Vertices:\s*\*\d+\s*\{\s*a:\s*([^}]*)\}",
    re.IGNORECASE | re.DOTALL,
)
ASCII_NUMBER_RE = re.compile(r"[-+]?(?:\d+\.\d+|\d+)(?:[eE][-+]?\d+)?")


def parse_ascii_fbx(data: bytes) -> FbxStats:
    text = data.decode("utf-8", errors="replace")
    stats = FbxStats()
    for match in ASCII_VERTICES_RE.finditer(text):
        coords = [float(tok) for tok in ASCII_NUMBER_RE.findall(match.group(1))]
        stats.absorb(coords)
    return stats


def parse_fbx(path: Path) -> FbxStats:
    data = path.read_bytes()
    if data.startswith(FBX_BINARY_MAGIC):
        return BinaryFbxReader(data).parse()
    return parse_ascii_fbx(data)


def human_size(num_bytes: int) -> str:
    units = ("B", "KB", "MB", "GB")
    size = float(num_bytes)
    for unit in units:
        if size < 1024.0 or unit == units[-1]:
            return f"{size:.1f}{unit}" if unit != "B" else f"{int(size)}B"
        size /= 1024.0
    return f"{num_bytes}B"


def collect_targets(root: Path, categories: list[str]) -> list[Path]:
    files: list[Path] = []
    for category in categories:
        folder = root / category
        if not folder.is_dir():
            print(f"[warn] missing category folder: {folder}", file=sys.stderr)
            continue
        files.extend(sorted(folder.glob("*.fbx")))
    return files


def print_table(rows: list[dict[str, object]]) -> None:
    headers = ("size", "verts", "bbox_x", "bbox_y", "bbox_z", "path")
    widths = {h: len(h) for h in headers}
    for row in rows:
        for h in headers:
            widths[h] = max(widths[h], len(str(row[h])))
    print("  ".join(h.ljust(widths[h]) for h in headers))
    print("  ".join("-" * widths[h] for h in headers))
    for row in rows:
        print("  ".join(str(row[h]).ljust(widths[h]) for h in headers))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="Assets/models",
                        help="models root (default: Assets/models)")
    parser.add_argument("--category", action="append", dest="categories",
                        help="category under --root; may be repeated")
    parser.add_argument("--csv", action="store_true",
                        help="emit CSV instead of a padded table")
    parser.add_argument("--limit", type=int, default=0,
                        help="limit rows after sorting by file size")
    args = parser.parse_args()

    root = Path(args.root)
    repo_root = Path.cwd()
    categories = args.categories or list(DEFAULT_CATEGORIES)
    targets = collect_targets(root, categories)
    if not targets:
        print("no FBX files found", file=sys.stderr)
        return 1

    rows = []
    failed = 0
    for path in targets:
        try:
            stats = parse_fbx(path)
        except Exception as exc:  # keep the batch moving
            failed += 1
            print(f"[error] {path}: {exc}", file=sys.stderr)
            continue
        rel = path.relative_to(repo_root) if repo_root in path.parents else path
        rows.append({
            "size_bytes": path.stat().st_size,
            "size": human_size(path.stat().st_size),
            "verts": stats.vertices,
            "bbox_x": f"{stats.size_x:.3f}",
            "bbox_y": f"{stats.size_y:.3f}",
            "bbox_z": f"{stats.size_z:.3f}",
            "path": str(rel).replace("\\", "/"),
        })

    rows.sort(key=lambda row: row["size_bytes"], reverse=True)
    if args.limit > 0:
        rows = rows[: args.limit]

    if args.csv:
        writer = csv.writer(sys.stdout)
        writer.writerow(("size_bytes", "verts", "bbox_x", "bbox_y", "bbox_z", "path"))
        for row in rows:
            writer.writerow((
                row["size_bytes"], row["verts"], row["bbox_x"],
                row["bbox_y"], row["bbox_z"], row["path"],
            ))
    else:
        printable = [{k: row[k] for k in ("size", "verts", "bbox_x", "bbox_y", "bbox_z", "path")}
                     for row in rows]
        print_table(printable)

    if failed:
        print(f"\ncompleted with {failed} parse errors", file=sys.stderr)
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
