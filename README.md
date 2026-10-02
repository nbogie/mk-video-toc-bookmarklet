# mk-video-toc-bookmarklet

A browser bookmarklet that adds a clickable table of contents to the embedded Wistia videos on a
Thinkific-hosted course site, with keyboard shortcuts and optional MIDI-keyboard control.
The tables of contents are community-written Markdown files hosted in a GitHub gist.

## What it does

- Reads the current video's id from the page, fetches the matching Markdown file from the gist,
  and shows a floating panel listing the sections. Click an entry to jump there.
- Alt/Option + Left/Right step to the previous/next timestamp. `c` (fullscreen only) shows the
  current section.
- Optional Web MIDI control: map notes on a connected MIDI keyboard to next/previous/pause/"where
  am I?"/copy-timestamp.
- A flash message over the video on every jump, also in fullscreen.
- An "Other sessions" list linking to the other videos that have a table of contents.

## Security model (read this first)

A bookmarklet runs with the authority of whatever page it is clicked on. This one therefore:

- does nothing at all unless the page is `https://` on the configured course host;
- loads no code from anywhere — it is a single static script with zero runtime dependencies;
- renders gist content as text only, never as HTML;
- makes only unauthenticated, read-only GET requests to GitHub; it does not collect your data (GitHub sees the request, as with any web fetch);
- is distributed unminified, so what you install is byte-for-byte what is in `src/`.

See `CLAUDE.md` for the full rules and the pre-release checklist.

## Configuration

The gist that holds the tables of contents and the course hostname are **build-time
configuration**, not source. Copy `.env.example` to `.env` and fill in:

```
TOC_GIST_USER=     # GitHub user who owns the gist
TOC_GIST_ID=       # the gist id
TOC_ALLOWED_HOSTS= # course hostname(s), comma-separated
```

The gist holds one Markdown file per video, named so that the filename contains the video's
Wistia hashed id (e.g. `001-<hashedId>.md`). Two Markdown styles are understood; see the
synthetic examples in `example-inputs/`.

## Build, test, release

```
npm install        # once
npm test           # unit tests against the synthetic fixtures
npm run build      # writes dist/: bookmarklet.txt (the javascript: URL), bookmarklet.shipped.js,
                   # bookmarklet.sha256, install.html, plus an optional minified variant
npm run check      # audit + dependency tree + tests (pre-release)
npm run deploy     # build, then publish dist/install.html to Netlify (needs NETLIFY_SITE_ID,
                   # INSTALL_PAGE_URL in .env and a one-time `npx netlify-cli login`)
```

`dist/install.html` is a self-contained page from which users drag the bookmarklet to their
bookmarks bar. It embeds the gist id, so host it somewhere unlisted and share the address only
with the course community.

## Verifying an installed bookmarklet

See `docs/VERIFYING.md`. It describes, without commands to paste, how to confirm that an installed
bookmark is identical to what this repository builds. The build also writes `dist/bookmarklet.sha256`
for publishing alongside releases.

## Real data

The real tables of contents are not in this repository; they live in a private companion
repository together with tests that run this parser over them. The fixtures here are synthetic:
same syntax, unrelated content.

## License

MIT
