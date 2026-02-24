// Generate a 5x5 Bingo card with numbers 1-75
export const generateBingoCard = () => {
  const card = [];
  const used = new Set();

  // Pick 25 unique numbers
  while (used.size < 25) {
    used.add(Math.floor(Math.random() * 75) + 1);
  }

  const numbers = [...used];
  for (let i = 0; i < 5; i++) {
    card.push(numbers.slice(i * 5, i * 5 + 5));
  }

  // Middle cell is a free space
  card[2][2] = "FREE";

  return card;
};

// Check if a player's marked numbers make a Bingo
// Only numbers that were actually called count
export const checkBingo = (card, marked, calledNumbers) => {
  const validMarked = marked.filter(n => calledNumbers.includes(n) || n === "FREE");

  // Check rows
  for (let i = 0; i < 5; i++) {
    let rowComplete = true;
    for (let j = 0; j < 5; j++) {
      if (card[i][j] !== "FREE" && !validMarked.includes(card[i][j])) {
        rowComplete = false;
        break;
      }
    }
    if (rowComplete) return true;
  }

  // Check columns
  for (let j = 0; j < 5; j++) {
    let colComplete = true;
    for (let i = 0; i < 5; i++) {
      if (card[i][j] !== "FREE" && !validMarked.includes(card[i][j])) {
        colComplete = false;
        break;
      }
    }
    if (colComplete) return true;
  }

  // Check diagonals
  let diag1Complete = true;
  let diag2Complete = true;
  for (let i = 0; i < 5; i++) {
    if (card[i][i] !== "FREE" && !validMarked.includes(card[i][i])) diag1Complete = false;
    if (card[i][4 - i] !== "FREE" && !validMarked.includes(card[i][4 - i])) diag2Complete = false;
  }
  if (diag1Complete || diag2Complete) return true;

  return false;
};
