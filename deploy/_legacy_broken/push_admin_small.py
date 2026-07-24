import paramiko, sys, os
HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
ROOT_LOCAL = r"C:\Users\HUASUN\Desktop\新闻"
REMOTE_DIR =
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=20)
sftp = c.open_sftp()
for name in ("index.html", "styles.css"):
    sftp.put(os.path.join(ROOT_LOCAL, name), f"{REMOTE_DIR}/{name}")
sftp.close()
# 顺手验证一下文件里关键标记已落
for name in ("index.html", "styles.css"):
    _, out, _ = c.exec_command(f"grep -c 'sb-icon-btn' {REMOTE_DIR}/{name}")
    n = out.read().decode().strip()
    print(f"{name} sb-icon-btn count: {n}")
# 关键行
for pat in ("sb-admin-btn", "sb-foot-row"):
    _, out, _ = c.exec_command(f"grep -c '{pat}' {REMOTE_DIR}/index.html {REMOTE_DIR}/styles.css")
    print(out.read().decode().strip())
c.close()
print("DONE")
