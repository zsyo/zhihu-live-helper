# 知乎知学堂直播布局助手

优化知乎知学堂（知课堂）直播课、回放课与公开课页面布局的油猴（Tampermonkey）脚本。

## 解决的问题

原始页面整页限宽、视频区固定尺寸不随窗口自适应，在大屏幕上页面利用率极低。直播页限宽 1000px、视频列 694px；回放页限宽 1000px；公开课用 155px 大内边距将内容限到 955px。三者均有此问题。

## 功能

| 功能 | 说明 | 操作 |
|------|------|------|
| 布局增强 | 视频区按 16:9 宽高比随浏览器窗口自适应并占据主体；右侧聊天互动区约 1/5~1/4 视口宽（默认 `clamp(280px, 22vw, 460px)`）；顶部导航的网站图标贴左、用户头像贴右，左右各留 50px 与主体对齐 | 快捷键 `W` 或油猴菜单 |
| 聊天区宽度调节 | 240px ~ 480px 范围内步进 20px，设置自动记忆 | 快捷键 `[` / `]`，`0` 重置 |
| 聊天新消息自动滚底 | 贴底时新消息自动滚动跟随；向上翻历史时自动暂停，滚回底部后恢复 | 自动生效 |
| 聊天字号调节 | 12 ~ 20px | 油猴菜单 |
| 真全屏与弹幕 | `F` 进入浏览器原生全屏，视频铺满整屏；全屏时以滚动弹幕展示互动消息（仅推送全屏后的新发言），显示区域/速度/开关均可调；`Enter` 唤起底部输入框发送，发送后或点击空白处自动收起 | `F` 进/退、`D` 弹幕开关、`,`/`.` 显示区域、`-`/`=` 速度、`Enter` 输入 |
| 回放页布局增强 | 回放课页面同样撑满宽度：视频区按 16:9 随窗口自适应占据主体，右侧"课程目录/学习笔记"区保持原生宽度与 Tab 轮播，仅随主体重新定位；顶部导航与直播页一致。回放页不含弹幕/全屏/聊天功能，仅布局 + 开关 | 快捷键 `W` 或油猴菜单 |
| 公开课布局增强 | 公开课页面同样撑满宽度：视频区按 16:9 随窗口自适应占据主体，右侧"课程目录"区保持原生 300px 宽，仅随主体重新定位；顶部导航（含搜索框）撑满全宽，左右 50px 留白。公开课不含弹幕/全屏/聊天功能，仅布局 + 开关 | 快捷键 `W` 或油猴菜单 |

所有设置（增强开关、宽度、字号、弹幕开关/区域/速度）持久化保存，刷新后保持。

**设计原则**：三类页面统一用 `zhx-enhanced` 类与 `W` 开关控制，关闭即移除类、还原原生布局。直播页只改 `PcContent-root` 宽度和下方主体区域（视频、聊天、公告、推荐）的布局；顶部导航解除 `max-width` 限制并加左右对称留白，让图标和头像分居两端且与主体边缘对齐，导航其余样式基于知乎原始 CSS。全屏以 `PcLive-liveWrapper` 为目标元素（保留右栏 DOM 便于复用输入框）；弹幕为自建纯 DOM 轨道层，不侵入原虚拟列表；输入复用站点原生 `PcInputBox` 的回车发送。回放页布局选择器改为 `App-content`/`App-navContent`/`VideoPlayer-*` 前缀（回放页 DOM 与直播页不同）；右侧"课程目录/学习笔记"栏保持原生宽度与 Tab 轮播裁剪，仅加左外边距随主体重定位。公开课布局选择器改为 `TopNavBar-content`/`PcContent-content`/`PcContent-leftContainer`/`PcContent-rightContainer`/`VideoPlayer-videoPlayerContainer` 前缀（公开课是独立的 `communityApps~video-course` 包，顶栏用 `TopNavBar` 而非 `ShelfTopNav`，主体用 `PcContent-content` 的 flex 布局）；右侧课程目录保持原生 300px，仅加左外边距。视频元素类名是 CSS Modules 短哈希（每次构建变化），用容器内 `video` 选择器兜底。

### 安装

