# GitHub 发布与访问说明

## 仓库

- 地址：<https://github.com/KIspar/douyin-creative-studio>
- 可见性：Private（私有）
- 主分支：`main`
- 项目形态：本地前后端应用，GitHub 保存源码和文档。

## 通过链接访问

所有者登录 GitHub 后可以直接打开仓库链接。邀请协作者的入口为仓库 **Settings → Collaborators → Add people**；受邀者接受邀请后，使用自己的 GitHub 账号登录访问。尚未授权的用户即使持有链接也无法查看私有仓库。

GitHub 私有仓库不等同于可匿名访问的分享链接，也不自动提供在线工作台。若需要通过网址使用应用，应另行部署后台与前端、持久化数据，并设置身份验证。当前服务仅监听 `127.0.0.1`，不能直接用静态 GitHub Pages 代替。

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

2026-11-05：TypeScript 检查通过；Vitest 36 个测试文件、389 项测试通过。执行过待提交文件中的凭据模式检查，未发现真实 API Key、GitHub Token、JWT 或私钥。该检查不代表网页和所有外部供应商能力都已完成回归。
