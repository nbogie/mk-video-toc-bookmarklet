# Project: Course Video TOC Bookmarklet

## Purpose
A client-side browser bookmarklet for embedded Wistia videos on a Thinkific-hosted course site (the host is
build-time configuration, `TOC_ALLOWED_HOSTS`; it is never named in this repo). 
It fetches a Markdown Table of Contents (TOC) from a remote GitHub Gist, parses timestamps, and renders a floating, draggable UI overlay that lets users jump to specific points in the video without reloading or breaking playback.

Why?  This online course has embedded streamed videos but no chapter markings and no ways use youtube-style timestamp links to go to a timestamp.  The community have started making timestamped TOCs for each video in the course.  They're hosted as markdown files (one per video) in a secret gist for this prototype to read.  (markdown allows them also to be posted to the community forum for reading by humans, too)
---

## TOP PRIORITY: never interfere with the user's typing or the host page

Users watch a lesson video while writing forum posts, comments or notes in the same tab.
The worst possible outcome of this bookmarklet is someone losing 30 minutes of writing because
a shortcut fired, a keystroke was swallowed, or a page handler was clobbered. Every change to
input handling must be reviewed against this. Concretely:

* **Typing always wins.** Every key handler must call `isTyping(e)` first and bail if focus is in
  or under any editable element: input, textarea, select, contenteditable, `role="textbox"` etc.
  Resolve the target via `composedPath()` so editors inside shadow DOM are detected too.
* **No unmodified letter/arrow shortcuts while the page is usable for typing.** Navigation keys need
  a modifier (Alt/Option + arrows). A bare key (`c`) is only honoured while the video is fullscreen,
  and still goes through `isTyping`.
* **Only `preventDefault`/`stopPropagation` on a key we are definitely handling**, never speculatively.
* **Never assign `document.onX = ...` or `window.onX = ...`.** Always `addEventListener`, so the page's
  own handlers (editor autosave, drag & drop, etc.) are untouched. The one drag handler is a listener.
* **Never move focus** (`.focus()`, `.blur()`) or select text on the page. Overlays use
  `pointer-events:none` so they can't intercept clicks — the one exception is the flash *while visible and not
  fullscreen* (`.tb-shown:not(.tb-fs)`), so it can be hovered (holds it open) and dragged; it reverts to
  `pointer-events:none` the moment it hides, and always in fullscreen.
* **Don't touch page storage** beyond our own namespaced `toc-bookmarklet-*` localStorage keys.
  Never clear storage.
* **MIDI is opt-in** (checkbox off by default) and MIDI notes never map to typing, so MIDI actions
  fire regardless of focus. Keep it that way; do not add MIDI-triggered actions that alter page state.
* **Register every handler exactly once.** All listeners are added inside `start()`, which the `#toc-box` guard runs
  at most once per page. MIDI: hold ONE `MIDIAccess` for the panel's life (`getMidiAccess()` memoises the promise);
  attach/detach port handlers by *assignment* (`input.onmidimessage = fn | null`) so enable/disable is idempotent.
  Requesting a new access on every enable gave each port a duplicate handler and a pause key toggled twice
  (the "says Play but never pauses" bug). Timers: clear before re-arming (`flashTimer`), clear on every exit path
  (`waitForVideo`).
* **Fail silently and locally.** Any exception in our code must not propagate into the page. Prefer
  a console message and a status line in our panel over `alert()` once loaded.

If a feature can't be built within these rules, don't build it.

## Naming rule for this repo

Never write the course site's domain, the course owner's name, the community hub id, or real post URLs anywhere in
this repo (code, docs, fixtures, commit messages). They live only in `.env` and in the private companion repo. The
"mk" prefix on names is fine. Synthetic fixtures use `courses.example.com`.

## SECOND PRIORITY: the bookmarklet must never become a code-injection channel

A bookmarklet has no background presence — it runs only when clicked — but it runs with the full authority of
**whatever page it is clicked on**. On the course page that means the member's session, posting rights and everything
they can see; clicked on their bank's page it would run there with that page's authority. The same-origin policy
stops it reaching other tabs, nothing stops it on the tab it is clicked in. So the supply chain of what members run is
a security boundary. Rules:

