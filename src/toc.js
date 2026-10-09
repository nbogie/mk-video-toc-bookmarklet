// Pure TOC parsing and navigation logic. No DOM access.
// Concatenated into the bookmarklet by build.js; also importable in Node for tests.
//
// Two community formats are supported, and may be mixed within one file:
//
//   Leading style (timestamp first):
//     * 0:09:13 **Scales** and key visualisations
//   Trailing style (timestamp last, usually "(@M:SS)"):
//     3. Connecting Triad Inversions Practice. (@54:35)
//     1. Major Scales: D, A, Bb. Explanation: @9:50 - Practice: @18:10   <- two entries
//
// Lines with no timestamp are ignored.

var TIMESTAMP_RE = /\d{1,2}:\d{2}(?::\d{2})?/g;

// Lines longer than this are truncated before any regex sees them. A couple of the
// cleanup regexes are quadratic on pathological runs of punctuation; a TOC line is
// never anywhere near this long, so the cap costs nothing and bounds the worst case.
var MAX_LINE = 2000;
function splitLines(md) {
  return md.split('\n').map(function(l) { return l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l; });
}

function toSec(t) {
  var p = t.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

// Strip a leading bullet marker ("* ", "- ", "+ ") but keep numeric list numbers ("1.", "0.2.").
function stripBullet(t) {
  return t.replace(/^\s*[-*+]\s+/, '');
}

// Tidy a title fragment: drop markdown emphasis and leading heading markers, "@"
// markers, empty parens, and stray separators left where a timestamp was cut out.
// A "#" inside the text is kept: it may be a sharp ("F#") or a number ("case #3").
function cleanTitle(t) {
  return t
    .replace(/^\s*#+\s*/, '')
    .replace(/\*/g, '')
    .replace(/@/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:,]+/, '')
    .replace(/[\s\-–—:,(]+$/, '')
    .trim();
}

function findTimestamps(line) {
  var out = [], m;
  TIMESTAMP_RE.lastIndex = 0;
  while ((m = TIMESTAMP_RE.exec(line)) !== null) {
    out.push({ time: m[0], index: m.index, end: m.index + m[0].length });
  }
  return out;
}

// Parse one line into zero or more entries.
function parseLine(line) {
  var stamps = findTimestamps(line);
  if (!stamps.length) return [];

  var prefix = line.slice(0, stamps[0].index);
  // Leading style: nothing but bullets / list numbers / punctuation before the first timestamp.
  var isLeading = /^[\s\-*+#\d.()@\[\]]*$/.test(prefix);

  if (isLeading) {
    var title = cleanTitle(line.slice(stamps[0].end));
    return [{ time: stamps[0].time, sec: toSec(stamps[0].time), title: title }];
  }

  // Trailing style. Segment i is the text between timestamp i-1 and timestamp i.
  var segments = stamps.map(function(s, i) {
    return line.slice(i === 0 ? 0 : stamps[i - 1].end, s.index);
  });
  var base = cleanTitle(stripBullet(segments[0]));

  if (stamps.length === 1) {
    return [{ time: stamps[0].time, sec: toSec(stamps[0].time), title: base }];
  }

  // Several timestamps: "<common sentence>. <label0>: @t0 - <label1>: @t1".
  // Share the common sentence across entries so each title stands alone.
  var common = '', label0 = base;
  var split = base.match(/^(.*[.;!?])\s+(\S.*)$/);
  if (split) { common = split[1]; label0 = split[2]; }

  return stamps.map(function(s, i) {
    var label = i === 0 ? label0 : cleanTitle(segments[i]);
    var title = (common + ' ' + label).trim();
    return { time: s.time, sec: toSec(s.time), title: title };
  });
}

// Non-timestamp metadata from a TOC file:
//   url     - first http(s) URL found on a line with no timestamp (e.g. "Video: https://..."),
//             i.e. where this session's video lives
//   heading - first non-empty line that has neither a timestamp nor a URL, stripped of
//             markdown markers (e.g. "Session 1"); null if none
function extractMeta(md) {
  var url = null, heading = null;
  splitLines(md).forEach(function(line) {
    if (findTimestamps(line).length) return;
    var u = line.match(/https?:\/\/[^\s)\]>"']+/);
    if (u) { if (!url) url = u[0]; return; }
    if (heading === null) {
      var h = cleanTitle(stripBullet(line));
      if (h) heading = h;
    }
  });
  return { url: url, heading: heading };
}

// Indentation width of a line in columns (tab = 4).
function indentOf(line) {
  var m = line.match(/^[ \t]*/)[0];
  return m.replace(/\t/g, '    ').length;
}

// Parse markdown into an array of nodes in FILE ORDER (never sorted: authors control
// the order, and un-timestamped headings have no time to sort by).
//   { time, sec, title, depth, parent, notes }
//   - sec === null for a heading: an un-timestamped line that has indented lines beneath it
//     AND does not end like a sentence (e.g. "* Messages", "Warm up"). Headings can't be
//     jumped to; they exist for readability. A sentence ("Focus on how they relate to...")
//     followed by indented timestamps is a note on the preceding entry, not a heading.
//   - depth: nesting level from indentation (0 = top level)
//   - parent: title of the immediate parent node, or null
//   - notes: un-timestamped lines attached to the nearest preceding node at the same or a
//     shallower indent (practice instructions, URLs, asides)
// Un-timestamped lines before the first node (e.g. "Session 1", "Video: https://...") are
// ignored; extractMeta reads those separately.
function parseEntries(md) {
  var lines = splitLines(md);
  // Pass 1: raw nodes with indent.
  var raw = lines.map(function(line) {
    if (!line.trim()) return null;
    return { line: line, indent: indentOf(line), entries: parseLine(line) };
  });

  var out = [];
  var stack = []; // open ancestors: { indent, node }
  // Parent of a new node at `indent`: nearest open node strictly shallower.
  function parentFor(indent) {
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    return stack.length ? stack[stack.length - 1] : null;
  }
  // Owner of a note at `indent`: nearest open node at the same or a shallower indent.
  function ownerFor(indent) {
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
    return stack.length ? stack[stack.length - 1] : null;
  }
  function hasChildren(i) {
    for (var j = i + 1; j < raw.length; j++) {
      if (!raw[j]) continue;
      return raw[j].indent > raw[i].indent;
    }
    return false;
  }

  raw.forEach(function(r, i) {
    if (!r) return;
    if (r.entries.length) {
      var par = parentFor(r.indent);
      r.entries.forEach(function(e) {
        e.depth = par ? par.node.depth + 1 : 0;
        e.parent = par ? par.node.title : null;
        e.notes = [];
        out.push(e);
      });
      stack.push({ indent: r.indent, node: r.entries[r.entries.length - 1] });
      return;
    }
    var text = cleanTitle(stripBullet(r.line));
    if (!text) return;
    var endsSentence = /[.!?]$/.test(text);
    if (hasChildren(i) && !endsSentence) {
      var hp = parentFor(r.indent);
      var h = { time: null, sec: null, title: text, depth: hp ? hp.node.depth + 1 : 0,
                parent: hp ? hp.node.title : null, notes: [] };
      out.push(h);
      stack.push({ indent: r.indent, node: h });
      return;
    }
    var owner = ownerFor(r.indent);
    if (owner) owner.node.notes.push(text);
    // else: before the first node (title line, Video: line) — ignored here.
  });
  return out;
}

function hasTime(e) { return e && e.sec !== null && e.sec !== undefined; }

// ---- Navigation is by TIME, not array position, so file order never matters. ----

// Index of the timestamped entry whose section contains `now` (largest sec <= now), or -1.
function currentIndex(entries, now) {
  var idx = -1, best = -Infinity;
  for (var i = 0; i < entries.length; i++) {
    if (hasTime(entries[i]) && entries[i].sec <= now && entries[i].sec > best) { best = entries[i].sec; idx = i; }
  }
  return idx;
}

// Index of the timestamped entry with the smallest sec more than `tolerance` ahead of `now`, or -1.
function nextIndex(entries, now, tolerance) {
  var idx = -1, best = Infinity;
  for (var i = 0; i < entries.length; i++) {
    if (hasTime(entries[i]) && entries[i].sec > now + tolerance && entries[i].sec < best) { best = entries[i].sec; idx = i; }
  }
  return idx;
}

// Media-player "previous": restart the current section, unless we're within
// `restartThreshold` seconds of its start, in which case go to the one before it in time.
// Returns -1 if there are no timestamped entries.
function prevIndex(entries, now, restartThreshold) {
  var cur = currentIndex(entries, now);
  if (cur < 0) {
    // Before the first timestamp: go to the earliest one.
    return nextIndex(entries, -Infinity, 0);
  }
  if (now - entries[cur].sec > restartThreshold) return cur;
  var before = currentIndex(entries, entries[cur].sec - 0.001);
  return before < 0 ? cur : before;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toSec, parseLine, parseEntries, extractMeta, hasTime, currentIndex, nextIndex, prevIndex };
}
