// ==UserScript==
// @name        知乎知学堂直播布局助手
// @namespace   https://github.com/zsyo/zhihu-live-helper
// @version     1.2.0
// @description 重排知乎知学堂直播页：视频区随窗口自适应并占据主体（16:9），右侧聊天互动区约 1/5~1/4 宽；支持键盘快捷键、聊天新消息自动滚底与字号调节；支持真全屏（F 键）、全屏弹幕（可调显示区域/速度）与回车快捷发送互动消息。
// @author      zephyr
// @match       https://www.zhihu.com/xen/training/live/*
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
              danmaku: 'zhx_danmaku', dmArea: 'zhx_dm_area', dmSpeed: 'zhx_dm_speed' };
  const DEFAULT_CHAT_W = 'clamp(280px, 22vw, 460px)'; // ≈ 1/5 ~ 1/4 视口宽
  const CHAT_W_MIN = 240, CHAT_W_MAX = 480, CHAT_W_STEP = 20;
  const FS_MIN = 12, FS_MAX = 20;
  // 弹幕配置: 显示区域 4 档(层高占视口比), 轨道高, 滚完秒数(越小越快), 在屏上限
  const DM_AREA_LEVELS = ['12.5vh', '16.5vh', '20vh', '25vh']; // 1/8 → ~1/6 → 1/5 → 1/4
  const DM_TRACK_H = 36;
  const DM_DURATION_MIN = 6, DM_DURATION_MAX = 20, DM_DURATION_STEP = 2;
  const DM_MAX = 60;

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
    dmArea: store.get(K.dmArea, 2),       // 0-3, 默认档3(1/5 屏)
    dmSpeed: store.get(K.dmSpeed, 12),     // 单条弹幕滚完秒数, 越小越快
  };

  const $find = (prefix, root) => (root || document).querySelector(`[class*="${prefix}"]`);

  // 是否处于真全屏态: 浏览器全屏元素存在 且 标记类已挂上
  function isTheater() {
    return !!document.fullscreenElement && document.documentElement.classList.contains('zhx-theater');
  }

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
/* 全屏: 视频列吃满, 右栏聊天盒隐藏(弹幕替代它), 仅留底部输入浮层 */
html.zhx-theater [class*="PcLive-player"]{width:100% !important;flex:1 1 auto !important;min-width:0 !important;}
html.zhx-theater [class*="PcLive-rightWrapper"]{width:0 !important;flex:0 0 0 !important;overflow:visible !important;margin:0 !important;}
html.zhx-theater [class*="PcLive-chatBox"]{display:none !important;}
html.zhx-theater [class*="PcPlayer-playerWrapper"]{height:100% !important;width:100% !important;aspect-ratio:auto !important;}
/* ===== 弹幕轨道层: 高度由 --zhx-dm-area 决定(可调档) ===== */
#zhx-danmaku{
  position:fixed;top:0;left:0;width:100%;height:var(--zhx-dm-area, 20vh);
  z-index:2147483646;pointer-events:none;overflow:hidden;display:none;
}
html.zhx-theater #zhx-danmaku{display:block;}
.zhx-dm-track{
  position:absolute;left:100%;white-space:nowrap;will-change:transform;
  font-size:22px;line-height:36px;color:#fff;
  text-shadow:0 0 3px rgba(0,0,0,.9),0 1px 2px rgba(0,0,0,.8);
  animation:zhx-dm-scroll linear forwards;
}
@keyframes zhx-dm-scroll{from{transform:translateX(0)}to{transform:translateX(calc(-100vw - 100%))}}
/* ===== 全屏底部输入浮层(复用原 PcInputBox) ===== */
#zhx-input-bar{
  position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(150%);
  width:min(640px,90vw);z-index:2147483647;
  display:none;align-items:center;gap:8px;visibility:hidden;pointer-events:none;
  background:rgba(0,0,0,.55);backdrop-filter:blur(6px);border-radius:24px;padding:8px 8px 8px 18px;
  transition:transform .18s ease,visibility 0s linear .18s;
}
/* 仅全屏时启用浮层; 唤起时上移并可见 */
html.zhx-theater #zhx-input-bar{display:flex;}
#zhx-input-slot{flex:1 1 auto;min-width:0;}
#zhx-input-bar.zhx-show{transform:translateX(-50%) translateY(0);visibility:visible;pointer-events:auto;transition:transform .18s ease,visibility 0s;}
html.zhx-theater [class*="PcInputBox-root"]{width:100% !important;}
html.zhx-theater [class*="PcInputBox-textareaWrapper"]{width:100% !important;display:flex !important;align-items:center !important;}
html.zhx-theater [class*="PcInputBox-textarea"]{height:48px !important;background:transparent !important;color:#fff !important;border:none !important;}
html.zhx-theater [class*="PcInputBox-sendBtnWrapper"],
html.zhx-theater [class*="PcInputBox-clickTip"]{display:none !important;} /* 字数计数/提示不需要 */
html.zhx-theater [class*="PcInputBox-sendButton"]{flex:0 0 auto !important;}
#zhx-input-hint{color:rgba(255,255,255,.5);font-size:12px;white-space:nowrap;}
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
      const inField = !!(t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable));

      // 全屏输入态: 仅 ESC 收起 / F 退出全屏; Enter 放行交原生发送; 其余忽略避免打字误触
      if (isTheater() && inField) {
        if (e.key === 'Escape') { hideInputBar(); t.blur(); e.preventDefault(); }
        else if (e.key === 'f' || e.key === 'F') { toggleTheater(); e.preventDefault(); }
        return;
      }
      if (inField) return;
      switch (e.key) {
        case 'w': case 'W': toggleEnhanced(); break;
        case 'f': case 'F': toggleTheater(); break;
        case 'd': case 'D': toggleDanmaku(); break;
        case '.': nudgeDmArea(+1); break;   // 弹幕显示区域增大
        case ',': nudgeDmArea(-1); break;   // 弹幕显示区域减小
        case '=': nudgeDmSpeed(-DM_DURATION_STEP); break; // 加快(减秒)
        case '-': nudgeDmSpeed(+DM_DURATION_STEP); break; // 减慢(加秒)
        case ']': nudgeChatWidth(+CHAT_W_STEP); break;
        case '[': nudgeChatWidth(-CHAT_W_STEP); break;
        case '0': resetChatWidth(); break;
        case 'Enter': if (isTheater()) { showInputBar(); focusInput(); e.preventDefault(); } break;
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
    let stick = true, scroller = null;

    const attach = () => {
      const box = $find('PcChatBox-root');
      if (!box) return false;
      const el = findChatScroller();
      if (!el) return false;
      scroller = el; stick = true;
      el.addEventListener('scroll', () => {
        if (!scroller) return;
        stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
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
  const dmSeen = new WeakSet(); // 已推过弹幕的消息节点

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
        item.textContent = name ? `${name}: ${text}` : text;
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
        if (dmSeen.has(el)) continue;
        dmSeen.add(el);
        const nameEl = el.querySelector('[class*="Message-name"]');
        const bodyEl = el.querySelector('[class*="Message-messageWrapper"]');
        const name = nameEl ? nameEl.textContent.trim() : '';
        const text = bodyEl ? bodyEl.textContent.trim()
                            : (el.querySelector('[class*="Message-content"]')?.textContent.trim() || '');
        if (text) pushDanmaku(name, text);
      }
    } else { // 兜底: mock 或无 Message-root 结构, 读直接子项纯文本
      for (const el of box.querySelectorAll('[class*="Message-content"], [data-zhx-mock="chat"] > div')) {
        if (dmSeen.has(el)) continue;
        dmSeen.add(el);
        pushDanmaku('', el.textContent.trim());
      }
    }
  }

  // ================= 真全屏 =================
  let inputOriginalParent = null;

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
    // 把原输入框搬进底部浮层(复用原生 Enter 发送)
    const input = $find('PcInputBox-root');
    const slot = document.getElementById('zhx-input-slot');
    if (input && slot) {
      inputOriginalParent = input.parentElement;
      slot.appendChild(input);
    }
    scheduleRefit();
    toast('真全屏 · Enter 唤起输入框 · D 弹幕开关');
    // 原生退出兜底: ESC/F11/标签失焦时浏览器自动退出, 由 fullscreenchange 收尾
    document.addEventListener('fullscreenchange', onFsChange);
  }

  function onExitTheater() {
    document.documentElement.classList.remove('zhx-theater');
    // 把输入框移回原父级
    const input = $find('PcInputBox-root');
    if (input && inputOriginalParent) inputOriginalParent.appendChild(input);
    inputOriginalParent = null;
    clearDanmaku();
    hideInputBar();
    scheduleRefit();
  }

  function onFsChange() {
    if (!document.fullscreenElement) {
      onExitTheater();
      document.removeEventListener('fullscreenchange', onFsChange);
    }
  }

  // ================= 全屏底部输入浮层 =================
  function setupInputBar() {
    const bar = document.createElement('div');
    bar.id = 'zhx-input-bar';
    const slot = document.createElement('div'); // 占位: 原 PcInputBox-root 搬入此容器
    slot.id = 'zhx-input-slot';
    const hint = document.createElement('span');
    hint.id = 'zhx-input-hint';
    hint.textContent = 'Enter 发送 · ESC 收起';
    bar.appendChild(slot);
    bar.appendChild(hint);
    document.body.appendChild(bar);
  }

  function showInputBar() {
    const bar = document.getElementById('zhx-input-bar');
    if (bar) bar.classList.add('zhx-show');
  }
  function hideInputBar() {
    const bar = document.getElementById('zhx-input-bar');
    if (bar) bar.classList.remove('zhx-show');
  }
  function focusInput() {
    const ta = $find('PcInputBox-textarea') || document.querySelector('textarea');
    if (ta) setTimeout(() => ta.focus(), 0);
  }

  // ================= 弹幕参数 =================
  function applyDmArea() {
    document.documentElement.style.setProperty('--zhx-dm-area', DM_AREA_LEVELS[state.dmArea]);
  }
  function nudgeDmArea(d) {
    state.dmArea = Math.min(3, Math.max(0, state.dmArea + d));
    store.set(K.dmArea, state.dmArea);
    applyDmArea();
    toast(`弹幕显示区域: 档${state.dmArea + 1} (${DM_AREA_LEVELS[state.dmArea]})`);
  }
  function nudgeDmSpeed(d) {
    state.dmSpeed = Math.min(DM_DURATION_MAX, Math.max(DM_DURATION_MIN, state.dmSpeed + d));
    store.set(K.dmSpeed, state.dmSpeed);
    toast(`弹幕速度: ${state.dmSpeed <= 8 ? '快' : state.dmSpeed <= 14 ? '中' : '慢'} (${state.dmSpeed}s)`);
  }
  function toggleDanmaku() {
    state.danmaku = !state.danmaku;
    store.set(K.danmaku, state.danmaku);
    if (!state.danmaku) clearDanmaku();
    toast('全屏弹幕 ' + (state.danmaku ? '开' : '关') + (isTheater() ? '' : '(下次全屏生效)'));
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
    GM_registerMenuCommand('进入/退出真全屏 (快捷键 F)', toggleTheater);
    GM_registerMenuCommand('全屏弹幕 开/关 (快捷键 D)', toggleDanmaku);
    GM_registerMenuCommand('弹幕显示区域 增大 (.)', () => nudgeDmArea(+1));
    GM_registerMenuCommand('弹幕显示区域 减小 (,)', () => nudgeDmArea(-1));
    GM_registerMenuCommand('弹幕滚动速度 加快 (=)', () => nudgeDmSpeed(-DM_DURATION_STEP));
    GM_registerMenuCommand('弹幕滚动速度 减慢 (-)', () => nudgeDmSpeed(+DM_DURATION_STEP));
  }

  // ================= 启动 =================
  function init() {
    console.log(LOG, '检测到直播间, 初始化');
    ensureStyle();
    setupToast();
    applyChatFs();
    applyChatW();
    applyDmArea();
    applyMode();
    setupShortcuts();
    setupWatchdog();
    bindChatAutoScroll();
    setupDanmaku();
    setupInputBar();
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
