import paramiko

HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
REMOTE  = '/var/www/pvhot'
LOCAL = r'C:\Users\HUASUN\Desktop\新闻\deploy\test_rss2.js'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=20)

sftp = ssh.open_sftp()
sftp.put(LOCAL, REMOTE)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('cd /var/www/pvhot && node test_rss2.js 2>&1')
print("=== STDOUT ===")
print(stdout.read().decode('utf-8', 'replace'))
err = stderr.read().decode('utf-8', 'replace')
if err.strip():
    print("=== STDERR ===")
    print(err)

ssh.exec_command(f'rm -f {REMOTE}')
ssh.close()
