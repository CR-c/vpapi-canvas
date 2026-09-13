#!/usr/bin/env bash
#
# 把上游 main 合并进当前分支。
#
#   ./scripts/sync-upstream.sh
#
# 上游远程默认是 origin（basketikun/infinite-canvas），可用环境变量覆盖：
#   UPSTREAM_REMOTE=upstream UPSTREAM_BRANCH=main ./scripts/sync-upstream.sh
#
# 出现冲突时会列出文件并以非 0 退出，按 FORK.md 的冲突处理手册解决后重新提交。

set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-origin}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
    echo "找不到远程 $UPSTREAM_REMOTE，请先添加上游远程（见 FORK.md）。" >&2
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "工作区有未提交改动，请先提交或 stash 后再同步。" >&2
    exit 1
fi

echo "拉取 $UPSTREAM_REMOTE/$UPSTREAM_BRANCH ..."
git fetch --no-tags "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"

if git merge-base --is-ancestor "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" HEAD; then
    echo "已经是最新的上游代码，无需合并。"
    exit 0
fi

if git merge --no-edit "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"; then
    echo
    echo "合并完成。下一步："
    echo "  cd web && npm run typecheck && npm run build"
    echo "  然后按 FORK.md 复核补丁点，再 git push"
    exit 0
fi

echo >&2
echo "合并出现冲突，涉及以下文件：" >&2
git diff --name-only --diff-filter=U >&2
echo >&2
echo "请按 FORK.md 的冲突处理手册逐个解决，然后：" >&2
echo "  git add <文件> && git commit" >&2
echo "  cd web && npm run typecheck && npm run build" >&2
exit 1
