#!/usr/bin/env python3
"""Final fix: restore stripped HOST/USER/PASS constants"""
import os, re, ast

DEPLOY_DIR = r'C:\Users\HUASUN\Desktop\新闻\deploy'
HOST = '47.250.92.231'
USER = 'root'
PASS = '369287zjb@1998'
SUFFIXES = [
    (r'^\s*HOST\s*=\s*$',   HOST),
    (r'^\s*USER\s*=\s*$',   USER),
    (r'^\s*PASS\s*=\s*$',   PASS),
    (r'^\s*ROOT\s*=\s*$',   '/var/www/pvhot'),
    (r'^\s*PORT\s*=\s*$',   '22'),
    (r'^\s*CONF\s*=\s*$',   '/etc/nginx/conf.d/pvhot.conf'),
    (r'^\s*REMOTE\s*=\s*$', '/var/www/pvhot'),
    (r'^\s*LOCAL\s*=\s*$',  r'C:\\Users\\HUASUN\\Desktop\\新闻'),
    (r'^\s*nb\s*=\s*$',     '\\n'),
]

fixed_count = 0
for f in sorted(os.listdir(DEPLOY_DIR)):
    if not f.endswith('.py'): continue
    if f in {'inspect_feedback.py','fix_api_proxy.py','update_health_check.py',
             'force_replace.py','clean_curl.py','final_cleanup.py',
             'fix_4_files.py','complete_curl.py','remove_broken.py','restore_vars.py',
             'clean_feedback.py','fix_admin_syntax.py'}: continue
    path = os.path.join(DEPLOY_DIR, f)
    with open(path, encoding='utf-8') as fp:
        lines = fp.readlines()
    orig = lines[:]
    for i, line in enumerate(lines):
        stripped = line.rstrip()
        for pat, val in SUFFIXES:
            if re.match(pat, stripped):
                # 在 = 后加 'val'
                lines[i] = re.sub(r'=\s*$', " = '" + val + "'\n", line)
                break
    if lines != orig:
        with open(path, 'w', encoding='utf-8') as fp:
            fp.writelines(lines)
        fixed_count += 1

print('fixed:', fixed_count, 'files')
errs = 0
for f in sorted(os.listdir(DEPLOY_DIR)):
    if not f.endswith('.py'): continue
    try:
        ast.parse(open(os.path.join(DEPLOY_DIR, f), encoding='utf-8').read())
    except SyntaxError as e:
        print('  ERR', f, ': L'+str(e.lineno), e.msg, '|', repr(e.text))
        errs += 1
print('remaining errors:', errs)