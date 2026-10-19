"""只读比较既有源码六项与新源码legacy的固定归档身份。"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import zipfile


def main():
    """每份原ZIP均独立核字节/SHA/CRC，只解包数据，不启动应用或旧VM。"""
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/codex/v028-serial-closeout-20261019'
    spec = importlib.util.spec_from_file_location('archive_reader', 'scripts/read-v028-windows-success-archive.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    root = Path('.cache/macos-source-identity-readback-39258588418')
    root.mkdir(parents=True, exist_ok=False)
    records = []
    for artifact_id, kind, run_id, head, size, digest in [
        (12181093082, 'native', 39240838841, '689b35247a3a5c3345f5c0e754c5ae0742e1a33c', 42049, 'b8c38327b28b5b543ef3e3831710fa4011f4836e0962bf83ee180d32906abb6c'),
        (12189941128, 'legacy', 39258588418, '0f39cf69b149a1466fa097deec554f4ff0e2f59d', 3901394, '9015341298554c24b3ccccad4ca8d279688169613cf43c662ac659cc60df9c63'),
    ]:
        api = f'https://api.github.com/repos/zhao-yc/DBArk/actions/artifacts/{artifact_id}'
        metadata = json.loads(module.download(api))
        assert metadata['workflow_run']['id'] == run_id and metadata['workflow_run']['head_sha'] == head
        assert metadata['size_in_bytes'] == size and metadata['digest'] == 'sha256:' + digest
        raw = module.download(api + '/zip')
        assert len(raw) == size and hashlib.sha256(raw).hexdigest() == digest
        with (root / f'{kind}.zip').open('xb') as output:
            output.write(raw)
        members = []
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            assert archive.testzip() is None
            assert len(archive.namelist()) == len(set(archive.namelist())) < 20000
            for item in archive.infolist():
                name = PurePosixPath(item.filename)
                assert not name.is_absolute() and '..' not in name.parts and '\\' not in item.filename and ':' not in item.filename
                assert not stat.S_ISLNK(item.external_attr >> 16) and item.file_size < 16 * 1024 * 1024
                if item.is_dir():
                    continue
                value = archive.read(item)
                target = root / kind / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as output:
                    output.write(value)
                members.append({'path': item.filename, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()})
        record = {'artifactId': artifact_id, 'kind': kind, 'zipBytes': size, 'zipSha256': digest, 'allMemberCrcValidated': True, 'members': members}
        records.append(record)
        print('DBARK_MAC_SOURCE_ARCHIVE:' + json.dumps({key: value for key, value in record.items() if key != 'members'}, ensure_ascii=False))
    with (root / 'archive-receipt.json').open('x', encoding='utf-8') as output:
        json.dump({'archives': records, 'validationHost': 'GitHub-hosted Ubuntu', 'rootLocalZipValidated': False, 'oldVmAccessed': False}, output, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
