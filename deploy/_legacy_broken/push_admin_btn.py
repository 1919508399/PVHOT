# -*- coding: utf-8 -*-
import paramiko, os

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("47.250.92.231", username="root", password="369287zjb@1998", timeout=20)
sftp = c.open_sftp()

local_dir = r"C:\Users\HUASUN\Desktop\新闻"
remote_dir =
for name in ("index.html", "styles.css"):
    local_path = os.path.join(local_dir, name)
    remote_path = f"{remote_dir}/{name}"
    with open(local_path, "rb") as f:, "wb") as f:
        f.write(data)
    print(f"uploaded {name}: {len(data)} bytes -> {remote_path}")
sftp.close()

# 验证
import urllib.request
for u in ("http://pvhot.bbroot.com/", "http://pvhot.bbroot.com/styles.css"):
    try:
        r = urllib.request.urlopen(u, timeout=10)
        body = r.read()
        print(f"GET {u} -> {r.status} ({len(body)} bytes)")
        if u.endswith("/"):
            checks = ["sb-admin-btn", "后台 Admin", "mb-sheet-arrow"]
            for k in checks:
                print(f"  contains {k!r}: {k.encode() in body}")
        if u.endswith("styles.css"):
            for k in ("sb-admin-btn", "sb-admin-ico", "sb-admin-arrow", "sb-foot-row", "mb-sheet-arrow"):
                print(f"  contains {k!r}: {k.encode() in body}")
    except Exception as e:
        print(f"GET {u} -> ERR {e}")
c.close()
