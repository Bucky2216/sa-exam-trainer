# 软考高级 · 系统分析师 刷题系统

## 在线地址（已部署）

**https://bucky2216.github.io/sa-exam-trainer/**

GitHub Pages 静态托管，手机、公司电脑打开即用（实测首字节 0.6~0.8 秒，整页加载约 1 秒）。
仓库地址：https://github.com/Bucky2216/sa-exam-trainer

## 常用命令速查

以下命令都在项目目录 `/Users/bunny/project/sa-exam-trainer` 下执行：

| 想做什么 | 命令 |
|---|---|
| 本地预览 | `python3 -m http.server 8000 --bind 127.0.0.1` → 浏览器打开 http://127.0.0.1:8000/ |
| 校验题库（题量/答案/选项） | `node tools/check.js` |
| **发布改动到线上** | `python3 tools/publish.py`（自动只传有改动的文件） |
| 立刻跑一次每日同步 | `launchctl kickstart -k gui/$(id -u)/com.bunny.sa-exam-trainer.publish` |
| 看同步日志 | `tail -20 work/publish.log` |
| 定时任务是否还在 | `launchctl list \| grep sa-exam` |
| 停用 / 启用定时同步 | `launchctl bootout gui/$(id -u)/com.bunny.sa-exam-trainer.publish` / `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bunny.sa-exam-trainer.publish.plist` |
| 看 gh 是否登录 | `gh auth status` |
| 重新登录 gh | `gh auth login --hostname github.com --git-protocol https --web` |
| 看线上站点状态 | `gh api repos/Bucky2216/sa-exam-trainer/pages --jq .status` |

纯前端、单文件、可离线的刷题网页。整个应用就是一个 HTML 文件：

```
outputs/index.html      ← 应用本体（200 道选择题 + 20 道案例题，内联 CSS/JS，无外部依赖）
index.html              ← 仓库首页跳转页，自动跳到上面的文件
tools/check.js          ← 题库校验脚本（题量配比、id 唯一性、答案与选项一致性）
work/                   ← 本地开发/备份目录，不参与部署，已在 .gitignore 中忽略
```

> 应用本体只有一个 HTML 文件，CSS 和 JS 全部内联，因此不存在构建步骤，任何静态托管都能直接跑。

## 本地怎么打开

两种方式都行，任选其一并固定使用（不同来源的学习记录互不相通）：

1. **双击打开**：用 Chrome 打开 `outputs/index.html`（Chrome 允许 `file://` 使用 localStorage）。
2. **本地服务**：在项目目录执行 `python3 -m http.server 8000 --bind 127.0.0.1`，
   然后访问 <http://127.0.0.1:8000/>（根目录会跳到刷题页面）。

> Safari 在 `file://` 下会禁用本地存储，用 Safari 请走第 2 种方式或部署到网上。

## 部署到公网（免费，不需要云服务器）

### 方案一：GitHub Pages

```bash
# 在项目目录执行
git init
git add .
git commit -m "软考系统分析师刷题系统"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

推送后在仓库页面进入 **Settings → Pages**，Source 选择 `Deploy from a branch`，
分支选 `main`、目录选 `/ (root)`，保存后等 1 分钟左右即可访问：

```
https://<你的用户名>.github.io/<仓库名>/
```

> 免费版 GitHub Pages 只对公开仓库开放，也就是代码会公开。本题库为自行命题，
> **不包含任何密钥**（API Key 只存在每个使用者自己的浏览器里），公开没有安全风险。

### 方案二：Cloudflare Pages（支持私有仓库，可加访问锁）

1. 把仓库推到 GitHub（可以是 **Private**）。
2. 打开 Cloudflare Dashboard → Workers & Pages → Create → Pages → 连接该仓库。
3. 构建命令留空，输出目录填 `/`（纯静态，无需构建），部署后得到 `https://<项目名>.pages.dev`。
4. 若只想自己访问：在 Cloudflare Zero Trust → Access 里给该域名加一条策略，
   限定只有你的邮箱能进（免费版够用），这样别人即使拿到网址也打不开。

