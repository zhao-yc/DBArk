"""只用Python标准库独立流式解包；不导入产品代码或在磁盘展开CSV。"""
import hashlib
import json
from pathlib import Path
import stat
import struct
import sys
import zipfile
import zlib


def require(condition, message):
    """校验失败立即终止，不能将已读部分误报为完整边界通过。"""
    if not condition:
        raise ValueError(message)


def verify(archive, expectation):
    """ZipExtFile每次最多读取1MiB，并独立计算实际字节、SHA256与CRC32。"""
    require(expectation.stat().st_size <= 64 * 1024, "本场景独立预期文件不得超过64KiB")
    expected = json.loads(expectation.read_text(encoding="utf-8"))
    info = archive.lstat()
    require(stat.S_ISREG(info.st_mode) and not archive.is_symlink(), "归档必须是普通文件")
    require(sys.platform != "win32" or hasattr(info, "st_file_attributes"), "Windows必须能检查真实文件属性")
    attrs = getattr(info, "st_file_attributes", 0)
    require(not attrs & getattr(stat, "FILE_ATTRIBUTE_SPARSE_FILE", 0x200), "不能用稀疏文件替代真实写入")
    require(not attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400), "不能读取重解析点归档")
    require(info.st_size == expected["archiveBytes"], "归档真实大小与完成证据不一致")
    require(info.st_size <= expected["plan"]["fileLimit"], "归档超过产品10GiB预算")
    require(info.st_size <= 10 * 1024**3 and info.st_size >= 98, "归档实际长度超出验收预算")
    # zipfile会整体读取中央目录，先用固定98字节尾部限定其大小，防止损坏字段诱发GiB级读取。
    with archive.open("rb") as raw:
        raw.seek(-98, 2)
        tail = raw.read(98)
    require(struct.unpack_from("<I", tail, 0)[0] == 0x06064B50 and struct.unpack_from("<Q", tail, 4)[0] == 44, "缺少本场景固定ZIP64尾部")
    directory_bytes, directory_offset = struct.unpack_from("<QQ", tail, 40)
    require(directory_bytes <= 64 * 1024 and directory_offset + directory_bytes == info.st_size - 98, "中央目录必须有界且指向真实尾部")
    require(struct.unpack_from("<QQ", tail, 24) == (4, 4), "中央目录必须包含本场景四条目")
    require(struct.unpack_from("<I", tail, 56)[0] == 0x07064B50 and struct.unpack_from("<Q", tail, 64)[0] == info.st_size - 98 and struct.unpack_from("<I", tail, 76)[0] == 0x06054B50, "ZIP64定位器或EOCD不符")
    wanted = {entry["name"]: entry for entry in expected["entries"]}
    results, manifest = [], None
    with zipfile.ZipFile(archive) as container:
        require(container.namelist() == list(wanted) + ["manifest.json"], "条目顺序、唯一性或固定路径错误")
        for entry in container.infolist():
            require(entry.compress_type == zipfile.ZIP_STORED, "验收要求真实STORE数据")
            require(entry.file_size == entry.compress_size, "STORE大小不一致")
            sha, crc, count = hashlib.sha256(), 0, 0
            metadata = bytearray() if entry.filename == "manifest.json" else None
            with container.open(entry, "r") as stream:
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    require(count <= entry.file_size, "流读取超过声明大小")
                    sha.update(chunk)
                    crc = zlib.crc32(chunk, crc)
                    if metadata is not None:
                        require(count <= 64 * 1024, "本场景清单不得超过64KiB")
                        metadata.extend(chunk)
            actual = {"name": entry.filename, "bytes": count, "sha256": sha.hexdigest(), "crc32": f"{crc:08x}", "headerOffset": entry.header_offset}
            require(count == entry.file_size, "解包实际字节不等于目录长度")
            require(crc == entry.CRC, "独立CRC不等于ZIP目录CRC")
            if metadata is None:
                for key in ("bytes", "sha256", "crc32"):
                    require(actual[key] == wanted[entry.filename][key], f"CSV内容不等于生成期独立证据：{entry.filename}/{key}")
            else:
                manifest = json.loads(metadata.decode("utf-8"))
            results.append(actual)
    require(manifest["format"] == "DBArk-query-csv-archive" and manifest["version"] == 1 and manifest["encoding"] == "utf8", "清单格式不符")
    require(manifest["csv"] == {"delimiter": ",", "recordDelimiter": "\r\n", "null": "\\N", "leadingBackslash": "double", "binary": "base64:", "header": "exportName", "columnOrder": "position"}, "清单CSV约定错误")
    require(len(manifest["results"]) == 4, "必须保留三个行集与中间状态")
    rows = [item for item in manifest["results"] if item["kind"] == "rows"]
    require(len(rows) == len(wanted), "清单行集数错误")
    for record, target in zip(rows, wanted.values()):
        require(record["file"] == target["name"] and record["bytes"] == target["bytes"] and record["rowsWritten"] == target["rows"], "清单必须匹配每个CSV实际长度和行数")
        require(record["resultOrdinal"] == target["resultOrdinal"] and record["rowResultOrdinal"] == target["rowResultOrdinal"] and record["statementOrdinal"] == target["resultOrdinal"] and record["warningCount"] == 0, "结果序号或警告归属错误")
        require(record["columns"] == [{"position": index + 1, "name": name, "exportName": name, "type": "VAR_STRING"} for index, name in enumerate(("entry", "row", "payload"))], "清单列位置错误")
    require(manifest["results"][1] == {"kind": "status", "resultOrdinal": 2, "statementOrdinal": 2, "affectedRows": 0, "insertId": "0", "warningCount": 1}, "中间状态内容错误")
    crossed_size = results[0]["bytes"] > 0xffffffff
    crossed_offset = all(item["headerOffset"] > 0xffffffff for item in results[1:])
    if expected["plan"]["large"]:
        require(crossed_size and crossed_offset and info.st_size > 2**32, "未实际跨过条目大小及后续偏移的ZIP32边界")
    return {"verified": True, "archiveBytes": info.st_size, "zip32SizeCrossed": crossed_size, "zip32FollowingOffsetsCrossed": crossed_offset, "centralDirectoryOffset": directory_offset, "centralDirectoryBytes": directory_bytes, "entries": results, "python": sys.version, "fileAttributes": attrs, "readChunkBytes": 1024 * 1024}


if __name__ == "__main__":
    require(len(sys.argv) == 3, "需要归档路径与独立预期文件")
    print(json.dumps(verify(Path(sys.argv[1]), Path(sys.argv[2])), ensure_ascii=False))
