"""在新的原生CI接收固定成功归档；不访问旧VM，不下载到操作者电脑。"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import urllib.request
import zipfile


def main():
    """令牌仅交官方API，重定向去掉认证；逐字节摘要和全部CRC通过后才提供候选。"""
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/codex/v028-serial-closeout-20261019'
    assert os.environ.get('GITHUB_JOB') == 'keyword-native'
    spec = importlib.util.spec_from_file_location('reader', 'scripts/read-v028-windows-success-archive.py')
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    if sys.platform == 'win32':
        run, head = 39244695054, '4a2bcd423a26f5fe6fe094ee30656a58fb7d3035'
        targets = [(12184037042, 'evidence', 5340007, 'd7eb06a765753b584d8e77a21dd4a42a40439338fc65892fafe95d3bfb435176'),
                   (12184231827, 'candidate', 142818435, '066ec0ed921c59168800161d85d3e0cf6c0bcbe814069d1cf9d3df315b88746f')]
    else:
        assert sys.platform == 'darwin'
        run, head = 39256090941, '3fd87bb98555ba042f303762ee7a314582cb18d1'
        targets = [(12189350924, 'evidence', 3953102, '62ba852f2569e95cf93abc3d7fcd498bbf89f64f39bfb66e07ddb244c8fe4ab6'),
                   (12188064300, 'candidate', 339815801, '6d72842063537d7b3313973574a627d01a7dda1bf5266a122bd6badd5e2ac2bc')]
    root = Path('.cache/v028-keyword-input')
    root.mkdir(parents=True, exist_ok=False)
    records = []
    for artifact_id, kind, size, digest in targets:
        api = f'https://api.github.com/repos/zhao-yc/DBArk/actions/artifacts/{artifact_id}'
        metadata = json.loads(reader.download(api))
        assert metadata['workflow_run']['id'] == run and metadata['workflow_run']['head_sha'] == head
        assert metadata['size_in_bytes'] == size and metadata['digest'] == 'sha256:' + digest
        assert not metadata['expired']
        request = urllib.request.Request(api + '/zip', headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'})
        with urllib.request.build_opener(reader.SafeRedirect()).open(request, timeout=60) as response:
            raw = response.read(size + 1)
        assert len(raw) == size and hashlib.sha256(raw).hexdigest() == digest
        members = []
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            assert len(archive.namelist()) == len(set(archive.namelist())) < 20000
            assert sum(item.file_size for item in archive.infolist()) < 1024 ** 3
            assert archive.testzip() is None
            for item in archive.infolist():
                name = PurePosixPath(item.filename)
                assert not name.is_absolute() and '..' not in name.parts and '\\' not in item.filename and ':' not in item.filename
                assert not stat.S_ISLNK(item.external_attr >> 16)
                if item.is_dir():
                    continue
                value = archive.read(item)
                target = root / kind / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as output:
                    output.write(value)
                members.append({'path': item.filename, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()})
        records.append({'artifactId': artifact_id, 'kind': kind, 'bytes': size, 'sha256': digest, 'crcValidated': True, 'members': members})
    receipt = {'originalRun': run, 'originalHead': head, 'archives': records, 'oldVmAccessed': False, 'localOperatorDownload': False}
    with (root / 'archive-receipt.json').open('x', encoding='utf-8') as output:
        json.dump(receipt, output, ensure_ascii=False, indent=2)
    print('DBARK_KEYWORD_ARCHIVES:' + json.dumps(receipt, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    main()
