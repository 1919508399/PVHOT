import paramiko

HOST = "47.250.92.231"; PORT = 22; USER = "root"; PASS =
def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PASS, timeout=10, allow_agent=False, look_for_keys=False)
    print("[connected]")

    # 1) 读取日志
    print("===== /root/https_finish.log =====")
    stdin, stdout, stderr = c.exec_command("cat /root/https_finish.log 2>/dev/null; echo; echo '---EXIT---'", timeout=30)
    log = stdout.read().decode("utf-8", "ignore")
    print(log)

    # 2) 验证 HTTPS
    print("===== curl -sI https://pvhot.bbroot.com/ =====")
    stdin, stdout, stderr = c.exec_command("curl -sI https://pvhot.bbroot.com/ --max-time 15", timeout=30)
    out = stdout.read().decode("utf-8", "ignore")
    print(out if out.strip() else "(no response / empty)")

    c.close()

if __name__ == "__main__":
    main()
