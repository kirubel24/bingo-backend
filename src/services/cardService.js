import { generateBingoCard } from "../utils/bingoLogic.js";

// Room-specific card pools: each stake room has its own availability
const roomCards = {};

const ensureRoom = (roomId) => {
  if (!roomCards[roomId]) {
    roomCards[roomId] = Array.from({ length: 100 }, (_, i) => ({
      cardId: i + 1,
      card: generateBingoCard(),
      taken: false,      // Taken for current round
      takenNext: false,  // Reserved for next round
    }));
  }
  return roomCards[roomId];
};

export const getAllCards = (roomId) => ensureRoom(roomId);

export const selectCard = (roomId, cardId, user, isForNextRound = false) => {
  const cards = ensureRoom(roomId);
  const card = cards.find(c => c.cardId === cardId);
  if (!card) return null;

  if (isForNextRound) {
    if (card.takenNext) return null;
    card.takenNext = true;
  } else {
    if (card.taken) return null;
    card.taken = true;
  }

  return { ...card, player: { id: user.id, name: user.name, marked: [] } };
};

export function resetAllCards(roomId) {
  const cards = ensureRoom(roomId);
  cards.forEach(c => {
    c.taken = false;
    c.takenNext = false;
  });
}

/**
 * When a round starts, all 'takenNext' cards become 'taken' for the new round,
 * and 'takenNext' is reset for the following round.
 */
export function rotateCardsToNewRound(roomId) {
  const cards = ensureRoom(roomId);
  cards.forEach(c => {
    c.taken = c.takenNext;
    c.takenNext = false;
  });
}

/**
 * Mark a card as no longer taken for a specific round (current or next)
 */
export function releaseCard(roomId, cardId, isForNextRound = false) {
  const cards = ensureRoom(roomId);
  const card = cards.find(c => c.cardId === cardId);
  if (card) {
    if (isForNextRound) card.takenNext = false;
    else card.taken = false;
  }
}



