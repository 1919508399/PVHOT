import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("47.250.92.231", username="root", password="369287zjb@1998", timeout=30)

for cmd in [
    "cat /etc/os-release 2>/dev/null | head -6",
    "echo '--- pkg mgr ---'; which yum dnf apt apt-get apk zypper 2>/dev/null",
    "echo '--- nginx ---'; which nginx 2>/dev/null; nginx -v 2>&1 | head -1",
    "echo '--- svc ---'; which systemctl service 2>/dev/null",
    "echo '--- firewall ---'; which ufw firewall-cmd iptables 2>/dev/null",
    "echo '--- python/node ---'; which python3 node 2>/dev/null",
]:
    stdin, stdout, stderr = ssh.exec_command(cmd)
    print("=== " + cmd.split(chr(10))[0])
    print(stdout.read().decode(errors="replace"))
    e = stderr.read().decode(errors="replace").strip()
    if e: print("[err]", e)

ssh.close()
