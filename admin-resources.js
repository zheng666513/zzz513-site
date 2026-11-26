/* ==========================================================================
   zzz513 内容管理 · 资料 / 分类 / 标签
   ========================================================================== */

/* ==========================================================================
   一、资料列表
   ========================================================================== */

var resState = {
  items: [],
  loaded: false,
  q: '',
  cats: [],            // 选中的分类名
  sort: 'sortOrder',
  dir: 'desc',
  page: 1,
  pageSize: 20,
  selected: {}         // id -> true
};

var ACTION_TEXT = {
  create: '新增', update: '修改', delete: '删除', duplicate: '复制',
  batch_enable: '批量启用', batch_disable: '批量禁用', batch_delete: '批量删除',
  rename: '重命名', merge: '合并', approve: '显示评论', hide: '隐藏评论',
  password: '修改密码', restore_merge: '合并导入', restore_replace: '覆盖导入',
  'fav.refresh': '强制刷新'
};

Views.resources = async function (box) {
  box.innerHTML = '<div class="panel"><div class="panel-head"><h2>资料管理</h2></div>' +
    skeletonRows(6) + '</div>';

  if (!resState.loaded) {
    await loadResourceData();
  }

  box.innerHTML =
    '<div class="panel">' +
      '<div class="panel-head">' +
        '<input class="input" id="resSearch" placeholder="搜索名称 / 标签 / 简介…" style="width:230px" value="' + esc(resState.q) + '">' +
        '<div class="dropdown" id="catDd">' +
          '<button class="btn btn-sm" id="catBtn">分类：全部 ▾</button>' +
          '<div class="dropdown-panel" id="catPanel" hidden></div>' +
        '</div>' +
        '<button class="btn btn-sm" id="resReset">重置</button>' +
        '<div class="spacer"></div>' +
        '<span class="sub" id="resCount"></span>' +
        '<button class="btn btn-primary btn-sm" id="resAdd">+ 新增资料</button>' +
      '</div>' +
      '<div id="batchBar"></div>' +
      '<div class="table-wrap"><table class="table" id="resTable"></table></div>' +
      '<div id="resPager"></div>' +
    '</div>';

  renderResTable(box);
  bindResToolbar(box);
};

async function loadResourceData() {
  var data = await req('/api/admin/resources');
  resState.items = data.items;
  resState.loaded = true;
  try {
    var cats = await req('/api/admin/categories');
    state.categories = cats;
  } catch (e) { /* ignore */ }
}

