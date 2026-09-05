<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Ferry Logo">
</p>

<h1 align="center">Ferry</h1>

<p align="center">
  高颜值、跨平台轻量级 FRP 桌面客户端
</p>

<p align="center">
  <a href="https://github.com/miwuyouth/Ferry/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/miwuyouth/Ferry"></a>
  <img alt="Platform: macOS | Windows | Linux" src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
</p>

<p align="center">
  <b>简体中文</b> | <a href="README_EN.md">English</a>
</p>

---

**Ferry** 是一款跨平台的轻量级 `frpc` 桌面客户端（支持 macOS、Windows 与 Linux）。旨在摆脱繁琐的手动编辑配置文件与终端命令行操作，将代理隧道的管理转变为直观优雅的图形界面体验，并在菜单栏 / 系统托盘实时展示连接状态与关键指标。

<p align="center">
  <img src="docs/screenshots/main-window.png" width="90%" alt="Ferry 界面预览">
</p>

## ✨ 特性

- 🎨 **跨平台现代化界面**：遵循 Apple 设计规范的精致 UI，完美适配浅色与深色模式，原生菜单栏/托盘常驻与快捷呼出。
- 🚀 **进程托管与自愈**：全自动守护 `frpc` 子进程，支持开机自启、掉线智能重试与崩溃自动恢复。
- 🛠️ **可视化隧道管理**：表单化配置 TCP、UDP、HTTP、HTTPS 代理规则，支持单条隧道独立启停与动态热重载。
- 📊 **状态与流量监控**：实时查看连接状态、平均延迟、在线时长与网络吞吐，提供结构化的运行日志查看器。
- 🌐 **国际化支持**：内置多语言支持（简体中文 / 英文），可跟随系统偏好或手动切换。
- 🔄 **配置灵活导入导出**：支持标准 `frpc.toml` 格式的导入与导出，方便在多台设备间快速同步。

---

## 📥 下载与安装

### 方式一：直接下载安装包（推荐）

访问 [GitHub Releases](https://github.com/miwuyouth/Ferry/releases/latest) 下载对应平台的最新安装包：

#### 🍏 macOS
* **Apple Silicon (M 系列芯片)**：请下载 `Ferry-x.x.x-arm64.dmg`
* **Intel 芯片**：请下载 `Ferry-x.x.x.dmg`

> **macOS 首次打开提示「无法打开」？**  
> 由于应用尚未配置付费的 Apple 开发者证书签名，首次打开如遇 macOS Gatekeeper 拦截，请在 Finder 中对应用点击 **右键 -> 打开**，并在弹出的确认对话框中再次点击「打开」即可（仅需操作一次）。

#### 🪟 Windows
* **安装程序**：请下载 `Ferry-Setup-x.x.x.exe`
* **便携绿色版**：请下载 `Ferry-x.x.x-win-x64.zip`

#### 🐧 Linux
* **AppImage（推荐，即开即用）**：请下载 `Ferry-x.x.x.AppImage`（下载后需赋予执行权限：`chmod +x Ferry-*.AppImage`）
* **Debian / Ubuntu**：请下载 `Ferry-x.x.x-amd64.deb`

---

### 方式二：从源码构建

确保本地已安装 **Node.js (18+)** 和 **frpc**（macOS 可通过 `brew install frp` 安装）：

```bash
# 克隆仓库
git clone https://github.com/miwuyouth/Ferry.git
cd Ferry

# 安装依赖
npm install

# 启动开发模式
npm start

# 构建对应平台安装包
npm run dist:mac    # macOS (.dmg)
npm run dist:win    # Windows (.exe / .zip)
npm run dist:linux  # Linux (.AppImage / .deb)
```

---

## ⚙️ 常见问题

<details>
<summary><b>1. 找不到 frpc 可执行文件怎么办？</b></summary>
Ferry 会优先在标准系统路径（如 <code>/opt/homebrew/bin</code>、<code>/usr/local/bin</code>、系统 PATH 等）中自动查找。如果你的 frpc 放在自定义目录，可以在应用内的「设置」页面点击「选择 frpc…」手动指定路径。
</details>

<details>
<summary><b>2. 为什么今日流量和连接数显示为 "—"？</b></summary>
frp 的流量统计数据是由服务端（frps）统计的。如需查看流量与连接数曲线，请在「设置」中的「流量统计来源」填入你的 frps 面板地址与管理凭据即可。
</details>

<details>
<summary><b>3. 配置文件保存在哪里？</b></summary>
所有配置与本地日志均安全存放在系统标准数据目录：  
<ul>
  <li><b>macOS</b>: <code>~/Library/Application Support/Ferry/</code></li>
  <li><b>Windows</b>: <code>%APPDATA%\Ferry\</code></li>
  <li><b>Linux</b>: <code>~/.config/Ferry/</code></li>
</ul>
</details>

---

## 🤝 参与贡献

欢迎提交 Issue 反馈问题或建议，也欢迎提交 Pull Request 共同改进项目！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交修改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送分支 (`git push origin feature/AmazingFeature`)
5. 发起 Pull Request

---

## 📄 开源许可

本项目基于 [MIT License](LICENSE) 开源。
