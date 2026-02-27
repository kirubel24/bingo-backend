// src/utils/bingoCardGenerator.js

/**
 * Generates a bingo card with a unique pattern based on the card ID
 * Standard B-I-N-G-O ranges:
 * B: 1-15, I: 16-30, N: 31-45, G: 46-60, O: 61-75
 * @param {number} cardId - The ID of the card (1-100)
 * @returns {Array} - 5x5 bingo card grid with B-I-N-G-O columns
 */
export const generateBingoCard = (cardId) => {
  // Use a more robust seeding mechanism for variety across the 100 cards
  const seededRandom = (min, max, offset) => {
    const seed = cardId * 1000 + offset;
    const x = Math.sin(seed) * 10000;
    const rand = x - Math.floor(x);
    return Math.floor(rand * (max - min + 1)) + min;
  };

  const generateColumn = (min, max, count, offset, isNColumn = false) => {
    const column = [];
    const used = new Set();
    let subOffset = 0;

    while (column.length < count) {
      if (isNColumn && column.length === 2) {
        column.push('FREE');
        continue;
      }

      let num;
      let attempts = 0;
      do {
        num = seededRandom(min, max, offset + subOffset);
        subOffset++;
        attempts++;
        if (attempts > 100) break; // Safety break
      } while (used.has(num));

      used.add(num);
      column.push(num);
    }
    
    // Sort numbers (except 'FREE')
    const hasFree = column.includes('FREE');
    if (hasFree) {
      const numbers = column.filter(n => n !== 'FREE').sort((a, b) => a - b);
      numbers.splice(2, 0, 'FREE');
      return numbers;
    }
    return column.sort((a, b) => a - b);
  };

  const card = [
    generateColumn(1, 15, 5, 100),   // B
    generateColumn(16, 30, 5, 200),  // I
    generateColumn(31, 45, 5, 300, true), // N
    generateColumn(46, 60, 5, 400),  // G
    generateColumn(61, 75, 5, 500)   // O
  ];

  return card;
};