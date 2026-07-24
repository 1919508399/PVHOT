"""上传 fetch_pv_news.js 到服务器，配 crontab 每小时抓取，并立即跑一次验证"""
import paramiko, os

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
LOCAL = r"C:\Users\HUASUN\Desktop\新闻\deploy\fetch_pv_news.js"
REMOTE  = '/var/www/pvhot'
CRON =
def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)

    # 1) 上传
    sftp = c.open_sftp()
    sftp.put(LOCAL, REMOTE)
    sftp.close()
    print("[uploaded]", REMOTE)

    # 2) crontab（去重后追加）
    cmd_cron = "(crontab -l 2>/dev/null | grep -v fetch_pv_news; echo '" + CRON + "') | crontab -"
    stdin, stdout, stderr = c.exec_command(cmd_cron)
    print("[cron]", stdout.read().decode().strip(), stderr.read().decode().strip())
    stdin, stdout, stderr = c.exec_command("crontab -l")
    print("[crontab -l]\n" + stdout.read().decode().strip())

    # 3) 立即跑一次
    print("[run once] ...")
    stdin, stdout, stderr = c.exec_command("/usr/bin/node " + REMOTE + "; echo EXIT:$?", timeout=150)
    print(stdout.read().decode("utf-8", "ignore"))
    print("[stderr]", stderr.read().decode("utf-8", "ignore"))

    # 4) 验证产物
    stdin, stdout, stderr = c.exec_command(
        "echo '--- head ---'; head -c 500 /var/www/pvhot/data.json; "
        "echo; echo '--- items count ---'; "
        "/usr/bin/node -e \"console.log(JSON.parse(require('fs').readFileSync('/var/www/pvhot/data.json')).items.length)\""
    )
    print(stdout.read().decode("utf-8", "ignore"))

    c.close()

if __name__ == "__main__":
    main()
