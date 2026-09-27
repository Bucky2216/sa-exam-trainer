#!/usr/bin/env python3
"""
每日自动同步：检测本地文件与 GitHub 仓库的差异，只上传当天有改动的文件。

为什么不用 git push：本机网络下 git 传输通道（github.com/<repo>.git）被阻断，
而 api.github.com 正常，所以统一走 GitHub Contents API。

变更检测原理：GitHub Contents API 返回的 sha 就是 git 的 blob sha，
本地用 `git hash-object <file>` 算出同样的值，两者不同即说明文件有改动。

由 launchd 每天 00:00 触发（见 ~/Library/LaunchAgents/com.bunny.sa-exam-trainer.publish.plist），
也可以手动执行：python3 tools/publish.py
"""
import base64
import datetime
import json
import os
import subprocess
import sys

REPO = "Bucky2216/sa-exam-trainer"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GH = "/usr/local/bin/gh"          # launchd 的 PATH 很干净，这里用绝对路径
LOG = os.path.join(ROOT, "work", "publish.log")

# 参与同步的文件（work/ 是本地目录，不发布）
TRACKED = [
    "index.html",
    "outputs/index.html",
    "README.md",
    ".gitignore",
    "tools/check.js",
    "tools/publish.py",
    "tools/com.bunny.sa-exam-trainer.publish.plist",
    "tools/upload_via_api.py",
]


def log(msg):
    line = "[%s] %s" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass
    print(line, flush=True)


def run(args, **kw):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, **kw)


def gh_ready():
    """确认 gh 已登录且能访问 api.github.com；否则直接退出，避免误判为「全部有改动」。"""
    proc = run([GH, "auth", "status"])
    if proc.returncode != 0:
        log("gh 未登录或不可用，跳过本次同步（如为长时间未用，请在终端执行 gh auth login）")
        return False
    probe = run([GH, "api", "repos/%s" % REPO, "--jq", ".full_name"])
    if probe.returncode != 0:
        log("无法访问 api.github.com（网络不通？），跳过本次同步")
        return False
    return True


def local_blob_sha(path):
    """本地文件的 git blob sha，与 GitHub 返回的 sha 算法一致。"""
    proc = run(["git", "hash-object", path])
    sha = proc.stdout.strip()
    return sha if len(sha) == 40 else None


def remote_blob_sha(path):
    proc = run([GH, "api", "repos/%s/contents/%s" % (REPO, path), "--jq", ".sha"])
    sha = proc.stdout.strip()
    return sha if len(sha) == 40 else None       # 文件不存在时返回 None


def upload(path, message):
    full = os.path.join(ROOT, path)
    with open(full, "rb") as f:
        content = base64.b64encode(f.read()).decode("ascii")
    payload = {"message": message, "content": content, "branch": "main"}
    sha = remote_blob_sha(path)
    if sha:
        payload["sha"] = sha                     # 已存在则覆盖更新
    tmp = "/tmp/gh_publish_%s.json" % path.replace("/", "_")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    proc = run([GH, "api", "-X", "PUT", "repos/%s/contents/%s" % (REPO, path), "--input", tmp])
    info = (proc.stdout or proc.stderr or "").strip().splitlines()
    return proc.returncode == 0, (info[0][:160] if info else "")


def main():
    log("=== 每日同步开始 ===")
    if not gh_ready():
        return 0

    changed = []
    for path in TRACKED:
        if not os.path.exists(os.path.join(ROOT, path)):
            continue
        if local_blob_sha(path) != remote_blob_sha(path):
            changed.append(path)

    if not changed:
        log("当天没有改动，无需同步")
        return 0

    log("检测到 %d 个文件有改动：%s" % (len(changed), "、".join(changed)))
    stamp = datetime.datetime.now().strftime("%Y-%m-%d")
    ok = 0
    for path in changed:
        success, info = upload(path, "sync: %s 每日自动同步（%s）" % (path, stamp))
        log("  %s → %s" % (path, "上传成功" if success else "失败 " + info))
        if success:
            ok += 1
    log("=== 同步结束：成功 %d / %d（Pages 约 30~60 秒后生效）===" % (ok, len(changed)))
    return 0 if ok == len(changed) else 1


if __name__ == "__main__":
    sys.exit(main())
