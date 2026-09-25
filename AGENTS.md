# 项目开发规范

本文件补充本仓库的工程约定，适用于任何在本项目中编写或修改代码的协作者（含 AI 代理）。全局规范之外，以本文件为准。

## 版本号纪律（最高优先级）

- 不要自动修改 `zhihu-live-helper.user.js` 的 `@version`，也不要擅自往 README.md / RELEASE_LOG.md 写版本变更内容。
- 仅当用户明确告知"更新版本号"时，才同步这三处：脚本 `@version`、RELEASE_LOG.md（新增版本小节）、README.md（如功能表述有变）。
- 迭代中的未验证功能不要提前落进版本记录；中间改动直接改脚本，等用户验证通过、由用户通知后再定版，防止未验证点被反复改写。

## 项目形态

- 唯一交付物是根目录单文件油猴脚本 `zhihu-live-helper.user.js`：全部逻辑在一个 IIFE 内，CSS 集中在文件顶部的大模板字符串，无构建、无依赖、无 TypeScript。不新建 `src/` 目录，不引入框架或打包工具。
- 新增内容就近归属现有分区：常量进文件头 `K` / `DM_*` 区；样式进 CSS 字符串并用中文分区注释；逻辑按 `// ================= 分节 =================` 归位；自建元素 id/class 一律 `zhx-` 前缀。

## 站点选择器约定

- 站点类名带构建哈希（每次发版可能变化），一律用属性前缀选择器 `[class*="PcLive-xx"]`，只信任稳定 ID（`#livePlayer`）。
- 站点发版导致布局或抓取异常时，按 `fixture/README.md` 的流程下载新 CSS 与 `*.original.css` 做 diff，再更新脚本内的选择器和覆盖规则。

## 弹幕与全屏链路（改动前必读）

- 弹幕只在真全屏态渲染：`pushDanmaku()` 有 `isTheater()` 闸门；消息来源是聊天盒 DOM 的 MutationObserver（`extractNewMessages`），脚本不发任何网络请求，新增取数逻辑继续走 DOM 抓取。
- 弹幕层和控制条默认挂 `body`，进/出全屏时搬进/搬出全屏元素子树（浏览器 top layer 会遮挡 body 上的 fixed 元素）；退出全屏要 `clearDanmaku()` 并按记录的原 DOM 位置精确还原输入框。
- 弹幕样式集中在 `.zhx-dm-track` 与 `zhx-dmc-*` 颜色类；新增颜色档位需同时改 `DM_COLOR_TEXTS`、`DM_COLOR_CLASSES`、CSS 规则和设置面板行四处。
- 轨道调度为"首个空闲轨道 + 不排队丢弃"，改调度逻辑前先读懂 `pushDanmaku()` 现有规则再动手。

## 设置项约定

- 存储走 `store` 抽象（`GM_getValue` 优先，localStorage 兜底），key 登记进 `K` 对象，初值进 `state`。
- 新设置项至少同步两个操作通道（控制条设置窗 + 油猴菜单），变更后调 `syncToolbar()` 并 `toast` 反馈；调节函数要有 clamp 收敛，旧持久化值越界时收进合法范围。
- 增强样式统一挂在 `<html>` 的 `zhx-enhanced` / `zhx-theater` 类下，开关即切类，关闭还原原生布局。

## 代码与注释风格

- 中文注释，只写"为什么"（约束、原因、踩过的坑），不写"下一行做什么"；注释密度参照周围代码。
- 代码中不出现 emoji（注释、日志、字符串常量、commit message 均同）。
- 出错直接抛出或明确降级，不用静默兜底掩盖问题；例外是有意为之的浏览器限制（如视频跨域采样失败），需注释说明。

## 验证

- 改完至少执行 `node --check zhihu-live-helper.user.js`。
- 涉及弹幕、布局、控制条可用 fixture 本地 mock：`npx serve fixture/live` 后注入脚本验证。
- 真实直播页效果（全屏、播放器 SDK、弹幕观感）由用户手动验证为准；验证未通过前不动版本号和文档发布记录。
