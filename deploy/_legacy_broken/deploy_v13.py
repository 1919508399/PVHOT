"""上传 index.html / styles.css / app.js 到服务器，验证线上"""
import paramiko
import sys

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
LOCAL_DIR = r"C:\Users\HUASUN\Desktop\新闻"
REMOTE_DIR =
FILES = ["index.html", "styles.css", "app.js"]

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    for f in FILES:
        local = LOCAL_DIR + "\\" + f
        remote = REMOTE_DIR + "/" + f
        sftp.put(local, remote)
        print("[put]", remote)
    sftp.close()

    # 验证
    cmd = (
        "echo '--- HTTP status ---'; "
        "  printf '  %-12s ' $u; curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1$u; "
        "echo '--- 关键代码就位确认 ---'; "
        "echo -n '  topbar 块残留: '; grep -c '<header class=\"topbar\">' /var/www/pvhot/index.html; "
        "echo -n '  mb-tab 块就位: '; grep -c 'mb-tab-item' /var/www/pvhot/index.html; "
        "echo -n '  mb-sheet 块就位: '; grep -c 'mb-sheet-item' /var/www/pvhot/index.html; "
        "echo -n '  bindMbTab 就位: '; grep -c 'bindMbTab' /var/www/pvhot/app.js; "
        "echo -n '  移动端日头 就位: '; grep -c '今天 / 昨天' /var/www/pvhot/app.js; "
        "echo -n '  顶栏 CSS 删除: '; grep -c '\\.topbar {' /var/www/pvhot/styles.css; "
        "echo -n '  mb-tab CSS 就位: '; grep -c 'mb-tab {' /var/www/pvhot/styles.css; "
        "echo -n '  mb-sheet CSS 就位: '; grep -c 'mb-sheet {' /var/www/pvhot/styles.css"
    )
    stdin, stdout, stderr = c.exec_command(cmd)
    out = stdout.read().decode("utf-8", "ignore")
    err = stderr.read().decode("utf-8", "ignore")
    print(out)
    if err.strip():
        print("[err]", err)
    c.close()

if __name__ == "__main__":
    main()
