"use strict";

const COLS = 5;
const ROWS = 4;
const TARGET_COUNT = 20;
const STORAGE_KEY = "wordgrid-state-v1";

const COMMON_SET = new Set(COMMON_WORDS);
const BONUS_SET = new Set(BONUS_WORDS);

// ---------- grid generation ----------

function randInt(n) { return Math.floor(Math.random() * n); }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Try once: grow columns from random common words, then require
// exactly TARGET_COUNT common words and every tile used by one of them.
function tryGenerate() {
  const cols = Array.from({ length: COLS }, () => []);
  for (let picks = 0; picks < 80; picks++) {
    const w = COMMON_WORDS[randInt(COMMON_WORDS.length)];
    let fits = true;
    for (let i = 0; i < COLS; i++) {
      if (!cols[i].includes(w[i]) && cols[i].length >= ROWS) { fits = false; break; }
    }
    if (!fits) continue;
    for (let i = 0; i < COLS; i++) {
      if (!cols[i].includes(w[i])) cols[i].push(w[i]);
    }
    if (cols.every(c => c.length === ROWS)) break;
  }
  if (!cols.every(c => c.length === ROWS)) return null;

  const sets = cols.map(c => new Set(c));
  const words = [];
  for (const w of COMMON_WORDS) {
    let ok = true;
    for (let i = 0; i < COLS; i++) {
      if (!sets[i].has(w[i])) { ok = false; break; }
    }
    if (ok) {
      words.push(w);
      if (words.length > TARGET_COUNT) return null;
    }
  }
  if (words.length !== TARGET_COUNT) return null;

  for (let i = 0; i < COLS; i++) {
    const used = new Set(words.map(w => w[i]));
    if (used.size !== ROWS) return null;
  }
  return { columns: cols.map(c => shuffle(c.slice())), targets: words };
}

// Runs in small batches so the page never freezes.
function generateGrid() {
  return new Promise(resolve => {
    function batch() {
      for (let k = 0; k < 300; k++) {
        const g = tryGenerate();
        if (g) { resolve(g); return; }
      }
      setTimeout(batch, 0);
    }
    batch();
  });
}

// ---------- state ----------

let state = null;      // { columns, targets, found, bonusFound }
let selection = new Array(COLS).fill(null);   // row index per column, or null
let busy = false;

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && Array.isArray(s.columns) && Array.isArray(s.targets)) return s;
  } catch (e) { /* ignore */ }
  return null;
}

function letterAt(c, r) { return state.columns[c][r]; }

// A tile stays while some unfound target word still uses it.
function tileAlive(c, r) {
  const L = letterAt(c, r);
  return state.targets.some(w => w[c] === L && !state.found.includes(w));
}

// ---------- rendering ----------

const boardEl = document.getElementById("board");
const stringEl = document.getElementById("string");
const polyEl = stringEl.querySelector("polyline");
const foundEl = document.getElementById("found");
const bonusEl = document.getElementById("bonus");
const messageEl = document.getElementById("message");
const loadingEl = document.getElementById("loading");
const tiles = [];   // tiles[c][r]

function buildBoard() {
  boardEl.innerHTML = "";
  tiles.length = 0;
  for (let c = 0; c < COLS; c++) tiles.push([]);
  // Grid fills row by row, so create in row-major order.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = document.createElement("div");
      t.className = "tile";
      t.textContent = letterAt(c, r);
      t.addEventListener("click", () => onTap(c, r));
      boardEl.appendChild(t);
      tiles[c][r] = t;
    }
  }
}

function render() {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const t = tiles[c][r];
      t.classList.toggle("gone", !tileAlive(c, r));
      t.classList.toggle("selected", selection[c] === r);
    }
  }
  foundEl.textContent = state.found.length;
  const b = state.bonusFound.length;
  bonusEl.textContent = "+" + b;
  bonusEl.classList.toggle("hidden", b === 0);
  drawString();
}

