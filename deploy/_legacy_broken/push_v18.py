"""v18 全量部署：5 文件 + 重启 pvhot-admin + 验证"""
import paramiko, os, time
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("47.250.92.231", username="root", password="369287zjb@1998", timeout=20)
def run(cmd, t=15):
    si, so, se = c.exec_command(cmd, timeout=t)
    return so.read().decode(errors='replace'), se.read().decode(errors='replace')

ROOT_LOCAL = r"C:\Users\HUASUN\Desktop\新闻"
REMOTE_DIR =
files = [
    ("index.html", REMOTE_DIR + "/index.html"),
    ("app.js", REMOTE_DIR + "/app.js"),
    ("styles.css", REMOTE_DIR + "/styles.css"),
    ("admin.html", REMOTE_DIR + "/admin.html"),
    ("admin_server.js", REMOTE_DIR + "/admin_server.js"),
    ("fetch_pv_news.js", REMOTE_DIR + "/fetch_pv_news.js"),
    ("site_texts.json", REMOTE_DIR + "/site_texts.json"),
]
# 同步生成 site_texts_fallback.js 推到服务器
import json
fb_local = os.path.join(ROOT_LOCAL, "site_texts_fallback.js")
with open(fb_local, "w", encoding="utf-8") as f:
    t = json.load(open(os.path.join(ROOT_LOCAL, "site_texts.json"), "r", encoding="utf-8"))
    f.write("// 由 deploy 同步自 site_texts.json\nwindow.SITE_TEXTS = " + json.dumps(t, ensure_ascii=False, indent=2) + ";\n")
files.append(("site_texts_fallback.js", REMOTE_DIR + "/site_texts_fallback.js"))
sftp = c.open_sftp()
for local, remote in files:
    lp = os.path.join(ROOT_LOCAL, os.path.basename(local))
    sftp.put(lp, remote)
    print("PUT", local, "->", remote)
sftp.close()

# 重启 pvhot-admin 让新 admin_server.js 生效
run("systemctl restart pvhot-admin")
time.sleep(2)
out, _ = run("systemctl is-active pvhot-admin")
print("service active:", out.strip())

# 验证：smoke test
print("\n=== smoke ===")
for p in ['/', '/admin/', '/data.json', '/site_texts.json', '/site_texts_fallback.js']:
    code, _ = run("curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1" + p)
    print(p, "->", code)

# /api/ping 公共端点测试（无登录）
print("\n=== /api/ping POST ===")
code, body = run("curl -s msg\":\"smoke test from push_v18.py\",\"email\":\"test@example.com\"}' --max-time 5 http://127.0.0.1/api/ping")
print("code:", code, "body:", body[:200])

# 检查 feedback.json 落地
out, _ = run("ls -la " + REMOTE_DIR + "/feedback.json && head -c 400 " + REMOTE_DIR + "/feedback.json")
print("\nfeedback.json:", out[:500])

# 测 texts API
out, _ = run("curl -s -c /tmp/c.txt pass\":\"pvhot2026\"}' --max-time 5 http://127.0.0.1/admin/api/login")
print("\nlogin:", out[:120])
out, _ = run("curl -s -b /tmp/c.txt --max-time 5 http://127.0.0.1/admin/api/texts")
print("texts len:", len(out), "preview:", out[:200])
out, _ = run("curl -s -b /tmp/c.txt --max-time 5 http://127.0.0.1/admin/api/ping")
print("fb list:", out[:300])

c.close()
print("\nDONE")
