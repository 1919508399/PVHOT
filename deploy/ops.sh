#!/usr/bin/env bash
# PVHOT 运维脚本（在服务器上执行，需 sudo）
# 用法：sudo /opt/pvhot-app/ops.sh <命令>
set -euo pipefail
APP=/opt/pvhot-app
cd "$APP"
DC="docker compose -f $APP/docker-compose.yml"

case "${1:-help}" in
  status)
    $DC ps
    echo "--- 今日入库："
    $DC exec -T db psql -U pvhot -d pvhot -tAc \
      "select count(*) || ' 条，最新 ' || to_char(max(discovered_at), 'MM-DD HH24:MI') from articles where discovered_at > now() - interval '1 day'"
    ;;
  logs)
    $DC logs --tail=150 "${2:-api}"
    ;;
  restart)
    $DC restart "${2:-api worker web}"
    ;;
  up)
    $DC up -d
    ;;
  down)
    $DC down
    ;;
  update)
    # 代码更新后重建并重启（例：把新代码覆盖到 /opt/pvhot-app 后运行）
    $DC up -d --build
    ;;
  key)
    # 设置大模型密钥：sudo ops.sh key <API_KEY> [BASE_URL] [MODEL]
    if [ $# -lt 2 ]; then echo "用法: sudo ops.sh key <API_KEY> [BASE_URL] [MODEL]"; exit 1; fi
    sed -i "s|^LLM_API_KEY=.*|LLM_API_KEY=$2|" "$APP/.env"
    [ $# -ge 3 ] && sed -i "s|^LLM_BASE_URL=.*|LLM_BASE_URL=$3|" "$APP/.env"
    [ $# -ge 4 ] && sed -i "s|^LLM_MODEL=.*|LLM_MODEL=$4|" "$APP/.env"
    $DC up -d api worker web
    echo "已写入密钥并重启 api / worker / web"
    ;;
  admin-password)
    # 查看或重设后台密码：sudo ops.sh admin-password [新密码]
    if [ $# -ge 2 ]; then
      sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$2|" "$APP/.env"
      $DC up -d api worker web
      echo "后台密码已重设"
    else
      grep '^ADMIN_PASSWORD=' "$APP/.env"
    fi
    ;;
  backup)
    mkdir -p "$APP/backups"
    $DC exec -T db pg_dump -U pvhot pvhot | gzip > "$APP/backups/pvhot-$(date +%Y%m%d-%H%M).sql.gz"
    ls -1t "$APP/backups"/*.sql.gz | tail -n +8 | xargs -r rm -f
    echo "备份完成，保留最近 7 份"
    ;;
  *)
    echo "可用命令：status | logs [服务名] | restart [服务名] | up | down | update | key <API_KEY> | admin-password [新密码] | backup"
    ;;
esac
