<p align="center">
  <img src="resources/icon.png" width="120" height="120" alt="Ferry">
</p>

<h1 align="center">Ferry</h1>

<p align="center">macOS 上的 frp 客户端 —— 托管 frpc 进程，把配置变成表单，在菜单栏显示实时状态。</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platform: macOS" src="https://img.shields.io/badge/platform-macOS-lightgrey.svg">
  <a href="https://github.com/OWNER/ferry/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/OWNER/ferry?include_prereleases"></a>
</p>

<!-- 把上面两处 OWNER 换成实际的 GitHub 用户名/组织名。 -->

界面最初实现自 Claude Design 画布 `FrpKit.dc.html`（项目改名 Ferry 之前的画布，
文件名保留原样；其中的 Industry 蓝图设计系统，该画布仍留在仓库里作为历史记录），
后按 macOS Human Interface Guidelines 重做了一版：系统字体（San Francisco /
PingFang SC）、systemBlue 强调色、13px 基准控件字号、连续圆角、菜单栏面板用的是
真原生 vibrancy（`popover` 材质），并跟随系统的浅色 / 深色外观。

## 特性

- **托管 frpc 子进程** —— 启动、停止、崩溃后指数退避自动重连，改配置走 admin 接口热重载
- **表单化配置** —— 隧道的增删改查、开关都是表单操作，不用手改 `frpc.toml`
- **菜单栏实时状态** —— 连接状态、每条隧道的运行态、日志都能在菜单栏面板里看到
- **流量统计给真数据** —— 接的是 `frps` 面板的真实接口；没配面板就诚实显示 `—`，不编数字
- **原生 macOS 观感** —— 系统字体、systemBlue、连续圆角、真原生 vibrancy，浅色/深色自动跟随系统
- **配置可导入导出**，可以定位/手动指定 `frpc` 二进制路径

## 截图

（还没放——建议后续把主窗口和菜单栏面板各截一张图存进 `docs/`，再用
`![主窗口](docs/main-window.png)` 之类的方式引用到这里。对第一次逛到这个仓库的人
帮助最大，先占个位，不打没截图先放假图那种自欺欺人的样子。）

## 安装

### 下载现成的构建产物（推荐）

