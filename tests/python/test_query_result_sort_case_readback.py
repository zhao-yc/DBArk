"""以独立合成字节测试读回器，不导入产品代码、不读取真实导出。"""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'testing' / 'verify-query-result-sort-case.py'
SPEC = importlib.util.spec_from_file_location('sort_case_reader', SCRIPT)
READER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(READER)
CSV = ('id,text_value,big_value,exact_value,moment_value,duration_value,group_value,bytes\r\n'
       '1,a,18446744073709551615,0.12345678901234567890,\\N,\\N,\\N,base64:AP8=\r\n'
       '3,A,9007199254740993,1.00000000000000000001,2026-10-21 12:00:00.000002,-99:59:59.999999,\\N,base64:\r\n'
       '6,İ,18446744073709551615,0.12345678901234567891,\\N,\\N,\\N,base64:AQ==\r\n'
       '7,i\u0307,9007199254740993,0.12345678901234567890,\\N,\\N,\\N,\\N\r\n').encode('utf-8')
JSON = ('[{"id":"1","text_value":"a","big_value":"18446744073709551615","exact_value":"0.12345678901234567890","moment_value":null,"duration_value":null,"group_value":null,"bytes":{"type":"binary","base64":"AP8="}},'
        '{"id":"3","text_value":"A","big_value":"9007199254740993","exact_value":"1.00000000000000000001","moment_value":"2026-10-21 12:00:00.000002","duration_value":"-99:59:59.999999","group_value":null,"bytes":{"type":"binary","base64":""}},'
        '{"id":"6","text_value":"İ","big_value":"18446744073709551615","exact_value":"0.12345678901234567891","moment_value":null,"duration_value":null,"group_value":null,"bytes":{"type":"binary","base64":"AQ=="}},'
        '{"id":"7","text_value":"i\u0307","big_value":"9007199254740993","exact_value":"0.12345678901234567890","moment_value":null,"duration_value":null,"group_value":null,"bytes":null}]').encode('utf-8')


def digest(raw):
    """反例更新输入摘要后仍须由完整值期待拒绝，不能只验证散列。"""
    return hashlib.sha256(raw).hexdigest()


