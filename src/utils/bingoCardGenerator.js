// src/utils/bingoCardGenerator.js

/**
 * Generates a bingo card with a unique pattern based on the card ID
 * @param {number} cardId - The ID of the card (1-100)
 * @returns {Array} - 5x5 bingo card grid with B-I-N-G-O columns
 */
export const generateBingoCard = (cardId) => {
  // Seed the random number generator with the card ID for consistency
  const seed = cardId;
  
  // Function to get deterministic "random" numbers based on seed
  const seededRandom = (min, max, offset = 0) => {
    const x = Math.sin(seed + offset) * 10000;
    const rand = x - Math.floor(x);
    return Math.floor(rand * (max - min + 1)) + min;
  };
  
  // Create the columns with appropriate number ranges
  // B: 1-15, I: 16-30, N: 31-45, G: 46-60, O: 61-75
  const card = [
    // B column (1-15)
    Array.from({ length: 5 }, (_, i) => {
      const min = 1;
      const max = 15;
      let num;
      let attempts = 0;
      const used = [];
      
      do {
        num = seededRandom(min, max, i);
        attempts++;
        if (attempts > 50) break; // Prevent infinite loop
      } while (used.includes(num));
      
      used.push(num);
      return num;
    }),
    
    // I column (16-30)
    Array.from({ length: 5 }, (_, i) => {
      const min = 16;
      const max = 30;
      return seededRandom(min, max, i + 5);
    }),
    
    // N column (31-45) with free space in the middle
    Array.from({ length: 5 }, (_, i) => {
      if (i === 2) return 'FREE';
      const min = 31;
      const max = 45;
      return seededRandom(min, max, i + 10);
    }),
    
    // G column (46-60)
    Array.from({ length: 5 }, (_, i) => {
      const min = 46;
      const max = 60;
      return seededRandom(min, max, i + 15);
    }),
    
    // O column (61-75)
    Array.from({ length: 5 }, (_, i) => {
      const min = 61;
      const max = 75;
      return seededRandom(min, max, i + 20);
    })
  ];
  
  return card;
};