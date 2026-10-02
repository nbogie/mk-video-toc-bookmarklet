# Verifying an installed bookmarklet

This page is for the technically minded. Nothing here asks you to paste a command; it describes what to
compare and leaves the tools to you. It lives in the public repository on purpose: a check only means
something when the reference comes from somewhere other than the page you installed from.

## What you are checking

A bookmark holds a single long address starting with `javascript:`. The install page builds that address
from this repository's source with three values filled in: the GitHub user and id of the gist that holds
the tables of contents, and the hostname of the course site. Nothing else is added. So the address in your
bookmark should be identical to the one a build of this repository produces with the same three values.

## How to compare

1. Get the text of your bookmark. In your browser, edit the bookmark and copy its address into a plain-text
   file. Don't open it in a word processor, which will reformat it.
2. Get the reference text. Either build it yourself (clone this repository at the version shown on the
   install page, put the three values in a `.env` file as `.env.example` describes, run the build, and take
   `dist/bookmarklet.txt`), or use the copy attached to the matching release on the repository's Releases
   page when one exists.
3. Compare the two files with any text-comparison tool: your editor's compare feature, a diff tool, or an
   online diff if the text isn't sensitive to you. They must be identical apart from a trailing line break.

If you prefer a fingerprint, compute the SHA-256 of your bookmark's text with your operating system's own
checksum tool and compare it with the fingerprint published for that version on the Releases page. The
tool's name differs by system, and looking up how to use it yourself is a better habit than running a
command from a web page.

## Reading the code

The bookmark text is the source code with spaces and symbols escaped for a URL. Any URL-decoding tool turns
it back into readable JavaScript, which matches `dist/bookmarklet.shipped.js` from the build. The code is
about 1,000 lines, unminified and commented in the source, and the repository's `CLAUDE.md` explains the
rules it follows: it only runs on the course site, loads no code from anywhere, and does not collect your data.

## What this does and doesn't prove

It proves the bookmark you installed is what this repository builds. It does not prove the repository is
benign; for that, read the code, or trust someone who has.
