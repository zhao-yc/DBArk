# 官方来源及固定摘要见同目录README；只能在ROOT核对的200构建，本轮未执行。
FROM alpine:3.23.6@sha256:1f3591b8a02ea153f41c5bba878ad477f63ab3d19349762cb77504db02a23e15
# apk 3的add默认不请求升级既有包；依赖仍须满足，三个目标包继续精确锁定。
RUN apk add --no-cache openssh-server=10.2_p1-r0 openssh-keygen=10.2_p1-r0 openssh-server-common=10.2_p1-r0 \
 && mkdir -p /opt/c02/accounts /var/empty /run/c02 \
 && cp /etc/passwd /etc/group /etc/shadow /opt/c02/accounts/ \
 && apk info -v > /opt/c02/packages.lock \
 && /usr/sbin/sshd -V 2>&1 | grep -q '^OpenSSH_10.2p1' \
 && test -x /sbin/nologin
COPY entrypoint.sh sshd_config authorized_keys /opt/c02/
RUN chmod 0755 /opt/c02/entrypoint.sh && chmod 0644 /opt/c02/authorized_keys /opt/c02/sshd_config
EXPOSE 2222
ENTRYPOINT ["/opt/c02/entrypoint.sh"]
CMD []
