import { joinGameWithCard, getGame, startGame, createGame, drawAndStoreNumber, clearGameNumbers, getAllGames } from "./services/gameService.js";
import { selectCard, getAllCards, resetAllCards, releaseCard, rotateCardsToNewRound } from "./services/cardService.js";
import { checkBingo } from "./utils/bingoLogic.js";
import { handleRegister, handleLogin, handleGetCard, handleGetAvailableCards, handleSelectCard } from "./controllers/userController.js";
import { getUserFromSocket } from './middleware/auth.js'
import { pool } from './db.js'
import { setIo } from "./socketRef.js";

const LOBBY_COUNTDOWN = 15; // seconds
const GRACE_PERIOD_SECONDS = 10; // allow post-draw marking
const NEXT_GAME_DELAY = 0; // start next round immediately

/* ---------------------------------------------------------- */
/*                  REFUND HELPER                             */
/* ---------------------------------------------------------- */

const performRefund = async (uid, rid, amt, name) => {
  if (!uid || !rid || !amt) return;
  console.log(`💸 Refunding ${name || uid} (Amt: ${amt}, Round: ${rid})...`);
  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Check if already refunded to prevent double refund
      const [existing] = await conn.query('SELECT id FROM transactions WHERE user_id=? AND type="adjustment" AND method="refund" AND reference=? LIMIT 1', [uid, rid]);
      if (existing.length === 0) {
        // Verify a stake actually exists for this round to avoid arbitrary balance increases
        const [stake] = await conn.query('SELECT id FROM transactions WHERE user_id=? AND type="adjustment" AND method="stake" AND status IN ("success","approved","paid") AND reference=? LIMIT 1', [uid, rid]);
        if (stake.length > 0) {
          await conn.query('UPDATE wallets SET main_balance=main_balance+? WHERE user_id=?', [amt, uid]);
          await conn.query('INSERT INTO transactions (user_id, type, amount, method, reference, status) VALUES (?, "adjustment", ?, "refund", ?, "success")', [uid, amt, rid]);
        } else {
          console.warn(`⚠️ No stake found for refund: User ${uid}, Round ${rid}`);
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      console.error("Refund transaction error:", e);
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error("Database connection error for refund:", e);
  }
};

export const initSocket = (io) => {
  setIo(io);
  io.on("connection", (socket) => {
    console.log("🟢 New client connected:", socket.id);
    
    // User authentication handlers
    socket.on("register", (data) => handleRegister(socket, data));
    socket.on("login", (data) => handleLogin(socket, data));
    socket.on("get_card", (data) => handleGetCard(socket, data));

    // Join a stake room lobby without selecting a card yet
    socket.on("join_room", async ({ gameId }) => {
      try {
        if (!gameId) return;
        const roomId = String(gameId)
        const game = getGame(roomId) || createGame(roomId);
        if (game.locked) {
          socket.emit("room_locked", { gameId: roomId });
          return;
        }
        socket.join(roomId);
        if (game.started) {
          socket.emit("game_start", { 
            participantUserIds: (game.settlementParticipants || []).map(p => p.player.id),
            calledNumbers: game.calledNumbers || []
          });
        }
        broadcastAdminStats(io);
      } catch {}
    });

    // Send all cards
    socket.on("get_cards", ({ gameId }) => {
      const roomId = String(gameId || 'global');
      const cards = getAllCards(roomId);
      socket.emit("all_cards", cards);
    });

    // ✅ Player selects a card (can change before game starts)
    socket.on("select_card", async ({ gameId, cardId, user, stake, roundId }) => {
      const roomId = String(gameId)
      const gate = await ensurePlayAllowed(socket, user?.id)
      if (!gate.ok) { socket.emit('access_denied', { message: gate.message }); return }
      const game = getGame(roomId) || createGame(roomId);

      if (game.locked) {
        socket.emit("room_locked", { gameId: roomId });
        return;
      }
      if (stake && !game.stake) { game.stake = Number(stake) || 0 }

      // If game already started, we will add to nextRoundSelections below (after taking the card), not reject

      // Check if player already selected a card (current round or next-round list)
      const existing = game.players.find((p) => p.player.id === user.id);
      const existingNext = game.nextRoundSelections && game.nextRoundSelections.find((p) => p.player.id === user.id);
      const existingEntry = existing || existingNext;
      if (existingEntry) {
        // Release card for the round they are currently associated with
        releaseCard(roomId, existingEntry.cardId, !!existingNext);
        if (existing) game.players = game.players.filter((p) => p.player.id !== user.id);
        if (existingNext) game.nextRoundSelections = game.nextRoundSelections.filter((p) => p.player.id !== user.id);
      }

      // Try to take the new card
      // If round is running, we select for the NEXT round.
      const isNext = !!game.started;
      
      // Force unique check: a player can only have ONE selection (current or next)
      // This is already handled by the releaseCard logic above, but let's be explicit
      const selected = selectCard(roomId, cardId, user, isNext);
      
      if (selected && selected.player) {
        selected.player.socketId = socket.id;
        // Keep track of stake info for auto-refunds
        selected.player.stake = Number(stake || game.stake || 0);
        selected.player.roundId = String(roundId || ''); 
      }
      if (!selected) {
        socket.emit("card_taken", { cardId });
        return;
      }

      if (isNext) {
        // Round already running: add to next-round queue
        if (!game.nextRoundSelections) game.nextRoundSelections = [];
        game.nextRoundSelections.push(selected);
        socket.join(roomId);
        io.to(roomId).emit("card_selected", { cardId, user });
        io.to(roomId).emit("all_cards", getAllCards(roomId));
        broadcastAdminStats(io);
        socket.emit("player_joined", { user, card: selected.card, forNextRound: true });
        return;
      }

      // Join the game with the new card (current round)
      joinGameWithCard(roomId, selected);
      socket.join(roomId);
      console.log(`${user.name} selected card #${cardId}`);

      // Update lobby for everyone
      io.to(roomId).emit("card_selected", { cardId, user });
      io.to(roomId).emit("all_cards", getAllCards(roomId));
      broadcastAdminStats(io);

      // Send card to player
      socket.emit("player_joined", { user, card: selected.card });

      // Start countdown only when 2 or more players have selected a card (and round not started)
      if (game.players.length >= 2 && !game.started && !game.timer) {
        startLobbyCountdown(io, roomId);
      } else {
        // Only notify the first player (lone waiter), not users who joined later
        const firstPlayer = game.players[0];
        if (firstPlayer?.player?.socketId) {
          io.to(firstPlayer.player.socketId).emit("need_more_players");
        }
      }
    });

    // Player marks a number
    socket.on("mark_number", async ({ gameId, userId, number }) => {
      const roomId = String(gameId)
      const gate = await ensurePlayAllowed(socket, userId)
      if (!gate.ok) { socket.emit('access_denied', { message: gate.message }); return }
      const game = getGame(roomId);
      if (!game) return;

      const player = game.players.find((p) => p.player.id === userId);
      if (!player) return;

      const marked = player.player.marked || [];
      if (!marked.includes(number)) marked.push(number);
      else player.player.marked = marked.filter((n) => n !== number);
    });

    // ✅ Player claims Bingo
    socket.on("claim_bingo", async ({ gameId, userId }) => {
      const roomId = String(gameId)
      const gate = await ensurePlayAllowed(socket, userId)
      if (!gate.ok) { socket.emit('access_denied', { message: gate.message }); return }
      const game = getGame(roomId);
      if (!game) return;

      const player = game.players.find((p) => p.player.id === userId);
      if (!player) return;

      if (checkBingo(player.card, player.player.marked, game.calledNumbers)) {
        const participants = game.settlementParticipants || game.players;
        const isInSettlement = participants.some((p) => String(p.player.id) === String(userId));
        if (!isInSettlement) {
          socket.emit("invalid_bingo");
          return;
        }
        io.to(roomId).emit("bingo_winner", { userId, name: player.player.name, cardId: player.cardId, stake: Number(game.stake || 0) });
        const s = Number(game.stake || 0);
        const count = participants.length;
        const poolTotal = s * count;
        const winnerReward = Math.floor(poolTotal * 0.9);
        const commission = poolTotal - winnerReward;
        io.to(roomId).emit("payouts", { poolTotal, winnerReward, commission, winnerId: userId });
        io.to(roomId).emit("game_end", { participantUserIds: participants.map((p) => p.player.id) });
        console.log(`🏆 ${player.player.name} won the Bingo!`);

        // Stop any grace countdown if active
        if (game.graceTimer) {
          clearInterval(game.graceTimer);
          game.graceTimer = null;
        }

        // Stop number drawing interval if active
        if (game.drawTimer) {
          clearInterval(game.drawTimer);
          game.drawTimer = null;
        }

        // 🔁 Move to lobby and require re-selection for next round
        console.log("♻️ Resetting to lobby for next round...");
        resetToLobby(io, roomId);

      } else {
        socket.emit("invalid_bingo");
      }
    });

    socket.on("disconnect", async () => {
      console.log(`🔴 Client disconnected: ${socket.id}`);
      try {
        const games = getAllGames();
        for (const [gid, g] of Object.entries(games)) {
          // Remove from current round players
          const idx = g.players.findIndex((p) => p?.player?.socketId === socket.id);
          if (idx >= 0) {
            const playerToRemove = g.players[idx];
            const freedCardId = playerToRemove.cardId;
            
            // AUTO-REFUND if game hasn't started OR they weren't in the participant list (late joiner)
            const isParticipant = g.settlementParticipants && g.settlementParticipants.some(p => String(p.player.id) === String(playerToRemove.player.id));
            if (!g.started || !isParticipant) {
              const { id, roundId, stake, name } = playerToRemove.player || {};
              performRefund(id, roundId, stake, name);
            }

            const cards = getAllCards(gid);
            const oldCard = cards.find((c) => c.cardId === freedCardId);
            if (oldCard) oldCard.taken = false;
            g.players.splice(idx, 1);

            // Handle round ending if no one left
            if (g.started && g.players.length === 0) {
              try {
                if (g.graceTimer) { clearInterval(g.graceTimer); g.graceTimer = null; }
                if (g.drawTimer) { clearInterval(g.drawTimer); g.drawTimer = null; }
                const pIds = (g.settlementParticipants || []).map((p) => p.player.id);
                io.to(gid).emit("game_end", { participantUserIds: pIds });
              } catch {}
              resetToLobby(io, gid);
              continue; // Next game
            }
            
            // Handle lobby countdown stopping if fewer than 2 players
            if (!g.started && g.players.length < 2 && g.timer) {
              clearInterval(g.timer);
              g.timer = null;
              const firstRemaining = g.players[0];
              if (firstRemaining?.player?.socketId) {
                io.to(firstRemaining.player.socketId).emit("need_more_players");
              }
            }

            io.to(gid).emit("all_cards", getAllCards(gid));
          }

          // Remove from next round selections if queued
          const idxNext = g.nextRoundSelections ? g.nextRoundSelections.findIndex((p) => p?.player?.socketId === socket.id) : -1;
          if (idxNext >= 0) {
            const playerToRemove = g.nextRoundSelections[idxNext];
            const freedCardId = playerToRemove.cardId;

            // AUTO-REFUND for next round reservation if they disconnect
            const { id, roundId, stake, name } = playerToRemove.player || {};
            performRefund(id, roundId, stake, name);

            const cards = getAllCards(gid);
            const oldCard = cards.find((c) => c.cardId === freedCardId);
            if (oldCard) oldCard.takenNext = false; // Note: for next round it's takenNext
            g.nextRoundSelections.splice(idxNext, 1);
            io.to(gid).emit("all_cards", getAllCards(gid));
          }
        }
        broadcastAdminStats(io);
      } catch {}
    });

    // Player cancels (free their card, update lobby; or remove from next-round list if round is running)
    socket.on("cancel_game", ({ gameId, userId }) => {
      const roomId = String(gameId)
      const game = getGame(roomId) || createGame(roomId);
      if (!game) return;

      if (userId) {
        if (game.started) {
          // Round is running: only remove from nextRoundSelections and free their card
          const nextEntry = game.nextRoundSelections && game.nextRoundSelections.find((p) => p.player.id === userId);
          if (nextEntry) {
            const oldCard = getAllCards(roomId).find((c) => c.cardId === nextEntry.cardId);
            if (oldCard) oldCard.takenNext = false;
            game.nextRoundSelections = game.nextRoundSelections.filter((p) => p.player.id !== userId);
            
            // REFUND for next round reservation
            const { id, roundId, stake, name } = nextEntry.player || {};
            performRefund(id, roundId, stake, name);

            io.to(roomId).emit("all_cards", getAllCards(roomId));
            broadcastAdminStats(io);
          }
          try { socket.leave(roomId); } catch {}
          socket.emit("you_cancelled_game");
        } else {
          // Lobby: remove from current round players
          const playerEntry = game.players.find((p) => p.player.id === userId);
          if (playerEntry) {
            const oldCard = getAllCards(roomId).find((c) => c.cardId === playerEntry.cardId);
            if (oldCard) oldCard.taken = false;
            game.players = game.players.filter((p) => p.player.id !== userId);
            
            // REFUND for lobby selection
            const { id, roundId, stake, name } = playerEntry.player || {};
            performRefund(id, roundId, stake, name);
          }
          try { socket.leave(roomId); } catch {}
          socket.emit("you_cancelled_game");
          io.to(roomId).emit("all_cards", getAllCards(roomId));
          broadcastAdminStats(io);
        }
      }

      if (game.started) return;

      // Re-evaluate lobby countdown based on remaining players
      const remaining = game.players.length;
      if (remaining < 2) {
        // Stop countdown if fewer than 2 players remain
        if (game.timer) {
          clearInterval(game.timer);
          game.timer = null;
        }
        // Only notify the remaining (first) player, not others in room who haven't selected
        const firstRemaining = game.players[0];
        if (firstRemaining?.player?.socketId) {
          io.to(firstRemaining.player.socketId).emit("need_more_players");
        }
      } else {
        // Keep or start countdown if 2 or more players
        if (!game.started && !game.timer) {
          startLobbyCountdown(io, roomId);
        }
      }
    });
  });
};



/* ---------------------------------------------------------- */
/*                   RESET TO LOBBY                           */
/* ---------------------------------------------------------- */

const resetToLobby = async (io, gameId) => {
  const game = getGame(gameId) || createGame(gameId);

  game.drawing = false;
  if (game.graceTimer) {
    clearInterval(game.graceTimer);
    game.graceTimer = null;
  }

  if (game.drawTimer) {
    clearInterval(game.drawTimer);
    game.drawTimer = null;
  }

  game.calledNumbers = [];
  game.started = false;
  game.stake = 0;

  if (game.timer) {
    clearInterval(game.timer);
    game.timer = null;
  }

  await clearGameNumbers(gameId);

  // Rotate card availability: nextRoundSelections now become current round players,
  // and their cards are officially 'taken' for the new round.
  rotateCardsToNewRound(gameId);

  game.players = [];
  game.settlementParticipants = [];

  // Restore players who selected for next round during the running game
  const nextRound = game.nextRoundSelections || [];
  game.nextRoundSelections = [];
  game.players = nextRound.map((entry) => ({ ...entry, player: { ...entry.player, marked: [] } }));

  // Notify next-round players so they see their card in the new lobby
  for (const p of game.players) {
    if (p.player && p.player.socketId) {
      io.to(p.player.socketId).emit("player_joined", { user: p.player, card: p.card });
    }
  }

  io.to(gameId).emit("new_game_ready");
  io.to(gameId).emit("all_cards", getAllCards(gameId));
  broadcastAdminStats(io);
};



/* ---------------------------------------------------------- */
/*                  START LOBBY COUNTDOWN                     */
/* ---------------------------------------------------------- */

const startLobbyCountdown = (io, gameId) => {
  const game = getGame(gameId);
  if (!game) return;

  if (game.players.length < 2) {
    const firstPlayer = game.players[0];
    if (firstPlayer?.player?.socketId) {
      io.to(firstPlayer.player.socketId).emit("need_more_players");
    }
    return;
  }

  let timeLeft = LOBBY_COUNTDOWN;
  io.to(gameId).emit("lobby_countdown", { timeLeft });

  game.timer = setInterval(() => {
    timeLeft--;
    io.to(gameId).emit("lobby_countdown", { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(game.timer);
      game.timer = null;
      startGame(gameId);
      const g = getGame(gameId);
      const participantUserIds = (g && g.settlementParticipants || []).map((p) => p.player.id);
      io.to(gameId).emit("game_start", { participantUserIds });
      io.except(gameId).emit("game_started_notification", { gameId });
      broadcastAdminStats(io);
      startNumberDraw(io, gameId);
    }
  }, 1000);
};



/* ---------------------------------------------------------- */
/*                   GRACE PERIOD                             */
/* ---------------------------------------------------------- */

const startGracePeriod = (io, gameId) => {
  const game = getGame(gameId);
  if (!game) return;

  let timeLeft = GRACE_PERIOD_SECONDS;
  io.to(gameId).emit("grace_start", { timeLeft });

  game.graceTimer = setInterval(() => {
    timeLeft--;
    io.to(gameId).emit("grace_countdown", { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(game.graceTimer);
      game.graceTimer = null;
      const pIds = (game.settlementParticipants || []).map((p) => p.player.id);
      io.to(gameId).emit("game_end", { participantUserIds: pIds });
      resetToLobby(io, gameId);
    }
  }, 1000);
};



/* ---------------------------------------------------------- */
/*                     NUMBER DRAW                            */
/* ---------------------------------------------------------- */

const startNumberDraw = (io, gameId) => {
  const game = getGame(gameId);
  if (!game) return;
  // If a previous draw interval exists, clear it
  if (game.drawTimer) {
    clearInterval(game.drawTimer);
    game.drawTimer = null;
  }

  game.drawTimer = setInterval(async () => {
    const result = await drawAndStoreNumber(gameId);

    if (!result) return;

    if (result.message === "All numbers drawn. Game complete.") {
      clearInterval(game.drawTimer);
      game.drawTimer = null;
      startGracePeriod(io, gameId);
      return;
    }

    if (!result.success) return;

    if (getGame(gameId).calledNumbers.length >= 75) {
      clearInterval(game.drawTimer);
      game.drawTimer = null;
      startGracePeriod(io, gameId);
    }
  }, 3000);
};
let _adminStatsThrottle = null;
const broadcastAdminStats = (io) => {
  if (_adminStatsThrottle) return;
  _adminStatsThrottle = setTimeout(() => {
    _adminStatsThrottle = null;
    try {
      const games = getAllGames();
      const activeRooms = Object.keys(games).length;
      let players = 0;
      for (const g of Object.values(games)) {
        players += (g.players || []).length;
      }
      io.emit('admin_stats', { active_rooms: activeRooms, active_players: players });
    } catch {}
  }, 400);
}

const ensurePlayAllowed = async (socket, explicitUserId) => {
  try {
    const u = getUserFromSocket(socket)
    const uid = explicitUserId || (u && u.id) || null
    if (!uid) return { ok: false, message: 'Unauthorized' }
    const [[row]] = await pool.query('SELECT blocked, deactivated, banned_until FROM users WHERE id=?', [uid])
    const isBlocked = Number(row?.blocked || 0) === 1
    const isDeactivated = Number(row?.deactivated || 0) === 1
    const isBanned = row?.banned_until ? new Date(row.banned_until).getTime() > Date.now() : false
    if (isDeactivated) return { ok: false, message: 'Account is deactivated' }
    if (isBanned) return { ok: false, message: 'Account is banned' }
    if (isBlocked) return { ok: false, message: 'Gameplay is restricted for your account' }
    return { ok: true, userId: uid }
  } catch (e) {
    return { ok: false, message: 'Access check failed' }
  }
}
