// Simple chess AI: negamax with alpha-beta pruning, material + piece-square tables.

const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

// Tables from White's point of view, index 0 = a8.
const PST = {
  P: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0],
  N: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50],
  B: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20],
  R: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0],
  Q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20],
  K: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20],
};

const MATE = 100000;

function evaluate(game) {
  // Score from the side-to-move's perspective.
  let score = 0;
  const B = game.board;
  for (let i = 0; i < 64; i++) {
    const p = B[i];
    if (!p) continue;
    const t = p[1];
    // Mirror the square vertically for black.
    const idx = p[0] === 'w' ? i : (7 - (i >> 3)) * 8 + (i & 7);
    const v = PIECE_VALUE[t] + PST[t][idx];
    score += p[0] === 'w' ? v : -v;
  }
  return game.turn === 'w' ? score : -score;
}

function orderMoves(moves) {
  // Captures (most valuable victim, least valuable attacker) and promotions first.
  const key = (m) =>
    (m.captured ? 10 * PIECE_VALUE[m.captured[1]] - PIECE_VALUE[m.piece[1]] + 10000 : 0) +
    (m.promotion ? PIECE_VALUE[m.promotion] : 0);
  return moves.sort((a, b) => key(b) - key(a));
}

function negamax(game, depth, alpha, beta, ply) {
  const moves = game.legalMoves();
  if (!moves.length) return game.inCheck() ? -MATE + ply : 0;
  if (depth === 0) return quiesce(game, alpha, beta, 0);

  for (const m of orderMoves(moves)) {
    game.makeRaw(m);
    const score = -negamax(game, depth - 1, -beta, -alpha, ply + 1);
    game.unmakeRaw();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// Search captures only at the leaves so the AI doesn't blunder into obvious recaptures.
function quiesce(game, alpha, beta, qdepth) {
  const stand = evaluate(game);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qdepth >= 4) return alpha;
  const captures = orderMoves(game.legalMoves().filter((m) => m.captured));
  for (const m of captures) {
    game.makeRaw(m);
    const score = -quiesce(game, -beta, -alpha, qdepth + 1);
    game.unmakeRaw();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function findBestMove(game, depth) {
  const moves = orderMoves(game.legalMoves());
  // Shuffle equal-ish quiet moves a little so games vary.
  for (let i = moves.length - 1; i > 0; i--) {
    if (moves[i].captured || moves[i - 1].captured) continue;
    if (Math.random() < 0.5) [moves[i], moves[i - 1]] = [moves[i - 1], moves[i]];
  }
  let best = null, alpha = -Infinity;
  for (const m of moves) {
    game.makeRaw(m);
    const score = -negamax(game, depth - 1, -Infinity, -alpha, 1);
    game.unmakeRaw();
    if (score > alpha || !best) { alpha = score; best = m; }
  }
  return best;
}

if (typeof module !== 'undefined') module.exports = { findBestMove, evaluate };
