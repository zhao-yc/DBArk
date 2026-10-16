"""只用合成Config和内存端口，不调用本机宿主检查、文件写入、网络或Docker。"""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import socket
import stat
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ps_prepare', Path(__file__).with_name('prepare.py'))
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
RUN = 'a' * 32
SECRET = 'SYNTHETIC_PRIVATE_MARKER'
NETWORK_ID = 'f' * 64


def sample():
    """仅构造可审计的简单形态；不声称run880真实HostConfig符合本合成形态。"""
    mount = {'Type': 'volume', 'Name': module.VOLUME, 'Source': '/var/lib/docker/volumes/' + module.VOLUME + '/_data', 'Destination': '/var/lib/mysql', 'RW': True}
    original = {'Id': module.OLD_ID, 'Name': '/' + module.NAME, 'Image': module.IMAGE,
                'State': {'Running': True, 'Paused': False, 'Restarting': False, 'Dead': False}, 'Mounts': [mount],
                'Config': {'Image': module.IMAGE, 'Cmd': ['--performance-schema=OFF', '--max-connections=40', '--synthetic-arg=' + SECRET, '--synthetic-other=1', '--synthetic-last=2'], 'Env': ['MYSQL_ROOT_PASSWORD=' + SECRET], 'Volumes': {'/var/lib/mysql': {}}, 'Labels': {'purpose': 'synthetic'}, 'Hostname': 'original-hostname', 'Entrypoint': ['docker-entrypoint.sh']},
                'HostConfig': {'Binds': [module.VOLUME + ':/var/lib/mysql:rw'], 'PortBindings': copy.deepcopy(module.PORTS), 'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}, 'NetworkMode': module.NETWORK_NAME, 'Memory': 805306368, 'NanoCpus': 1500000000, 'AutoRemove': False, 'Privileged': False, 'ReadonlyRootfs': False, 'PublishAllPorts': False},
                'NetworkSettings': {'Ports': {**copy.deepcopy(module.PORTS), '33060/tcp': None}, 'Networks': {module.NETWORK_NAME: {'NetworkID': NETWORK_ID, 'IPAMConfig': None, 'Links': None, 'Aliases': None, 'DriverOpts': None}}}}
    inventory = [{'Id': module.OLD_ID, 'Names': ['/' + module.NAME], 'Mounts': [copy.deepcopy(mount)], 'Ports': [{'IP': module.HOST, 'PublicPort': 13384, 'PrivatePort': 3306}]}]
    volume = {'Name': module.VOLUME, 'Driver': 'local', 'Scope': 'local', 'Options': None, 'Mountpoint': mount['Source']}
    image = {'Id': module.IMAGE, 'Os': 'linux', 'Architecture': 'amd64'}
    network = {'Id': NETWORK_ID, 'Name': module.NETWORK_NAME, 'Driver': 'bridge', 'Scope': 'local', 'IPAM': {'Driver': 'default', 'Options': None}}
    return original, inventory, volume, image, network, NETWORK_ID


class DraftPolicy(unittest.TestCase):
    def test_only_cmd_and_labels_change_and_env_stays_only_in_memory(self):
        args = sample(); before = copy.deepcopy(args)
        review = module.prepare(*args, RUN)
        self.assertEqual(review.blockers, [])
        self.assertEqual(review.draft['Cmd'].count('--performance-schema=ON'), 1)
        self.assertNotIn('--performance-schema=OFF', review.draft['Cmd'])
        self.assertEqual(review.draft['HostConfig'], args[0]['HostConfig'])
        changed = copy.deepcopy(review.draft); changed.pop('HostConfig')
        changed['Cmd'] = args[0]['Config']['Cmd']; changed['Labels'] = args[0]['Config']['Labels']
        self.assertEqual(changed, args[0]['Config']); self.assertEqual(args, before)
        self.assertEqual(review.draft['Env'], ['MYSQL_ROOT_PASSWORD=' + SECRET])
        self.assertEqual(review.draft['Cmd'][1:], args[0]['Config']['Cmd'][1:])
        self.assertEqual(review.safe()['networkId'], NETWORK_ID)
        self.assertNotIn(SECRET, json.dumps(review.safe()) + repr(review))
        self.assertFalse(review.safe()['restartAuthorized']); self.assertFalse(review.safe()['mutationsImplemented'])
        self.assertFalse(review.safe()['readyForSwitch'])

    def test_anonymous_volume_does_not_imply_reusable_bind_and_tag_is_not_id(self):
        args = sample(); args[0]['HostConfig']['Binds'] = None; args[0]['Config']['Image'] = 'mysql:8.4'
        review = module.prepare(*args, RUN)
        self.assertEqual(review.blockers, ['existing-volume-not-explicitly-bound', 'image-reference-not-fixed-id'])
        self.assertIsNone(review.draft['HostConfig']['Binds']); self.assertEqual(review.draft['Image'], 'mysql:8.4')
        self.assertEqual(review.safe()['phase'], 'blocked')

    def test_unknown_host_or_config_even_default_values_block_round_trip(self):
        for group in ['Config', 'HostConfig']:
            for value in [None, 0, False, {}, SECRET]:
                args = sample(); args[0][group]['FutureField'] = value
                self.assertIn('unsupported-config-shape', module.prepare(*args, RUN).blockers)

    def test_wrong_identity_state_mount_image_or_volume_rejected(self):
        mutations = [lambda a: a[0].update(Id='b' * 64), lambda a: a[0].update(Image='sha256:' + 'c' * 64), lambda a: a[0].update(Name='/other'),
                     lambda a: a[0]['State'].update(Running=False), lambda a: a[0]['State'].update(Restarting=True),
                     lambda a: a[0]['Mounts'].append(copy.deepcopy(a[0]['Mounts'][0])), lambda a: a[0]['Mounts'][0].update(RW=False),
                     lambda a: a[0]['Mounts'][0].update(Type='bind'), lambda a: a[0]['Mounts'][0].update(Name='other'),
                     lambda a: a[2].update(Driver='nfs'), lambda a: a[2].update(Options={'device': SECRET}), lambda a: a[3].update(Architecture='arm64')]
        for mutate in mutations:
            args = sample(); mutate(args)
            with self.subTest(mutate=mutations.index(mutate)), self.assertRaises(module.Blocked): module.prepare(*args, RUN)

    def test_other_volume_reference_and_port_or_name_collision_rejected(self):
        for kind in ['volume', 'port', 'name', 'missing-mount-name', 'incomplete-inventory']:
            args = sample(); other = {'Id': 'e' * 64, 'Mounts': [], 'Ports': [], 'Names': ['/other']}; args[1].append(other)
            if kind == 'volume': other['Mounts'] = copy.deepcopy(args[0]['Mounts'])
            if kind == 'port': other['Ports'] = [{'IP': '0.0.0.0', 'PublicPort': 13384}]
            if kind == 'name': other['Names'] = ['/' + module.NAME]
            if kind == 'missing-mount-name': other['Mounts'] = [{'Type': 'volume'}]
            if kind == 'incomplete-inventory': del other['Ports']
            with self.subTest(kind=kind), self.assertRaises(module.Blocked): module.prepare(*args, RUN)

    def test_cmd_modes_privileges_and_network_cannot_be_guessed(self):
        mutations = [lambda a: a[0]['Config'].update(Cmd=['--performance-schema=ON']),
                     lambda a: a[0]['Config'].update(Cmd=['--performance-schema=OFF', '--performance-schema=ON']),
                     lambda a: a[0]['Config']['Labels'].update({'com.docker.compose.project': 'other'}),
                     lambda a: a[0]['HostConfig'].update(RestartPolicy={'Name': 'always', 'MaximumRetryCount': 0}),
                     lambda a: a[0]['HostConfig'].update(Privileged=True), lambda a: a[0]['HostConfig'].update(AutoRemove=True),
                     lambda a: a[0]['HostConfig'].update(PortBindings={'3306/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '13384'}]}),
                     lambda a: a[0]['HostConfig'].update(NetworkMode='host'), lambda a: a[0]['HostConfig'].update(NetworkMode='bridge'), lambda a: a[0]['HostConfig'].update(VolumesFrom=['other']),
                     lambda a: a[0]['NetworkSettings']['Networks'].update(other={}), lambda a: a[0]['NetworkSettings']['Networks'][module.NETWORK_NAME].update(IPAMConfig={'IPv4Address': '172.17.0.2'}),
                     lambda a: a[0]['NetworkSettings']['Networks'][module.NETWORK_NAME].update(Aliases=['original-name']),
                     lambda a: a[0]['NetworkSettings']['Networks'][module.NETWORK_NAME].update(Links=['other']),
                     lambda a: a[4].update(Id='b' * 64), lambda a: a[4].update(Driver='overlay'), lambda a: a[4]['IPAM'].update(Driver='custom'),
                     lambda a: a[0]['HostConfig'].update(Memory=0), lambda a: a[0]['HostConfig'].update(NanoCpus=0)]
        for mutate in mutations:
            args = sample(); mutate(args)
            with self.subTest(mutate=mutations.index(mutate)), self.assertRaises(module.Blocked): module.prepare(*args, RUN)


class ReadGate(unittest.TestCase):
    def identity(self): return module.HostIdentity('a' * 64, 1, 2, 'synthetic-daemon')

    def adapter(self, *, wrong_daemon=False, status=200, raw=None, bad_host_at=0):
        events = []
        def host(_identity):
            events.append('host')
            if len([e for e in events if e == 'host']) == bad_host_at: raise module.Blocked('socket-mismatch')
        class Connection:
            def __init__(self, *_args, **_kwargs): self.path = ''
            def request(self, method, path, **_kwargs):
                events.append((method, path)); self.path = path
            def getresponse(self):
                payload = {'ID': 'other' if wrong_daemon else 'synthetic-daemon', 'Name': 'Server-200', 'OSType': 'linux', 'Architecture': 'x86_64'} if self.path.endswith('/info') else {'Id': module.OLD_ID}
                return SimpleNamespace(status=status, read=lambda _limit: raw if raw is not None else json.dumps(payload).encode())
            def close(self): events.append('close')
        return module.ReadOnlyDocker(self.identity(), host, Connection), events

    def test_each_info_and_each_target_request_has_own_host_check_and_fresh_daemon(self):
        api, events = self.adapter()
        api.get('/containers/' + module.OLD_ID + '/json'); api.get('/volumes/' + module.VOLUME)
        requests = [event for event in events if isinstance(event, tuple)]
        self.assertEqual([p for _, p in requests], [module.API + '/info', module.API + '/containers/' + module.OLD_ID + '/json', module.API + '/info', module.API + '/volumes/' + module.VOLUME])
        self.assertTrue(all(event[0] == 'GET' for event in requests)); self.assertEqual(events.count('host'), 4)
        for index, event in enumerate(events):
            if isinstance(event, tuple): self.assertEqual(events[index - 1], 'host')

    def test_daemon_mismatch_or_socket_change_prevents_target_request(self):
        for settings in [{'wrong_daemon': True}, {'bad_host_at': 1}, {'bad_host_at': 2}]:
            api, events = self.adapter(**settings)
            with self.assertRaises(module.Blocked): api.get('/containers/' + module.OLD_ID + '/json')
            self.assertFalse(any(isinstance(e, tuple) and not e[1].endswith('/info') for e in events))

    def test_write_endpoints_other_ids_and_error_response_body_are_never_forwarded(self):
        for path in ['/containers/create', '/containers/' + module.OLD_ID + '/stop', '/containers/other/json', '/version', '/info?secret=' + SECRET]:
            api, events = self.adapter()
            with self.assertRaises(module.Blocked): api.get(path)
            self.assertEqual(events, [])
        for settings in [{'status': 500, 'raw': SECRET.encode()}, {'raw': SECRET.encode()}]:
            api, _ = self.adapter(**settings)
            with self.assertRaises(module.Blocked) as caught: api.get('/info')
            self.assertNotIn(SECRET, str(caught.exception))

    def test_default_gate_returns_before_host_api_or_report_access(self):
        with patch.object(module, 'ReadOnlyDocker', side_effect=AssertionError('不得访问API')), patch.object(module, 'write_report', side_effect=AssertionError('不得写文件')):
            self.assertEqual(module.main([]), 64)
            self.assertEqual(module.main(['--root-approved-readonly']), 64)

    def test_main_approved_readonly_still_cannot_mutate_and_writes_only_safe_report(self):
        original, inventory, volume, image, network, network_id = sample()
        responses = {'/containers/' + module.OLD_ID + '/json': original, '/containers/json?all=1': inventory, '/volumes/' + module.VOLUME: volume, '/images/' + module.IMAGE + '/json': image, '/networks/' + network_id: network}
        calls, reports = [], []
        api = SimpleNamespace(get=lambda path: (calls.append(path), copy.deepcopy(responses[path]))[1])
        args = ['--root-approved-readonly', '--root-confirm', module.CONFIRM, '--machine-sha256', 'a' * 64, '--socket-dev', '1', '--socket-ino', '2', '--daemon', 'synthetic-daemon', '--network-id', network_id, '--run', RUN, '--report-parent', 'synthetic-report-parent']
        with patch.dict(sys.modules, {'resource': SimpleNamespace(RLIMIT_CORE=4, setrlimit=lambda *_args: None)}), patch.object(module, 'ReadOnlyDocker', return_value=api), patch.object(module, 'write_report', side_effect=lambda _parent, _run, report: reports.append(report)):
            self.assertEqual(module.main(args), 0)
        self.assertEqual(set(calls), set(responses)); self.assertEqual(len(calls), 5)
        self.assertFalse(reports[0]['readyForSwitch']); self.assertFalse(reports[0]['mutationsImplemented'])
        self.assertNotIn(SECRET, json.dumps(reports))

    def test_report_failure_never_prints_underlying_secret_exception(self):
        args = ['--root-approved-readonly', '--root-confirm', module.CONFIRM, '--machine-sha256', 'a' * 64, '--socket-dev', '1', '--socket-ino', '2', '--daemon', 'synthetic-daemon', '--network-id', NETWORK_ID, '--run', RUN, '--report-parent', 'synthetic-report-parent']
        output = io.StringIO()
        with patch.dict(sys.modules, {'resource': SimpleNamespace(RLIMIT_CORE=4, setrlimit=lambda *_args: None)}), patch.object(module, 'ReadOnlyDocker', side_effect=RuntimeError(SECRET)), patch.object(module, 'write_report', side_effect=RuntimeError(SECRET)), patch('sys.stdout', output):
            self.assertEqual(module.main(args), 3)
        self.assertNotIn(SECRET, output.getvalue()); self.assertEqual(json.loads(output.getvalue())['phase'], 'report-not-written')

    def test_independent_local_facts_are_verified_using_only_fake_system_ports(self):
        machine = b'synthetic-machine\n'; expected = module.HostIdentity(hashlib.sha256(machine.strip()).hexdigest(), 1, 2, 'synthetic-daemon')
        fake_socket = SimpleNamespace(__enter__=lambda _s: _s, __exit__=lambda *_args: None, fileno=lambda: 33)
        class Probe:
            def __enter__(self): return fake_socket
            def __exit__(self, *_args): pass
        facts = {'uid': 0, 'name': 'Server-200', 'os': 'Linux', 'arch': 'x86_64', 'ip': module.HOST, 'machine': machine, 'dev': 1, 'ino': 2, 'mode': stat.S_IFSOCK | 0o660}
        with patch.dict(sys.modules, {'fcntl': SimpleNamespace(ioctl=lambda *_args: b'\0' * 20 + socket.inet_aton(facts['ip']) + b'\0' * 8)}), \
             patch.object(module.os, 'geteuid', create=True, side_effect=lambda: facts['uid']), \
             patch.object(module.os, 'uname', create=True, side_effect=lambda: SimpleNamespace(sysname=facts['os'], machine=facts['arch'])), \
             patch.object(module.socket, 'gethostname', side_effect=lambda: facts['name']), patch.object(module.socket, 'if_nameindex', return_value=[(1, 'eth0')]), \
             patch.object(module.socket, 'socket', return_value=Probe()), patch.object(module.Path, 'read_bytes', side_effect=lambda: facts['machine']), \
             patch.object(module.os, 'lstat', side_effect=lambda _path: SimpleNamespace(st_mode=facts['mode'], st_uid=0, st_dev=facts['dev'], st_ino=facts['ino'])):
            module.verify_local(expected)
            for key, value in [('uid', 1000), ('name', 'other'), ('os', 'Windows'), ('arch', 'aarch64'), ('ip', '127.0.0.1'), ('machine', b'other'), ('dev', 3), ('ino', 4), ('mode', stat.S_IFREG | 0o600)]:
                old = facts[key]; facts[key] = value
                with self.subTest(key=key), self.assertRaises(module.Blocked): module.verify_local(expected)
                facts[key] = old


class ReportBoundary(unittest.TestCase):
    def test_unsafe_payload_is_rejected_before_filesystem_access(self):
        safe = module.prepare(*sample(), RUN).safe()
        for patch_value in [{'Config': {'Env': [SECRET]}}, {'code': SECRET}, {'blockers': [SECRET]}, {'restartAuthorized': True}]:
            with patch.object(module.os, 'open', side_effect=AssertionError('不得打开文件')):
                with self.assertRaises(module.Blocked): module.write_report('/tmp/dbark-ps-switch-' + RUN, RUN, {**safe, **patch_value})

    def test_private_directory_and_exclusive_file_flags_using_only_memory_sink(self):
        safe = module.prepare(*sample(), RUN).safe(); captured = []
        class Sink(io.BytesIO):
            def fileno(self): return 77
            def close(self): captured.append(self.getvalue()); super().close()
        parent = Path.cwd() / ('dbark-ps-switch-' + RUN)
        with patch.object(module.Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)), \
             patch.object(module.Path, 'resolve', return_value=parent), patch.object(module.os, 'open', return_value=77, create=True) as opened, \
             patch.object(module.os, 'O_NOFOLLOW', 0x20000, create=True), patch.object(module.os, 'fdopen', return_value=Sink()), patch.object(module.os, 'fsync'):
            module.write_report(parent, RUN, safe)
            self.assertEqual(opened.call_args.args[1] & module.os.O_EXCL, module.os.O_EXCL)
            self.assertEqual(opened.call_args.args[2], 0o600)
        self.assertEqual(json.loads(captured[0]), safe); self.assertNotIn(SECRET.encode(), captured[0])
        for mode, uid in [(stat.S_IFDIR | 0o755, 0), (stat.S_IFDIR | 0o700, 1000), (stat.S_IFLNK | 0o700, 0)]:
            with patch.object(module.Path, 'lstat', return_value=SimpleNamespace(st_mode=mode, st_uid=uid)), patch.object(module.Path, 'resolve', return_value=parent), patch.object(module.os, 'open', side_effect=AssertionError('不应打开')):
                with self.assertRaises(module.Blocked): module.write_report(parent, RUN, safe)


if __name__ == '__main__':
    unittest.main()
