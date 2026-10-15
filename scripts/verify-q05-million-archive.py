"""独立标准库读取器：有界ZIP目录、分块CRC、逐行CSV，不导入产品实现。"""
import argparse
import base64
import csv
import io
import json
from pathlib import Path
import struct
import tempfile
import zipfile
import zlib

LIMIT = 10 * 1024 ** 3
CHUNK = 65536
AMOUNT = '12345678901234567890.123456789012'
BIG = 9007199254740992
HEADERS = [
    ['seq', 'same_name', 'same_name [3]', '文本', 'bytes_value', 'null_value', 'empty_text', 'leading_text', 'tid', 'runs'],
    ['tid', 'runs', 'same_name', 'same_name [4]'],
    ['empty_value'],
]
NAMES = ['results/rows-001.csv', 'results/rows-002.csv', 'results/rows-003.csv', 'manifest.json']


def require(condition, message):
    """显式异常不受python -O影响，错误只报告序号和边界而不转储数据。"""
    if not condition:
        raise ValueError(message)


def directory_budget(path):
    """先以固定大小尾部核中央目录预算，再允许zipfile加载有界元数据。"""
    size = path.stat().st_size
    require(22 <= size <= LIMIT, '归档大小不在产品预算内')
    with path.open('rb') as source:
        source.seek(size - 22)
        end = source.read(22)
        signature, disk, start_disk, disk_count, count, length, offset, comment = struct.unpack('<4s4H2LH', end)
        require(signature == b'PK\x05\x06' and disk == start_disk == comment == 0 and disk_count == count, '只接受完整单卷、无注释的本例归档')
        boundary = size - 22
        if length == 0xffffffff or offset == 0xffffffff or count == 0xffff:
            require(size >= 98, 'ZIP64尾部被截断')
            source.seek(size - 42)
            locator, disk, at, disks = struct.unpack('<4sLQL', source.read(20))
            require(locator == b'PK\x06\x07' and disk == 0 and disks == 1 and at == size - 98, 'ZIP64定位器无效')
            source.seek(at)
            values = struct.unpack('<4sQ2H2L4Q', source.read(56))
            require(values[0] == b'PK\x06\x06' and values[1] == 44 and values[4] == values[5] == 0 and values[6] == values[7], 'ZIP64结束记录无效')
            count, length, offset, boundary = values[7], values[8], values[9], at
        require(1 <= count <= 201 and 0 < length <= 128 * 1024 and 0 <= offset < boundary and offset + length == boundary, '中央目录数量、大小或偏移越界')
    return size


class Counted(io.RawIOBase):
    """每次最多64KiB，独立累计CRC和实际展开字节，不保留已消费片段。"""
    def __init__(self, source, budget):
        self.source, self.budget, self.count, self.crc = source, budget, 0, 0

    def readable(self):
        """向标准缓冲层声明只读接口。"""
        return True

    def readinto(self, target):
        """单次解包请求硬限64KiB，并同步核对字节预算。"""
        block = self.source.read(min(len(target), CHUNK))
        self.count += len(block)
        require(self.count <= self.budget, '展开字节超过目录或产品预算')
        self.crc = zlib.crc32(block, self.crc)
        target[:len(block)] = block
        return len(block)


def lines_bounded(text):
    """csv.reader按物理行取输入；限制readline长度，损坏的无换行文件也不能整读。"""
    while True:
        line = text.readline(CHUNK + 1)
        require(len(line) <= CHUNK, 'CSV物理行超过本例65536字符预算')
        if not line:
            return
        yield line


def expected_row(number, thread):
    return [str(number), str(BIG + number), AMOUNT, f'第{number}行🚀,带"引号"\r\n第二行', 'base64:AAH/gA==', '\\N', '', '\\\\N', str(thread), '1']


