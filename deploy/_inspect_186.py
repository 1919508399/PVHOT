import paramiko, json
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', 22, 'root', '369287zjb@1998', timeout=10)
cmd = """node -e "const d=JSON.parse(require('fs').readFileSync('/var/www/pvhot/data.json','utf8'));const it=d.items.find(x=>x.title_cn&&x.title_cn.indexOf('Genus')!==-1);console.log('title_cn:');console.log(it.title_cn);console.log('---summary:');console.log(it.summary);console.log('---title(英文原):');console.log(it.title);console.log('---title_cn长度:',it.title_cn.length);console.log('---summary长度:',it.summary.length);console.log('---title_cn最后30字:',JSON.stringify(it.title_cn.slice(-30)));console.log('---summary最后30字:',JSON.stringify(it.summary.slice(-30)));" """
i,o,e = ssh.exec_command(cmd)
print('STDOUT:', o.read().decode())
print('STDERR:', e.read().decode()[:300])
ssh.close()
