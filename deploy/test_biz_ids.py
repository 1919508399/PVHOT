#!/usr/bin/env python3
"""Test all known biz IDs with RSSHub freewechat route"""
import paramiko
import json
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', username='root', password='369287zjb@1998', timeout=10)

def run(cmd, timeout=25):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# All biz IDs found from freewechat search + article links
biz_candidates = {
    # From profile links (confirmed account names)
    '光伏們': 'MzAxNjU2NjAyNA==',
    'PV-Tech': 'MjM5MzI1NzEyMA==',
    '风芒能源': 'MzU1NDY3OTAyNw==',
    '储能与电力市场': 'Mzg2Mjc2MzQ4Mg==',
    '北极星分布式光伏': 'MzA5MDMwMDc1MQ==',
    '光伏见闻': 'MzAwNTM2NzYxNA==',
    '天合跟踪': 'Mzg4NTY5MjUxMg==',
    '天合光能系统解决方案': 'Mzg2NTg0MzAxMg==',
    '中关村储能产业技术联盟': 'MjM5MzUwNzk2Mg==',
    '上海证券报': 'MjM5MDIwNDEyMg==',
    '宜良网': 'MzU3NjY3ODY5NA==',
    '市值观察': 'MzI0MTU0MzgwMA==',
    
    # From article links (biz IDs appearing in article URLs, need to verify account name)
    '光伏资讯': 'MzA3NjQxMjkxOA==',
    '光伏政策': 'MzIyNzE4MjM3Nw==',
    '华晟新能源_候选1': 'MzA3MTQ2MzQxMg==',
    '光伏发电': 'MzI4MzkzMzkwNw==',
    '环球零碳': 'Mzg3OTcxNTY5Nw==',
    '光伏全球': 'MzI3NTY5MTY5OQ==',
    'ACMI硅基新材料': 'MzkwNzM4NDI2Mg==',
    '昱能科技': 'MjM5MzY2NDE2NA==',
    '光伏太阳能发电': 'MzI4MzkzMzkwNw==',
    '未知_1': 'MzA3MTY3MjUxOQ==',
    '未知_2': 'Mzg3NzcwNjg5OQ==',
    '未知_3': 'MzA3NDYzNTgxNg==',
    '未知_4': 'MjM5MDMwMDI1MA==',
}

print("=== Testing biz IDs with RSSHub freewechat route ===")
working = {}

for name, biz in biz_candidates.items():
    out, _ = run(f'curl -s "http://127.0.0.1:1200/freewechat/profile/{biz}" 2>/dev/null | grep -c "<item>"')
    count_str = out.strip()
    count = int(count_str) if count_str and count_str.isdigit() else 0
    
    if count > 0:
        # Get the channel title (first <title> tag is the feed title)
        out2, _ = run(f'curl -s "http://127.0.0.1:1200/freewechat/profile/{biz}" 2>/dev/null | grep -o "<title>[^<]*</title>" | head -1')
        feed_title = out2.strip().replace('<title>', '').replace('</title>', '').replace(' | 自由微信 | FreeWeChat', '').strip()
        
        # Get first article title
        out3, _ = run(f'curl -s "http://127.0.0.1:1200/freewechat/profile/{biz}" 2>/dev/null | grep -o "<title>[^<]*</title>" | tail -1')
        article_title = out3.strip().replace('<title>', '').replace('</title>', '')[:60]
        
        print(f"  [OK] {name}: biz={biz[:20]} -> {count} items")
        print(f"       Feed: {feed_title} | Latest: {article_title}")
        working[name] = {'biz': biz, 'items': count, 'feed_title': feed_title, 'article': article_title}
    else:
        print(f"  [FAIL] {name}: biz={biz[:20]} -> 0 items")
    
    time.sleep(0.5)

print(f"\n=== {len(working)} working feeds ===")
for name, info in working.items():
    print(f"  {name} ({info['feed_title']}) -> {info['biz']} [{info['items']} items]")

# Save
with open('wechat_working_feeds.json', 'w', encoding='utf-8') as f:
    json.dump(working, f, ensure_ascii=False, indent=2)

ssh.close()
print("\n[Done]")
