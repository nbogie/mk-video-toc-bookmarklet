const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { toSec, parseLine, parseEntries, extractMeta, hasTime, currentIndex, nextIndex, prevIndex } = require('../src/toc.js');

// Synthetic fixtures in example-inputs/ reproduce the *syntax* of real community TOCs
// (which live in a private companion repo) with entirely unrelated content.
const fixture = n => fs.readFileSync(path.join(__dirname, '..', 'example-inputs', n), 'utf8');
const newStyle = fixture('004-new-style.md');

test('toSec handles M:SS, MM:SS and H:MM:SS', () => {
  assert.equal(toSec('0:30'), 30);
  assert.equal(toSec('10:30'), 630);
  assert.equal(toSec('1:15:00'), 4500);
  assert.equal(toSec('0:01:30'), 90);
});

test('004 new style: file order, headings, depth, parents, notes', () => {
  const nodes = parseEntries(newStyle);
  const timed = nodes.filter(hasTime);
  assert.equal(timed.length, 21);
  assert.equal(nodes.length, 22, 'plus the "Messages" heading');
  assert.deepEqual(nodes[0], { time: null, sec: null, title: 'Messages', depth: 0, parent: null, notes: [] });
  assert.equal(nodes[1].title, 'Welcome back, detectives');
  assert.equal(nodes[1].depth, 1);
  assert.equal(nodes[1].parent, 'Messages');
  assert.deepEqual(nodes[1].notes, ["Remember you don't need to solve every case each week."]);
  const byTitle = t => nodes.find(n => n.title === t);
  assert.equal(byTitle('Footprints and trail reading').depth, 0, 'markdown bold stripped, trailing colon dropped');
  assert.equal(byTitle('Fox prints').parent, 'Footprints and trail reading');
  assert.equal(byTitle('Key of the Cellar Door').parent, 'Exercise 3: Lock-picking exercise.');
  assert.deepEqual(byTitle('Exercise 3: Lock-picking exercise.').notes, ['Left paw: hold the pin.', 'Right paw: turn the twig.', 'Sequence: 1 6 2 5 1']);
  assert.deepEqual(byTitle('optional variant: silent entry').notes, ['start at the back door then move to the window', 'ground floor rooms only']);
  assert.equal(byTitle('optional variant: silent entry').parent, 'Exercise 4 (Case): "The Vanishing Picnic".');
  assert.deepEqual(timed[timed.length - 1], { time: '1:05:30', sec: 3930, title: 'Wrap.', depth: 0, parent: null, notes: [] });
  for (let i = 1; i < timed.length; i++) assert.ok(timed[i].sec >= timed[i - 1].sec, 'this file happens to be in time order');
});

test('un-timestamped lines become notes or headings, never jumpable entries', () => {
  const nodes = parseEntries(newStyle);
  const timedTitles = nodes.filter(hasTime).map(e => e.title);
  assert.ok(!timedTitles.some(t => /Around the pond/.test(t)));
  assert.ok(!timedTitles.some(t => /Sequence/.test(t)));
  assert.ok(!timedTitles.some(t => t === 'Messages'));
  const messages = nodes.find(n => n.title === 'Messages');
  assert.ok(messages && !hasTime(messages), 'Messages is a heading');
  assert.ok(nodes.some(n => n.notes.some(x => /Around the pond/.test(x))), 'the note survives on its parent');
});

test('parseEntries keeps file order and does not sort', () => {
  const nodes = parseEntries('* 10:00 B\n* 0:30 A\n* 5:00 C');
  assert.deepEqual(nodes.map(n => n.title), ['B', 'A', 'C']);
  assert.equal(nextIndex(nodes, 0, 0.5), 1, 'navigation is by time: A (0:30) is next after 0');
  assert.equal(nextIndex(nodes, 31, 0.5), 2, 'then C (5:00)');
  assert.equal(nextIndex(nodes, 301, 0.5), 0, 'then B (10:00)');
  assert.equal(currentIndex(nodes, 400), 2);
  assert.equal(prevIndex(nodes, 301, 2), 1, 'just after C: back to A');
});

test('headings and notes: tabs, session/video lines ignored, lone bullets become notes', () => {
  const nodes = parseEntries('Session 9\nVideo: https://x/y\n* Warm up\n\t* 0:10 Stretches\n\t* keep the tail still\n* 5:00 Patrol');
  assert.deepEqual(nodes.map(n => [n.title, n.sec, n.depth, n.parent]),
    [['Warm up', null, 0, null], ['Stretches', 10, 1, 'Warm up'], ['Patrol', 300, 0, null]]);
  assert.deepEqual(nodes[1].notes, ['keep the tail still'], 'a note attaches to the nearest preceding node at the same or shallower indent');
  assert.deepEqual(nodes[0].notes, []);
});

