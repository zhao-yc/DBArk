"""独立标准库读回四行常量导出；不导入产品代码、不联网、不修改输入文件。"""
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys

LIMIT = 32768
WINDOWS = sys.platform == 'win32'
HEADERS = ['id', 'text_value', 'big_value', 'exact_value', 'moment_value', 'duration_value', 'group_value', 'bytes']
CSV_ROWS = [
    ['1', 'a', '18446744073709551615', '0.12345678901234567890', '\\N', '\\N', '\\N', 'base64:AP8='],
    ['3', 'A', '9007199254740993', '1.00000000000000000001', '2026-10-21 12:00:00.000002', '-99:59:59.999999', '\\N', 'base64:'],
    ['6', 'İ', '18446744073709551615', '0.12345678901234567891', '\\N', '\\N', '\\N', 'base64:AQ=='],
    ['7', 'i\u0307', '9007199254740993', '0.12345678901234567890', '\\N', '\\N', '\\N', '\\N'],
]
JSON_ROWS = [
    {'id': '1', 'text_value': 'a', 'big_value': '18446744073709551615', 'exact_value': '0.12345678901234567890', 'moment_value': None, 'duration_value': None, 'group_value': None, 'bytes': {'type': 'binary', 'base64': 'AP8='}},
    {'id': '3', 'text_value': 'A', 'big_value': '9007199254740993', 'exact_value': '1.00000000000000000001', 'moment_value': '2026-10-21 12:00:00.000002', 'duration_value': '-99:59:59.999999', 'group_value': None, 'bytes': {'type': 'binary', 'base64': ''}},
    {'id': '6', 'text_value': 'İ', 'big_value': '18446744073709551615', 'exact_value': '0.12345678901234567891', 'moment_value': None, 'duration_value': None, 'group_value': None, 'bytes': {'type': 'binary', 'base64': 'AQ=='}},
    {'id': '7', 'text_value': 'i\u0307', 'big_value': '9007199254740993', 'exact_value': '0.12345678901234567890', 'moment_value': None, 'duration_value': None, 'group_value': None, 'bytes': None},
]


class VerificationError(ValueError):
    """仅携带固定诊断，不把实际数据或输入路径加入失败正文。"""


def require(condition, message):
    """显式失败不受python -O影响，不输出实际单元格内容。"""
    if not condition:
        raise VerificationError(message)


def unique_object(pairs):
    """重复JSON字段即使值相同也拒绝，保留真实字段顺序。"""
    result = {}
    for key, value in pairs:
        require(key not in result, 'JSON对象包含重复字段')
        result[key] = value
    return result


def verify_bytes(csv_bytes, json_bytes, csv_sha256, json_sha256):
    """独立手写全部期待，逐值比对四行及类型，不从产品比较器生成答案。"""
    for raw, expected in [(csv_bytes, csv_sha256), (json_bytes, json_sha256)]:
        require(type(raw) is bytes and 0 < len(raw) <= LIMIT, '导出字节预算不符')
        require(type(expected) is str and re.fullmatch('[0-9a-f]{64}', expected), '须显式提供原导出的准确SHA256')
        require(hashlib.sha256(raw).hexdigest() == expected, '导出与原记录SHA256不符')
    try:
        csv_text, json_text = csv_bytes.decode('utf-8-sig'), json_bytes.decode('utf-8-sig')
        rows = list(csv.reader(io.StringIO(csv_text, newline=''), strict=True))
        records = json.loads(json_text, object_pairs_hook=unique_object)
    except (UnicodeError, csv.Error, json.JSONDecodeError, RecursionError):
        raise VerificationError('UTF-8或导出格式无法完整解析') from None
    require(rows == [HEADERS, *CSV_ROWS], 'CSV字段、行序或完整原值不符')
    require(type(records) is list and len(records) == 4, 'JSON完整行数不符')
    for actual, expected in zip(records, JSON_ROWS):
        require(type(actual) is dict and list(actual) == HEADERS, 'JSON字段及顺序不符')
        require(actual == expected, 'JSON原值或类型不符')
    return {'passed': True, 'rows': 4, 'columns': 8, 'jsonStrings': 18, 'jsonNulls': 11, 'jsonBinary': 3,
            'csv': {'bytes': len(csv_bytes), 'sha256': csv_sha256}, 'json': {'bytes': len(json_bytes), 'sha256': json_sha256}}


