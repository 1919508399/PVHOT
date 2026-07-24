#!/usr/bin/env python3
"""Deploy SEO files to pvhot server."""
import paramiko, os

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=15)
sftp = ssh.open_sftp()

base = r'C:\Users\HUASUN\Desktop\新闻'
files = [
    ('index.html', '/var/www/pvhot/index.html'),
    ('sitemap.xml', '/var/www/pvhot/sitemap.xml'),
    ('robots.txt', '/var/www/pvhot/robots.txt'),
    ('og-image.png', '/var/www/pvhot/og-image.png'),
]

for local_name, remote in files:
    local_path = os.path.join(base, local_name)
    sftp.put(local_path, remote)
    size_kb = os.path.getsize(local_path) / 1024
    print(f'OK: {local_name} ({size_kb:.1f}KB) -> {remote}')

sftp.close()

# Verify
stdin, stdout, stderr = ssh.exec_command(
    "ls -la /var/www/pvhot/index.html /var/www/pvhot/sitemap.xml "
    "/var/www/pvhot/robots.txt /var/www/pvhot/og-image.png 2>&1"
)
print('=== Sizes ===')
print(stdout.read().decode())

# HTTP check
stdin, stdout, stderr = ssh.exec_command(
    "curl -s -o /dev/null -w '%{http_code}' https://pvhot.bbroot.com/ && echo ' index.html'; "
    "curl -s -o /dev/null -w '%{http_code}' https://pvhot.bbroot.com/sitemap.xml && echo ' sitemap.xml'; "
    "curl -s -o /dev/null -w '%{http_code}' https://pvhot.bbroot.com/robots.txt && echo ' robots.txt'; "
    "curl -s -o /dev/null -w '%{http_code}' https://pvhot.bbroot.com/og-image.png && echo ' og-image.png'"
)
print('=== HTTP ===')
print(stdout.read().decode())

ssh.close()
print('Deploy done!')
