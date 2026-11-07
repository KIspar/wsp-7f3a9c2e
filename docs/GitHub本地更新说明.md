# GitHub 本地更新

## 使用范围

用户没有云服务器。工作台仍在本机运行，GitHub 只存代码、发布版本和安装更新包，不承担工作台运行或用户数据存储。仓库使用中性代号并公开，终端用户无需 GitHub 登录。无需购买服务器，也不使用 GitHub Pages 承载本地 API。

```text
公开 GitHub 仓库 → 推送 vX.Y.Z 标签 → GitHub Actions 构建
                                      ↓
                        GitHub Release: latest.json + studio-app.tar.gz
                                      ↓
本地工作台 → 检查版本 → 后台下载/校验/准备 → 点击安装 → 备份 → 重启
                                                               ↓
                                                     启动失败自动回滚
```

## 免登录读取

仓库配置在 `updates/source.json`，当前为 `KIspar/wsp-7f3a9c2e`，`access` 为 `public`。检查和下载不需要安装 GitHub CLI，也不需要 `GH_TOKEN`；已有或失效的环境令牌不会被发送到公开更新接口。

匿名 GitHub API 有频率限制，默认每 6 小时检查一次。达到限制时显示稍后重试，不再要求登录。如果以后主动切回私有仓库，需将 `access` 改为 `private` 并配置维护者授权。

在线接口是 GitHub 自己的 REST API：

```text
GET https://api.github.com/repos/KIspar/wsp-7f3a9c2e/releases/latest
GET https://github.com/KIspar/wsp-7f3a9c2e/releases/download/vX.Y.Z/latest.json
GET https://github.com/KIspar/wsp-7f3a9c2e/releases/download/vX.Y.Z/studio-app.tar.gz
```

先查询最新稳定 Release，从 assets 中找到 `latest.json`，再通过公开附件链接下载版本清单和应用包。保留版本、文件大小、SHA-256 和归档路径校验。

## 发布步骤

1. 更新 `package.json` 和 `package-lock.json` 的版本，使用稳定版本号 `x.y.z`。
2. 完成检查并提交代码，确保 `.env`、`data/`、数据库和私密素材未进入 Git。
3. 推送提交和相同版本的标签，例如 `v0.1.1`。标签触发 `.github/workflows/release.yml`。
4. Actions 在 GitHub 上构建，并生成两个 Release 附件：`latest.json` 与 `studio-app.tar.gz`。版本 JSON 包含版本号、Node 要求、文件大小及 SHA-256。
5. 在 GitHub Actions/Release 确认发布成功后，旧版工作台即可检查到更新。不能修改已经发布的同名版本来代替递增版本号。

Actions 使用 GitHub 提供的临时 `github.token` 发布同仓库附件，不需要配置另一台服务器。Actions 存储、运行时间和网络限制仍遵循账号额度。

## 本机更新行为

- 侧栏「版本」和系统设置中的「版本与更新」均可检查。默认启动 30 秒后检查，以后每 6 小时检查；可关闭自动检查或后台下载。
- 下载、解压、依赖准备在独立 Node 子进程执行。内容经过 SHA-256、文件大小、版本标签和归档路径校验；禁止修改 `data/`、`.env`，禁止链接和目录穿越。
- 下载后点击「安装并重启」。先提交当前草稿与浏览器异步缓存，检查所有工作区是否仍有生成、研究、分析、采集等任务；有任务时拒绝安装。
- 使用 `npm start` 的守护启动器或更新后的便携启动器才能自动安装。`npm run dev` 只允许检查和下载，避免覆盖正在编辑的源码。
- 服务关闭、SQLite 关闭后，备份程序和本地数据至 `data/update-backups/<时间>/`，然后替换程序。更新包不包含本机数据。
- 新版通过本机健康检查才确认安装；启动失败则恢复旧程序与旧数据。备份保留，需定期由用户检查磁盘空间。
- 原有旧版本若尚未包含更新器，需要先手动安装一次含更新器的版本，之后才可从界面升级。

## 便携版本边界

当前应用包不升级内置 Node/Python/FFmpeg 等运行时。运行时要求提高时，需要完整安装包。若便携版没有 npm，只有依赖锁文件完全一致时才能复用现有依赖；依赖改变会明确提示下载完整新版本，不冒险覆盖。

首次在一台机器上准备依赖可能访问 npm 下载依赖，这不要求用户拥有 npm 服务器或任何云服务器。

## 首次启用

从 v0.1.1 起包含本地更新器，从 v0.1.3 起默认匿名读取公开版本。首次升级到该版本后，使用 `npm start` 启动正式版即可，不需要执行 `gh auth login`。更早的更新器若仍要求 CLI 登录，需要先手动更换一次新版程序或更新本地源码。

发布结果以仓库 Releases 页面为准：必须能看到该版本的 `latest.json` 和 `studio-app.tar.gz` 两个附件。本地 `release/update/` 中生成的文件只用于打包验证。
