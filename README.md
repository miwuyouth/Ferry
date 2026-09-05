<p align="center">
  <img src="resources/icon.png" width="120" height="120" alt="Ferry">
</p>

<h1 align="center">Ferry</h1>

<p align="center">macOS 上的 frp 客户端：托管 frpc 进程，用表单管理配置，在菜单栏查看实时状态。</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platform: macOS" src="https://img.shields.io/badge/platform-macOS-lightgrey.svg">
  <a href="https://github.com/miwuyouth/Ferry/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/miwuyouth/Ferry?include_prereleases"></a>
</p>

## 特性

- 托管 `frpc` 子进程：启动、停止、崩溃后指数退避重连，改配置后通过 admin 接口热重载
- 表单化配置：隧道的增删改查和启停都在界面上完成，不用手写 `frpc.toml`
- 菜单栏面板：连接状态、每条隧道的运行态和实时日志
- 流量统计来自 `frps` 面板接口；未配置面板时相关指标显示为 `—`
- 原生 macOS 观感：系统字体、systemBlue、连续圆角、vibrancy，跟随浅色/深色模式
- 配置支持导入导出，`frpc` 二进制路径可自动定位或手动指定

## 安装

### 下载构建产物

在 [Releases](https://github.com/miwuyouth/Ferry/releases/latest) 下载对应架构的 dmg：Apple Silicon 用 `-arm64.dmg`，Intel 用不带架构后缀的那个。

应用目前没有 Apple Developer 签名，首次打开会被 Gatekeeper 拦下。右键点击 app 选择「打开」，在弹窗中再次点击「打开」即可，只需操作一次。

### 从源码运行

需要 Node.js 18+ 和本机的 `frpc`（可用 `brew install frp` 安装）。

```bash
git clone https://github.com/miwuyouth/Ferry.git
cd ferry
npm install
npm start
```

若 `npm install` 卡在下载 Electron 二进制（走 GitHub releases，国内网络常报 `socket hang up`），可以指定镜像重跑安装脚本：

```bash
ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ node node_modules/electron/install.js
```

仓库没有把镜像写进 `.npmrc`，二进制来源交由使用者自行决定。

Ferry 查找 `frpc` 的顺序：设置中手动指定的路径 → 打包进 app 的 `resources/frpc` → `/opt/homebrew/bin` → `/usr/local/bin` → `/opt/local/bin` → `/usr/bin`。都找不到时会在设置页提示，并提供「选择 frpc…」。

## 打包与发布

本地打包：`npm run dist`。electron-builder 会为 x64 与 arm64 各生成一份 dmg 和 zip，输出到 `dist/`。

推送 `v*.*.*` 形式的 tag 时，`.github/workflows/release.yml` 会在 macOS runner 上执行 `npm run dist -- --publish always`，把四份产物上传到对应 tag 的 GitHub Release，使用仓库自带的 `GITHUB_TOKEN`，无需额外配置密钥：

```bash
git tag v1.0.1
git push origin v1.0.1
```

该 workflow 也支持在 Actions 页手动触发（`workflow_dispatch`），不打 tag 也能跑一次打包验证。

## 数据来源

frp 的客户端和服务端职责不同，界面上各项数据的来源如下：

| 界面数据 | 来源 |
| --- | --- |
| 隧道运行态、启动报错 | `frpc` 本地 admin 接口 `GET /api/status` |
| 实时日志 | `frpc` 子进程的 stdout/stderr，逐行解析 |
| 控制连接状态、run id | 从日志中识别 `login to server success` 等事件 |
| 平均延迟 | 向 `serverAddr:serverPort` 拨一次 TCP，取握手耗时，按一小时滚动平均 |
| 在线时长、断线次数 | 进程存活时间 + 连接状态翻转计数 |
| 连接数、今日流量、24 小时曲线 | `frps` 面板接口 `GET /api/proxy/{tcp,udp,http,https}` |

最后一行需要注意：`frpc` 不统计字节数和连接数，这些计数器在服务端。因此设置里有「流量统计来源」一节，填入 frps 面板地址和凭据后才有数据，未填写时这些指标显示为 `—`。

24 小时曲线由 Ferry 在本地按小时累计：面板返回的是「今日累计」，Ferry 做差分后存进 `store.json` 的 24 个小时桶，因此曲线只覆盖 Ferry 运行过的时段。

日志中的消息保留 `frpc` 输出的英文原文，界面 chrome 和 Ferry 自身输出的文案为中文。

## 隧道启停的实现

frp 没有「运行时停用某条代理」的概念。开关关闭时，Ferry 会把这条 proxy 从 `frpc.toml` 中移除，再通过 admin 接口 `GET /api/reload` 热重载；重新打开时写回。

修改服务器地址、token、传输协议等不支持热重载，Ferry 会重启 `frpc` 进程。设置页的按钮上会标明当前改动属于哪一种。

## 文件位置

配置和状态位于 `~/Library/Application Support/Ferry/`：

- `frpc.toml`：生成的配置，权限 0600（包含 token）
- `store.json`：设置、隧道列表、流量小时桶
- `frpc.log`：日志落盘，保留 7 天

admin 接口每次启动重新选择一个空闲端口，口令随机生成且不落盘，仅监听 `127.0.0.1` 供 Ferry 自身使用。

## 项目结构

```
src/
├── main/                Electron 主进程
│   ├── main.js          生命周期、窗口、IPC
│   ├── frpc.js          子进程看护：启停、指数退避重连、热重载、admin 接口
│   ├── toml.js          frpc.toml 序列化与解析（导入用）
│   ├── store.js         持久化
│   ├── logbuf.js        stdout -> 结构化日志行
│   ├── metrics.js       采样层：frpc 状态 + frps 面板 + TCP 拨测
│   └── tray.js          菜单栏图标与面板窗口
├── preload/preload.js   contextBridge，渲染层唯一出口（window.ferry.*）
└── renderer/
    ├── index.html       主窗口
    ├── panel.html       菜单栏面板
    ├── css/apple.css    设计系统：token + 组件基础类
    ├── css/app.css      页面层
    └── js/…             各视图，原生 DOM，无框架
```

渲染层启用 `contextIsolation`、关闭 `nodeIntegration`，并设有 CSP（`connect-src 'none'`，页面不发起任何网络请求，全部走 IPC）。字体使用系统自带的 San Francisco / PingFang SC（`-apple-system`），不依赖外部 CDN。

## 贡献

欢迎提交 issue 和 PR。项目目前没有测试套件，提交改动前请至少：

1. 用 `npm start` 手动验证改动涉及的界面和流程；
2. 涉及 `frpc.toml` 序列化的改动，跑一遍 `npm run dist` 确认打包正常；
3. 在 PR 中说明改动原因。新增的字段或图表如果没有真实数据来源，请显示空状态。

## License

[MIT](LICENSE)
