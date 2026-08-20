// ==UserScript==
// @name         知乎知学堂直播布局助手
// @namespace    https://github.com/zsyo/zhihu-live-helper
// @version      1.0.0
// @description  重排知乎知学堂直播页：视频区随窗口自适应并占据主体（16:9），右侧聊天互动区约 1/5~1/4 宽；顶部导航保持原始样式，仅重排下方主体区域。支持键盘快捷键、聊天新消息自动滚底与字号调节。
// @author       zephyr
// @match        https://www.zhihu.com/xen/training/live/*
// @match        file:///*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
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
 * 本脚本只改下方主体区域(PcLive-liveWrapper 及其子树), 顶栏完全保持原始 CSS。
 * 类名带构建哈希后缀, 全部用 [class*="前缀"] 属性选择器; 锚点 ID #livePlayer 不变。
 */

(function () {
  'use strict';

  const LOG = '[知学堂直播助手]';
  const K = { enabled: 'zhx_enabled', chatW: 'zhx_chat_w', chatFs: 'zhx_chat_fs' };
  const DEFAULT_CHAT_W = 'clamp(280px, 22vw, 460px)'; // ≈ 1/5 ~ 1/4 视口宽
  const CHAT_W_MIN = 240, CHAT_W_MAX = 480, CHAT_W_STEP = 20;
  const FS_MIN = 12, FS_MAX = 20;

  // ---- 存储层: 有 GM 用 GM, 无 GM(本地注入测试)退化为 localStorage ----
  const store = {
    get(k, d) {
      try { if (typeof GM_getValue === 'function') return GM_getValue(k, d); } catch (e) { /* ignore */ }
      try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch (e) { /* ignore */ }
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ }
    },
  };

  const state = {
    enabled: store.get(K.enabled, true),
    chatW: store.get(K.chatW, null),   // null = 默认 clamp
    chatFs: store.get(K.chatFs, 14),
  };

  const $find = (prefix, root) => (root || document).querySelector(`[class*="${prefix}"]`);

  // ================= 样式 =================
  // 顶栏: 解除 max-width 限制, 让 logo 和头像分别靠两端; 加 padding 留出合理边距
  // (头像下拉菜单以头像为锚点弹出, 右侧多留边距使菜单相对头像居中不溢出)
  const CSS = `
/* ===== 顶栏: logo 左、头像右, 撑满全宽 ===== */
html.zhx-enhanced [class*="PcContent-root"]{width:100% !important;max-width:none !important;}
html.zhx-enhanced [class*="PcContent-headContentClassName"]{max-width:none !important;}
html.zhx-enhanced [class*="ShelfTopNav-content"]{
  max-width:none !important;margin:0 !important;
  padding:0 24px !important;box-sizing:border-box !important;
}
/* 头像下拉菜单以头像为锚点右对齐弹出, 右侧留边距使菜单不溢出右边缘 */
html.zhx-enhanced [class*="ShelfTopNav-right"]{padding-right:48px !important;}
/* ===== 主体区域: 撑满宽度 ===== */
html.zhx-enhanced [class*="PcLive-liveWrapper"]{
  width:100% !important;justify-content:flex-start !important;
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
/* 右列: 聊天互动区, 可调宽, 高度跟随视频列 */
html.zhx-enhanced [class*="PcLive-rightWrapper"]{
  width:var(--zhx-chat-w, ${DEFAULT_CHAT_W}) !important;
  flex:0 0 var(--zhx-chat-w, ${DEFAULT_CHAT_W}) !important;
  margin-left:10px;
  align-self:stretch;
}
html.zhx-enhanced [class*="PcLive-chatBox"]{height:calc(100vh - 140px) !important;}
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
#zhx-toast{
  position:fixed;right:16px;bottom:16px;z-index:9999;
  padding:6px 14px;border-radius:16px;background:rgba(0,0,0,.72);color:#fff;
  font-size:13px;pointer-events:none;opacity:0;transition:opacity .25s;
}
#zhx-toast.zhx-show{opacity:1;}
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
    const lp = document.getElementById('livePlayer');
    if (!lp) return;
    if (lp.style.width.endsWith('px')) lp.style.width = '';
    if (lp.style.height.endsWith('px')) lp.style.height = '';
    for (const el of lp.querySelectorAll('*')) {
      if (el.style.width.endsWith('px')) el.style.width = '';
      if (el.style.height.endsWith('px')) el.style.height = '';
    }
  }

  let refitTimer = 0;
  function refitPlayer() { clearPlayerInlineSizes(); window.dispatchEvent(new Event('resize')); }
  function scheduleRefit() { clearTimeout(refitTimer); refitTimer = setTimeout(refitPlayer, 60); }

  function setupWatchdog() {
    setInterval(() => { if (state.enabled) clearPlayerInlineSizes(); }, 1500);
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
    toast(`聊天区宽度 ${state.chatW}px`);
  }

  function resetChatWidth() {
    state.chatW = null;
    store.set(K.chatW, null);
    applyChatW();
    scheduleRefit();
    toast('聊天区宽度 已重置为默认');
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
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      switch (e.key) {
        case 'w': case 'W': toggleEnhanced(); break;
        case ']': nudgeChatWidth(+CHAT_W_STEP); break;
        case '[': nudgeChatWidth(-CHAT_W_STEP); break;
        case '0': resetChatWidth(); break;
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
    let bound = false, stick = true, scroller = null;

    const attach = () => {
      const box = $find('PcChatBox-root');
      if (!box) return false;
      const el = findChatScroller();
      if (!el) return false;
      bound = true; scroller = el; stick = true;
      el.addEventListener('scroll', () => {
        if (!scroller) return;
        stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
      }, { passive: true });
      new MutationObserver(() => { // 新消息(含虚拟列表行变化)时若贴底则保持贴底
        if (stick && scroller && scroller.scrollHeight > scroller.clientHeight) {
          scroller.scrollTop = scroller.scrollHeight;
        }
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

  // ================= 提示 / 油猴菜单 =================
  function setupToast() {
    toastEl = document.createElement('div');
    toastEl.id = 'zhx-toast';
    document.body.appendChild(toastEl);
  }

  function setupMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('切换布局增强 (快捷键 W)', toggleEnhanced);
    GM_registerMenuCommand('聊天区变宽 ( ] )', () => nudgeChatWidth(+CHAT_W_STEP));
    GM_registerMenuCommand('聊天区变窄 ( [ )', () => nudgeChatWidth(-CHAT_W_STEP));
    GM_registerMenuCommand('聊天区宽度重置 (0)', resetChatWidth);
    GM_registerMenuCommand('聊天字号增大', () => nudgeChatFs(+1));
    GM_registerMenuCommand('聊天字号减小', () => nudgeChatFs(-1));
    GM_registerMenuCommand('聊天字号重置', resetChatFs);
  }

  // ================= 启动 =================
  function init() {
    console.log(LOG, '检测到直播间, 初始化');
    ensureStyle();
    setupToast();
    applyChatFs();
    applyChatW();
    applyMode();
    setupShortcuts();
    setupWatchdog();
    bindChatAutoScroll();
    setupMenu();
  }

  function boot() {
    if ($find('PcLive-liveWrapper')) { init(); return true; }
    return false;
  }

  if (!boot()) {
    const mo = new MutationObserver(() => { if (boot()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 30000); // 30s 内没出现直播容器则静默退出
  }
})();
