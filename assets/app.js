/* ============================================================
   在线书架 · 逻辑
   纯静态 / 零构建 / 零后端。数据源 = data.json（线上）或内嵌 seed（本地双击）
   编辑结果先存本机草稿，导出或推送到 GitHub 后才对公域生效
   ============================================================ */
(() => {
  'use strict';

  const K_DRAFT = 'onlineshelf:draft:v1';
  const K_PREFS = 'onlineshelf:prefs:v1';
  const K_GH = 'onlineshelf:github:v1';
  const SORTABLE_CDN = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js';
  // 依次回退：Microlink 实时截图 → mshots 缓存图 → thum.io → 域名封面
  const SERVICES = ['microlink', 'mshots', 'thumio'];
  const DENSITY = ['auto', 'compact', 'large', 'xl'];
  const DENSITY_LABEL = { auto: '自动', compact: '紧凑', large: '大图', xl: '超大' };
  // 皮肤：wood 为原版，其余为可选外观；auto 表示「跟随 data.json 里的站点默认」
  const SKINS = ['wood', 'gallery', 'glass', 'editorial', 'terminal'];
  const SKIN_CHOICES = ['auto'].concat(SKINS);
  const SKIN_LABEL = { auto: '跟随站点', wood: '实木书架', gallery: '极简画廊', glass: '暗夜玻璃', editorial: '杂志纸刊', terminal: '复古终端' };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const icon = n => `<svg class="ic"><use href="#i-${n}"/></svg>`;
  const uid = p => (p || 'x') + '-' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC_MAP[c]);
  const attr = esc;
  const today = () => new Date().toISOString().slice(0, 10);

  const jsonGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const jsonSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式 */ } };
  const jsonDel = k => { try { localStorage.removeItem(k); } catch (e) { /* noop */ } };

  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }
  function safeUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const candidate = /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '');
    try {
      const u = new URL(candidate);
      return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
    } catch (e) { return ''; }
  }
  function hashHue(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function openLink(url) {
    const u = safeUrl(url);
    if (!u) { toast('这个网页还没有有效的网址', true); return; }
    const a = document.createElement('a');
    a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
  }
  // 把本机截图压成 720x450 的 JPEG dataURL，直接内嵌进 data.json，不依赖任何第三方服务
  function compressImage(file, done) {
    if (!/^image\//.test(file.type)) { toast('请选择图片文件', true); return; }
    if (file.size > 10 * 1024 * 1024) { toast('图片请不要超过 10MB', true); return; }
    const fr = new FileReader();
    fr.onerror = () => toast('读取图片失败', true);
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => toast('这张图片浏览器读不出来', true);
      img.onload = () => {
        const W = 720, H = 450;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        const k = Math.max(W / img.width, H / img.height);
        const dw = img.width * k, dh = img.height * k;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, (W - dw) / 2, 0, dw, dh);
        let out = cv.toDataURL('image/jpeg', 0.72);
        if (out.length > 380 * 1024) out = cv.toDataURL('image/jpeg', 0.55);
        done(out, Math.round(out.length / 1024));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  /* ---------------- 状态 ---------------- */
  const S = {
    data: null,
    remote: null,
    remoteUpdatedAt: '',
    edit: false,
    query: '',
    draft: false,
    draftPublished: false,
    needNotice: '',
    shotBust: 0,
    sortableReady: false,
    prefs: { theme: 'light', density: 'auto', skin: 'auto', collapsed: {} },
    urlSkin: '',
    // 默认指向本站仓库；用户若勾选「记住」会由 localStorage 里的 K_GH 覆盖
    gh: { owner: 'Lavie-purple', repo: 'my-web-shelf', branch: 'main', path: 'data.json', token: '' }
  };
  let sortables = [];
  let toastTimer = null;
  let searchTimer = null;
  let pendingThumb = '';
  let clearThumb = false;

  /* ---------------- 数据 ---------------- */
  function normalizeItem(it) {
    it = it && typeof it === 'object' ? it : {};
    const url = safeUrl(it.url);
    return {
      id: String(it.id || uid('i')),
      title: String(it.title || hostOf(url) || '未命名网页'),
      url,
      desc: String(it.desc || ''),
      tags: Array.isArray(it.tags) ? it.tags.filter(Boolean).map(String).slice(0, 8) : [],
      mode: ['auto', 'custom', 'iframe'].includes(it.mode) ? it.mode : 'auto',
      thumb: String(it.thumb || ''),
      addedAt: String(it.addedAt || '')
    };
  }
  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    const st = d.settings && typeof d.settings === 'object' ? d.settings : {};
    const settings = {
      title: String(st.title || '我的在线书架'),
      subtitle: String(st.subtitle || ''),
      owner: String(st.owner || ''),
      screenshotService: SERVICES.includes(st.screenshotService) ? st.screenshotService : 'thumio',
      refresh: ['always', 'hourly', 'daily', 'weekly', 'never'].includes(st.refresh) ? st.refresh : 'daily',
      skin: SKINS.includes(st.skin) ? st.skin : 'wood',
      note: String(st.note || '')
    };
    const seen = new Set();
    const itemSeen = new Set();
    let groups = (Array.isArray(d.groups) ? d.groups : []).map(g => {
      g = g && typeof g === 'object' ? g : {};
      let id = String(g.id || uid('g'));
      if (seen.has(id)) id = uid('g');
      seen.add(id);
      return {
        id,
        name: String(g.name || '未命名分组'),
        collapsed: !!g.collapsed,
        items: (Array.isArray(g.items) ? g.items : []).map(raw => {
          const it = normalizeItem(raw);
          if (itemSeen.has(it.id)) it.id = uid('i');
          itemSeen.add(it.id);
          return it;
        })
      };
    });
    if (!groups.length) groups = [{ id: uid('g'), name: '我的收藏', collapsed: false, items: [] }];
    return { version: 1, updatedAt: String(d.updatedAt || ''), settings, groups };
  }

  const findGroup = gid => S.data.groups.find(g => g.id === gid);
  function findItem(iid) {
    for (const g of S.data.groups) {
      const it = g.items.find(x => x.id === iid);
      if (it) return it;
    }
    return null;
  }
  function findItemGroup(iid) {
    return S.data.groups.find(g => g.items.some(x => x.id === iid));
  }
  const totalItems = () => S.data.groups.reduce((n, g) => n + g.items.length, 0);

  function persist(published) {
    // updatedAt 由发布/导出时显式写入，草稿阶段保持线上版本的时间戳
    jsonSet(K_DRAFT, {
      data: S.data,
      savedAt: new Date().toISOString(),
      baseRemoteUpdatedAt: S.remoteUpdatedAt,
      published: !!published
    });
    S.draft = !published;
    S.draftPublished = !!published;
  }
  function savePrefs() { jsonSet(K_PREFS, S.prefs); }

  /* ---------------- 预览图 ---------------- */
  function bucket() {
    const r = S.data.settings.refresh;
    if (r === 'never') return '';
    const unit = { always: 1, hourly: 3600000, daily: 86400000, weekly: 604800000 }[r] || 86400000;
    const b = Math.floor(Date.now() / unit).toString(36);
    return 's' + b + (S.shotBust ? 'r' + S.shotBust : '');
  }
  function bustUrl(u) {
    const b = bucket();
    if (!b) return u;
    return u + (u.includes('?') ? '&' : '?') + '__shelf=' + b;
  }
  // 宽屏 / 大图密度下卡片会明显变大，截图宽度跟着卡片走，避免 5K 屏上封面发虚
  function cssPx(name, fallback) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:var(' + name + ')';
    document.body.appendChild(probe);
    const w = parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return Number.isFinite(w) && w > 0 ? w : fallback;
  }
  function shotWidth() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return Math.min(1280, Math.max(720, Math.round(cssPx('--book-w', 212) * dpr * 1.2)));
  }
  function shotSrc(item, service) {
    // 刷新参数只加在首选服务上：mshots 对陌生地址会返回「Generating Preview」排队图，
    // 所以回退服务一律用干净 URL，直接吃它自己的缓存
    const u = service === S.data.settings.screenshotService ? bustUrl(item.url) : item.url;
    if (service === 'microlink') {
      return 'https://api.microlink.io/?url=' + encodeURIComponent(u) +
        '&screenshot=true&meta=false&embed=screenshot.url';
    }
    const w = shotWidth();
    if (service === 'thumio') return 'https://image.thum.io/get/width/' + w + '/crop/' + Math.round(w * .625) + '/noanimate/' + u;
    return 'https://s.wordpress.com/mshots/v1/' + encodeURIComponent(u) + '?w=' + w;
  }
  function previewHTML(it) {
    const host = hostOf(it.url);
    const letter = (host || '?').charAt(0).toUpperCase();
    const fb = `<div class="cover__fallback" style="--h:${hashHue(host || 'x')}"><span class="cover__letter">${esc(letter)}</span><span class="cover__host">${esc(host || '未设置网址')}</span></div>`;
    if (it.mode === 'iframe' && it.url) {
      return fb +
        `<div class="cover__frame"><iframe src="${attr(it.url)}" loading="lazy" tabindex="-1" title="${attr(it.title)} 的实时预览" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin"></iframe></div>` +
        `<div class="cover__hit"></div><span class="cover__badge">实时嵌入</span>`;
    }
    const custom = it.mode === 'custom' && it.thumb;
    const src = custom ? it.thumb : shotSrc(it, S.data.settings.screenshotService);
    return fb +
      `<img class="cover__img" data-stage="0" data-id="${attr(it.id)}" src="${attr(src)}" alt="${attr(it.title)} 的网页预览" loading="lazy" decoding="async">` +
      `<div class="cover__loading"></div>` +
      (custom ? '<span class="cover__badge">自定义封面</span>' : '');
  }
  function onShotLoad(img) {
    img.classList.add('is-loaded');
    const l = $('.cover__loading', img.closest('.cover'));
    if (l) l.remove();
  }
  function onShotError(img) {
    const it = findItem(img.dataset.id);
    const cover = img.closest('.cover');
    const stage = Number(img.dataset.stage || 0);
    const cur = S.data.settings.screenshotService;
    const order = [cur, ...SERVICES.filter(s => s !== cur)];
    if (it && it.mode === 'auto' && stage < order.length - 1) {
      img.dataset.stage = String(stage + 1);
      img.src = shotSrc(it, order[stage + 1]);
      return;
    }
    img.remove();
    if (cover) { const l = $('.cover__loading', cover); if (l) l.remove(); }
  }
  function fitFrames() {
    $$('.cover__frame').forEach(f => {
      const c = f.closest('.cover');
      if (c) f.style.setProperty('--frame-scale', ((c.clientWidth || 196) / 1280).toFixed(4));
    });
  }

  /* ---------------- 渲染 ---------------- */
  function matches(it, q) {
    return [it.title, it.url, it.desc, ...it.tags].join(' ').toLowerCase().includes(q);
  }
  function bookHTML(it, gid) {
    const host = hostOf(it.url);
    const tools = S.edit ? `<div class="book__tools">
        <button type="button" class="btn" data-act="open-item" title="在新标签页打开">${icon('external')}</button>
        <button type="button" class="btn" data-act="item-left" title="向前移动">${icon('left')}</button>
        <button type="button" class="btn" data-act="item-right" title="向后移动">${icon('right')}</button>
        <button type="button" class="btn" data-act="edit-item" title="编辑">${icon('pencil')}</button>
        <button type="button" class="btn btn--danger" data-act="del-item" title="删除">${icon('trash')}</button>
      </div>` : '';
    const grip = S.edit ? `<div class="book__grip">${icon('grip')}</div>` : '';
    return `<article class="book" data-id="${attr(it.id)}" data-gid="${attr(gid)}" tabindex="0" role="link" aria-label="打开 ${attr(it.title)}">
      <div class="book__spine"></div>${grip}${tools}
      <div class="book__inner">
        <div class="cover">${previewHTML(it)}</div>
        <div class="book__meta">
          <h3 class="book__title">${esc(it.title)}</h3>
          <p class="book__url">${esc(host || it.url || '未设置网址')}${it.url ? ' ›' : ''}</p>
          <p class="book__desc">${esc(it.desc)}</p>
          ${it.tags.length ? `<div class="book__tags">${it.tags.map(t => `<span class="book__tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
    </article>`;
  }
  function groupActs(g, gi) {
    if (!S.edit) return '';
    return `<span class="shelf__acts">
      <button type="button" class="btn" data-act="group-up" data-gid="${attr(g.id)}" title="分组上移" ${gi === 0 ? 'disabled' : ''}>${icon('left')}</button>
      <button type="button" class="btn" data-act="group-down" data-gid="${attr(g.id)}" title="分组下移" ${gi === S.data.groups.length - 1 ? 'disabled' : ''}>${icon('right')}</button>
      <button type="button" class="btn shelf__drag" data-act="noop" title="按住拖动整层" aria-label="拖动分组">${icon('grip')}</button>
      <button type="button" class="btn" data-act="edit-group" data-gid="${attr(g.id)}" title="重命名分组">${icon('pencil')}</button>
      <button type="button" class="btn btn--danger" data-act="del-group" data-gid="${attr(g.id)}" title="删除分组">${icon('trash')}</button>
    </span>`;
  }
  function renderShelves() {
    const q = S.query.trim().toLowerCase();
    let groups = S.data.groups;
    if (q) groups = groups.filter(g => g.items.some(it => matches(it, q)));
    let html = groups.map(g => {
      const gi = S.data.groups.indexOf(g);
      const hasLocal = Object.prototype.hasOwnProperty.call(S.prefs.collapsed, g.id);
      const collapsed = q ? false : (hasLocal ? !!S.prefs.collapsed[g.id] : !!g.collapsed);
      const list = q ? g.items.filter(it => matches(it, q)) : g.items;
      const books = list.length
        ? list.map(it => bookHTML(it, g.id)).join('')
        : `<div class="shelf__empty">${icon(q ? 'search' : 'book')}<span>${q ? '这一层没有匹配的网页' : '这一层还空着'}</span>${S.edit && !q ? `<button type="button" class="btn btn--sm" data-act="add-item" data-gid="${attr(g.id)}">${icon('plus')}添加网页</button>` : ''}</div>`;
      return `<section class="shelf ${collapsed ? 'is-collapsed' : ''}" data-gid="${attr(g.id)}" data-name="${attr(g.name)}">
        <div class="shelf__head">
          <button type="button" class="shelf__toggle" data-act="toggle-group" data-gid="${attr(g.id)}" aria-expanded="${!collapsed}">
            <svg class="ic shelf__chevron"><use href="#i-chevron"/></svg><span class="shelf__name">${esc(g.name)}</span>
          </button>
          <span class="shelf__count">${list.length}${q && list.length !== g.items.length ? ' / ' + g.items.length : ''} 本</span>
          <span class="shelf__fill"></span>${groupActs(g, gi)}
        </div>
        <div class="shelf__books" data-gid="${attr(g.id)}">${books}</div>
        <div class="shelf__board"></div>
      </section>`;
    }).join('');
    if (q && !groups.length) {
      html = `<div class="shelf__empty" style="padding:32px 4px 40px">${icon('search')}<span>没有找到包含「${esc(S.query.trim())}」的网页</span></div>`;
    }
    $('#shelves').innerHTML = html;
  }
  function renderNotice() {
    const n = $('#notice');
    let html = '';
    if (S.needNotice === 'remote-newer') {
      html = `<div class="notice__text"><strong>线上数据已经更新过。</strong>本机还留着基于旧版本修改的草稿，所以当前显示的是草稿内容。</div>
        <button type="button" class="btn btn--sm" data-act="discard">载入线上版本（放弃草稿）</button>`;
    } else if (S.draft) {
      html = `<div class="notice__text"><strong>改动只保存在这台设备的浏览器里。</strong>要让公域访客看到，请导出 data.json 提交到仓库，或直接用「发布到 GitHub」推送。</div>
        <button type="button" class="btn btn--sm" data-act="export">导出 data.json</button>
        <button type="button" class="btn btn--sm btn--ghost" data-act="github">发布到 GitHub</button>
        <button type="button" class="btn btn--sm btn--ghost" data-act="discard">放弃改动</button>`;
    } else if (S.draftPublished) {
      html = `<div class="notice__text"><strong>本机正在显示一份本地副本。</strong>线上 data.json 更新后刷新页面会自动切回线上版本；也可以现在就清除。</div>
        <button type="button" class="btn btn--sm btn--ghost" data-act="discard">清除本机副本</button>`;
    }
    n.innerHTML = html;
    n.hidden = !html;
  }
  function render() {
    const d = S.data;
    document.title = d.settings.title;
    $('#siteTitle').textContent = d.settings.title;
    $('#siteSubtitle').textContent = d.settings.subtitle;
    document.body.classList.toggle('editing', S.edit);
    $('#editbar').hidden = !S.edit;
    $('#btnEdit').innerHTML = S.edit ? icon('check') + '<span>完成编辑</span>' : icon('sliders') + '<span>管理书架</span>';
    $('#draftBadge').hidden = !S.draft;
    $('#metaHint').textContent = S.edit ? '拖动卡片换顺序，也可以拖到别的分组' : '点击封面即可打开网页';
    $('#stats').innerHTML = `<span class="meta__num">${totalItems()}</span><span class="meta__unit">个网页</span>
      <span class="meta__sep"></span><span class="meta__num">${d.groups.length}</span><span class="meta__unit">个分组 · ${d.groups.length} 层书架</span>`;
    $('#footerStat').textContent = d.settings.note || '';
    renderNotice();
    renderShelves();
    fitFrames();
    bindSortables();
  }

  /* ---------------- 拖拽 ---------------- */
  function loadSortable() {
    if (window.Sortable) { S.sortableReady = true; render(); return; }
    const s = document.createElement('script');
    s.src = SORTABLE_CDN;
    s.async = true;
    s.onload = () => { if (window.Sortable) { S.sortableReady = true; render(); } };
    s.onerror = () => { /* 静默降级：卡片上的前移/后移按钮仍然可用 */ };
    document.head.appendChild(s);
  }
  function bindSortables() {
    sortables.forEach(x => { try { x.destroy(); } catch (e) { /* noop */ } });
    sortables = [];
    if (!S.sortableReady || !S.edit || !window.Sortable) return;
    if (S.query.trim()) return;
    $$('.shelf__books').forEach(el => {
      const sec = el.closest('.shelf');
      sortables.push(new Sortable(el, {
        group: 'books',
        draggable: '.book',
        animation: 180,
        ghostClass: 'is-ghost',
        dragClass: 'is-dragging',
        filter: 'button, .book__tools',
        preventOnFilter: false,
        disabled: sec.classList.contains('is-collapsed'),
        onEnd: () => setTimeout(syncItemsFromDOM, 60)
      }));
    });
    sortables.push(new Sortable($('#shelves'), {
      draggable: '.shelf',
      handle: '.shelf__drag',
      animation: 180,
      ghostClass: 'is-ghost',
      onEnd: () => setTimeout(syncGroupsFromDOM, 60)
    }));
  }
  function syncItemsFromDOM() {
    const map = new Map();
    S.data.groups.forEach(g => g.items.forEach(it => map.set(it.id, it)));
    const next = $$('#shelves > .shelf').map(sec => {
      const g = findGroup(sec.dataset.gid);
      if (!g) return null;
      const ids = $$('.shelf__books > .book', sec).map(b => b.dataset.id);
      return Object.assign({}, g, { items: ids.map(id => map.get(id)).filter(Boolean) });
    }).filter(Boolean);
    if (!next.length) return;
    S.data.groups = next;
    persist(false);
    render();
    toast('顺序已更新（记得导出或发布）');
  }
  function syncGroupsFromDOM() {
    const map = new Map(S.data.groups.map(g => [g.id, g]));
    const next = $$('#shelves > .shelf').map(s => map.get(s.dataset.gid)).filter(Boolean);
    if (!next.length) return;
    S.data.groups = next;
    persist(false);
    render();
    toast('分组顺序已更新');
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal({ title, body, foot, onSubmit }) {
    pendingThumb = '';
    clearThumb = false;
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML = foot || `<button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn btn--accent">保存</button>`;
    toggleThumbField();
    const form = $('#modalForm');
    form.onsubmit = ev => { ev.preventDefault(); if (onSubmit) onSubmit(form); };
    const dlg = $('#modal');
    if (!dlg.open) dlg.showModal();
  }
  function closeModal() { const d = $('#modal'); if (d.open) d.close(); }
  const v = (form, name) => { const el = form.elements.namedItem(name); return el ? String(el.value || '') : ''; };
  const checked = (form, name) => { const el = form.elements.namedItem(name); return !!(el && el.checked); };
  function invalid(form, name, msg) {
    const el = form.elements.namedItem(name);
    if (!el) return;
    el.setAttribute('aria-invalid', 'true');
    const f = el.closest('.field');
    if (f) {
      let e = $('.field__err', f);
      if (!e) { e = document.createElement('span'); e.className = 'field__err'; f.appendChild(e); }
      e.textContent = msg;
    }
    el.focus();
  }
  function toggleThumbField() {
    const sel = $('#modalBody [name="mode"]');
    const f = $('#thumbField');
    if (sel && f) f.hidden = sel.value !== 'custom';
  }
  function confirmModal(title, text, okLabel, onYes) {
    openModal({
      title,
      body: `<p class="modal__note">${esc(text)}</p>`,
      foot: `<button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn btn--danger">${esc(okLabel)}</button>`,
      onSubmit: () => { closeModal(); onYes(); }
    });
  }

  /* ---------------- 表单：网页 ---------------- */
  function itemForm(item, gid) {
    const isNew = !item;
    const it = item || { title: '', url: '', desc: '', tags: [], mode: 'auto', thumb: '' };
    const hasInline = /^data:image\//.test(it.thumb);
    const curGid = gid || (findItemGroup(item && item.id) || S.data.groups[0]).id;
    const body = `
      <div class="field"><label for="f-title">网页名称<span class="field__req">*</span></label>
        <input id="f-title" name="title" value="${attr(it.title)}" placeholder="例如：我的个人主页" required></div>
      <div class="field"><label for="f-url">网址<span class="field__req">*</span></label>
        <input id="f-url" name="url" value="${attr(it.url)}" placeholder="https://example.com" required>
        <span class="field__hint">不写 https:// 会自动补齐。点封面就是用这个地址在新标签页打开</span></div>
      <div class="field"><label for="f-desc">一句话说明</label>
        <textarea id="f-desc" name="desc" placeholder="这个网页是做什么的">${esc(it.desc)}</textarea></div>
      <div class="field-row">
        <div class="field"><label for="f-group">摆在哪一层</label><select id="f-group" name="group">
          ${S.data.groups.map(g => `<option value="${attr(g.id)}" ${g.id === curGid ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
        </select></div>
        <div class="field"><label for="f-mode">封面预览方式</label><select id="f-mode" name="mode">
          <option value="auto" ${it.mode === 'auto' ? 'selected' : ''}>自动实时截图</option>
          <option value="iframe" ${it.mode === 'iframe' ? 'selected' : ''}>嵌入实时网页</option>
          <option value="custom" ${it.mode === 'custom' ? 'selected' : ''}>自定义图片地址</option>
        </select></div>
      </div>
      <div class="field" id="thumbField"><label for="f-thumb">自定义图片地址</label>
        <input id="f-thumb" name="thumb" value="${attr(hasInline ? '' : it.thumb)}" placeholder="https://.../cover.png">
        <label class="upload" for="f-thumb-file"><input type="file" id="f-thumb-file" name="thumbFile" accept="image/*">${icon('upload')}<span>从本机上传一张截图</span></label>
        <span class="field__hint" id="thumbFileName">${hasInline ? '当前已有一张上传的封面，保存在 data.json 里；不改动就会保留。' : '上传的图片会压成 720×450 内嵌进 data.json（一张约 40–80KB），完全不依赖截图服务'}</span>
        ${hasInline || it.thumb ? `<div><button type="button" class="btn btn--sm" data-act="clear-thumb">清除当前封面，用回自动截图</button></div>` : ''}
      </div>
      <div class="field"><label for="f-tags">标签（用逗号分隔，便于搜索）</label>
        <input id="f-tags" name="tags" value="${attr(it.tags.join(', '))}" placeholder="工具, 设计"></div>
      <p class="modal__note">「自动实时截图」由公开截图服务抓取，按站点设置的周期自动更新；少数站点禁止截图，会自动换成备用服务，再不行就显示域名封面。「嵌入实时网页」是真实 iframe 缩小后的样子，但很多站点会拒绝被嵌入。</p>`;
    openModal({
      title: isNew ? '添加网页到书架' : '编辑网页',
      body,
      foot: `<button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn btn--accent">${isNew ? '添加到书架' : '保存修改'}</button>`,
      onSubmit: form => {
        const title = v(form, 'title').trim();
        const url = safeUrl(v(form, 'url'));
        if (!title) { invalid(form, 'title', '请填写网页名称'); return; }
        if (!url) { invalid(form, 'url', '请填写有效的 http / https 网址'); return; }
        let mode = v(form, 'mode');
        let thumb = v(form, 'thumb').trim();
        if (clearThumb) { thumb = ''; mode = 'auto'; }
        else if (pendingThumb) { thumb = pendingThumb; mode = 'custom'; }
        else if (!thumb && hasInline) { thumb = it.thumb; }
        const obj = Object.assign({}, item || { id: uid('i'), addedAt: today() }, {
          title, url,
          desc: v(form, 'desc').trim(),
          tags: v(form, 'tags').split(/[,，]/).map(s => s.trim()).filter(Boolean).slice(0, 8),
          mode, thumb
        });
        const target = findGroup(v(form, 'group')) || S.data.groups[0];
        S.data.groups.forEach(g => { g.items = g.items.filter(x => x.id !== obj.id); });
        target.items.push(obj);
        persist(false);
        closeModal(); render();
        toast(isNew ? '已添加网页，记得导出或发布' : '已保存修改');
      }
    });
    $('#f-title').focus();
  }

  /* ---------------- 表单：分组 ---------------- */
  function groupForm(g) {
    const isNew = !g;
    const body = `
      <div class="field"><label for="g-name">分组名称<span class="field__req">*</span></label>
        <input id="g-name" name="name" value="${attr(g ? g.name : '')}" placeholder="例如：作品与项目" required></div>
      <label class="check"><input type="checkbox" name="collapsed" ${g && g.collapsed ? 'checked' : ''}><span>访客第一次打开时，默认把这一层折叠起来</span></label>
      <p class="modal__note" style="margin-top:16px">每个分组就是书架的一层。折叠状态会记在访客自己浏览器里，不会互相影响。</p>
      ${g ? `<div class="modal__danger"><span>删除分组会连同这一层的 ${g.items.length} 个网页一起移除</span><button type="button" class="btn btn--sm btn--danger" data-act="del-group" data-gid="${attr(g.id)}">${icon('trash')}删除分组</button></div>` : ''}`;
    openModal({
      title: isNew ? '新建一层书架' : '编辑分组',
      body,
      foot: `<button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn btn--accent">${isNew ? '创建分组' : '保存'}</button>`,
      onSubmit: form => {
        const name = v(form, 'name').trim();
        if (!name) { invalid(form, 'name', '请填写分组名称'); return; }
        if (g) {
          g.name = name;
          g.collapsed = checked(form, 'collapsed');
          delete S.prefs.collapsed[g.id];
          savePrefs();
        } else {
          S.data.groups.push({ id: uid('g'), name, collapsed: checked(form, 'collapsed'), items: [] });
        }
        persist(false);
        closeModal(); render();
        toast(isNew ? '已新建一层' : '已保存分组');
      }
    });
    $('#g-name').focus();
  }

  /* ---------------- 表单：站点设置 ---------------- */
  function settingsForm() {
    const st = S.data.settings;
    const body = `
      <div class="field"><label for="s-title">书架标题</label><input id="s-title" name="title" value="${attr(st.title)}"></div>
      <div class="field"><label for="s-subtitle">副标题</label><input id="s-subtitle" name="subtitle" value="${attr(st.subtitle)}"></div>
      <div class="field"><label for="s-skin">站点默认外观</label>
        <select id="s-skin" name="skin">
          ${SKINS.map(k => `<option value="${k}" ${st.skin === k ? 'selected' : ''}>${SKIN_LABEL[k]}</option>`).join('')}
        </select>
        <span class="field__hint">发布后所有访客默认看到这套外观。访客仍可在统计行自行切换，只影响他自己的浏览器。改完请发布 data.json，并跑一次 tools/sync-seed.py 同步首屏皮肤</span>
      </div>
      <div class="field-row">
        <div class="field"><label for="s-service">首选截图服务</label><select id="s-service" name="service">
          <option value="microlink" ${st.screenshotService === 'microlink' ? 'selected' : ''}>Microlink（推荐，实时清晰，有免费额度）</option>
          <option value="mshots" ${st.screenshotService === 'mshots' ? 'selected' : ''}>WordPress mshots（无额度限制，但用缓存图）</option>
          <option value="thumio" ${st.screenshotService === 'thumio' ? 'selected' : ''}>thum.io（最后兜底，免费版易限流）</option>
        </select></div>
        <div class="field"><label for="s-refresh">快照更新频率</label><select id="s-refresh" name="refresh">
          <option value="always" ${st.refresh === 'always' ? 'selected' : ''}>每次打开都重抓</option>
          <option value="hourly" ${st.refresh === 'hourly' ? 'selected' : ''}>每小时</option>
          <option value="daily" ${st.refresh === 'daily' ? 'selected' : ''}>每天</option>
          <option value="weekly" ${st.refresh === 'weekly' ? 'selected' : ''}>每周</option>
          <option value="never" ${st.refresh === 'never' ? 'selected' : ''}>不主动刷新</option>
        </select></div>
      </div>
      <p class="modal__note">截图只是封面，点击卡片才会真正跳转。首选服务抓不到时会自动依次尝试另外两家，最后才显示域名封面；也可以给单个网页直接上传一张本地截图。频率越密，第三方服务压力越大，一般「每天」就够「及时更新」了。</p>`;
    openModal({
      title: '书架设置',
      body,
      onSubmit: form => {
        S.data.settings.title = v(form, 'title').trim() || '我的在线书架';
        S.data.settings.subtitle = v(form, 'subtitle').trim();
        S.data.settings.screenshotService = v(form, 'service');
        S.data.settings.refresh = v(form, 'refresh');
        S.data.settings.skin = SKINS.includes(v(form, 'skin')) ? v(form, 'skin') : 'wood';
        persist(false); closeModal(); applySkin(); render();
        toast('设置已保存，记得发布 data.json');
      }
    });
  }

  /* ---------------- 表单：发布到 GitHub ---------------- */
  function githubForm() {
    const g = S.gh;
    const body = `
      <p class="modal__note"><strong>为什么需要这一步？</strong>本站是纯静态页面，公域访客看到的内容全部来自仓库里的 <code>data.json</code>。填好仓库信息后，浏览器会通过 GitHub API 直接提交这个文件，Pages 通常 1–2 分钟内更新。令牌只存在你这台设备的浏览器，不会写进仓库。</p>
      <div class="field-row">
        <div class="field"><label for="gh-owner">仓库所有者<span class="field__req">*</span></label><input id="gh-owner" name="owner" value="${attr(g.owner)}" placeholder="Lavie-purple"></div>
        <div class="field"><label for="gh-repo">仓库名<span class="field__req">*</span></label><input id="gh-repo" name="repo" value="${attr(g.repo)}" placeholder="my-web-shelf"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="gh-branch">分支</label><input id="gh-branch" name="branch" value="${attr(g.branch || 'main')}"></div>
        <div class="field"><label for="gh-path">文件路径</label><input id="gh-path" name="path" value="${attr(g.path || 'data.json')}"></div>
      </div>
      <div class="field"><label for="gh-token">Personal Access Token<span class="field__req">*</span></label>
        <input id="gh-token" name="token" type="password" autocomplete="off" value="${attr(g.token)}" placeholder="github_pat_... 或 ghp_...">
        <span class="field__hint">建议用 fine-grained token，只授权这一个仓库的 Contents 读写。不要在公用设备上使用。</span></div>
      <label class="check"><input type="checkbox" name="remember" ${g.token ? 'checked' : ''}><span>在这台设备记住仓库信息与令牌</span></label>
      <p class="modal__note" style="margin-top:14px">不想用令牌也完全可以：点「导出 data.json」，把下载的文件替换仓库同名文件再 commit 即可。</p>`;
    openModal({
      title: '发布到 GitHub',
      body,
      foot: `<button type="button" class="btn btn--ghost" data-act="discard">清除本机草稿</button><span class="modal__spacer"></span><button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn btn--accent">${icon('cloud')}提交并发布</button>`,
      onSubmit: async form => {
        const cfg = {
          owner: v(form, 'owner').trim(), repo: v(form, 'repo').trim(),
          branch: v(form, 'branch').trim() || 'main',
          path: v(form, 'path').trim().replace(/^\/+/, '') || 'data.json',
          token: v(form, 'token').trim()
        };
        if (!cfg.owner || !cfg.repo) { invalid(form, 'owner', '请填写仓库所有者与仓库名'); return; }
        if (!cfg.token) { invalid(form, 'token', '请填写访问令牌'); return; }
        if (checked(form, 'remember')) jsonSet(K_GH, cfg); else jsonDel(K_GH);
        S.gh = cfg;
        const btn = $('#modalFoot [type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = '正在提交…'; }
        try {
          await publish(cfg);
        } catch (err) {
          toast(err.message || String(err), true);
          if (btn) { btn.disabled = false; btn.innerHTML = icon('cloud') + '提交并发布'; }
        }
      }
    });
  }
  async function publish(cfg) {
    const base = 'https://api.github.com/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
      '/contents/' + cfg.path.split('/').map(encodeURIComponent).join('/');
    const headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + cfg.token,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    let sha = '';
    const get = await fetch(base + '?ref=' + encodeURIComponent(cfg.branch) + '&_=' + Date.now(), { headers, cache: 'no-store' });
    if (get.ok) {
      const j = await get.json();
      sha = j.sha || '';
    } else if (get.status !== 404) {
      throw new Error('读取线上 data.json 失败（HTTP ' + get.status + '）：' + (await get.text()).slice(0, 160));
    }
    S.data.updatedAt = new Date().toISOString();
    const payload = {
      message: '更新在线书架：' + totalItems() + ' 个网页 / ' + S.data.groups.length + ' 个分组',
      content: b64(JSON.stringify(S.data, null, 2) + '\n'),
      branch: cfg.branch
    };
    if (sha) payload.sha = sha;
    const put = await fetch(base, { method: 'PUT', headers, body: JSON.stringify(payload) });
    if (!put.ok) throw new Error('提交失败（HTTP ' + put.status + '）：' + (await put.text()).slice(0, 200));
    persist(true);
    S.remote = normalize(S.data);
    S.remoteUpdatedAt = S.data.updatedAt;
    S.needNotice = '';
    closeModal(); render();
    toast('已提交到 ' + cfg.owner + '/' + cfg.repo + '，Pages 通常 1–2 分钟内更新');
  }

  /* ---------------- 动作 ---------------- */
  function requireEdit() {
    if (S.edit) return true;
    toast('请先点右上角「管理书架」进入编辑模式', true);
    return false;
  }
  function moveItem(gid, iid, dir) {
    const g = findGroup(gid);
    if (!g) return;
    const i = g.items.findIndex(x => x.id === iid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= g.items.length) { toast('已经到这一层的边缘了'); return; }
    const [x] = g.items.splice(i, 1);
    g.items.splice(j, 0, x);
    persist(false); render();
  }
  function moveGroup(gid, dir) {
    const i = S.data.groups.findIndex(g => g.id === gid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= S.data.groups.length) return;
    const [x] = S.data.groups.splice(i, 1);
    S.data.groups.splice(j, 0, x);
    persist(false); render();
  }
  function discardDraft() {
    confirmModal('放弃本机改动？', '将删除保存在这台浏览器里的草稿，重新显示线上 data.json 的内容。此操作不可撤销。', '放弃并载入线上版本', () => {
      jsonDel(K_DRAFT);
      S.data = normalize(S.remote);
      S.draft = false; S.draftPublished = false; S.needNotice = '';
      S.query = ''; $('#searchInput').value = '';
      render(); toast('已载入线上版本');
    });
  }
  function exportData() {
    S.data.updatedAt = new Date().toISOString();
    download('data.json', JSON.stringify(S.data, null, 2) + '\n', 'application/json');
    persist(true);
    S.remote = normalize(S.data);
    S.remoteUpdatedAt = S.data.updatedAt;
    render();
    toast('已下载 data.json：替换仓库同名文件并提交，公域就会更新');
  }
  function dispatch(act, gid, iid) {
    switch (act) {
      case 'close-modal': closeModal(); return;
      case 'clear-thumb': {
        clearThumb = true; pendingThumb = '';
        const inp = $('#f-thumb'); if (inp) inp.value = '';
        const hint = $('#thumbFileName');
        if (hint) hint.textContent = '已标记清除，保存后这一页会回到自动截图';
        return;
      }
      case 'toggle-group': {
        const g = findGroup(gid);
        if (!g) return;
        const hasLocal = Object.prototype.hasOwnProperty.call(S.prefs.collapsed, gid);
        const cur = hasLocal ? !!S.prefs.collapsed[gid] : !!g.collapsed;
        S.prefs.collapsed[gid] = !cur;
        savePrefs(); render();
        return;
      }
      case 'open-item': { const it = findItem(iid); if (it) openLink(it.url); return; }
      case 'discard': discardDraft(); return;
      case 'export': exportData(); return;
      case 'github': if (requireEdit()) githubForm(); return;
      case 'import': if (requireEdit()) $('#fileInput').click(); return;
      case 'exit-edit': S.edit = false; render(); return;
      case 'expand-all': S.prefs.collapsed = {}; savePrefs(); render(); return;
      case 'refresh-shots': S.shotBust++; render(); toast('正在重新抓取预览图'); return;
      case 'settings': if (requireEdit()) settingsForm(); return;
      case 'add-item': if (requireEdit()) itemForm(null, gid); return;
      case 'edit-item': if (requireEdit()) { const it = findItem(iid); if (it) itemForm(it, gid); } return;
      case 'del-item': {
        if (!requireEdit()) return;
        const it = findItem(iid); if (!it) return;
        confirmModal('从书架移除？', '「' + it.title + '」将从本机草稿里删除，导出或发布后线上也会移除。', '移除网页', () => {
          S.data.groups.forEach(g => { g.items = g.items.filter(x => x.id !== iid); });
          persist(false); render(); toast('已移除，记得导出或发布');
        });
        return;
      }
      case 'item-left': if (requireEdit()) moveItem(gid, iid, -1); return;
      case 'item-right': if (requireEdit()) moveItem(gid, iid, 1); return;
      case 'add-group': if (requireEdit()) groupForm(null); return;
      case 'edit-group': if (requireEdit()) { const g = findGroup(gid); if (g) groupForm(g); } return;
      case 'del-group': {
        if (!requireEdit()) return;
        const g = findGroup(gid); if (!g) return;
        confirmModal('删除这一层？', '分组「' + g.name + '」以及其中的 ' + g.items.length + ' 个网页都会被移除，导出或发布后线上同步生效。', '删除分组', () => {
          S.data.groups = S.data.groups.filter(x => x.id !== gid);
          if (!S.data.groups.length) S.data.groups.push({ id: uid('g'), name: '我的收藏', collapsed: false, items: [] });
          closeModal(); persist(false); render(); toast('已删除分组');
        });
        return;
      }
      case 'group-up': if (requireEdit()) moveGroup(gid, -1); return;
      case 'group-down': if (requireEdit()) moveGroup(gid, 1); return;
      default: return;
    }
  }

  /* ---------------- 交互绑定 ---------------- */
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    t.classList.toggle('is-error', !!bad);
    requestAnimationFrame(() => t.classList.add('is-on'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('is-on');
      setTimeout(() => { t.hidden = true; }, 260);
    }, bad ? 5600 : 3200);
  }
  function handleClick(e) {
    const el = e.target.closest('[data-act]');
    if (el) {
      if (el.dataset.act === 'noop') { e.preventDefault(); return; }
      e.preventDefault();
      e.stopPropagation();
      const gid = el.dataset.gid || (el.closest('[data-gid]') ? el.closest('[data-gid]').dataset.gid : '');
      const iid = el.dataset.id || (el.closest('.book') ? el.closest('.book').dataset.id : '');
      dispatch(el.dataset.act, gid, iid);
      return;
    }
    const book = e.target.closest('.book');
    if (book) {
      const iid = book.dataset.id;
      if (S.edit) { const it = findItem(iid); if (it) itemForm(it, book.dataset.gid); }
      else { const it = findItem(iid); if (it) openLink(it.url); }
      return;
    }
  }
  function bind() {
    document.addEventListener('click', handleClick);
    $('#shelves').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const book = e.target.closest('.book');
      if (!book || e.target.closest('button')) return;
      e.preventDefault();
      if (S.edit) { const it = findItem(book.dataset.id); if (it) itemForm(it, book.dataset.gid); }
      else { const it = findItem(book.dataset.id); if (it) openLink(it.url); }
    });
    $('#shelves').addEventListener('error', e => {
      if (e.target.matches && e.target.matches('img.cover__img')) onShotError(e.target);
    }, true);
    $('#shelves').addEventListener('load', e => {
      if (e.target.matches && e.target.matches('img.cover__img')) onShotLoad(e.target);
    }, true);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    $('#modal').addEventListener('cancel', () => { /* 允许 ESC 关闭 */ });
    $('#modalBody').addEventListener('change', e => {
      if (e.target.name === 'mode') toggleThumbField();
      if (e.target.name === 'thumbFile' && e.target.files && e.target.files[0]) {
        const input = e.target;
        compressImage(input.files[0], (dataUrl, kb) => {
          pendingThumb = dataUrl;
          clearThumb = false;
          const sel = $('#modalBody [name="mode"]');
          if (sel) { sel.value = 'custom'; toggleThumbField(); }
          const hint = $('#thumbFileName');
          if (hint) hint.textContent = '已就绪：约 ' + kb + ' KB，保存时写入 data.json';
          input.value = '';
          toast('封面已准备好，保存后生效');
        });
      }
    });
    $('#modalBody').addEventListener('input', e => {
      if (e.target.removeAttribute) e.target.removeAttribute('aria-invalid');
      const f = e.target.closest('.field');
      if (f) { const err = $('.field__err', f); if (err) err.remove(); }
    });
    $('#searchInput').addEventListener('input', e => {
      $('#searchClear').hidden = !e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { S.query = e.target.value; render(); }, 130);
    });
    $('#searchClear').addEventListener('click', () => {
      $('#searchInput').value = ''; $('#searchClear').hidden = true;
      S.query = ''; render(); $('#searchInput').focus();
    });
    $('#btnTheme').addEventListener('click', () => {
      S.prefs.theme = S.prefs.theme === 'dark' ? 'light' : 'dark';
      savePrefs(); applyTheme();
    });
    $('#skinSel').addEventListener('change', e => {
      S.prefs.skin = SKIN_CHOICES.includes(e.target.value) ? e.target.value : 'auto';
      // 用户主动切换即放弃 ?skin= 的临时覆盖，否则下拉会「点了没反应」
      if (S.urlSkin) {
        S.urlSkin = '';
        try {
          const u = new URL(location.href);
          u.searchParams.delete('skin');
          history.replaceState(null, '', u.pathname + u.search + u.hash);
        } catch (err) { /* file:// 下不支持时忽略 */ }
      }
      savePrefs(); applySkin(); fitFrames();
      toast('外观风格：' + SKIN_LABEL[S.prefs.skin] + '（只影响当前浏览器）');
    });
    $('#densitySel').addEventListener('change', e => {
      S.prefs.density = DENSITY.includes(e.target.value) ? e.target.value : 'auto';
      savePrefs(); applyDensity();
      // 重建卡片：让封面按新尺寸重新取图，并让 iframe 预览重新计算缩放
      if (S.data) render();
      toast('显示密度：' + DENSITY_LABEL[S.prefs.density] + '（只影响当前浏览器）');
    });
    $('#btnEdit').addEventListener('click', () => {
      S.edit = !S.edit;
      if (S.edit) {
        S.query = ''; $('#searchInput').value = ''; $('#searchClear').hidden = true;
        S.prefs.collapsed = {}; savePrefs();
      }
      render();
    });
    $('#fileInput').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        if (!obj || !Array.isArray(obj.groups)) throw new Error('文件里没有 groups 数组，不是书架数据');
        S.data = normalize(obj);
        persist(false); render();
        toast('已导入 ' + totalItems() + ' 个网页，记得发布');
      } catch (err) { toast('导入失败：' + err.message, true); }
      e.target.value = '';
    });
    window.addEventListener('resize', () => { fitFrames(); updateWideBadge(); });
  }
  function applyTheme() {
    const dark = S.prefs.theme === 'dark';
    document.body.dataset.theme = dark ? 'dark' : 'light';
    $('#btnTheme').innerHTML = icon(dark ? 'sun' : 'moon');
    $('#btnTheme').title = dark ? '切换为浅色' : '切换为深色';
  }
  function currentSkin() {
    // ?skin= > 访客本机选择 > data.json 里的站点默认
    if (S.urlSkin) return S.urlSkin;
    const p = S.prefs && S.prefs.skin;
    if (p && p !== 'auto' && SKINS.includes(p)) return p;
    const def = S.data && S.data.settings && S.data.settings.skin;
    return SKINS.includes(def) ? def : 'wood';
  }
  function applySkin() {
    const s = currentSkin();
    document.body.dataset.skin = s;
    const sel = $('#skinSel');
    if (sel) {
      sel.value = SKIN_CHOICES.includes(S.prefs.skin) ? S.prefs.skin : 'auto';
      sel.title = S.urlSkin
        ? '当前外观由网址参数 ?skin=' + S.urlSkin + ' 指定；在这里选一套即可清除该参数'
        : '外观风格：只影响当前浏览器，不写入 data.json';
    }
    // 自带深色配色的皮肤，明暗按钮对它无效，隐藏以免出现「点了没反应」的控件
    const fixedDark = (s === 'glass' || s === 'terminal');
    const btn = $('#btnTheme');
    if (btn) {
      btn.hidden = fixedDark;
      btn.title = fixedDark ? '这套外观自带深色配色' : (S.prefs.theme === 'dark' ? '切换为浅色' : '切换为深色');
    }
  }
  function currentDensity() {
    return DENSITY.includes(S.prefs && S.prefs.density) ? S.prefs.density : 'auto';
  }
  function applyDensity() {
    const d = currentDensity();
    if (d === 'auto') delete document.documentElement.dataset.density;
    else document.documentElement.dataset.density = d;
    const sel = $('#densitySel');
    if (sel) sel.value = d;
    updateWideBadge();
  }
  function updateWideBadge() {
    const b = $('#wideBadge');
    if (!b) return;
    b.title = '视口宽 ' + window.innerWidth + 'px，界面与书柜按宽度自动分档；当前密度：' + DENSITY_LABEL[currentDensity()];
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    S.prefs = Object.assign({ theme: 'light', density: 'auto', skin: 'auto', collapsed: {} }, jsonGet(K_PREFS) || {});
    if (!S.prefs.collapsed || typeof S.prefs.collapsed !== 'object') S.prefs.collapsed = {};
    // 可选：?density=large 直接以指定密度打开，适合把某个视图存成书签 / 投屏
    const qs = new URLSearchParams(location.search);
    if (DENSITY.includes(qs.get('density'))) S.prefs.density = qs.get('density');
    // ?skin=gallery 可直接预览某一套外观，不写入本机偏好
    if (SKINS.includes(qs.get('skin'))) S.urlSkin = qs.get('skin');
    // 只让非空的已保存字段覆盖预填值，避免旧草稿里的空串把仓库名抹掉
    const savedGh = jsonGet(K_GH) || {};
    Object.keys(savedGh).forEach(k => { if (savedGh[k] !== '' && savedGh[k] != null) S.gh[k] = savedGh[k]; });

    let remote = null;
    try {
      const r = await fetch('./data.json', { cache: 'no-store' });
      if (r.ok) remote = await r.json();
    } catch (e) { /* file:// 协议或离线，回退到内嵌 seed */ }
    if (!remote) {
      try { remote = JSON.parse($('#seed').textContent || '{}'); } catch (e) { remote = {}; }
    }
    S.remote = normalize(remote);
    S.remoteUpdatedAt = S.remote.updatedAt;

    const rec = jsonGet(K_DRAFT);
    let used = false;
    if (rec && rec.data) {
      const draft = normalize(rec.data);
      const remoteChased = rec.published && S.remoteUpdatedAt && S.remoteUpdatedAt >= (draft.updatedAt || '');
      if (remoteChased) {
        jsonDel(K_DRAFT);
      } else {
        S.data = draft;
        S.draft = !rec.published;
        S.draftPublished = !!rec.published;
        used = true;
        if (!rec.published && S.remoteUpdatedAt && String(rec.baseRemoteUpdatedAt || '') < S.remoteUpdatedAt) {
          S.needNotice = 'remote-newer';
        }
      }
    }
    if (!used) S.data = normalize(S.remote);
    // 给站长一个可直接收藏的编辑入口：网址后面加 ?edit=1
    if (new URLSearchParams(location.search).get('edit') === '1') S.edit = true;

    applyTheme();
    applyDensity();
    applySkin();
    bind();
    render();
    loadSortable();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
