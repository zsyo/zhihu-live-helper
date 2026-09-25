// ==UserScript==
// @name        知乎知学堂直播布局助手
// @namespace   https://github.com/zsyo/zhihu-live-helper
// @version     1.6.1
// @description 重排知乎知学堂直播页、回放页与公开课页：视频区随窗口自适应并占据主体（16:9），右侧目录/互动区保持原生宽；直播页支持真全屏（F 键）、全屏弹幕（25px 加粗、2px 黑描边加黑晕，可选白/黑/蓝/绿/红/黄六色，仅推全屏后新发言）、全屏底部浮动控制条（左侧条形聊天输入框+蓝色发送按钮：回车发送、最多 80 字、空内容回车退出输入态；弹幕开/关与弹幕设置悬浮窗：区域 1/8~1/5 与速度 6~16s 线段档位点选、颜色六档；音量 0-100 与静音；鼠标移动唤出，3 秒无操作自动隐藏，打字/悬停/设置窗开着时保活）；回放/公开课页同样优化布局（W 开关）。
// @author      zephyr
// @match       https://www.zhihu.com/xen/training/live/*
// @match       https://www.zhihu.com/xen/market/training/training-video/*
// @match       https://www.zhihu.com/education/video-course/*
// @run-at      document-start
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_registerMenuCommand
// @license     MIT
// @noframes
// ==/UserScript==

/*
 * 页面原始布局(线上 CSS):
 *   .PcContent-root           width:1000px        ← 整页限宽
 *   .PcLive-player            width:694px         ← 视频列固定宽
 *   .PcPlayer-playerWrapper   height:416px        ← 播放器固定高(非16:9)
 *   .PcLive-rightWrapper      width:296px         ← 聊天区固定宽
 *   .ShelfTopNav-root         position:fixed;width:100%  ← 顶栏(固定全宽, 不受 PcContent-root 影响)
 *
 * 本脚本主要修改下方主体区域(PcLive-liveWrapper 及其子树)。
 * 类名带构建哈希后缀, 全部用 [class*="前缀"] 属性选择器; 锚点 ID #livePlayer 不变。
 */

