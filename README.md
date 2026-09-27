# 软考高级 · 系统分析师 刷题系统

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

## AI 考点解析（可选，需联网）

答完题后，解析下方有「✦ 考点解析」按钮（快捷键 `Alt`+`A`），调用 DeepSeek 生成
「考点定位 / 核心知识 / 易混点 / 记忆提示」四段式内容（只讲考点，不复述答案）。

- 首次使用需在练习页的「AI 设置」里填入自己的 API Key（在 platform.deepseek.com 创建）。
- Key 只保存在本机 localStorage，除发给 DeepSeek 官方接口外不流向别处。
- 每位使用者填自己的 Key 即可；若想由站点统一提供 Key，则必须自建后端代理，
  否则 Key 会暴露在前端页面里。

## 题库扩充

在 `outputs/index.html` 里找到 `QUESTION_BANK` / `CASE_BANK` 数组，按同样结构追加对象即可
（保存后刷新页面生效）。也可以把题库整理成 JSON 后用页面顶部的「导入」按钮灌入，
题量与统计会自动更新。改完题库可执行 `node tools/check.js` 校验：
题量配比、id 唯一性、答案与选项是否对应。
