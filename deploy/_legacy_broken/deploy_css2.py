import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
LOCAL = r"C:\Users\HUASUN\Desktop\新闻\styles.css"
REMOTE  = '/var/www/pvhot'
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
sftp.put(LOCAL, REMOTE)
sftp.close()
print("[put]", REMOTE)

cmd = (
    "echo '--- HTTP ---'; "
    "curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1/styles.css; "
    "echo '--- 关键新规则 ---'; "
    "grep -c 'tl-featured\\|tl-srcname\\|tl-srctype\\|tl-num' /var/www/pvhot/styles.css; "
    "echo '--- 时间线点已隐藏 ---'; "
    "grep -E 'tl-time.*display.*none' /var/www/pvhot/styles.css | head -1; "
    "echo '--- 推荐理由黄色背景 ---'; "
    "grep -E 'tl-reason.*fff8e3|6b4d00' /var/www/pvhot/styles.css | head -2"
)
si, so, se = c.exec_command(cmd)
print(so.read().decode("utf-8", "ignore"))
print("[err]", se.read().decode("utf-8", "ignore"))
c.close()