(function () {
  'use strict';

  const LOG = '[知学堂直播助手]';
  const K = { enabled: 'zhx_enabled', chatW: 'zhx_chat_w', chatFs: 'zhx_chat_fs',
              danmaku: 'zhx_danmaku', dmArea: 'zhx_dm_area', dmSpeed: 'zhx_dm_speed',
              dmColor: 'zhx_dm_color',
              volume: 'zhx_volume', muted: 'zhx_muted' };
  const DEFAULT_CHAT_W = 'clamp(280px, 22vw, 460px)'; // ≈ 1/5 ~ 1/4 视口宽
  const CHAT_W_MIN = 240, CHAT_W_MAX = 480, CHAT_W_STEP = 20;
  const FS_MIN = 12, FS_MAX = 20;
  // 弹幕配置: 显示区域 4 档(层高占视口比), 轨道高, 滚完秒数(越小越快), 在屏上限
  const DM_AREA_LEVELS = ['12.5vh', '14.3vh', '16.7vh', '20vh']; // 1/8 → 1/5, 4 档
  const DM_AREA_TEXTS = ['1/8', '1/7', '1/6', '1/5'];             // 显示区域档位文案
  const DM_TRACK_H = 36;
  const DM_DURATION_MIN = 6, DM_DURATION_MAX = 16, DM_DURATION_STEP = 2;
  const DM_MAX = 60;
  // 弹幕颜色 6 档(白/黑/蓝/绿/红/黄)与对应 html 类名; 默认白, 除黑色用白描边外其余统一黑描边
  const DM_COLOR_TEXTS = ['白', '黑', '蓝', '绿', '红', '黄'];
  const DM_COLOR_CLASSES = ['zhx-dmc-white', 'zhx-dmc-black', 'zhx-dmc-blue',
                            'zhx-dmc-green', 'zhx-dmc-red', 'zhx-dmc-yellow'];

  // ---- 存储层: 有 GM 用 GM, 无 GM(本地注入测试)退化为 localStorage ----
  const store = {
    get(k, d) {
      try { if (typeof GM_getValue === 'function') return GM_getValue(k, d); } catch { /* ignore */ }
      try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) {
      try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch { /* ignore */ }
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
    },
  };

  const state = {
    enabled: store.get(K.enabled, true),
    chatW: store.get(K.chatW, null),   // null = 默认 clamp
    chatFs: store.get(K.chatFs, 14),
    danmaku: store.get(K.danmaku, true),  // 全屏弹幕开关
    dmArea: store.get(K.dmArea, 2),       // 0-3, 默认档3(1/6 屏)
    dmSpeed: Math.min(DM_DURATION_MAX, Math.max(DM_DURATION_MIN, store.get(K.dmSpeed, 10))), // 滚完秒数, 默认10s, 越小越快; 旧持久化超新范围时收敛
    dmColor: Math.min(DM_COLOR_TEXTS.length - 1, Math.max(0, store.get(K.dmColor, 0) | 0)), // 弹幕颜色档位, 默认白; 旧持久化值越界时收敛
    volume: store.get(K.volume, null),     // 音量 0-100, null=用户未调过(不干预 SDK 默认)
    muted: store.get(K.muted, false),       // 静音开关
  };

  const $find = (prefix, root) => (root || document).querySelector(`[class*="${prefix}"]`);

  // 是否处于真全屏态: 浏览器全屏元素存在 且 标记类已挂上
  function isTheater() {
    return !!document.fullscreenElement && document.documentElement.classList.contains('zhx-theater');
  }

  // 页面类型: 'live'(直播) / 'replay'(回放) / 'public'(公开课), 启动时按容器特征判定
  let pageType = null;

  // ================= 样式 =================
  // 顶栏: 解除 max-width 限制并加左右对称 padding, 让 logo 和头像分别靠两端且与主体留白对齐
  const CSS = `
/* ===== 顶栏: logo 左、头像右, 撑满全宽(左右对称留白与主体一致) ===== */
html.zhx-enhanced [class*="PcContent-root"]{width:100% !important;max-width:none !important;}
html.zhx-enhanced [class*="PcContent-headContentClassName"]{max-width:none !important;}
html.zhx-enhanced [class*="ShelfTopNav-content"]{
  max-width:none !important;margin:0 !important;
  padding:0 50px !important;box-sizing:border-box !important;
}
/* ShelfTopNav-right 不再额外加 padding, 头像右侧留白由上方 content 的 padding 统一提供 */
/* ===== 主体区域: 撑满宽度, 顶部留出固定导航栏高度, 两侧留白避开悬浮条 ===== */
html.zhx-enhanced [class*="PcLive-liveWrapper"]{
  width:100% !important;justify-content:flex-start !important;
  padding:70px 50px 0 !important;box-sizing:border-box !important;
}
/* 左列: 视频列, 吃满剩余宽度 */
html.zhx-enhanced [class*="PcLive-player"]{width:auto !important;flex:1 1 auto !important;min-width:0 !important;}
/* PcLive-player 下有个无 class 包裹 div, 需一并撑开 */
html.zhx-enhanced [class*="PcLive-player"] > div{width:100%;}
/* 播放器: 16:9 宽高比, 基于宽度自适应高度 */
html.zhx-enhanced [class*="PcPlayer-playerWrapper"]{height:auto !important;aspect-ratio:16/9;width:100% !important;}
/* 播放器内部容器链: 填满父容器(16:9 比例由 playerWrapper 决定) */
html.zhx-enhanced [class*="PcPlayer-wh100"]{width:100% !important;height:100% !important;position:relative;}
html.zhx-enhanced [class*="PcPlayer-introWrapper"]{width:100% !important;height:100% !important;}
html.zhx-enhanced [class*="PcPlayer-streams"]{width:100% !important;height:100% !important;}
html.zhx-enhanced #livePlayer{width:100% !important;height:100% !important;position:relative;}
html.zhx-enhanced #livePlayer video,
html.zhx-enhanced #livePlayer canvas,
html.zhx-enhanced #livePlayer iframe{width:100% !important;height:100% !important;object-fit:contain;}
/* 公告栏/推荐区: 自然高度, 不挤占视频空间, 宽度限制在视频列内 */
html.zhx-enhanced [class*="PcLive-announcementWrapper"]{width:100% !important;flex:0 0 auto !important;box-sizing:border-box !important;}
html.zhx-enhanced [class*="PcLive-voteCard"]{width:100% !important;flex:0 0 auto !important;box-sizing:border-box !important;}
html.zhx-enhanced [class*="PcLive-tabWrapper"]{width:100% !important;min-height:0 !important;flex:0 0 auto !important;box-sizing:border-box !important;}
/* 右列: 聊天互动区, 可调宽; align-self 拉到行高(跟随左列视频+公告+推荐的总高),
   chatBox 自身用固定视口高度, 不随右列被拉高而拉伸, 客服条自然垫在其下 */
html.zhx-enhanced [class*="PcLive-rightWrapper"]{
  width:var(--zhx-chat-w, ${DEFAULT_CHAT_W}) !important;
  flex:0 0 var(--zhx-chat-w, ${DEFAULT_CHAT_W}) !important;
  margin-left:10px;
  align-self:stretch;
}
/* 聊天区固定高度: 视口减去顶栏(70px)和底部客服条(约70px), 保证占满主体而不被推荐卡片挤压 */
html.zhx-enhanced [class*="PcLive-chatBox"]{height:calc(100vh - 140px) !important;min-height:0 !important;}
html.zhx-enhanced [class*="PcChatBox-root"]{min-height:0 !important;overflow:hidden !important;}
/* 播放器原生"网页全屏"时还原全屏几何(位于普通规则之后) */
html.zhx-enhanced [class*="PcPlayer-playerWrapperFullScreen"]{
  position:absolute !important;z-index:40 !important;
  top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;
  width:100% !important;height:100% !important;aspect-ratio:auto !important;flex:none !important;
}
html.zhx-enhanced [class*="PcPlayer-introWrapperFullScreen"]{width:100% !important;}
/* ===== 聊天区体验 ===== */
html.zhx-enhanced [class*="PcChatBox-root"]{font-size:var(--zhx-chat-fs, 14px);}
html.zhx-enhanced [class*="PcChatBox-root"] [class*="Message-content"]{font-size:var(--zhx-chat-fs, 14px) !important;}
/* ===== 提示 ===== */
/* ===== 真全屏: 以 PcLive-liveWrapper 为全屏元素, 铺满视口 ===== */
html.zhx-theater [class*="PcLive-liveWrapper"]{
  width:100vw !important;height:100vh !important;padding:0 !important;margin:0 !important;
  max-width:none !important;box-sizing:border-box !important;background:#000 !important;
}
html.zhx-theater [class*="PcContent-shelfTopNav"],
html.zhx-theater [class*="PcLive-announcementWrapper"],
html.zhx-theater [class*="PcLive-tabWrapper"],
html.zhx-theater [class*="PcLive-voteCard"],
html.zhx-theater [class*="PcLive-customerCall"],
html.zhx-theater [class*="FloatingWindow"]{display:none !important;}
/* 全屏: 视频列吃满, 右栏聊天盒离屏保留(喂弹幕), 聊天输入框整合在底部浮动控制条中 */
html.zhx-theater [class*="PcLive-player"]{width:100% !important;flex:1 1 auto !important;min-width:0 !important;}
html.zhx-theater [class*="PcLive-rightWrapper"]{width:0 !important;flex:0 0 0 !important;overflow:visible !important;margin:0 !important;}
/* 聊天盒离屏保留: 不可 display:none, 否则 ReactVirtualized 虚拟列表 clientHeight 归零
   停止渲染消息行, MutationObserver 断流导致弹幕无数据源。改为移出视口+透明+禁交互,
   保留其原生高度(calc(100vh-70px))让虚拟列表继续渲染并喂弹幕 */
html.zhx-theater [class*="PcLive-chatBox"]{
  position:fixed !important;top:-100vh !important;left:0 !important;width:296px !important;
  height:calc(100vh - 70px) !important;
  opacity:0 !important;pointer-events:none !important;z-index:-1 !important;
}
/* 全屏高度链: PcLive-player 原生 flex-direction:column, 其无 class 包裹 div 需显式撑满,
   否则 playerWrapper 的 height:100% 参考坍缩父级导致视频塌缩为黑底 */
html.zhx-theater [class*="PcLive-player"] > div{height:100% !important;width:100% !important;}
html.zhx-theater [class*="PcPlayer-playerWrapper"]{height:100% !important;width:100% !important;aspect-ratio:auto !important;}
html.zhx-theater [class*="PcPlayer-wh100"],
html.zhx-theater [class*="PcPlayer-streams"],
html.zhx-theater [class*="PcPlayer-livePlayerWrapper"],
html.zhx-theater #livePlayer{height:100% !important;width:100% !important;}
/* ===== 弹幕轨道层: 高度由 --zhx-dm-area 决定(可调档) ===== */
#zhx-danmaku{
  position:fixed;top:0;left:0;width:100%;height:var(--zhx-dm-area, 20vh);
  z-index:2147483646;pointer-events:none;overflow:hidden;display:none;
}
html.zhx-theater #zhx-danmaku{display:block;}
.zhx-dm-track{
  position:absolute;left:100%;white-space:nowrap;will-change:transform;
  font-size:25px;line-height:36px;color:#fff;font-weight:700;
  -webkit-text-stroke:2px #000;text-stroke:2px #000;
  paint-order:stroke fill;
  /* 黑晕: 实心 1px + 两级扩散。描边只护字形轮廓, 护不住笔画内部,
     白底画面上白色笔画与背景融为一体, 靠这圈柔黑把字形从背景里托出来 */
  text-shadow:0 1px 0 rgba(0,0,0,.9),0 0 3px rgba(0,0,0,.8),0 0 7px rgba(0,0,0,.55);
  animation:zhx-dm-scroll linear forwards;
}
/* 弹幕颜色 6 档(白/黑/蓝/绿/红/黄): html 挂 zhx-dmc-* 类切换, 在屏弹幕即时跟随。
   白色即下方默认(单独一条同效规则只为显式); 黑色反配白描边白晕(其余五色在黑底上
   都醒目, 唯独黑色需要白描边才托得住), 蓝/绿/红/黄只改字色, 沿用默认黑描边+黑晕 */
html.zhx-dmc-white .zhx-dm-track{color:#fff;}
html.zhx-dmc-black .zhx-dm-track{
  color:#000;
  -webkit-text-stroke:2px #fff;text-stroke:2px #fff;
  text-shadow:0 1px 0 rgba(255,255,255,.95),0 0 3px rgba(255,255,255,.9),0 0 7px rgba(255,255,255,.6);
}
html.zhx-dmc-blue .zhx-dm-track{color:#00a1d6;}
html.zhx-dmc-green .zhx-dm-track{color:#2ecc71;}
html.zhx-dmc-red .zhx-dm-track{color:#ff4d4f;}
html.zhx-dmc-yellow .zhx-dm-track{color:#ffd700;}
@keyframes zhx-dm-scroll{from{transform:translateX(0)}to{transform:translateX(calc(-100vw - 100%))}}
/* ===== 全屏控制条: 聊天输入组(复用原 PcInputBox) =====
   灰底整体画在输入槽(slot)上并锁定 32px 高(与发送按钮/其他控件一致,
   原生容器内的其他元素不再影响灰底高度, 超出部分裁剪) */
#zhx-input-slot{
  flex:1 1 auto;min-width:220px;display:flex;align-items:center;
  height:32px;overflow:hidden;
  background:#4a515c66;border-radius:8px 0 0 8px;
}
/* 发送按钮/字数统计抽出后的自建容器, 与输入槽平级拼接:
   负边距抵消工具条全局 gap(12px)并压掉渲染亚像素缝, 按钮固定 32px 与输入框等高 */
#zhx-send-host{display:flex;align-items:center;flex:0 0 auto;margin-left:-13px;}
html.zhx-theater [class*="PcInputBox-root"]{flex:1 1 auto;min-width:0;display:flex !important;align-items:stretch !important;background:transparent !important;width:auto !important;margin:0 !important;padding:0 !important;}
html.zhx-theater [class*="PcInputBox-root"]:after{display:none !important;} /* 去掉原生输入框顶部分隔线 */
html.zhx-theater [class*="PcInputBox-sendBtnWrapper"]{display:none !important;} /* 按钮已抽出, 空壳全隐藏 */
/* 输入区: 灰底由 slot 提供, textarea 透明仅负责文字; 单行跑马灯(超宽横向滚动, 滚动条隐藏) */
html.zhx-theater [class*="PcInputBox-textareaWrapper"]{
  flex:1 1 auto;min-width:0;display:flex !important;align-items:center !important;
  margin:0 !important;padding:0 !important;
}
html.zhx-theater [class*="PcInputBox-textarea"]{
  width:100% !important;height:32px !important;line-height:22px;
  background:transparent !important;color:#fff !important;
  border:none !important;padding:5px 12px !important;font-size:14px !important;resize:none !important;
  white-space:nowrap !important;overflow-x:auto !important;overflow-y:hidden !important;
}
html.zhx-theater [class*="PcInputBox-textarea"]::-webkit-scrollbar{display:none;}
html.zhx-theater [class*="PcInputBox-textarea"]{scrollbar-width:none;}
html.zhx-theater [class*="PcInputBox-textarea"]::placeholder{color:rgba(255,255,255,.45) !important;}
html.zhx-theater [class*="PcInputBox-clickTip"]{display:none !important;}
/* 字数统计内嵌输入槽尾部: 底色透明由 slot 灰底统一提供, 自带 padding 与发送按钮隔开 */
html.zhx-theater #zhx-input-slot [class*="PcInputBox-textCount"]{
  align-self:stretch;display:flex;align-items:center;padding:0 12px;margin:0 !important;
  background:transparent !important;color:rgba(255,255,255,.55) !important;font-size:12px !important;
  line-height:1 !important;white-space:nowrap;
}
html.zhx-theater [class*="PcInputBox-sendButton"]{
  width:auto !important;min-width:64px;height:32px !important;padding:0 16px;
  display:flex !important;align-items:center !important;justify-content:center !important;line-height:normal !important;
  border:none !important;border-radius:0 8px 8px 0;
  /* 彻底清除原生可能带有的渐变遮罩/滤镜/混合模式/阴影/伪元素, 强制全不透明 */
  background-image:none !important;background-color:#4a83f9 !important;
  opacity:1 !important;filter:none !important;mix-blend-mode:normal !important;box-shadow:none !important;
  color:#fff !important;
  font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0;margin:0 !important;
}
html.zhx-theater [class*="PcInputBox-sendButton"]::before,
html.zhx-theater [class*="PcInputBox-sendButton"]::after{display:none !important;content:none !important;}
/* 悬停加深加蓝(与音量条 accent 悬停观感同向) */
html.zhx-theater [class*="PcInputBox-sendButton"]:hover{background-color:#2f6ce4 !important;opacity:1 !important;}
/* 空内容的 disabled 态不再降透明度(灰蒙蒙的真凶): 仅改指针, 发送拦截由回车逻辑负责 */
html.zhx-theater [class*="PcInputBox-sendButton"][class*="PcInputBox-disabled"]{cursor:default;opacity:1 !important;}
/* ===== 全屏底部浮动控制条: 输入框 / 弹幕开关+设置 / 音量 ===== */
#zhx-toolbar{
  position:fixed;left:50%;bottom:16px;transform:translateX(-50%) translateY(150%);
  width:min(880px,92vw);z-index:2147483647;display:none;align-items:center;gap:12px;visibility:hidden;pointer-events:none;
  background:rgba(0,0,0,.4);backdrop-filter:blur(6px);border-radius:8px;padding:8px 14px;
  transition:transform .18s ease,visibility 0s linear .18s;
}
/* 仅全屏时启用; 鼠标活动唤起时上移可见 */
html.zhx-theater #zhx-toolbar{display:flex;}
#zhx-toolbar.zhx-show{transform:translateX(-50%) translateY(0);visibility:visible;pointer-events:auto;transition:transform .18s ease,visibility 0s;}
.zhx-tb-btn{
  min-width:32px;height:32px;padding:0 10px;border:none;border-radius:16px;cursor:pointer;
  background:rgba(255,255,255,.12);color:#fff;font-size:13px;line-height:1;white-space:nowrap;flex:0 0 auto;
  display:flex;align-items:center;justify-content:center;font-family:inherit;
}
.zhx-tb-btn:not(:disabled):hover{background:rgba(255,255,255,.28);}
.zhx-tb-btn:focus-visible{outline:1px solid rgba(255,255,255,.6);}
.zhx-tb-btn.zhx-off{color:rgba(255,255,255,.4);}
.zhx-tb-btn:disabled{opacity:.35;cursor:not-allowed;}
.zhx-tb-group{position:relative;display:flex;align-items:center;gap:6px;flex:0 0 auto;}
#zhx-tb-vol-num{color:rgba(255,255,255,.85);font-size:12px;width:28px;text-align:center;line-height:20px;margin-left:-6px;flex:0 0 auto;}
#zhx-tb-vol{width:110px;height:20px;accent-color:#3b82f6;cursor:pointer;flex:0 0 auto;}
.zhx-tb-sep{width:1px;height:20px;background:rgba(255,255,255,.2);flex:0 0 auto;}
/* ===== 弹幕设置悬浮窗(弹幕设置按钮上方弹出, 线段档位选择) ===== */
#zhx-dm-popover{
  position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);
  min-width:340px;padding:14px 18px 16px;border-radius:14px;
  background:rgba(0,0,0,.72);backdrop-filter:blur(6px);opacity:.95;
  display:none;flex-direction:column;gap:14px;
}
#zhx-dm-popover.zhx-open{display:flex;}
.zhx-dm-row{display:flex;align-items:flex-start;gap:10px;}
.zhx-dm-row-label{color:rgba(255,255,255,.8);font-size:12px;line-height:24px;white-space:nowrap;flex:0 0 auto;}
.zhx-dm-seg{display:flex;gap:4px;flex:1 1 auto;padding-top:7px;}
.zhx-dm-seg-item{
  flex:1 1 0;min-width:34px;border:none;background:none;padding:0;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;gap:5px;font-family:inherit;
}
.zhx-dm-seg-item i{display:block;width:100%;height:5px;border-radius:3px;background:rgba(255,255,255,.25);transition:background .12s;}
.zhx-dm-seg-item:hover i{background:rgba(255,255,255,.55);}
.zhx-dm-seg-item em{font-style:normal;color:rgba(255,255,255,.55);font-size:11px;line-height:1;}
.zhx-dm-seg-item.zhx-on i{background:#3b82f6;}
.zhx-dm-seg-item.zhx-on em{color:#fff;}
/* 弹幕颜色档位: 选项文字直接用对应弹幕颜色, 与画面效果直观对应(ID 选择器压过选中态变白)。
   黑色选项加轻微白描边: 深色面板底上纯黑字会糊进背景 */
#zhx-dm-seg-color .zhx-dm-seg-item[data-idx="0"] em{color:#fff;}
#zhx-dm-seg-color .zhx-dm-seg-item[data-idx="1"] em{color:#000;-webkit-text-stroke:.5px rgba(255,255,255,.9);paint-order:stroke fill;}
#zhx-dm-seg-color .zhx-dm-seg-item[data-idx="2"] em{color:#00a1d6;}
#zhx-dm-seg-color .zhx-dm-seg-item[data-idx="3"] em{color:#2ecc71;}
#zhx-dm-seg-color .zhx-dm-seg-item[data-idx="4"] em{color:#ff4d4f;}
#zhx-dm-seg-color .zhx-dm-seg-item[data-idx="5"] em{color:#ffd700;}
#zhx-toast{
  position:fixed;right:16px;bottom:16px;z-index:9999;
  padding:6px 14px;border-radius:16px;background:rgba(0,0,0,.72);color:#fff;
  font-size:13px;pointer-events:none;opacity:0;transition:opacity .25s;
}
#zhx-toast.zhx-show{opacity:1;}
/* ===== 回放页布局: 顶栏复用直播页规则(ShelfTopNav 同款), 主体用 App / VideoPlayer 前缀 ===== */
/* 顶栏: App-navContent 在回放页把 ShelfTopNav-content 限宽到 1000px, 需一并去除限宽并左右留白 */
html.zhx-enhanced [class*="App-navContent"]{
  max-width:none !important;width:auto !important;margin:0 !important;
  padding:0 50px !important;box-sizing:border-box !important;
}
/* 主体: 原生 App-content 已有 margin-top:70px 让出固定顶栏(60px), 这里只加左右留白, 顶部不再叠加 padding */
html.zhx-enhanced [class*="App-content"]{max-width:none !important;width:100% !important;padding:0 50px !important;box-sizing:border-box !important;display:flex !important;}
html.zhx-enhanced [class*="App-main"]{max-width:none !important;width:auto !important;flex:1 1 auto !important;min-width:0 !important;}
/* 回放视频区: 容器 16:9 随主体宽度自适应; 视频填满容器(原生 width:100%/height:100%) */
html.zhx-enhanced [class*="VideoPlayer-content"]{width:100% !important;height:auto !important;aspect-ratio:16/9 !important;flex:0 0 auto !important;min-width:0 !important;}
html.zhx-enhanced [class*="VideoPlayer-video"]{width:100% !important;height:100% !important;object-fit:contain !important;}
/* 回放右侧栏(App-aside: 课程目录/学习笔记): 保持原生宽与 Tab 轮播裁剪, 仅加左外边距与视频区留白 */
html.zhx-enhanced [class*="App-aside"]{flex:0 0 auto !important;margin-left:10px !important;}
/* ===== 公开课布局: TopNavBar + PcContent 前缀(独立 CSS 包, 与直播/回放不同) ===== */
/* 顶栏内容撑满, 去除限宽(max-width:1156px), 左右 50px 留白 */
html.zhx-enhanced [class*="TopNavBar-content"]{
  max-width:none !important;width:auto !important;margin:0 !important;
  padding:0 50px !important;box-sizing:border-box !important;
}
/* 主体: 去除原生 155px 大 padding 与 justify-center, 改为左右 50px 留白, flex 撑满;
   顶部 padding 52px 让出固定顶栏(52px 高) */
html.zhx-enhanced [class*="PcContent-content"]{max-width:none !important;width:100% !important;padding:52px 50px 0 !important;box-sizing:border-box !important;display:flex !important;justify-content:flex-start !important;align-items:flex-start !important;}
/* 左列: 吃满剩余宽度 */
html.zhx-enhanced [class*="PcContent-leftContainer"]{width:auto !important;flex:1 1 auto !important;min-width:0 !important;}
html.zhx-enhanced [class*="PcContent-videoWrapper"]{width:100% !important;height:auto !important;}
/* 视频容器: 16:9 随左列宽度自适应 */
html.zhx-enhanced [class*="VideoPlayer-videoPlayerContainer"]{width:100% !important;height:auto !important;aspect-ratio:16/9 !important;}
/* 视频元素: CSS Modules 短哈希类名(如 _1k7bcr7)每次构建变化, 用容器内 video 兜底 */
html.zhx-enhanced [class*="PcContent-content"] video{width:100% !important;height:100% !important;object-fit:contain !important;}
/* 右列(课程目录): 保持原生 300px, 仅加左外边距 */
html.zhx-enhanced [class*="PcContent-rightContainer"]{flex:0 0 auto !important;margin-left:10px !important;}
`;

  let styleEl = null;
  function ensureStyle() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.id = 'zhx-live-style';
    styleEl.textContent = CSS;
    document.documentElement.appendChild(styleEl);
  }

  // ================= 播放器尺寸兜底 =================
  // CC 播放器 SDK 会向 #livePlayer 子树写入内联像素宽高; 清掉后派发 resize 让其按容器自适应。
  function clearPlayerInlineSizes() {
    if (isTheater()) return; // 全屏时暂停尺寸纠正, 避免与 SDK 全屏渲染打架
    const lp = document.getElementById('livePlayer');
    if (!lp) return;
    // 看门狗高频调用, 先用 querySelector 粗筛: 无 px 内联样式则跳过整棵子树遍历
    if (!lp.style.width.endsWith('px') && !lp.style.height.endsWith('px')
        && !lp.querySelector('[style*="px"]')) return;
    if (lp.style.width.endsWith('px')) lp.style.width = '';
    if (lp.style.height.endsWith('px')) lp.style.height = '';
    for (const el of lp.querySelectorAll('[style*="px"]')) {
      if (el.style.width.endsWith('px')) el.style.width = '';
      if (el.style.height.endsWith('px')) el.style.height = '';
    }
  }

  let refitTimer = 0;
  function refitPlayer() { clearPlayerInlineSizes(); window.dispatchEvent(new Event('resize')); }
  function scheduleRefit() { clearTimeout(refitTimer); refitTimer = setTimeout(refitPlayer, 60); }

  function setupWatchdog() {
    setInterval(() => {
      if (state.enabled) clearPlayerInlineSizes();
      applyPersistedVolume(); // 音量/静音回写(SDK 建流后可能重置)
    }, 1500);
    window.addEventListener('resize', scheduleRefit);
    const wrapper = $find('PcLive-liveWrapper');
    if (wrapper && typeof ResizeObserver === 'function') new ResizeObserver(scheduleRefit).observe(wrapper);
  }

  // ================= 状态应用 =================
  function applyChatW() {
    const html = document.documentElement;
    if (state.chatW) html.style.setProperty('--zhx-chat-w', state.chatW + 'px');
    else html.style.removeProperty('--zhx-chat-w');
  }

  function applyChatFs() {
    document.documentElement.style.setProperty('--zhx-chat-fs', state.chatFs + 'px');
  }

  let toastEl = null, toastTimer = 0;

  function applyMode() {
    ensureStyle();
    document.documentElement.classList.toggle('zhx-enhanced', state.enabled);
    scheduleRefit();
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('zhx-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('zhx-show'), 1400);
  }

  // ================= 交互动作 =================
  function toggleEnhanced() {
    state.enabled = !state.enabled;
    store.set(K.enabled, state.enabled);
    applyMode();
    toast(state.enabled ? '布局增强 已开启' : '布局增强 已关闭');
    console.log(LOG, '增强:', state.enabled);
  }

  function nudgeChatWidth(delta) {
    const base = state.chatW || Math.min(Math.max(Math.round(window.innerWidth * 0.22), 280), 460);
    state.chatW = Math.min(CHAT_W_MAX, Math.max(CHAT_W_MIN, base + delta));
    store.set(K.chatW, state.chatW);
    applyChatW();
    scheduleRefit();
    toast(`右栏宽度 ${state.chatW}px`);
  }

  function resetChatWidth() {
    state.chatW = null;
    store.set(K.chatW, null);
    applyChatW();
    scheduleRefit();
    toast('右栏宽度 已重置为默认');
  }

  function nudgeChatFs(delta) {
    state.chatFs = Math.min(FS_MAX, Math.max(FS_MIN, state.chatFs + delta));
    store.set(K.chatFs, state.chatFs);
    applyChatFs();
    toast(`聊天字号 ${state.chatFs}px`);
  }

  function resetChatFs() {
    state.chatFs = 14;
    store.set(K.chatFs, 14);
    applyChatFs();
    toast('聊天字号 已重置');
  }

  // ================= 快捷键 =================
  function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const t = e.target;
      const inField = !!(t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable));

      // 全屏输入态: 所有按键(含 F/D/W 等)一律放行作为普通字符输入,
      // 不触发任何快捷键, 避免打字误触全屏/弹幕开关。输入框随控制条显隐(隐藏时自动失焦)。
      if (isTheater() && inField) {
        return;
      }
      if (inField) return;
      switch (e.key) {
        case 'w': case 'W': toggleEnhanced(); break;
        case 'f': case 'F': if (pageType === 'live') toggleTheater(); else return; break;
        case 'd': case 'D': if (pageType === 'live') toggleDanmaku(); else return; break;
        case '.': if (pageType === 'live') nudgeDmArea(+1); else return; break;
        case ',': if (pageType === 'live') nudgeDmArea(-1); else return; break;
        case '=': if (pageType === 'live') nudgeDmSpeed(-DM_DURATION_STEP); else return; break;
        case '-': if (pageType === 'live') nudgeDmSpeed(+DM_DURATION_STEP); else return; break;
        case ']': if (pageType === 'live') nudgeChatWidth(+CHAT_W_STEP); else return; break;
        case '[': if (pageType === 'live') nudgeChatWidth(-CHAT_W_STEP); else return; break;
        case '0': if (pageType === 'live') resetChatWidth(); else return; break;
        case 'Enter': if (isTheater()) { showToolbar(); focusInput(); e.preventDefault(); } break;
        default: return;
      }
      e.preventDefault();
    });
  }

  // ================= 聊天新消息自动滚底 =================
  function findChatScroller() {
    const box = $find('PcChatBox-root');
    if (!box) return null;
    const rv = box.querySelector('[class*="ReactVirtualized__List"]');
    if (rv && rv.clientHeight > 0) return rv;
    const mock = box.querySelector('[data-zhx-mock="chat"]');
    if (mock) return mock;
    for (const el of box.querySelectorAll('div')) { // 兜底: 实际可滚动的元素
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el;
    }
    return null;
  }

  function bindChatAutoScroll() {
    let stick = true, scroller = null, userTimer = 0;

    const attach = () => {
      const box = $find('PcChatBox-root');
      if (!box) return false;
      const el = findChatScroller();
      if (!el) return false;
      scroller = el; stick = true;
      // 用户主动向上滚动(看历史): 立即停止贴底, 并在停止操作 1.5s 后才重新判断是否已回到底部。
      // 不能仅靠 scroll 几何判断贴底: ReactVirtualized 虚拟列表只渲染可见行, scrollHeight 远小于
      // 真实内容高, 滚动途中会被误判为"已贴底"而拽回底部, 导致看不了历史。
      // wheel/touchmove 带方向信号, 只在向上时标记; 向下滚到底部时恢复跟随。
      const markUserScrollUp = () => {
        stick = false;
        clearTimeout(userTimer);
        userTimer = setTimeout(() => {
          if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4) {
            stick = true; // 静止后确认在底部才恢复跟随
          }
        }, 1500);
      };
      el.addEventListener('wheel', (e) => { if (e.deltaY < 0) markUserScrollUp(); }, { passive: true });
      let lastTouchY = null;
      el.addEventListener('touchmove', (e) => {
        const t = e.touches[0]; if (t && lastTouchY !== null && t.clientY > lastTouchY) markUserScrollUp();
        lastTouchY = t ? t.clientY : null;
      }, { passive: true });
      // 程序触发的滚底(下方 observer)也会触发 scroll, 不能据此判断方向;
      // 这里仅在确实贴底时恢复跟随, 避免用户向上滚时被拽回
      el.addEventListener('scroll', () => {
        if (!scroller) return;
        if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4) {
          clearTimeout(userTimer); stick = true;
        }
      }, { passive: true });
      new MutationObserver(() => { // 新消息(含虚拟列表行变化)时若贴底则保持贴底, 并推送弹幕
        if (stick && scroller && scroller.scrollHeight > scroller.clientHeight) {
          scroller.scrollTop = scroller.scrollHeight;
        }
        extractNewMessages(box);
      }).observe(box, { childList: true, subtree: true, characterData: true });
      console.log(LOG, '聊天自动滚底已绑定');
      return true;
    };

    if (!attach()) { // 列表可能晚于脚本挂载(ReactVirtualized 初始化/本地 mock)
      const mo = new MutationObserver(() => { if (attach()) mo.disconnect(); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => mo.disconnect(), 30000);
    }
  }

  // ================= 弹幕层 =================
  let dmEl = null;
  const trackReadyAt = []; // 每轨道下次可用时间戳
  const dmSeen = new Set(); // 已推过弹幕的消息内容(name|text), 按 text 去重避免虚拟列表重建节点导致重复

  // 把聊天盒当前已有的消息内容存入基线集合, 进入全屏时调用,
  // 这样全屏前的历史消息不会进入弹幕, 只推全屏后的新发言
  function markExistingMessages() {
    const box = $find('PcChatBox-root');
    if (!box) return;
    const items = box.querySelectorAll('[class*="Message-root"]');
    if (items.length) {
      items.forEach(el => {
        const key = msgKey(el);
        if (key) dmSeen.add(key);
      });
    } else {
      box.querySelectorAll('[class*="Message-content"], [data-zhx-mock="chat"] > div').forEach(el => {
        const t = el.textContent.trim();
        if (t) dmSeen.add('|' + t);
      });
    }
  }

  // 提取消息节点的去重 key(name|text), 空内容返回空串
  function msgKey(el) {
    const nameEl = el.querySelector('[class*="Message-name"]');
    const bodyEl = el.querySelector('[class*="Message-messageWrapper"]');
    const name = nameEl ? nameEl.textContent.trim() : '';
    const text = bodyEl ? bodyEl.textContent.trim()
                        : (el.querySelector('[class*="Message-content"]')?.textContent.trim() || '');
    return text ? name + '|' + text : '';
  }

  function setupDanmaku() {
    dmEl = document.createElement('div');
    dmEl.id = 'zhx-danmaku';
    document.body.appendChild(dmEl);
  }

  function clearDanmaku() {
    if (!dmEl) return;
    for (const el of dmEl.querySelectorAll('.zhx-dm-track')) el.remove();
    trackReadyAt.length = 0;
  }

  function pushDanmaku(name, text) {
    if (!state.danmaku || !isTheater() || !dmEl) return;
    if (dmEl.childElementCount >= DM_MAX) return; // 在屏上限
    const now = performance.now();
    const tracks = Math.max(1, Math.floor(dmEl.clientHeight / DM_TRACK_H));
    for (let i = 0; i < tracks; i++) {
      if (trackReadyAt[i] === undefined || trackReadyAt[i] <= now) {
        trackReadyAt[i] = now + (state.dmSpeed * 1000) * 0.6; // 估算出屏过半可接新条
        const item = document.createElement('div');
        item.className = 'zhx-dm-track';
        item.style.top = (i * DM_TRACK_H) + 'px';
        // 每条速度加 ±2s 抖动避免首尾完全对齐
        const dur = Math.max(DM_DURATION_MIN, state.dmSpeed + (Math.random() * 4 - 2));
        item.style.animationDuration = dur + 's';
        item.textContent = name ? `${name.replace(/[:：]\s*$/, '')}: ${text}` : text;
        item.addEventListener('animationend', () => item.remove());
        dmEl.appendChild(item);
        return;
      }
    }
    // 所有轨道都在滚, 这条丢弃(不排队, 保持实时感)
  }

  // 从聊天盒抓取新消息喂给弹幕(复用自动滚底的 observer)
  function extractNewMessages(box) {
    const items = box.querySelectorAll('[class*="Message-root"]');
    if (items.length) {
      for (const el of items) {
        const key = msgKey(el);
        if (!key || dmSeen.has(key)) continue;
        dmSeen.add(key);
        const nameEl = el.querySelector('[class*="Message-name"]');
        const bodyEl = el.querySelector('[class*="Message-messageWrapper"]');
        const name = nameEl ? nameEl.textContent.trim() : '';
        const text = bodyEl ? bodyEl.textContent.trim()
                            : (el.querySelector('[class*="Message-content"]')?.textContent.trim() || '');
        if (text) pushDanmaku(name, text);
      }
    } else { // 兜底: mock 或无 Message-root 结构, 读直接子项纯文本
      for (const el of box.querySelectorAll('[class*="Message-content"], [data-zhx-mock="chat"] > div')) {
        const t = el.textContent.trim();
        if (!t || dmSeen.has('|' + t)) continue;
        dmSeen.add('|' + t);
        pushDanmaku('', t);
      }
    }
  }

  // ================= 真全屏 =================
  let inputOriginalParent = null;
  let inputOriginalNext = null;
  let sendOriginalSlots = []; // [元素, 原父级, 原后继]: 全屏时抽到 #zhx-send-host 的按钮/字数统计

  function toggleTheater() {
    const el = $find('PcLive-liveWrapper');
    if (!el) return;
    if (!document.fullscreenElement) {
      const p = el.requestFullscreen ? el.requestFullscreen() : null;
      if (p && p.then) p.then(onEnterTheater).catch(() => toast('浏览器拒绝全屏'));
      else if (!p) toast('浏览器不支持全屏');
    } else {
      const p = document.exitFullscreen ? document.exitFullscreen() : null;
      if (!p) onExitTheater(); // 兜底: 无 exitFullscreen 时手动收尾
    }
  }

  function onEnterTheater() {
    document.documentElement.classList.add('zhx-theater');
    // 进入全屏前, 把聊天区已有消息预标记为已见, 弹幕只推送全屏后的新发言
    markExistingMessages();
    // 把原输入框搬进控制条的输入槽(条形输入框: 最多 80 字, 回车发送)
    const input = $find('PcInputBox-root');
    const slot = document.getElementById('zhx-input-slot');
    if (input && slot) {
      inputOriginalParent = input.parentElement;
      inputOriginalNext = input.nextSibling;
      slot.insertBefore(input, slot.firstChild); // root 在前, 发送按钮 host 在后
      const ta = input.querySelector('textarea');
      if (ta) ta.maxLength = 80;
      // 发送按钮抽到槽外自建 host(与输入槽拼接); 字数统计移入输入槽尾部(灰底内嵌);
      // 记录原后继节点, 退出时 insertBefore 精确还原 DOM 顺序
      const host = document.getElementById('zhx-send-host');
      const sendBtn = input.querySelector('[class*="PcInputBox-sendButton"]');
      const textCount = input.querySelector('[class*="PcInputBox-textCount"]');
      if (host && sendBtn) {
        sendOriginalSlots = [];
        if (textCount) {
          sendOriginalSlots.push([textCount, textCount.parentElement, textCount.nextSibling]);
          slot.appendChild(textCount);
        }
        sendOriginalSlots.push([sendBtn, sendBtn.parentElement, sendBtn.nextSibling]);
        host.appendChild(sendBtn);
      }
    }
    // 弹幕层/控制条默认挂在 body, 但全屏元素(PcLive-liveWrapper)处于 top layer 时
    // 会遮挡其外部(body 上)的 fixed 元素, 导致浮层不可见。进入全屏时搬进全屏元素,
    // fixed 定位即以全屏元素为参照铺满画面; 退出时搬回 body。
    const fsEl = $find('PcLive-liveWrapper');
    const dm = document.getElementById('zhx-danmaku');
    const tb = document.getElementById('zhx-toolbar');
    if (fsEl && dm && dm.parentElement !== fsEl) fsEl.appendChild(dm);
    if (fsEl && tb && tb.parentElement !== fsEl) fsEl.appendChild(tb);
    scheduleRefit();
    toast('真全屏 · 移动鼠标显示控制条 · Enter 聚焦发言');
    // 原生退出兜底: ESC/F11/标签失焦时浏览器自动退出, 由 fullscreenchange 收尾
    document.addEventListener('fullscreenchange', onFsChange);
  }

  function onExitTheater() {
    document.documentElement.classList.remove('zhx-theater');
    // 控制条立即隐藏并停掉自动隐藏计时
    clearTimeout(tbTimer);
    hideToolbar();
    // 把输入框移回原父级(还原字数限制、按钮/字数统计按原 DOM 位置精确回插)
    const input = $find('PcInputBox-root');
    if (input) {
      const ta = input.querySelector('textarea');
      // maxLength 的 -1 只读默认值, setter 只接受非负数, 移除限制须用 removeAttribute
      if (ta) { ta.removeAttribute('maxlength'); ta.style.height = ''; }
      for (const [el, parent, next] of sendOriginalSlots) {
        if (next && next.parentElement === parent) parent.insertBefore(el, next);
        else parent.appendChild(el);
      }
      sendOriginalSlots = [];
      if (inputOriginalParent) {
        if (inputOriginalNext && inputOriginalNext.parentElement === inputOriginalParent)
          inputOriginalParent.insertBefore(input, inputOriginalNext);
        else inputOriginalParent.appendChild(input);
      }
    }
    inputOriginalParent = null;
    inputOriginalNext = null;
    // 弹幕层/控制条搬回 body(恢复非全屏态的默认挂载位置)
    const dm = document.getElementById('zhx-danmaku');
    const tb = document.getElementById('zhx-toolbar');
    if (dm && dm.parentElement !== document.body) document.body.appendChild(dm);
    if (tb && tb.parentElement !== document.body) document.body.appendChild(tb);
    clearDanmaku();
    scheduleRefit();
  }

  function onFsChange() {
    if (!document.fullscreenElement) {
      onExitTheater();
      document.removeEventListener('fullscreenchange', onFsChange);
    }
  }

  // 聚焦控制条内嵌的原生输入框(Enter 快捷键用)。
  // 注意不能用 $find('PcInputBox-textarea'): 子串匹配会先命中外层的 textareaWrapper div
  function focusInput() {
    const ta = document.querySelector('#zhx-input-slot textarea')
            || document.querySelector('[class*="PcLive-liveWrapper"] textarea')
            || document.querySelector('textarea');
    if (ta) setTimeout(() => ta.focus(), 0);
  }

  // ================= 全屏浮动控制条 =================
  let tbEl = null, tbTimer = 0, tbHovered = false;

  // CC 播放器 SDK 运行时才在 #livePlayer 内创建 video, 需惰性查找
  function getVideos() {
    return document.querySelectorAll('#livePlayer video');
  }

  function setVolume(v) {
    v = Math.min(100, Math.max(0, Math.round(v)));
    const vids = getVideos();
    if (!vids.length) toast('未找到视频元素, 已记住设置, 视频出现后自动应用');
    for (const vid of vids) {
      vid.volume = v / 100;
      if (v > 0 && vid.muted) vid.muted = false; // 有音量拖动即解除静音
    }
    state.volume = v;
    store.set(K.volume, v);
    syncToolbar();
  }

  function toggleMute() {
    const vids = getVideos();
    if (!vids.length) toast('未找到视频元素, 已记住设置, 视频出现后自动应用');
    const muted = vids.length ? !vids[0].muted : !state.muted;
    for (const vid of vids) vid.muted = muted;
    state.muted = muted;
    store.set(K.muted, muted);
    syncToolbar();
  }

  // 看门狗低频回写: 把持久化的音量/静音同步到视频(防 SDK 建流/重连后重置), 模式同尺寸看门狗;
  // state.volume 为 null(用户从未调过)时不干预 SDK 默认值
  function applyPersistedVolume() {
    if (state.volume === null) return;
    const vids = getVideos();
    for (const vid of vids) {
      if (Math.round(vid.volume * 100) !== state.volume) vid.volume = state.volume / 100;
      if (vid.muted !== state.muted) vid.muted = state.muted;
    }
  }

  // 刷新控制条控件显示; 有视频时以视频实际值为准(SDK 可能改音量), 否则读 state
  function syncToolbar() {
    if (!tbEl) return;
    const vids = getVideos();
    const vol = vids.length ? Math.round(vids[0].volume * 100)
                            : (state.volume === null ? 100 : state.volume);
    const muted = vids.length ? vids[0].muted : state.muted;
    const volInput = tbEl.querySelector('#zhx-tb-vol');
    if (document.activeElement !== volInput) volInput.value = vol; // 拖动中不回写滑条
    tbEl.querySelector('#zhx-tb-vol-num').textContent = vol;
    tbEl.querySelector('#zhx-tb-mute').textContent = muted ? '🔇' : '🔊';
    const dmBtn = tbEl.querySelector('#zhx-tb-dm');
    dmBtn.textContent = state.danmaku ? '弹幕 开' : '弹幕 关';
    dmBtn.classList.toggle('zhx-off', !state.danmaku);
    // 弹幕设置窗: 线段档位选中态(区域 4 档 / 速度 6~16s 步进 2 / 颜色 6 档)
    const areaSeg = tbEl.querySelector('#zhx-dm-seg-area');
    if (areaSeg) for (const item of areaSeg.children)
      item.classList.toggle('zhx-on', +item.dataset.idx === state.dmArea);
    const speedSeg = tbEl.querySelector('#zhx-dm-seg-speed');
    if (speedSeg) for (const item of speedSeg.children)
      item.classList.toggle('zhx-on', DM_DURATION_MIN + +item.dataset.idx * DM_DURATION_STEP === state.dmSpeed);
    const colorSeg = tbEl.querySelector('#zhx-dm-seg-color');
    if (colorSeg) for (const item of colorSeg.children)
      item.classList.toggle('zhx-on', +item.dataset.idx === state.dmColor);
  }

  function showToolbar() {
    if (!tbEl) return;
    syncToolbar();
    tbEl.classList.add('zhx-show');
    armHide();
  }

  function hideToolbar() {
    if (!tbEl) return;
    tbEl.classList.remove('zhx-show');
    closeDmPopover();
    tbHovered = false; // 隐藏后悬停标志复位, 重新唤起需再次移入
    // 隐藏时释放输入框焦点, 快捷键恢复正常(否则按键仍会打进不可见的输入框)
    const ta = tbEl.querySelector('textarea');
    if (ta) ta.blur();
  }

  // 3 秒无操作隐藏; 鼠标停在工具条上/正在输入框打字/弹幕设置窗开着则续期等待。
  // 悬停判定优先用 mouseenter/mouseleave 维护的事件标志:
  // 浏览器的 :hover 伪类状态可能被渲染管线重置, 定时器里轮询 matches(':hover') 不可靠
  function armHide() {
    clearTimeout(tbTimer);
    tbTimer = setTimeout(() => {
      const active = document.activeElement;
      const typing = !!(tbEl && active && tbEl.contains(active)
                       && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT'));
      const popOpen = !!(tbEl && tbEl.querySelector('#zhx-dm-popover.zhx-open'));
      if (tbEl && (tbHovered || typing || popOpen || tbEl.matches(':hover'))) { armHide(); return; }
      hideToolbar();
    }, 3000);
  }

  function closeDmPopover() {
    const pop = document.getElementById('zhx-dm-popover');
    if (pop) pop.classList.remove('zhx-open');
  }

  function setupToolbar() {
    tbEl = document.createElement('div');
    tbEl.id = 'zhx-toolbar';

    const mkBtn = (id, text, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = id; b.className = 'zhx-tb-btn'; b.textContent = text; b.title = title;
      return b;
    };
    const mkSep = () => {
      const s = document.createElement('span');
      s.className = 'zhx-tb-sep';
      return s;
    };

    // 聊天输入槽: 灰底只覆盖到字数统计(输入区), 发送按钮在槽外紧挨右侧拼接
    const inputSlot = document.createElement('div');
    inputSlot.id = 'zhx-input-slot';
    inputSlot.title = 'Enter 发送';
    // 发送按钮自建容器(与输入槽平级, 真实页按钮容器的定位不受控, 抽出后位置可控)
    const sendHost = document.createElement('div');
    sendHost.id = 'zhx-send-host';

    // 弹幕组: 开关 + 设置(设置窗锚定在本组上方)
    const dmGroup = document.createElement('div');
    dmGroup.className = 'zhx-tb-group';
    const dmBtn = mkBtn('zhx-tb-dm', '弹幕 开', '全屏弹幕 开/关 (D)');
    const dmSetBtn = mkBtn('zhx-tb-dmset', '⚙', '弹幕设置');
    dmGroup.append(dmBtn, dmSetBtn, buildDmPopover());

    // 音量组: 静音键 + 滑条 + 数值
    const muteBtn = mkBtn('zhx-tb-mute', '🔊', '静音 / 取消静音');
    const volInput = document.createElement('input');
    volInput.type = 'range'; volInput.id = 'zhx-tb-vol';
    volInput.min = 0; volInput.max = 100; volInput.step = 1;
    volInput.title = '音量 0-100';
    const volNum = document.createElement('span');
    volNum.id = 'zhx-tb-vol-num';

    tbEl.append(inputSlot, sendHost, mkSep(), dmGroup, mkSep(), muteBtn, volInput, volNum);
    document.body.appendChild(tbEl);

    // 悬停标志: 进入置位/离开复位, 供 armHide 判断保活
    tbEl.addEventListener('mouseenter', () => { tbHovered = true; });
    tbEl.addEventListener('mouseleave', () => { tbHovered = false; });

    muteBtn.addEventListener('click', toggleMute);
    volInput.addEventListener('input', () => setVolume(+volInput.value));
    dmBtn.addEventListener('click', toggleDanmaku);
    dmSetBtn.addEventListener('click', () => {
      const pop = document.getElementById('zhx-dm-popover');
      if (!pop) return;
      pop.classList.toggle('zhx-open');
      armHide(); // 开关设置窗算一次操作
    });

    // 点击设置窗之外的区域关闭它(冒泡到 document 的 mousedown 同时给工具条续期)
    document.addEventListener('mousedown', (e) => {
      const pop = document.getElementById('zhx-dm-popover');
      if (!pop || !pop.classList.contains('zhx-open')) return;
      if (pop.contains(e.target)) return;
      const setBtn = document.getElementById('zhx-tb-dmset');
      if (setBtn && setBtn.contains(e.target)) return;
      closeDmPopover();
    });

    // 条形输入框回车语义: 回车发送 / 空内容回车取消输入态。
    // capture 在默认换行行为与其他处理器之前拦截; 输入法组合中的回车(选词确认)放行。
    // 同时 stopPropagation: 原生 React 在根容器(bubble 阶段)也监听 keydown,
    // 仅 preventDefault 无法阻止其收到 Enter 并触发发送。
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const ta = e.target;
      if (!ta || ta.tagName !== 'TEXTAREA') return;
      const slot = document.getElementById('zhx-input-slot');
      if (!slot || !slot.contains(ta)) return;
      e.preventDefault();
      e.stopPropagation();
      if (ta.value.trim().length > 0) sendChat();
      else ta.blur(); // 空内容回车: 退出输入状态
    }, true);

    // 全屏态下鼠标活动唤起工具条(工具条内点击冒泡到 document 同样计时); 平时保持隐藏
    const onActivity = () => {
      if (!isTheater() || !tbEl) return;
      if (!tbEl.classList.contains('zhx-show')) showToolbar();
      else armHide();
    };
    document.addEventListener('mousemove', onActivity, { passive: true });
    document.addEventListener('mousedown', onActivity);
  }

  // 弹幕设置悬浮窗: 三行线段档位(区域 4 档 / 速度 6 档 / 颜色 6 档), 仅可点选给定档位
  function buildDmPopover() {
    const pop = document.createElement('div');
    pop.id = 'zhx-dm-popover';

    const mkRow = (labelText, segId, options, onPick) => {
      const row = document.createElement('div');
      row.className = 'zhx-dm-row';
      const label = document.createElement('span');
      label.className = 'zhx-dm-row-label';
      label.textContent = labelText;
      const seg = document.createElement('div');
      seg.className = 'zhx-dm-seg';
      seg.id = segId;
      options.forEach((text, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'zhx-dm-seg-item';
        item.dataset.idx = i;
        const bar = document.createElement('i');
        const txt = document.createElement('em');
        txt.textContent = text;
        item.append(bar, txt);
        item.addEventListener('click', () => onPick(i));
        seg.appendChild(item);
      });
      row.append(label, seg);
      return row;
    };

    pop.append(
      mkRow('弹幕区域:', 'zhx-dm-seg-area', DM_AREA_TEXTS, (i) => setDmAreaIdx(i)),
      mkRow('弹幕速度:', 'zhx-dm-seg-speed',
            Array.from({ length: (DM_DURATION_MAX - DM_DURATION_MIN) / DM_DURATION_STEP + 1 },
                       (_, i) => (DM_DURATION_MIN + i * DM_DURATION_STEP) + 's'),
            (i) => setDmSpeedIdx(i)),
      mkRow('弹幕颜色:', 'zhx-dm-seg-color', DM_COLOR_TEXTS, (i) => setDmColorIdx(i))
    );
    return pop;
  }

  // 发送: 点击原生发送按钮(React 逻辑清空内容), 输入框恒为单行高度无需回落
  function sendChat() {
    const ta = document.querySelector('#zhx-input-slot textarea');
    if (!ta || ta.value.trim().length === 0) return;
    const btn = document.querySelector('#zhx-send-host [class*="PcInputBox-sendButton"], #zhx-input-slot [class*="PcInputBox-sendButton"]');
    if (btn) btn.click();
  }

  // ================= 弹幕参数 =================
  function applyDmArea() {
    document.documentElement.style.setProperty('--zhx-dm-area', DM_AREA_LEVELS[state.dmArea]);
  }
  // 弹幕颜色: html 挂 zhx-dmc-* 类切换, CSS 定义各色描边/晕影, 在屏弹幕即时跟随
  function applyDmColor() {
    const html = document.documentElement;
    for (const c of DM_COLOR_CLASSES) html.classList.remove(c);
    html.classList.add(DM_COLOR_CLASSES[state.dmColor]);
  }
  // 设置窗点选: 直接设到指定档位(索引), 与快捷键步进共用 state/持久化/toast
  function setDmAreaIdx(i) {
    i = Math.min(DM_AREA_LEVELS.length - 1, Math.max(0, i));
    if (i === state.dmArea) return;
    state.dmArea = i;
    store.set(K.dmArea, state.dmArea);
    applyDmArea();
    syncToolbar();
    toast(`弹幕显示区域: ${DM_AREA_TEXTS[state.dmArea]} (${DM_AREA_LEVELS[state.dmArea]})`);
  }
  function setDmSpeedIdx(i) {
    const v = DM_DURATION_MIN + i * DM_DURATION_STEP;
    if (v === state.dmSpeed || v < DM_DURATION_MIN || v > DM_DURATION_MAX) return;
    state.dmSpeed = v;
    store.set(K.dmSpeed, state.dmSpeed);
    syncToolbar();
    toast(`弹幕速度: ${state.dmSpeed <= 8 ? '快' : state.dmSpeed <= 14 ? '中' : '慢'} (${state.dmSpeed}s)`);
  }
  function nudgeDmArea(d) {
    state.dmArea = Math.min(3, Math.max(0, state.dmArea + d));
    store.set(K.dmArea, state.dmArea);
    applyDmArea();
    syncToolbar();
    toast(`弹幕显示区域: ${DM_AREA_TEXTS[state.dmArea]} (${DM_AREA_LEVELS[state.dmArea]})`);
  }
  function nudgeDmSpeed(d) {
    state.dmSpeed = Math.min(DM_DURATION_MAX, Math.max(DM_DURATION_MIN, state.dmSpeed + d));
    store.set(K.dmSpeed, state.dmSpeed);
    syncToolbar();
    toast(`弹幕速度: ${state.dmSpeed <= 8 ? '快' : state.dmSpeed <= 14 ? '中' : '慢'} (${state.dmSpeed}s)`);
  }
  function toggleDanmaku() {
    state.danmaku = !state.danmaku;
    store.set(K.danmaku, state.danmaku);
    if (!state.danmaku) clearDanmaku();
    syncToolbar();
    toast('全屏弹幕 ' + (state.danmaku ? '开' : '关') + (isTheater() ? '' : '(下次全屏生效)'));
  }
  // 弹幕颜色: 白/黑/蓝/绿/红/黄 六档, 默认白; setter 与快捷键同款 clamp, 切换即时作用于在屏弹幕
  function setDmColorIdx(i) {
    i = Math.min(DM_COLOR_TEXTS.length - 1, Math.max(0, i));
    if (i === state.dmColor) return;
    state.dmColor = i;
    store.set(K.dmColor, i);
    applyDmColor();
    syncToolbar();
    toast('弹幕颜色: ' + DM_COLOR_TEXTS[i]);
  }

  // ================= 提示 / 油猴菜单 =================
  function setupToast() {
    toastEl = document.createElement('div');
    toastEl.id = 'zhx-toast';
    document.body.appendChild(toastEl);
  }

  function setupMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('切换布局增强 (快捷键 W)', toggleEnhanced);
    if (pageType === 'replay') return; // 回放页: 仅布局开关; 右栏宽度/全屏/弹幕/字号均为直播页专用
    GM_registerMenuCommand('右栏变宽 ( ] )', () => nudgeChatWidth(+CHAT_W_STEP));
    GM_registerMenuCommand('右栏变窄 ( [ )', () => nudgeChatWidth(-CHAT_W_STEP));
    GM_registerMenuCommand('右栏宽度重置 (0)', resetChatWidth);
    GM_registerMenuCommand('聊天字号增大', () => nudgeChatFs(+1));
    GM_registerMenuCommand('聊天字号减小', () => nudgeChatFs(-1));
    GM_registerMenuCommand('聊天字号重置', resetChatFs);
    GM_registerMenuCommand('进入/退出真全屏 (快捷键 F)', toggleTheater);
    GM_registerMenuCommand('全屏弹幕 开/关 (快捷键 D)', toggleDanmaku);
    GM_registerMenuCommand('弹幕显示区域 增大 (.)', () => nudgeDmArea(+1));
    GM_registerMenuCommand('弹幕显示区域 减小 (,)', () => nudgeDmArea(-1));
    GM_registerMenuCommand('弹幕滚动速度 加快 (=)', () => nudgeDmSpeed(-DM_DURATION_STEP));
    GM_registerMenuCommand('弹幕滚动速度 减慢 (-)', () => nudgeDmSpeed(+DM_DURATION_STEP));
    GM_registerMenuCommand('弹幕颜色 轮换 (白/黑/蓝/绿/红/黄)',
                           () => setDmColorIdx((state.dmColor + 1) % DM_COLOR_TEXTS.length));
  }

  // ================= 启动 =================
  function init() {
    console.log(LOG, '检测到直播间, 初始化');
    ensureStyle();
    setupToast();
    applyChatFs();
    applyChatW();
    applyDmArea();
    applyDmColor();
    applyMode();
    setupShortcuts();
    setupWatchdog();
    bindChatAutoScroll();
    setupDanmaku();
    setupToolbar();
    setupMenu();
  }

  // 回放页初始化: 仅布局增强 + W 开关, 无全屏/弹幕/聊天/右栏调宽
  function initReplay() {
    console.log(LOG, '检测到回放页, 初始化回放布局');
    ensureStyle();
    setupToast();
    applyMode();
    setupShortcuts();
    setupMenu();
  }

  // 公开课初始化: 仅布局增强 + W 开关, 无全屏/弹幕/聊天
  function initPublic() {
    console.log(LOG, '检测到公开课, 初始化公开课布局');
    ensureStyle();
    setupToast();
    applyMode();
    setupShortcuts();
    setupMenu();
  }

  function boot() {
    if ($find('PcLive-liveWrapper')) { pageType = 'live'; init(); return true; }
    if ($find('App-content') || $find('VideoPlayer-content')) { pageType = 'replay'; initReplay(); return true; }
    if ($find('PcContent-content') && $find('VideoPlayer-videoPlayerContainer')) { pageType = 'public'; initPublic(); return true; }
    return false;
  }

  if (!boot()) {
    const mo = new MutationObserver(() => { if (boot()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 30000); // 30s 内没出现直播容器则静默退出
  }
})();
