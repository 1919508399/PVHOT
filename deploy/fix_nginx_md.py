import paramiko

HOST='47.250.92.231'; USER='root'; PASS='369287zjb@1998'
CONF='/etc/nginx/conf.d/pvhot.conf'

ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, 22, USER, PASS, timeout=20)

cmd = "/usr/bin/node -e \"const fs=require('fs');const f='/etc/nginx/conf.d/pvhot.conf';let s=fs.readFileSync(f,'utf8');const old='location ~* \\\\.md$ { charset utf-8; }';const nw='location ~* \\\\.md$ { default_type text/plain; charset utf-8; }';if(s.indexOf(old)>=0){s=s.replace(old,nw);fs.writeFileSync(f,s);console.log('PATCHED');}else{console.log('NO_MATCH');}\""
si,so,se = ssh.exec_command(cmd, timeout=15)
print('[patch]', so.read().decode().strip(), se.read().decode().strip())

si,so,se = ssh.exec_command('nginx -t 2>&1 | tail -2', timeout=15)
print('[nginx -t]', so.read().decode().strip(), se.read().decode().strip())

si,so,se = ssh.exec_command('nginx -s reload', timeout=15)
print('[reload]', so.read().decode().strip(), se.read().decode().strip())

si,so,se = ssh.exec_command("curl -sI https://pvhot.bbroot.com/pvhot-skill/SKILL.md | grep -i content-type", timeout=15)
print('[verify] SKILL.md Content-Type:', so.read().decode().strip())

# 铁律：改 conf 后必须 GET /api/ping 验证 200
si,so,se = ssh.exec_command("curl -s -o /dev/null -w '%{http_code}' https://pvhot.bbroot.com/api/ping'", timeout=15)
print('[verify] GET /api/ping:', so.read().decode().strip())

ssh.exec_command("/usr/bin/node -e \"const fs=require('fs');const f='/var/www/pvhot/feedback.json';let l=[];try{l=JSON.parse(fs.readFileSync(f))}catch(e){};l=l.filter(x=>x.msg!=='E2E nginx md');fs.writeFileSync(f,JSON.stringify(l,null,2))\"")
ssh.close()
print('DONE')
