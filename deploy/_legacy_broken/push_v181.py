"""v18.1 fix: 反馈 success 文案 + 删 offline-tip
- 推 app.js / styles.css
- 强制刷新（用 ?v= 时间戳让浏览器跳缓存）
- 验证：feedback.json 重置 → 前台提交反馈 → 后台立刻收到
- 验证：fetch 失败时不再弹底部提示条
"""
import paramiko, time, json, sys
from pathlib import Path

REMOTE  = '/var/www/pvhot'
HOST  = '47.250.92.231'
USER  = 'root'
PASS  = '369287zjb@1998'
LOCAL_BASE = Path(r"C:/Users/HUASUN/Desktop/新闻")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=20)
sftp = c.open_sftp()
def run(cmd):
    si,so,se = c.exec_command(cmd)
    return so.read().decode(errors='replace')
def push(local_name, remote_name=None):
    rn = remote_name or local_name
    sftp.put(str(LOCAL_BASE / local_name), f"{REMOTE}/{rn}")
    print(f"  pushed {local_name} -> {REMOTE}/{rn}")

print("=== 1) 重置 feedback.json ===")
run('echo [] > /var/www/pvhot/feedback.json')
time.sleep(0.3)
print("  feedback.json:", run('cat /var/www/pvhot/feedback.json').strip())

print("=== 2) 推 app.js / styles.css ===")
push("app.js")
push("styles.css")

# 校验落盘
print("=== 3) 校验关键字符串 ===")
for pat, fname, expect in [
    ("已发送到站长后台", "app.js", True),
    ("当前使用内嵌数据", "app.js", False),
    ("已添加到剪贴板", "app.js", False),
    (".offline-tip {", "styles.css", False),
]:
    out = run(f"grep -c '{pat}' {REMOTE}/{fname}").strip()
    hit = out !=
    status = "OK" if (hit == expect) else
    print(f"  [{status}] {fname} 包含 {pat!r}: {hit}  (期望 {expect})")