test('a sentence followed by indented timestamps is a note, not a heading', () => {
  const nodes = parseEntries('* 14:30 - **Exercise: Scent Trails**\nFocus on how they relate to wind.\n    * 15:40 - Fox Trail\n');
  assert.deepEqual(nodes.map(n => [n.title, n.sec, n.parent]), [['Exercise: Scent Trails', 870, null], ['Fox Trail', 940, 'Exercise: Scent Trails']]);
  assert.deepEqual(nodes[0].notes, ['Focus on how they relate to wind.']);
});

test('parseEntries strips markdown emphasis, keeps quotes and parentheses', () => {
  const nodes = parseEntries(newStyle);
  const byTime = t => nodes.find(e => e.time === t).title;
  assert.equal(byTime('0:20:00'), 'Exercise 1: Sniffing inside a hollow log');
  assert.equal(byTime('0:49:00'), 'Exercise 4 (Case): "The Vanishing Picnic".');
  assert.equal(byTime('0:14:50'), 'Heron prints');
});

test('parseEntries accepts "-" or ":" separators', () => {
  const entries = parseEntries('10:00 - Second\n# 0:30: First\n1:00:00 Third');
  assert.deepEqual(entries.map(e => [e.sec, e.title]), [[600, 'Second'], [30, 'First'], [3600, 'Third']]);
});

test('parseEntries on empty input returns []', () => {
  assert.deepEqual(parseEntries(''), []);
  assert.deepEqual(parseEntries('no timestamps here\n* just bullets'), []);
});

// ---- Old style: title first, "(@M:SS)" at the end ----

test('001 old style: trailing timestamps, numbered titles kept, sub-numbered aside becomes a note', () => {
  const e = parseEntries(fixture('001-old-style.md'));
  assert.deepEqual(e.map(x => [x.time, x.title]), [
    ['12:30', '1. Welcome to Bramble Hollow Investigations.'],
    ['21:05', '2. Reading Paw Prints in Soft Mud.'],
    ['34:40', '3. Following a Scent Trail Around the Pond.'],
    ['1:02:15', '4. The Hollow Log Hide-and-Seek Game.'],
    ['1:10:00', '5. Case: The Missing Hazelnut.'],
  ]);
  assert.equal(e[3].sec, 3735);
  assert.deepEqual(e[1].notes, ['2.1. Remember to bring the magnifying acorn.']);
  assert.deepEqual(extractMeta(fixture('001-old-style.md')), { url: 'https://courses.example.com/hub/community/100?post=1001', heading: 'Session 1' });
});

test('002 old style: a line with two timestamps yields two entries sharing the common sentence', () => {
  const e = parseEntries(fixture('002-old-style.md'));
  assert.equal(e.length, 5);
  assert.deepEqual([e[0].time, e[0].title], ['8:40', '1. Disguises: Leaf Hat, Bark Cloak, Moss Beard. Explanation']);
  assert.deepEqual([e[1].time, e[1].title], ['15:10', '1. Disguises: Leaf Hat, Bark Cloak, Moss Beard. Practice']);
  assert.deepEqual([e[4].time, e[4].title], ['52:45', '4. ‘Twas the Badger (opening scene).']);
});

test('003 old style: "0:" items, parenthetical text kept, untimed line becomes a note', () => {
  const e = parseEntries(fixture('003-old-style.md'));
  assert.equal(e.length, 7);
  assert.equal(e[0].title, '0: Why detectives tiptoe.');
  assert.deepEqual(e[0].notes, ['0.1. Show up to the briefing, even if it is raining.']);
  assert.equal(e[1].title, '0.2. The Long Burrow (a map recommendation)');
  assert.equal(e[6].title, '5. Case: The Mystery of the Upturned Boat');
});

