import paramiko, json, os

HOST='47.250.92.231'; PORT=22; USER='root'; PASS='369287zjb@1998'
LOCAL=r'C:\Users\HUASUN\Desktop\新闻'
REMOTE='/var/www/pvhot'
CONF='/etc/nginx/conf.d/pvhot.conf'

# 1. 读 SKILL.md 注入 site_texts.json.agent.skill_md，并同步 fallback
sk = open(os.path.join(LOCAL,'pvhot-skill','SKILL.md'), encoding='utf-8').read()
st = json.load(open(os.path.join(LOCAL,'site_texts.json'), encoding='utf-8'))
st.setdefault('agent', {})['skill_md'] = sk
json.dump(st, open(os.path.join(LOCAL,'site_texts.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=2)
fb = '// 由 admin_server.js 同步自 site_texts.json\nwindow.SITE_TEXTS = ' + json.dumps(st, ensure_ascii=False, indent=2)
open(os.path.join(LOCAL,'site_texts_fallback.js'),'w',encoding='utf-8').write(fb)
print('[local] site_texts.json 已注入 skill_md; fallback 已同步')

ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASS, timeout=25)
sftp = ssh.open_sftp()
ssh.exec_command('mkdir -p ' + REMOTE + '/pvhot-skill')

upl = [
  ('pvhot-skill/SKILL.md','pvhot-skill/SKILL.md'),
  ('pvhot-skill/README.md','pvhot-skill/README.md'),
  ('pvhot-skill/install.sh','pvhot-skill/install.sh'),
  ('admin.html','admin.html'),
  ('admin_server.js','admin_server.js'),
  ('app.js','app.js'),
  ('site_texts.json','site_texts.json'),
  ('site_texts_fallback.js','site_texts_fallback.js'),
]
for lf, rf in upl:
    sftp.put(os.path.join(LOCAL, lf), REMOTE + '/' + rf)
    print('[upload]', lf)
sftp.close()

ssh.exec_command('chmod 755 ' + REMOTE + '/pvhot-skill')
ssh.exec_command('chmod 644 ' + REMOTE + '/pvhot-skill/* ' + REMOTE + '/site_texts.json ' + REMOTE + '/site_texts_fallback.js')

# 2. node 语法检查
for f in ['admin_server.js','app.js']:
    si,so,se = ssh.exec_command('/usr/bin/node -c ' + REMOTE + '/' + f + ' && echo OK_' + f, timeout=15)
    print('[syntax]', f, so.read().decode().strip(), se.read().decode().strip())

# 3. nginx：给 .md 加 utf-8 charset（仅影响 .md，不动全局）
si,so,se = ssh.exec_command('cat ' + CONF, timeout=10)
conf = so.read().decode('utf-8')
if 'charset utf-8' not in conf:
    ssh.exec_command('cp ' + CONF + ' ' + CONF + '.bak')
    nb  = '
'
    conf2 = conf.replace("    location / { try_files", nb + "    location / { try_files", 1)
    sftp2 = ssh.open_sftp()
    with sftp2.open(CONF, 'w') as f:
        f.write(conf2)
    sftp2.close()
    si,so,se = ssh.exec_command('nginx -t 2>&1', timeout=15)
    out = so.read().decode() + se.read().decode()
    if 'test failed' in out:
        ssh.exec_command('cp ' + CONF + '.bak ' + CONF + ' && nginx -s reload')
        print('[nginx] -t FAILED, rolled back:', out[:200])
    else:
        ssh.exec_command('nginx -s reload')
        print('[nginx] .md charset added + reloaded')
else:
    print('[nginx] already has charset, skip')

# 4. 重启后台
si,so,se = ssh.exec_command('systemctl restart pvhot-admin && sleep 1 && systemctl is-active pvhot-admin', timeout=20)
print('[systemd] pvhot-admin:', so.read().decode().strip())

# 5. 验证
def curl_info(url):
    si,so,se = ssh.exec_command("curl -s -o /dev/null -w '%{http_code} ct=%{content_type}' " + url, timeout=15)
    return so.read().decode().strip()
print('[verify] SKILL.md:', curl_info('https://pvhot.bbroot.com/pvhot-skill/SKILL.md'))
print('[verify] install.sh:', curl_info('https://pvhot.bbroot.com/pvhot-skill/install.sh'))
print('[verify] README.md:', curl_info('https://pvhot.bbroot.com/pvhot-skill/README.md'))

# 铁律：改 conf 后必须 GET /api/ping 验证 200
si,so,se = ssh.exec_command("curl -s -o /dev/null -w '%{http_code}' https://pvhot.bbroot.com/api/ping'", timeout=15)
print('[verify] GET /api/ping:', so.read().decode().strip())

# 清理测试反馈
ssh.exec_command("/usr/bin/node -e \"const fs=require('fs');const f='" + REMOTE + "/feedback.json';let l=[];try{l=JSON.parse(fs.readFileSync(f))}catch(e){};l=l.filter(x=>x.msg!=='E2E 部署验证');fs.writeFileSync(f,JSON.stringify(l,null,2))\"")
# SKILL.md 头部确认
si,so,se = ssh.exec_command("curl -s https://pvhot.bbroot.com/pvhot-skill/SKILL.md | head -c 60", timeout=15)
print('[verify] SKILL.md head:', so.read().decode('utf-8', errors='replace')[:60])

ssh.close()
print('DONE')
