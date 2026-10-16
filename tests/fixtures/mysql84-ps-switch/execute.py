"""只供ROOT未来批准后在实际200运行；本次仅源码/内存测试，无自动恢复入口。"""
import argparse
import copy
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import re
import stat
import time

import prepare as base

NETWORK_ID = '6b82e79ed841a73099ceb5014b154bda91e56b0f888bbd49c94af362a1e702a0'
UUID = 'f568f70e-c730-11f1-8190-3e6c830dde01'
MEMORY, CPU = 805306368, 1500000000
CONFIRM = 'server-200/13384/ps-switch-off-to-on'
PURPOSE = 'dbark-single-ps-switch'
GLOBAL_INTENT = Path('/run/dbark-ps-switch-13384.intent.json')
_SEAL = object()

# run902已核实的63个字段；未知字段不丢弃或猜默认值，直接报告字段名。
NULL_FIELDS = set('Binds VolumesFrom CapAdd CapDrop Dns ExtraHosts GroupAdd Links SecurityOpt DeviceCgroupRules DeviceRequests MemorySwappiness OomKillDisable PidsLimit'.split())
EMPTY_FIELDS = set('ContainerIDFile VolumeDriver Cgroup PidMode UTSMode UsernsMode Isolation CgroupParent CpusetCpus CpusetMems'.split())
ZERO_FIELDS = set('OomScoreAdj CpuShares BlkioWeight CpuPeriod CpuQuota CpuRealtimePeriod CpuRealtimeRuntime MemoryReservation CpuCount CpuPercent IOMaximumIOps IOMaximumBandwidth'.split())
LIST_FIELDS = set('DnsOptions DnsSearch BlkioWeightDevice BlkioDeviceReadBps BlkioDeviceWriteBps BlkioDeviceReadIOps BlkioDeviceWriteIOps Devices Ulimits'.split())
FALSE_FIELDS = set('AutoRemove Privileged PublishAllPorts ReadonlyRootfs'.split())
SPECIAL_FIELDS = set('LogConfig NetworkMode PortBindings RestartPolicy ConsoleSize CgroupnsMode IpcMode ShmSize Runtime Memory NanoCpus MemorySwap MaskedPaths ReadonlyPaths'.split())
HOST_FIELDS = NULL_FIELDS | EMPTY_FIELDS | ZERO_FIELDS | LIST_FIELDS | FALSE_FIELDS | SPECIAL_FIELDS
CONFIG_FIELDS = set('Hostname Domainname User AttachStdin AttachStdout AttachStderr ExposedPorts Tty OpenStdin StdinOnce Env Cmd Image Volumes WorkingDir Entrypoint Labels'.split())
PHASES = ['prepared', 'stop-attempted', 'stopped', 'rename-attempted', 'renamed', 'create-attempted', 'create-identified', 'created-verified', 'start-attempted', 'started-unverified']
CODES = set('config-shape-unknown config-fields-unknown host-mode-unknown host-resource-unknown host-log-shape-unknown host-path-shape-unknown network-identity-mismatch custom-network-ipam network-endpoint-unknown custom-network-endpoint custom-network-dns effective-port-mismatch mount-count-unknown mount-identity-mismatch inventory-unknown inventory-identity-unknown inventory-incomplete inventory-mount-unknown name-not-exclusive port-not-exclusive volume-not-exclusive container-state-mismatch stop-not-graceful source-identity-mismatch volume-identity-mismatch image-identity-mismatch config-runtime-unknown config-mode-unknown config-env-shape-unknown config-command-unknown config-labels-unknown root-proof-stale root-proof-mismatch root-proof-budget intent-not-durable stage-order-invalid create-outcome-unknown invalid-run state-directory-invalid state-write-failed state-event-unsafe global-intent-directory-invalid existing-target-intent existing-run-state state-file-invalid state-file-replaced memory-observation-unknown write-outcome-unknown docker-read-rejected docker-read-too-large docker-read-unknown endpoint-not-allowed daemon-mismatch memory-budget-changed original-config-changed new-identity-mismatch new-config-mismatch new-host-config-mismatch create-warning-unknown unexpected-private-error root-proof-file-invalid missing-explicit-parameters'.split())


class Abort(RuntimeError):
    """固定错误码及字段名，不带配置值、SQL、响应正文或底层异常。"""
    def __init__(self, code, fields=()):
        self.code = code if code in CODES else 'unexpected-private-error'
        super().__init__(self.code)
        self.fields = tuple(sorted(name if re.fullmatch('[A-Za-z][A-Za-z0-9_.]{0,100}', name) else 'UnknownField' for name in fields))


