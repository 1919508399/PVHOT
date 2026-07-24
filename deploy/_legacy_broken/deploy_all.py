"""上传前端(app.js/styles.css)与抓取脚本(fetch_pv_news.js)到服务器，立即跑一次抓取并验证"""
import paramiko, os

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
FILES = [
    (r"C:\Users\HUASUN\Desktop\新闻\app.js",            "/var/www/pvhot/app.js"),
    (r"C:\Users\HUASUN\Desktop\新闻\styles.css",        "/var/www/pvhot/styles.css"),
    (r"C:\Users\HUASUN\Desktop\新闻\deploy\fetch_pv_news.js", "/var/www/pvhot/fetch_pv_news.js"),
]

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    for local, remote in FILES:
        sftp.put(local, remote)
        print("[put]", os.path.basename(local), "->", remote)
    sftp.close()

    # 立即跑一次抓取
    print("[run fetch] ...")
    stdin, stdout, stderr = c.exec_command("/usr/bin/node /var/www/pvhot/fetch_pv_news.js; echo EXIT:$?", timeout=180)
    out = stdout.read().decode("utf-8", "ignore")
    print(out)
    print("[stderr]", stderr.read().decode("utf-8", "ignore"))

    # 验证：统计语言分布 + 翻译数 + 抽样
    verify = (
        "node -e \""
        "const d=JSON.parse(require('fs').readFileSync('/var/www/pvhot/data.json'));"
        "const zh=items.filter(i=>i.lang==='zh').length;"
        "const en=items.filter(i=>i.lang==='en').length;"
        "console.log('items='+items.length+' zh='+zh+' en='+en+' translated='+tr);"
        "console.log('--- 抽样(前6条 title / title_cn) ---');"
        "items.slice(0,6).forEach((i,n)=>console.log((n+1)+'. ['+i.lang+'] '+i.title+(i.title_cn?('  =>译: '+i.title_cn):'')));"
        "\""
    )
    stdin, stdout, stderr = c.exec_command(verify)
    print(stdout.read().decode("utf-8", "ignore"))
    print("[verr]", stderr.read().decode("utf-8", "ignore"))
    c.close()

if __name__ == "__main__":
    main()
