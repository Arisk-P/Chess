// UI: renders the board, handles clicks, promotion, AI turns, and game-over.

const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟︎' };
const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

const game = new Chess();
const $ = (id) => document.getElementById(id);
const boardEl = $('board');

let selected = -1;
let legalFromSelected = [];
let flipped = false;
let aiThinking = false;
let aiToken = 0; // invalidates pending AI moves after new game / undo

const mode = () => $('mode').value;
const aiColor = () => (mode() === 'ai-b' ? 'b' : mode() === 'ai-w' ? 'w' : null);
const isAiTurn = () => aiColor() === game.turn;

function render() {
  const st = game.status();
  const last = game.history[game.history.length - 1];
  const checkSq = st.check ? game.kingSquare(game.turn) : -1;

  boardEl.innerHTML = '';
  for (let v = 0; v < 64; v++) {
    const i = flipped ? 63 - v : v;
    const r = i >> 3, c = i & 7;
    const sq = document.createElement('div');
    sq.className = 'square ' + ((r + c) % 2 ? 'dark' : 'light');
    sq.dataset.sq = i;
    if (last && (last.from === i || last.to === i)) sq.classList.add('last');
    if (i === selected) sq.classList.add('selected');
    if (i === checkSq) sq.classList.add('check');

    // Coordinates on the left/bottom edges of the visible board.
    if ((v & 7) === 0) sq.insertAdjacentHTML('beforeend', `<span class="coord rank">${8 - r}</span>`);
    if (v >= 56) sq.insertAdjacentHTML('beforeend', `<span class="coord file">${'abcdefgh'[c]}</span>`);

    const p = game.board[i];
    if (p) sq.insertAdjacentHTML('beforeend', `<span class="piece ${p[0]}">${GLYPH[p[1]]}</span>`);

    const target = legalFromSelected.find((m) => m.to === i);
    if (target) {
      const hint = document.createElement('span');
      hint.className = 'hint' + (target.captured ? ' capture' : '');
      sq.appendChild(hint);
    }
    boardEl.appendChild(sq);
  }

  renderStatus(st);
  renderMoves();
  renderCaptured();
  $('undo').disabled = !game.history.length || aiThinking;
}

function renderStatus(st) {
  const el = $('status');
  const side = game.turn === 'w' ? 'White' : 'Black';
  el.classList.toggle('check', !!st.check && !st.over);
  if (st.over) {
    el.textContent = `${st.reason} — ${st.result}`;
  } else if (aiThinking) {
    el.textContent = 'Computer is thinking…';
  } else {
    el.textContent = `${side} to move${st.check ? ' — Check!' : ''}`;
  }
}

