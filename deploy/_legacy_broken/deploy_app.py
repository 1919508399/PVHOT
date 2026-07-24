"""仅上传前端 app.js 到服务器（样式与抓取脚本已就位），并验证线上可访问"""
import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
LOCAL = r"C:\Users\HUASUN\Desktop\新闻\app.js"
REMOTE  = '/var/www/pvhot'
def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    sftp.put(LOCAL, REMOTE)
    sftp.close()
    print("[put]", REMOTE)

    # 验证 HTTP 可访问 + 内容含新逻辑
    cmd = (
        "echo '--- HTTP status ---'; "
        "curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1/app.js; "
        "echo '--- 是否含 preprocessData ---'; "
        "echo '--- data.json 抽样(译文字段) ---'; "
        "/usr/bin/node -e \"const d=JSON.parse(require('fs').readFileSync('/var/www/pvhot/data.json'));"
        "console.log('total='+d.items.length+' translated='+t);\""
    )
    stdin, stdout, stderr = c.exec_command(cmd)
    print(stdout.read().decode("utf-8", "ignore"))
    print("[err]", stderr.read().decode("utf-8", "ignore"))
    c.close()

if __name__ == "__main__":
    main()
