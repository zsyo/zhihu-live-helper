# fixture 目录说明

本目录存放知乎知学堂页面的脱敏测试快照和原始 CSS 文件，用于本地开发和布局适配。按页面类型分两个子目录：

- `live/` — 直播页脱敏快照 + 原始 CSS
- `replay/` — 回放页脱敏快照（完整渲染 DOM，无应用 JS）

两个子目录的 HTML 快照均已脱敏（用户名/讲师/课程名/各类 ID 均为伪数据，图片 404 属正常），并做了本地可用化处理（资源地址补全 https、移除需要登录态的应用脚本）。

## 原始 CSS 的作用

两个子目录下保存的原始 CSS 文件是为了**对比新旧版本**：知乎前端发版时，CSS 文件名中的内容哈希和类名后缀哈希可能变化。当布局异常时，重新下载新 CSS，与旧版本做 diff，快速定位哪些选择器或属性发生了变化，据此更新油猴脚本的覆盖规则。

- `live/` — 直播页样式表：`trainingApps~training-live.original.css`（页面布局）、`vendors.original.css`（公共依赖）
- `replay/` — 回放页样式表：`trainingApps~training-video.original.css`（页面布局）、`vendors.original.css`（公共依赖）。注意回放页与直播页是**独立的 CSS 包**（不同入口、不同哈希），不能共用，需分别对比。

## 如何更新

1. 打开一个真实的知乎知学堂对应页面（直播课 / 回放课）
2. 从页面源码的 `<link rel="stylesheet">` 标签中获取当前 CSS 的完整 URL（含最新哈希）
3. 下载新 CSS，与本目录下对应的旧文件对比
4. 确认类名前缀（直播页 `PcLive-`、`PcPlayer-`、`ShelfTopNav-`；回放页 `App-`、`VideoPlayer-`、`ShelfTopNav-`）是否仍然有效
5. 如有变化，更新 `zhihu-live-helper.user.js` 中的属性前缀选择器

```bash
# 下载最新 CSS（URL 从对应页面 <link> 标签获取）
curl -s "https://static.zhihu.com/education-webapp/.../<新哈希文件名>.css" -o /tmp/new.css
# 对比（直播页 / 回放页分别 diff）
diff fixture/live/trainingApps~training-live.original.css /tmp/new.css
diff fixture/live/vendors.original.css /tmp/new.css
diff fixture/replay/trainingApps~training-video.original.css /tmp/new.css
diff fixture/replay/vendors.original.css /tmp/new.css
```