function resFiltered() {
  var q = resState.q.trim().toLowerCase();
  var list = resState.items.filter(function (it) {
    if (resState.cats.length && resState.cats.indexOf(it.category) === -1) return false;
    if (!q) return true;
    var hay = [it.name, it.category, it.summary, (it.tags || []).map(function (t) { return t.name; }).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });

  var key = resState.sort;
  var dir = resState.dir === 'asc' ? 1 : -1;
  list.sort(function (a, b) {
    var av = a[key];
    var bv = b[key];
    if (key === 'name') {
      av = String(av || '');
      bv = String(bv || '');
      return av.localeCompare(bv, 'zh-CN') * dir;
    }
    if (key === 'date') {
      av = String(av || '');
      bv = String(bv || '');
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    }
    return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
  });
  return list;
}

function sortArrow(key) {
  if (resState.sort !== key) return '<span class="arrow">↕</span>';
  return '<span class="arrow">' + (resState.dir === 'asc' ? '↑' : '↓') + '</span>';
}

function renderResTable(box) {
  var list = resFiltered();
  var total = list.length;
  var pages = Math.max(1, Math.ceil(total / resState.pageSize));
  if (resState.page > pages) resState.page = pages;

  var start = (resState.page - 1) * resState.pageSize;
  var rows = list.slice(start, start + resState.pageSize);

  var table = $('#resTable', box);
  var pager = $('#resPager', box);
  if (!table) return;

  table.innerHTML =
    '<thead><tr>' +
      '<th style="width:34px"><input type="checkbox" id="checkAll" style="accent-color:var(--accent)"></th>' +
      '<th class="sortable" data-sort="name">名称' + sortArrow('name') + '</th>' +
      '<th>分类</th>' +
      '<th>类型</th>' +
      '<th>大小</th>' +
      '<th class="sortable" data-sort="date">更新日期' + sortArrow('date') + '</th>' +
      '<th class="sortable" data-sort="downloads" style="text-align:right">下载' + sortArrow('downloads') + '</th>' +
      '<th>状态</th>' +
      '<th class="sortable" data-sort="sortOrder" style="text-align:right">排序' + sortArrow('sortOrder') + '</th>' +
      '<th style="width:48px"></th>' +
    '</tr></thead><tbody>' +
    (rows.length ? rows.map(function (it) {
      var ext = String(it.fileType || '').toUpperCase();
      var thumb = it.coverUrl
        ? '<div class="thumb"><img src="' + esc(it.coverUrl) + '" alt="" loading="lazy" onerror="this.parentNode.textContent=\'' + esc(ext.slice(0, 4)) + '\'"></div>'
        : '<div class="thumb" style="color:' + extColor(ext) + '">' + esc(ext.slice(0, 4)) + '</div>';
      var tags = (it.tags || []).slice(0, 3).map(function (t) {
        return '<span class="badge tag">' + esc(t.name) + '</span>';
      }).join(' ');
      var pending = /REPLACE_ME/i.test(it.shareUrl || '');

      return '<tr data-id="' + it.id + '" class="' + (resState.selected[it.id] ? 'selected' : '') + '">' +
        '<td><input type="checkbox" class="rowCheck" data-id="' + it.id + '"' + (resState.selected[it.id] ? ' checked' : '') + ' style="accent-color:var(--accent)"></td>' +
        '<td><div class="cell-name">' + thumb +
          '<div class="nm"><b title="' + esc(it.name) + '">' + esc(it.name) + '</b>' +
          '<span>' + (pending ? '<em class="warn-inline">链接待替换</em>' : '') + (tags || esc(it.summary || '暂无简介')) + '</span></div>' +
        '</div></td>' +
        '<td class="nowrap"><span class="badge tag">' + esc(it.category) + '</span></td>' +
        '<td class="nowrap" style="font-family:var(--mono);font-size:12px">' + esc(ext) + '</td>' +
        '<td class="nowrap" style="font-size:12.5px;color:var(--muted)">' + esc(it.size) + '</td>' +
        '<td class="nowrap" style="font-size:12.5px;color:var(--muted)">' + esc(it.date) + '</td>' +
        '<td class="num">' + fmtNum(it.downloads) + '</td>' +
        '<td><label class="switch"><input type="checkbox" data-toggle="' + it.id + '"' + (it.enabled ? ' checked' : '') + '><span class="slider"></span></label></td>' +
        '<td class="num" style="color:var(--muted)">' + it.sortOrder + '</td>' +
        '<td><button class="btn btn-icon btn-ghost" data-menu="' + it.id + '" aria-label="更多操作">⋯</button></td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="10">' + emptyBlock(resState.q || resState.cats.length ? '没有匹配的资料' : '还没有资料', resState.q || resState.cats.length ? '换个关键词或清空筛选试试' : '点右上角「新增资料」开始', '🔍') + '</td></tr>') +
    '</tbody>';

  var countEl = $('#resCount', box);
  if (countEl) countEl.textContent = '显示 ' + total + ' / ' + resState.items.length + ' 份';

  pager.innerHTML = pagerHtml(total, resState.page, resState.pageSize);
  bindPager(pager, function (p) { resState.page = p; renderResTable(box); },
    function (size) { resState.pageSize = size; resState.page = 1; renderResTable(box); });

  bindResTable(box);
  renderBatchBar(box);
}

function bindResTable(box) {
  $$('[data-sort]', box).forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (resState.sort === key) resState.dir = resState.dir === 'asc' ? 'desc' : 'asc';
      else { resState.sort = key; resState.dir = key === 'name' ? 'asc' : 'desc'; }
      renderResTable(box);
    });
  });

  var all = $('#checkAll', box);
  if (all) {
    all.addEventListener('change', function () {
      var list = resFiltered();
      var start = (resState.page - 1) * resState.pageSize;
      var rows = list.slice(start, start + resState.pageSize);
      if (all.checked) rows.forEach(function (it) { resState.selected[it.id] = true; });
      else rows.forEach(function (it) { delete resState.selected[it.id]; });
      renderResTable(box);
    });
  }

  $$('.rowCheck', box).forEach(function (cb) {
    cb.addEventListener('change', function () {
      var id = cb.getAttribute('data-id');
      if (cb.checked) resState.selected[id] = true;
      else delete resState.selected[id];
      renderResTable(box);
    });
  });

  $$('[data-toggle]', box).forEach(function (cb) {
    cb.addEventListener('change', async function () {
      var id = Number(cb.getAttribute('data-toggle'));
      var item = resState.items.find(function (x) { return x.id === id; });
      if (!item) return;
      cb.disabled = true;
      try {
        var res = await req('/api/admin/resources/' + id, { method: 'PUT', body: { enabled: cb.checked } });
        item.enabled = cb.checked;
        toast(cb.checked ? '已启用' : '已禁用', 'ok');
        if (!cb.checked && item.enabled) { /* noop */ }
        void res;
      } catch (err) {
        cb.checked = !cb.checked;
        toast(err.message, 'err');
      } finally {
        cb.disabled = false;
      }
    });
  });

  /* 点名字直接进编辑（手机上没有 hover，比找 ⋯ 快） */
  $$('.nm', box).forEach(function (cell) {
    cell.style.cursor = 'pointer';
    cell.addEventListener('click', function () {
      var tr = cell.closest('tr');
      var id = Number(tr && tr.getAttribute('data-id'));
      var item = resState.items.find(function (x) { return x.id === id; });
      if (item) openResourceForm(item);
    });
  });

  $$('[data-menu]', box).forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var id = Number(btn.getAttribute('data-menu'));
      var item = resState.items.find(function (x) { return x.id === id; });
      if (!item) return;
      openMenu(btn, [
        { label: '编辑', icon: '✎', onClick: function () { openResourceForm(item); } },
        { label: '复制一份', icon: '⧉', onClick: function () { duplicateResource(item); } },
        { label: '查看前台', icon: '↗', onClick: function () { window.open(SITE_HOME + '/#r' + item.id, '_blank', 'noopener'); } },
        '-',
        { label: '删除', icon: '🗑', danger: true, onClick: function () { deleteResource(item); } }
      ]);
    });
  });
}

