"""ROOT后续专用200操作入口。本轮只导入纯策略/语法检查，绝不调用main或Docker。"""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import time

PURPOSE = 'dbark-c02-openssh-v1'
CONFIRM = 'server-200/192.168.31.200/isolated-openssh'
HOST = '192.168.31.200'
LABEL = 'io.dbark.c02'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def enabled(env):
    """缺省关闭；拒绝在读取材料或宿主信息前消耗其它环境/身份。"""
    return env.get('DBARK_INTEGRATION_ENABLED') == '1' and env.get('DBARK_C02_OPENSSH_SERVER_ENABLED') == '1' and env.get('DBARK_C02_OPENSSH_ROOT_CONFIRM') == CONFIRM


def validate_host(actual, expected):
    """实际宿主与socket必须逐项相同；不把环境自述或Docker context名称当服务器身份。"""
    require(actual == expected and len(expected['machineHash']) == 64 and expected['hostname'] and expected['socket'], 'C02实际200宿主或Docker socket身份不匹配')


def config_text(user):
    """无Include、默认身份、shell或任意转发；密码认证也受相同全局边界限制。"""
    return '\n'.join([
        'Port 2222', 'ListenAddress 0.0.0.0', 'HostKey /run/c02/host.key',
        'PidFile /run/c02/sshd.pid', 'AuthorizedKeysFile /opt/c02/authorized_keys',
        'StrictModes yes', 'PasswordAuthentication yes', 'PubkeyAuthentication yes',
        'AuthenticationMethods publickey password', 'KbdInteractiveAuthentication no',
        'PermitRootLogin no', 'PermitEmptyPasswords no', 'HostbasedAuthentication no',
        'AllowUsers ' + user, 'AllowTcpForwarding local', 'PermitListen none',
        'PermitOpen 192.168.31.200:13384 192.168.31.200:13484',
        'AllowStreamLocalForwarding no', 'AllowAgentForwarding no', 'X11Forwarding no',
        'PermitTTY no', 'PermitTunnel no', 'PermitUserRC no', 'PermitUserEnvironment no',
        'MaxSessions 0', 'MaxAuthTries 3', 'LoginGraceTime 20', 'MaxStartups 4',
        # 正负例在本独立容器内，不让OpenSSH默认来源惩罚把下一正确例变成等待。
        'PerSourcePenalties no', 'UseDNS no', 'LogLevel QUIET', ''
    ])


def validate_container(value, run, port, image, directory, digest):
    """删除和出具证明共用真实inspect；名称、labels、镜像、挂载、网络及私网绑定一起核对。"""
    labels = value['Config']['Labels']
    require(all(labels.get(LABEL + '.' + key) == expected for key, expected in [('purpose', PURPOSE), ('run', run), ('config', digest)]), 'C02容器labels归属不匹配')
    require(value['Name'] == '/dbark-c02-ssh-' + run and value['Image'] == image, 'C02容器名称或镜像身份不匹配')
    host = value['HostConfig']
    require(host['ReadonlyRootfs'] and not host['Privileged'] and host['PortBindings'] == {'2222/tcp': [{'HostIp': HOST, 'HostPort': str(port)}]}, 'C02只允许私网单端口及只读非特权容器')
    require({item.removeprefix('CAP_') for item in host.get('CapAdd') or []} == {'SETUID', 'SETGID', 'SYS_CHROOT'} and {item.removeprefix('CAP_') for item in host.get('CapDrop') or []} == {'ALL'} and 'no-new-privileges:true' in (host.get('SecurityOpt') or []), 'C02容器能力范围不匹配')
    require(value['Config']['Entrypoint'] == ['/opt/c02/entrypoint.sh'] and not value['Config'].get('Cmd'), 'C02容器启动入口被替换')
    environment = dict(item.split('=', 1) for item in value['Config']['Env'])
    require(set(environment) <= {'PATH', 'C02_SSH_USER'} and environment.get('C02_SSH_USER') == 'c02_' + run[:12], 'C02容器环境超出公开临时账号范围')
    require(host['LogConfig']['Type'] == 'none' and host['PidsLimit'] == 64 and host['Memory'] == 128 * 1024 * 1024 and host['NanoCpus'] == 500000000, 'C02容器日志或资源范围不匹配')
    require(set(host['Tmpfs']) == {'/etc', '/run'} and all({'nosuid', 'nodev', 'noexec'} <= set(options.split(',')) for options in host['Tmpfs'].values()), 'C02账号与运行状态必须使用受限tmpfs')
    require(set(value['NetworkSettings']['Networks']) == {'dbark-c02-ssh-' + run}, 'C02容器连接了非本轮网络')
    mounts = {(item['Source'], item['Destination'], item['RW'], item['Type']) for item in value['Mounts']}
    require(mounts == {(str(directory / 'host.key'), '/run/c02/host.key', False, 'bind'), (str(directory / 'ssh-password'), '/run/c02/ssh-password', False, 'bind')}, 'C02容器挂载超出新材料范围')


