#!/usr/bin/env python3
"""Diagnose RSSHub service and test individual freewechat routes"""
import paramiko
import sys

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=30)
    print('[OK] SSH connected\n')

    # 1. Check RSSHub service status
    print('=== RSSHub service status ===')
    stdin, stdout, stderr = ssh.exec_command('systemctl status rsshub --no-pager -l 2>&1 | head -30')
    print(stdout.read().decode())

    # 2. Check if RSSHub is listening on port 1200
    print('=== Port 1200 check ===')
    stdin, stdout, stderr = ssh.exec_command('ss -tlnp | grep 1200')
    print(stdout.read().decode() or 'Port 1200 not listening!')

    # 3. Test a single freewechat route (光伏們 - most articles in previous test)
    print('=== Test single freewechat route: 光伏們 ===')
    stdin, stdout, stderr = ssh.exec_command(
        'curl -s -o /dev/null -w "%{http_code} %{time_total}s" http://127.0.0.1:1200/freewechat/profile/MzAxNjU2NjAyNA== 2>&1'
    )
    stdout.channel.settimeout(30)
    result = stdout.read().decode().strip()
    print(f'HTTP status + time: {result}')

    # 4. Get actual content from one route
    print('\n=== Get content from 光伏們 route ===')
    stdin, stdout, stderr = ssh.exec_command(
    )
    stdout.channel.settimeout(30)
    content = stdout.read().decode()
    print(content[:1500] if content else '(empty response)')

    # 5. Check RSSHub logs for errors
    print('\n=== RSSHub recent logs (last 30 lines) ===')
    stdin, stdout, stderr = ssh.exec_command('journalctl -u rsshub --no-pager -n 30 2>&1')
    print(stdout.read().decode())

    # 6. Test another route - 索比光伏网
    print('=== Test route: 索比光伏网 ===')
    stdin, stdout, stderr = ssh.exec_command(
        'curl -s -o /dev/null -w "%{http_code} %{time_total}s" http://127.0.0.1:1200/freewechat/profile/MjM5MzgyMjY2MQ== 2>&1'
    )
    stdout.channel.settimeout(30)
    result2 = stdout.read().decode().strip()
    print(f'HTTP status + time: {result2}')

    # 7. Restart RSSHub and test again
    print('\n=== Restarting RSSHub ===')
    stdin, stdout, stderr = ssh.exec_command('systemctl restart rsshub')
    import time
    time.sleep(5)
    stdin, stdout, stderr = ssh.exec_command('systemctl is-active rsshub')
    status = stdout.read().decode().strip()
    print(f'RSSHub status after restart: {status}')

    # Wait a bit more for RSSHub to fully start
    time.sleep(5)

    # 8. Test again after restart
    print('\n=== Test after restart: 光伏們 ===')
    stdin, stdout, stderr = ssh.exec_command(
    )
    stdout.channel.settimeout(30)
    content2 = stdout.read().decode()
    if content2:
        print(f'Response length: {len(content2)} chars')
        print(content2[:500])
    else:
        print('(empty response)')

    # 9. Check RSSHub version / health
    print('\n=== RSSHub health check ===')
    stdin, stdout, stderr = ssh.exec_command(
    )
    stdout.channel.settimeout(15)
    health = stdout.read().decode()
    print(health[:500] if health else '(empty)')

    ssh.close()
    print('\n=== Diagnosis complete ===')

if __name__ == '__main__':
    main()
