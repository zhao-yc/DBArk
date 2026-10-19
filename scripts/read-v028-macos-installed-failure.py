"""独立下载固定失败归档；仅解包原报告，不访问旧 Mac 或执行归档程序。"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import zipfile


def main():
    """固定原运行、ID及摘要；每个成员都须通过CRC和归档路径检查。"""
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/codex/v028-serial-closeout-20261019'
    spec = importlib.util.spec_from_file_location('archive_reader', 'scripts/read-v028-windows-success-archive.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    artifact_id = 12186697756
    digest = '224d8f0c2d17b4ad2800a0374559581df56c77a87e5b605c21d992e13ad5e160'
    size = 5227611
    api = f'https://api.github.com/repos/zhao-yc/DBArk/actions/artifacts/{artifact_id}'
    metadata = json.loads(module.download(api))
    assert metadata['workflow_run']['id'] == 39253421880
    assert metadata['workflow_run']['head_sha'] == '5a4ca1b83fa26d43a91600202ab00fac174bc3f3'
    assert metadata['size_in_bytes'] == size and metadata['digest'] == 'sha256:' + digest
    raw = module.download(api + '/zip')
    assert len(raw) == size and hashlib.sha256(raw).hexdigest() == digest
    root = Path('.cache/macos-installed-failure-readback-39253421880')
    root.mkdir(parents=True, exist_ok=False)
    with (root / 'original.zip').open('xb') as output:
        output.write(raw)
    members = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(set(archive.namelist())) < 20000
        for item in archive.infolist():
            name = PurePosixPath(item.filename)
            assert not name.is_absolute() and '..' not in name.parts and '\\' not in item.filename and ':' not in item.filename
            assert not stat.S_ISLNK(item.external_attr >> 16) and item.file_size <= 16 * 1024 * 1024
            if item.is_dir():
                continue
            value = archive.read(item)
            target = root / 'evidence' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(value)
            members.append({'path': item.filename, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest(), 'crc32': f'{item.CRC:08x}'})
    receipt = {'artifactId': artifact_id, 'zipBytes': size, 'zipSha256': digest, 'allMemberCrcValidated': True, 'members': members, 'validationHost': 'GitHub-hosted Ubuntu', 'rootLocalZipValidated': False, 'oldVmAccessed': False, 'sceneCleanupRequested': False}
    with (root / 'archive-receipt.json').open('x', encoding='utf-8') as output:
        json.dump(receipt, output, ensure_ascii=False, indent=2)
    print('DBARK_MAC_FAILED_ARCHIVE:' + json.dumps({key: value for key, value in receipt.items() if key != 'members'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