去 [Releases](https://github.com/OWNER/ferry/releases/latest) 下载对应架构的 dmg：
Apple Silicon（M 系列）用 `-arm64.dmg`，Intel 用不带 arch 后缀的那个。

现在还没有 Apple Developer 签名，第一次打开会被 Gatekeeper 拦。右键点 app、选
「打开」，弹窗里再点一次「打开」放行——只需要做一次。

### 从源码跑

需要 Node.js 18+ 和本机的 `frpc`（没有就 `brew install frp`）。

```bash
git clone https://github.com/OWNER/ferry.git
cd ferry
npm install
npm start
```

如果 `npm install` 卡在下载 Electron 二进制（它走 GitHub releases，国内常连不上，
报 `socket hang up`），换个镜像重跑安装脚本：

```bash
ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ node node_modules/electron/install.js
```

没有把这个镜像写进 `.npmrc` —— 换二进制来源该由你自己决定，不该由脚手架替你定。

Ferry 按这个顺序找 `frpc`：设置里手动指定的路径 → 打包进 app 的 `resources/frpc` →
`/opt/homebrew/bin` → `/usr/local/bin` → `/opt/local/bin` → `/usr/bin`。
都找不到会在设置页明说，并给出「选择 frpc…」。

## 打包与发布

打包：`npm run dist`（electron-builder，为 x64 与 arm64 各出一份 dmg + zip，
产物在 `dist/`）。

`.github/workflows/release.yml` 会在推送 `v*.*.*` 形式的 tag 时，在 macOS
runner 上跑 `npm run dist -- --publish always`，把四份产物（x64/arm64 各一份
dmg + zip）自动传到对应 tag 的 GitHub Release（用仓库自带的 `GITHUB_TOKEN`，
不用额外配密钥）：

```bash
git tag v1.0.1
git push origin v1.0.1
```

也可以在 GitHub 仓库的 Actions 页手动触发这个 workflow（`workflow_dispatch`），
不打 tag 也能跑一次打包看看有没有问题。

## 数据是真的从哪来的

这一点值得写清楚，因为 frp 的两端职责不同：

| 界面上的东西 | 真实来源 |
| --- | --- |
| 隧道运行态、启动报错 | `frpc` 本地 admin 接口 `GET /api/status` |
| 实时日志 | `frpc` 子进程的 stdout/stderr，逐行解析 |
| 控制连接状态、run id | 从日志里识别 `login to server success` 等事件 |
| 平均延迟 | 向 `serverAddr:serverPort` 拨一次 TCP，取握手耗时，滚动平均近一小时 |
| 在线时长、断线次数 | 进程存活时间 + 连接状态翻转计数 |
| **连接数、今日流量、24 小时曲线** | **`frps` 面板接口** `GET /api/proxy/{tcp,udp,http,https}` |

最后一行是关键：**`frpc` 不统计字节数和连接数**，那些计数器在服务端。
所以设置里多了一节「流量统计来源」——填上 frps 面板地址和凭据才有真实数字；
不填的话这些格子诚实地显示 `—`，不会编数据。

24 小时曲线是 Ferry 在本地按小时累计出来的：面板给的是「今日累计」，
这边做差分存进 `store.json` 的 24 个小时桶。所以曲线只覆盖 Ferry 运行过的时段。

日志里的消息保持 `frpc` 原样（英文）。这是排障用的日志，改写它等于骗人；
中文只出现在界面 chrome 和 Ferry 自己写的那几行上。

## 启停一条隧道意味着什么

frp 没有「运行时停用某条代理」的概念。开关拨到关，等于把这条 proxy
从 `frpc.toml` 里拿掉，然后走 admin 接口 `GET /api/reload` 热重载。
拨回开就再写回去。改服务器地址、token、传输协议这些不吃热重载，
Ferry 会重启 `frpc` 进程 —— 设置页的按钮上写明了是哪一种。

## 文件都在哪

配置和状态：`~/Library/Application Support/Ferry/`

- `frpc.toml` —— 生成的配置，权限 0600（里面有 token）
- `store.json` —— 设置、隧道列表、流量小时桶
- `frpc.log` —— 日志落盘，保留 7 天

admin 接口的端口每次启动重选一个空闲端口，口令随机生成且不落盘 —— 它只在
`127.0.0.1` 上给 Ferry 自己用。

## 项目结构

```
src/
├── main/                Electron 主进程
│   ├── main.js          生命周期、窗口、IPC
│   ├── frpc.js          子进程看护：启停、指数退避重连、热重载、admin 接口
│   ├── toml.js          frpc.toml 序列化 + 解析（导入用）
│   ├── store.js         持久化
│   ├── logbuf.js        stdout -> 结构化日志行
│   ├── metrics.js       采样层：frpc 状态 + frps 面板 + TCP 拨测
│   └── tray.js          菜单栏图标与面板窗口
├── preload/preload.js   contextBridge，渲染层唯一出口（window.ferry.*）
└── renderer/
    ├── index.html       主窗口（设计稿 01 号画板）
    ├── panel.html       菜单栏面板（设计稿 02 号画板）
    ├── css/apple.css    设计系统：token + 组件基础类
    ├── css/app.css      页面层
    └── js/…             各视图，原生 DOM，无框架
```

渲染层开着 `contextIsolation`、关着 `nodeIntegration`，并有 CSP
（`connect-src 'none'` —— 页面自己不发任何网络请求，全部走 IPC）。

## 设计笔记：与原型画布的差异

`FrpKit.dc.html` 是最初的原型，接上真实 frpc 之后有几处必须补：

- **多了「流量统计来源」一节** —— 没有 frps 面板凭据就拿不到流量和连接数（见上）。
- **多了「frpc 与版本」一节** —— 真实环境要能定位二进制、看版本。
- **多了标题栏的「连接 / 断开」按钮** —— 原型默认永远是已连接状态。
- **窗口交通灯用系统的** —— `titleBarStyle: 'hiddenInset'`，不再自绘那三个圆点。
- **「按隧道」表末列从「平均延迟」改成「状态」** —— 延迟只能对控制连接测，
  测不出单条代理的往返时间；给每条隧道编一个 ms 数会是假的。
- **「更新」一节换成「frpc 与版本」** —— 没有更新服务器可查，
  与其放一个永远显示「已是最新版本」的假按钮，不如放真正有用的：
  frpc 在哪、什么版本、怎么换一个。
- **上下行配色统一为「浅=上行，深=下行」** —— 设计稿里左栏速率条
  （上行浅、下行深）和图表图注（「深色为上行」）互相矛盾，
  这里按左栏那套统一。
- **数字不再是写死的** —— 原型里的 7 条隧道、14 行日志、9.62 GB 都是示意；
  这里为空时给的是空状态，不是假数据。
- **视觉系统整体换成了 macOS HIG 一套** —— 不再是画布里的 Industry 蓝图线框
  （直角、发丝边框、四角 `+` 定位标记、Barlow 字体），改用系统字体、systemBlue、
  连续圆角和真原生 vibrancy；屏幕结构和交互流程跟画布保持一致，只是外观换了代。

字体全部是系统自带的 San Francisco / PingFang SC（`-apple-system`），不再走
Google Fonts CDN，离线也不会有版式差异——CSP 里也因此不再需要 `fonts.googleapis.com`
这类外部白名单。

## 贡献

欢迎提 issue 和 PR。目前是个人业余维护，没有测试套件，改动请至少：

1. `npm start` 手动跑一遍改到的界面/流程；
2. 涉及 `frpc.toml` 序列化的改动，跑一遍 `npm run dist` 确认打包不受影响；
3. PR 里说清楚「为什么改」，尤其是涉及本 README「数据是真的从哪来的」那节列出的
   任何数据来源——新加的字段/图表如果没有真实来源，请显示空状态而不是编数据。

## License

[MIT](LICENSE)
