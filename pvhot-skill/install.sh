#!/usr/bin/env bash
# PV HOT Skill 安装脚本
# 用法：bash <(curl -fsSL https://pvhot.bbroot.com/pvhot-skill/install.sh) --target <平台>
# 支持平台：claude codex gemini copilot opencode agents
set -euo pipefail

ORIGIN="https://pvhot.bbroot.com"
TARGET=""

# 解析参数（支持 --target claude 或 claude 两种写法）
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 || true ;;
    --target=*) TARGET="${1#--target=}"; shift ;;
    -*) echo "未知参数: $1" >&2; exit 1 ;;
    *) TARGET="$1"; shift ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "用法: $0 --target <claude|codex|gemini|copilot|opencode|agents>" >&2
  exit 1
fi

# 平台 → 用户级 skills 目录
case "$TARGET" in
  claude)  DIR="$HOME/.claude/skills/pvhot" ;;
  codex)   DIR="${CODEX_HOME:-$HOME/.codex}/skills/pvhot" ;;
  gemini)  DIR="$HOME/.gemini/skills/pvhot" ;;
  copilot) DIR="$HOME/.copilot/skills/pvhot" ;;
  opencode) DIR="$HOME/.config/opencode/skills/pvhot" ;;
  agents)  DIR="$HOME/.agents/skills/pvhot" ;;
  *)
    echo "未知平台: $TARGET" >&2
    echo "支持: claude codex gemini copilot opencode agents" >&2
    exit 1 ;;
esac

echo "→ 目标目录: $DIR"
mkdir -p "$DIR"

echo "→ 下载 SKILL.md"
curl -fsSL "$ORIGIN/pvhot-skill/SKILL.md" -o "$DIR/SKILL.md"

echo "→ 下载 README.md"
if curl -fsSL "$ORIGIN/pvhot-skill/README.md" -o "$DIR/README.md" 2>/dev/null; then
  :
fi

echo ""
echo "✅ 已安装 PV HOT Skill 到 $DIR"
echo ""
echo "请重启或新开一个 Agent 会话，再问："
echo "  过去 24 小时光伏行业最重要的 5 件事是什么？"
echo ""
echo "（成功标志：回答注明\"过去 24 小时\"，给出 5 条以内中文摘要，并链接到 PV HOT 阅读页）"