def verify(path, expected_rows, thread):
    """按清单位置和全部实际行逐项比对，不能只抽样或以计数代替精度校验。"""
    require(path.is_file() and not path.is_symlink(), '输入必须是普通归档文件')
    size = directory_budget(path)
    csv.field_size_limit(4096)
    counts, sizes, crcs = [], [], []
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        require([entry.filename for entry in entries] == NAMES, '包内路径、顺序或数量不符')
        require(sum(entry.file_size for entry in entries) <= LIMIT, '总展开字节超过10GiB')
        for index, entry in enumerate(entries):
            require(entry.compress_type == zipfile.ZIP_STORED and not entry.flag_bits & 1 and entry.file_size == entry.compress_size and entry.header_offset < size, '非STORE、加密、大小或偏移异常')
            require(entry.file_size <= (8 * 1024 ** 2 if index == 3 else LIMIT), '清单或CSV超过预算')
            with archive.open(entry) as source:
                counted = Counted(source, entry.file_size)
                if index == 3:
                    data = bytearray()
                    buffer = bytearray(CHUNK)
                    while True:
                        length = counted.readinto(buffer)
                        if not length:
                            break
                        data.extend(memoryview(buffer)[:length])
                    manifest = json.loads(data.decode('utf-8'))
                else:
                    with io.TextIOWrapper(io.BufferedReader(counted, CHUNK), encoding='utf-8', errors='strict', newline='') as text:
                        rows = csv.reader(lines_bounded(text), strict=True)
                        require(next(rows, None) == HEADERS[index], f'第{index + 1}个CSV标题或列位置不符')
                        count, total = 0, 0
                        for row in rows:
                            count += 1
                            if index == 0:
                                require(count <= expected_rows and row == expected_row(count, thread), f'百万行CSV第{count}行顺序、Unicode、NULL或精度不符')
                                require(base64.b64decode(row[4][7:], validate=True) == b'\x00\x01\xff\x80', f'第{count}行二进制不符')
                                total += count
                            elif index == 1:
                                require(count == 1 and row == [str(thread), '1', '18446744073709551615', '0.12345678901234567890'], '小行集同会话、单次执行或精度不符')
                            else:
                                raise ValueError('空行集出现数据')
                        require(count == [expected_rows, 1, 0][index], '实际CSV行数不符')
                        if index == 0:
                            require(total == expected_rows * (expected_rows + 1) // 2, '百万行顺序校验和不符')
                        counts.append(count)
                require(counted.count == entry.file_size and counted.crc == entry.CRC, '独立CRC或实际字节数不符')
                sizes.append(counted.count)
                crcs.append(f'{counted.crc:08x}')
        require(manifest.get('format') == 'DBArk-query-csv-archive' and manifest.get('version') == 1 and manifest.get('encoding') == 'utf8', '清单格式版本不符')
        require(manifest.get('csv') == {'delimiter': ',', 'recordDelimiter': '\r\n', 'null': '\\N', 'leadingBackslash': 'double', 'binary': 'base64:', 'header': 'exportName', 'columnOrder': 'position'}, 'CSV编码约定不符')
        results = manifest.get('results', [])
        require([(item.get('kind'), item.get('resultOrdinal'), item.get('statementOrdinal')) for item in results] == [('rows', 1, 1), ('status', 2, 1), ('status', 3, 2), ('rows', 4, 3), ('rows', 5, 4)], '行集和中间状态包的原协议位置不符')
        for index, result in enumerate([results[0], results[3], results[4]]):
            require((result.get('rowResultOrdinal'), result.get('file'), result.get('rowsWritten'), result.get('bytes')) == (index + 1, NAMES[index], counts[index], sizes[index]), '清单行集映射或字节数不符')
            columns = result.get('columns', [])
            require(len(columns) == len(HEADERS[index]), '清单列数与实际CSV标题不符')
            original_names = [name.split(' [')[0] for name in HEADERS[index]]
            require([(column.get('position'), column.get('name'), column.get('exportName')) for column in columns] == list(zip(range(1, len(columns) + 1), original_names, HEADERS[index])), '重复列名或按位置映射不符')
            require(all(isinstance(column.get('type'), str) and column['type'] for column in columns), '缺少真实驱动列类型')
        for result in [results[1], results[2]]:
            require(isinstance(result.get('affectedRows'), int) and result['affectedRows'] >= 0 and result.get('insertId') == '0' and isinstance(result.get('warningCount'), int), '状态包不完整')
        require(results[2]['affectedRows'] == 1, '中间UPDATE影响行数不符')
    return {'校验': '独立Python标准库逐块ZIP和逐行CSV通过', '行数': counts, 'CSV字节': sizes[:3], 'CRC32': crcs, '归档字节': size, '原协议结果数': 5, '读取块上限': CHUNK, '数据库执行来源': '须结合Engine和服务器证据核对'}


def sample(path, rows, thread, wrong_value=False, wrong_map=False):
    """小型自检样本由Python自身生成，只验证读取器，不能冒充产品或实库输出。"""
    payloads = []
    for index, header in enumerate(HEADERS):
        output = io.StringIO(newline='')
        writer = csv.writer(output, lineterminator='\r\n')
        writer.writerow(header)
        if index == 0:
            for number in range(1, rows + 1):
                row = expected_row(number, thread)
                if wrong_value and number == rows:
                    row[2] = '精度错误'
                writer.writerow(row)
        elif index == 1:
            writer.writerow([thread, '1', '18446744073709551615', '0.12345678901234567890'])
        payloads.append(output.getvalue().encode('utf-8'))
    manifest = {'format': 'DBArk-query-csv-archive', 'version': 1, 'encoding': 'utf8', 'csv': {'delimiter': ',', 'recordDelimiter': '\r\n', 'null': '\\N', 'leadingBackslash': 'double', 'binary': 'base64:', 'header': 'exportName', 'columnOrder': 'position'}, 'results': []}
    for ordinal, statement, row_index in [(1, 1, 0), (2, 1, None), (3, 2, None), (4, 3, 1), (5, 4, 2)]:
        if row_index is None:
            result = {'kind': 'status', 'resultOrdinal': ordinal, 'statementOrdinal': statement, 'affectedRows': 1, 'insertId': '0', 'warningCount': 0}
        else:
            result = {'kind': 'rows', 'resultOrdinal': ordinal, 'statementOrdinal': statement, 'rowResultOrdinal': row_index + 1, 'file': NAMES[row_index], 'rowsWritten': [rows, 1, 0][row_index], 'bytes': len(payloads[row_index]), 'columns': [{'position': number, 'name': header.split(' [')[0], 'exportName': header, 'type': 'TEST_ONLY'} for number, header in enumerate(HEADERS[row_index], 1)]}
        manifest['results'].append(result)
    if wrong_map:
        manifest['results'][3]['columns'].pop()
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, content in zip(NAMES[:3], payloads):
            with archive.open(name, 'w', force_zip64=True) as output:
                output.write(content)
        archive.writestr(NAMES[3], json.dumps(manifest, ensure_ascii=False).encode('utf-8'))


def self_check(root):
    """只在显式给定的本克隆缓存根下创建并清理本例小文件。"""
    root = root.resolve(strict=True)
    repository = Path(__file__).resolve().parent.parent
    require(root == repository / '.cache' / 'q05-million-archive', '自检根必须是本克隆固定缓存目录')
    checks = 0
    with tempfile.TemporaryDirectory(prefix='reader-only-', dir=root) as temporary:
        path = Path(temporary) / 'sample.zip'
        sample(path, 7, 123)
        verify(path, 7, 123)
        checks += 1
        # 小文件也独立构造标准ZIP64尾部，核验读取器的64位目录预算分支。
        data = path.read_bytes()
        _, _, _, _, count, length, offset, _ = struct.unpack('<4s4H2LH', data[-22:])
        end64 = struct.pack('<4sQ2H2L4Q', b'PK\x06\x06', 44, 45, 45, 0, 0, count, count, length, offset)
        locator = struct.pack('<4sLQL', b'PK\x06\x07', 0, len(data) - 22, 1)
        end = struct.pack('<4s4H2LH', b'PK\x05\x06', 0, 0, count, count, 0xffffffff, 0xffffffff, 0)
        path.write_bytes(data[:-22] + end64 + locator + end)
        verify(path, 7, 123)
        checks += 1
        for parameters in [{'wrong_value': True}, {'wrong_map': True}]:
            sample(path, 7, 123, **parameters)
            try:
                verify(path, 7, 123)
            except ValueError:
                checks += 1
            else:
                raise ValueError('读取器没有拒绝故障样本')
        sample(path, 7, 123)
        with path.open('r+b') as output:
            at = path.read_bytes().index(b'PK\x01\x02') + 16
            output.seek(at)
            byte = output.read(1)
            output.seek(at)
            output.write(bytes([byte[0] ^ 1]))
        try:
            verify(path, 7, 123)
        except (ValueError, zipfile.BadZipFile, UnicodeError):
            checks += 1
        else:
            raise ValueError('读取器没有拒绝CRC损坏')
        try:
            next(lines_bounded(io.StringIO('x' * (CHUNK + 1))))
        except ValueError:
            checks += 1
        else:
            raise ValueError('读取器没有拒绝无界物理行')
    return {'模式': '仅本地小型纯文件自检', '通过项': checks, '样本行数': 7, '已访问数据库': False, '不代表产品归档或百万行实库通过': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Q05独立有界归档验收')
    parser.add_argument('--self-check-root', type=Path)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--thread-id', type=int)
    args = parser.parse_args()
    if args.self_check_root is not None:
        require(args.archive is None and args.thread_id is None, '自检不能同时读取真实归档')
        result = self_check(args.self_check_root)
    else:
        require(args.archive is not None and args.thread_id is not None and args.thread_id > 0, '必须提供归档路径和已核对真实线程ID')
        result = verify(args.archive, 1000000, args.thread_id)
    print(json.dumps(result, ensure_ascii=False))