class Server:
    def __init__(self, directory, expected, daemon):
        require(enabled(os.environ), 'C02隔离OpenSSH服务器双门未开，未访问宿主或材料')
        require(sys.platform == 'linux' and os.getuid() == 0, 'C02服务器入口只能由ROOT在200的Linux执行')
        require(platform.machine() == 'x86_64', 'C02固定amd64镜像仅允许ROOT核对的x86_64宿主')
        self.directory = Path(directory)
        require(str(self.directory.parent) == '/tmp' and not self.directory.is_symlink() and self.directory.resolve() == self.directory and self.directory.name.startswith('dbark-c02-openssh-'), 'C02只允许/tmp下本轮普通随机目录')
        self.identity = self.directory.stat()
        require(self.identity.st_uid == 0 and stat.S_IMODE(self.identity.st_mode) == 0o700, 'C02材料目录必须ROOT独占0700')
        self.files = {}
        for name in ['manifest.json', 'host.key', 'ssh-password']:
            value = (self.directory / name).lstat()
            require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and stat.S_IMODE(value.st_mode) == 0o600 and value.st_size <= 65536, 'C02只允许自有有界0600普通材料')
            self.files[name] = (value.st_dev, value.st_ino, value.st_size)
        fd = os.open(self.directory / 'manifest.json', os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as source:
            current = os.fstat(source.fileno())
            require((current.st_dev, current.st_ino, current.st_size) == self.files['manifest.json'], 'C02材料清单对象被替换')
            self.manifest = json.load(source)
        self.run = self.manifest['run']
        require(len(self.run) == 32 and all(c in '0123456789abcdef' for c in self.run) and self.directory.name == 'dbark-c02-openssh-' + self.run and self.manifest['purpose'] == PURPOSE and self.manifest['user'] == 'c02_' + self.run[:12] and 20000 <= self.manifest['port'] <= 29999, 'C02材料令牌、账号或端口无效')
        for name in ['manifest.json', 'host.key', 'ssh-password']:
            value = (self.directory / name).lstat()
            require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and stat.S_IMODE(value.st_mode) == 0o600, 'C02只允许自有0600普通材料')
        require(not any((self.directory / name).exists() for name in ['client.key', 'key-passphrase']), 'C02服务器不能接收客户端私钥或口令')
        self.expected, self.daemon = expected, daemon
        self.name = 'dbark-c02-ssh-' + self.run
        self.config = config_text(self.manifest['user'])
        self.digest = hashlib.sha256(self.config.encode() + self.manifest['clientPublic'].encode() + b''.join((Path(__file__).parent / name).read_bytes() for name in ['Dockerfile', '.dockerignore', 'entrypoint.sh'])).hexdigest()
        self.check_host()
        self.state_path = self.directory / 'runtime.json'
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}

    def check_host(self):
        actual_dir = self.directory.lstat()
        require(not self.directory.is_symlink() and self.directory.resolve() == self.directory and (actual_dir.st_dev, actual_dir.st_ino) == (self.identity.st_dev, self.identity.st_ino), 'C02临时目录身份发生变化')
        for name, identity in self.files.items():
            value = (self.directory / name).lstat()
            require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and stat.S_IMODE(value.st_mode) == 0o600 and (value.st_dev, value.st_ino, value.st_size) == identity, 'C02新材料文件被替换，拒绝Docker操作')
        sock = Path('/var/run/docker.sock').lstat()
        require(stat.S_ISSOCK(sock.st_mode) and sock.st_uid == 0, 'C02必须使用ROOT核对的本机Unix Docker socket')
        actual = {'hostname': socket.gethostname(), 'machineHash': hashlib.sha256(Path('/etc/machine-id').read_bytes().strip()).hexdigest(), 'socket': f'{sock.st_dev}:{sock.st_ino}'}
        validate_host(actual, self.expected)

    def docker(self, *args):
        """每条Docker命令前重核宿主/socket，显式Unix地址及自有空配置，不读Root Docker凭据。"""
        self.check_host()
        config = self.directory / 'docker-config'; config.mkdir(mode=0o700, exist_ok=True)
        prefix = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', '--config', str(config)]
        # 不把ROOT现有认证环境或agent/socket带给Docker CLI，也不继承远端context。
        env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
        def call(command):
            result = subprocess.run(prefix + list(command), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300, check=False)
            require(result.returncode == 0, 'C02指定Docker步骤失败；未输出原日志或自动重试，保留本轮目录')
            return result.stdout.decode().strip()
        require(call(['info', '--format', '{{.ID}}']) == self.daemon, 'C02实际Docker daemon ID不匹配')
        self.check_host()
        return call(args)

    def save(self):
        self.check_host()
        self.state_path.write_text(json.dumps(self.state)); self.state_path.chmod(0o600)

    def up(self):
        require(not self.state, 'C02已有生命周期记录，拒绝覆盖')
        require(not self.docker('container', 'ls', '-aq', '--filter', 'name=^/' + self.name + '$') and not self.docker('network', 'ls', '-q', '--filter', 'name=^' + self.name + '$'), 'C02同名资源已存在，拒绝接管')
        # 必须在正确宿主上真实核空闲；不自动改端口，不改宿主防火墙或网络。
        with socket.socket() as probe:
            probe.bind((HOST, self.manifest['port']))
        build = self.directory / 'build'; build.mkdir(mode=0o700)
        for name in ['Dockerfile', '.dockerignore', 'entrypoint.sh']:
            shutil.copyfile(Path(__file__).parent / name, build / name)
        (build / 'sshd_config').write_text(self.config)
        public = self.manifest['clientPublic']
        require(public.startswith('ssh-ed25519 ') and '\n' not in public and '\r' not in public, 'C02客户端公钥格式无效')
        (build / 'authorized_keys').write_text('restrict,port-forwarding,permitopen="192.168.31.200:13384",permitopen="192.168.31.200:13484" ' + public + '\n')
        labels = [LABEL + '.purpose=' + PURPOSE, LABEL + '.run=' + self.run, LABEL + '.config=' + self.digest]
        tag = 'dbark-c02-openssh:' + self.run
        require(not self.docker('image', 'ls', '-q', '--filter', 'reference=' + tag), 'C02同名镜像已存在，拒绝覆盖')
        label_args = [part for value in labels for part in ['--label', value]]
        self.state = {'phase': 'building', 'config': self.digest}; self.save()
        self.docker('build', '--tag', tag, *label_args, str(build))
        self.state['image'] = self.docker('image', 'inspect', tag, '--format', '{{.Id}}'); self.state['phase'] = 'network-unknown'; self.save()
        self.state['network'] = self.docker('network', 'create', *label_args, self.name); self.state['phase'] = 'container-unknown'; self.save()
        cid = self.docker('create', '--name', self.name, *label_args, '--network', self.name, '--read-only', '--cap-drop', 'ALL', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'SYS_CHROOT', '--security-opt', 'no-new-privileges:true', '--pids-limit', '64', '--memory', '128m', '--cpus', '0.5', '--log-driver', 'none', '--tmpfs', '/etc:rw,nosuid,nodev,noexec,mode=0755', '--tmpfs', '/run:rw,nosuid,nodev,noexec,mode=0755', '--publish', f'{HOST}:{self.manifest["port"]}:2222', '--mount', f'type=bind,src={self.directory}/host.key,dst=/run/c02/host.key,readonly', '--mount', f'type=bind,src={self.directory}/ssh-password,dst=/run/c02/ssh-password,readonly', '--env', 'C02_SSH_USER=' + self.manifest['user'], self.state['image'])
        require(len(cid) == 64 and all(c in '0123456789abcdef' for c in cid), 'C02容器CREATE结果未知，保留资源')
        self.state['container'] = cid; self.state['phase'] = 'created'; self.save()
        self.docker('start', cid); self.state['phase'] = 'started'; self.save()

    def inspect(self):
        require(self.state.get('container') and self.state.get('image') and self.state.get('network') and self.state.get('config') == self.digest, 'C02资源身份未知，须ROOT核对，拒绝按名字清理')
        value = json.loads(self.docker('inspect', self.state['container']))[0]
        require(value['Id'] == self.state['container'], 'C02实际容器ID不匹配')
        validate_container(value, self.run, self.manifest['port'], self.state['image'], self.directory, self.digest)
        return value

    def verify(self, nonce):
        require(len(nonce) == 32 and all(c in '0123456789abcdef' for c in nonce), 'C02核对nonce必须由ROOT明确提供')
        value = self.inspect(); require(value['State']['Running'], 'C02本轮容器未运行')
        lines = self.docker('exec', value['Id'], '/usr/sbin/sshd', '-T', '-f', '/opt/c02/sshd_config').splitlines()
        actual = dict(line.split(' ', 1) for line in lines if ' ' in line)
        for key, expected in [('allowusers', self.manifest['user']), ('maxsessions', '0'), ('allowtcpforwarding', 'local'), ('permitopen', '192.168.31.200:13384 192.168.31.200:13484'), ('allowstreamlocalforwarding', 'no'), ('allowagentforwarding', 'no'), ('x11forwarding', 'no'), ('permittty', 'no'), ('permitlisten', 'none'), ('passwordauthentication', 'yes'), ('pubkeyauthentication', 'yes'), ('authenticationmethods', 'publickey password'), ('permittunnel', 'no'), ('permituserrc', 'no'), ('permituserenvironment', 'no'), ('permitrootlogin', 'no'), ('kbdinteractiveauthentication', 'no'), ('hostbasedauthentication', 'no'), ('permitemptypasswords', 'no'), ('strictmodes', 'yes'), ('hostkey', '/run/c02/host.key'), ('authorizedkeysfile', '/opt/c02/authorized_keys')]:
            require(actual.get(key) == expected, 'C02实际sshd有效策略超出范围')
        fingerprint = self.docker('exec', value['Id'], '/usr/bin/ssh-keygen', '-lf', '/run/c02/host.key', '-E', 'sha256').split()[1]
        require(fingerprint == self.manifest['fingerprint'], 'C02实际新主机密钥指纹不匹配')
        proof = dict(self.expected, purpose=PURPOSE, run=self.run, host=HOST, daemon=self.daemon, container=value['Id'], image=value['Image'], port=self.manifest['port'], fingerprint=fingerprint, nonce=nonce, checkedAt=int(time.time() * 1000), restricted=True)
        output = self.directory / 'server-proof.json'; output.write_text(json.dumps(proof)); output.chmod(0o600)
        print('C02核对记录已写入本轮目录；无认证内容输出')

    def down(self):
        value = self.inspect()
        self.docker('rm', '--force', value['Id'])
        network = json.loads(self.docker('network', 'inspect', self.state['network']))[0]
        require(network['Id'] == self.state['network'] and network['Name'] == self.name and not network.get('Containers') and network['Labels'].get(LABEL + '.run') == self.run and network['Labels'].get(LABEL + '.purpose') == PURPOSE and network['Labels'].get(LABEL + '.config') == self.digest, 'C02网络归属或引用不匹配，保留待核对')
        self.docker('network', 'rm', network['Id'])
        image = json.loads(self.docker('image', 'inspect', self.state['image']))[0]
        require(image['Id'] == self.state['image'] and all(image['Config']['Labels'].get(LABEL + '.' + key) == expected for key, expected in [('purpose', PURPOSE), ('run', self.run), ('config', self.digest)]) and not self.docker('container', 'ls', '-aq', '--filter', 'ancestor=' + self.state['image']), 'C02镜像归属或引用不匹配')
        self.docker('image', 'rm', self.state['image'])
        self.check_host()
        allowed = {'manifest.json', 'host.key', 'ssh-password', 'runtime.json', 'server-proof.json', 'build', 'docker-config'}
        require(set(item.name for item in self.directory.iterdir()) <= allowed, 'C02目录出现非本轮材料，拒绝删除')
        for item in [self.directory, *self.directory.rglob('*')]:
            metadata = item.lstat(); require(not stat.S_ISLNK(metadata.st_mode) and metadata.st_uid == 0 and (stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode)), 'C02材料中有链接或异主对象，保留待核对')
        # 最终绝对目录、令牌、dev/ino均已核验；只删除本轮新建/tmp随机材料，不读/删宿主身份。
        shutil.rmtree(self.directory)
        print('C02本轮容器、网络、镜像及新材料已精确清理')


def main():
    require(enabled(os.environ), 'C02隔离OpenSSH服务器双门未开；没有执行Docker或访问材料')
    parser = argparse.ArgumentParser(description='仅ROOT在200后续审核运行的隔离OpenSSH夹具')
    parser.add_argument('action', choices=['up', 'verify', 'down'])
    for name in ['directory', 'hostname', 'machine-hash', 'socket', 'daemon']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--nonce', default='')
    args = parser.parse_args()
    server = Server(args.directory, {'hostname': args.hostname, 'machineHash': args.machine_hash, 'socket': args.socket}, args.daemon)
    if args.action == 'up': server.up()
    elif args.action == 'verify': server.verify(args.nonce)
    else: server.down()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # 不回显原异常、参数、材料内容或Docker输出；保留精确目录供ROOT核对未知结果。
        raise SystemExit('C02隔离OpenSSH步骤失败；未自动重试或接管未知资源，请ROOT核对本轮目录')
