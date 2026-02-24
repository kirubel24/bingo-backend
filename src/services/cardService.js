import { generateBingoCard } from "../utils/bingoLogic.js";

// Room-specific card pools: each stake room has its own availability
const roomCards = {};

const ensureRoom = (roomId) => {
  if (!roomCards[roomId]) {
    roomCards[roomId] = Array.from({ length: 100 }, (_, i) => ({
      cardId: i + 1,
      card: generateBingoCard(),
      taken: false,
    }));
  }
  return roomCards[roomId];
};

export const getAllCards = (roomId) => ensureRoom(roomId);

export const selectCard = (roomId, cardId, user) => {
  const cards = ensureRoom(roomId);
  const card = cards.find(c => c.cardId === cardId);
  if (!card || card.taken) return null;
  card.taken = true;
  return { ...card, player: { id: user.id, name: user.name, marked: [] } };
};

export function resetAllCards(roomId) {
  const cards = ensureRoom(roomId);
  cards.forEach(c => c.taken = false);
}



