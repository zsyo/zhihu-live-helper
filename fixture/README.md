# fixture 目录说明

本目录存放知乎知学堂直播页面的脱敏测试快照和原始 CSS 文件，用于本地开发和布局适配。

- 脱敏后的页面 HTML 快照（用户名/讲师/课程名/ID 均为伪数据）
- 该页面对应的原始 CSS 文件（用于新旧版本对比适配）

## 原始 CSS 的作用

保存原始 CSS 文件是为了**对比新旧版本**：知乎前端发版时，CSS 文件名中的内容哈希和类名后缀哈希可能变化。当布局异常时，重新下载新 CSS，与旧版本做 diff，快速定位哪些选择器或属性发生了变化，据此更新油猴脚本的覆盖规则。

## 如何更新

1. 打开一个真实的知乎知学堂对应页面
2. 从页面源码的 `<link rel="stylesheet">` 标签中获取当前 CSS 的完整 URL（含最新哈希）
3. 下载新 CSS，与本目录下对应的旧文件对比
4. 确认类名前缀（如 `PcLive-`、`PcPlayer-`、`ShelfTopNav-`）是否仍然有效
5. 如有变化，更新 `zhihu-live-helper.user.js` 中的属性前缀选择器

```bash
# 下载最新 CSS（URL 从对应页面 <link> 标签获取）
curl -s "https://static.zhihu.com/education-webapp/.../<新哈希文件名>.css" -o /tmp/new.css
# 对比（主样式表 / 公共依赖分别 diff）
diff fixture/trainingApps~training-live.original.css /tmp/new.css
diff fixture/vendors.original.css /tmp/new.css
```
