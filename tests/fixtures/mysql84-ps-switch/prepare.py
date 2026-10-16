"""默认关闭的单实例只读准备器；没有stop/create/start/rename/delete执行入口。"""
import argparse
import copy
from dataclasses import dataclass, field
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import stat

OLD_ID = 'b07ab0cfa832f45b14b32a4befa4251b3bbb3aa6277261b3c8e779463f0b7052'
IMAGE = 'sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb'
VOLUME = '562de7fc2978429f1c6416df4bc5b981a01a2f09637e8d065da7ffe657c506a6'
NAME = 'dbark-p0-parameters-mysql84-01a13412'
NETWORK_NAME = 'dbark-p0-parameters-01a13412'
HOST, SOCKET, API = '192.168.31.200', '/var/run/docker.sock', '/v1.45'
LABEL = 'io.dbark.ps-switch.'
PORTS = {'3306/tcp': [{'HostIp': HOST, 'HostPort': '13384'}]}
CONFIRM = 'server-200/13384/read-only-ps-switch-review'
BLOCKERS = {'unsupported-config-shape', 'existing-volume-not-explicitly-bound', 'image-reference-not-fixed-id'}
ERRORS = set('missing-independent-host-proof local-host-mismatch machine-mismatch socket-mismatch private-ip-mismatch docker-read-rejected docker-read-too-large docker-read-unknown read-endpoint-not-allowed daemon-mismatch invalid-run original-identity-mismatch original-state-mismatch original-volume-mismatch volume-driver-unknown image-mismatch inventory-unknown inventory-identity-unknown inventory-incomplete inventory-volume-unknown name-not-exclusive published-port-not-exclusive volume-not-exclusive config-incomplete host-mode-mismatch host-privilege-or-volume-mode-unknown command-shape-unknown config-volume-or-env-shape-unknown labels-not-owned missing-explicit-parameters network-endpoints-unknown missing-network-proof network-identity-mismatch custom-network-ipam'.split())


class Blocked(RuntimeError):
    """只传固定错误码，不传播Docker响应、原Config或底层异常文本。"""


def require(value, code):
    if not value:
        raise Blocked(code)


@dataclass(frozen=True)
class HostIdentity:
    machine_sha256: str
    socket_dev: int
    socket_ino: int
    daemon: str

    def validate(self):
        require(re.fullmatch('[a-f0-9]{64}', self.machine_sha256) and self.socket_dev >= 0 and self.socket_ino > 0 and bool(self.daemon), 'missing-independent-host-proof')


def verify_local(expected):
    """每次HTTP前独立读本机事实；不使用DNS、环境自述、Docker context或外部命令。"""
    import fcntl
    import struct
    expected.validate()
    require(os.geteuid() == 0 and os.uname().sysname == 'Linux' and os.uname().machine == 'x86_64' and socket.gethostname() == 'Server-200', 'local-host-mismatch')
    actual = hashlib.sha256(Path('/etc/machine-id').read_bytes().strip()).hexdigest()
    require(actual == expected.machine_sha256, 'machine-mismatch')
    info = os.lstat(SOCKET)
    require(stat.S_ISSOCK(info.st_mode) and info.st_uid == 0 and (info.st_dev, info.st_ino) == (expected.socket_dev, expected.socket_ino), 'socket-mismatch')
    addresses = set()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        for _, name in socket.if_nameindex():
            try:
                data = fcntl.ioctl(probe.fileno(), 0x8915, struct.pack('256s', name.encode()[:15]))
                addresses.add(socket.inet_ntoa(data[20:24]))
            except OSError:
                continue
    require(HOST in addresses, 'private-ip-mismatch')


class UnixHttp(http.client.HTTPConnection):
    """显式Unix socket；不支持TCP、代理、认证配置或第三方Docker依赖。"""
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(SOCKET)