* **Host allow-list first.** The very first statement requires `https:` + `location.hostname` in `ALLOWED_HOSTS`
  (injected from `TOC_ALLOWED_HOSTS`; `file:` allowed for local previews/screenshots) and exits with a message otherwise. Nothing
  else runs on any other site, so an accidental click elsewhere is inert.

* **Zero runtime dependencies.** The shipped bookmarklet is only `src/toc.js` + `src/bookmarklet.js`. No CDN scripts,
  no `import()`, no `eval`/`new Function`, no `<script src>`, ever. A "loader that fetches and runs the latest code"
  was considered and **rejected**: it would turn a compromised gist/GitHub account into instant code execution in
  every member's session.
* **Data is never code.** Gist content (TOCs, `Video:` URLs) is rendered only via `innerText`/`textContent`/attribute
  properties, never `innerHTML`. `innerHTML` is used only with string literals — the video id is set afterwards via
  `.title`/`textContent`, so it does not depend on the id regex for safety. Session links are followed only if
  `allowedSessionUrl()` accepts them: `https:` on an `ALLOWED_HOSTS` host; anything else renders as "no link".
  localStorage values are type-checked on read. Parser input lines are capped at 2000 chars (`MAX_LINE`) so the
  cleanup regexes can't be made quadratic by hostile gist content.
