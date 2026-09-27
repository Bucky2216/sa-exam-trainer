# 备用上传通道：当 git 传输（github.com/<repo>.git）被网络阻断时，
# 改用 GitHub Contents API（api.github.com）把文件写进仓库。
#
# 用法：
#   python3 tools/upload_via_api.py                    # 上传全部文件
#   python3 tools/upload_via_api.py outputs/index.html # 只上传指定文件（可多个）
#
# 脚本会自动查询已有文件的 sha 再提交，因此可以重复运行做覆盖更新。
import base64
import json
import os
import subprocess
import sys

REPO = "Bucky2216/sa-exam-trainer"
# 以脚本所在位置推算项目根目录，换机器/换路径也能直接用
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FILES = [
    ("README.md", "文档：使用、部署与数据说明"),
    (".gitignore", "忽略本地 work 目录"),
    ("tools/check.js", "题库校验脚本"),
    ("tools/upload_via_api.py", "备用上传通道（git 被阻断时使用）"),
    ("index.html", "仓库首页：自动跳转到应用"),
    ("outputs/index.html", "应用本体：单文件离线题库（200 选择题 + 20 案例题）"),
]

TARGETS = sys.argv[1:] or [p for p, _ in FILES]


def current_sha(path):
    """取远程文件的 sha（文件不存在时返回 None），用于覆盖更新。"""
    proc = subprocess.run(
        ["gh", "api", "repos/%s/contents/%s" % (REPO, path), "--jq", ".sha"],
        capture_output=True, text=True,
    )
    sha = (proc.stdout or "").strip()
    return sha if proc.returncode == 0 and len(sha) == 40 else None


for path in TARGETS:
    desc = dict(FILES).get(path, "update")
    full = os.path.join(ROOT, path)
    with open(full, "rb") as f:
        content = base64.b64encode(f.read()).decode("ascii")
    payload = {
        "message": "add: %s（%s）" % (path, desc),
        "content": content,
        "branch": "main",
    }
    sha = current_sha(path)
    if sha:
        payload["sha"] = sha                      # 已存在则带上 sha，表示覆盖更新
        payload["message"] = "update: %s（%s）" % (path, desc)
    tmp = "/tmp/gh_payload_%s.json" % path.replace("/", "_")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    proc = subprocess.run(
        ["gh", "api", "-X", "PUT", "repos/%s/contents/%s" % (REPO, path), "--input", tmp],
        capture_output=True, text=True,
    )
    out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
    ok = "OK" if proc.returncode == 0 else "FAIL"
    print("%-20s %s  %s" % (path, ok, out.splitlines()[0][:120] if out else ""))
