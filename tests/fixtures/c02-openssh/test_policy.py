"""仅内存策略检查；不执行main、subprocess、socket绑定或任何Docker/SSH。"""
import copy
import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('c02_server_policy', Path(__file__).with_name('server.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def sample():
    run, digest, image = 'a' * 32, 'c' * 64, 'sha256:' + 'd' * 64
    directory = Path('/tmp/dbark-c02-openssh-' + run)
    value = {'Name': '/dbark-c02-ssh-' + run, 'Image': image, 'Config': {'Labels': {module.LABEL + '.purpose': module.PURPOSE, module.LABEL + '.run': run, module.LABEL + '.config': digest}, 'Entrypoint': ['/opt/c02/entrypoint.sh'], 'Cmd': None, 'Env': ['PATH=/bin', 'C02_SSH_USER=c02_' + run[:12]]}, 'HostConfig': {'ReadonlyRootfs': True, 'Privileged': False, 'PortBindings': {'2222/tcp': [{'HostIp': module.HOST, 'HostPort': '22384'}]}, 'CapAdd': ['SETUID', 'SETGID', 'SYS_CHROOT'], 'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges:true'], 'LogConfig': {'Type': 'none'}, 'PidsLimit': 64, 'Memory': 128 * 1024 * 1024, 'NanoCpus': 500000000, 'Tmpfs': {'/etc': 'rw,nosuid,nodev,noexec', '/run': 'rw,nosuid,nodev,noexec'}}, 'NetworkSettings': {'Networks': {'dbark-c02-ssh-' + run: {}}}, 'Mounts': [{'Source': str(directory / name), 'Destination': '/run/c02/' + name, 'RW': False, 'Type': 'bind'} for name in ['host.key', 'ssh-password']]}
    return value, run, digest, image, directory


class Policy(unittest.TestCase):
    def test_gate_precedes_host_and_file_access(self):
        self.assertFalse(module.enabled({}))
        with patch.object(module, 'enabled', return_value=False), patch.object(module.os, 'getuid', create=True, side_effect=AssertionError('不得读宿主')):
            with self.assertRaisesRegex(RuntimeError, '双门未开'):
                module.Server('/不可读取', {}, '不可访问')

    def test_host_and_socket_changes_rejected(self):
        expected = {'hostname': '仅测试', 'machineHash': 'a' * 64, 'socket': '1:2'}
        module.validate_host(expected, expected)
        for key in expected:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                module.validate_host(dict(expected, **{key: '另一个对象'}), expected)

    def test_actual_inspection_with_caps_prefix_is_accepted(self):
        value, run, digest, image, directory = sample()
        value['HostConfig']['CapAdd'] = ['CAP_SETUID', 'CAP_SETGID', 'CAP_SYS_CHROOT']
        module.validate_container(value, run, 22384, image, directory, digest)

    def test_wrong_ownership_or_runtime_scope_rejected(self):
        value, run, digest, image, directory = sample()
        variants = []
        def changed(mutator):
            other = copy.deepcopy(value); mutator(other); variants.append(other)
        changed(lambda v: v['Config']['Labels'].update({module.LABEL + '.run': 'b' * 32}))
        changed(lambda v: v.update(Image='其它镜像'))
        changed(lambda v: v['HostConfig'].update(Privileged=True))
        changed(lambda v: v['HostConfig'].update(ReadonlyRootfs=False))
        changed(lambda v: v['HostConfig']['PortBindings']['2222/tcp'][0].update(HostIp='0.0.0.0'))
        changed(lambda v: v['HostConfig']['CapAdd'].append('NET_ADMIN'))
        changed(lambda v: v['Mounts'][0].update(Source='/root/.ssh/id_ed25519'))
        changed(lambda v: v['Mounts'][1].update(RW=True))
        changed(lambda v: v['NetworkSettings']['Networks'].update(生产网络={}))
        changed(lambda v: v['Config'].update(Entrypoint=['/bin/sh']))
        changed(lambda v: v['Config']['Env'].append('SSH_AUTH_SOCK=/既有身份'))
        changed(lambda v: v['HostConfig']['LogConfig'].update(Type='json-file'))
        changed(lambda v: v['HostConfig']['Tmpfs'].update({'/etc': 'rw'}))
        for index, other in enumerate(variants):
            with self.subTest(index=index), self.assertRaises(RuntimeError):
                module.validate_container(other, run, 22384, image, directory, digest)

    def test_effective_config_only_two_destinations_and_no_sessions(self):
        text = module.config_text('c02_' + 'a' * 12)
        values = dict(line.split(' ', 1) for line in text.splitlines())
        self.assertEqual(values['PermitOpen'], '192.168.31.200:13384 192.168.31.200:13484')
        self.assertEqual(values['MaxSessions'], '0')
        self.assertEqual(values['AllowTcpForwarding'], 'local')
        for key in ['AllowStreamLocalForwarding', 'AllowAgentForwarding', 'X11Forwarding', 'PermitTTY', 'PermitTunnel', 'PermitUserRC', 'PermitUserEnvironment', 'PermitRootLogin']:
            self.assertEqual(values[key], 'no')
        self.assertNotIn('Include', values)
        self.assertNotIn('Subsystem', values)

    def test_command_adapter_checks_host_before_each_docker_and_uses_own_config(self):
        # 这里只检查命令构造/核对顺序；subprocess完全替换，没有执行Docker或模拟认证通过。
        # mkdir也替换为内存调用，纯检查不依赖Windows临时目录ACL。
        with patch.object(Path, 'mkdir'):
            directory = '/仅策略检查/本轮目录'
            server = module.Server.__new__(module.Server)
            server.directory, server.daemon = Path(directory), '仅测试daemon'
            order = []
            server.check_host = lambda: order.append('先核宿主及socket')
            def command(args, **kwargs):
                order.append('仅构造Docker参数')
                self.assertEqual(args[:3], ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock'])
                self.assertEqual(args[3:5], ['--config', str(Path(directory) / 'docker-config')])
                self.assertEqual(set(kwargs['env']), {'PATH', 'LANG'})
                return SimpleNamespace(returncode=0, stdout=('仅测试daemon' if args[-3:] == ['info', '--format', '{{.ID}}'] else '仅测试输出').encode(), stderr=b'')
            with patch.object(module.subprocess, 'run', side_effect=command):
                self.assertEqual(server.docker('inspect', '仅测试ID'), '仅测试输出')
            self.assertEqual(order, ['先核宿主及socket', '仅构造Docker参数', '先核宿主及socket', '仅构造Docker参数'])


if __name__ == '__main__':
    unittest.main()
