#!/bin/sh
set -eu
# 全部账号文件只写容器tmpfs，不改宿主sshd或authorized_keys，也不输出认证原值。
case "${C02_SSH_USER:-}" in c02_????????????) ;; *) echo 'C02临时用户名无效' >&2; exit 1;; esac
case "$C02_SSH_USER" in *[!a-z0-9_]*) exit 1;; esac
cp /opt/c02/accounts/passwd /etc/passwd
cp /opt/c02/accounts/group /etc/group
cp /opt/c02/accounts/shadow /etc/shadow
chmod 0600 /etc/shadow
adduser -D -H -h /var/empty -s /sbin/nologin "$C02_SSH_USER" >/dev/null 2>&1
password=$(cat /run/c02/ssh-password)
case "$password" in ''|*[!A-Za-z0-9_-]*) echo 'C02密码材料格式无效' >&2; exit 1;; esac
[ "${#password}" -eq 48 ] || exit 1
printf '%s:%s\n' "$C02_SSH_USER" "$password" | chpasswd -c sha512 >/dev/null 2>&1
unset password
# 不生成默认主机密钥；只使用本轮0600只读挂载的新host.key。
/usr/sbin/sshd -t -f /opt/c02/sshd_config
exec /usr/sbin/sshd -D -e -f /opt/c02/sshd_config
