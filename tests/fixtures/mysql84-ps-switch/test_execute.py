"""执行正式状态机和HTTP适配器；宿主、HTTP、DB证明、时间和磁盘全为内存端口。"""
import copy
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
for name, filename in [('prepare', 'prepare.py'), ('ps_execute', 'execute.py')]:
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    value = importlib.util.module_from_spec(spec); sys.modules[name] = value; spec.loader.exec_module(value)
module = sys.modules['ps_execute']; base = sys.modules['prepare']
RUN, NEW, SECRET, NOW = 'a' * 32, 'c' * 64, 'SYNTHETIC_PRIVATE_MARKER', 1000.0


def sample():
    host = {key: None for key in module.NULL_FIELDS}
    host.update({key: '' for key in module.EMPTY_FIELDS}); host.update({key: 0 for key in module.ZERO_FIELDS})
    host.update({key: [] for key in module.LIST_FIELDS}); host.update({key: False for key in module.FALSE_FIELDS})
    host.update({'LogConfig': {'Type': 'json-file', 'Config': {}}, 'NetworkMode': base.NETWORK_NAME, 'PortBindings': copy.deepcopy(base.PORTS), 'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}, 'ConsoleSize': [0, 0], 'CgroupnsMode': 'private', 'IpcMode': 'private', 'ShmSize': 67108864, 'Runtime': 'runc', 'Memory': module.MEMORY, 'NanoCpus': module.CPU, 'MemorySwap': module.MEMORY * 2, 'MaskedPaths': ['/proc/synthetic' + str(i) for i in range(16)], 'ReadonlyPaths': ['/proc/readonly' + str(i) for i in range(5)]})
    config = {'Hostname': base.OLD_ID[:12], 'Domainname': '', 'User': '', 'AttachStdin': False, 'AttachStdout': False, 'AttachStderr': False, 'ExposedPorts': {'3306/tcp': {}, '33060/tcp': {}}, 'Tty': False, 'OpenStdin': False, 'StdinOnce': False, 'Env': ['KEY' + str(i) + '=' + SECRET for i in range(9)], 'Cmd': ['--performance-schema=OFF', '--max-connections=40', '--synthetic=' + SECRET, '--synthetic-a=1', '--synthetic-b=2'], 'Image': 'mysql:8.4', 'Volumes': {'/var/lib/mysql': {}}, 'WorkingDir': '/synthetic', 'Entrypoint': ['docker-entrypoint.sh'], 'Labels': {'synthetic.one': SECRET, 'synthetic.two': 'value'}}
    mount = {'Type': 'volume', 'Name': base.VOLUME, 'Driver': 'local', 'Source': '/var/lib/docker/volumes/' + base.VOLUME + '/_data', 'Destination': '/var/lib/mysql', 'RW': True}
    original = {'Id': base.OLD_ID, 'Name': '/' + base.NAME, 'Image': base.IMAGE, 'Config': config, 'HostConfig': host, 'Mounts': [mount], 'State': {'Running': True, 'Paused': False, 'Restarting': False, 'Dead': False, 'OOMKilled': False, 'ExitCode': 0}, 'NetworkSettings': {'Ports': {**copy.deepcopy(base.PORTS), '33060/tcp': None}, 'Networks': {base.NETWORK_NAME: {'NetworkID': module.NETWORK_ID, 'IPAMConfig': None, 'Links': None, 'Aliases': None, 'DriverOpts': None, 'DNSNames': [base.NAME, base.OLD_ID[:12]], 'IPAddress': '172.31.0.2', 'EndpointID': 'e' * 64}}}}
    volume = {'Name': base.VOLUME, 'Driver': 'local', 'Scope': 'local', 'Options': None, 'Mountpoint': mount['Source']}
    image = {'Id': base.IMAGE, 'Os': 'linux', 'Architecture': 'amd64'}
    network = {'Id': module.NETWORK_ID, 'Name': base.NETWORK_NAME, 'Driver': 'bridge', 'Scope': 'local', 'Internal': False, 'IPAM': {'Driver': 'default', 'Options': None}}
    proof = {'version': 1, 'run': RUN, 'checkedAt': NOW, 'oldId': base.OLD_ID, 'imageId': base.IMAGE, 'volume': base.VOLUME, 'networkId': module.NETWORK_ID, 'serverUuid': module.UUID, 'mysqlVersion': '8.4.11', 'performanceSchema': 0, 'readOnly': 0, 'superReadOnly': 0, 'otherApplicationConnections': 0, 'transactions': 0, 'nonSystemSchemas': [], 'maxConnections': 40, 'memoryAvailableBytes': 3 * 1024**3}
    return original, volume, image, network, proof


class MemoryJournal(module.JournalCore):
    def __init__(self, run, trace):
        super().__init__(run, lambda: NOW); self.rows, self.trace, self.fail_phase = [], trace, None
    def append(self, row):
        if row.get('phase') == self.fail_phase and not row.get('event'): raise OSError(SECRET)
        self.rows.append(copy.deepcopy(row)); self.trace.append(('durable', row.get('phase'), row.get('event')))


class Backend:
    """合成Docker响应只修改内存；故障可发生在写已生效后，以检验未知结果不重放。"""
    def __init__(self):
        self.old, self.volume, self.image, self.network, self.proof = sample()
        self.new, self.trace, self.journal, self.posts, self.permits = None, [], None, [], []
        self.fail_write = None; self.mutate_new = None; self.before_start = None; self.warning = False; self.bad_create_id = False
        self.bad_write_status = None
        self.daemon, self.host_fail_at, self.host_count, self.memory = 'synthetic-daemon', 0, 0, 3 * 1024**3
    def inventory(self):
        return [{'Id': c['Id'], 'Names': [c['Name']], 'Mounts': copy.deepcopy(c['Mounts']), 'Ports': [{'IP': base.HOST, 'PublicPort': 13384}] if c['State']['Running'] else []} for c in [self.old, self.new] if c]
    def host(self, _identity):
        self.host_count += 1; self.trace.append(('host',))
        if self.host_count == self.host_fail_at: raise OSError(SECRET)
    def factory(self, run):
        self.journal = MemoryJournal(run, self.trace); return self.journal
    def api(self):
        backend = self
        class Connection:
            def __init__(self, *_args, **_kwargs): self.result = None
            def set_debuglevel(self, value): assert value == 0
            def request(self, method, path, body=None, **_kwargs):
                assert backend.trace[-1] == ('host',)
                backend.trace.append(('http', method, path)); short = path[len(base.API):]
                if method == 'GET':
                    if short == '/info': self.result = {'ID': backend.daemon, 'Name': 'Server-200', 'OSType': 'linux', 'Architecture': 'x86_64'}
                    elif short == '/containers/' + base.OLD_ID + '/json': self.result = copy.deepcopy(backend.old)
                    elif short == '/containers/' + NEW + '/json': self.result = copy.deepcopy(backend.new)
                    elif short == '/volumes/' + base.VOLUME: self.result = copy.deepcopy(backend.volume)
                    elif short == '/images/' + base.IMAGE + '/json': self.result = copy.deepcopy(backend.image)
                    elif short == '/networks/' + module.NETWORK_ID: self.result = copy.deepcopy(backend.network)
                    elif short == '/containers/json?all=1': self.result = backend.inventory()
                    else: raise AssertionError('不应请求其他路径')
                else:
                    assert method == 'POST'; backend.posts.append(short)
                    expected = ['stop-attempted', 'rename-attempted', 'create-attempted', 'start-attempted'][len(backend.posts) - 1]
                    assert backend.journal.rows[-1]['phase'] == expected
                    if len(backend.posts) == 1:
                        backend.old['State']['Running'] = False; backend.old['NetworkSettings']['Ports'] = {}
                    elif len(backend.posts) == 2:
                        backend.old['Name'] = '/dbark-ps-old-' + RUN
                        backend.old['NetworkSettings']['Networks'][base.NETWORK_NAME]['DNSNames'] = ['dbark-ps-old-' + RUN, base.OLD_ID[:12]]
                    elif len(backend.posts) == 3:
                        payload = json.loads(body); config = {k: v for k, v in payload.items() if k not in ['HostConfig', 'NetworkingConfig']}
                        backend.new = {'Id': NEW, 'Name': '/' + base.NAME, 'Image': base.IMAGE, 'Config': config, 'HostConfig': payload['HostConfig'], 'Mounts': copy.deepcopy(backend.old['Mounts']), 'State': {'Running': False, 'Paused': False, 'Restarting': False, 'Dead': False, 'OOMKilled': False, 'ExitCode': 0}, 'NetworkSettings': {'Ports': {}, 'Networks': {}}}
                        assert payload['NetworkingConfig'] == {'EndpointsConfig': {module.NETWORK_ID: {}}}
                        if backend.mutate_new: backend.mutate_new(backend.new)
                        self.result = {'Id': 'bad' if backend.bad_create_id else NEW, 'Warnings': [SECRET] if backend.warning else []}
                    elif len(backend.posts) == 4:
                        if backend.before_start: backend.before_start(backend)
                        backend.new['State']['Running'] = True
                        backend.new['NetworkSettings'] = {'Ports': {**copy.deepcopy(base.PORTS), '33060/tcp': None}, 'Networks': {base.NETWORK_NAME: {'NetworkID': module.NETWORK_ID, 'IPAMConfig': None, 'Links': None, 'Aliases': None, 'DriverOpts': None, 'DNSNames': [base.NAME, NEW[:12]], 'IPAddress': '172.31.0.3', 'EndpointID': 'd' * 64}}}
                    if len(backend.posts) == backend.fail_write: raise OSError(SECRET)
            def getresponse(self):
                raw = json.dumps(self.result).encode() if self.result is not None else b''
                if backend.trace[-1][1] == 'POST' and len(backend.posts) == backend.bad_write_status:
                    return SimpleNamespace(status=500, read=lambda _limit: SECRET.encode())
                return SimpleNamespace(status=201 if self.result is not None and isinstance(self.result, dict) and 'Id' in self.result and len(backend.posts) == 3 and self.result.keys() <= {'Id', 'Warnings'} else 204 if backend.trace[-1][1] == 'POST' else 200, read=lambda _limit: raw)
            def close(self): pass
        class TracedDocker(module.Docker):
            def request(self, method, path, body=None, permit=None):
                if method == 'POST': backend.permits.append((permit, path))
                return super().request(method, path, body, permit)
        return TracedDocker(base.HostIdentity('a' * 64, 1, 2, 'synthetic-daemon'), RUN, self.host, Connection, lambda: self.memory)
    def run(self): return module.switch(self.api(), self.proof, RUN, self.factory, lambda: NOW)


class Execution(unittest.TestCase):
    def test_success_exact_four_once_intents_and_only_approved_differences(self):
        backend = Backend(); original = copy.deepcopy(backend.old); result = backend.run()
        self.assertEqual(len(module.HOST_FIELDS), 63); self.assertEqual(len(backend.posts), 4)
        self.assertEqual([row['phase'] for row in backend.journal.rows], module.PHASES)
        self.assertEqual(result['phase'], 'started-unverified'); self.assertFalse(result['databaseVerified']); self.assertFalse(result['mdlVerified'])
        self.assertEqual(backend.old['Config'], original['Config']); self.assertEqual(backend.old['HostConfig'], original['HostConfig']); self.assertFalse(backend.old['State']['Running'])
        self.assertEqual(backend.new['Config']['Env'], original['Config']['Env']); self.assertEqual(backend.new['Config']['Cmd'][1:], original['Config']['Cmd'][1:]); self.assertEqual(backend.new['Config']['Cmd'][0], '--performance-schema=ON')
        self.assertEqual(backend.new['HostConfig']['Binds'], [base.VOLUME + ':/var/lib/mysql:rw']); self.assertEqual(backend.new['HostConfig']['NetworkMode'], module.NETWORK_ID)
        config = copy.deepcopy(backend.new['Config']); config['Image'] = original['Config']['Image']; config['Cmd'][0] = '--performance-schema=OFF'
        config['Labels'] = {key: value for key, value in config['Labels'].items() if not key.startswith(base.LABEL)}
        self.assertEqual(config, original['Config'])
        host = copy.deepcopy(backend.new['HostConfig']); host['Binds'] = None; host['NetworkMode'] = base.NETWORK_NAME
        self.assertEqual(host, original['HostConfig'])
        self.assertEqual(backend.new['Mounts'], original['Mounts']); self.assertEqual(len(backend.inventory()), 2)
        self.assertNotIn(SECRET, json.dumps(backend.journal.rows) + json.dumps(result))
        requests = [row for row in backend.trace if row[0] == 'http']; self.assertTrue(all(row[1] in ['GET', 'POST'] for row in requests))
        self.assertFalse(any('/delete' in row[2] or '/kill' in row[2] or '/restart' in row[2] or 'volumes/create' in row[2] for row in requests))
        for index, row in enumerate(backend.trace):
            if row[0] == 'http': self.assertEqual(backend.trace[index - 1], ('host',))

    def test_unknown_each_write_keeps_attempt_phase_and_never_rolls_back_or_replays(self):
        expected = ['stop-attempted', 'rename-attempted', 'create-attempted', 'start-attempted']
        for number in range(1, 5):
            backend = Backend(); backend.fail_write = number; api = backend.api()
            with self.subTest(write=number), self.assertRaises(module.Abort) as caught: module.switch(api, backend.proof, RUN, backend.factory, lambda: NOW)
            self.assertEqual(caught.exception.code, 'write-outcome-unknown'); self.assertNotIn(SECRET, str(caught.exception))
            self.assertEqual(len(backend.posts), number); self.assertEqual(backend.journal.phase, expected[number - 1]); self.assertTrue(backend.journal.halted)
            if number == 3: self.assertIsNone(backend.journal.new_id); self.assertIsNotNone(backend.new)
            permit, path = backend.permits[-1]
            with self.assertRaises(module.Abort): api.request('POST', path, permit=permit)
            self.assertEqual(len(backend.posts), number); self.assertNotIn(SECRET, json.dumps(backend.journal.rows))

    def test_stopped_null_ports_and_only_generated_dns_are_operational_not_copied(self):
        backend = Backend(); original_api = backend.api(); original_get = original_api.get
        backend.mutate_new = lambda value: value['NetworkSettings'].update(Ports=None)
        def observed(path):
            result = original_get(path)
            if path == '/containers/' + base.OLD_ID + '/json' and not result['State']['Running']:
                result['NetworkSettings']['Ports'] = None
                result['NetworkSettings']['Networks'][base.NETWORK_NAME]['DNSNames'] = [base.NAME, base.OLD_ID[:12]]
            if path == '/containers/' + NEW + '/json' and result['State']['Running']:
                result['NetworkSettings']['Networks'][base.NETWORK_NAME]['DNSNames'].append(result['Config']['Hostname'])
            return result
        original_api.get = observed
        result = module.switch(original_api, backend.proof, RUN, backend.factory, lambda: NOW)
        self.assertEqual(result['phase'], 'started-unverified'); self.assertEqual(len(backend.posts), 4)

    def test_non_durable_each_intent_never_sends_corresponding_write(self):
        for count, phase in enumerate(['stop-attempted', 'rename-attempted', 'create-attempted', 'start-attempted']):
            backend = Backend()
            def factory(run):
                journal = backend.factory(run); journal.fail_phase = phase; return journal
            with self.subTest(phase=phase), self.assertRaises(module.Abort): module.switch(backend.api(), backend.proof, RUN, factory, lambda: NOW)
            self.assertEqual(len(backend.posts), count)

    def test_unknown_fields_and_dangerous_modes_fail_before_first_intent(self):
        variants = [('FutureNonDefault', SECRET), ('FutureDefault', None)]
        for field, value in variants:
            backend = Backend(); backend.old['HostConfig'][field] = value
            with self.assertRaises(module.Abort) as caught: backend.run()
            self.assertEqual(caught.exception.fields, ('HostConfig.' + field,)); self.assertNotIn(SECRET, str(caught.exception)); self.assertEqual(backend.posts, [])
        for key, value in [('Privileged', True), ('AutoRemove', True), ('NetworkMode', 'bridge'), ('NetworkMode', 'host'), ('IpcMode', 'host'), ('Memory', 0), ('NanoCpus', 0), ('Binds', ['/other:/var/lib/mysql']), ('Devices', [{}])]:
            backend = Backend(); backend.old['HostConfig'][key] = value
            with self.subTest(key=key), self.assertRaises(module.Abort): backend.run()
            self.assertEqual(backend.posts, [])

    def test_static_network_alias_identity_and_resource_changes_reject(self):
        for kind in ['static-ip', 'alias', 'dns', 'network-id', 'custom-ipam', 'second-volume', 'wrong-image', 'nonexclusive-volume']:
            backend = Backend(); endpoint = backend.old['NetworkSettings']['Networks'][base.NETWORK_NAME]
            if kind == 'static-ip': endpoint['IPAMConfig'] = {'IPv4Address': '172.31.0.2'}
            if kind == 'alias': endpoint['Aliases'] = ['custom']
            if kind == 'dns': endpoint['DNSNames'] = ['custom']
            if kind == 'network-id': endpoint['NetworkID'] = 'b' * 64
            if kind == 'custom-ipam': backend.network['IPAM']['Driver'] = 'custom'
            if kind == 'second-volume': backend.old['Mounts'].append(copy.deepcopy(backend.old['Mounts'][0]))
            if kind == 'wrong-image': backend.old['Image'] = 'sha256:' + 'b' * 64
            if kind == 'nonexclusive-volume': backend.inventory = lambda: [{'Id': base.OLD_ID, 'Names': ['/' + base.NAME], 'Mounts': backend.old['Mounts'], 'Ports': []}, {'Id': 'f' * 64, 'Names': ['/other'], 'Mounts': backend.old['Mounts'], 'Ports': []}]
            with self.subTest(kind=kind), self.assertRaises(module.Abort): backend.run()
            self.assertEqual(backend.posts, [])

    def test_new_config_or_env_or_host_or_mount_drift_blocks_start_and_keeps_new_id(self):
        mutations = [lambda value: value['Config']['Env'].append(SECRET), lambda value: value['HostConfig'].update(Privileged=True), lambda value: value['Mounts'][0].update(Name='other'), lambda value: value['Config']['Cmd'].append('--other')]
        for mutate in mutations:
            backend = Backend(); backend.mutate_new = mutate
            with self.subTest(mutate=mutations.index(mutate)), self.assertRaises(module.Abort): backend.run()
            self.assertEqual(len(backend.posts), 3); self.assertEqual(backend.journal.new_id, NEW); self.assertFalse(backend.old['State']['Running']); self.assertFalse(backend.new['State']['Running'])

    def test_warning_or_invalid_create_id_never_starts_or_adopts_unknown_id(self):
        for kind in ['warning', 'bad-id']:
            backend = Backend(); backend.warning = kind == 'warning'; backend.bad_create_id = kind == 'bad-id'
            with self.subTest(kind=kind), self.assertRaises(module.Abort): backend.run()
            self.assertEqual(len(backend.posts), 3); self.assertEqual(backend.journal.new_id, NEW if kind == 'warning' else None)
            self.assertNotIn(SECRET, json.dumps(backend.journal.rows))

    def test_write_error_status_does_not_expose_server_body_or_resume(self):
        for count in range(1, 5):
            backend = Backend(); backend.bad_write_status = count
            with self.subTest(write=count), self.assertRaises(module.Abort) as caught: backend.run()
            self.assertEqual(caught.exception.code, 'write-outcome-unknown'); self.assertEqual(len(backend.posts), count)
            self.assertNotIn(SECRET, str(caught.exception) + json.dumps(backend.journal.rows))

    def test_root_proof_freshness_quiescence_budget_and_exact_instance_required(self):
        for key, value in [('checkedAt', NOW - 61), ('checkedAt', NOW + 1), ('serverUuid', 'other'), ('performanceSchema', 1), ('readOnly', True), ('superReadOnly', 1), ('transactions', 1), ('otherApplicationConnections', 1), ('nonSystemSchemas', ['business']), ('memoryAvailableBytes', 1), ('maxConnections', 100), ('Env', SECRET)]:
            backend = Backend(); backend.proof[key] = value
            with self.subTest(key=key), self.assertRaises(module.Abort): backend.run()
            self.assertEqual(backend.trace, []); self.assertEqual(backend.posts, [])

    def test_host_daemon_and_fresh_memory_gate_before_write(self):
        for kind in ['host', 'daemon', 'memory']:
            backend = Backend()
            if kind == 'host': backend.host_fail_at = 1
            if kind == 'daemon': backend.daemon = 'other'
            if kind == 'memory': backend.memory = 1
            with self.subTest(kind=kind), self.assertRaises(module.Abort): backend.run()
            self.assertEqual(backend.posts, [])

    def test_no_write_without_single_use_matching_durable_permit(self):
        backend = Backend(); api = backend.api(); path = '/containers/' + base.OLD_ID + '/stop?signal=SIGTERM&t=-1'
        for method, location in [('POST', path), ('DELETE', '/containers/' + base.OLD_ID), ('POST', '/volumes/create')]:
            with self.assertRaises(module.Abort): api.request(method, location)
        with self.assertRaises(module.Abort): api.request('POST', path, body={'private': SECRET})
        self.assertEqual(backend.trace, [])
        journal = MemoryJournal(RUN, backend.trace); journal.mark('prepared')
        with self.assertRaises(module.Abort): journal.intent('stop-attempted', '/containers/create?name=' + base.NAME)
        self.assertEqual(journal.phase, 'prepared')

    def test_default_main_does_not_read_proof_host_or_api(self):
        with patch.object(module, 'private_parent', side_effect=AssertionError('不得访问文件')), patch.object(module, 'Docker', side_effect=AssertionError('不得请求API')):
            self.assertEqual(module.main([]), 64)
            self.assertEqual(module.main(['--execute-switch']), 64)

    def test_approved_cli_success_and_unknown_create_print_only_safe_phase(self):
        for failure in [None, 3]:
            backend = Backend(); backend.fail_write = failure; output = io.StringIO()
            args = ['--execute-switch', '--root-confirm', module.CONFIRM, '--machine-sha256', 'a' * 64, '--socket-dev', '1', '--socket-ino', '2', '--daemon', 'synthetic-daemon', '--run', RUN, '--state-parent', 'synthetic-parent']
            with patch.dict(sys.modules, {'resource': SimpleNamespace(RLIMIT_CORE=4, setrlimit=lambda *_args: None)}), patch.object(module, 'private_parent', return_value=Path('synthetic-parent')), patch.object(module, 'read_root_proof', return_value=backend.proof), patch.object(module, 'Docker', return_value=backend.api()), patch.object(module, 'DiskJournal', side_effect=lambda _parent, run: backend.factory(run)), patch.object(module.time, 'time', return_value=NOW), patch('sys.stdout', output):
                self.assertEqual(module.main(args), 2 if failure else 0)
            result = json.loads(output.getvalue()); self.assertNotIn(SECRET, output.getvalue()); self.assertFalse(result['mdlVerified'])
            self.assertEqual(result['phase'], 'create-attempted' if failure else 'started-unverified')


class DurableJournal(unittest.TestCase):
    def test_disk_flags_fsync_and_single_use_global_latch_with_fake_filesystem(self):
        parent = Path.cwd() / ('dbark-ps-switch-' + RUN); events, next_fd = [], [20]
        file_info = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=1, st_dev=1, st_ino=2)
        def metadata(path):
            return file_info if path.name == 'switch-state.jsonl' else SimpleNamespace(st_mode=stat.S_IFDIR | (0o700 if path == parent else 0o755), st_uid=0)
        def opened(path, flags, mode=0):
            events.append(('open', str(path), flags, mode)); next_fd[0] += 1; return next_fd[0]
        with patch.object(module.Path, 'resolve', autospec=True, side_effect=lambda path: path), patch.object(module.Path, 'lstat', autospec=True, side_effect=metadata), \
             patch.object(module.os, 'O_NOFOLLOW', 0x20000, create=True), patch.object(module.os, 'O_DIRECTORY', 0x10000, create=True), \
             patch.object(module.os, 'open', side_effect=opened), patch.object(module.os, 'write', side_effect=lambda fd, raw: (events.append(('write', fd, raw)), len(raw))[1]), \
             patch.object(module.os, 'fsync', side_effect=lambda fd: events.append(('fsync', fd))), patch.object(module.os, 'fstat', return_value=file_info), patch.object(module.os, 'close'):
            journal = module.DiskJournal(parent, RUN); journal.mark('prepared')
            permit = journal.intent('stop-attempted', '/containers/' + base.OLD_ID + '/stop?signal=SIGTERM&t=-1')
            self.assertEqual(events[-1][0], 'fsync'); self.assertFalse(permit.used)
            for row in [row for row in events if row[0] == 'open' and row[3] == 0o600]: self.assertTrue(row[2] & module.os.O_EXCL)
            raw = b''.join(row[2] for row in events if row[0] == 'write'); self.assertNotIn(SECRET.encode(), raw)
            self.assertEqual(json.loads(raw.splitlines()[-1])['phase'], 'stop-attempted')
            with patch.object(module.os, 'open', side_effect=FileExistsError(SECRET)):
                with self.assertRaises(module.Abort) as caught: module.DiskJournal(parent, RUN)
                self.assertEqual(caught.exception.code, 'existing-target-intent'); self.assertNotIn(SECRET, str(caught.exception))
            journal.close()

    def test_private_parent_and_proof_file_reject_links_permissions_and_extra_data(self):
        parent = Path.cwd() / ('dbark-ps-switch-' + RUN)
        for mode, uid in [(stat.S_IFDIR | 0o755, 0), (stat.S_IFDIR | 0o700, 1000), (stat.S_IFLNK | 0o700, 0)]:
            with patch.object(module.Path, 'resolve', return_value=parent), patch.object(module.Path, 'lstat', return_value=SimpleNamespace(st_mode=mode, st_uid=uid)):
                with self.assertRaises(module.Abort): module.private_parent(parent, RUN)
        for info in [SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=0, st_nlink=1), SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=2)]:
            with patch.object(module.os, 'O_NOFOLLOW', 0x20000, create=True), patch.object(module.os, 'open', return_value=1), patch.object(module.os, 'fstat', return_value=info), patch.object(module.os, 'read', side_effect=AssertionError('不得读文件')), patch.object(module.os, 'close'):
                with self.assertRaises(module.Abort): module.read_root_proof(parent)

    def test_replaced_state_file_prevents_new_intent_before_any_write(self):
        journal = module.DiskJournal.__new__(module.DiskJournal); module.JournalCore.__init__(journal, RUN, lambda: NOW)
        journal.parent, journal.fd, journal.inode = Path('synthetic'), 7, (1, 2)
        opened = SimpleNamespace(st_dev=1, st_ino=2)
        changed = SimpleNamespace(st_dev=1, st_ino=3, st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=1)
        with patch.object(module.Path, 'lstat', return_value=changed), patch.object(module.os, 'fstat', return_value=opened), patch.object(module.os, 'write', side_effect=AssertionError('不得写入')):
            with self.assertRaises(module.Abort): journal.mark('prepared')
        self.assertIsNone(journal.phase); self.assertEqual(journal.serial, 0)

    def test_state_schema_refuses_private_payload_before_any_filesystem_access(self):
        journal = module.DiskJournal.__new__(module.DiskJournal); module.JournalCore.__init__(journal, RUN, lambda: NOW)
        row = {**journal.safe(), 'phase': 'prepared', 'serial': 1, 'at': NOW}
        for change in [{'Config': {'Env': SECRET}}, {'code': SECRET}, {'phase': SECRET}, {'fields': [SECRET]}, {'newId': SECRET}]:
            with patch.object(module.Path, 'lstat', side_effect=AssertionError('不得访问文件')):
                with self.assertRaises(module.Abort) as caught: journal.append({**row, **change})
                self.assertEqual(caught.exception.code, 'state-event-unsafe')

    def test_abort_output_never_trusts_raw_error_as_code(self):
        self.assertEqual(str(module.Abort(SECRET)), 'unexpected-private-error')
        backend = Backend(); backend.mutate_new = lambda value: (_ for _ in ()).throw(ValueError(SECRET))
        with self.assertRaises(module.Abort): backend.run()
        self.assertNotIn(SECRET, json.dumps(backend.journal.rows))


if __name__ == '__main__': unittest.main()
