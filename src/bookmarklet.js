// Bookmarklet entry point. Depends on the functions in toc.js.
// Run `npm run build` and paste dist/bookmarklet.js into the console, or
// dist/bookmarklet.txt into a bookmark. To run from source instead, paste
// src/toc.js into the console first, then this file.
(function() {
  // SECURITY: a bookmarklet runs with the authority of whatever page it is clicked on.
  // Do nothing at all anywhere except the course site (file: allowed for local previews).
  const VERSION = '__VERSION__'; // replaced by build.js from package.json
  // Comma-separated list injected by build.js from TOC_ALLOWED_HOSTS (.env / CI).
  const ALLOWED_HOSTS = '__ALLOWED_HOSTS__'.split(',').map(function(h) { return h.trim(); }).filter(Boolean);
  if (location.protocol !== 'file:' &&
      !(location.protocol === 'https:' && ALLOWED_HOSTS.indexOf(location.hostname) !== -1)) {
    alert('This bookmarklet only works on https://' + ALLOWED_HOSTS.join(', ') + '.');
    return;
  }

  // A session link from the gist is only followed if it is https on an allowed host.
  function allowedSessionUrl(url) {
    var u;
    try { u = new URL(url); } catch (err) { return null; }
    return (u.protocol === 'https:' && ALLOWED_HOSTS.indexOf(u.hostname) !== -1) ? u.href : null;
  }

  // One secret Gist holds one markdown file per video. A file matches a video if its
  // name contains the Wistia hashed id anywhere, e.g. "001-abc123def4.md" or
  // "abc123def4.md". The Gist API lists files (with content) in one CORS-friendly call;
  // if that fails (e.g. 60/hr unauthenticated rate limit) we fall back to the raw URL
  // for the plain "<id>.md" name.
  // Injected by build.js from TOC_GIST_USER / TOC_GIST_ID (.env locally, repo secrets in CI).
  // The source never contains the real values, so the repo can be public.
  const GIST_USER = '__GIST_USER__';
  const GIST_ID = '__GIST_ID__';
  const GIST_API_URL = 'https://api.github.com/gists/' + GIST_ID;
  const GIST_RAW_BASE = 'https://gist.githubusercontent.com/' + GIST_USER + '/' + GIST_ID + '/raw';

  // Defaults: top four keys of a standard 61-key (C2-C7) keyboard.
  // copyTime is an authoring aid and starts unassigned (null); any action can be
  // unassigned with its clear button.
  // speed, back10 and fwd10 are newer and also start unassigned, so existing setups gain no surprise bindings.
  const DEFAULT_MIDI_NOTES = { next: 96, prev: 95, pause: 94, where: 93, back10: null, fwd10: null, speed: null, copyTime: null }; // C7, B6, A#6, A6
  const MIDI_ACTIONS = ['next', 'prev', 'pause', 'where', 'back10', 'fwd10', 'speed', 'copyTime'];
  const MIDI_ACTION_LABELS = { next: 'Next timestamp', prev: 'Previous timestamp', pause: 'Pause', where: 'Where am I?', back10: 'Back 10 seconds', fwd10: 'Forward 10 seconds', speed: 'Speed \u00D71 / \u00D72', copyTime: 'Copy timestamp' };
  const SKIP_SECONDS = 10;
  const MIDI_NOTES_STORAGE_KEY = 'toc-bookmarklet-midi-notes';
  const MIDI_ENABLED_STORAGE_KEY = 'toc-bookmarklet-midi-enabled';
  const FLASH_ENABLED_STORAGE_KEY = 'toc-bookmarklet-flash-enabled';
  const WIDTH_STORAGE_KEY = 'toc-bookmarklet-width';
  const HEIGHT_STORAGE_KEY = 'toc-bookmarklet-height';
  const FLASH_POS_STORAGE_KEY = 'toc-bookmarklet-flash-pos';
  const PANEL_MIN_WIDTH = 300;
  const PANEL_MIN_HEIGHT_REM = 22; // half the default 44rem cap
  function remPx(rem) {
    var fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return rem * fs;
  }

  function loadFlag(key, dflt) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? dflt : v === '1';
    } catch (err) { return dflt; }
  }
  function saveFlag(key, val) {
    try { localStorage.setItem(key, val ? '1' : '0'); } catch (err) {}
  }

  // "next" skips entries within this many seconds ahead, so a press landing on a boundary moves on.
  const NEXT_TOLERANCE = 0.5;
  // "prev" restarts the current section unless we're within this many seconds of its start.
  const PREV_RESTART_THRESHOLD = 2;
  const FLASH_MS = 1500;

  // One stylesheet for the panel, waiting panel and flash. Scoped under our ids so
  // it can't touch the host page; explicit resets so the host page can't restyle us.
  const TB_CSS = '#toc-box, #toc-flash { --tb-ebony:#1B1815; --tb-raised:#2A2521; --tb-ivory:#EDE4CF; --tb-dim:#AFA592; --tb-mid:#CFC5B0; --tb-baize:#5C8A6A; --tb-brass:#C9A453; --tb-rule:rgba(237,228,207,.14); }\n#toc-box { position:fixed; top:20px; right:20px; z-index:999999; width:300px; min-width:300px; max-width:calc(100vw - 40px); max-height:min(44rem, calc(100vh - 40px)); display:flex; flex-direction:column; overflow:hidden; box-sizing:border-box;\n  background:var(--tb-ebony); color:var(--tb-ivory); border-radius:6px; box-shadow:0 8px 28px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04);\n  font:13px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; letter-spacing:0; text-align:left; }\n#toc-box .tb-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; scrollbar-width:thin; scrollbar-color:var(--tb-raised) transparent; }\n#toc-box *, #toc-box *::before, #toc-box *::after { box-sizing:border-box; }\n#toc-box button, #toc-box input { font:inherit; color:inherit; margin:0; appearance:none; -webkit-appearance:none; }\n#toc-box button { background:none; border:0; padding:0; cursor:pointer; text-align:left; line-height:inherit; }\n#toc-box button:focus-visible, #toc-box input:focus-visible, #toc-box [tabindex]:focus-visible { outline:2px solid var(--tb-baize); outline-offset:1px; }\n#toc-box .tb-resize, #toc-box .tb-resize-y { position:absolute; z-index:1; }\n#toc-box .tb-resize { top:0; left:0; bottom:0; width:8px; cursor:ew-resize; }\n#toc-box .tb-resize-y { left:0; right:0; bottom:0; height:8px; cursor:ns-resize; }\n#toc-box .tb-resize::after, #toc-box .tb-resize-y::after { content:""; position:absolute; background:var(--tb-dim); opacity:.45; border-radius:2px; }\n#toc-box .tb-resize::after { left:2px; top:50%; width:3px; height:28px; margin-top:-14px; }\n#toc-box .tb-resize-y::after { top:2px; left:50%; height:3px; width:28px; margin-left:-14px; }\n#toc-box .tb-resize:hover::after, #toc-box .tb-resize.tb-active::after, #toc-box .tb-resize-y:hover::after, #toc-box .tb-resize-y.tb-active::after { opacity:1; background:var(--tb-ivory); }\n#toc-box .tb-head { flex:0 0 auto; }\n#toc-box.tb-collapsed { height:auto !important; min-height:0 !important; }\n#toc-box.tb-collapsed .tb-scroll, #toc-box.tb-collapsed .tb-resize, #toc-box.tb-collapsed .tb-resize-y { display:none; }\n#toc-box .tb-head { display:flex; align-items:baseline; justify-content:space-between; padding:11px 14px 8px; cursor:move; user-select:none; -webkit-user-select:none; }\n#toc-box .tb-title { font-size:14px; font-weight:600; }\n#toc-box .tb-head-btns { display:flex; align-items:center; gap:10px; }\n#toc-box .tb-min { color:var(--tb-dim); font-size:16px; line-height:1; padding:0 2px; cursor:pointer; }\n#toc-box .tb-min:hover { color:var(--tb-ivory); }\n#toc-box .tb-gear { color:var(--tb-dim); line-height:0; padding:2px; border-radius:4px; cursor:pointer; }\n#toc-box .tb-gear:hover { color:var(--tb-ivory); }\n#toc-box .tb-gear.tb-on { color:var(--tb-ebony); background:var(--tb-ivory); }\n#toc-box .tb-sub { padding:0 14px; color:var(--tb-dim); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }\n#toc-box .tb-toggle { display:block; width:100%; padding:6px 14px; color:var(--tb-dim); font-size:12px; border-top:1px solid var(--tb-rule); user-select:none; -webkit-user-select:none; }\n#toc-box .tb-toggle:hover { color:var(--tb-ivory); }\n#toc-box .tb-toggle::before { content:"\\25B8"; display:inline-block; width:12px; }\n#toc-box .tb-toggle.tb-open::before { content:"\\25BE"; }\n#toc-box .tb-sessions { padding:0 14px 6px; }\n#toc-box .tb-session { display:block; width:100%; padding:3px 0 3px 12px; color:var(--tb-ivory); }\n#toc-box .tb-session:hover { text-decoration:underline; text-underline-offset:2px; }\n#toc-box .tb-session.tb-current { color:var(--tb-dim); cursor:default; }\n#toc-box .tb-session.tb-current:hover { text-decoration:none; }\n#toc-box .tb-session.tb-nolink { color:var(--tb-dim); cursor:default; }\n#toc-box .tb-note { padding:2px 14px 6px 26px; color:var(--tb-dim); font-size:11px; }\n#toc-box .tb-list { padding:6px 0 8px; border-top:1px solid var(--tb-rule); }\n#toc-box .tb-row { display:grid; grid-template-columns:3px 1fr auto; column-gap:10px; align-items:baseline; width:100%; padding:4px 14px 4px 12px; color:var(--tb-mid); }\n#toc-box .tb-row .tb-time { color:var(--tb-dim); font-size:12px; }\n#toc-box .tb-row:hover, #toc-box .tb-row:hover .tb-time { color:var(--tb-ivory); }\n#toc-box .tb-rail { align-self:stretch; margin:-4px 0; background:var(--tb-rule); }\n#toc-box .tb-row:first-of-type .tb-rail { margin-top:0; border-radius:2px 2px 0 0; }\n#toc-box .tb-row:last-of-type .tb-rail { margin-bottom:0; border-radius:0 0 2px 2px; }\n#toc-box .tb-row.tb-now { color:var(--tb-ivory); font-weight:600; }\n#toc-box .tb-row.tb-now .tb-time { color:var(--tb-ivory); font-weight:400; }\n#toc-box .tb-row.tb-now .tb-rail { background:var(--tb-baize); border-radius:2px; }\n#toc-box .tb-time { font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap; }\n#toc-box .tb-name { overflow-wrap:anywhere; }\n#toc-box .tb-d1 .tb-name { padding-left:14px; }\n#toc-box .tb-d2 .tb-name { padding-left:28px; }\n#toc-box .tb-d3 .tb-name { padding-left:42px; }\n#toc-box .tb-heading { color:var(--tb-dim); cursor:default; padding-top:8px; }\n#toc-box .tb-heading:hover { color:var(--tb-dim); }\n#toc-box .tb-row.tb-d0:not(.tb-heading) .tb-name { color:var(--tb-ivory); }\n#toc-box .tb-row[title] { cursor:pointer; }\n#toc-box .tb-heading[title] { cursor:help; }\n#toc-box .tb-empty { padding:8px 14px 10px 26px; color:var(--tb-brass); font-size:12px; }\n#toc-box .tb-empty span { display:block; color:var(--tb-dim); margin-top:4px; }\n#toc-box .tb-settings-body { padding:4px 14px 12px; font-size:12px; border-top:1px solid var(--tb-rule); }\n#toc-box .tb-settings-body .tb-group:first-child { margin-top:4px; }\n#toc-box .tb-rule { border:0; border-top:1px solid var(--tb-rule); margin:14px 0 2px; }\n#toc-box .tb-check { display:flex; align-items:center; gap:8px; padding:5px 0; cursor:pointer; }\n#toc-box .tb-check input { width:14px; height:14px; margin:0; appearance:auto; -webkit-appearance:auto; accent-color:var(--tb-baize); }\n#toc-box .tb-status { color:var(--tb-dim); font-size:11px; padding-left:22px; min-height:1em; }\n#toc-box .tb-group { margin-top:10px; }\n#toc-box .tb-group-title { color:var(--tb-dim); font-size:12px; margin-bottom:4px; }\n#toc-box .tb-hint { color:var(--tb-dim); font-size:11px; margin:2px 0 6px; }\n#toc-box .tb-keys { display:grid; grid-template-columns:1fr auto 22px; column-gap:6px; row-gap:2px; align-items:center; }\n#toc-box .tb-key-name { color:var(--tb-ivory); padding:3px 0; }\n#toc-box .tb-key { background:var(--tb-raised); border-radius:4px; padding:3px 8px; min-width:86px; text-align:center; font-variant-numeric:tabular-nums; color:var(--tb-ivory); }\n#toc-box .tb-key:hover { background:#35302A; }\n#toc-box .tb-key.tb-unset { color:var(--tb-dim); }\n#toc-box .tb-key.tb-learning { background:var(--tb-brass); color:var(--tb-ebony); }\n#toc-box .tb-clear { color:var(--tb-dim); text-align:center; padding:3px 0; }\n#toc-box .tb-clear:hover { color:var(--tb-ivory); }\n#toc-box .tb-learn-status { color:var(--tb-brass); font-size:11px; min-height:1em; margin-top:4px; }\n#toc-box .tb-btn { background:var(--tb-raised); border-radius:4px; padding:4px 10px; color:var(--tb-ivory); }\n#toc-box .tb-btn:hover { background:#35302A; }\n#toc-box .tb-inline { display:flex; gap:6px; align-items:center; }\n#toc-box .tb-stamp { padding:3px 4px; font-variant-numeric:tabular-nums; color:var(--tb-dim); user-select:none; -webkit-user-select:none; }\n#toc-box .tb-wait { padding:4px 14px 12px; color:var(--tb-dim); }\n#toc-box .tb-wait b { color:var(--tb-ivory); font-weight:600; }\n#toc-flash { position:fixed; top:11%; left:50%; transform:translateX(-50%); z-index:999999; max-width:70vw; padding:12px 22px 12px 18px;\n  background:rgba(27,24,21,.93); color:var(--tb-ivory); border-left:3px solid var(--tb-baize); border-radius:4px; box-shadow:0 8px 28px rgba(0,0,0,.45);\n  font:600 21px/1.3 ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; font-variant-numeric:tabular-nums; text-align:left;\n  display:flex; align-items:center; gap:.5em; pointer-events:none; opacity:0; transition:opacity .25s; }\n#toc-flash.tb-shown:not(.tb-fs) { pointer-events:auto; cursor:move; user-select:none; -webkit-user-select:none; }\n#toc-flash .tb-flash-icon { flex:0 0 auto; }\n#toc-flash .tb-flash-aside { margin-left:.6em; font-size:15px; font-weight:400; color:var(--tb-dim); white-space:nowrap; }\n#toc-flash .tb-flash-context { font-size:15px; font-weight:400; color:var(--tb-dim); margin-bottom:2px; }\n@media (prefers-reduced-motion: reduce) { #toc-flash { transition:none; } }';
  function ensureStyle(doc) {
    doc = doc || document;
    if (doc.getElementById('toc-style')) return;
    var st = doc.createElement('style');
    st.id = 'toc-style';
    st.textContent = TB_CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  function findV(d) {
    var v = d.querySelector('video');
    if (v) return v;
    var f = d.querySelectorAll('iframe');
    for (var i = 0; i < f.length; i++) {
      try {
        v = findV(f[i].contentWindow.document);
        if (v) return v;
      } catch (e) {}
    }
    return null;
  }

  // Identify the Wistia media. The hashed id appears as a class on the embed
  // wrapper (wistia_async_<id>) and in the HLS <source> URL (medias/<id>.m3u8).
  function findVideoInfo(v) {
    var id = null, m;
    var wrapper = v.closest && v.closest('.wistia_embed, [class*="wistia_async_"]');
    if (wrapper && (m = wrapper.className.match(/wistia_async_([A-Za-z0-9]+)/))) id = m[1];
    if (!id) {
      var src = v.querySelector('source');
      if (src && (m = (src.getAttribute('src') || '').match(/medias\/([A-Za-z0-9]+)\./))) id = m[1];
    }
    if (!id) {
      var any = v.ownerDocument.querySelector('[class*="wistia_async_"]');
      if (any && (m = any.className.match(/wistia_async_([A-Za-z0-9]+)/))) id = m[1];
    }
    var title = (v.getAttribute('aria-label') || '').replace(/\.[a-z0-9]{2,4}$/i, '').trim();
    // Wistia sometimes labels the media with an opaque upload id (e.g. "dacjri12vnes72pm64sg");
    // that's noise, not a title.
    if (/^[a-z0-9]{16,}$/i.test(title)) title = '';
    return { id: id, title: title };
  }

  if (document.getElementById('toc-box')) return;

  // Before the first play, Thinkific shows only a thumbnail button; the Wistia
  // player (and therefore the video id) doesn't exist yet. Wait for it.
  const WAIT_POLL_MS = 500;
  const WAIT_TIMEOUT_MS = 180000;

  function readyVideo() {
    var v = findV(document);
    return (v && findVideoInfo(v).id) ? v : null;
  }

  function waitForVideo() {
    ensureStyle();
    var box = document.createElement('div');
    box.id = 'toc-box';
    box.innerHTML = '<div class="tb-head"><span class="tb-title">Video contents</span></div>' +
      '<div class="tb-wait" id="toc-wait-msg">Press <b>play</b> on any video to load its contents.</div>';
    document.body.appendChild(box);

    var waited = 0;
    var timer = setInterval(function() {
      var v = readyVideo();
      if (v) {
        clearInterval(timer);
        box.remove();
        start(v);
        return;
      }
      waited += WAIT_POLL_MS;
      if (waited >= WAIT_TIMEOUT_MS) {
        clearInterval(timer);
        document.getElementById('toc-wait-msg').innerText =
          'Stopped waiting. Press play on a video, then click the bookmarklet again.';
        setTimeout(function() { box.remove(); }, 6000);
      }
    }, WAIT_POLL_MS);
  }

  var initialVideo = readyVideo();
  if (initialVideo) start(initialVideo); else waitForVideo();

  function start(video) {
    var videoInfo = findVideoInfo(video);

    // Resolve the TOC markdown for this video, or null if none exists yet.
    function fetchTocViaApi(id) {
      return fetch(GIST_API_URL + '?t=' + Date.now(), { headers: { Accept: 'application/vnd.github+json' } })
        .then(r => {
          if (!r.ok) throw new Error('Gist API HTTP ' + r.status);
          return r.json();
        })
        .then(gist => {
          var files = gist.files || {};
          // Every session in the gist, for the "Sessions" list. Content is inline
          // unless truncated; a truncated file just gets no url/heading.
          var sessions = Object.keys(files).sort().map(function(name) {
            var f = files[name];
            var content = (!f.truncated && typeof f.content === 'string') ? f.content : '';
            var meta = extractMeta(content);
            var num = name.match(/^(\d+)/);
            return {
              name: name,
              label: meta.heading || (num ? 'Session ' + parseInt(num[1], 10) : name.replace(/\.md$/, '')),
              url: meta.url,
              isCurrent: name.indexOf(id) !== -1
            };
          });
          var names = Object.keys(files).filter(n => n.indexOf(id) !== -1).sort();
          if (!names.length) return { md: null, sessions: sessions };
          if (names.length > 1) console.warn('[toc-bookmarklet] multiple TOC files match ' + id + ':', names, '- using', names[0]);
          var f = files[names[0]];
          var mdP = (!f.truncated && typeof f.content === 'string')
            ? Promise.resolve(f.content)
            : fetch(f.raw_url + '?t=' + Date.now()).then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + names[0]);
                return r.text();
              });
          return mdP.then(md => ({ md: md, sessions: sessions }));
        });
    }

    function fetchTocViaRaw(id) {
      return fetch(GIST_RAW_BASE + '/' + id + '.md?t=' + Date.now()).then(r => {
        if (r.status === 404) return { md: null, sessions: [] };
        if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching TOC');
        return r.text().then(md => ({ md: md, sessions: [] }));
      });
    }

    fetchTocViaApi(videoInfo.id)
      .catch(err => {
        console.warn('[toc-bookmarklet] Gist API lookup failed, trying raw URL:', err);
        return fetchTocViaRaw(videoInfo.id);
      })
      .then(result => {
        var md = result.md, sessions = result.sessions;
        var entries = md === null ? [] : parseEntries(md);
        var tocMissing = md === null;
        var flashEnabled = loadFlag(FLASH_ENABLED_STORAGE_KEY, true);
        var midiWanted = loadFlag(MIDI_ENABLED_STORAGE_KEY, false);

        // ---- Flash message overlay ----
        var flashEl = document.createElement('div');
        flashEl.id = 'toc-flash';
        ensureStyle();
        document.body.appendChild(flashEl);
        var flashTimer = null;
        var flashInFullscreen = false;
        var flashPos = null; // { left, top } in px, chosen by dragging; null = default (top centre)
        try { flashPos = JSON.parse(localStorage.getItem(FLASH_POS_STORAGE_KEY) || 'null'); } catch (err) {}

        // Outside fullscreen the flash can be dragged to wherever suits; in fullscreen it
        // stays at the default spot and ignores the mouse entirely.
        function applyFlashPos() {
          if (!flashInFullscreen && flashPos && isFinite(flashPos.left) && isFinite(flashPos.top)) {
            var w = flashEl.offsetWidth || 200, h = flashEl.offsetHeight || 60;
            var left = Math.max(0, Math.min(flashPos.left, window.innerWidth - w));
            var top = Math.max(0, Math.min(flashPos.top, window.innerHeight - h));
            flashEl.style.left = left + 'px';
            flashEl.style.top = top + 'px';
            flashEl.style.transform = 'none';
          } else {
            flashEl.style.left = '';
            flashEl.style.top = '';
            flashEl.style.transform = '';
          }
        }

        function hideFlash() {
          flashEl.classList.remove('tb-shown');
          flashEl.style.opacity = '0';
        }
        function scheduleHideFlash() {
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = setTimeout(hideFlash, FLASH_MS);
        }
        // Hovering holds the message so it can be read or dragged; leaving restarts the fade.
        flashEl.addEventListener('mouseenter', function() {
          if (flashInFullscreen) return;
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = null;
        });
        flashEl.addEventListener('mouseleave', function() {
          if (flashInFullscreen) return;
          if (flashEl.classList.contains('tb-shown')) scheduleHideFlash();
        });

        var flashDrag = false, fdX = 0, fdY = 0;
        flashEl.addEventListener('mousedown', function(e) {
          if (flashInFullscreen || !flashEl.classList.contains('tb-shown')) return;
          e.preventDefault();
          var r = flashEl.getBoundingClientRect();
          flashDrag = true;
          fdX = e.clientX - r.left;
          fdY = e.clientY - r.top;
          flashEl.style.left = r.left + 'px';
          flashEl.style.top = r.top + 'px';
          flashEl.style.transform = 'none';
        });

        // In fullscreen only the fullscreen element's subtree is rendered, so
        // re-parent the flash overlay into it while fullscreen is active.
        function fullscreenElementIn(d) {
          var fs = d.fullscreenElement || d.webkitFullscreenElement || null;
          if (fs && fs.tagName === 'IFRAME') {
            try { return fullscreenElementIn(fs.contentWindow.document) || fs; } catch (err) { return fs; }
          }
          return fs;
        }

        function onFullscreenChange() {
          var fs = fullscreenElementIn(document);
          // A bare <video> can't host children; fall back to body in that case.
          var target = (fs && fs.tagName !== 'VIDEO' && fs.tagName !== 'IFRAME') ? fs : document.body;
          if (flashEl.parentNode === target) return;
          // The fullscreen element may belong to another (same-origin) document;
          // our stylesheet has to exist there too or the flash renders unstyled.
          try { ensureStyle(target.ownerDocument); } catch (err) {}
          target.appendChild(flashEl);
          flashInFullscreen = target !== document.body;
          flashEl.classList.toggle('tb-fs', flashInFullscreen);
          applyFlashPos();
        }

        function attachFullscreen(d) {
          d.addEventListener('fullscreenchange', onFullscreenChange);
          d.addEventListener('webkitfullscreenchange', onFullscreenChange);
          var f = d.querySelectorAll('iframe');
          for (var i = 0; i < f.length; i++) {
            try { attachFullscreen(f[i].contentWindow.document); } catch (err) {}
          }
        }
        attachFullscreen(document);

        // flash(main[, aside[, context[, icon]]]): the aside (e.g. a timestamp) is set smaller and
        // dimmer after the main text; context (e.g. the parent section) is a smaller line above it;
        // icon (e.g. a direction arrow) sits in its own column to the left of both lines.
        function flash(text, aside, context, icon) {
          if (!flashEnabled) return;
          flashEl.textContent = '';
          if (icon) {
            var ic = document.createElement('div');
            ic.className = 'tb-flash-icon';
            ic.textContent = icon;
            flashEl.appendChild(ic);
          }
          var body = document.createElement('div');
          flashEl.appendChild(body);
          if (context) {
            var ctx = document.createElement('div');
            ctx.className = 'tb-flash-context';
            ctx.textContent = context;
            body.appendChild(ctx);
          }
          var main = document.createElement('span');
          main.textContent = text;
          body.appendChild(main);
          if (aside) {
            var side = document.createElement('span');
            side.className = 'tb-flash-aside';
            side.textContent = aside;
            body.appendChild(side);
          }
          flashEl.classList.add('tb-shown');
          applyFlashPos();
          flashEl.style.opacity = '1';
          scheduleHideFlash();
        }

        // ---- Seeking ----
        function seekTo(entry) {
          var v = findV(document);
          if (!v) return;
          var from = v.currentTime;
          v.currentTime = entry.sec;
          v.play();
          var arrow = entry.sec > from ? '\u2192' : entry.sec < from ? '\u2190' : '';
          flash(entry.title, entry.time, entry.parent, arrow);
          if (typeof markNow === 'function') markNow(); // in case the player swapped its <video>
        }

        function seekNext() {
          var v = findV(document);
          if (!v) return;
          var i = nextIndex(entries, v.currentTime, NEXT_TOLERANCE);
          if (i < 0) { flash('End of contents'); return; }
          seekTo(entries[i]);
        }

        function seekPrev() {
          var v = findV(document);
          if (!v) return;
          var i = prevIndex(entries, v.currentTime, PREV_RESTART_THRESHOLD);
          if (i >= 0) seekTo(entries[i]);
        }

        // ---- MIDI ----
        var midiAccess = null;
        var midiEnabled = false;
        var midiNotes = loadMidiNotes();
        var learning = null; // null or one of MIDI_ACTIONS
        var midiUi = {}; // filled in once the panel exists: checkbox, statusEl, learnStatus, learnBtns{action: button}

        function loadMidiNotes() {
          var notes = {};
          MIDI_ACTIONS.forEach(function(a) { notes[a] = DEFAULT_MIDI_NOTES[a]; });
          try {
            var saved = JSON.parse(localStorage.getItem(MIDI_NOTES_STORAGE_KEY) || 'null');
            if (saved) {
              MIDI_ACTIONS.forEach(function(a) {
                if (typeof saved[a] === 'number' || saved[a] === null) notes[a] = saved[a];
              });
            }
          } catch (err) {}
          return notes;
        }

        function saveMidiNotes() {
          try { localStorage.setItem(MIDI_NOTES_STORAGE_KEY, JSON.stringify(midiNotes)); } catch (err) {}
        }

        var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        function noteName(n) {
          return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1) + ' (' + n + ')';
        }

        function onMidiMessage(e) {
          if (!e.data || e.data.length < 3) return;
          var status = e.data[0] & 0xF0;
          var note = e.data[1];
          var velocity = e.data[2];
          if (status !== 0x90 || velocity === 0) return; // note-on only
          if (learning) { finishLearn(note); return; }
          if (!midiEnabled) return;
          if (note === midiNotes.next) seekNext();
          else if (note === midiNotes.prev) seekPrev();
          else if (note === midiNotes.pause) togglePause();
          else if (note === midiNotes.where) showWhere();
          else if (note === midiNotes.back10) skipBy(-SKIP_SECONDS);
          else if (note === midiNotes.fwd10) skipBy(SKIP_SECONDS);
          else if (note === midiNotes.speed) toggleSpeed();
          else if (note === midiNotes.copyTime) copyTimestamp();
        }

        // ---- Authoring: copy current timestamp (H:MM:SS, matching the TOC files) ----
        var lastStampEl = null; // readonly field in the panel, set once built
        function formatTime(sec) {
          sec = Math.floor(sec);
          var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
          var pad = function(n) { return (n < 10 ? '0' : '') + n; };
          return h + ':' + pad(m) + ':' + pad(s);
        }
        function copyTimestamp() {
          var v = findV(document);
          if (!v) return;
          var t = formatTime(v.currentTime);
          if (lastStampEl) lastStampEl.textContent = t;
          var p = (navigator.clipboard && navigator.clipboard.writeText)
            ? navigator.clipboard.writeText(t)
            : Promise.reject(new Error('Clipboard API unavailable'));
          p.then(function() {
            flash('\u2398 Copied ' + t);
          }).catch(function(err) {
            // Clipboard writes can be refused without a user gesture (e.g. from MIDI).
            console.warn('[toc-bookmarklet] clipboard write failed:', err);
            flash('\u2398 ' + t + ' (copy blocked \u2013 see panel)');
          });
        }

        function showWhere() {
          var v = findV(document);
          if (!v || !entries.length) return;
          var i = currentIndex(entries, v.currentTime);
          if (i < 0) { flash('\u25CE Before first section'); return; }
          flash(entries[i].title, entries[i].time, entries[i].parent, '\u25CE');
        }

        function togglePause() {
          var v = findV(document);
          if (!v) return;
          if (v.paused) { v.play(); flash('\u25B6 Play'); }
          else { v.pause(); flash('\u23F8 Paused'); }
        }

        // Skip back/forward by a fixed number of seconds. Leaves play/pause state alone.
        function skipBy(delta) {
          var v = findV(document);
          if (!v) return;
          var max = isFinite(v.duration) ? v.duration : Infinity;
          v.currentTime = Math.min(max, Math.max(0, v.currentTime + delta));
          var n = Math.abs(delta);
          flash((delta < 0 ? 'Back ' : 'Forward ') + n + ' seconds', null, null, delta < 0 ? '\u2190' : '\u2192');
          if (typeof markNow === 'function') markNow();
        }

        // Toggle playback speed between x1 and x2 on the <video> itself. Wistia's own speed menu
        // keeps its own idea of the rate and may show a stale value until touched; accepted.
        // Leaves play/pause state alone.
        function toggleSpeed() {
          var v = findV(document);
          if (!v) return;
          var rate = v.playbackRate >= 1.5 ? 1 : 2;
          v.playbackRate = rate;
          flash('Speed: \u00D7' + rate);
        }

        // ---- MIDI learn ----
        function startLearn(which) {
          if (learning === which) { cancelLearn('Cancelled.'); return; }
          learning = which;
          if (!midiEnabled && midiUi.checkbox && !midiUi.checkbox.disabled) {
            midiUi.checkbox.checked = true;
            enableMidi(midiUi.checkbox, midiUi.statusEl);
          }
          renderLearnUi();
        }

        function finishLearn(note) {
          var which = learning;
          var msg = MIDI_ACTION_LABELS[which] + ' = ' + noteName(note) + '.';
          MIDI_ACTIONS.forEach(function(other) {
            if (other !== which && midiNotes[other] === note) {
              midiNotes[other] = null;
              msg += ' That key was ' + other + '; ' + other + ' is now unset.';
            }
          });
          midiNotes[which] = note;
          saveMidiNotes();
          learning = null;
          flash(msg);
          renderLearnUi(msg);
        }

        function cancelLearn(msg) {
          learning = null;
          renderLearnUi(msg || '');
        }

        function renderLearnUi(msg) {
          if (!midiUi.learnBtns) return;
          MIDI_ACTIONS.forEach(function(a) {
            var btn = midiUi.learnBtns[a];
            var n = midiNotes[a];
            var name = MIDI_ACTION_LABELS[a];
            var isLearning = learning === a;
            btn.innerText = isLearning ? 'listening\u2026' : (n === null ? 'not set' : noteName(n));
            btn.title = isLearning ? 'Click to cancel' : 'Click, then press a MIDI note for ' + name;
            btn.className = 'tb-key' + (isLearning ? ' tb-learning' : (n === null ? ' tb-unset' : ''));
          });
          if (learning) {
            midiUi.learnStatus.innerText = 'Press a MIDI note for "' + MIDI_ACTION_LABELS[learning] + '". Esc cancels.';
          } else {
            midiUi.learnStatus.innerText = msg || '';
          }
        }

        // Attach/detach by assignment (never addEventListener) so re-running is idempotent.
        function attachInputs() {
          if (!midiAccess) return;
          midiAccess.inputs.forEach(function(input) {
            input.onmidimessage = midiEnabled ? onMidiMessage : null;
          });
        }

        // Exactly ONE MIDIAccess for the life of the panel. Requesting a new one on every
        // enable gave each physical port a second (third, ...) handler, so a single key
        // press toggled pause twice and cancelled itself out.
        var midiAccessPromise = null;
        function getMidiAccess() {
          if (midiAccess) return Promise.resolve(midiAccess);
          if (midiAccessPromise) return midiAccessPromise;
          var p;
          try { p = navigator.requestMIDIAccess(); } catch (err) { p = Promise.reject(err); }
          midiAccessPromise = p.then(function(access) {
            midiAccess = access;
            access.onstatechange = function() {
              attachInputs();
              if (midiUi.statusEl) updateMidiStatus(midiUi.statusEl);
            };
            return access;
          }, function(err) {
            midiAccessPromise = null; // allow a retry later
            throw err;
          });
          return midiAccessPromise;
        }

        function enableMidi(checkbox, statusEl) {
          if (!navigator.requestMIDIAccess) {
            checkbox.checked = false;
            checkbox.disabled = true;
            statusEl.innerText = 'Web MIDI not supported in this browser';
            if (learning) cancelLearn('Cannot learn: Web MIDI not supported.');
            return;
          }
          if (!midiAccess) statusEl.innerText = 'Requesting MIDI access...';
          getMidiAccess().then(function() {
            if (!checkbox.checked) return; // unticked while we waited
            midiEnabled = true;
            attachInputs();
            updateMidiStatus(statusEl);
          }).catch(function(err) {
            checkbox.checked = false;
            midiEnabled = false;
            statusEl.innerText = 'MIDI unavailable: ' + (err && err.name ? err.name : 'error');
            if (learning) cancelLearn('Cannot learn: MIDI unavailable.');
          });
        }

        function disableMidi(statusEl) {
          midiEnabled = false;
          attachInputs(); // detaches (handlers set to null)
          statusEl.innerText = '';
        }

        function updateMidiStatus(statusEl) {
          if (!midiEnabled || !midiAccess) return;
          var n = midiAccess.inputs.size;
          statusEl.innerText = n
            ? n + ' MIDI input' + (n > 1 ? 's' : '') + ' connected.'
            : 'No MIDI keyboard connected';
        }

        // ---- Keyboard shortcuts (YouTube chapter keys: Alt/Option + Left/Right) ----
        // SAFETY: never swallow keystrokes someone is typing into a post or comment.
        // Resolve the real target through shadow DOM, and treat any editable
        // element, or anything inside one, as "typing".
        function isTyping(e) {
          var el = (e.composedPath && e.composedPath()[0]) || e.target;
          if (!el || el.nodeType !== 1) el = e.target;
          if (!el || el.nodeType !== 1) return false;
          var tag = (el.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
          if (el.isContentEditable) return true;
          if (el.closest && el.closest('[contenteditable], [role="textbox"], [role="combobox"], [role="searchbox"]')) return true;
          return false;
        }

        function onKeyDown(e) {
          if (isTyping(e)) return; // bail before anything else: typing always wins

          if (e.key === 'Escape' && learning) { cancelLearn('Cancelled.'); return; }

          // Alt/Option + Left/Right: prev/next section (YouTube chapter keys).
          if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey &&
              (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault(); // Alt+Left is browser Back on Windows/Linux
            e.stopPropagation();
            if (e.key === 'ArrowRight') seekNext(); else seekPrev();
            return;
          }

          // Plain 'c': show current chapter. Fullscreen only, so an unmodified
          // letter key can never be claimed while the page is usable for typing.
          if ((e.key === 'c' || e.key === 'C') && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
            if (!fullscreenElementIn(document)) return;
            e.preventDefault();
            e.stopPropagation();
            showWhere();
          }
        }

        function attachKeys(d) {
          d.addEventListener('keydown', onKeyDown, true);
          var f = d.querySelectorAll('iframe');
          for (var i = 0; i < f.length; i++) {
            try { attachKeys(f[i].contentWindow.document); } catch (err) {}
          }
        }
        attachKeys(document);

        var isMac = /Mac|iPhone|iPad/.test(navigator.platform);
        var modKey = isMac ? '\u2325' : 'Alt';
        var keyHint = modKey + ' + \u2192 next timestamp<br>' + modKey + ' + \u2190 previous timestamp<br>c (fullscreen only): current section';

        // ---- Panel ----
        ensureStyle();
        var box = document.createElement('div');
        box.id = 'toc-box';
        var savedWidth = 0;
        try { savedWidth = parseInt(localStorage.getItem(WIDTH_STORAGE_KEY), 10) || 0; } catch (err) {}
        if (savedWidth >= PANEL_MIN_WIDTH) box.style.width = Math.min(savedWidth, window.innerWidth - 40) + 'px';
        var savedHeight = 0;
        try { savedHeight = parseInt(localStorage.getItem(HEIGHT_STORAGE_KEY), 10) || 0; } catch (err) {}
        if (savedHeight >= remPx(PANEL_MIN_HEIGHT_REM)) {
          box.style.maxHeight = 'none';
          box.style.height = Math.min(savedHeight, window.innerHeight - 40) + 'px';
        }

        // Width handle on the left edge (the panel is anchored to the right).
        var grip = document.createElement('div');
        grip.className = 'tb-resize';
        grip.title = 'Drag to change width';
        box.appendChild(grip);
        var gripY = document.createElement('div');
        gripY.className = 'tb-resize-y';
        gripY.title = 'Drag to change height';
        box.appendChild(gripY);

        var head = document.createElement('div');
        head.id = 'toc-head';
        head.className = 'tb-head';
        // Material Design "settings" gear (Apache-2.0), the shape people recognise as settings.
        var GEAR_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="' +
          'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96' +
          'c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35c-.59.24-1.13.57-1.62.94L5.24 5.33' +
          'c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61' +
          'l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54' +
          'c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6' +
          's1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>';
        head.innerHTML = '<span class="tb-title" id="toc-title">Contents</span>' +
          '<span class="tb-head-btns">' +
            '<button id="toc-gear" class="tb-gear" title="Settings" aria-label="Settings" aria-pressed="false">' + GEAR_SVG + '</button>' +
            '<button id="toc-min" class="tb-min" title="Minimise" aria-label="Minimise">\u2013</button>' +
          '</span>';
        box.appendChild(head);
        head.querySelector('.tb-title').title = 'Video contents v' + VERSION + ' \u2014 video id ' + videoInfo.id;

        var body = document.createElement('div');
        body.id = 'toc-body';

        var current = sessions.filter(function(sx) { return sx.isCurrent; })[0];
        var subParts = [];
        if (current && current.label) subParts.push(current.label);
        if (videoInfo.title) subParts.push(videoInfo.title);
        if (subParts.length) {
          var titleEl = document.createElement('div');
          titleEl.className = 'tb-sub';
          titleEl.title = subParts.join('\n') + '\nVideo id ' + videoInfo.id;
          titleEl.innerText = subParts.join(' \u2014 ');
          body.appendChild(titleEl);
        }

        // ---- Contents list ----
        var list = document.createElement('div');
        list.id = 'toc-list';
        list.className = 'tb-list';
        if (tocMissing) {
          var none = document.createElement('div');
          none.className = 'tb-empty';
          none.innerHTML = 'No contents for this video yet.<span></span>';
          none.querySelector('span').textContent = 'Video id ' + videoInfo.id +
            '. To add contents, create a file in the TOC gist whose name contains that id, for example session00N-' +
            videoInfo.id + '.md.';
          list.appendChild(none);
        }
        var rowEls = [];
        entries.forEach(function(entry, i) {
          var jumpable = hasTime(entry);
          var row = document.createElement(jumpable ? 'button' : 'div');
          row.className = 'tb-row' + (jumpable ? '' : ' tb-heading') + ' tb-d' + Math.min(entry.depth, 3);
          row.innerHTML = '<span class="tb-rail"></span><span class="tb-name"></span><span class="tb-time"></span>';
          row.children[1].innerText = entry.title;
          row.children[2].innerText = entry.time || '';
          var tip = jumpable ? ['Jump to ' + entry.time] : [];
          if (entry.notes.length) tip = tip.concat(entry.notes);
          if (tip.length) row.title = tip.join('\n');
          if (jumpable) row.onclick = function() { seekTo(entry); };
          list.appendChild(row);
          rowEls.push(row);
        });
        body.appendChild(list);

        // The rail marks the section now playing, and follows playback.
        var nowIdx = -2;
        function markNow() {
          var v = findV(document);
          var idx = v ? currentIndex(entries, v.currentTime) : -1;
          if (idx === nowIdx) return;
          nowIdx = idx;
          rowEls.forEach(function(r, i) { r.classList.toggle('tb-now', i === idx); });
        }
        markNow();
        video.addEventListener('timeupdate', markNow);

        // ---- Sessions list: collapsed toggle at the bottom of the contents view ----
        // Opens in a NEW tab, never navigates this one: the hub is where people
        // write posts, and navigating away would lose an unsaved draft.
        if (sessions.some(function(sx) { return sx.url && allowedSessionUrl(sx.url); })) {
          var sessOpen = false;
          var sessHead = document.createElement('button');
          sessHead.className = 'tb-toggle';
          var sessList = document.createElement('div');
          sessList.className = 'tb-sessions';
          sessions.forEach(function(sx) {
            var safeUrl = sx.url ? allowedSessionUrl(sx.url) : null;
            var linkable = !!safeUrl && !sx.isCurrent;
            var row = document.createElement(linkable ? 'button' : 'div');
            row.className = 'tb-session' + (sx.isCurrent ? ' tb-current' : (linkable ? '' : ' tb-nolink'));
            row.innerText = sx.label + (sx.isCurrent ? ' \u2014 this video' : (linkable ? '' : ' \u2014 no link'));
            row.title = sx.name + (linkable ? '\n' + safeUrl : '');
            if (linkable) {
              row.onclick = function() { window.open(safeUrl, '_blank', 'noopener'); };
            }
            sessList.appendChild(row);
          });
          var sessNote = document.createElement('div');
          sessNote.className = 'tb-note';
          sessNote.innerText = 'Opens in a new tab. Click the bookmarklet again there.';
          sessList.appendChild(sessNote);
          var renderSess = function() {
            sessList.style.display = sessOpen ? 'block' : 'none';
            sessHead.className = 'tb-toggle' + (sessOpen ? ' tb-open' : '');
            sessHead.setAttribute('aria-expanded', sessOpen ? 'true' : 'false');
            sessHead.innerText = 'Other sessions';
          };
          sessHead.onclick = function() { sessOpen = !sessOpen; renderSess(); };
          renderSess();
          body.appendChild(sessHead);
          body.appendChild(sessList);
        }

        // ---- Settings view (replaces the contents view; never both at once) ----
        var controls = document.createElement('div');
        controls.id = 'toc-settings-body';
        controls.className = 'tb-settings-body';
        var FLASH_TIP = 'Show a brief message over the video whenever you jump to a timestamp or pause, so you can see where you are without looking at this panel.';
        var MIDI_TIP = 'Control the video from a connected MIDI keyboard: jump between timestamps, pause, and more. Your browser will ask permission the first time.';
        controls.innerHTML =
          '<div class="tb-group">' +
            '<div class="tb-group-title">Keyboard shortcuts</div>' +
            '<div class="tb-hint">' + keyHint + '</div>' +
          '</div>' +
          '<label class="tb-check" title="' + FLASH_TIP + '"><input type="checkbox" id="toc-flash-on"' + (flashEnabled ? ' checked' : '') + '> Flash messages</label>' +
          '<label class="tb-check" title="' + MIDI_TIP + '"><input type="checkbox" id="toc-midi"> MIDI keyboard</label>' +
          '<div id="toc-midi-status" class="tb-status"></div>' +
          '<div class="tb-group">' +
            '<div class="tb-group-title">MIDI mappings</div>' +
            '<div class="tb-hint">Click a control, then press the MIDI note to use for it.</div>' +
            '<div class="tb-keys">' +
              MIDI_ACTIONS.map(function(a) {
                return '<span class="tb-key-name">' + MIDI_ACTION_LABELS[a] + '</span>' +
                  '<button id="toc-learn-' + a + '" class="tb-key"></button>' +
                  '<button id="toc-clear-' + a + '" class="tb-clear" title="Clear" aria-label="Clear ' + MIDI_ACTION_LABELS[a] + '">\u2715</button>';
              }).join('') +
            '</div>' +
            '<div id="toc-learn-status" class="tb-learn-status"></div>' +
          '</div>' +
          '<hr class="tb-rule">' +
          '<div class="tb-group">' +
            '<div class="tb-group-title">ToC authoring</div>' +
            '<div class="tb-inline">' +
              '<button id="toc-copy-time" class="tb-btn" title="Copy the video\'s current position as H:MM:SS, ready to paste into a table of contents.">Copy timestamp</button>' +
              '<span id="toc-last-time" class="tb-stamp" title="Last copied timestamp" aria-live="polite">\u2013</span>' +
            '</div>' +
          '</div>';
        controls.style.display = 'none';

        var scroll = document.createElement('div');
        scroll.className = 'tb-scroll';
        scroll.appendChild(body);
        scroll.appendChild(controls);
        box.appendChild(scroll);
        document.body.appendChild(box);

        var showingSettings = false;
        var gearBtn = document.getElementById('toc-gear');
        var titleSpan = document.getElementById('toc-title');
        function renderView() {
          body.style.display = showingSettings ? 'none' : 'block';
          controls.style.display = showingSettings ? 'block' : 'none';
          titleSpan.innerText = showingSettings ? 'Settings' : 'Contents';
          gearBtn.setAttribute('aria-pressed', showingSettings ? 'true' : 'false');
          gearBtn.classList.toggle('tb-on', showingSettings);
          gearBtn.title = showingSettings ? 'Back to contents' : 'Settings';
          gearBtn.setAttribute('aria-label', gearBtn.title);
          scroll.scrollTop = 0;
        }
        gearBtn.onclick = function(e) {
          e.stopPropagation();
          showingSettings = !showingSettings;
          if (box.classList.contains('tb-collapsed')) document.getElementById('toc-min').click();
          renderView();
        };
        renderView();

        var midiCheckbox = document.getElementById('toc-midi');
        var midiStatus = document.getElementById('toc-midi-status');
        midiCheckbox.onchange = function() {
          saveFlag(MIDI_ENABLED_STORAGE_KEY, this.checked);
          if (this.checked) enableMidi(this, midiStatus);
          else { disableMidi(midiStatus); if (learning) cancelLearn(''); }
        };
        midiUi = {
          checkbox: midiCheckbox,
          statusEl: midiStatus,
          learnStatus: document.getElementById('toc-learn-status'),
          learnBtns: {}
        };
        MIDI_ACTIONS.forEach(function(a) {
          var btn = document.getElementById('toc-learn-' + a);
          midiUi.learnBtns[a] = btn;
          btn.onclick = function() { startLearn(a); };
          document.getElementById('toc-clear-' + a).onclick = function() {
            if (learning === a) learning = null;
            midiNotes[a] = null;
            saveMidiNotes();
            renderLearnUi(MIDI_ACTION_LABELS[a] + ' unassigned.');
          };
        });
        renderLearnUi();
        lastStampEl = document.getElementById('toc-last-time');
        document.getElementById('toc-copy-time').onclick = function() { copyTimestamp(); };
        // Restore MIDI if it was on last time. The permission is remembered per
        // origin, so this normally succeeds without a prompt; if it doesn't, the
        // checkbox unticks itself and the status line says why.
        if (midiWanted) {
          midiCheckbox.checked = true;
          enableMidi(midiCheckbox, midiStatus);
        }
        document.getElementById('toc-flash-on').onchange = function() {
          flashEnabled = this.checked;
          saveFlag(FLASH_ENABLED_STORAGE_KEY, flashEnabled);
          if (!flashEnabled) flashEl.style.opacity = '0';
        };

        document.getElementById('toc-min').onclick = function(e) {
          e.stopPropagation();
          var collapse = !box.classList.contains('tb-collapsed');
          box.classList.toggle('tb-collapsed', collapse);
          this.innerText = collapse ? '+' : '\u2013';
          this.title = collapse ? 'Expand' : 'Minimise';
        };

        var active = false, iX, iY;
        var resizing = false, rRight = 0;
        var resizingY = false, rTop = 0;
        head.onmousedown = function(e) {
          if (e.target.closest && e.target.closest('button')) return;
          active = true;
          iX = e.clientX - box.offsetLeft;
          iY = e.clientY - box.offsetTop;
        };
        gripY.onmousedown = function(e) {
          e.preventDefault();
          resizingY = true;
          gripY.classList.add('tb-active');
          rTop = box.getBoundingClientRect().top;
          box.style.maxHeight = 'none';
        };
        grip.onmousedown = function(e) {
          e.preventDefault();
          resizing = true;
          grip.classList.add('tb-active');
          // Anchor to the right edge so the panel grows leftward under the cursor.
          var rect = box.getBoundingClientRect();
          rRight = rect.right;
          box.style.left = 'auto';
          box.style.right = (window.innerWidth - rect.right) + 'px';
        };

        // addEventListener, never `document.onmousemove =`, so the page's own
        // handlers (e.g. a post editor's) are left intact.
        document.addEventListener('mousemove', function(e) {
          if (flashDrag) {
            e.preventDefault();
            flashEl.style.left = (e.clientX - fdX) + 'px';
            flashEl.style.top = (e.clientY - fdY) + 'px';
            return;
          }
          if (resizingY) {
            e.preventDefault();
            var h = Math.max(remPx(PANEL_MIN_HEIGHT_REM), Math.min(e.clientY - rTop, window.innerHeight - rTop - 20));
            box.style.height = h + 'px';
            return;
          }
          if (resizing) {
            e.preventDefault();
            var w = Math.max(PANEL_MIN_WIDTH, Math.min(rRight - e.clientX, window.innerWidth - 40));
            box.style.width = w + 'px';
            return;
          }
          if (!active) return;
          e.preventDefault();
          box.style.left = (e.clientX - iX) + 'px';
          box.style.top = (e.clientY - iY) + 'px';
          box.style.right = 'auto';
        });

        document.addEventListener('mouseup', function() {
          active = false;
          if (flashDrag) {
            flashDrag = false;
            var fr = flashEl.getBoundingClientRect();
            flashPos = { left: fr.left | 0, top: fr.top | 0 };
            try { localStorage.setItem(FLASH_POS_STORAGE_KEY, JSON.stringify(flashPos)); } catch (err) {}
          }
          if (resizing) {
            resizing = false;
            grip.classList.remove('tb-active');
            try { localStorage.setItem(WIDTH_STORAGE_KEY, String(box.getBoundingClientRect().width | 0)); } catch (err) {}
          }
          if (resizingY) {
            resizingY = false;
            gripY.classList.remove('tb-active');
            try { localStorage.setItem(HEIGHT_STORAGE_KEY, String(box.getBoundingClientRect().height | 0)); } catch (err) {}
          }
        });
      })
      .catch(e => {
        console.error('[toc-bookmarklet]', e);
        alert('TOC bookmarklet error: ' + (e && e.message ? e.message : e) + '\n(see console for details)');
      });
  }
})();
