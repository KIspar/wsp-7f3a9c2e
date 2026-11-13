# 完整离线包与启动修复

新电脑使用对应平台的 `studio-full-*.zip`，完整解压后双击启动。包内包含 Node.js、npm、核心生产依赖和编译后的前后端；无需在目标电脑下载运行环境。可通过 U 盘传输。

平台分别为 Windows x64、macOS Intel、macOS Apple 芯片、Linux x64。源码归档与 `studio-app.zip` 不包含运行环境，不适合作为新电脑的离线安装包。

## 本次修复

- 启动器优先使用内置 Node，也可复用本机兼容的 Node 24+；macOS 支持识别常见 Homebrew、NVM 位置。
- 修复入口先进行只读检查，正常环境无需重新下载。缺失或损坏时才进入恢复流程。
- 无安装标记但核心依赖可用时，检查生产依赖文件、SQLite 和实际图像处理能力后复用，不重复安装。
- 下载失败明确提示可从其他电脑取得完整包并通过 U 盘传输。
- 修复保留原有下载校验、安装回滚和运行中保护，不改动用户数据。

## 验证

- 本机 Intel Mac：v0.1.8 完整包在临时干净目录解压，PATH 移除系统 Node，指定不存在的环境包目录，替换 npm 为一旦调用便失败的哨兵，环境检查与实际本地服务启动均通过；npm 哨兵未被调用。
- 该验证通过本地服务健康检查确认后台启动，属于启动器集成验证，不是浏览器界面操作验收。并未断开整台机器的网络；证明启动不需要环境下载或依赖安装，不能描述为物理断网测试。
- 检查压缩包不含本机 `data/` 或 `.env`，测试结束清理临时服务和测试数据。
- 6 项启动器回归测试通过，覆盖环境复用、修复无需下载、系统 Node 复用、依赖变化及损坏恢复、失败重试、解压不完整。
- 本机项目 `sh run.sh --repair` 检查通过，显示无需联网重新下载。
- 本次没有在 Windows 真机执行；跨平台测试仍需 GitHub 的原生 Windows runner 验证。

## 交付与范围

已验证的原始 v0.1.8 Intel Mac 完整包复制至 `output/offline-packages/Workspace-v0.1.8-macOS-Intel-offline.zip`，约 324 MB。它与原发布包内容一致，本次脚本修复尚未作为新版发布，不应声称此 ZIP 已包含新修复。

本包属于核心工作台离线包。可选 Python 本地视频处理依赖、FFmpeg 工具链及语音识别模型尚未全部纳入此包；相应功能不可承诺在全新离线电脑上可用。在线模型调用、中转站余额、GitHub 更新仍依赖网络；后台更新检查失败不应阻止本地工作台启动。


## v0.1.9 发布验证

发布工作流增加统一的完整包集成关卡：同一份程序产物分别在 Windows x64、macOS Intel、macOS Apple 芯片、Linux x64 上与本平台运行环境合并，再在原生 runner 解压到带空格、中文和符号的干净路径，移除系统 Node 的 PATH，禁止 npm 安装，验证环境准备、健康环境修复以及实际启动入口拉起本地服务。发布任务依赖四个平台全部通过；任何一个失败均不创建 Release。

Windows 通过 `Windows-启动.bat` 启动整包服务，修复使用 Windows 自带 PowerShell。无需管理员权限或全局 Node 安装。本次 Windows 只承诺 x64；Windows ARM 原生包尚未提供。此关卡验证核心启动流程，不将可选 Python 视频依赖描述为随包完整提供，也不将 backend 健康检查描述为 UI 自动化测试。

本机 72 项发布回归测试、TypeScript 检查和生产构建通过。线上运行结果和发布链接在 GitHub 完成后记录。


### Windows 整包测试发现与修复

v0.1.9 的原生 Windows 启动器测试通过，但完整包离线关卡发现依赖指纹不一致，触发了被测试哨兵拦截的 npm 安装。该版本未创建 Release。已将打包、启动与更新的锁文件摘要统一为 LF 换行，并固定 Git 的 package-lock.json 行尾；新增跨 CRLF/LF 变化不应重复安装的回归测试。合并完整包时也会先检查程序与运行环境依赖指纹一致，再允许生成交付包。最终修复使用新标签 v0.1.10，不移动 v0.1.9 标签。


## 最终发布结果

2026-11-13，v0.1.10 已发布为 GitHub Latest：

- Release：https://github.com/KIspar/wsp-7f3a9c2e/releases/tag/v0.1.10
- 原生构建与验证：https://github.com/KIspar/wsp-7f3a9c2e/actions/runs/43397945355
- 应用发布回归共 73 项测试；四个平台的运行环境恢复与完整包离线启动验证全部通过。
- Windows 日志确认：`PASS complete win32/x64: packaged Node, offline setup, offline repair, Windows BAT service startup, Chinese path, no npm install, no local data bundled`。
- Windows x64 完整 ZIP 为 325,849,415 字节，已上传公开 Release。
- 在线下载的 latest.json 确认为 0.1.10；应用更新包大小 102,717,632 字节，SHA256 为 `19255ed4af4db8b6bb7418d02df16844f2ddbd03ba7f040fd5cc5dfee36cbdbe`。
- BrowserOS neo 已检查在线下载页，版本显示 `v0.1.10 · 发布于 2026/11/13 · 无需登录 GitHub`，Windows、两种 Mac 及 Linux 链接均指向对应完整包。
- 本轮发布未安装到用户现有工作台，也未迁移、清理用户数据或密钥；可选 Python 本地视频环境仍不包含在核心完整包中。
