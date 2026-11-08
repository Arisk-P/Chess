// Chess rules engine: board state, legal move generation, SAN, game-end detection.
// Board is a 64-element array, index 0 = a8, 7 = h8, 56 = a1, 63 = h1.
// Pieces are 2-char strings: color ('w'|'b') + type ('P','N','B','R','Q','K').

const FILES = 'abcdefgh';
const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));

const KNIGHT_OFFSETS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_OFFSETS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

class Chess {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = new Array(64).fill(null);
    const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    for (let c = 0; c < 8; c++) {
      this.board[c] = 'b' + back[c];
      this.board[8 + c] = 'bP';
      this.board[48 + c] = 'wP';
      this.board[56 + c] = 'w' + back[c];
    }
    this.turn = 'w';
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.stack = [];   // internal undo info
    this.history = []; // played moves (with san)
    this.keys = [this.positionKey()];
  }

  positionKey() {
    const c = this.castling;
    return this.board.map((p) => p || '--').join('') + this.turn +
      (c.wK ? 'K' : '') + (c.wQ ? 'Q' : '') + (c.bK ? 'k' : '') + (c.bQ ? 'q' : '') + this.ep;
  }

  // ---------- attack detection ----------
  isAttacked(sq, by) {
    const B = this.board;
    const r = sq >> 3, c = sq & 7;

    // Pawns: a white pawn attacks upward (toward row 0), so it sits one row below.
    const pr = by === 'w' ? r + 1 : r - 1;
    if (pr >= 0 && pr < 8) {
      for (const dc of [-1, 1]) {
        const cc = c + dc;
        if (cc >= 0 && cc < 8 && B[pr * 8 + cc] === by + 'P') return true;
      }
    }
    for (const [dr, dc] of KNIGHT_OFFSETS) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && B[rr * 8 + cc] === by + 'N') return true;
    }
    for (const [dr, dc] of KING_OFFSETS) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && B[rr * 8 + cc] === by + 'K') return true;
    }
    const slide = (dirs, types) => {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const p = B[rr * 8 + cc];
          if (p) {
            if (p[0] === by && types.includes(p[1])) return true;
            break;
          }
          rr += dr; cc += dc;
        }
      }
      return false;
    };
    return slide(ROOK_DIRS, 'RQ') || slide(BISHOP_DIRS, 'BQ');
  }

  kingSquare(color) {
    return this.board.indexOf(color + 'K');
  }

  inCheck(color = this.turn) {
    return this.isAttacked(this.kingSquare(color), color === 'w' ? 'b' : 'w');
  }

  // ---------- move generation ----------
  pseudoMoves(color) {
    const B = this.board;
    const enemy = color === 'w' ? 'b' : 'w';
    const ms = [];

    for (let i = 0; i < 64; i++) {
      const p = B[i];
      if (!p || p[0] !== color) continue;
      const r = i >> 3, c = i & 7, t = p[1];

      if (t === 'P') {
        const dir = color === 'w' ? -1 : 1;
        const startRow = color === 'w' ? 6 : 1;
        const promoRow = color === 'w' ? 0 : 7;
        const r1 = r + dir;
        if (r1 < 0 || r1 > 7) continue;
        const addPawn = (to, captured) => {
          if (r1 === promoRow) {
            for (const pr of ['Q', 'R', 'B', 'N']) ms.push({ from: i, to, piece: p, captured, promotion: pr });
          } else {
            ms.push({ from: i, to, piece: p, captured });
          }
        };
        const f1 = r1 * 8 + c;
        if (!B[f1]) {
          addPawn(f1, null);
          const f2 = (r + 2 * dir) * 8 + c;
          if (r === startRow && !B[f2]) ms.push({ from: i, to: f2, piece: p, captured: null, flag: 'double' });
        }
        for (const dc of [-1, 1]) {
          const cc = c + dc;
          if (cc < 0 || cc > 7) continue;
          const to = r1 * 8 + cc;
          if (B[to] && B[to][0] === enemy) addPawn(to, B[to]);
          else if (to === this.ep) ms.push({ from: i, to, piece: p, captured: enemy + 'P', flag: 'ep' });
        }
      } else if (t === 'N' || t === 'K') {
        for (const [dr, dc] of t === 'N' ? KNIGHT_OFFSETS : KING_OFFSETS) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
          const to = rr * 8 + cc;
          if (!B[to] || B[to][0] === enemy) ms.push({ from: i, to, piece: p, captured: B[to] });
        }
        if (t === 'K') this.addCastles(ms, color, i, enemy);
      } else {
        const dirs = t === 'R' ? ROOK_DIRS : t === 'B' ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
            const to = rr * 8 + cc;
            if (B[to]) {
              if (B[to][0] === enemy) ms.push({ from: i, to, piece: p, captured: B[to] });
              break;
            }
            ms.push({ from: i, to, piece: p, captured: null });
            rr += dr; cc += dc;
          }
        }
      }
    }
    return ms;
  }

  addCastles(ms, color, kingSq, enemy) {
    const B = this.board;
    const home = color === 'w' ? 60 : 4;
    if (kingSq !== home) return;
    const rights = this.castling;
    const p = color + 'K';
    if (rights[color + 'K'] && !B[home + 1] && !B[home + 2] && B[home + 3] === color + 'R' &&
        !this.isAttacked(home, enemy) && !this.isAttacked(home + 1, enemy) && !this.isAttacked(home + 2, enemy)) {
      ms.push({ from: home, to: home + 2, piece: p, captured: null, flag: 'castleK' });
    }
    if (rights[color + 'Q'] && !B[home - 1] && !B[home - 2] && !B[home - 3] && B[home - 4] === color + 'R' &&
        !this.isAttacked(home, enemy) && !this.isAttacked(home - 1, enemy) && !this.isAttacked(home - 2, enemy)) {
      ms.push({ from: home, to: home - 2, piece: p, captured: null, flag: 'castleQ' });
    }
  }

  legalMoves(color = this.turn) {
    const enemy = color === 'w' ? 'b' : 'w';
    const out = [];
    for (const m of this.pseudoMoves(color)) {
      this.makeRaw(m);
      if (!this.isAttacked(this.kingSquare(color), enemy)) out.push(m);
      this.unmakeRaw();
    }
    return out;
  }

  // ---------- make / unmake ----------
  makeRaw(m) {
    const B = this.board;
    const color = m.piece[0];
    this.stack.push({ m, castling: { ...this.castling }, ep: this.ep, halfmove: this.halfmove, fullmove: this.fullmove });

    B[m.to] = m.promotion ? color + m.promotion : m.piece;
    B[m.from] = null;
    if (m.flag === 'ep') B[(m.from & ~7) | (m.to & 7)] = null;
    if (m.flag === 'castleK') { B[m.to - 1] = B[m.to + 1]; B[m.to + 1] = null; }
    if (m.flag === 'castleQ') { B[m.to + 1] = B[m.to - 2]; B[m.to - 2] = null; }

    if (m.piece[1] === 'K') { this.castling[color + 'K'] = false; this.castling[color + 'Q'] = false; }
    for (const sq of [m.from, m.to]) {
      if (sq === 63) this.castling.wK = false;
      if (sq === 56) this.castling.wQ = false;
      if (sq === 7) this.castling.bK = false;
      if (sq === 0) this.castling.bQ = false;
    }
    this.ep = m.flag === 'double' ? (m.from + m.to) / 2 : -1;
    this.halfmove = (m.piece[1] === 'P' || m.captured) ? 0 : this.halfmove + 1;
    if (color === 'b') this.fullmove++;
    this.turn = color === 'w' ? 'b' : 'w';
  }

  unmakeRaw() {
    const s = this.stack.pop();
    const m = s.m;
    const B = this.board;
    B[m.from] = m.piece;
    if (m.flag === 'ep') {
      B[m.to] = null;
      B[(m.from & ~7) | (m.to & 7)] = m.captured;
    } else {
      B[m.to] = m.captured || null;
    }
    if (m.flag === 'castleK') { B[m.to + 1] = B[m.to - 1]; B[m.to - 1] = null; }
    if (m.flag === 'castleQ') { B[m.to - 2] = B[m.to + 1]; B[m.to + 1] = null; }
    this.castling = s.castling;
    this.ep = s.ep;
    this.halfmove = s.halfmove;
    this.fullmove = s.fullmove;
    this.turn = m.piece[0];
  }

  // ---------- public API ----------
  san(m, legal) {
    if (m.flag === 'castleK') return 'O-O';
    if (m.flag === 'castleQ') return 'O-O-O';
    const t = m.piece[1];
    let s = '';
    if (t === 'P') {
      if (m.captured) s = FILES[m.from & 7] + 'x';
      s += sqName(m.to);
      if (m.promotion) s += '=' + m.promotion;
      return s;
    }
    s = t;
    const rivals = legal.filter((o) => o !== m && o.piece === m.piece && o.to === m.to && o.from !== m.from);
    if (rivals.length) {
      const sameFile = rivals.some((o) => (o.from & 7) === (m.from & 7));
      const sameRank = rivals.some((o) => (o.from >> 3) === (m.from >> 3));
      if (!sameFile) s += FILES[m.from & 7];
      else if (!sameRank) s += 8 - (m.from >> 3);
      else s += sqName(m.from);
    }
    if (m.captured) s += 'x';
    return s + sqName(m.to);
  }

  // Play a legal move; returns the move (with .san) or null if illegal.
  move(from, to, promotion = 'Q') {
    const legal = this.legalMoves();
    const m = legal.find((x) => x.from === from && x.to === to && (!x.promotion || x.promotion === promotion));
    if (!m) return null;
    let san = this.san(m, legal);
    this.makeRaw(m);
    if (this.inCheck()) san += this.legalMoves().length ? '+' : '#';
    const played = { ...m, san };
    this.history.push(played);
    this.keys.push(this.positionKey());
    return played;
  }

  undo() {
    if (!this.history.length) return null;
    this.unmakeRaw();
    this.keys.pop();
    return this.history.pop();
  }

  insufficientMaterial() {
    const pieces = this.board.filter((p) => p && p[1] !== 'K');
    if (pieces.length === 0) return true;
    if (pieces.length === 1 && 'NB'.includes(pieces[0][1])) return true;
    if (pieces.every((p) => p[1] === 'B')) {
      // All bishops on same square color → draw
      const colors = new Set();
      this.board.forEach((p, i) => { if (p && p[1] === 'B') colors.add(((i >> 3) + (i & 7)) % 2); });
      return colors.size === 1;
    }
    return false;
  }

  status() {
    const moves = this.legalMoves();
    const check = this.inCheck();
    if (!moves.length) {
      return check
        ? { over: true, result: this.turn === 'w' ? '0-1' : '1-0', reason: 'Checkmate', check }
        : { over: true, result: '½-½', reason: 'Stalemate', check };
    }
    if (this.insufficientMaterial()) return { over: true, result: '½-½', reason: 'Insufficient material', check };
    if (this.halfmove >= 100) return { over: true, result: '½-½', reason: '50-move rule', check };
    const key = this.keys[this.keys.length - 1];
    if (this.keys.filter((k) => k === key).length >= 3) return { over: true, result: '½-½', reason: 'Threefold repetition', check };
    return { over: false, check };
  }
}

if (typeof module !== 'undefined') module.exports = { Chess, sqName };