function renderBatchBar(box) {
  var ids = Object.keys(resState.selected).filter(function (k) { return resState.selected[k]; });
  var bar = $('#batchBar', box);
  if (!bar) return;

  if (!ids.length) {
    bar.innerHTML = '';
    return;
  }

  bar.innerHTML = '<div class="row tight" style="padding:9px 14px;background:rgba(124,140,255,.07);border-bottom:1px solid var(--border-soft)">' +
    '<span style="font-size:12.5px;color:#c3cbff">已选 <b>' + ids.length + '</b> 项</span>' +
    '<button class="btn btn-sm" data-batch="enable">批量启用</button>' +
    '<button class="btn btn-sm" data-batch="disable">批量禁用</button>' +
    '<button class="btn btn-sm btn-danger" data-batch="delete">批量删除</button>' +
    '<button class="btn btn-sm btn-ghost" id="batchClear">取消选择</button>' +
  '</div>';

  $$('[data-batch]', bar).forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var action = btn.getAttribute('data-batch');
      var list = ids.map(Number);
      var label = action === 'delete' ? '删除' : action === 'enable' ? '启用' : '禁用';

      var yes = await confirmDialog({
        title: '批量' + label,
        message: '确定要' + label + '选中的 <b>' + list.length + '</b> 份资料吗？' + (action === 'delete' ? '删除后无法恢复。' : ''),
        danger: action === 'delete',
        okText: '确定' + label
      });
      if (!yes) return;

      btn.disabled = true;
      try {
        await req('/api/admin/resources/batch', { method: 'POST', body: { action: action, ids: list } });
        toast('已' + label + ' ' + list.length + ' 项', 'ok');
        resState.selected = {};
        await loadResourceData();
        renderResTable(box);
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });
  });

  $('#batchClear', bar).addEventListener('click', function () {
    resState.selected = {};
    renderResTable(box);
  });
}

function bindResToolbar(box) {
  var search = $('#resSearch', box);
  var timer = null;
  search.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      resState.q = search.value;
      resState.page = 1;
      renderResTable(box);
    }, 140);
  });

  $('#resReset', box).addEventListener('click', function () {
    resState.q = '';
    resState.cats = [];
    resState.page = 1;
    resState.selected = {};
    search.value = '';
    renderCatPanel(box);
    renderResTable(box);
  });

  $('#resAdd', box).addEventListener('click', function () { openResourceForm(null); });

  var dd = $('#catDd', box);
  var panel = $('#catPanel', box);
  var btn = $('#catBtn', box);

  function paintBtn() {
    btn.textContent = resState.cats.length ? '分类：已选 ' + resState.cats.length + ' 个 ▾' : '分类：全部 ▾';
  }

  renderCatPanel(box);
  paintBtn();

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });

  document.addEventListener('click', function (e) {
    if (!dd.contains(e.target)) panel.hidden = true;
  });

  panel.addEventListener('change', function () {
    resState.cats = $$('input:checked', panel).map(function (cb) { return cb.value; });
    resState.page = 1;
    paintBtn();
    renderResTable(box);
  });

  function renderCatPanel(root) {
    var p = $('#catPanel', root);
    if (!p) return;
    var names = state.categories.length
      ? state.categories.map(function (c) { return c.name; })
      : Array.from(new Set(resState.items.map(function (i) { return i.category; })));
    p.innerHTML = names.length
      ? names.map(function (name) {
          return '<label><input type="checkbox" value="' + esc(name) + '"' +
            (resState.cats.indexOf(name) !== -1 ? ' checked' : '') + '> ' + esc(name) + '</label>';
        }).join('')
      : '<div style="padding:8px;color:var(--dim);font-size:12.5px">还没有分类</div>';
  }
  renderCatPanel(box);
}