class ReadbackTests(unittest.TestCase):
    """合成文件只在本测试独占临时目录内创建和自动清理。"""
    def verify(self, csv_bytes=CSV, json_bytes=JSON):
        """执行真实独立纯比较入口，不从读取器期待生成夹具。"""
        return READER.verify_bytes(csv_bytes, json_bytes, digest(csv_bytes), digest(json_bytes))

    def files(self, directory):
        """按本例nonce合同创建两个合成输入，不碰已有导出目录。"""
        parent = Path(directory) / ('dbark-query-columns-' + 'a' * 32)
        parent.mkdir()
        csv_path, json_path = parent / 'visible-selected.csv', parent / 'visible-selected.json'
        csv_path.write_bytes(CSV)
        json_path.write_bytes(JSON)
        return csv_path, json_path

    def test_complete_values_bom_and_counts(self):
        """完整四行、Unicode原文和UTF-8 BOM均逐值校验。"""
        for prefix in [b'', b'\xef\xbb\xbf']:
            with self.subTest(bom=bool(prefix)):
                result = self.verify(prefix + CSV, prefix + JSON)
                self.assertEqual([result[key] for key in ['rows', 'columns', 'jsonStrings', 'jsonNulls', 'jsonBinary']], [4, 8, 18, 11, 3])

    def test_decimal_last_digit_and_bigint(self):
        """末位精度或大数只改一位也不能通过。"""
        for before, after in [(b'0.12345678901234567891', b'0.12345678901234567890'), (b'18446744073709551615', b'18446744073709551614')]:
            with self.subTest(value=before):
                with self.assertRaises(READER.VerificationError):
                    self.verify(CSV.replace(before, after))

    def test_csv_missing_extra_or_reordered_row(self):
        """完整行数及顺序独立于摘要，不能只抽样。"""
        lines = CSV.splitlines(keepends=True)
        for raw in [b''.join(lines[:-1]), CSV + lines[-1], b''.join([lines[0], lines[2], lines[1], *lines[3:]])]:
            with self.assertRaises(READER.VerificationError):
                self.verify(raw)

    def test_json_number_cannot_replace_string(self):
        """JSON数字与原精确数字字符串类型不同。"""
        with self.assertRaises(READER.VerificationError):
            self.verify(json_bytes=JSON.replace(b'"18446744073709551615"', b'18446744073709551615'))

    def test_null_is_not_text(self):
        """CSV空值记号和JSON null不能换成同名文本。"""
        for csv_bytes, json_bytes in [(CSV.replace(b'\\N', b'NULL', 1), JSON), (CSV, JSON.replace(b'null', b'"null"', 1))]:
            with self.assertRaises(READER.VerificationError):
                self.verify(csv_bytes, json_bytes)

    def test_binary_and_empty_binary(self):
        """原字节及空字节包装不能被省略或替换为NULL。"""
        for csv_bytes, json_bytes in [(CSV.replace(b'base64:AQ==', b'base64:AQ'), JSON), (CSV, JSON.replace(b'{"type":"binary","base64":""}', b'null'))]:
            with self.assertRaises(READER.VerificationError):
                self.verify(csv_bytes, json_bytes)

    def test_unicode_raw_forms_are_distinct(self):
        """映射后相同的两种Unicode原文仍须保持独立。"""
        wrong_csv = CSV.replace('İ'.encode(), 'i\u0307'.encode())
        wrong_json = JSON.replace('i\u0307'.encode(), 'İ'.encode())
        for csv_bytes, json_bytes in [(wrong_csv, JSON), (CSV, wrong_json)]:
            with self.assertRaises(READER.VerificationError):
                self.verify(csv_bytes, json_bytes)

    def test_json_duplicate_and_field_order(self):
        """重复字段即使同值也拒绝，顶层字段顺序不能悄然变更。"""
        duplicate = JSON.replace(b'"id":"1"', b'"id":"1","id":"1"', 1)
        records = json.loads(JSON)
        records[0]['id'] = records[0].pop('id')
        for raw in [duplicate, json.dumps(records, ensure_ascii=False).encode()]:
            with self.assertRaises(READER.VerificationError):
                self.verify(json_bytes=raw)

    def test_json_missing_row_or_extra_field(self):
        """额外隐藏字段和缺行也必须完整拒绝。"""
        records = json.loads(JSON)
        for value in [records[:-1], [dict(row, extra='合成值') for row in records]]:
            with self.assertRaises(READER.VerificationError):
                self.verify(json_bytes=json.dumps(value, ensure_ascii=False).encode())

    def test_hash_and_byte_budget(self):
        """原摘要必需且准确，空文件和超限文件不解析。"""
        for value in ['', '0' * 64, 'A' * 64]:
            with self.assertRaises(READER.VerificationError):
                READER.verify_bytes(CSV, JSON, value, digest(JSON))
        for raw in [b'', b'x' * 32769]:
            with self.assertRaises(READER.VerificationError):
                self.verify(raw)

    def test_invalid_utf8_and_extra_json(self):
        """损坏编码和第二个根对象不能作为成功读回。"""
        for csv_bytes, json_bytes in [(CSV + b'\xff', JSON), (CSV, JSON + b'[]')]:
            with self.assertRaises(READER.VerificationError):
                self.verify(csv_bytes, json_bytes)

    def test_pinned_files_and_cli_are_readonly(self):
        """真实CLI只读临时合成文件，报告原摘要且不创建第三份文件。"""
        with tempfile.TemporaryDirectory() as directory:
            csv_path, json_path = self.files(directory)
            before = [READER.stamp(path.stat()) for path in [csv_path, json_path]]
            result = subprocess.run([sys.executable, '-I', '-B', str(SCRIPT), '--csv', str(csv_path), '--json', str(json_path), '--csv-sha256', digest(CSV), '--json-sha256', digest(JSON)], capture_output=True, check=False, timeout=10)
            self.assertEqual(result.returncode, 0)
            report = json.loads(result.stdout.decode('utf-8'))
            self.assertTrue(report['passed'] and report['stableRead'])
            self.assertEqual(report['csv']['sha256'], digest(CSV))
            self.assertEqual([READER.stamp(path.stat()) for path in [csv_path, json_path]], before)
            self.assertEqual(sorted(path.name for path in csv_path.parent.iterdir()), ['visible-selected.csv', 'visible-selected.json'])

    def test_pair_is_rechecked_after_second_read(self):
        """读完CSV后被就地修改也不能报告两文件稳定。"""
        with tempfile.TemporaryDirectory() as directory:
            csv_path, json_path = self.files(directory)
            original = READER.read_pinned
            def changed(path):
                """仅在第二个合成文件读取时制造前文件漂移。"""
                value = original(path)
                if path == json_path:
                    csv_path.write_bytes(CSV + b'\r\n')
                return value
            with patch.object(READER, 'read_pinned', changed), self.assertRaises(READER.VerificationError):
                READER.verify_files(csv_path, json_path, digest(CSV), digest(JSON))

    def test_cli_failure_is_sanitized_even_optimized(self):
        """优化模式也明确失败，stdout／stderr均不回显合成秘密原文。"""
        with tempfile.TemporaryDirectory() as directory:
            csv_path, json_path = self.files(directory)
            wrong = b'RAM_PRIVATE_MARKER\r\n'
            csv_path.write_bytes(wrong)
            result = subprocess.run([sys.executable, '-I', '-B', '-O', str(SCRIPT), '--csv', str(csv_path), '--json', str(json_path), '--csv-sha256', digest(wrong), '--json-sha256', digest(JSON)], capture_output=True, check=False, timeout=10)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout.decode('utf-8')), {'passed': False, 'error': 'CSV字段、行序或完整原值不符'})
            self.assertNotIn(b'RAM_PRIVATE_MARKER', result.stdout + result.stderr)

    def test_wrong_nonce_or_parent_is_rejected(self):
        """未知目录及不同目录不通过寻找旧文件来补齐。"""
        with tempfile.TemporaryDirectory() as directory:
            csv_path, json_path = self.files(directory)
            with self.assertRaises(READER.VerificationError):
                READER.verify_files(csv_path, json_path.parent.parent / json_path.name, digest(CSV), digest(JSON))
            unknown = csv_path.parent.parent / 'unknown'
            with self.assertRaises(READER.VerificationError):
                READER.verify_files(unknown / csv_path.name, unknown / json_path.name, digest(CSV), digest(JSON))

    def test_leaf_symlink_is_rejected(self):
        """链接不能冒充当前原导出文件。"""
        with tempfile.TemporaryDirectory() as directory:
            csv_path, json_path = self.files(directory)
            target = csv_path.with_name('other.csv')
            csv_path.rename(target)
            try:
                csv_path.symlink_to(target.name)
            except OSError:
                self.skipTest('当前平台不允许创建合成符号链接')
            with self.assertRaises(READER.VerificationError):
                READER.verify_files(csv_path, json_path, digest(CSV), digest(JSON))


if __name__ == '__main__':
    unittest.main(verbosity=2)