class ReadOnlyDocker:
    def __init__(self, identity, host_check=verify_local, connection=UnixHttp, network_id=None):
        identity.validate()
        self.identity, self.host_check, self.connection = identity, host_check, connection
        require(network_id is None or re.fullmatch('[a-f0-9]{64}', network_id), 'missing-network-proof')
        self.network_id = network_id

    def _get(self, path):
        # 初次info也通过独立宿主门；HTTP方法被固定，调用者不能传入写操作。
        self.host_check(self.identity)
        conn = self.connection('localhost', timeout=15)
        try:
            conn.request('GET', API + path, headers={'Accept': 'application/json'})
            response = conn.getresponse()
            require(response.status == 200, 'docker-read-rejected')
            raw = response.read(8 * 1024 * 1024 + 1)
            require(len(raw) <= 8 * 1024 * 1024, 'docker-read-too-large')
            return json.loads(raw)
        except Blocked:
            raise
        except Exception:
            raise Blocked('docker-read-unknown') from None
        finally:
            try:
                conn.close()
            except Exception:
                raise Blocked('docker-read-unknown') from None

    def get(self, path):
        allowed = {'/info', '/containers/json?all=1', '/containers/' + OLD_ID + '/json', '/images/' + IMAGE + '/json', '/volumes/' + VOLUME}
        if self.network_id:
            allowed.add('/networks/' + self.network_id)
        require(path in allowed, 'read-endpoint-not-allowed')
        info = self._get('/info')
        require(isinstance(info, dict) and info.get('ID') == self.identity.daemon and info.get('Name') == 'Server-200' and info.get('OSType') == 'linux' and info.get('Architecture') == 'x86_64', 'daemon-mismatch')
        return info if path == '/info' else self._get(path)


@dataclass(repr=False)
class Review:
    run: str
    network_id: str
    blockers: list
    # 包含Env的内存对象禁止repr/序列化；safe()只返回固定非秘密字段。
    draft: dict = field(repr=False)

    def safe(self):
        return {'version': 1, 'run': self.run, 'phase': 'blocked' if self.blockers else 'draft-reviewed-not-executable', 'oldId': OLD_ID, 'imageId': IMAGE, 'volume': VOLUME, 'networkId': self.network_id, 'networkName': NETWORK_NAME, 'blockers': self.blockers, 'readyForSwitch': False, 'mutationsImplemented': False, 'restartAuthorized': False, 'mdlVerified': False}


