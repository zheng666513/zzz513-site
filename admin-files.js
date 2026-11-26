/**
 * admin-files.js —— 后台「文件库」
 * ===========================================================================
 * 能力：拖拽 / 点击 / 粘贴上传，队列并发 3，直传 + 分片，进度与失败重试，
 *       图片与视频自动生成缩略图，网格 / 列表切换，灯箱预览、删除。
 * 依赖：admin.js 里的 $ $$ esc toast req confirmDialog openModal closeModal
 * ===========================================================================
 */

(function () {
  'use strict';

  var DIRECT_LIMIT = 20 * 1024 * 1024; // 超过这个大小走分片
  var PART_SIZE = 5 * 1024 * 1024;
  var MAX_LIMIT = 200 * 1024 * 1024;
  var CONCURRENCY = 3;

  var queue = [];
  var running = 0;
  var seq = 0;

  var st = {
    page: 1,
    pageSize: 40,
    kind: '',
    q: '',
    view: 'grid',
    items: [],
    total: 0,
    bytes: 0,
    uploading: false
  };

  var KINDS = [
    { k: '', name: '全部类型' },
    { k: 'image', name: '图片' },
    { k: 'video', name: '视频' },
    { k: 'doc', name: '文档' },
    { k: 'other', name: '其他' }
  ];

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function fmtTime(ms) {
    if (!ms) return '—';
    var d = new Date(Number(ms));
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** 用扩展名代替图标：干净，而且不会因为缺字体变成方框 */
  function iconOf(name) {
    var m = String(name || '').match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toUpperCase() : 'FILE';
  }

  /* ======================================================================
     一、上传队列
     ====================================================================== */

  function addFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;

    var rejected = 0;
    list.forEach(function (file) {
      if (file.size > MAX_LIMIT) { rejected += 1; return; }
      queue.push({
        id: ++seq,
        file: file,
        name: file.name || ('粘贴图片-' + Date.now() + '.png'),
        size: file.size,
        status: 'waiting',
        percent: 0,
        speed: 0,
        error: '',
        key: '',
        startedAt: 0
      });
    });

    if (rejected) toast(rejected + ' 个文件超过 200 MB，已跳过', 'err');
    renderQueue();
    pump();
  }

  function pump() {
    while (running < CONCURRENCY) {
      var next = queue.filter(function (t) { return t.status === 'waiting'; })[0];
      if (!next) break;
      running += 1;
      next.status = 'uploading';
      next.startedAt = Date.now();
      uploadOne(next)
        .then(function () {
          next.status = 'done';
          next.percent = 100;
        })
        .catch(function (err) {
          next.status = 'error';
          next.error = err && err.message ? err.message : '上传失败';
        })
        .then(function () {
          running -= 1;
          renderQueue();
          if (next.status === 'done') refresh(true);
          pump();
        });
    }
    renderQueue();
    if (queue.some(function (t) { return t.status === 'uploading' || t.status === 'waiting'; })) ensureTicker();
  }

  async function uploadOne(item) {
    var file = item.file;
    var upload = file;

    // 大图先压缩，省流量也更快
    if (/^image\/(jpeg|png)$/.test(file.type) && file.size > 512 * 1024) {
      var blob = await compressImage(file).catch(function () { return null; });
      if (blob && blob.size < file.size) {
        upload = blob;
        item.name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      }
    }

    var data;
    if (upload.size <= DIRECT_LIMIT) {
      data = await uploadDirect(item, upload);
    } else {
      data = await uploadChunked(item, upload);
    }

    item.key = data.key;

    // 缩略图（失败不影响主流程）
    try {
      var thumb = await makeThumb(file);
      if (thumb) await req('/api/admin/upload/thumb', { method: 'POST', body: { key: data.key, dataUrl: thumb } });
    } catch (_) {
      /* 缩略图可选 */
    }

    return data;
  }

  function uploadDirect(item, blob) {
    var name = item.name;
    return xhr({
      url: API_BASE + '/api/admin/upload',
      method: 'POST',
      headers: {
        'x-file-name': encodeURIComponent(name),
        'x-file-type': blob.type || 'application/octet-stream'
      },
      body: blob,
      onProgress: function (loaded, total) { item.percent = loaded / total * 0.98; renderQueue(); }
    });
  }

  async function uploadChunked(item, blob) {
    var init = await req('/api/admin/upload/init', {
      method: 'POST',
      body: { name: item.name, size: blob.size, mime: blob.type || 'application/octet-stream' }
    });

    var partSize = init.partSize || PART_SIZE;
    var total = Math.ceil(blob.size / partSize);
    var parts = [];

    for (var i = 0; i < total; i += 1) {
      var start = i * partSize;
      var chunk = blob.slice(start, Math.min(start + partSize, blob.size));
      var res = await xhr({
        url: API_BASE + '/api/admin/upload/part?key=' + encodeURIComponent(init.key) +
             '&uploadId=' + encodeURIComponent(init.uploadId) + '&part=' + (i + 1),
        method: 'PUT',
        body: chunk,
        onProgress: function (loaded) {
          item.percent = (start + loaded) / blob.size * 0.98;
          renderQueue();
        }
      });
      parts.push(res);
    }

    return req('/api/admin/upload/complete', {
      method: 'POST',
      body: {
        key: init.key,
        uploadId: init.uploadId,
        parts: parts,
        name: item.name,
        size: blob.size,
        mime: blob.type || 'application/octet-stream'
      }
    });
  }

  /** 走 XHR 是为了拿到上传进度，fetch 不支持 */
  function xhr(opt) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(opt.method || 'POST', opt.url, true);
      x.withCredentials = true;
      /* 跨站时 cookie 可能被拒，令牌通道兜底（与 admin.js 的 req 一致） */
      var token = getToken();
      if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
      var headers = opt.headers || {};
      Object.keys(headers).forEach(function (k) { x.setRequestHeader(k, headers[k]); });

      if (opt.onProgress && x.upload) {
        x.upload.onprogress = function (e) {
          if (e.lengthComputable) opt.onProgress(e.loaded, e.total);
        };
      }

      x.onload = function () {
        var payload = null;
        try { payload = JSON.parse(x.responseText); } catch (_) { payload = null; }
        if (x.status === 401) { setToken(''); showLogin('登录已过期，请重新登录'); }
        if (x.status >= 200 && x.status < 300 && payload && payload.code === 0) {
          resolve(payload.data);
        } else {
          reject(new Error((payload && payload.message) || ('上传失败（HTTP ' + x.status + '）')));
        }
      };
      x.onerror = function () { reject(new Error('网络中断，请检查连接')); };
      x.onabort = function () { reject(new Error('已取消')); };
      x.send(opt.body);
    });
  }

  /* ---------- 图片压缩 / 缩略图 ---------- */

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  function drawTo(img, w, h, quality) {
    return new Promise(function (resolve) {
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/jpeg', quality);
    });
  }

  async function compressImage(file) {
    var img = await loadImage(file);
    var max = 1920;
    var ratio = Math.min(1, max / Math.max(img.width, img.height));
    var blob = await drawTo(img, Math.round(img.width * ratio), Math.round(img.height * ratio), 0.8);
    if (!blob) throw new Error('压缩失败');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('读取失败')); };
      r.readAsDataURL(blob);
    });
  }

  async function makeThumb(file) {
    if (/^image\//.test(file.type) && !/svg/.test(file.type)) {
      var img = await loadImage(file);
      var w = Math.min(400, img.width);
      var h = Math.round(img.height * (w / img.width));
      var blob = await drawTo(img, w, h, 0.75);
      return blob ? blobToDataUrl(blob) : '';
    }

    if (/^video\//.test(file.type)) {
      return videoThumb(file);
    }
    return '';
  }

  function videoThumb(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.src = url;

      var done = false;
      var finish = function (dataUrl) {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      };

      v.onloadeddata = function () {
        try { v.currentTime = Math.min(0.2, (v.duration || 1) / 3); } catch (_) { finish(''); }
      };
      v.onseeked = function () {
        var w = Math.min(400, v.videoWidth || 320);
        var h = Math.round((v.videoHeight || 180) * (w / (v.videoWidth || 320)));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(v, 0, 0, w, h);
        canvas.toBlob(function (blob) {
          if (!blob) return finish('');
          blobToDataUrl(blob).then(finish).catch(function () { finish(''); });
        }, 'image/jpeg', 0.75);
      };
      v.onerror = function () { finish(''); };
      setTimeout(function () { finish(''); }, 6000);
    });
  }

  /* ---------- 队列渲染 ---------- */

  /* 进度条靠 XHR 事件驱动，但回调偶尔比 DOM 重建晚一拍，
     这里用 600ms 的轮询兜底，保证「上传中 → 已完成」一定刷出来 */
  var ticker = null;
  function ensureTicker() {
    if (ticker) return;
    ticker = setInterval(function () {
      if (!document.getElementById('upQueue')) {
        clearInterval(ticker);
        ticker = null;
        return;
      }
      renderQueue();
      var busy = queue.some(function (t) { return t.status === 'uploading' || t.status === 'waiting'; });
      if (!busy) {
        clearInterval(ticker);
        ticker = null;
      }
    }, 600);
  }

  function renderQueue() {
    var box = document.getElementById('upQueue');
    if (!box) return;

    var active = queue.filter(function (t) { return t.status !== 'done'; });
    if (!queue.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;

    var html = '<div class="up-head"><b>上传队列</b><span class="sub">' +
      queue.filter(function (t) { return t.status === 'done'; }).length + '/' + queue.length + ' 完成</span>' +
      '<div class="spacer"></div>' +
      (active.length ? '<button class="btn btn-sm btn-ghost" id="upClearDone">隐藏已完成</button>' : '<button class="btn btn-sm btn-ghost" id="upClearAll">清空列表</button>') +
      '</div>';

    queue.slice().reverse().forEach(function (t) {
      var bar = Math.round(t.percent);
      var stateText = t.status === 'done' ? '已完成'
        : t.status === 'error' ? (t.error || '失败')
        : t.status === 'uploading' ? (bar < 20 ? '上传中…' : bar + '%')
        : '等待中';
      var cls = t.status === 'error' ? ' is-error' : t.status === 'done' ? ' is-done' : '';
      html += '<div class="up-item' + cls + '" data-uid="' + t.id + '">' +
        '<div class="up-ico">' + iconOf(t.file.name) + '</div>' +
        '<div class="up-main">' +
          '<div class="up-name">' + esc(t.name) + '</div>' +
          '<div class="up-bar"><i style="width:' + (t.status === 'done' ? 100 : bar) + '%"></i></div>' +
          '<div class="up-meta">' + fmtBytes(t.size) + ' · ' + esc(stateText) + '</div>' +
        '</div>' +
        (t.status === 'error' ? '<button class="btn btn-sm" data-retry="' + t.id + '">重试</button>' : '') +
        '<button class="btn btn-sm btn-ghost" data-remove="' + t.id + '">✕</button>' +
      '</div>';
    });

    box.innerHTML = html;

    var clearBtn = document.getElementById('upClearDone') || document.getElementById('upClearAll');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        queue = queue.filter(function (t) { return t.status === 'uploading' || t.status === 'waiting'; });
        renderQueue();
      });
    }

    Array.prototype.forEach.call(box.querySelectorAll('[data-retry]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-retry'));
        var t = queue.filter(function (x) { return x.id === id; })[0];
        if (!t) return;
        t.status = 'waiting';
        t.error = '';
        t.percent = 0;
        pump();
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-remove]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-remove'));
        queue = queue.filter(function (x) { return x.id !== id; });
        renderQueue();
      });
    });
  }

  /* ======================================================================
     二、列表与预览
     ====================================================================== */

  function renderList() {
    var box = document.getElementById('fileList');
    if (!box) return;

    if (!st.items.length) {
      box.innerHTML = '<div class="empty"><div><b>还没有文件</b></div>' +
        '<div style="font-size:12.5px;color:var(--dim)">拖一张图片进来试试，或点上面的上传按钮</div></div>';
      return;
    }

    if (st.view === 'list') {
      var rows = st.items.map(function (f, i) {
        return '<tr data-idx="' + i + '">' +
          '<td class="cell-name"><div class="nm inline"><span class="fico">' + iconOf(f.kind) + '</span>' +
          '<b>' + esc(f.name) + '</b></div></td>' +
          '<td>' + esc(f.mime || '—') + '</td>' +
          '<td class="num">' + fmtBytes(f.size) + '</td>' +
          '<td>' + fmtTime(f.createdAt) + '</td>' +
          '<td class="cell-act"><button class="btn btn-sm btn-primary" data-open="' + i + '">打开</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + i + '">删除</button></td>' +
        '</tr>';
      }).join('');
      box.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>文件名</th><th>类型</th><th>大小</th><th>上传时间</th><th style="width:150px">操作</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    } else {
      var cards = st.items.map(function (f, i) {
        var media = f.thumbUrl
          ? '<img src="' + esc(f.thumbUrl) + '" alt="" loading="lazy">'
          : f.kind === 'video'
            ? '<div class="ft-video"><span>视频</span></div>'
            : '<div class="ft-doc">' + iconOf(f.name) + '</div>';
        return '<figure class="fcard" data-idx="' + i + '">' +
          '<div class="fthumb">' + media + '</div>' +
          '<figcaption><b title="' + esc(f.name) + '">' + esc(f.name) + '</b>' +
          '<span>' + fmtBytes(f.size) + ' · ' + fmtTime(f.createdAt).slice(5, 10) + '</span></figcaption>' +
          '<div class="fops"><button class="btn btn-sm btn-primary" data-open="' + i + '">打开</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + i + '">删除</button></div>' +
        '</figure>';
      }).join('');
      box.innerHTML = '<div class="fgrid">' + cards + '</div>';
    }

    // 预览
    Array.prototype.forEach.call(box.querySelectorAll('[data-idx]'), function (el) {
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-open]') || ev.target.closest('[data-del]')) return;
        openLightbox(Number(el.getAttribute('data-idx')));
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-open]'), function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var f = st.items[Number(btn.getAttribute('data-open'))];
        if (!f) return;
        // 直接新标签页打开原文件，不再先复制链接
        window.open(f.url, '_blank', 'noopener');
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function (btn) {
      btn.addEventListener('click', async function () {
        var f = st.items[Number(btn.getAttribute('data-del'))];
        if (!f) return;
        var yes = await confirmDialog({
          title: '删除文件',
          message: '确定删除「<b>' + esc(f.name) + '</b>」吗？<br><span style="color:var(--dim)">R2 里的实体文件会一起删掉，无法恢复。</span>',
          okText: '删除'
        });
        if (!yes) return;
        try {
          await req('/api/admin/files?key=' + encodeURIComponent(f.key), { method: 'DELETE' });
          toast('已删除', 'ok');
          refresh(true);
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('链接已复制', 'ok'); })
        .catch(function () { toast('复制失败，请手动选择', 'err'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('链接已复制', 'ok');
    }
  }

  function openLightbox(index) {
    var f = st.items[index];
    if (!f) return;

    var mask = document.createElement('div');
    mask.className = 'lightbox';
    var inner = '';

    if (f.kind === 'image') {
      inner = '<img id="lbImg" src="' + esc(f.url) + '" alt="">';
    } else if (f.kind === 'video') {
      inner = '<video id="lbVideo" src="' + esc(f.url) + '" controls playsinline autoplay></video>';
    } else {
      inner = '<div class="lb-doc"><div class="big">' + iconOf(f.name) + '</div><b>' + esc(f.name) + '</b>' +
        '<div class="sub">' + fmtBytes(f.size) + ' · ' + esc(f.mime || '未知类型') + '</div></div>';
    }

    mask.innerHTML =
      '<div class="lb-bar">' +
        '<span class="lb-name">' + esc(f.name) + '</span>' +
        '<span class="lb-size">' + fmtBytes(f.size) + '</span>' +
        '<div class="spacer"></div>' +
        (f.kind === 'image' ? '<button class="btn btn-sm btn-ghost" data-zoom="-1">－</button><button class="btn btn-sm btn-ghost" data-zoom="1">＋</button><button class="btn btn-sm btn-ghost" data-rot="1">旋转</button>' : '') +
        '<button class="btn btn-sm btn-ghost" data-lb-copy="1">复制链接</button>' +
        '<a class="btn btn-sm btn-ghost" href="' + esc(f.url) + '" target="_blank" rel="noopener">打开</a>' +
        '<button class="btn btn-sm btn-ghost" data-close="1">✕</button>' +
      '</div>' +
      '<div class="lb-stage">' + inner + '</div>' +
      (st.items.length > 1 ? '<button class="lb-nav prev" data-step="-1">‹</button><button class="lb-nav next" data-step="1">›</button>' : '');

    document.body.appendChild(mask);
    document.body.style.overflow = 'hidden';

    var scale = 1;
    var rotate = 0;

    function apply() {
      var img = mask.querySelector('#lbImg');
      if (img) img.style.transform = 'scale(' + scale + ') rotate(' + rotate + 'deg)';
    }

    function close() {
      var v = mask.querySelector('video');
      if (v) { v.pause(); v.src = ''; }
      mask.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    }

    function step(dir) {
      var next = index + dir;
      if (next < 0 || next >= st.items.length) return;
      close();
      openLightbox(next);
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    }

    document.addEventListener('keydown', onKey);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    mask.querySelector('[data-close]').addEventListener('click', close);

    var lbCopy = mask.querySelector('[data-lb-copy]');
    if (lbCopy) lbCopy.addEventListener('click', function () { copyText(f.url); });

    var zoomIn = mask.querySelector('[data-zoom="1"]');
    var zoomOut = mask.querySelector('[data-zoom="-1"]');
    if (zoomIn) zoomIn.addEventListener('click', function () { scale = Math.min(4, scale + 0.25); apply(); });
    if (zoomOut) zoomOut.addEventListener('click', function () { scale = Math.max(0.25, scale - 0.25); apply(); });
    var rot = mask.querySelector('[data-rot]');
    if (rot) rot.addEventListener('click', function () { rotate = (rotate + 90) % 360; apply(); });

    Array.prototype.forEach.call(mask.querySelectorAll('[data-step]'), function (btn) {
      btn.addEventListener('click', function () { step(Number(btn.getAttribute('data-step'))); });
    });
  }

  /* ======================================================================
     三、页面
     ====================================================================== */

  async function refresh(showSkeleton) {
    var box = document.getElementById('fileList');
    if (box && showSkeleton) box.innerHTML = skeletonRows(3);

    try {
      var qs = '?page=' + st.page + '&pageSize=' + st.pageSize;
      if (st.kind) qs += '&kind=' + encodeURIComponent(st.kind);
      if (st.q) qs += '&q=' + encodeURIComponent(st.q);
      var data = await req('/api/admin/files' + qs);
      st.items = data.items || [];
      st.total = data.total || 0;
      st.bytes = data.bytes || 0;
      renderList();
      renderFoot();
    } catch (err) {
      if (box) box.innerHTML = emptyBlock('加载失败', err.message);
    }
  }

  function renderFoot() {
    var box = document.getElementById('fileFoot');
    if (!box) return;
    var pages = Math.max(1, Math.ceil(st.total / st.pageSize));
    box.innerHTML = '<span class="sub">共 <b>' + st.total + '</b> 个文件 · 占用 ' + fmtBytes(st.bytes) +
      ' · 第 ' + st.page + '/' + pages + ' 页</span>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-sm" data-page="-1"' + (st.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<button class="btn btn-sm" data-page="1"' + (st.page >= pages ? ' disabled' : '') + '>下一页</button>';

    Array.prototype.forEach.call(box.querySelectorAll('[data-page]'), function (btn) {
      btn.addEventListener('click', function () {
        st.page = Math.max(1, st.page + Number(btn.getAttribute('data-page')));
        refresh(true);
      });
    });

    var stat = document.getElementById('fileStat');
    if (stat) stat.textContent = st.total + ' 个文件 · ' + fmtBytes(st.bytes);
  }

  Views.files = async function (box) {
    st.view = localStorage.getItem('zzz_files_view') || 'grid';
    st.page = 1;

    box.innerHTML =
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<h2>文件库</h2>' +
          '<span class="sub" id="fileStat">—</span>' +
          '<div class="spacer"></div>' +
          '<button class="btn btn-sm btn-primary" id="filePick">＋ 上传文件</button>' +
        '</div>' +
        '<div class="panel-body">' +
          '<div class="dropzone" id="dropzone">' +

            '<div class="dz-t">把文件拖到这里</div>' +
            '<div class="dz-s">或点击选择 · 支持 Ctrl+V 直接粘贴截图 · 图片视频自动生成缩略图</div>' +
            '<div class="dz-hint">单文件最大 200 MB，超过 20 MB 自动分片上传</div>' +
          '</div>' +
          '<input type="file" id="fileInput" multiple hidden accept="image/*,video/*,.pdf,.zip,.rar,.7z,.txt,.md,.csv,.json">' +
          '<div class="up-queue" id="upQueue" hidden></div>' +
          '<div class="file-toolbar">' +
            '<input class="input" id="fileQ" placeholder="搜索文件名…" autocomplete="off">' +
            '<select class="select" id="fileKind">' +
              KINDS.map(function (k) { return '<option value="' + k.k + '"' + (st.kind === k.k ? ' selected' : '') + '>' + k.name + '</option>'; }).join('') +
            '</select>' +
            '<div class="spacer"></div>' +
            '<button class="btn btn-sm" id="fileView">' + (st.view === 'grid' ? '列表视图' : '网格视图') + '</button>' +
          '</div>' +
          '<div id="fileList"></div>' +
          '<div class="file-foot" id="fileFoot"></div>' +
        '</div>' +
      '</div>';

    var input = $('#fileInput', box);
    var dz = $('#dropzone', box);

    $('#filePick', box).addEventListener('click', function () { input.click(); });
    dz.addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
      addFiles(input.files);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('is-over'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    // 整页拖拽兜底
    var stopPageDrop = function (e) { e.preventDefault(); };
    document.addEventListener('dragover', stopPageDrop);
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (Views.files !== currentView()) return;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    // Ctrl+V 粘贴
    var onPaste = function (e) {
      if (state.view !== 'files') return;
      var items = (e.clipboardData && e.clipboardData.files) || [];
      if (!items.length) return;
      e.preventDefault();
      addFiles(items);
    };
    document.addEventListener('paste', onPaste);

    var q = $('#fileQ', box);
    q.addEventListener('input', debounce(function () {
      st.q = q.value.trim();
      st.page = 1;
      refresh(true);
    }, 300));

    $('#fileKind', box).addEventListener('change', function () {
      st.kind = this.value;
      st.page = 1;
      refresh(true);
    });

    $('#fileView', box).addEventListener('click', function () {
      st.view = st.view === 'grid' ? 'list' : 'grid';
      localStorage.setItem('zzz_files_view', st.view);
      this.textContent = st.view === 'grid' ? '列表视图' : '网格视图';
      renderList();
    });

    await refresh(true);
  };

  function currentView() {
    return (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
  }
})();
