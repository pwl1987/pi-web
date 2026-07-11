# pi-web 远程访问（办公室 / 家里 / 手机）

本文档说明如何在**单人自用、内网开发**的场景下，从办公室、家里、手机安全地访问部署在内网服务器上的 pi-web。

## 场景

- pi-web 部署在**内网服务器**上，由你自己开发、自己使用。
- 你用**办公室电脑**（与服务器同内网）、**家里电脑**（跨网络）、**手机**（外出）访问它。
- pi-web 本身**没有鉴权**，默认只监听 `127.0.0.1`（回环），因此不能直接从局域网或外网访问。

核心约束：pi-web 是无认证的本地工具，把它直接绑到 `0.0.0.0` 会让同网段甚至公网上的任何人读你的文件、下发 agent 指令、窃取 API Key。**不要直接暴露 `0.0.0.0`。**

## 方案对比

| 方案                              | 适合                               | 优点                                             | 缺点                                           |
| --------------------------------- | ---------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| SSH 端口转发 + VPN                | 只通过浏览器用 pi-web              | 最轻、零暴露、SSE 原生                           | 只能操作网页，无完整桌面                       |
| RustDesk（自托管中继）            | 需要完整桌面（跑 GUI、本地终端）   | 像坐在办公室一样操作                             | 需自建 hbbs/hbbr，且从家/手机仍需 VPN 可达中继 |
| **Tailscale + `tailscale serve`** | 多端点（办公室/家里/手机）统一接入 | 一个网络管所有设备，pi-web 仍 loopback，SSE 原生 | 需装 Tailscale                                 |

对「办公室 + 家里 + 手机」三端都要用的场景，**推荐 Tailscale + `tailscale serve`**：pi-web 全程只绑 `127.0.0.1`，由 Tailscale 做私有网络准入，任何设备（含手机浏览器）用同一方式访问。

## 推荐方案：Tailscale 统一接入

### 1. 在 4 个设备上安装并加入同一 tailnet

- 内网服务器（跑 pi-web）
- 办公室电脑
- 家里电脑
- 手机（iOS / Android 安装 Tailscale App）

在 [tailscale.com](https://tailscale.com) 建一个 tailnet，把以上设备都加进去。Tailscale 负责「可达性 + 设备准入」，相当于一张只属于你的私有网。

### 2. 服务器：pi-web 保持 loopback，用 Tailscale 暴露

不要给 pi-web 传 `-H 0.0.0.0`。保持默认（或显式 `--host 127.0.0.1`）：

```bash
# 开发
npm run dev
# 或生产
node bin/pi-web.js start
```

在服务器上用 `tailscale serve` 把本地 `30141` 通过 Tailscale 暴露（**仅 tailnet 内可达，不是公网**）：

```bash
tailscale serve --https=443 http://127.0.0.1:30141
```

> 不同 Tailscale 版本参数略有差异，不确定时运行 `tailscale serve --help` 确认。
> 注意用 `tailscale serve`（Tailscale 网络内），**不要用 `tailscale funnel`**（那会暴露到公网）。

### 3. 各端点访问

在任意已加入 tailnet 的设备浏览器中打开：

```text
https://<服务器Tailscale主机名>.ts.net
```

- 办公室 / 家里：直接浏览器打开上面的地址即可。
- 手机：装好 Tailscale 并连上 tailnet 后，用手机浏览器打开同一地址。pi-web 是 Web 应用，SSE 在 Tailscale 代理下正常工作，可流式对话、发消息。

### 4. 常驻（可选）

`tailscale serve` 默认随服务器会话存活。要开机自启且进程退出后恢复，可把 `node bin/pi-web.js start` 与 `tailscale serve` 各自做成 systemd 服务（见 `bin/pi-web.js` 的 `install` 子命令注册 pi-web 自启，再补一个 `tailscale serve` 的 oneshot/exec 服务）。

## 备选方案 A：SSH 端口转发（最轻量）

适合「只用浏览器访问 pi-web」、不想装 Tailscale 的情况。

服务器仍绑 `127.0.0.1`。从你的电脑做本地端口转发：

```bash
# 办公室（同内网）
ssh -N -L 30141:127.0.0.1:30141 dev@<服务器内网IP>

# 家里（需先能 SSH 到服务器：经公司 VPN / WireGuard / Tailscale）
ssh -N -L 30141:127.0.0.1:30141 dev@<服务器VPN IP>
```

然后浏览器开 `http://127.0.0.1:30141`。可在 `~/.ssh/config` 加 `LocalForward` 段简化，并用 `autossh` 断线重连。手机上做 SSH 隧道较麻烦，此方案对手机不友好。

## 备选方案 B：RustDesk（完整桌面）

适合「需要在办公室机器上跑带界面程序、用本地终端」的情况。pi-web 仍走办公室机器的本地浏览器，RustDesk 只负责远程桌面。

1. 办公室电脑 + 家里电脑 + 手机装 RustDesk 客户端。
2. 内网服务器自托管中继（hbbs + hbbr，见下方 Compose），保证画面数据不出网。
3. 客户端填入你的 hbbs 地址与 `id_ed25519.pub` 密钥。
4. 从家/手机 RustDesk 进入办公室电脑，再用其浏览器访问 `http://<服务器内网IP>:30141`。

家庭从外网连中继仍需 VPN/Tailscale 让家里能到达 `hbbs/hbbr` 的 `21116/21117`。

自托管中继 `docker-compose.yml`（放内网服务器）：

```yaml
services:
  hbbs:
    image: rustdesk/rustdesk-server:latest
    container_name: hbbs
    command: hbbs
    ports:
      - "21114:21114"
      - "21115:21115"
      - "21116:21116"
      - "21116:21116/udp"
      - "21118:21118"
    volumes:
      - ./data:/root
    restart: unless-stopped
  hbbr:
    image: rustdesk/rustdesk-server:latest
    container_name: hbbr
    command: hbbr
    ports:
      - "21117:21117"
    volumes:
      - ./data:/root
    restart: unless-stopped
```

密钥在 `./data/id_ed25519.pub`，客户端必须填同一个 key（中继无法解密画面）。

> 手机上用 RustDesk 远程桌面写代码体验很差，建议手机只用浏览器 + Tailscale 访问 pi-web。

## 安全提醒

- **永远不要**把 pi-web 直接绑 `0.0.0.0` 暴露到不可信网络。
- 首选「loopback + 隧道/VPN」模式：pi-web 无认证的问题被网络层彻底隔离。
- 任何鉴权令牌（API Key、RustDesk key、Tailscale 凭据）走环境变量或配置文件，**不要写进代码或提交到仓库**。
- 公网暴露请用 Tailscale（`serve`，私有）而非 `funnel`（公网），或叠一层 SSH 隧道 / VPN。
