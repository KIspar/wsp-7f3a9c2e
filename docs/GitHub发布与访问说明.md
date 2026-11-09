# GitHub 发布与访问说明

## 仓库

- 地址：<https://github.com/KIspar/wsp-7f3a9c2e>
- 可见性：Public（公开，用户于 2026-11-07 授权调整）
- 主分支：`main`
- 项目形态：本地前后端应用，GitHub 保存源码和文档。

## 通过链接访问

免费下载页：<https://kispar.github.io/wsp-7f3a9c2e/>。GitHub Pages 托管 `site/` 中的静态页面，下载按钮指向最新 Release 的 `studio-app.tar.gz`。页面是下载安装入口，工作台仍在本机运行；无需 Cloudflare、个人域名或云服务器。页面包含 `noindex` 与 `robots.txt`，用于请求搜索引擎不收录，不能保证隐藏。

下载已构建的程序包，安装 Node.js 24 或更新版本，解压后在程序目录依次执行 `npm ci --omit=dev` 和 `npm start`。此程序包不含 Node.js 运行时，也不是双击安装器；不需要重新构建源码。终端显示本机访问地址，保留启动窗口即可使用。

`pages.yml` 在下载页改动时部署，`release.yml` 发布成功后调用同一工作流刷新版本信息。只上传 `site/`，不上传应用数据。元数据来自构建时的 GitHub Release，访客不需要账号或令牌；版本信息加载失败时下载链接仍指向最新稳定版。

公开仓库及 Release 可匿名读取；发布、推送和管理设置仍需要维护者权限。仓库使用中性代号、简短描述与无主题标签的首页，减少明确业务关键词。公开仓库仍可能被搜索引擎及 GitHub 索引，不能视为隐藏链接；旧仓库地址可能继续重定向。

GitHub 提供代码、版本 JSON 和应用更新包。工作台继续在本机运行，当前服务仅监听 `127.0.0.1`，不需要自有服务器。

## 本地继续提交

本机已配置 `origin` 指向上述仓库，使用仅授权此仓库的 SSH deploy key 进行推送。密钥保存在本地 `.git/` 中，不随项目提交；该配置仅适用于当前电脑。可在仓库 **Settings → Deploy keys** 撤销 `Local project publishing`。

日常只提交需要保存的修改，先检查暂存内容：

```sh
git status
git diff
git add <需要提交的文件>
git diff --cached
git commit -m "描述本次修改"
git push origin main
```

另一台电脑应使用自己的 GitHub 登录凭据或 SSH 密钥克隆仓库，然后按 README 安装与启动。

## 上传范围

已通过 `.gitignore` 排除 `data/`、`.env*`（保留示例文件）、本地凭据目录、数据库、运行环境、依赖、构建产物、生成结果及导出压缩包。测试中的示例密钥是虚构固定值。历史验收资料和脱敏截图作为项目文档保存。

`git push` 不会备份被排除的本地数据。需要迁移商品、媒体、任务和账号配置时，应使用工作台备份能力并单独保管凭据；不要将数据库或真实 API Key 加入 Git。

## 本次检查

2026-11-09 下载页：GitHub Actions `42545131143` 部署成功；BrowserOS neo 打开线上页面，确认显示 v0.1.3、98.0 MB，并实际点击复制与下载。取得 102,804,132 字节程序包，SHA-256 为 `2fff3f351ff6458cb38aaab76a136e674862cc82bbbad0ad5dfa927cfcf98c9b`，与 Release 一致；隔离安全解包通过，必要程序文件齐全。本轮没有在用户工作目录安装覆盖。

2026-11-09：BrowserOS neo 确认仓库首页已显示 Public，v0.1.3 Release 两个更新附件齐全。本机通过「版本 → 检查更新」成功读取公开版本清单，显示当前及最新版本均为 v0.1.3，无需终端用户登录 GitHub。

2026-11-05：TypeScript 检查通过；Vitest 36 个测试文件、389 项测试通过。执行过待提交文件中的凭据模式检查，未发现真实 API Key、GitHub Token、JWT 或私钥。该检查不代表网页和所有外部供应商能力都已完成回归。
