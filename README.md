# 知乎知学堂直播布局助手

优化知乎知学堂（知课堂）直播课页面布局的油猴（Tampermonkey）脚本。

## 解决的问题

原始页面整页限宽 **1000px**、视频列固定 **694px**、播放器固定高 **416px**、聊天区固定 **296px**，在大屏幕上页面利用率极低。

## 功能

| 功能 | 说明 | 操作 |
|------|------|------|
| 布局增强 | 视频区按 16:9 宽高比随浏览器窗口自适应并占据主体；右侧聊天互动区约 1/5~1/4 视口宽（默认 `clamp(280px, 22vw, 460px)`）；顶部导航的网站图标贴左、用户头像贴右（右侧留出边距使下拉菜单不溢出） | 快捷键 `W` 或油猴菜单 |
| 聊天区宽度调节 | 240px ~ 480px 范围内步进 20px，设置自动记忆 | 快捷键 `[` / `]`，`0` 重置 |
| 聊天新消息自动滚底 | 贴底时新消息自动滚动跟随；向上翻历史时自动暂停，滚回底部后恢复 | 自动生效 |
| 聊天字号调节 | 12 ~ 20px | 油猴菜单 |

所有设置（增强开关、宽度、字号）持久化保存，刷新后保持。

**设计原则**：只改 `PcContent-root` 宽度和下方主体区域（视频、聊天、公告、推荐）的布局；顶部导航解除 `max-width` 限制让图标和头像分居两端，但导航样式仍基于知乎原始 CSS。

### 安装

**推荐使用 [ScriptCat](https://scriptcat.org/zh-CN)**（一个专注于用户脚本的浏览器扩展，轻量且开源）：

- 🐱 ScriptCat（推荐）：https://scriptcat.org/zh-CN/script-show-page/7581
- 🐵 Greasy Fork（备用）：https://greasyfork.org/zh-CN/scripts/592252

> **为什么推荐 ScriptCat？** ScriptCat 是国人开发的开源用户脚本管理器，对国内网络环境更友好，安装和更新更加顺畅。如果你已在使用 Tampermonkey 或 Violentmonkey，Greasy Fork 链接同样可用。

## 用本地页面做开发测试

仓库内 `fixture/` 目录存放脱敏后的页面快照和原始 CSS。`fixture/index.html` 是直播课的脱敏页面（用户名/讲师/课程名/各类 ID 已替换为伪数据，图片 404 属正常），并做了本地可用化处理（资源地址补全 https、移除需要登录态的应用脚本、注入模拟聊天消息）。

```bash
# 本地 HTTP 服务（推荐）
npx serve fixture
# 打开 http://localhost:3000/index.html
```

也可直接双击以 `file://` 打开——需要在脚本猫扩展详情中开启「允许访问文件网址」，脚本的 `@match file:///*` 才会生效。


## 实现说明

- 页面 CSS 类名带构建哈希后缀（如 `PcLive-liveWrapper-mWENP`，每次构建可能变化），脚本一律使用 `[class*="PcLive-liveWrapper"]` 属性前缀选择器，仅依赖 `#livePlayer` 等稳定 ID，构建更新后依然有效；
- 视频区使用 `aspect-ratio:16/9` 基于宽度自适应高度，保持标准宽高比；播放器 SDK（CC 直播）会向容器写入内联像素尺寸，脚本以低频看门狗 + resize 事件派发兜底纠正；
- 顶部导航解除 `max-width` 限制，使网站图标和用户头像分居左右两端（头像右侧留边距使下拉菜单不溢出），导航其余样式基于知乎原始 CSS；只改 `PcContent-root` 宽度和下方主体区域 `PcLive-liveWrapper`；
- 增强样式全部挂在 `<html>` 的 `zhx-enhanced` 类下，关闭即移除类，不污染原页面；
- 未匹配到直播容器时脚本静默退出，不影响其他页面。

## 文件结构

```
zhihu-edu-helper/
├── zhihu-live-helper.user.js        # 油猴脚本（交付物）
└── fixture/
    ├── README.md                     # 文件说明
    ├── index.html                    # 本地开发测试页面（伪数据）
    ├── trainingApps~training-live.original.css  # 原始主样式表
    └── vendors.original.css          # 原始公共依赖样式表
```