def prepare(original, inventory, volume, image, network, expected_network_id, run):
    """在内存核对创建保真边界；不补造Binds/HostConfig、不解析或打印Env值。"""
    require(re.fullmatch('[a-f0-9]{32}', run), 'invalid-run')
    require(re.fullmatch('[a-f0-9]{64}', expected_network_id), 'missing-network-proof')
    require(isinstance(original, dict) and original.get('Id') == OLD_ID and original.get('Name') == '/' + NAME and original.get('Image') == IMAGE, 'original-identity-mismatch')
    state = original.get('State', {})
    require(state.get('Running') is True and all(state.get(key) is False for key in ['Paused', 'Restarting', 'Dead']), 'original-state-mismatch')
    mounts = original.get('Mounts')
    require(isinstance(mounts, list) and len(mounts) == 1 and mounts[0].get('Type') == 'volume' and mounts[0].get('Name') == VOLUME and mounts[0].get('Destination') == '/var/lib/mysql' and mounts[0].get('RW') is True and mounts[0].get('Source') == '/var/lib/docker/volumes/' + VOLUME + '/_data', 'original-volume-mismatch')
    require(isinstance(volume, dict) and volume.get('Name') == VOLUME and volume.get('Driver') == 'local' and volume.get('Scope') == 'local' and not volume.get('Options') and volume.get('Mountpoint') == mounts[0]['Source'], 'volume-driver-unknown')
    require(isinstance(image, dict) and image.get('Id') == IMAGE and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64', 'image-mismatch')
    networking = original.get('NetworkSettings', {})
    require(networking.get('Ports') == {**PORTS, '33060/tcp': None} and isinstance(networking.get('Networks'), dict) and set(networking['Networks']) == {NETWORK_NAME}, 'network-endpoints-unknown')
    endpoint = networking['Networks'][NETWORK_NAME]
    require(isinstance(endpoint, dict) and endpoint.get('NetworkID') == expected_network_id and not any(endpoint.get(key) for key in ['IPAMConfig', 'Links', 'Aliases', 'DriverOpts', 'GlobalIPv6Address']), 'network-endpoints-unknown')
    require(isinstance(network, dict) and network.get('Id') == expected_network_id and network.get('Name') == NETWORK_NAME and network.get('Driver') == 'bridge' and network.get('Scope') == 'local', 'network-identity-mismatch')
    require(isinstance(network.get('IPAM'), dict) and network['IPAM'].get('Driver') == 'default' and not network['IPAM'].get('Options'), 'custom-network-ipam')
    require(isinstance(inventory, list) and 0 < len(inventory) <= 256, 'inventory-unknown')
    ids, users = set(), []
    for item in inventory:
        require(isinstance(item, dict) and isinstance(item.get('Id'), str) and re.fullmatch('[a-f0-9]{64}', item['Id']) and item['Id'] not in ids, 'inventory-identity-unknown')
        ids.add(item['Id'])
        require(isinstance(item.get('Mounts'), list) and isinstance(item.get('Ports'), list), 'inventory-incomplete')
        for mount in item['Mounts']:
            require(isinstance(mount, dict) and (mount.get('Type') != 'volume' or isinstance(mount.get('Name'), str) and mount['Name']), 'inventory-volume-unknown')
            if mount.get('Type') == 'volume' and mount['Name'] == VOLUME:
                users.append(item['Id'])
        if item['Id'] != OLD_ID:
            require('/' + NAME not in item.get('Names', []), 'name-not-exclusive')
            require(not any(port.get('PublicPort') == 13384 and port.get('IP') in [HOST, '0.0.0.0', '::', ''] for port in item['Ports']), 'published-port-not-exclusive')
    require(users == [OLD_ID], 'volume-not-exclusive')
    config, host = original.get('Config'), original.get('HostConfig')
    require(isinstance(config, dict) and isinstance(host, dict), 'config-incomplete')
    # 未经实机形态核实，不把复杂HostConfig当作可无损round-trip；未知字段即阻断。
    host_fields = {'Binds', 'Mounts', 'VolumesFrom', 'VolumeDriver', 'NetworkMode', 'PortBindings', 'RestartPolicy', 'AutoRemove', 'Privileged', 'ReadonlyRootfs', 'PublishAllPorts', 'Links', 'LogConfig', 'Memory', 'NanoCpus', 'CpuShares', 'ShmSize'}
    config_fields = {'Hostname', 'Domainname', 'User', 'AttachStdin', 'AttachStdout', 'AttachStderr', 'ExposedPorts', 'Tty', 'OpenStdin', 'StdinOnce', 'Env', 'Cmd', 'Image', 'Volumes', 'WorkingDir', 'Entrypoint', 'Labels', 'StopSignal', 'StopTimeout', 'Healthcheck'}
    blockers = []
    if set(host) - host_fields or set(config) - config_fields:
        blockers.append('unsupported-config-shape')
    require(host.get('RestartPolicy') == {'Name': 'no', 'MaximumRetryCount': 0} and host.get('PortBindings') == PORTS and host.get('NetworkMode') == NETWORK_NAME and host.get('Memory') == 805306368 and host.get('NanoCpus') == 1500000000, 'host-mode-mismatch')
    require(all(host.get(key) is False for key in ['AutoRemove', 'Privileged', 'ReadonlyRootfs', 'PublishAllPorts']) and not any(host.get(key) for key in ['Mounts', 'VolumesFrom', 'VolumeDriver', 'Links']), 'host-privilege-or-volume-mode-unknown')
    if host.get('Binds') != [VOLUME + ':/var/lib/mysql:rw']:
        blockers.append('existing-volume-not-explicitly-bound')
    if config.get('Image') != IMAGE:
        blockers.append('image-reference-not-fixed-id')
    command = config.get('Cmd')
    require(isinstance(command, list) and command and all(isinstance(value, str) for value in command) and command.count('--performance-schema=OFF') == 1 and all(not re.search('performance[-_]schema', value, re.IGNORECASE) or value == '--performance-schema=OFF' for value in command), 'command-shape-unknown')
    require(config.get('Volumes') == {'/var/lib/mysql': {}} and isinstance(config.get('Env'), list) and all(isinstance(value, str) for value in config['Env']), 'config-volume-or-env-shape-unknown')
    labels = config.get('Labels') or {}
    require(isinstance(labels, dict) and all(isinstance(key, str) and isinstance(value, str) for key, value in labels.items()) and not any(key.startswith(('com.docker.compose.', LABEL)) for key in labels), 'labels-not-owned')
    # 这里只形成草案，不代表API接受这些字段。真实配置未知时草案不得用于写请求。
    body = copy.deepcopy(config)
    body['Cmd'] = ['--performance-schema=ON' if value == '--performance-schema=OFF' else value for value in command]
    body['Labels'] = {**labels, LABEL + 'run': run, LABEL + 'source': OLD_ID}
    body['HostConfig'] = copy.deepcopy(host)
    return Review(run, expected_network_id, blockers, body)


def write_report(parent, run, report):
    """仅独占保存safe结果；已有文件/链接/非独占目录即拒绝，不保存草案或Env。"""
    allowed = {'version', 'run', 'phase', 'oldId', 'imageId', 'volume', 'networkId', 'networkName', 'blockers', 'readyForSwitch', 'mutationsImplemented', 'restartAuthorized', 'mdlVerified', 'code'}
    require(isinstance(report, dict) and set(report) <= allowed and report.get('version') == 1 and re.fullmatch('[a-f0-9]{32}', run) and report.get('run') == run and report.get('oldId') == OLD_ID and report.get('mutationsImplemented') is False, 'unsafe-report')
    require(report.get('phase') in ['blocked', 'draft-reviewed-not-executable', 'preflight-failed', 'preflight-unknown'] and report.get('imageId', IMAGE) == IMAGE and report.get('volume', VOLUME) == VOLUME and set(report.get('blockers', [])) <= BLOCKERS and report.get('code', 'docker-read-unknown') in ERRORS and all(report.get(key, False) is False for key in ['readyForSwitch', 'restartAuthorized', 'mdlVerified']), 'unsafe-report')
    require(report.get('networkName', NETWORK_NAME) == NETWORK_NAME and re.fullmatch('[a-f0-9]{64}', report.get('networkId', '0' * 64)), 'unsafe-report')
    parent = Path(parent)
    require(parent.is_absolute() and parent.name == 'dbark-ps-switch-' + run, 'report-directory-mismatch')
    info = parent.lstat()
    require(stat.S_ISDIR(info.st_mode) and parent.resolve() == parent and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700, 'report-directory-not-private')
    payload = (json.dumps(report, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    fd = os.open(parent / 'preflight.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        raise Blocked('report-write-unknown') from None


def main(argv=None):
    """默认关闭，未来ROOT单独批准后也只执行GET；不提供切换执行开关。"""
    parser = argparse.ArgumentParser(description='默认关闭的13384只读切换准备；不是重启执行器')
    parser.add_argument('--root-approved-readonly', action='store_true')
    parser.add_argument('--root-confirm')
    parser.add_argument('--machine-sha256')
    parser.add_argument('--socket-dev', type=int)
    parser.add_argument('--socket-ino', type=int)
    parser.add_argument('--daemon')
    parser.add_argument('--network-id')
    parser.add_argument('--run')
    parser.add_argument('--report-parent')
    args = parser.parse_args(argv)
    if not args.root_approved_readonly or args.root_confirm != CONFIRM:
        return 64
    try:
        require(all(value is not None for value in [args.machine_sha256, args.socket_dev, args.socket_ino, args.daemon, args.network_id, args.run, args.report_parent]), 'missing-explicit-parameters')
        # 禁用核心转储，防止未来只读inspect得到的Env落入故障转储文件。
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        api = ReadOnlyDocker(HostIdentity(args.machine_sha256, args.socket_dev, args.socket_ino, args.daemon), network_id=args.network_id)
        original = api.get('/containers/' + OLD_ID + '/json')
        review = prepare(original, api.get('/containers/json?all=1'), api.get('/volumes/' + VOLUME), api.get('/images/' + IMAGE + '/json'), api.get('/networks/' + args.network_id), args.network_id, args.run)
        safe = review.safe()
    except Blocked as error:
        safe = {'version': 1, 'run': args.run, 'phase': 'preflight-failed', 'oldId': OLD_ID, 'code': str(error) if str(error) in ERRORS else 'docker-read-unknown', 'mutationsImplemented': False}
    except Exception:
        safe = {'version': 1, 'run': args.run, 'phase': 'preflight-unknown', 'oldId': OLD_ID, 'mutationsImplemented': False}
    try:
        write_report(args.report_parent, args.run, safe)
    except Exception:
        print(json.dumps({'version': 1, 'phase': 'report-not-written', 'oldId': OLD_ID, 'mutationsImplemented': False}))
        return 3
    return 2 if safe['phase'] != 'draft-reviewed-not-executable' else 0


if __name__ == '__main__':
    raise SystemExit(main())
