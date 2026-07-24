#!/usr/bin/env python3
"""Deploy stats/status feature: upload files, restart admin, verify endpoints."""
import paramiko, sys, time

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ROOT  = '/var/www/pvhot'
files = [
    ('admin_server.js', f'{ROOT}/admin_server.js'),
    ('admin.html', f'{ROOT}/admin.html'),
    ('app.js', f'{ROOT}/app.js'),
    ('index.html', f'{ROOT}/index.html'),
]

print('=== Deploying stats/status feature ===')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

# Upload files
sftp = ssh.open_sftp()
for local, remote in files:
    local_path = f'C:\\Users\\HUASUN\\Desktop\\新闻\\{local}'
    print(f'  Uploading {local} -> {remote}')
    sftp.put(local_path, remote)
    # Verify
    st = sftp.stat(remote)
    print(f'    OK: {st.st_size} bytes')
sftp.close()

# Restart admin server
print('\n=== Restarting pvhot-admin ===')
stdin, stdout, stderr = ssh.exec_command('systemctl restart pvhot-admin && sleep 1 && systemctl is-active pvhot-admin')
out = stdout.read().decode().strip()
err = stderr.read().decode().strip()
print(f'  Active: {out}')
if err: print(f'  Stderr: {err}')

# Test track endpoint
print('\n=== Testing /api/track ===')
stdin, stdout, stderr = ssh.exec_command(
    '-d \'{"path":"/","ref":""}\''
)
out = stdout.read().decode().strip()
print(f'  Response: {out}')

# Test public stats endpoint
print('\n=== Testing /api/stats (public) ===')
stdin, stdout, stderr = ssh.exec_command(
)
out = stdout.read().decode().strip()
print(f'  Response: {out}')

# Test admin stats endpoint (needs auth - expect 401)
print('\n=== Testing /admin/api/stats (expect 401 without auth) ===')
stdin, stdout, stderr = ssh.exec_command(
)
out = stdout.read().decode().strip()
print(f'  Response: {out}')

# Test through nginx (external)
print('\n=== Testing through nginx (external) ===')
stdin, stdout, stderr = ssh.exec_command(
    '-d \'{"path":"/test","ref":"https://google.com"}\' '
)
out = stdout.read().decode().strip()
print(f'  /api/track: {out}')

stdin, stdout, stderr = ssh.exec_command(
)
out = stdout.read().decode().strip()
print(f'  /api/stats: {out}')

# Check stats.json was created
print('\n=== Checking stats.json ===')
stdin, stdout, stderr = ssh.exec_command(f'cat {ROOT}/stats.json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d,indent=2,ensure_ascii=False))" 2>/dev/null || echo "NOT CREATED"')
out = stdout.read().decode().strip()
print(f'  stats.json: {out[:500]}')

# Verify admin page has stats tab
print('\n=== Verifying admin.html has stats tab ===')
stdin, stdout, stderr = ssh.exec_command(f'grep -c "panelStats" {ROOT}/admin.html')
out = stdout.read().decode().strip()
print(f'  panelStats count: {out}')

# Verify app.js has tracking beacon
stdin, stdout, stderr = ssh.exec_command(f'grep -c "api/track" {ROOT}/app.js')
out = stdout.read().decode().strip()
print(f'  api/track in app.js: {out}')

# Final: POST to /api/ping to verify nginx proxy works
print('\n=== Nginx proxy verify (GET /api/ping) ===')
stdin, stdout, stderr = ssh.exec_command(
    'curl -s -o /dev/null -w "%{http_code}" https://pvhot.bbroot.com/api/ping '
    '-d \'{}\' --max-time 10'
)
out = stdout.read().decode().strip()
print(f'  HTTP status: {out} (expect 400 = endpoint reachable)')

ssh.close()
print('\n=== Deploy complete ===')