test('005 (another author): dash separators, bold, top-level note paragraphs, indented children after a sentence', () => {
  const md = fixture('005-new-style.md');
  assert.deepEqual(extractMeta(md), { url: 'https://courses.example.com/hub/community/100?post=1005', heading: 'Session 5' });
  const nodes = parseEntries(md);
  assert.equal(nodes.filter(hasTime).length, 18);
  assert.equal(nodes.filter(n => !hasTime(n)).length, 0, 'no headings: every un-timestamped line is a sentence or a note');
  const by = t => nodes.find(n => n.title === t);
  assert.deepEqual(by('Purpose of the Exercises').notes, ['Getting the patrols in.']);
  assert.equal(by('Fox Trail').parent, 'Exercise: Scent Trails');
  assert.ok(by('Exercise: Scent Trails').notes.some(x => /Focus on how they relate/.test(x)));
  assert.equal(by('Key: Boathouse').parent, 'Exercise: Case: The Lantern in the Reeds');
  assert.ok(by('An Evidence Tagging Website').notes.some(x => /tools\.example\.com/.test(x)), 'a URL under an entry is a note');
  assert.equal(by('Moving Between Hiding Places (Pond Side)').parent, 'Exercise: Moving Between Hiding Places (Oak Side)');
  assert.equal(by('Moving Between Hiding Places (Pond Side)').depth, 1);
  assert.equal(by('Celebrating a Solved Case \u{1F389}').sec, 285, 'emoji kept');
  let prev = -1; nodes.filter(hasTime).forEach(n => { assert.ok(n.sec >= prev); prev = n.sec; });
});

test('parseLine: leading vs trailing style detection', () => {
  assert.deepEqual(parseLine('* 0:30 Intro').map(x => x.title), ['Intro']);
  assert.deepEqual(parseLine('## 0:30 Intro').map(x => x.title), ['Intro']);
  assert.deepEqual(parseLine('2. 0:30 Intro').map(x => x.title), ['Intro']);
  assert.deepEqual(parseLine('Intro (@0:30)').map(x => x.title), ['Intro']);
  assert.deepEqual(parseLine('Intro @0:30').map(x => x.title), ['Intro']);
  assert.deepEqual(parseLine('Intro - 0:30').map(x => x.title), ['Intro']);
  assert.deepEqual(parseLine('no time here'), []);
});

test('extractMeta: url and heading, ignoring timestamp lines', () => {
  const md = 'Session 1\nVideo: https://courses.example.com/hub/community/1?post=2\n\n1. Briefing (@3:00)\n';
  assert.deepEqual(extractMeta(md), { url: 'https://courses.example.com/hub/community/1?post=2', heading: 'Session 1' });
  assert.deepEqual(extractMeta('* 0:30 Intro\n'), { url: null, heading: null });
  assert.deepEqual(extractMeta('[Video](https://x.y/z) \n# Week 4\n'), { url: 'https://x.y/z', heading: 'Week 4' });
  assert.equal(extractMeta(newStyle).heading, 'Session 4');
});

test('pathological lines are truncated, never quadratic', () => {
  const evil = '0:30 Title' + ' -'.repeat(200000) + '\n' + '* Heading' + ','.repeat(200000) + '\n  * 1:00 Child';
  const t0 = Date.now();
  const nodes = parseEntries(evil);
  assert.ok(Date.now() - t0 < 2000, 'finished quickly');
  assert.equal(nodes[0].sec, 30);
  assert.ok(nodes[0].title.length <= 2000);
});

// Navigation tests use a small synthetic TOC for clarity.
const E = parseEntries('0:00 A\n0:30 B\n1:30 C');

test('currentIndex', () => {
  assert.equal(currentIndex(E, 0), 0);
  assert.equal(currentIndex(E, 29), 0);
  assert.equal(currentIndex(E, 30), 1);
  assert.equal(currentIndex(E, 500), 2);
  assert.equal(currentIndex(parseEntries('0:10 X'), 5), -1);
  assert.equal(currentIndex(parseEntries('* Heading\n  * 0:10 X'), 20), 1, 'headings are skipped');
});

test('nextIndex skips entries within tolerance and returns -1 at the end', () => {
  assert.equal(nextIndex(E, 0, 0.5), 1);
  assert.equal(nextIndex(E, 29.7, 0.5), 2, 'within tolerance of B, so skip to C');
  assert.equal(nextIndex(E, 45, 0.5), 2);
  assert.equal(nextIndex(E, 90, 0.5), -1);
  assert.equal(nextIndex([], 0, 0.5), -1);
});

test('prevIndex restarts current section, or goes back one when near its start', () => {
  assert.equal(prevIndex(E, 45, 2), 1, 'deep into B: restart B');
  assert.equal(prevIndex(E, 31, 2), 0, 'just after B started: go to A');
  assert.equal(prevIndex(E, 200, 2), 2, 'deep into C: restart C');
  assert.equal(prevIndex(E, 91, 2), 1, 'just after C: back to B');
  assert.equal(prevIndex(E, 1, 2), 0, 'near start of A stays at A');
  assert.equal(prevIndex(parseEntries('0:10 X'), 5, 2), 0, 'before first entry: go to first');
  assert.equal(prevIndex([], 5, 2), -1);
});