### 自定义域名（可选）

不买域名也能用平台自带的二级域名。想要好记的域名，买一个（`.com` 通常 60~80 元/年），
在 Pages/Cloudflare 里绑定即可，HTTPS 由平台自动签发。
注意：解析到**国内服务器**需要 ICP 备案；用 GitHub Pages / Cloudflare 这类境外托管通常不需要。

## 数据说明（重要）

- 进度、错题本、收藏、笔记、模拟考成绩都保存在**浏览器本地 localStorage**（键名 `SA_EXAM_APP_V1`），
  不上传任何服务器。
- 因此：**换设备、换浏览器、换网址，记录都不互通**，每台设备各自一份。
  需要带着走就用页面顶部「导出」生成 JSON，到另一台设备用「导入」恢复。
- 部署到公网后是新的来源（`https://…`），与本地 `http://127.0.0.1:8000` 的记录互不相通，
  迁移时同样用「导出 / 导入」。
- 清理浏览器数据会连同记录一起清除，建议定期导出备份。

## 跨端同步（可选，用 GitHub Gist）

手机和电脑的进度、错题、收藏、笔记可以互通，**不需要服务器**：数据存在你 GitHub 账号下的一个 secret Gist 里。

**配置步骤（每台设备做一次）**

1. 生成 Token：GitHub → Settings → Developer settings → Personal access tokens →
   **Tokens (classic)** → Generate new token → 只勾选 **gist** → 生成后复制
2. 打开刷题页 → **统计** 页 → 「云同步（跨设备）」→ 粘贴 Token → 点「立即同步」
   （首次会自动创建 secret Gist，并把 Gist ID 回填到输入框）
3. 第二台设备做同样操作，**额外把第一台设备的 Gist ID 填进去**，再点「立即同步」

> **更省事：同步码。** 在第一台设备点「复制同步码」（一串 `sat1:...`，里面打包了 Token 与 Gist ID），
> 到第二台设备的「云同步」里把它粘进 Token 输入框，两个字段会自动填好，点保存即完成。
> 注意同步码等价于凭据，只在自己设备之间传，别发到公开场合。

**同步行为**

- 双向合并、只增不减：答题次数/正确数、错题次数取较大的那份；笔记与考点解析本机优先、
  云端缺的补齐；模拟考成绩按时间戳去重合并。**正常同步不会丢数据。**
- **自动同步默认开启**：配好之后打开页面会自动合并一次，答题后 8 秒自动上传，不需要手动点同步；
  想改成手动就取消勾选。
- 纯前端应用只在**页面打开时**才能同步，所以补了两个保障：页面切到后台/关闭标签前会立刻补一次同步；
  另外随时可以点顶部「同步」→「立即同步」手动触发。
- 「用本机覆盖云端」是单向覆盖，一般不用。

**安全**

- Token 只存在本机浏览器，仅用于访问你自己的 Gist；DeepSeek 的 API Key **不参与同步**。
- Gist 是 secret（不在列表展示），但拿到链接的人可读；要更强隐私可自行加密后再同步（暂未内置）。
- 「清空学习记录」不会清掉同步配置——清空后可直接「立即同步」把云端记录拉回来。

## AI 考点解析（可选，需联网）

答完题后，解析下方有「✦ 考点解析」按钮（快捷键 `Alt`+`A`），调用 DeepSeek 生成
「考点定位 / 核心知识 / 易混点 / 记忆提示」四段式内容（只讲考点，不复述答案）。

- 首次使用需在练习页的「AI 设置」里填入自己的 API Key（在 platform.deepseek.com 创建）。
- Key 只保存在本机 localStorage，除发给 DeepSeek 官方接口外不流向别处。
- 每位使用者填自己的 Key 即可；若想由站点统一提供 Key，则必须自建后端代理，
  否则 Key 会暴露在前端页面里。

