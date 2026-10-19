"""只读接收Windows成功和Mac失败的原关键字证据；不重试原用例，不操作旧VM。"""
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import zipfile


def main():
    """固定run、head、长度及摘要，全部CRC通过后只提取原始报告。"""
    assert os.environ.get('GITHUB_JOB') == 'keyword-readback'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/codex/v028-serial-closeout-20261019'
    spec = importlib.util.spec_from_file_location('reader', 'scripts/read-v028-windows-success-archive.py')
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    root = Path('.cache/v028-keyword-readback')
    root.mkdir(parents=True, exist_ok=False)
    records = []
    for artifact, platform, size, digest in [(12193651442, 'windows', 73725, 'e734d623ff5b18c66cb27141ac2e5f7b41cc22de041ec3ae200faa947e269d9e'), (12192148660, 'macos', 44098, '24105dab20523d3dc0256e09a8f08b6d4f873796f14f1102ab327c2b070c8e02')]:
        api = f'https://api.github.com/repos/zhao-yc/DBArk/actions/artifacts/{artifact}'
        metadata = json.loads(reader.download(api))
        assert metadata['workflow_run']['id'] == 39265643127 and metadata['workflow_run']['head_sha'] == 'eb171c2aea239f10ab170cbc8f47318fa12bbe64'
        assert metadata['size_in_bytes'] == size and metadata['digest'] == 'sha256:' + digest and not metadata['expired']
        raw = reader.download(api + '/zip')
        assert len(raw) == size and hashlib.sha256(raw).hexdigest() == digest
        with (root / (platform + '.zip')).open('xb') as output:
            output.write(raw)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            assert archive.testzip() is None and len(archive.namelist()) == len(set(archive.namelist())) < 100
            assert sum(item.file_size for item in archive.infolist()) < 16 * 1024 ** 2
            for item in archive.infolist():
                name = PurePosixPath(item.filename)
                assert not name.is_absolute() and '..' not in name.parts and '\\' not in item.filename and ':' not in item.filename
                assert not stat.S_ISLNK(item.external_attr >> 16)
                if item.is_dir():
                    continue
                target = root / platform / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as output:
                    output.write(archive.read(item))
        records.append({'artifactId': artifact, 'platform': platform, 'bytes': size, 'sha256': digest, 'crcValidated': True})
    with (root / 'archives.json').open('x', encoding='utf-8') as output:
        json.dump(records, output, indent=2)
    print('DBARK_KEYWORD_READBACK_ARCHIVES:' + json.dumps(records))


if __name__ == '__main__':
    main()