function drawString() {
  const wrap = stringEl.getBoundingClientRect();
  const pts = [];
  for (let c = 0; c < COLS; c++) {
    if (selection[c] === null) continue;
    const rect = tiles[c][selection[c]].getBoundingClientRect();
    pts.push(`${rect.left - wrap.left + rect.width / 2},${rect.top - wrap.top + rect.height / 2}`);
  }
  polyEl.setAttribute("points", pts.length > 1 ? pts.join(" ") : "");
}

let messageTimer = null;
function showMessage(text, ms = 1600) {
  messageEl.textContent = text;
  clearTimeout(messageTimer);
  if (ms) messageTimer = setTimeout(() => { messageEl.textContent = ""; }, ms);
}

// ---------- play ----------

function onTap(c, r) {
  if (busy || !tileAlive(c, r)) return;
  selection[c] = (selection[c] === r) ? null : r;
  render();
  if (selection.every(x => x !== null)) checkWord();
}

function selectedTiles() {
  return selection.map((r, c) => tiles[c][r]);
}

function finishAttempt(cls, after) {
  busy = true;
  const sel = selectedTiles();
  sel.forEach(t => t.classList.add(cls));
  stringEl.classList.add(cls);
  if (cls === "bad") boardEl.classList.add("shake");
  setTimeout(() => {
    sel.forEach(t => t.classList.remove(cls));
    stringEl.classList.remove(cls);
    boardEl.classList.remove("shake");
    selection.fill(null);
    if (after) after();
    render();
    busy = false;
  }, cls === "bad" ? 420 : 520);
}

function checkWord() {
  const word = selection.map((r, c) => letterAt(c, r)).join("");

  if (state.targets.includes(word)) {
    if (state.found.includes(word)) {
      showMessage(`${word} - already found`);
      finishAttempt("bad");
      return;
    }
    finishAttempt("good", () => {
      state.found.push(word);
      save();
      if (state.found.length === TARGET_COUNT) {
        showMessage("All 20 found!", 0);
      } else {
        showMessage(word);
      }
    });
    return;
  }

  if (BONUS_SET.has(word) || COMMON_SET.has(word)) {
    if (state.bonusFound.includes(word)) {
      showMessage(`${word} - bonus already found`);
      finishAttempt("bad");
      return;
    }
    finishAttempt("good", () => {
      state.bonusFound.push(word);
      save();
      showMessage(`${word} - bonus!`);
      bonusEl.classList.remove("pop");
      void bonusEl.offsetWidth;
      bonusEl.classList.add("pop");
    });
    return;
  }

  finishAttempt("bad");
}

async function newGrid() {
  loadingEl.style.display = "flex";
  boardEl.style.visibility = "hidden";
  const g = await generateGrid();
  state = { columns: g.columns, targets: g.targets, found: [], bonusFound: [] };
  selection.fill(null);
  save();
  buildBoard();
  boardEl.style.visibility = "visible";
  loadingEl.style.display = "none";
  showMessage("");
  render();
}

// ---------- new-grid confirmation ----------

const confirmEl = document.getElementById("confirm");
document.getElementById("newGrid").addEventListener("click", () => {
  if (busy) return;
  if (state && state.found.length === TARGET_COUNT) { newGrid(); return; }
  confirmEl.classList.add("open");
});
document.getElementById("cancelNew").addEventListener("click", () => confirmEl.classList.remove("open"));
document.getElementById("okNew").addEventListener("click", () => {
  confirmEl.classList.remove("open");
  newGrid();
});

window.addEventListener("resize", drawString);

// ---------- start ----------

(function start() {
  const saved = load();
  if (saved) {
    state = saved;
    buildBoard();
    loadingEl.style.display = "none";
    render();
    if (state.found.length === TARGET_COUNT) showMessage("All 20 found!", 0);
  } else {
    newGrid();
  }
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