**推荐使用 [ScriptCat](https://scriptcat.org/zh-CN)**（一个专注于用户脚本的浏览器扩展，轻量且开源）：

- 🐱 ScriptCat（推荐）：https://scriptcat.org/zh-CN/script-show-page/7581
- 🐵 Greasy Fork（备用）：https://greasyfork.org/zh-CN/scripts/592252

> **为什么推荐 ScriptCat？** ScriptCat 是国人开发的开源用户脚本管理器，对国内网络环境更友好，安装和更新更加顺畅。如果你已在使用 Tampermonkey 或 Violentmonkey，Greasy Fork 链接同样可用。

## 用本地页面做开发测试

仓库内 `fixture/` 目录按页面类型分三个子目录存放脱敏快照和原始 CSS：

- `fixture/live/` — 直播课脱敏页面（用户名/讲师/课程名/各类 ID 已替换为伪数据，图片 404 属正常），含原始 CSS，做了本地可用化处理（资源地址补全 https、移除需要登录态的应用脚本），可直接用于布局验证。
- `fixture/replay/` — 回放课脱敏页面（完整渲染 DOM 快照，含课程目录/学习笔记等结构，无应用 JS，可用于布局验证）与原始 CSS。
- `fixture/public/` — 公开课原始 CSS（独立 `communityApps~video-course` 包）。公开课可直接访问、无隐私问题，无需 HTML 快照，布局验证在真页进行。

```bash
# 本地 HTTP 服务（推荐），分别测试直播页 / 回放页
npx serve fixture/live
# 打开 http://localhost:3000/index.html
npx serve fixture/replay
# 打开 http://localhost:3000/index.html
```

> 测试时如需用 `file://` 直接打开 fixture HTML，可临时在脚本头部加一行 `// @match file:///*`；该匹配不随正式版本发布，避免误注入本地文件。


## 实现说明

- 页面 CSS 类名带构建哈希后缀（如 `PcLive-liveWrapper-mWENP`，每次构建可能变化），脚本一律使用 `[class*="PcLive-liveWrapper"]` 属性前缀选择器，仅依赖 `#livePlayer` 等稳定 ID，构建更新后依然有效；
- 视频区使用 `aspect-ratio:16/9` 基于宽度自适应高度，保持标准宽高比；播放器 SDK（CC 直播）会向容器写入内联像素尺寸，脚本以低频看门狗 + resize 事件派发兜底纠正；
- 顶部导航解除 `max-width` 限制并加左右对称 50px 留白，使网站图标和用户头像分居两端且与主体边缘对齐；导航其余样式基于知乎原始 CSS；
- 增强样式全部挂在 `<html>` 的 `zhx-enhanced` 类下，关闭即移除类，不污染原页面；
- 真全屏对 `PcLive-liveWrapper` 调用浏览器原生 `requestFullscreen()`（站点自身的”网页全屏”是 `position:absolute` 伪全屏，只铺满视频列），全屏时隐藏顶栏/公告/推荐/客服条/悬浮窗，视频铺满整屏；聊天盒离屏保留（透明、移出视口）而非 `display:none`，以保证虚拟列表继续渲染喂弹幕；
- 全屏弹幕为自建纯 DOM 轨道层（白字黑描边），弹幕层与输入浮层挂载到全屏元素子树内以避免被浏览器 top layer 遮挡；通过复用聊天自动滚底的 MutationObserver 抓取新消息推送，按消息内容去重，进入全屏时预标记历史消息，仅推送全屏后的新发言；显示区域用视口高度比例（4 档：1/8 ~ 1/4）决定层高、轨道数派生，滚动速度以单条弹幕滚完秒数计（6~20s，越小越快），三者均持久化、菜单与快捷键双通道可调，全屏内外即时生效；
- 全屏底部输入框复用站点原生 `PcInputBox`（DOM 移入浮层，非自建），回车发送走站点原生逻辑（发送后自动收起），输入态下所有快捷键禁用、ESC 退出全屏；点击空白处收起输入框；
- 全屏时尺寸看门狗暂停纠正内联尺寸，避免与播放器 SDK 全屏渲染冲突；
- 脚本按页面特征分流：命中 `PcLive-liveWrapper` 走直播逻辑（全屏/弹幕/聊天），命中 `App-content`/`VideoPlayer-content` 走回放逻辑（仅布局 + `W` 开关），命中 `PcContent-content`/`VideoPlayer-videoPlayerContainer` 走公开课逻辑（仅布局 + `W` 开关），三类互不干扰；
- 公开课 `<video>` 元素类名是 CSS Modules 短哈希（如 `_1k7bcr7`，每次构建必变），用 `[class*="PcContent-content"] video` 容器内选择器兜底，不依赖具体哈希；
- 未匹配到任何已知容器时脚本静默退出，不影响其他页面。

## 文件结构

```
zhihu-edu-helper/
├── zhihu-live-helper.user.js        # 油猴脚本（交付物，覆盖直播页、回放页与公开课）
└── fixture/
    ├── README.md                     # 目录说明
    ├── live/                         # 直播页脱敏快照 + 原始 CSS
    │   ├── index.html
    │   ├── trainingApps~training-live.original.css
    │   └── vendors.original.css
    ├── replay/                       # 回放页脱敏快照（完整渲染 DOM）+ 原始 CSS
    │   ├── index.html
    │   ├── trainingApps~training-video.original.css
    │   └── vendors.original.css
    └── public/                       # 公开课原始 CSS（无 HTML 快照）
        ├── communityApps~video-course.original.css
        └── vendors.original.css
```

## 许可证

MIT License — 详见 [LICENSE](LICENSE) 文件。
