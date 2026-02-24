import { pool } from '../db.js';
import { getIo } from '../socketRef.js';

// Store active games in memory
const activeGames = {};

// Create a game (use string key for consistency)
export const createGame = (gameId) => {
  const key = String(gameId)
  activeGames[key] = {
    players: [],        // players joined (current round)
    nextRoundSelections: [], // players who selected a card during running round (for next round)
    calledNumbers: [],  // numbers drawn
    started: false,     // game started
    timer: null,        // lobby countdown timer
    drawTimer: null,    // number draw interval
    graceTimer: null,   // grace countdown timer
    drawing: false,     // prevent concurrent draws
    persistDisabled: false, // disable DB persist after first failure
    locked: false,      // admin lock to prevent joins/selection
    state: 'open',      // game state: 'open' | 'locked'
    stake: 0,
    maxPlayers: 10,
    type: 'Classic'
  };
  return activeGames[key];
};

// Player joins game by selecting a card
export const joinGameWithCard = (gameId, cardWithPlayer) => {
  const key = String(gameId)
  if (!activeGames[key]) createGame(key);
  activeGames[key].players.push(cardWithPlayer);
  return cardWithPlayer;
};

// Start the game: freeze participant list for this round's settlement (prevents late joiners from being included)
export const startGame = (gameId) => {
  const game = activeGames[String(gameId)];
  if (game) {
    game.started = true;
    game.settlementParticipants = [...game.players];
  }
};

// Call next number (shared for all players)
export const callNextNumber = (gameId) => {
  const game = activeGames[String(gameId)];
  if (!game) return null;

  let num;
  do {
    num = Math.floor(Math.random() * 75) + 1;
  } while (game.calledNumbers.includes(num));

  game.calledNumbers.push(num);
  return num;
};

// Reset game for next round
export const resetGame = (gameId) => {
  const game = activeGames[String(gameId)];
  if (!game) return;

  game.players = [];          // clear players
  game.calledNumbers = [];    // clear drawn numbers
  game.started = false;       // reset start flag
  if (game.timer) {
    clearInterval(game.timer);
    game.timer = null;
  }
};

export const getGame = (gameId) => activeGames[String(gameId)];
export const getAllGames = () => activeGames;

export const setLocked = (gameId, locked) => {
  const key = String(gameId)
  const game = activeGames[key] || createGame(key)
  game.locked = !!locked
  game.state = game.locked ? 'locked' : 'open'
  return game.locked
}

export const setStake = (gameId, stake) => {
  const key = String(gameId)
  const game = activeGames[key] || createGame(key)
  game.stake = Number(stake || 0)
  return game.stake
}

export const setSettings = (gameId, settings) => {
  const key = String(gameId)
  const game = activeGames[key] || createGame(key)
  if (settings && settings.maxPlayers != null) game.maxPlayers = Number(settings.maxPlayers)
  if (settings && settings.type) game.type = String(settings.type)
  if (settings && settings.stake != null) game.stake = Number(settings.stake)
  return { maxPlayers: game.maxPlayers, type: game.type, stake: game.stake }
}

export const endGameNow = (gameId) => {
  const game = activeGames[String(gameId)]
  if (!game) return false
  game.calledNumbers = []
  game.started = false
  if (game.drawTimer) { try { clearInterval(game.drawTimer) } catch {} game.drawTimer = null }
  if (game.graceTimer) { try { clearInterval(game.graceTimer) } catch {} game.graceTimer = null }
  return true
}

// Draw a unique number for a game, store in DB (best-effort), emit via Socket.IO
export const drawAndStoreNumber = async (gameId) => {
  const key = String(gameId)
  const game = activeGames[key] || createGame(key);
  if (game.drawing) {
    return { success: false, message: 'Draw in progress' };
  }
  game.drawing = true;
  try {
    const dbGameId = /^\d+$/.test(String(gameId)) ? Number(gameId) : 1;
    // Optionally read persisted numbers (best-effort) unless disabled
    let dbNumbers = [];
    if (!game.persistDisabled) {
      try {
        const [rows] = await pool.query(
          'SELECT number FROM game_numbers WHERE game_id = ? ORDER BY drawn_at ASC',
          [dbGameId]
        );
        dbNumbers = rows.map(r => r.number);
      } catch (err) {
        console.warn('⚠️ DB read failed, using memory only:', err?.code || err?.message || err);
        dbNumbers = [];
      }
    }

    // Union of DB + memory to avoid duplicates
    const memNumbers = game.calledNumbers || [];
    const combined = new Set([...dbNumbers, ...memNumbers]);

    const io = getIo();
    if (combined.size >= 75) {
      if (io) io.to(gameId).emit('game_end');
      return { success: true, message: 'All numbers drawn. Game complete.' };
    }

    // Remaining candidates
    let candidates = [];
    for (let i = 1; i <= 75; i++) {
      if (!combined.has(i)) candidates.push(i);
    }
    if (candidates.length === 0) {
      if (io) io.to(gameId).emit('game_end');
      return { success: true, message: 'All numbers drawn. Game complete.' };
    }

    // Pick a number; persist with duplicate handling
    let pick = candidates[Math.floor(Math.random() * candidates.length)];
    try {
      if (!game.persistDisabled) {
        await pool.query('INSERT INTO game_numbers (game_id, number) VALUES (?, ?)', [dbGameId, pick]);
      }
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') {
        // Treat as already drawn and try another candidate
        combined.add(pick);
        candidates = [];
        for (let i = 1; i <= 75; i++) {
          if (!combined.has(i)) candidates.push(i);
        }
        if (candidates.length === 0) {
          if (io) io.to(gameId).emit('game_end');
          return { success: true, message: 'All numbers drawn. Game complete.' };
        }
        pick = candidates[Math.floor(Math.random() * candidates.length)];
        try {
          if (!game.persistDisabled) {
            await pool.query('INSERT INTO game_numbers (game_id, number) VALUES (?, ?)', [dbGameId, pick]);
          }
        } catch (err2) {
          console.warn('⚠️ Persist still failed; proceeding without DB:', err2?.code || err2?.message || err2);
          game.persistDisabled = true;
        }
      } else {
        console.warn('⚠️ Persist failed; proceeding without DB:', err?.code || err?.message || err);
        game.persistDisabled = true;
      }
    }

    // Only emit if newly added to memory
    let added = false;
    if (!game.calledNumbers.includes(pick)) {
      game.calledNumbers.push(pick);
      added = true;
    }

    if (io && added) {
      io.to(key).emit('number_called', { number: pick });
    }

    if (game.calledNumbers.length >= 75) {
      if (io) io.to(key).emit('game_end');
    }

    return { success: true, number: pick, message: 'Number drawn' };
  } catch (error) {
    console.error('❌ drawAndStoreNumber error:', error);
    return { success: false, message: 'Unexpected error drawing number' };
  } finally {
    game.drawing = false;
  }
};

export const clearGameNumbers = async (gameId) => {
  const dbGameId = /^\d+$/.test(String(gameId)) ? Number(gameId) : 1;
  try {
    await pool.query('DELETE FROM game_numbers WHERE game_id = ?', [dbGameId]);
  } catch (err) {
    console.error('❌ Failed to clear game_numbers for game:', gameId, err);
  }
};
