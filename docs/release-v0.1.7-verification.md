# v0.1.7 发布验证

日期：2026-11-09

- 标签提交：`c5e98d9f41bdae938bb9b3ee114f3a44e5006d10`。
- [发布工作流](https://github.com/KIspar/wsp-7f3a9c2e/actions/runs/42589465240)成功，四个平台的运行环境构建、启动验证及发布任务通过。
- 本地发布相关测试 27 项通过；GitHub 类型检查、发布回归和生产构建通过。
- [v0.1.7 Release](https://github.com/KIspar/wsp-7f3a9c2e/releases/tag/v0.1.7)标记为 Latest，包含更新 JSON、应用 TAR/ZIP、四个平台完整包、运行环境和校验文件；共 15 个发布附件及 2 个 GitHub 源码附件。
- BrowserOS neo 下载 `latest.json` 成功，版本与标签均为 `0.1.7`，最低 Node 主版本为 24。
- JSON 中应用包大小为 102732568 字节；SHA256 为 `7368b5e35b8c38de7ac5a6b2521a27d6398e2e80e249c57deb413789d727ce42`，与 GitHub 显示的上传附件摘要一致。
- [下载首页](https://kispar.github.io/wsp-7f3a9c2e/)已显示 v0.1.7；Windows、Mac Apple 芯片、Mac Intel 和 Linux 下载入口对应完整包。首页声明无需登录 GitHub，版本元数据同步成功。
- 本机尝试下载 98 MB 应用 TAR 时浏览器报告取消，因此未完成本机解包复验；不将摘要一致视为本机完整包启动验证。
- 发布未包含本地 `data/` 或凭据，未操作当前工作台的安装更新、任务或模型配置。
