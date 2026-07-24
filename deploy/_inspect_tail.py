import paramiko, re
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('47.250.92.231', 22, 'root', '369287zjb@1998', timeout=10)
cmd = r"""node -e "const d=JSON.parse(require('fs').readFileSync('/var/www/pvhot/data.json','utf8'));const tail=new Set();d.items.forEach(it=>{const t=it.title_cn||'';if(t.length<8)return;const tail30=t.slice(-30);tail.add(tail30);});console.log('--- unique tail30 of title_cn ---');[...tail].sort().forEach(x=>console.log(JSON.stringify(x)));" """
i,o,e = ssh.exec_command(cmd)
print(o.read().decode()[:6000])
ssh.close()
