"""验证 data.json 抓取质量：分类分布 + 前几条标题"""
import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
CMD = r"""
/usr/bin/node -e "const d=JSON.parse(require('fs').readFileSync('/var/www/pvhot/data.json'));const c={};d.items.forEach(i=>c[i.category]=(c[i.category]||0)+1);console.log('总条数: '+d.items.length);console.log('分类分布: '+JSON.stringify(c));console.log('--- 前8条 ---');d.items.slice(0,8).forEach((i,n)=>console.log((n+1)+'. ['+i.category+'] '+i.title+' ('+i.pubTime+')'));"
"""

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    print("[connected]")
    stdin, stdout, stderr = c.exec_command(CMD, timeout=30)
    print(stdout.read().decode("utf-8", "ignore"))
    err = stderr.read().decode("utf-8", "ignore")
    if err.strip():
        print("STDERR:", err)
    c.close()

if __name__ == "__main__":
    main()