* **No third-party code in the default artifact.** `dist/bookmarklet.txt` is built from the *unminified* concatenation
  (comments stripped, percent-encoded), so what members run is byte-for-byte what is in `src/` — reviewable by anyone.
  Minified output has no *runtime* dependency on terser; the concern is only the build chain (a compromised minifier
  could alter the output, and minified code can't be eyeballed against the source). `dist/bookmarklet.min.txt` is
  kept as an optional smaller artifact for when the build machine and lockfile are trusted.
* **The gist id and course host are build-time configuration, not source.** `src/` holds `__GIST_USER__`/`__GIST_ID__`/
  `__ALLOWED_HOSTS__` placeholders;
  `build.js` injects them from `.env`/environment. Never hardcode them back. The public repo
  (`mk-video-toc-bookmarklet`) was created fresh on 2026-10-02 so its history never contained them; the original
  working repo became the private companion (`mk-video-toc-bookmarklet-private-resources`) and keeps the real
  fixtures, the audit, and the `.env` values.
* **Build-time deps are minimal and pinned.** Only `terser` (dev). `package-lock.json` carries sha512 integrity for
  every package; never `npm install` a new dep casually, never `--no-package-lock`.
* **Nothing leaves the page.** The only network calls are GET `api.github.com/gists/<id>` and the gist raw URL, both
  unauthenticated, both read-only. No page data, cookies or member info is ever sent anywhere.
* **Distribution is static.** Members install a fixed bookmarklet (install page / paste), and updates require a
  reinstall. That friction is the point.

* **Known, accepted:** element ids are `toc-*`; a host page using the same ids would break the panel (no security
  impact). Each use discloses the user's IP and the course origin (referrer) to GitHub. An external audit on
  2026-10-02 (kept in the private companion repo) found no exploitable issues; its hardening points are applied above.

### Pre-release security checklist (run before every main release; there have been none yet)

1. `npm audit` → 0 vulnerabilities; `npm ls --all` shows only terser and its transitive deps.
2. `grep -n "https\?://\|<script\|\.src\s*=\|import(\|eval(\|new Function\|innerHTML" src/` — every hit is a
   literal or a validated id; no new network endpoints.
3. Every place gist data or localStorage reaches the DOM/APIs still goes through text properties or validation.
4. `dist/bookmarklet.txt` decodes to the unminified source (`node -e "console.log(decodeURI(require('fs').readFileSync('dist/bookmarklet.txt','utf8').slice(11)))"` and diff against `dist/bookmarklet.js` minus comments).
5. The typing-safety rules above still hold for any new input handling.
6. Bump `version` in package.json (it is stamped into the panel tooltip and the install page), `npm run deploy`,
   and tell members to reinstall from the install page.

---

## Technical Environment & Key Findings

### 1. Video Player Architecture
* **Engine:** Wistia player (`wistia_async_<hashedId>` embed).
* **DOM Structure:** Wistia inserts a standard HTML5 `<video>` element directly into the DOM (e.g., `#wistia_simple_video_81`).
* **Direct DOM Control Works:** Standard HTML5 media properties (`video.currentTime = seconds; video.play()`) work reliably once the element is initialized.

### 2. Initialization & Lazy Loading Dynamics
* **DOM Delay:** The `<video>` tag is not always present in the initial static DOM response. Wistia mounts or dynamically inserts the element upon user interaction or player load.
* **Prerequisite:** Users must click "Play" at least once (or let the player initialize) before the script can locate the `<video>` element.
  Before first play the page (Thinkific) shows only a thumbnail button (`data-qa="video-thumbnail-button"`, image from
  `platform.thinkific.com/videoproxy/v1/videos/<thinkificId>/thumbnail`). No Wistia id exists in the DOM at that point, and the
  Thinkific id is a different namespace, so the TOC cannot be chosen yet. The bookmarklet therefore shows a "press play" panel and
  polls (500ms, up to 3 min) for a `<video>` with a resolvable Wistia id, then continues automatically. It never clicks play itself.
* **Recursive Locator (`findV`):** To handle potential shadow DOM trees, frame boundaries, or dynamic wrapper shifts, we use a recursive finder (`findV`) to scan `document` and any accessible child `iframe` elements.

### 3. Execution Constraints & Browser Restrictions
* **No CSP Obstacles:** The target site does NOT issue a restrictive `Content-Security-Policy` (CSP) header (`script-src`), allowing direct bookmarklet execution via `javascript:...`.
* **URL Encoding & Single-Line Rules:** Chromium-based browsers quietly fail on raw JS bookmarklets with line breaks or unencoded special characters (`#`, `%`, spaces). Source code must be minified and prefixed with `javascript:`.

### 4. Remote Data Format
* **Source:** One *secret* GitHub Gist holding one Markdown file per video. A file belongs to a video if its
  **filename contains the Wistia hashed id** anywhere, e.g. `001-<hashedId>.md` (a human slug is welcome).
  Lookup: `GET https://api.github.com/gists/<gistId>` (CORS `*`, no auth, includes file contents inline unless
  `truncated`), filter filenames by id, take the first alphabetically. Fallback if the API fails (60 req/hr/IP
  unauthenticated): raw URL for the plain `<id>.md` name.
  The real per-session ids are listed in the private companion repo's README, not here.
  No matching file means "no TOC yet" and the panel says so with the id, rather than alerting. The Gist is secret (unlisted) because the course is
  private and paid; TOCs must not be published in a public repo.
* **Video identification:** Wistia hashed id from the embed wrapper class `wistia_async_<id>` (walk up
  from the `<video>` with `closest`), falling back to the `<source src="…/medias/<id>.m3u8">` URL, then
  any `[class*=wistia_async_]` in the document. The `<video aria-label>` carries the media title
  (e.g. "Practice community call 16_09_26HB.mp4"; naming is inconsistent across sessions, and it is sometimes just an
  opaque upload id like `dacjri12vnes72pm64sg`, which we discard). The panel subtitle is the gist session heading
  ("Session 2") followed by that title when present.
  All four sessions seen so far share an identical wrapper structure (`#wistia_video.wistia_embed.wistia_async_<id>`
  > `<video id="wistia_simple_video_NN" aria-label="...">` > `<source src=".../medias/<id>.m3u8">`).
* **Cache Bypassing:** Requests must append a timestamp query param (`?t=Date.now()`) to ensure live updates to the Gist are fetched immediately.
* **Timestamp Format:** `M:SS`, `MM:SS`, and `H:MM:SS` (e.g., `0:30`, `10:30`, `1:15:00`, `0:01:30`).
* **Two TOC styles, decided per line** (see `src/toc.js` header; both may appear in one file):
  * *Leading*: timestamp first, e.g. `* 0:09:13 **Scales** and key visualisations`. Title = text after the timestamp.
    Detected when only list decoration (bullets, `#`, list numbers, brackets, `@`) precedes the first timestamp.
  * *Trailing*: title first, e.g. `3. Connecting Triad Inversions Practice. (@54:35)`. Title = text before the
    timestamp, `(@ )` and stray separators stripped, numeric list numbers kept, bullets dropped.
    A trailing-style line with several timestamps (`... Explanation: @9:50 - Practice: @18:10`) yields one entry
    per timestamp; the sentence before the labels is shared across them.
  * **Nesting** (from indentation; tab = 4 cols) is kept: each node has `depth` and `parent` (immediate parent's title).
    An un-timestamped line is a **heading** (`sec: null`, not jumpable, rendered as a label, e.g. "Messages") only if
    it has indented lines beneath it AND does not end like a sentence (`.`/`!`/`?`). Any other un-timestamped line is
    a **note** on the nearest preceding node at the same or a shallower indent, shown in that row's tooltip. Session 5
    (another author) writes notes as top-level paragraphs under each entry and sometimes indents child timestamps
    right after a sentence — that sentence must stay a note, never become the children's parent.
  * **File order is preserved, never sorted** — authors control order and headings have no time. Navigation
    (`currentIndex`/`nextIndex`/`prevIndex`) is therefore by *time*, not array position, and skips headings.
    Next/previous always mean next/previous *timestamp*, regardless of depth.
  * `extractMeta` separately reads two un-timestamped lines: the first
    `http(s)://` URL (`Video: https://<course host>/hub/community/<hubId>?post=<postId>`, the
    community post embedding the video) and the first plain heading line (`Session N`).
  * Markdown `*`/`#` are stripped from titles; a trailing `:` is dropped.
  * `@` is treated as noise, never as a format signal.

### Decisions / constraints (don't relitigate without asking)

* Preserve `findV` resilience: never replace the recursive video finder with a simple `document.querySelector('video')`.
* The bookmarklet is **passive**: it never presses play, even when there is exactly one video on the page.
* TOC data stays in a **secret gist**, not a public repo (course is private/paid). Code repo may become public; data won't.
* Commits are authored by the user only — no Claude co-author trailers.
* Keep the code small and boring in preference to clever detection; brittleness is worse than a missing convenience.
---

## File Structure & Build Pipeline

* `src/toc.js`: Pure parsing (`parseLine`, `parseEntries`, both TOC styles) + prev/next navigation logic. No DOM. Importable in Node for tests.
* `src/bookmarklet.js`: Bookmarklet entry point (DOM, fetch, UI, MIDI, keyboard). Not runnable on its own; depends on `toc.js`.
* `build.js`: Concatenates both sources into a single IIFE, minifies with terser, and percent-encodes. Injects
  `__VERSION__` (package.json), `__GIST_USER__`/`__GIST_ID__`/`__ALLOWED_HOSTS__` from `TOC_GIST_USER`/`TOC_GIST_ID`/
  `TOC_ALLOWED_HOSTS` — read from the
  environment, else from the gitignored `.env` (see `.env.example`). The build fails if either is missing or if any
  `__PLACEHOLDER__` survives. **The source never contains the gist id**, so the repo can be made public; in CI the
  values come from repository variables/secrets.
* `.env` (gitignored): local build config. `.env.example`: committed template.
* `dist/bookmarklet.js`: Readable single-file build. Paste into the DevTools console on a lesson page to test.
* `dist/bookmarklet.min.js`: Minified output.
* `dist/bookmarklet.txt`: Ready-to-copy `javascript:...` bookmarklet string (unminified; default release artifact).
* `dist/bookmarklet.min.txt`: Same, minified (optional; see security section).
* `dist/install.html`: self-contained install page (drag link + copy box + steps for Chrome/Safari, Win/Mac). Hosted
  on Netlify (`NETLIFY_SITE_ID`/`INSTALL_PAGE_URL` in `.env`; `X-Robots-Tag: noindex`; the address is not written
  in this repo). It embeds the gist id, so only post that URL in the members-only forum. Static: each release =
  `npm run deploy` (build + `npx netlify-cli deploy`; needs a one-time `npx netlify-cli login`). The Netlify CLI is
  pinned in `deploy.js` and run via npx — it is never a project dependency.
  **How the install page is deployed, explicitly:** it is a *generated* file (`dist/` is gitignored) that is **not
  revision-controlled anywhere** — not in this repo, not in a repo of its own. The Netlify site is **not connected to
  GitHub** and there is **no CI/CD**: every publish is a manual `npm run deploy` from a developer machine that has the
  `.env` values, pushing the freshly built `dist/install.html` (plus a `_headers` file) with the Netlify CLI. The
  Netlify's free-plan "built with Netlify" badge and "HUD" (both inject third-party script into the page at the
  edge) are **disabled** on the site (`built_with_badge_enabled: false`, `hud_enabled: false` via the API) — keep
  them off; the install page must carry no third-party code. The
  page is therefore reproducible from a commit + `.env`, and "what is live" = "the last manual deploy", which is why
  the release checklist says to deploy right after bumping the version. (Netlify keeps its own deploy history, which
  is the only record of past versions.)
* Version: `package.json` → stamped into the panel title tooltip (`__VERSION__` replaced by build.js) and the install page.
  Bump it for every release.
* `dist/` is **gitignored** (fully derived; rebuild with `npm run build`). Distribution channel TBD (release asset or similar).
* `test/toc.test.js`: Node built-in test runner (`node:test`), no test deps.
* `example-inputs/`: **synthetic** fixtures (a detective agency run by forest animals — no course content, no music) that mirror the five real community TOC *syntaxes* (`001`-`003-old-style.md`:
  title first, `(@M:SS)` last; `004-new-style.md`: timestamp first, nested bullets, a heading; `005-new-style.md`:
  another author, `M:SS - **Title**`, top-level note paragraphs). Safe to publish. Any new real-world quirk gets a
  synthetic reproduction here plus the real file in `private/`.
* Real fixtures + `toc-private.test.js` live in the private companion repo (`mk-video-toc-bookmarklet-private-resources`),
  checked out beside this one; its test loads this repo's `src/toc.js` (override with `TOC_SRC`).

### Commands

```
npm install      # once; installs terser (only dev dependency)
npm test         # runs test/*.test.js with node --test
npm run build    # writes dist/
npm run check    # audit + dep tree + tests (pre-release)
npm run deploy   # build, then publish dist/install.html to the unlisted Netlify site
```

Requires Node 18+ (uses `node --test`).

### Styling

* One `<style id="toc-style">` is injected per document (`ensureStyle(doc)`; also into the fullscreen element's document when the flash is re-parented there, since a stylesheet, unlike inline styles, doesn't travel with the element), scoped under `#toc-box` / `#toc-flash` with explicit resets on
  `button`/`input`, so we neither leak styles into the host page nor inherit its button styling. No inline style strings.
* Palette (piano materials): ebony `#1B1815` panel, ivory `#EDE4CF` text, mid ivory `#CFC5B0` for list titles, dim ivory `#AFA592` secondary (kept ≥7:1 on ebony — many users are 60+), baize green
  `#5C8A6A` for the one live signal (section now playing, focus rings), brass `#C9A453` only for attention (listening for a
  key, missing contents). Single system sans, tabular figures for times. No all-caps labels, no monospace.
* The contents list is a 3-column grid: a continuous rail, title (wraps, never truncates), then the time at the right edge, smaller and dimmer — title first, time as an aside, same priority as the flash. Child rows indent 14px per level (capped at 3); top-level jumpable titles are ivory, children mid; headings are dim labels. The rail
  segment for the section now playing is baize; it follows playback via a `timeupdate` listener (display only).
* Copy: "Contents", "Other sessions" (the fold-out; the current one is listed too, marked "this video"), "Settings".
  Settings order: Keyboard shortcuts → Flash messages (tooltip explains) → MIDI keyboard (tooltip explains; needs
  permission) → MIDI mappings ("Click a control, then press the MIDI note to use for it.") → rule → "ToC authoring".
  Say "MIDI note", never "key", to avoid confusion with computer keys.
* Preview without a real page: `scratchpad/preview*.html` pattern — fake `.wistia_async_<id>` wrapper + `<video>`, inline
  `dist/bookmarklet.js`, screenshot with headless Chrome (`--virtual-time-budget` so the gist fetch completes).
* Built bookmarklet is ~27 KB as a `javascript:` URL (CSS included); fine for Chrome/Firefox bookmarks.

### Features (current)

* Click a TOC row to seek. Alt + Left/Right = previous/next timestamp (YouTube chapter keys). The hint shows ⌥ on Mac and "Alt" elsewhere (platform-detected).
* Settings persist in localStorage under `toc-bookmarklet-*` keys: MIDI on/off, flash on/off, learned notes,
  panel width and height, flash position (dragged; applies outside fullscreen only). (`toc-bookmarklet-settings-open`
  is no longer used.) Keys are stable across code versions; never rename them casually.
* Optional MIDI control (checkbox): defaults to top four keys of a 61-key board: 96 = next, 95 = prev, 94 = pause/play toggle, 93 = where am I. Degrades gracefully with no Web MIDI or no device.
* "Where am I?": flashes the current section. MIDI default note 93; keyboard `c` **only while fullscreen** (see priority section).
* Authoring (first of an eventual "advanced" settings group): "Copy current timestamp" button copies `H:MM:SS`
  of the current position to the clipboard and shows it in a readonly field (fallback when clipboard is refused,
  which browsers may do for non-gesture triggers such as MIDI). MIDI-learnable as `copyTime`, **unassigned by default**.
* Every MIDI action has a ✕ clear button to unassign it (stored as `null`).
* MIDI learn: "Next timestamp"/"Previous timestamp"/"Pause"/"Where am I?"/"Copy timestamp" rows in the panel; click one, press a key, mapping is saved to localStorage (`toc-bookmarklet-midi-notes`). Esc or a second click cancels. Clicking learn auto-enables MIDI.
* Flash message on every seek (checkbox to disable): `→`/`←` direction arrow (from actual travel, so TOC clicks get it
  too) in its own column to the left of both lines, then **title** with the timestamp as a smaller, dimmer aside; if the
  entry has a parent, the parent's title is a smaller line above (one level only, never the grandparent).
  `flash(main, aside, context, icon)`; also `▶ Play`/`⏸ Paused`, `◎ current section`, `⌸ Copied H:MM:SS`, `End of contents`.
  Re-parented into the fullscreen element so it shows in fullscreen too (not possible if a bare `<video>` is fullscreened).
* "Prev" restarts the current section unless within 2s of its start, then goes back one more. "Next" skips anything within 0.5s.
* **Two views, never both**: the cog in the header swaps the scroll area between the contents view (video title,
  list, sessions toggle) and the settings view; the header title reads "Contents"/"Settings" and the cog is shown
  pressed (ivory on ebony) while in settings. Clicking the cog on a minimised panel expands it. Header buttons are
  exempt from the drag handle (`closest('button')`).
* Panel layout: `#toc-box` is a flex column that never scrolls itself; the header and the two resize grips sit outside a `.tb-scroll` area that holds everything else (grips inside a scrolling element scroll away — that was a bug). Draggable title bar; width grip on the left edge (min 300px, grows leftward since right-anchored) and height grip on the bottom edge (min 22rem = half the 44rem default cap); both have a small visible pill. `–` minimise, collapsible **Settings** section (state persisted), video title under the header
  with the Wistia id in the tooltip. (The old "collapsible Settings section" below the list is gone.)
* **Sessions list** (collapsed toggle at the bottom of the *contents* view — low traffic for now; it is not a setting): one row per gist file, label from the file's heading
  (fallback `Session N` from the `NNN-` filename prefix), current video highlighted. Clicking opens the session's
  `Video:` URL in a **new tab** (`window.open(..., '_blank', 'noopener')`) — never the current tab, because the hub is
  where people write posts. The bookmarklet must be clicked again on the new tab; same-tab navigation would lose the UI
  just the same, so there's nothing to gain by it. Only available via the Gist API path (raw fallback has no file list).
* Startup: if the panel already exists, exit. If no player yet, show a "press play" panel and poll (never auto-plays).
  Errors after load: `console.error('[toc-bookmarklet]', e)` + one alert with the real message (not a generic one).
