import paramiko, os

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
REMOTE  = '/var/www/pvhot'
LOCAL = r'C:\Users\HUASUN\Desktop\新闻\deploy\test_rss.js'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

# 上传测试脚本
sftp = ssh.open_sftp()
sftp.put(LOCAL, REMOTE)
sftp.close()

# 运行
stdin, stdout, stderr = ssh.exec_command('cd /var/www/pvhot && node test_rss.js 2>&1')
out = stdout.read().decode('utf-8', 'replace')
err = stderr.read().decode('utf-8', 'replace')
print("=== STDOUT ===")
print(out)
if err.strip():
    print("=== STDERR ===")
    print(err)

ssh.exec_command(f'rm -f {REMOTE}')
ssh.close()