def stamp(value):
    """保存同一种stat接口的完整快照，ctime绝不跨接口混用。"""
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def binding_stamp(value):
    """跨路径／句柄绑定身份；Windows新版本以明确birthtime对齐创建时间。"""
    creation = getattr(value, 'st_birthtime_ns', value.st_ctime_ns) if WINDOWS else value.st_ctime_ns
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, creation


def regular(value):
    """普通文件之外及Windows重解析点均拒绝。"""
    return stat.S_ISREG(value.st_mode) and not getattr(value, 'st_file_attributes', 0) & 0x400


def read_pinned(path):
    """仅有界读取显式文件，核lstat／原文件描述符／读后路径的同一身份。"""
    before = path.lstat()
    require(regular(before) and 0 < before.st_size <= LIMIT, '输入须为有界普通文件')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0))
    try:
        opened = os.fstat(descriptor)
        require(regular(opened) and binding_stamp(opened) == binding_stamp(before), '文件打开时身份已变化')
        with os.fdopen(descriptor, 'rb', closefd=False) as source:
            raw = source.read(LIMIT + 1)
        after = os.fstat(descriptor)
        require(len(raw) == before.st_size and regular(after) and stamp(after) == stamp(opened)
                and binding_stamp(after) == binding_stamp(opened), '文件读取期间已变化')
    finally:
        os.close(descriptor)
    after_path = path.lstat()
    require(regular(after_path) and stamp(after_path) == stamp(before)
            and binding_stamp(after_path) == binding_stamp(before), '原文件路径已被替换')
    return raw, before


def verify_files(csv_path, json_path, csv_sha256, json_sha256):
    """只读同一本例nonce子目录中的两个明确文件，不搜索旧导出或profile。"""
    require(all(type(value) is str and re.fullmatch('[0-9a-f]{64}', value) for value in [csv_sha256, json_sha256]), '须显式提供原导出的准确SHA256')
    csv_path, json_path = Path(csv_path), Path(json_path)
    require(csv_path.is_absolute() and json_path.is_absolute() and csv_path.parent == json_path.parent, '须提供同目录的两个绝对文件路径')
    require(csv_path.name == 'visible-selected.csv' and json_path.name == 'visible-selected.json', '本例导出文件名不符')
    parent = csv_path.parent
    require(re.fullmatch('dbark-query-columns-[0-9a-f]{32}', parent.name), '本例nonce目录不符')
    before = parent.lstat()
    require(stat.S_ISDIR(before.st_mode) and not getattr(before, 'st_file_attributes', 0) & 0x400, '本例目录不能是链接或重解析点')
    csv_bytes, csv_identity = read_pinned(csv_path)
    json_bytes, json_identity = read_pinned(json_path)
    result = verify_bytes(csv_bytes, json_bytes, csv_sha256, json_sha256)
    csv_after, json_after = csv_path.lstat(), json_path.lstat()
    require(all(regular(after) and stamp(after) == stamp(original)
                and binding_stamp(after) == binding_stamp(original)
                for after, original in [(csv_after, csv_identity), (json_after, json_identity)]), '两文件读取后原路径或内容已变化')
    parent_after = parent.lstat()
    require(stamp(parent_after) == stamp(before) and binding_stamp(parent_after) == binding_stamp(before), '本例目录读取期间已变化')
    result['stableRead'] = True
    result['identities'] = {'csv': [str(value) for value in stamp(csv_identity)], 'json': [str(value) for value in stamp(json_identity)]}
    return result


def main():
    """仅向stdout输出校验报告，退出码代表本次读回；不创建或覆盖任何报告文件。"""
    parser = argparse.ArgumentParser(description='独立读回排序筛选本例的四行CSV和JSON')
    parser.add_argument('--csv', required=True)
    parser.add_argument('--json', required=True)
    parser.add_argument('--csv-sha256', required=True)
    parser.add_argument('--json-sha256', required=True)
    args = parser.parse_args()
    try:
        result = verify_files(args.csv, args.json, args.csv_sha256, args.json_sha256)
    except VerificationError as error:
        result = {'passed': False, 'error': str(error)}
    except (OSError, ValueError, RecursionError):
        result = {'passed': False, 'error': '文件读取或格式解析失败'}
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
