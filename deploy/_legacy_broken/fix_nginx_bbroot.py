"""把 pvhot.bbroot.com 加到 nginx server_name，移除无效的旧域名（duckdns/gpuia）"""
import paramiko, sys

HOST  = '47.250.92.231'
PORT = 22
USER  = 'root'
PASS  = '369287zjb@1998'
# 新 server_name 列表：bbroot 为主，其余保留
NEW_SERVER_NAME =
CONF_PATH =
OLD_BLOCK =
CMD = f"""
set -e
grep -n 'server_name' {CONF_PATH} || true
echo
sed -n '1,30p' {CONF_PATH}
echo
sed -i 's|^\\s*server_name.*|    server_name {NEW_SERVER_NAME};|' {CONF_PATH}
echo
sed -n '1,30p' {CONF_PATH}
nginx -t
nginx -s reload
echo
curl -sI http://127.0.0.1/ | head -1
curl -sI http://47.250.92.231/ | head -1
echo
curl -sI -H "Host: pvhot.bbroot.com" http://127.0.0.1/ | head -3
"""

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    print("[connected]")
    stdin, stdout, stderr = c.exec_command(CMD, timeout=30)
    out = stdout.read().decode("utf-8", "ignore")
    err = stderr.read().decode("utf-8", "ignore")
    print("===== STDOUT =====")
    print(out)
    if err.strip():
        print("===== STDERR =====")
        print(err)
    c.close()

if __name__ == "__main__":
    main()
