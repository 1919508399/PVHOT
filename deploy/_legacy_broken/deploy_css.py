"""仅上传 styles.css 到服务器并验证线上可访问"""
import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
LOCAL = r"C:\Users\HUASUN\Desktop\新闻\styles.css"
REMOTE  = '/var/www/pvhot'
def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    sftp.put(LOCAL, REMOTE)
    sftp.close()
    print("[put]", REMOTE)

    cmd = (
        "echo '--- HTTP status ---'; "
        "curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1/styles.css; "
        "echo '--- 是否已修 ds-item 列宽 52px ---'; "
        "grep -n 'grid-template-columns: 52px' /var/www/pvhot/styles.css"
    )
    stdin, stdout, stderr = c.exec_command(cmd)
    print(stdout.read().decode("utf-8", "ignore"))
    print("[err]", stderr.read().decode("utf-8", "ignore"))
    c.close()

if __name__ == "__main__":
    main()
