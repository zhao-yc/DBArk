"""只读下载固定成功运行的归档，校验字节、摘要和每个 ZIP 成员的 CRC。"""

import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import urllib.request
import zipfile


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    """GitHub 下载重定向不向对象存储转发仓库令牌。"""

    def redirect_request(self, request, fp, code, message, headers, new_url):
        redirected = super().redirect_request(request, fp, code, message, headers, new_url)
        if redirected is not None:
            redirected.remove_header('Authorization')
        return redirected


def download(url):
    """仅请求已固定的 GitHub API；重定向地址不输出到日志。"""
    request = urllib.request.Request(url, headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=60) as response:
        return response.read(160 * 1024 * 1024 + 1)


def main():
    """只消费本次固定归档；不执行其中程序、不访问旧 VM 或清理其资源。"""
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/codex/v028-serial-closeout-20261019'
    run_id = 39244695054
    head = '4a2bcd423a26f5fe6fe094ee30656a58fb7d3035'
    repository = 'https://api.github.com/repos/zhao-yc/DBArk'
    root = Path('.cache/windows-success-readback-39244695054')
    root.mkdir(parents=True, exist_ok=False)
    records = []
    for artifact_id, kind, size, digest in [
        (12184037042, 'evidence', 5340007, 'd7eb06a765753b584d8e77a21dd4a42a40439338fc65892fafe95d3bfb435176'),
        (12184231827, 'candidate', 142818435, '066ec0ed921c59168800161d85d3e0cf6c0bcbe814069d1cf9d3df315b88746f'),
    ]:
        metadata = json.loads(download(f'{repository}/actions/artifacts/{artifact_id}'))
        assert metadata['id'] == artifact_id and not metadata['expired']
        assert metadata['workflow_run']['id'] == run_id
        assert metadata['workflow_run']['head_sha'] == head
        assert metadata['size_in_bytes'] == size and metadata['digest'] == 'sha256:' + digest
        raw = download(f'{repository}/actions/artifacts/{artifact_id}/zip')
        assert len(raw) == size and hashlib.sha256(raw).hexdigest() == digest
        with (root / f'{kind}.zip').open('xb') as target:
            target.write(raw)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            assert archive.testzip() is None, '归档成员 CRC 不匹配'
            names = archive.namelist()
            assert len(names) == len(set(names)) and len(names) < 20000
            members = []
            extracted = root / kind
            extracted.mkdir()
            for item in archive.infolist():
                name = PurePosixPath(item.filename)
                assert not name.is_absolute() and '..' not in name.parts
                assert '\\' not in item.filename and ':' not in item.filename
                assert not stat.S_ISLNK(item.external_attr >> 16)
                assert item.file_size <= 160 * 1024 * 1024
                if item.is_dir():
                    continue
                value = archive.read(item)
                target = extracted.joinpath(*name.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as output:
                    output.write(value)
                members.append({'path': item.filename, 'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest(), 'crc32': f'{item.CRC:08x}'})
        record = {'artifactId': artifact_id, 'kind': kind, 'zipBytes': len(raw), 'zipSha256': digest, 'allMemberCrcValidated': True, 'members': members}
        records.append(record)
        print('DBARK_SUCCESS_ARCHIVE:' + json.dumps(record, ensure_ascii=False, separators=(',', ':')))
    with (root / 'archive-receipt.json').open('x', encoding='utf-8') as output:
        json.dump({'originalRun': run_id, 'originalHead': head, 'archives': records, 'originalVmAccessed': False, 'archiveProgramsExecuted': False, 'oldSceneCleanupRequested': False, 'validationHost': 'GitHub-hosted Ubuntu', 'rootLocalZipValidated': False}, output, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