### 模型与计费

- 默认模型 **`deepseek-flash`**（DeepSeek-V4.1-Flash，当前最便宜的档位）。
  旧模型名 `deepseek-chat` / `deepseek-reasoner` 已于 **2026-07-24 停止服务**，
  页面会自动把旧配置升级为新模型名。
- 默认**关闭思考模式**（请求体里 `thinking: {"type":"disabled"}`）：思考模式会先输出思维链，
  思维链按输出 token 计费，更慢也更贵；需要更深入的解析可在「AI 设置」里勾选开启。
- 官方价格与折扣以 https://api-docs.deepseek.com/quick_start/pricing 为准。

成本量级（按 `deepseek-flash` 非高峰价估算：输入 $0.15、输出 $0.60 每百万 token）：
一道题的考点解析约用 350 输入 token + 400 输出 token，折合约 **0.002 元/题**；
把 200 道题全部生成一遍大约 **0.4 元**。高峰时段（工作日 09:00-12:00、14:00-18:00）价格翻倍。

## 如何更新线上版本

本机当前网络环境下 **git 传输通道（`github.com/<仓库>.git`）被阻断**（实测多个 IP 都超时），
但 **`api.github.com` 正常**，因此有两条更新路径：

**方式 A：API 通道（当前网络可直接用）**

```bash
cd /Users/bunny/project/sa-exam-trainer
# 改完 outputs/index.html 之后执行
python3 tools/upload_via_api.py outputs/index.html
```

脚本会自动取远程文件的 sha 再提交（可重复运行做覆盖更新），推送后约 30 秒 Pages 生效。

**方式 B：标准 git 流程（需能访问 github.com 的 git 通道，例如挂代理）**

```bash
cd /Users/bunny/project/sa-exam-trainer
git add -A && git commit -m "update: 题库调整"
git push
```

> ⚠️ 首次上线时因为 git 通道不通，代码是用 API 逐个文件提交的，所以**本地提交历史与远程不一致**。
> 以后切回方式 B 之前，先对齐一次（本地文件内容和远程相同，不会丢内容）：
>
> ```bash
> git fetch origin && git reset --hard origin/main
> ```

## 每天 00:00 自动同步（已配置）

本机已注册 launchd 定时任务 **`com.bunny.sa-exam-trainer.publish`**：

- **触发时间**：每天本地时间 00:00（Mac 睡眠时错过的会在唤醒后补跑一次）
- **做什么**：`tools/publish.py` 比对本地文件与远程文件的 sha，**只上传有改动的文件**；
  当天没改动就直接跳过，不会产生空提交
- **日志**：`work/publish.log`（同步记录）、`work/launchd.err.log`（异常输出）
- **前提**：`gh` 保持登录状态（token 存在系统钥匙串）。若日志出现「gh 未登录或不可用」，
  在终端执行一次 `gh auth login` 即可恢复

常用命令：

```bash
cd /Users/bunny/project/sa-exam-trainer

launchctl kickstart -k gui/$(id -u)/com.bunny.sa-exam-trainer.publish   # 立刻手动跑一次
launchctl list | grep sa-exam                                            # 查看是否已注册
tail -20 work/publish.log                                                # 查看同步记录

# 停用 / 重新启用
launchctl bootout gui/$(id -u)/com.bunny.sa-exam-trainer.publish
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bunny.sa-exam-trainer.publish.plist
```

## 题库扩充

在 `outputs/index.html` 里找到 `QUESTION_BANK` / `CASE_BANK` 数组，按同样结构追加对象即可
（保存后刷新页面生效）。也可以把题库整理成 JSON 后用页面顶部的「导入」按钮灌入，
题量与统计会自动更新。改完题库可执行 `node tools/check.js` 校验：
题量配比、id 唯一性、答案与选项是否对应。