async function duplicateResource(item) {
  try {
    await req('/api/admin/resources/' + item.id + '/duplicate', { method: 'POST' });
    toast('已复制一份，记得改名字和链接', 'ok');
    await loadResourceData();
    var box = $('#view');
    renderResTable(box);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteResource(item) {
  var yes = await confirmDialog({
    title: '删除资料',
    message: '确定删除「<b>' + esc(item.name) + '</b>」吗？',
    detail: '删除后不可恢复，下载记录会保留但不再关联。',
    danger: true,
    okText: '删除'
  });
  if (!yes) return;

  try {
    await req('/api/admin/resources/' + item.id, { method: 'DELETE' });
    toast('已删除', 'ok');
    delete resState.selected[item.id];
    await loadResourceData();
    renderResTable($('#view'));
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ==========================================================================
   二、资料表单
   ========================================================================== */

/** 极简 Markdown → HTML，只用于预览，输出前已全部转义 */
function mdToHtml(text) {
  var src = String(text == null ? '' : text);
  var lines = src.split('\n');
  var out = [];
  var listOpen = false;
  var inCode = false;
  var codeBuf = [];

  function inline(s) {
    var t = esc(s);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$1</a>');
    return t;
  }

  function closeList() {
    if (listOpen) { out.push('</ul>'); listOpen = false; }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^```/.test(line)) {
      if (inCode) {
        out.push('<pre>' + esc(codeBuf.join('\n')) + '</pre>');
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (/^\s*$/.test(line)) { closeList(); continue; }

    var h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      var level = Math.min(3, h[1].length);
      out.push('<h' + level + '>' + inline(h[2]) + '</h' + level + '>');
      continue;
    }

    var li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!listOpen) { out.push('<ul>'); listOpen = true; }
      out.push('<li>' + inline(li[1]) + '</li>');
      continue;
    }

    closeList();
    out.push('<p>' + inline(line) + '</p>');
  }

  if (inCode && codeBuf.length) out.push('<pre>' + esc(codeBuf.join('\n')) + '</pre>');
  closeList();
  return out.join('') || '<span style="color:var(--dim)">（无内容）</span>';
}

function openResourceForm(item) {
  var isEdit = !!item;
  var draft = item ? JSON.parse(JSON.stringify(item)) : {
    name: '', category: (state.categories[0] && state.categories[0].name) || '文档',
    fileType: '', size: '', date: todayInput(), shareUrl: '', summary: '',
    coverUrl: '', enabled: true, sortOrder: 0, tags: []
  };

  var catOptions = state.categories.map(function (c) {
    return '<option value="' + esc(c.name) + '"' + (c.name === draft.category ? ' selected' : '') + '>' + esc(c.icon) + ' ' + esc(c.name) + '</option>';
  }).join('');

  var body =
    '<div class="form-grid">' +
      '<div class="field full">' +
        '<label class="label" for="fName">名称 <span style="color:var(--danger)">*</span></label>' +
        '<input class="input" id="fName" maxlength="120" placeholder="前端性能优化清单.md" value="' + esc(draft.name) + '">' +
        '<div class="err" id="eName"></div>' +
      '</div>' +
      '<div class="field">' +
        '<label class="label" for="fCategory">分类 <span style="color:var(--danger)">*</span></label>' +
        '<select class="select" id="fCategory">' + (catOptions || '<option value="">请先创建分类</option>') + '</select>' +
        '<div class="err" id="eCategory"></div>' +
      '</div>' +
      '<div class="field">' +
        '<label class="label" for="fFileType">文件类型</label>' +
        '<input class="input" id="fFileType" maxlength="10" placeholder="留空自动从名称推断" value="' + esc(draft.fileType) + '">' +
        '<div class="err" id="eFileType"></div>' +
      '</div>' +
      '<div class="field">' +
        '<label class="label" for="fSize">大小</label>' +
        '<input class="input" id="fSize" placeholder="47.1 KB" value="' + esc(draft.size) + '">' +
        '<div class="hint">支持 12 KB / 1.5 MB / 2048，或填 —</div>' +
        '<div class="err" id="eSize"></div>' +
      '</div>' +
      '<div class="field">' +
        '<label class="label" for="fDate">更新日期</label>' +
        '<input class="input" type="date" id="fDate" value="' + esc(draft.date) + '">' +
        '<div class="err" id="eDate"></div>' +
      '</div>' +
      '<div class="field full">' +
        '<label class="label" for="fShare">网盘分享链接 <span style="color:var(--danger)">*</span></label>' +
        '<input class="input" id="fShare" placeholder="https://share.weiyun.com/…" value="' + esc(draft.shareUrl) + '">' +
        '<div class="err" id="eShare"></div>' +
      '</div>' +
      '<div class="field full">' +
        '<div class="row tight" style="margin-bottom:6px">' +
          '<label class="label" style="margin:0" for="fSummary">简介（支持简易 Markdown）</label>' +
          '<div class="spacer" style="margin-left:auto"></div>' +
          '<button class="btn btn-sm btn-ghost" type="button" id="mdToggle">预览</button>' +
        '</div>' +
        '<textarea class="textarea" id="fSummary" maxlength="2000" placeholder="一句话说明它能解决什么问题">' + esc(draft.summary) + '</textarea>' +
        '<div class="md-preview" id="mdPreview" hidden></div>' +
      '</div>' +
      '<div class="field full">' +
        '<label class="label">标签（回车添加，最多 12 个）</label>' +
        '<div class="tag-input" id="tagBox">' +
          '<input id="tagInput" placeholder="输入后按回车">' +
        '</div>' +
      '</div>' +
      '<div class="field full">' +
        '<label class="label" for="fCover">封面图 URL（可选）</label>' +
        '<input class="input" id="fCover" placeholder="https://…/cover.png" value="' + esc(draft.coverUrl) + '">' +
        '<div class="err" id="eCover"></div>' +
      '</div>' +
      '<div class="field">' +
        '<label class="label" for="fSort">排序权重（越大越靠前）</label>' +
        '<input class="input" type="number" id="fSort" value="' + Number(draft.sortOrder) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label class="label">状态</label>' +
        '<label class="check" style="height:36px"><input type="checkbox" id="fEnabled"' + (draft.enabled ? ' checked' : '') + '> 启用（前台可见）</label>' +
      '</div>' +
    '</div>';

  var footer = '<div class="spacer"></div>' +
    (isEdit ? '' : '<button class="btn" type="button" id="saveNext">保存并继续新增</button>') +
    '<button class="btn" type="button" data-close>取消</button>' +
    '<button class="btn btn-primary" type="button" id="saveOne">' + (isEdit ? '保存修改' : '保存') + '</button>';

  /* 注意：tags 必须在 openModal 之前初始化 —— openModal 会同步调用 onMount */
  var tags = (draft.tags || []).map(function (t) { return typeof t === 'object' ? t.name : t; }).filter(Boolean);

  var mask = openModal({
    title: isEdit ? '编辑资料' : '新增资料',
    size: 'wide',
    body: body,
    footer: footer,
    onMount: mountForm
  });

  function mountForm(root) {
    var tagBox = $('#tagBox', root);
    var tagInput = $('#tagInput', root);

    function paintTags() {
      $$('.tag-chip', tagBox).forEach(function (n) { n.remove(); });
      tags.forEach(function (name, idx) {
        var chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.innerHTML = '<span>' + esc(name) + '</span><button type="button" aria-label="移除">×</button>';
        chip.querySelector('button').addEventListener('click', function () {
          tags.splice(idx, 1);
          paintTags();
        });
        tagBox.insertBefore(chip, tagInput);
      });
    }

    function addTag(raw) {
      var name = String(raw || '').trim().replace(/^#/, '').slice(0, 20);
      if (!name) return;
      if (tags.indexOf(name) !== -1) return;
      if (tags.length >= 12) { toast('最多 12 个标签', 'err'); return; }
      tags.push(name);
      paintTags();
    }

    tagInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
        e.preventDefault();
        addTag(tagInput.value);
        tagInput.value = '';
      } else if (e.key === 'Backspace' && !tagInput.value && tags.length) {
        tags.pop();
        paintTags();
      }
    });
    tagInput.addEventListener('blur', function () {
      if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; }
    });
    paintTags();

    /* 名称 → 文件类型自动推断 */
    var nameInput = $('#fName', root);
    var typeInput = $('#fFileType', root);
    nameInput.addEventListener('input', function () {
      if (typeInput.dataset.touched) return;
      var m = nameInput.value.match(/\.([a-zA-Z0-9]{1,10})$/);
      if (m) typeInput.value = m[1].toUpperCase();
    });
    typeInput.addEventListener('input', function () { typeInput.dataset.touched = '1'; });

    /* Markdown 预览 */
    var mdBtn = $('#mdToggle', root);
    var preview = $('#mdPreview', root);
    var summary = $('#fSummary', root);
    mdBtn.addEventListener('click', function () {
      var show = preview.hidden;
      preview.hidden = !show;
      summary.hidden = show;
      mdBtn.textContent = show ? '编辑' : '预览';
      if (show) preview.innerHTML = mdToHtml(summary.value);
    });
    summary.addEventListener('input', function () {
      if (!preview.hidden) preview.innerHTML = mdToHtml(summary.value);
    });

    /* 实时校验 */
    var silent = true;
    function validate(showErrors) {
      var errors = {};
      var v = collect();

      if (!v.name) errors.eName = '名称不能为空';
      else if (v.name.length > 120) errors.eName = '名称最多 120 个字符';

      if (!v.category) errors.eCategory = '请选择分类';

      var ext = (v.fileType || (v.name.match(/\.([a-zA-Z0-9]{1,10})$/) || [])[1] || '').toUpperCase();
      if (ext && !/^[A-Z0-9]{1,10}$/.test(ext)) errors.eFileType = '只能是 1–10 位字母或数字';

      if (v.size && !/^(\d+(?:\.\d+)?\s?(?:B|KB|MB|GB|TB)|\d+|—|-)$/i.test(v.size)) {
        errors.eSize = '格式不对，例：12 KB、1.5 MB、2048';
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) errors.eDate = '请选择日期';

      if (!v.shareUrl) errors.eShare = '请填写网盘分享链接';
      else {
        try {
          var u = new URL(v.shareUrl);
          if (!/^https?:$/.test(u.protocol)) throw new Error('bad');
        } catch (_) {
          errors.eShare = '必须是合法的 http(s) 链接';
        }
      }

      if (v.coverUrl) {
        try {
          var c = new URL(v.coverUrl);
          if (!/^https?:$/.test(c.protocol)) throw new Error('bad');
        } catch (_) {
          errors.eCover = '必须是 http(s) 开头的图片地址';
        }
      }

      ['eName', 'eCategory', 'eFileType', 'eSize', 'eDate', 'eShare', 'eCover'].forEach(function (k) {
        var el = document.getElementById(k);
        if (el) el.textContent = showErrors || !silent ? (errors[k] || '') : '';
      });

      return Object.keys(errors).length ? { ok: false, errors: errors } : { ok: true, value: v };
    }

    function collect() {
      return {
        name: $('#fName', root).value.trim(),
        category: $('#fCategory', root).value,
        fileType: $('#fFileType', root).value.trim(),
        size: $('#fSize', root).value.trim(),
        date: $('#fDate', root).value,
        shareUrl: $('#fShare', root).value.trim(),
        summary: $('#fSummary', root).value.trim(),
        coverUrl: $('#fCover', root).value.trim(),
        sortOrder: Number($('#fSort', root).value) || 0,
        enabled: $('#fEnabled', root).checked,
        tags: tags.slice()
      };
    }

    root.addEventListener('input', function () {
      silent = false;
      validate(false);
    });

    $('#fName', root).addEventListener('blur', function () {
      if (!$('#fName', root).value.trim()) $('#eName', root).textContent = '名称不能为空';
    });

    var saving = false;

    async function save(keepOpen) {
      /* 防重复提交：确认框弹出前就上锁，双击也只发一次请求 */
      if (saving) return;
      saving = true;

      var checked = validate(true);
      if (!checked.ok) {
        saving = false;
        var first = Object.keys(checked.errors)[0];
        var el = document.getElementById(first);
        if (el && el.previousElementSibling) el.previousElementSibling.focus();
        toast('还有 ' + Object.keys(checked.errors).length + ' 处需要修正', 'err');
        return;
      }

      var yes = await confirmDialog({
        title: isEdit ? '保存修改' : '新增资料',
        message: '确定' + (isEdit ? '保存对「<b>' + esc(checked.value.name) + '</b>」的修改吗？' : '新增「<b>' + esc(checked.value.name) + '</b>」吗？'),
        okText: '保存'
      });
      if (!yes) { saving = false; return; }

      var btn = $('#saveOne', mask);
      btn.disabled = true;
      var oldText = btn.textContent;
      btn.textContent = '保存中…';

      try {
        if (isEdit) await req('/api/admin/resources/' + item.id, { method: 'PUT', body: checked.value });
        else await req('/api/admin/resources', { method: 'POST', body: checked.value });

        toast(isEdit ? '已保存' : '已新增', 'ok');
        await loadResourceData();

        saving = false;
        if (keepOpen) {
          closeModal();
          openResourceForm(null);
          return;
        }
        closeModal();
        renderResTable($('#view'));
      } catch (err) {
        saving = false;
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }

    $('#saveOne', mask).addEventListener('click', function () { save(false); });
    var next = $('#saveNext', mask);
    if (next) next.addEventListener('click', function () { save(true); });
  }
}

/* ==========================================================================
   三、分类管理
   ========================================================================== */

Views.categories = async function (box) {
  box.innerHTML = '<div class="panel"><div class="panel-head"><h2>分类管理</h2></div>' + skeletonRows(4) + '</div>';

  var cats = await req('/api/admin/categories');
  state.categories = cats;

  box.innerHTML =
    '<div class="panel">' +
      '<div class="panel-head">' +
        '<h2>新增分类</h2>' +
        '<div class="spacer"></div>' +
      '</div>' +
      '<div class="panel-body">' +
        '<div class="row tight">' +
          '<input class="input" id="newCatIcon" placeholder="图标" maxlength="4" style="width:70px;text-align:center" value="📁">' +
          '<input class="input" id="newCatName" placeholder="分类名，如 文档" maxlength="24" style="width:180px">' +
          '<input class="input" id="newCatSort" type="number" placeholder="排序" style="width:90px" value="0">' +
          '<button class="btn btn-primary" id="addCatBtn">添加分类</button>' +
          '<span class="hint">排序数值越大越靠前</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>全部分类</h2><div class="spacer"></div><span class="sub" id="catCount"></span></div>' +
      '<div class="table-wrap"><table class="table" style="min-width:560px"><thead><tr>' +
        '<th style="width:60px">图标</th><th>名称</th><th>资料数</th><th>排序</th><th style="width:150px"></th>' +
      '</tr></thead><tbody id="catRows"></tbody></table></div>' +
    '</div>';

  function paint() {
    $('#catCount', box).textContent = cats.length + ' 个分类';
    $('#catRows', box).innerHTML = cats.length ? cats.map(function (c) {
      return '<tr data-cat="' + c.id + '">' +
        '<td style="font-size:17px">' + esc(c.icon) + '</td>' +
        '<td><b>' + esc(c.name) + '</b></td>' +
        '<td>' + (c.count ? '<span class="badge tag">' + c.count + ' 份</span>' : '<span style="color:var(--dim)">—</span>') + '</td>' +
        '<td style="color:var(--muted)">' + c.sortOrder + '</td>' +
        '<td class="nowrap"><button class="btn btn-sm" data-edit="' + c.id + '">编辑</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="' + c.id + '">删除</button></td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="5">' + emptyBlock('还没有分类', '先建一个分类再上传资料', '🗂') + '</td></tr>';

    $$('[data-edit]', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-edit'));
        openCategoryForm(cats.find(function (c) { return c.id === id; }), paint);
      });
    });

    $$('[data-del]', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-del'));
        var cat = cats.find(function (c) { return c.id === id; });
        if (!cat) return;
        if (cat.count > 0) {
          toast('「' + cat.name + '」还有 ' + cat.count + ' 份资料，请先迁移', 'err');
          return;
        }
        confirmDialog({
          title: '删除分类',
          message: '确定删除分类「<b>' + esc(cat.name) + '</b>」吗？',
          danger: true,
          okText: '删除'
        }).then(async function (yes) {
          if (!yes) return;
          try {
            await req('/api/admin/categories/' + id, { method: 'DELETE' });
            toast('已删除', 'ok');
            cats = await req('/api/admin/categories');
            state.categories = cats;
            paint();
          } catch (err) { toast(err.message, 'err'); }
        });
      });
    });
  }

  $('#addCatBtn', box).addEventListener('click', async function () {
    var name = $('#newCatName', box).value.trim();
    var icon = $('#newCatIcon', box).value.trim() || '📁';
    var sortOrder = Number($('#newCatSort', box).value) || 0;
    if (!name) { toast('分类名不能为空', 'err'); return; }
    try {
      await req('/api/admin/categories', { method: 'POST', body: { name: name, icon: icon, sortOrder: sortOrder } });
      toast('已新增分类', 'ok');
      $('#newCatName', box).value = '';
      cats = await req('/api/admin/categories');
      state.categories = cats;
      paint();
    } catch (err) { toast(err.message, 'err'); }
  });

  paint();
};

function openCategoryForm(cat, done) {
  if (!cat) return;
  var mask = openModal({
    title: '编辑分类',
    size: 'narrow',
    body:
      '<div class="field"><label class="label" for="cIcon">图标</label>' +
        '<input class="input" id="cIcon" maxlength="4" value="' + esc(cat.icon) + '"></div>' +
      '<div class="field" style="margin-top:10px"><label class="label" for="cName">名称</label>' +
        '<input class="input" id="cName" maxlength="24" value="' + esc(cat.name) + '"></div>' +
      '<div class="field" style="margin-top:10px"><label class="label" for="cSort">排序权重</label>' +
        '<input class="input" type="number" id="cSort" value="' + cat.sortOrder + '"></div>' +
      '<div class="hint">改名会同步更新已有资料上的分类</div>',
    footer: '<div class="spacer"></div><button class="btn" data-close>取消</button>' +
      '<button class="btn btn-primary" id="cSave">保存</button>'
  });

  $('#cSave', mask).addEventListener('click', async function () {
    var name = $('#cName', mask).value.trim();
    if (!name) { toast('名称不能为空', 'err'); return; }
    try {
      await req('/api/admin/categories/' + cat.id, {
        method: 'PUT',
        body: { name: name, icon: $('#cIcon', mask).value.trim() || '📁', sortOrder: Number($('#cSort', mask).value) || 0 }
      });
      toast('已保存', 'ok');
      closeModal();
      done();
    } catch (err) { toast(err.message, 'err'); }
  });
}

/* ==========================================================================
   四、标签管理
   ========================================================================== */

Views.tags = async function (box) {
  box.innerHTML = '<div class="panel"><div class="panel-head"><h2>标签管理</h2></div>' + skeletonRows(4) + '</div>';

  var tags = await req('/api/admin/tags');
  state.tags = tags;

  var max = Math.max.apply(null, tags.map(function (t) { return t.count; }).concat([1]));

  box.innerHTML =
    '<div class="panel">' +
      '<div class="panel-head"><h2>标签云</h2><div class="spacer"></div><span class="sub">' + tags.length + ' 个标签</span></div>' +
      '<div class="panel-body">' +
        (tags.length ? '<div class="row tight">' + tags.map(function (t) {
          var size = 12 + Math.round((t.count / max) * 5);
          return '<span class="badge tag" style="font-size:' + size + 'px;padding:3px 10px">' + esc(t.name) +
            ' <span style="opacity:.6">' + t.count + '</span></span>';
        }).join('') + '</div>'
        : emptyBlock('还没有标签', '在资料表单里输入标签并回车即可创建', '🏷')) +
      '</div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2>全部标签</h2><div class="spacer"></div>' +
        '<button class="btn btn-sm" id="mergeTagBtn">合并标签</button></div>' +
      '<div class="table-wrap"><table class="table" style="min-width:520px"><thead><tr>' +
        '<th>标签</th><th>资料数</th><th style="width:200px"></th></tr></thead><tbody>' +
        (tags.length ? tags.map(function (t) {
          return '<tr><td><b>' + esc(t.name) + '</b></td><td>' + t.count + '</td>' +
            '<td class="nowrap"><button class="btn btn-sm" data-rename="' + t.id + '">重命名</button> ' +
            '<button class="btn btn-sm btn-danger" data-remove="' + t.id + '">删除</button></td></tr>';
        }).join('') : '<tr><td colspan="3">' + emptyBlock('暂无标签') + '</td></tr>') +
      '</tbody></table></div>' +
    '</div>';

  function refresh() {
    Views.tags(box);
  }

  $$('[data-rename]', box).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = Number(btn.getAttribute('data-rename'));
      var tag = tags.find(function (t) { return t.id === id; });
      if (!tag) return;
      var mask = openModal({
        title: '重命名标签',
        size: 'narrow',
        body: '<div class="field"><label class="label" for="tagName">新名称</label>' +
          '<input class="input" id="tagName" maxlength="20" value="' + esc(tag.name) + '"></div>' +
          '<div class="hint">如果新名称已存在，请改用「合并标签」</div>',
        footer: '<div class="spacer"></div><button class="btn" data-close>取消</button>' +
          '<button class="btn btn-primary" id="tagSave">保存</button>'
      });
      $('#tagSave', mask).addEventListener('click', async function () {
        try {
          await req('/api/admin/tags/' + tag.id, { method: 'PUT', body: { name: $('#tagName', mask).value.trim() } });
          toast('已重命名', 'ok');
          closeModal();
          refresh();
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  });

  $$('[data-remove]', box).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = Number(btn.getAttribute('data-remove'));
      var tag = tags.find(function (t) { return t.id === id; });
      if (!tag) return;
      confirmDialog({
        title: '删除标签',
        message: '确定删除标签「<b>' + esc(tag.name) + '</b>」吗？',
        detail: tag.count ? '这会让 ' + tag.count + ' 份资料失去该标签，资料本身不受影响。' : '',
        danger: true,
        okText: '删除'
      }).then(async function (yes) {
        if (!yes) return;
        try {
          await req('/api/admin/tags/' + tag.id, { method: 'DELETE' });
          toast('已删除', 'ok');
          refresh();
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  });

  $('#mergeTagBtn', box).addEventListener('click', function () {
    if (tags.length < 2) { toast('至少需要两个标签才能合并', 'err'); return; }
    var opts = tags.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '（' + t.count + '）</option>'; }).join('');
    var mask = openModal({
      title: '合并标签',
      size: 'narrow',
      body:
        '<div class="field"><label class="label" for="mFrom">把哪个标签</label><select class="select" id="mFrom">' + opts + '</select></div>' +
        '<div class="field" style="margin-top:10px"><label class="label" for="mTo">合并到</label><select class="select" id="mTo">' + opts + '</select></div>' +
        '<div class="hint">合并后原标签会被删除，关联关系转到目标标签</div>',
      footer: '<div class="spacer"></div><button class="btn" data-close>取消</button>' +
        '<button class="btn btn-primary" id="mGo">合并</button>'
    });
    $('#mTo', mask).selectedIndex = Math.min(1, tags.length - 1);
    $('#mGo', mask).addEventListener('click', async function () {
      var fromId = Number($('#mFrom', mask).value);
      var toId = Number($('#mTo', mask).value);
      if (fromId === toId) { toast('请选择两个不同的标签', 'err'); return; }
      try {
        var data = await req('/api/admin/tags/merge', { method: 'POST', body: { fromId: fromId, toId: toId } });
        toast(data && data.message ? data.message : '已合并', 'ok');
        closeModal();
        refresh();
      } catch (err) { toast(err.message, 'err'); }
    });
  });
};
