#!/usr/bin/env python3
"""E2E test: login -> get stats -> get status -> verify all data."""
import paramiko, json, sys

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    return stdout.read().decode().strip(), stderr.read().decode().strip()

print('=== E2E: Admin Stats Test ===\n')

# 1. Login
print('1. Login...')
out, err = run(
    '-d \'{"pass":"pvhot2026"}\''
)
print(f'   {out}')

# 2. Get stats (admin)
print('\n2. GET /admin/api/stats (with auth)...')
out, err = run(
)
try:
    d = json.loads(out)
    print(f'   today.pv = {d.get("today",{}).get("pv")}')
    print(f'   today.uv = {d.get("today",{}).get("uv")}')
    print(f'   total.pv = {d.get("total",{}).get("pv")}')
    print(f'   total.uv = {d.get("total",{}).get("uv")}')
    print(f'   rsshub = {d.get("rsshub")}')
    last7 = d.get('last7', [])
    print(f'   last7 days: {len(last7)} entries')
    for day in last7:
        print(f'     {day["date"]}: pv={day["pv"]}, uv={day["uv"]}')
    topPaths = d.get('today', {}).get('topPaths', [])
    print(f'   topPaths: {topPaths[:5]}')
    topRefs = d.get('today', {}).get('topRefs', [])
    print(f'   topRefs: {topRefs[:5]}')
except Exception as e:
    print(f'   ERROR parsing: {e}')
    print(f'   Raw: {out[:300]}')

# 3. Get status (admin)
print('\n3. GET /admin/api/status (with auth)...')
out, err = run(
)
try:
    d = json.loads(out)
    print(f'   items = {d.get("items")}')
    print(f'   categories = {d.get("categories")}')
    print(f'   dataSize = {d.get("dataSize")}')
    print(f'   rawSize = {d.get("rawSize")}')
    print(f'   rawMtime = {d.get("rawMtime")}')
    print(f'   logMtime = {d.get("logMtime")}')
    print(f'   rsshub = {d.get("rsshub")}')
    print(f'   deletedCount = {d.get("deletedCount")}')
    print(f'   overrideCount = {d.get("overrideCount")}')
    print(f'   addedCount = {d.get("addedCount")}')
    print(f'   disk = {d.get("disk")}')
    print(f'   memRSS = {d.get("memRSS")}')
    print(f'   memHeap = {d.get("memHeap")}')
    print(f'   uptime = {d.get("uptime")}')
    lastLog = d.get('lastLog', [])
    print(f'   lastLog ({len(lastLog)} lines):')
    for line in lastLog[-3:]:
        print(f'     {line}')
except Exception as e:
    print(f'   ERROR parsing: {e}')
    print(f'   Raw: {out[:300]}')

# 4. Verify main site loads
print('\n4. Verify main site loads...')
out, err = run('curl -s -o /dev/null -w "%{http_code}" https://pvhot.bbroot.com/ --max-time 10')
print(f'   HTTP status: {out}')

# 5. Verify admin page loads
print('\n5. Verify admin page loads...')
out, err = run('curl -s -o /dev/null -w "%{http_code}" https://pvhot.bbroot.com/admin --max-time 10')
print(f'   HTTP status: {out}')

# 6. Simulate a few visits
print('\n6. Simulating visits...')
for i in range(3):
    out, err = run(
        f'curl -s https://pvhot.bbroot.com/api/track '
        f''
        f'-d \'{{"path":"/","ref":"https://baidu.com"}}\' --max-time 5'
    )
    print(f'   Visit {i+1}: {out}')

# 7. Check updated stats
print('\n7. Updated stats after visits...')
out, err = run('curl -s https://pvhot.bbroot.com/api/stats --max-time 10')
print(f'   {out}')

# Cleanup
run('rm -f /tmp/cookie.txt')
ssh.close()
print('\n=== E2E Test Complete ===')
