import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { c02OpenSshBase, c02OpenSshPackage } from '../integration/helpers/c02-openssh-policy';

// 只读公开源码，不执行apk、Docker、SSH，不读取环境、材料或服务器身份。
const source = readFileSync(new URL('../fixtures/c02-openssh/Dockerfile', import.meta.url), 'utf8');
const commands = source.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/).filter(line => !line.startsWith('#'));
const installs = commands.filter(line => /^RUN apk add\b/.test(line));

describe('C02固定OpenSSH的apk 3安装策略', () => {
  it('基础摘要和三个精确包版本保持，无浮动来源', () => {
    expect(commands.filter(line => /^FROM\b/.test(line))).toEqual([`FROM ${c02OpenSshBase}`]);
    expect(installs).toHaveLength(1);
    const packages = installs[0].split('&&')[0].trim().split(/\s+/).slice(4);
    expect(packages).toEqual(['openssh-server', 'openssh-keygen', 'openssh-server-common'].map(name => `${name}=${c02OpenSshPackage}`));
  });

  it('沿用add默认求解，不传不支持的no-upgrade或请求升级，不在失败后回退', () => {
    // 精确约束选项，避免重新引入旧参数或upgrade/latest/force等改变求解的开关。
    expect(installs[0].split('&&')[0].trim().split(/\s+/).filter(value => value.startsWith('-'))).toEqual(['--no-cache']);
    expect(commands.join('\n').match(/\bapk\s+[\w-]+/g)).toEqual(['apk add', 'apk info']);
    expect(installs[0]).not.toMatch(/\|\||;/);
    expect(installs[0]).toContain("/usr/sbin/sshd -V 2>&1 | grep -q '^OpenSSH_10.2p1'");
  });
});