def check(value, code, fields=()):
    """拒绝条件只返回受限错误码，不展开实际值。"""
    if not value:
        raise Abort(code, fields)


def shape(value, expected, prefix):
    """完整字段集合必须相同；只报告未知/缺失字段名。"""
    check(isinstance(value, dict), 'config-shape-unknown', [prefix])
    check(set(value) == expected, 'config-fields-unknown', [prefix + '.' + str(key) for key in set(value) ^ expected])


def validate_host(host):
    """只接受已知实际形态；保留非默认日志/路径等值，不将它们写入诊断。"""
    shape(host, HOST_FIELDS, 'HostConfig')
    for key in NULL_FIELDS: check(host[key] is None, 'host-mode-unknown', ['HostConfig.' + key])
    for key in EMPTY_FIELDS: check(host[key] == '' and type(host[key]) is str, 'host-mode-unknown', ['HostConfig.' + key])
    for key in ZERO_FIELDS: check(type(host[key]) is int and host[key] == 0, 'host-mode-unknown', ['HostConfig.' + key])
    for key in LIST_FIELDS: check(type(host[key]) is list and host[key] == [], 'host-mode-unknown', ['HostConfig.' + key])
    for key in FALSE_FIELDS: check(host[key] is False, 'host-mode-unknown', ['HostConfig.' + key])
    fixed = {'NetworkMode': base.NETWORK_NAME, 'PortBindings': base.PORTS, 'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}, 'ConsoleSize': [0, 0], 'CgroupnsMode': 'private', 'IpcMode': 'private', 'Runtime': 'runc', 'Memory': MEMORY, 'NanoCpus': CPU}
    for key, value in fixed.items(): check(type(host[key]) is type(value) and host[key] == value, 'host-mode-unknown', ['HostConfig.' + key])
    for key in ['ShmSize', 'MemorySwap']:
        check(type(host[key]) is int and (0 < host[key] <= MEMORY if key == 'ShmSize' else MEMORY <= host[key] <= 2 * MEMORY), 'host-resource-unknown', ['HostConfig.' + key])
    log = host['LogConfig']
    check(isinstance(log, dict) and set(log) == {'Type', 'Config'} and log['Type'] in ['json-file', 'local', 'none'] and isinstance(log['Config'], dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in log['Config'].items()), 'host-log-shape-unknown', ['HostConfig.LogConfig'])
    for key, count in [('MaskedPaths', 16), ('ReadonlyPaths', 5)]:
        check(isinstance(host[key], list) and len(host[key]) == count and all(isinstance(item, str) and item.startswith(('/proc/', '/sys/')) and '\0' not in item for item in host[key]), 'host-path-shape-unknown', ['HostConfig.' + key])


def validate_network(network):
    """核同一既有网络，不创建或猜测默认网络。"""
    check(isinstance(network, dict) and network.get('Id') == NETWORK_ID and network.get('Name') == base.NETWORK_NAME and network.get('Driver') == 'bridge' and network.get('Scope') == 'local' and network.get('Internal') is False, 'network-identity-mismatch')
    ipam = network.get('IPAM')
    check(isinstance(ipam, dict) and ipam.get('Driver') == 'default' and not ipam.get('Options'), 'custom-network-ipam')


def endpoint(container, *, running, required):
    """已有网络复用；不克隆动态IP/EndpointID/DNSNames，静态设置和自定义别名拒绝。"""
    settings = container.get('NetworkSettings', {}); networks = settings.get('Networks')
    check(isinstance(networks, dict), 'network-endpoint-unknown')
    ports = settings.get('Ports')
    check(ports == {**base.PORTS, '33060/tcp': None} if running else ports is None or ports == {**base.PORTS, '33060/tcp': None} or isinstance(ports, dict) and all(key in ['3306/tcp', '33060/tcp'] and value is None for key, value in ports.items()), 'effective-port-mismatch')
    if not required and not networks:
        return
    check(len(networks) == 1 and next(iter(networks)) in [base.NETWORK_NAME, NETWORK_ID], 'network-endpoint-unknown')
    value = next(iter(networks.values()))
    check(isinstance(value, dict) and value.get('NetworkID') in ([NETWORK_ID] if required else [NETWORK_ID, '']), 'network-endpoint-unknown')
    check(not any(value.get(key) for key in ['IPAMConfig', 'Links', 'DriverOpts', 'Aliases', 'GlobalIPv6Address']), 'custom-network-endpoint')
    names = value.get('DNSNames') or []
    allowed = {container['Id'], container['Id'][:12], container['Name'].lstrip('/'), container.get('Config', {}).get('Hostname')}
    if container['Id'] == base.OLD_ID: allowed.add(base.NAME)
    check(isinstance(names, list) and all(isinstance(name, str) and name in allowed for name in names), 'custom-network-dns')


def mount_identity(container):
    """实际挂载只准为原唯一local数据卷。"""
    mounts = container.get('Mounts')
    check(isinstance(mounts, list) and len(mounts) == 1, 'mount-count-unknown')
    value = mounts[0]
    check(isinstance(value, dict) and value.get('Type') == 'volume' and value.get('Name') == base.VOLUME and value.get('Driver') == 'local' and value.get('Destination') == '/var/lib/mysql' and value.get('Source') == '/var/lib/docker/volumes/' + base.VOLUME + '/_data' and value.get('RW') is True, 'mount-identity-mismatch')


def inventory_check(rows, volume_users, names):
    """含停止容器的摘要用于卷引用、名称及发布端口排他检查。"""
    check(isinstance(rows, list) and 0 < len(rows) <= 256, 'inventory-unknown')
    seen, references = set(), []
    for row in rows:
        check(isinstance(row, dict) and isinstance(row.get('Id'), str) and re.fullmatch('[a-f0-9]{64}', row['Id']) and row['Id'] not in seen, 'inventory-identity-unknown')
        seen.add(row['Id'])
        check(isinstance(row.get('Mounts'), list) and isinstance(row.get('Ports'), list) and isinstance(row.get('Names'), list), 'inventory-incomplete')
        for mount in row['Mounts']:
            check(isinstance(mount, dict) and (mount.get('Type') != 'volume' or isinstance(mount.get('Name'), str) and bool(mount['Name'])), 'inventory-mount-unknown')
            if mount.get('Type') == 'volume' and mount['Name'] == base.VOLUME: references.append(row['Id'])
        for name in names:
            if '/' + name in row['Names']: check(row['Id'] == names[name], 'name-not-exclusive')
        if row['Id'] not in volume_users:
            check(not any(port.get('PublicPort') == 13384 and port.get('IP') in [base.HOST, '0.0.0.0', '::', ''] for port in row['Ports']), 'port-not-exclusive')
    check(sorted(references) == sorted(volume_users), 'volume-not-exclusive')


def state_check(container, running, name):
    """正常停机与运行中分别核终态，不把OOM/异常退出当正常停止。"""
    state = container.get('State', {})
    check(container.get('Name') == '/' + name and container.get('Image') == base.IMAGE and state.get('Running') is running and all(state.get(key) is False for key in ['Paused', 'Restarting', 'Dead', 'OOMKilled']), 'container-state-mismatch')
    if not running: check(type(state.get('ExitCode')) is int and state['ExitCode'] == 0, 'stop-not-graceful')
    mount_identity(container)


@dataclass(repr=False)
class Plan:
    original: dict
    body: dict
    backup: str


def build_plan(original, volume, image, network, rows, run):
    """只在内存生成ROOT批准差异的请求，不输出原配置或摘要。"""
    check(re.fullmatch('[a-f0-9]{32}', run) and original.get('Id') == base.OLD_ID, 'source-identity-mismatch')
    state_check(original, True, base.NAME); endpoint(original, running=True, required=True)
    validate_network(network)
    check(volume.get('Name') == base.VOLUME and volume.get('Driver') == 'local' and volume.get('Scope') == 'local' and not volume.get('Options') and volume.get('Mountpoint') == original['Mounts'][0]['Source'], 'volume-identity-mismatch')
    check(image.get('Id') == base.IMAGE and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64', 'image-identity-mismatch')
    config, host = original.get('Config'), original.get('HostConfig')
    shape(config, CONFIG_FIELDS, 'Config'); validate_host(host)
    check(config['Image'] in ['mysql:8.4', base.IMAGE] and config['Entrypoint'] == ['docker-entrypoint.sh'] and config['Volumes'] == {'/var/lib/mysql': {}} and config['ExposedPorts'] == {'3306/tcp': {}, '33060/tcp': {}}, 'config-runtime-unknown')
    for key in ['Domainname', 'User']: check(config[key] == '', 'config-mode-unknown', ['Config.' + key])
    for key in ['AttachStdin', 'AttachStdout', 'AttachStderr', 'Tty', 'OpenStdin', 'StdinOnce']: check(config[key] is False, 'config-mode-unknown', ['Config.' + key])
    for key in ['Hostname', 'WorkingDir']: check(isinstance(config[key], str) and config[key] and '\0' not in config[key], 'config-mode-unknown', ['Config.' + key])
    env, command, labels = config['Env'], config['Cmd'], config['Labels']
    check(isinstance(env, list) and len(env) == 9 and all(isinstance(item, str) and '=' in item and '\0' not in item for item in env) and len({item.split('=', 1)[0] for item in env}) == len(env), 'config-env-shape-unknown')
    check(isinstance(command, list) and len(command) == 5 and all(isinstance(item, str) and '\0' not in item for item in command) and command.count('--performance-schema=OFF') == 1 and all(not re.search('performance[-_]schema', item, re.I) or item == '--performance-schema=OFF' for item in command), 'config-command-unknown')
    check(isinstance(labels, dict) and len(labels) == 2 and all(isinstance(k, str) and isinstance(v, str) for k, v in labels.items()) and not any(key.startswith(('com.docker.compose.', base.LABEL)) for key in labels), 'config-labels-unknown')
    backup = 'dbark-ps-old-' + run
    inventory_check(rows, [base.OLD_ID], {base.NAME: base.OLD_ID, backup: None})
    body = copy.deepcopy(config)
    body['Image'] = base.IMAGE
    body['Cmd'] = ['--performance-schema=ON' if item == '--performance-schema=OFF' else item for item in command]
    body['Labels'] = {**labels, base.LABEL + 'purpose': PURPOSE, base.LABEL + 'run': run, base.LABEL + 'source': base.OLD_ID}
    body['HostConfig'] = copy.deepcopy(host)
    body['HostConfig']['Binds'] = [base.VOLUME + ':/var/lib/mysql:rw']
    body['HostConfig']['NetworkMode'] = NETWORK_ID
    body['NetworkingConfig'] = {'EndpointsConfig': {NETWORK_ID: {}}}
    return Plan(copy.deepcopy(original), body, backup)


def proof_check(proof, run, now):
    """验证ROOT新鲜只读DB核定；不把它冒充本执行器独立SQL观察。"""
    fields = set('version run checkedAt oldId imageId volume networkId serverUuid mysqlVersion performanceSchema readOnly superReadOnly otherApplicationConnections transactions nonSystemSchemas maxConnections memoryAvailableBytes'.split())
    shape(proof, fields, 'RootProof')
    check(type(proof['version']) is int and proof['version'] == 1 and proof['run'] == run and type(proof['checkedAt']) in [int, float] and 0 <= now - proof['checkedAt'] <= 60, 'root-proof-stale')
    values = {'oldId': base.OLD_ID, 'imageId': base.IMAGE, 'volume': base.VOLUME, 'networkId': NETWORK_ID, 'serverUuid': UUID, 'mysqlVersion': '8.4.11', 'performanceSchema': 0, 'readOnly': 0, 'superReadOnly': 0, 'otherApplicationConnections': 0, 'transactions': 0, 'nonSystemSchemas': [], 'maxConnections': 40}
    for key, value in values.items(): check(type(proof[key]) is type(value) and proof[key] == value, 'root-proof-mismatch', ['RootProof.' + key])
    check(type(proof['memoryAvailableBytes']) is int and proof['memoryAvailableBytes'] >= 2 * MEMORY, 'root-proof-budget')


class _Permit:
    def __init__(self, seal, journal, phase, path):
        check(seal is _SEAL, 'intent-not-durable')
        self.journal, self.phase, self.path, self.serial, self.used = journal, phase, path, journal.serial, False

    def consume(self, run, path):
        """请求前即消费，任何后续失败都不能复用此凭据。"""
        check(not self.used and self.journal.run == run and self.phase == self.journal.phase and self.serial == self.journal.serial and self.path == path and not self.journal.halted, 'intent-not-durable')
        self.used = True


class JournalCore:
    """内存状态机和落盘实现共用；意图fsync成功后才发行一次写凭据。"""
    def __init__(self, run, clock=time.time):
        check(re.fullmatch('[a-f0-9]{32}', run), 'invalid-run')
        self.run, self.clock, self.phase, self.serial, self.new_id, self.halted = run, clock, None, 0, None, False

    def append(self, row):
        """由真实磁盘或纯测试内存端口实现，成功返回即代表持久边界。"""
        raise NotImplementedError

    def safe(self):
        """可输出/保存的非秘密状态，不含计划或配置对象。"""
        return {'version': 1, 'run': self.run, 'oldId': base.OLD_ID, 'newId': self.new_id, 'imageId': base.IMAGE, 'volume': base.VOLUME, 'networkId': NETWORK_ID, 'phase': self.phase, 'halted': self.halted, 'databaseVerified': False, 'mdlVerified': False}

    def validate_row(self, row):
        """磁盘发送门也拒绝未知字段/动态消息，防止误写Config或Env。"""
        allowed = set(self.safe()) | ({'at', 'event', 'code', 'fields'} if isinstance(row, dict) and 'event' in row else {'at', 'serial'})
        check(isinstance(row, dict) and set(row) == allowed and row.get('run') == self.run and type(row.get('version')) is int and row['version'] == 1 and row.get('oldId') == base.OLD_ID and row.get('imageId') == base.IMAGE and row.get('volume') == base.VOLUME and row.get('networkId') == NETWORK_ID, 'state-event-unsafe')
        check(row.get('phase') in PHASES or row.get('phase') is None and row.get('event') == 'halted', 'state-event-unsafe')
        check(row.get('newId') == self.new_id and (row.get('newId') is None or isinstance(row['newId'], str) and re.fullmatch('[a-f0-9]{64}', row['newId']) and row['newId'] != base.OLD_ID), 'state-event-unsafe')
        check(type(row.get('at')) in [int, float] and math.isfinite(row['at']) and type(row.get('halted')) is bool and row.get('databaseVerified') is False and row.get('mdlVerified') is False, 'state-event-unsafe')
        if 'serial' in row:
            next_phase = PHASES[0] if self.phase is None else PHASES[PHASES.index(self.phase) + 1] if self.phase != PHASES[-1] else None
            check(type(row['serial']) is int and row['serial'] == self.serial + 1 and row['phase'] == next_phase and row['halted'] is False, 'state-event-unsafe')
        if 'event' in row: check(row['event'] == 'halted' and row['phase'] == self.phase and row['halted'] is True and row.get('code') in CODES and isinstance(row.get('fields'), (list, tuple)) and all(name == 'UnknownField' or re.fullmatch(r'(Config|HostConfig|RootProof)\.[A-Za-z][A-Za-z0-9_]{0,63}', name) for name in row['fields']), 'state-event-unsafe')

    def mark(self, phase):
        """fsync成功后才推进序号与阶段；失败不得发行写凭据。"""
        check(not self.halted and phase in PHASES and (self.phase is None and phase == PHASES[0] or self.phase is not None and PHASES.index(phase) == PHASES.index(self.phase) + 1), 'stage-order-invalid')
        row = {**self.safe(), 'phase': phase, 'at': self.clock(), 'serial': self.serial + 1}
        self.validate_row(row)
        self.append(row)
        self.phase, self.serial = phase, self.serial + 1

    def intent(self, phase, path):
        """阶段、路径和run同时绑定到一次写凭据。"""
        paths = {'stop-attempted': '/containers/' + base.OLD_ID + '/stop?signal=SIGTERM&t=-1', 'rename-attempted': '/containers/' + base.OLD_ID + '/rename?name=dbark-ps-old-' + self.run, 'create-attempted': '/containers/create?name=' + base.NAME, 'start-attempted': '/containers/' + str(self.new_id) + '/start'}
        check(paths.get(phase) == path, 'intent-not-durable')
        self.mark(phase)
        return _Permit(_SEAL, self, phase, path)

    def identified(self, new_id):
        """仅从明确201响应登记合法完整new ID，不接管未知创建。"""
        check(self.phase == 'create-attempted' and isinstance(new_id, str) and re.fullmatch('[a-f0-9]{64}', new_id) and new_id != base.OLD_ID, 'create-outcome-unknown')
        self.new_id = new_id
        self.mark('create-identified')

    def halt(self, error):
        """永久停止本流程并保留最后意图，不执行任何恢复写。"""
        if self.halted: return
        self.halted = True
        row = {**self.safe(), 'event': 'halted', 'at': self.clock(), 'code': error.code, 'fields': error.fields}
        self.validate_row(row); self.append(row)


def private_parent(parent, run):
    """只接收ROOT独占目录，拒绝链接或借用宽权限路径。"""
    parent = Path(parent)
    check(parent.is_absolute() and parent.name == 'dbark-ps-switch-' + run and parent.resolve() == parent, 'state-directory-invalid')
    info = parent.lstat()
    check(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700, 'state-directory-invalid')
    return parent


def write_all(fd, raw):
    """处理短写，整条记录完成并fsync后才返回。"""
    while raw:
        amount = os.write(fd, raw)
        check(amount > 0, 'state-write-failed')
        raw = raw[amount:]
    os.fsync(fd)


def sync_directory(parent):
    """目录也fsync，避免意图文件名未持久时发送变更。"""
    fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


class DiskJournal(JournalCore):
    def __init__(self, parent, run):
        super().__init__(run)
        self.parent, self.fd = private_parent(parent, run), None
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        global_parent = GLOBAL_INTENT.parent.lstat()
        check(stat.S_ISDIR(global_parent.st_mode) and global_parent.st_uid == 0 and not stat.S_IMODE(global_parent.st_mode) & 0o022 and GLOBAL_INTENT.parent.resolve() == GLOBAL_INTENT.parent, 'global-intent-directory-invalid')
        # 不自动删除全局意图，即使启动前失败也须ROOT独立核定后处理。
        try: latch = os.open(GLOBAL_INTENT, flags, 0o600)
        except FileExistsError: raise Abort('existing-target-intent') from None
        try: write_all(latch, (json.dumps({'version': 1, 'run': run, 'oldId': base.OLD_ID, 'phase': 'owned'}) + '\n').encode())
        finally: os.close(latch)
        sync_directory(GLOBAL_INTENT.parent)
        try: self.fd = os.open(self.parent / 'switch-state.jsonl', flags | os.O_APPEND, 0o600)
        except FileExistsError: raise Abort('existing-run-state') from None
        info = os.fstat(self.fd)
        check(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, 'state-file-invalid')
        self.inode = (info.st_dev, info.st_ino)
        sync_directory(self.parent)

    def append(self, row):
        """追加前重核字段白名单及已打开inode，不重写旧状态。"""
        self.validate_row(row)
        current = (self.parent / 'switch-state.jsonl').lstat(); opened = os.fstat(self.fd)
        check((current.st_dev, current.st_ino) == self.inode == (opened.st_dev, opened.st_ino) and stat.S_ISREG(current.st_mode) and current.st_uid == 0 and current.st_nlink == 1 and stat.S_IMODE(current.st_mode) == 0o600, 'state-file-replaced')
        write_all(self.fd, (json.dumps(row, separators=(',', ':')) + '\n').encode())

    def close(self):
        """仅关闭句柄，绝不删除状态或全局意图。"""
        if self.fd is not None: os.close(self.fd); self.fd = None


def available_memory():
    """独立读取实际内核可用内存，不用环境自述或Docker静态总量。"""
    for row in Path('/proc/meminfo').read_text().splitlines():
        if row.startswith('MemAvailable:'):
            parts = row.split(); check(len(parts) == 3 and parts[2] == 'kB' and parts[1].isdigit(), 'memory-observation-unknown')
            return int(parts[1]) * 1024
    raise Abort('memory-observation-unknown')


class Docker:
    """显式Unix API，每个原始请求先核宿主；每个目标请求先另核info/daemon。"""
    def __init__(self, identity, run, host_check=base.verify_local, connection=base.UnixHttp, memory=available_memory):
        identity.validate()
        check(isinstance(run, str) and re.fullmatch('[a-f0-9]{32}', run), 'invalid-run')
        self.identity, self.run, self.host_check, self.connection, self.memory, self.new_id = identity, run, host_check, connection, memory, None

    def _raw(self, method, path, body=None, status=200):
        """私有body只在内存序列化给Unix API；禁用HTTP调试并脱敏异常。"""
        try:
            self.host_check(self.identity)
            conn = self.connection('localhost', timeout=15)
            try:
                conn.set_debuglevel(0)
                data = json.dumps(body, separators=(',', ':')).encode() if body is not None else None
                conn.request(method, base.API + path, body=data, headers={'Content-Type': 'application/json'})
                response = conn.getresponse()
                check(response.status == status, 'write-outcome-unknown' if method == 'POST' else 'docker-read-rejected')
                raw = response.read(8 * 1024 * 1024 + 1)
                check(len(raw) <= 8 * 1024 * 1024, 'write-outcome-unknown' if method == 'POST' else 'docker-read-too-large')
                return json.loads(raw) if raw else None
            finally: conn.close()
        except Abort: raise
        except Exception: raise Abort('write-outcome-unknown' if method == 'POST' else 'docker-read-unknown') from None

    def get(self, path):
        """只读入口也走同一宿主和daemon核对。"""
        return self.request('GET', path)

    def request(self, method, path, body=None, permit=None):
        """白名单端点及持久凭据通过后，才进行实际请求。"""
        reads = {'/info', '/containers/json?all=1', '/containers/' + base.OLD_ID + '/json', '/images/' + base.IMAGE + '/json', '/volumes/' + base.VOLUME, '/networks/' + NETWORK_ID}
        if self.new_id: reads.add('/containers/' + self.new_id + '/json')
        writes = {'/containers/' + base.OLD_ID + '/stop?signal=SIGTERM&t=-1', '/containers/' + base.OLD_ID + '/rename?name=dbark-ps-old-' + self.run, '/containers/create?name=' + base.NAME}
        if self.new_id: writes.add('/containers/' + self.new_id + '/start')
        check(method == 'GET' and path in reads and body is None or method == 'POST' and path in writes, 'endpoint-not-allowed')
        if method == 'POST':
            check(isinstance(body, dict) and set(body) == CONFIG_FIELDS | {'HostConfig', 'NetworkingConfig'} if path.startswith('/containers/create?') else body is None, 'endpoint-not-allowed')
            check(isinstance(permit, _Permit), 'intent-not-durable'); permit.consume(self.run, path)
        info = self._raw('GET', '/info')
        check(isinstance(info, dict) and info.get('ID') == self.identity.daemon and info.get('Name') == 'Server-200' and info.get('OSType') == 'linux' and info.get('Architecture') == 'x86_64', 'daemon-mismatch')
        if method == 'POST':
            available = self.memory()
            check(type(available) is int and available >= 2 * MEMORY, 'memory-budget-changed')
        return info if path == '/info' else self._raw(method, path, body, 201 if method == 'POST' and path.startswith('/containers/create?') else 204 if method == 'POST' else 200)


def owned_original(api, plan, name, running):
    """通过完整ID核原配置不变，不能按名称接管其他容器。"""
    current = api.get('/containers/' + base.OLD_ID + '/json')
    check(current.get('Id') == base.OLD_ID and current.get('Config') == plan.original['Config'] and current.get('HostConfig') == plan.original['HostConfig'], 'original-config-changed')
    state_check(current, running, name); endpoint(current, running=running, required=True)
    return current


def validate_created(current, plan, new_id, running):
    """新容器只容许已批准的配置差异；启动前后均核。"""
    check(current.get('Id') == new_id, 'new-identity-mismatch')
    state_check(current, running, base.NAME)
    config = {key: value for key, value in plan.body.items() if key not in ['HostConfig', 'NetworkingConfig']}
    check(current.get('Config') == config, 'new-config-mismatch')
    check(current.get('HostConfig') == plan.body['HostConfig'], 'new-host-config-mismatch')
    endpoint(current, running=running, required=running)


def shared_resources(api, ids, names):
    """每个关键阶段重新核原卷、原网络及已知引用集合。"""
    volume = api.get('/volumes/' + base.VOLUME)
    check(volume.get('Name') == base.VOLUME and volume.get('Driver') == 'local' and volume.get('Scope') == 'local' and not volume.get('Options') and volume.get('Mountpoint') == '/var/lib/docker/volumes/' + base.VOLUME + '/_data', 'volume-identity-mismatch')
    validate_network(api.get('/networks/' + NETWORK_ID))
    inventory_check(api.get('/containers/json?all=1'), ids, names)


def switch(api, proof, run, journal_factory, clock=None):
    """固定四次变更，所有意图先持久化；未知结果仅保留，不回滚/重放/删除。"""
    journal, clock = None, clock or time.time
    try:
        proof_check(proof, run, clock())
        original = api.get('/containers/' + base.OLD_ID + '/json')
        plan = build_plan(original, api.get('/volumes/' + base.VOLUME), api.get('/images/' + base.IMAGE + '/json'), api.get('/networks/' + NETWORK_ID), api.get('/containers/json?all=1'), run)
        journal = journal_factory(run); journal.mark('prepared')
        owned_original(api, plan, base.NAME, True)
        shared_resources(api, [base.OLD_ID], {base.NAME: base.OLD_ID, plan.backup: None})
        proof_check(proof, run, clock())
        path = '/containers/' + base.OLD_ID + '/stop?signal=SIGTERM&t=-1'
        api.request('POST', path, permit=journal.intent('stop-attempted', path))
        owned_original(api, plan, base.NAME, False); journal.mark('stopped')
        shared_resources(api, [base.OLD_ID], {base.NAME: base.OLD_ID, plan.backup: None})
        path = '/containers/' + base.OLD_ID + '/rename?name=' + plan.backup
        api.request('POST', path, permit=journal.intent('rename-attempted', path))
        owned_original(api, plan, plan.backup, False); journal.mark('renamed')
        shared_resources(api, [base.OLD_ID], {base.NAME: None, plan.backup: base.OLD_ID})
        path = '/containers/create?name=' + base.NAME
        result = api.request('POST', path, body=plan.body, permit=journal.intent('create-attempted', path))
        check(isinstance(result, dict), 'create-outcome-unknown')
        journal.identified(result.get('Id')); api.new_id = journal.new_id
        check(set(result) <= {'Id', 'Warnings'} and result.get('Warnings') in [None, []], 'create-warning-unknown')
        validate_created(api.get('/containers/' + journal.new_id + '/json'), plan, journal.new_id, False)
        owned_original(api, plan, plan.backup, False)
        shared_resources(api, [base.OLD_ID, journal.new_id], {base.NAME: journal.new_id, plan.backup: base.OLD_ID})
        journal.mark('created-verified')
        path = '/containers/' + journal.new_id + '/start'
        api.request('POST', path, permit=journal.intent('start-attempted', path))
        validate_created(api.get('/containers/' + journal.new_id + '/json'), plan, journal.new_id, True)
        owned_original(api, plan, plan.backup, False)
        shared_resources(api, [base.OLD_ID, journal.new_id], {base.NAME: journal.new_id, plan.backup: base.OLD_ID})
        journal.mark('started-unverified')
        return journal.safe()
    except Exception as error:
        safe = error if isinstance(error, Abort) else Abort('unexpected-private-error')
        if journal:
            try: journal.halt(safe)
            except Exception: pass  # 前一条已fsync的意图仍保留，输出不泄露次生异常。
        raise safe from None
    finally:
        if journal and hasattr(journal, 'close'): journal.close()


def read_root_proof(parent):
    """只读非秘密前置证明，拒绝链接、硬链或宽权限文件。"""
    fd = os.open(parent / 'root-preflight.json', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        check(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, 'root-proof-file-invalid')
        raw = os.read(fd, 8193); check(len(raw) <= 8192, 'root-proof-file-invalid')
        return json.loads(raw)
    finally: os.close(fd)


def main(argv=None):
    """默认关闭；输出只含安全阶段，不打印异常链或私有配置。"""
    parser = argparse.ArgumentParser(description='ROOT未来专用的默认关闭单实例切换；没有重放/删除/恢复入口')
    parser.add_argument('--execute-switch', action='store_true'); parser.add_argument('--root-confirm')
    parser.add_argument('--machine-sha256'); parser.add_argument('--socket-dev', type=int); parser.add_argument('--socket-ino', type=int); parser.add_argument('--daemon')
    parser.add_argument('--run'); parser.add_argument('--state-parent')
    args = parser.parse_args(argv)
    if not args.execute_switch or args.root_confirm != CONFIRM: return 64
    journal_ref = []
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        check(all(value is not None for value in [args.machine_sha256, args.socket_dev, args.socket_ino, args.daemon, args.run, args.state_parent]), 'missing-explicit-parameters')
        parent = private_parent(args.state_parent, args.run)
        proof = read_root_proof(parent)
        api = Docker(base.HostIdentity(args.machine_sha256, args.socket_dev, args.socket_ino, args.daemon), args.run)
        def factory(run):
            value = DiskJournal(parent, run); journal_ref.append(value); return value
        result = switch(api, proof, args.run, factory)
        print(json.dumps(result)); return 0
    except Exception as error:
        safe = error if isinstance(error, Abort) else Abort('unexpected-private-error')
        state = journal_ref[0].safe() if journal_ref else {'run': args.run if isinstance(args.run, str) and re.fullmatch('[a-f0-9]{32}', args.run) else None, 'oldId': base.OLD_ID, 'newId': None, 'phase': 'before-intent'}
        print(json.dumps({**state, 'code': safe.code, 'fields': safe.fields, 'databaseVerified': False, 'mdlVerified': False})); return 2


if __name__ == '__main__':
    raise SystemExit(main())
