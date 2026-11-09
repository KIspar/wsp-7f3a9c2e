# GitHub 发布与访问说明

## 仓库

- 地址：<https://github.com/KIspar/wsp-7f3a9c2e>
- 可见性：Public（公开，用户于 2026-11-07 授权调整）
- 主分支：`main`
- 项目形态：本地前后端应用，GitHub 保存源码和文档。

## 通过链接访问

免费下载页：<https://kispar.github.io/wsp-7f3a9c2e/>。GitHub Pages 托管 `site/` 中的静态页面，下载按钮指向最新 Release 的 `studio-app.zip`（首次安装包），`studio-app.tar.gz` 保留为应用内自动更新包。页面是下载安装入口，工作台仍在本机运行；无需 Cloudflare、个人域名或云服务器。页面包含 `noindex` 与 `robots.txt`，用于请求搜索引擎不收录，不能保证隐藏。

下载并完整解压 ZIP，Windows 双击 `Windows-启动.bat`，macOS 双击 `Mac-启动.command`。首次自动从当前版本的 GitHub Release 下载匹配系统架构的独立运行环境（Node.js、npm 和生产依赖），校验 SHA-256 后安装到本机 `.runtime/` 与 `node_modules/`；无需系统预装 Node.js、管理员权限或手动输入命令。环境就绪后打开本机浏览器。使用期间保留启动窗口，Ctrl+C 停止。

包内另有 Windows／Mac 的安装与修复入口；Mac 还提供执行权限修复。修复先检查运行中的服务，成功前保留旧环境，失败时恢复，且不改动 `data/`。支持 Windows x64、Mac Intel／Apple Silicon 和 Linux x64；运行包在各平台构建并测试。Mac 系统的来源确认仍由用户按系统提示完成，脚本不会关闭 Gatekeeper。可选本地视频工具的安装状态与工作台核心运行环境分开说明。

`pages.yml` 在下载页改动时部署；版本发布成功后由 `workflow_run` 在默认分支刷新页面，避免 Tag 被 GitHub Pages 的环境规则拒绝。只上传 `site/`，不上传应用数据。元数据来自构建时的 GitHub Release，访客不需要账号或令牌；版本信息加载失败时下载链接仍指向最新稳定版。

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

## 下载页设计（2026-11-09）

下载页采用暖白背景、深色正文与橙色下载入口。实际改编 LeiBox 的 Tactile Push Button 和 Glass Folder 样式；文件夹里的三个卡片分别连接版本记录、安装步骤和程序包，保留键盘操作、Esc 关闭、外部点击关闭与减少动态效果设置。没有引入循环动画、外部字体或新运行时依赖。组件来源和完整许可见 `site/NOTICE.txt` 与 `THIRD_PARTY_NOTICES.md`。

BrowserOS neo 桌面实测发现并修正了展开卡片被相邻卡片遮挡的问题；已操作验证 Enter 展开、Esc 收起、安装卡片跳转、启动命令复制和 FAQ 展开。辅助文字同步加大并提高对比度。提供窄屏 CSS 适配，本次未以真实移动设备验收。

## 本次检查

2026-11-09 发布验收：v0.1.6 发布工作流 `42561594092` 成功，公开 Release 含应用 ZIP、TAR、版本 JSON，以及 4 套环境 ZIP 与 SHA256。下载页部署 `42562406626` 成功；BrowserOS neo 在线核对 v0.1.6、ZIP 链接、安装入口与文件夹交互。实际下载应用 ZIP 为 103,485,740 字节，SHA256 `0913ca574a213b8623f8e7d866ab8c93d4f9c9f7bfaeb6fbceb504c664f460b0`；Mac Intel 环境为 240,106,814 字节，SHA256 `8b172847978fc4ef49ad055aaab2f60ea800803ac2e42db776de74cd49c472a7`，与公开校验文件匹配。

联网测试限制：本机命令进程继承的 `127.0.0.1` HTTP 代理对环境下载返回 404；直连另遇 HTTP/2 framing 错误。BrowserOS 可正常取得公开环境包，随后使用安装器的本地资产输入执行同一套校验和安装流程；没有更改系统代理设置。本次跨平台 CI 覆盖原生启动器与真实环境包安装、修复和数据保留，未覆盖所有用户的 GitHub 网络连接。

2026-11-09：跨平台预检 Actions `42561015019` 四个平台全部通过（Windows x64、Mac Intel、Mac Apple Silicon、Linux x64）。本机 v0.1.6 完整 ZIP 在含空格、符号和中文的独立目录首次安装并启动成功，BrowserOS neo 打开 `4399` 工作台确认版本；环境测试覆盖复用、依赖修复、运行中阻止修复、错误校验拒绝与 data 保留。ZIP 已检查启动文件执行权限、BAT 换行与 PowerShell 中文编码。

v0.1.6 增加私有运行环境自动安装、修复及各系统的双击入口。为兼容 v0.1.3 的更新包路径校验，TAR 更新包仍保持原有受控目录，不加入根目录启动脚本；更新后既有 ZIP 根目录入口继续调用新版 `scripts/launch.mjs`。

2026-11-09 下载页改版：提交 `2df8aa7` 已部署，GitHub Actions `42549353725` 成功（23 秒）。BrowserOS neo 已打开公开页面并核对新设计、v0.1.3 / 98.0 MB，以及文件夹展开、安装卡片跳转和命令复制；程序包链接继续指向已验收的最新 Release。

2026-11-09 下载页：GitHub Actions `42545131143` 部署成功；BrowserOS neo 打开线上页面，确认显示 v0.1.3、98.0 MB，并实际点击复制与下载。取得 102,804,132 字节程序包，SHA-256 为 `2fff3f351ff6458cb38aaab76a136e674862cc82bbbad0ad5dfa927cfcf98c9b`，与 Release 一致；隔离安全解包通过，必要程序文件齐全。本轮没有在用户工作目录安装覆盖。

2026-11-09：BrowserOS neo 确认仓库首页已显示 Public，v0.1.3 Release 两个更新附件齐全。本机通过「版本 → 检查更新」成功读取公开版本清单，显示当前及最新版本均为 v0.1.3，无需终端用户登录 GitHub。

2026-11-05：TypeScript 检查通过；Vitest 36 个测试文件、389 项测试通过。执行过待提交文件中的凭据模式检查，未发现真实 API Key、GitHub Token、JWT 或私钥。该检查不代表网页和所有外部供应商能力都已完成回归。
