# iDRAC Web SSH Console

[English README](README_EN.md)

这是一个轻量级的 Web 控制台，用于通过 SSH 连接 Dell iDRAC，执行常用 `racadm` 命令，并以更适合浏览器查看的方式展示结果。

## 功能特性

- 在建立 SSH 会话前先进行应用级登录
- 支持可选的基于 TOTP 的 2FA 双因素认证
- 支持使用密码或 SSH 私钥连接 iDRAC
- 内置常用 `racadm` 操作的一键快捷按钮
- 在浏览器中保存最近使用过的服务器快捷项
- 提供 Docker 与 Docker Compose 部署支持

## 技术栈

- Node.js
- Express
- WebSocket（`ws`）
- `ssh2`
- 原生 HTML、CSS 与浏览器端 JavaScript

## 项目结构

```text
.
|-- public/
|   |-- app.js
|   |-- index.html
|   `-- styles.css
|-- server.js
|-- package.json
|-- Dockerfile
`-- docker-compose.yml
```

## 本地开发

1. 复制环境变量示例文件：

   ```bash
   cp .env.example .env
   ```

2. 修改 `.env` 中的配置，必需修改以下字段：
   - `APP_USERNAME`
   - `APP_PASSWORD`
   - `SESSION_SECRET`
   - `APP_TOTP_SECRET`
   - `SSH_ALLOWED_HOSTS`

3. 安装依赖：

   ```bash
   npm install
   ```

4. 启动项目：

   ```bash
   npm run dev
   ```

5. 打开 [http://localhost:3000](http://localhost:3000)。

## Docker 部署

使用 Docker Compose 构建并启动：

```bash
docker compose up --build
```

服务默认监听 `3000` 端口。

## 环境变量

| 变量名 | 说明 |
| --- | --- |
| `PORT` | Web 服务监听端口 |
| `APP_USERNAME` | Web 登录用户名 |
| `APP_PASSWORD` | Web 登录密码 |
| `SESSION_SECRET` | 用于签名会话 Cookie 的密钥 |
| `APP_TOTP_SECRET` | 可选的 Base32 TOTP 双因素认证密钥 |
| `SSH_ALLOWED_HOSTS` | 允许连接的目标主机白名单，多个值用逗号分隔 |

## 安全说明

- 对外使用前请务必修改所有默认凭据。
- `.env` 仅保留在本地，不要提交到仓库。
- `SESSION_SECRET` 请使用足够长且随机的字符串。
- 建议通过 `SSH_ALLOWED_HOSTS` 限制可连接的 iDRAC 主机范围。
- 如果要公开部署，建议配合 HTTPS 和反向代理一起使用。

## 典型使用场景

- 快速检查 Dell iDRAC 状态
- 在浏览器中进行电源控制
- 查看系统、固件、网络与传感器信息
- 检查 SEL 日志、活动会话和任务队列状态

## 许可证

许可证信息请查看仓库中的 `LICENSE` 文件。
