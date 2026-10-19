"""只读核固定成功Mac安装归档；不执行程序、不挂载DMG，也不访问旧VM。"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import urllib.request
import zipfile


def main():
    """核固定API身份后独立下载字节，逐成员CRC；应用ZIP只读验CRC，不提取或运行。"""
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/codex/v028-serial-closeout-20261019'
    spec = importlib.util.spec_from_file_location('archive_reader', 'scripts/read-v028-windows-success-archive.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    root = Path('.cache/macos-installed-success-readback-39256090941')
    root.mkdir(parents=True, exist_ok=False)
    records = []
    for artifact_id, kind, size, digest in [
        (12189350924, 'evidence', 3953102, '62ba852f2569e95cf93abc3d7fcd498bbf89f64f39bfb66e07ddb244c8fe4ab6'),
        (12188064300, 'candidate', 339815801, '6d72842063537d7b3313973574a627d01a7dda1bf5266a122bd6badd5e2ac2bc'),
    ]:
        api = f'https://api.github.com/repos/zhao-yc/DBArk/actions/artifacts/{artifact_id}'
        metadata = json.loads(module.download(api))
        assert metadata['workflow_run']['id'] == 39256090941
        assert metadata['workflow_run']['head_sha'] == '3fd87bb98555ba042f303762ee7a314582cb18d1'
        assert metadata['size_in_bytes'] == size and metadata['digest'] == 'sha256:' + digest
        assert size < 512 * 1024 * 1024 and not metadata['expired']
        request = urllib.request.Request(api + '/zip', headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'})
        with urllib.request.build_opener(module.SafeRedirect()).open(request, timeout=60) as response:
            raw = response.read(size + 1)
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
                assert not stat.S_ISLNK(item.external_attr >> 16) and item.file_size < 512 * 1024 * 1024
                if item.is_dir():
                    continue
                value = archive.read(item)
                target = root / kind / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as output:
                    output.write(value)
                member = {'path': item.filename, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest(), 'crc32': f'{item.CRC:08x}'}
                if kind == 'candidate' and name.suffix == '.zip':
                    with zipfile.ZipFile(io.BytesIO(value)) as application:
                        assert sum(entry.file_size for entry in application.infolist()) < 2 * 1024 ** 3
                        assert application.testzip() is None
                        member['applicationZipAllMemberCrcValidated'] = True
                        member['applicationZipMembers'] = len(application.infolist())
                members.append(member)
        record = {'artifactId': artifact_id, 'kind': kind, 'zipBytes': size, 'zipSha256': digest, 'allMemberCrcValidated': True, 'members': members}
        records.append(record)
        print('DBARK_MAC_SUCCESS_ARCHIVE:' + json.dumps(record if kind == 'candidate' else {key: value for key, value in record.items() if key != 'members'}, ensure_ascii=False))
    with (root / 'archive-receipt.json').open('x', encoding='utf-8') as output:
        json.dump({'archives': records, 'validationHost': 'GitHub-hosted Ubuntu', 'rootLocalZipValidated': False, 'oldVmAccessed': False, 'sceneCleanupRequested': False}, output, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