function renderMoves() {
  const list = $('moves');
  list.innerHTML = '';
  const h = game.history;
  for (let i = 0; i < h.length; i += 2) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${h[i].san}</span><span>${h[i + 1] ? h[i + 1].san : ''}</span>`;
    list.appendChild(li);
  }
  list.scrollTop = list.scrollHeight;
}

function renderCaptured() {
  const taken = { w: [], b: [] }; // pieces captured BY each side
  for (const m of game.history) if (m.captured) taken[m.piece[0]].push(m.captured[1]);
  const order = 'QRBNP';
  const fmt = (arr) => arr.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((t) => GLYPH[t]).join('');
  const mat = (arr) => arr.reduce((s, t) => s + VALUE[t], 0);
  // Account for promotions in the material difference.
  let promoW = 0, promoB = 0;
  for (const m of game.history) if (m.promotion) (m.piece[0] === 'w' ? (promoW += VALUE[m.promotion] - 1) : (promoB += VALUE[m.promotion] - 1));
  const diff = mat(taken.w) + promoW - (mat(taken.b) + promoB);

  const bottom = flipped ? 'b' : 'w', top = flipped ? 'w' : 'b';
  const label = (c) => {
    const d = c === 'w' ? diff : -diff;
    return fmt(taken[c]) + (d > 0 ? ` <small>+${d}</small>` : '');
  };
  $('bottom-captured').innerHTML = label(bottom);
  $('top-captured').innerHTML = label(top);

  const name = (c) => {
    const base = c === 'w' ? 'White' : 'Black';
    if (!aiColor()) return base;
    return base + (aiColor() === c ? ' (Computer)' : ' (You)');
  };
  $('bottom-name').textContent = name(bottom);
  $('top-name').textContent = name(top);
}

function clearSelection() {
  selected = -1;
  legalFromSelected = [];
}

boardEl.addEventListener('click', (e) => {
  const sqEl = e.target.closest('.square');
  if (!sqEl || aiThinking || isAiTurn() || game.status().over) return;
  const i = Number(sqEl.dataset.sq);
  const p = game.board[i];

  if (selected !== -1) {
    const candidates = legalFromSelected.filter((m) => m.to === i);
    if (candidates.length) {
      if (candidates[0].promotion) askPromotion(game.turn).then((pr) => playMove(selected, i, pr));
      else playMove(selected, i);
      return;
    }
  }
  if (p && p[0] === game.turn && i !== selected) {
    selected = i;
    legalFromSelected = game.legalMoves().filter((m) => m.from === i);
  } else {
    clearSelection();
  }
  render();
});

function playMove(from, to, promotion) {
  game.move(from, to, promotion);
  clearSelection();
  afterMove();
}

function afterMove() {
  render();
  const st = game.status();
  if (st.over) return showEnd(st);
  if (isAiTurn()) runAi();
}

function runAi() {
  aiThinking = true;
  render();
  const token = ++aiToken;
  // Let the browser paint "thinking…" before the search blocks the thread.
  setTimeout(() => {
    if (token !== aiToken) return;
    const best = findBestMove(game, Number($('difficulty').value));
    aiThinking = false;
    if (best) game.move(best.from, best.to, best.promotion);
    afterMove();
  }, 250);
}

function askPromotion(color) {
  return new Promise((resolve) => {
    const box = $('promo-choices');
    box.innerHTML = '';
    for (const t of ['Q', 'R', 'B', 'N']) {
      const b = document.createElement('button');
      b.innerHTML = `<span class="piece ${color}" style="font-size:48px">${GLYPH[t]}</span>`;
      b.onclick = () => { $('promo-modal').classList.add('hidden'); resolve(t); };
      box.appendChild(b);
    }
    $('promo-modal').classList.remove('hidden');
  });
}

function showEnd(st) {
  let title = 'Draw';
  if (st.result === '1-0') title = 'White wins!';
  if (st.result === '0-1') title = 'Black wins!';
  if (aiColor() && st.result !== '½-½') {
    const winner = st.result === '1-0' ? 'w' : 'b';
    title = winner === aiColor() ? 'Computer wins' : 'You win! 🎉';
  }
  $('end-title').textContent = title;
  $('end-reason').textContent = `${st.reason} (${st.result})`;
  $('end-modal').classList.remove('hidden');
}

function newGame() {
  aiToken++;
  aiThinking = false;
  game.reset();
  clearSelection();
  flipped = aiColor() === 'w';
  $('end-modal').classList.add('hidden');
  $('promo-modal').classList.add('hidden');
  render();
  if (isAiTurn()) runAi();
}

$('new-game').onclick = newGame;
$('end-new').onclick = newGame;
$('end-close').onclick = () => $('end-modal').classList.add('hidden');
$('mode').onchange = newGame;
$('flip').onclick = () => { flipped = !flipped; render(); };
$('undo').onclick = () => {
  if (aiThinking) return;
  aiToken++;
  game.undo();
  // Against the computer, undo back to the human's turn.
  if (isAiTurn() && game.history.length) game.undo();
  clearSelection();
  render();
  if (isAiTurn()) runAi();
};

newGame();
