"""只读提取 PE 身份、导入表和定向字符串，原始证据只写入私有目录。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
from pathlib import Path


def collect(path: Path) -> dict:
    """从同一份文件字节提取身份及 PE 信息，不加载或执行目标。"""
    data = path.read_bytes()
    if data[:2] != b"MZ":
        raise ValueError("目标不是 PE 文件")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe : pe + 4] != b"PE\0\0":
        raise ValueError("PE 签名无效")
    machine, count, timestamp = struct.unpack_from("<HHI", data, pe + 4)
    optional_size = struct.unpack_from("<H", data, pe + 20)[0]
    optional = pe + 24
    magic = struct.unpack_from("<H", data, optional)[0]
    is64 = magic == 0x20B
    image_base = struct.unpack_from("<Q" if is64 else "<I", data, optional + (24 if is64 else 28))[0]
    section_start = optional + optional_size
    sections = []
    for index in range(count):
        offset = section_start + index * 40
        name = data[offset : offset + 8].split(b"\0")[0].decode("ascii", "replace")
        virtual_size, rva, raw_size, raw_offset = struct.unpack_from("<IIII", data, offset + 8)
        sections.append({"name": name, "rva": rva, "virtual_size": virtual_size,
                         "raw_size": raw_size, "raw_offset": raw_offset})

    def file_offset(rva: int) -> int:
        """将已映射节的 RVA 转为文件偏移，拒绝越界读取。"""
        for section in sections:
            if section["rva"] <= rva < section["rva"] + section["raw_size"]:
                return section["raw_offset"] + rva - section["rva"]
        if rva < section_start:
            return rva
        raise ValueError(f"RVA 未映射到文件: {rva:#x}")

    def c_string(offset: int) -> str:
        end = data.find(b"\0", offset, min(offset + 4096, len(data)))
        if end < 0:
            raise ValueError("未终止字符串")
        return data[offset:end].decode("ascii", "replace")

    imports = []
    directory_start = optional + (112 if is64 else 96)
    import_rva, _ = struct.unpack_from("<II", data, directory_start + 8)
    if import_rva:
        descriptor = file_offset(import_rva)
        for _ in range(1024):
            lookup, _, _, name_rva, address_table = struct.unpack_from("<IIIII", data, descriptor)
            if not any((lookup, name_rva, address_table)):
                break
            dll = c_string(file_offset(name_rva))
            entries = []
            thunk = file_offset(lookup or address_table)
            width = 8 if is64 else 4
            flag = 1 << (width * 8 - 1)
            for index in range(65536):
                item = struct.unpack_from("<Q" if is64 else "<I", data, thunk + index * width)[0]
                if not item:
                    break
                entries.append({"name": f"ordinal:{item & 0xffff}" if item & flag else c_string(file_offset(item) + 2),
                                "iat_rva": hex(address_table + index * width)})
            imports.append({"dll": dll, "symbols": entries})
            descriptor += 20

    # 定向字符串仅用作后续交叉引用的检索线索，不推断运行时调用关系。
    pattern = re.compile(rb"mysql_real_connect|mysql_real_query|mysql_query|mysql_kill|mysql_commit|mysql_rollback|KILL QUERY|START TRANSACTION|Apply Changes|Run Selected", re.IGNORECASE)
    strings = [{"file_offset": hex(match.start()), "literal": match.group().decode("ascii")}
               for match in pattern.finditer(data)]
    return {"path": str(path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "machine": hex(machine), "image_base": hex(image_base), "timestamp": timestamp,
            "sections": sections, "imports": imports, "targeted_string_hits": strings,
            "limitations": ["只读文件证据，未执行程序", "导入和字符串不能证明运行时调用链", "未解析延迟导入或动态 GetProcAddress 调用"]}


def main() -> None:
    """限定证据输出到 research/private，避免将目标资料放进发布目录。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("--name", default="artifact")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", args.name):
        parser.error("名称只能包含英文字母、数字、下划线和连字符")
    destination = Path(__file__).resolve().parent / "private"
    destination.mkdir(exist_ok=True)
    result = collect(args.target.resolve(strict=True))
    (destination / f"{args.name}-pe.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"sha256": result["sha256"], "bytes": result["bytes"],
                      "dll_count": len(result["imports"]), "string_hit_count": len(result["targeted_string_hits"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
