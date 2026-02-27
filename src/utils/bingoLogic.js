// Generate a 5x5 Bingo card with numbers 1-75 according to standard ranges
// B: 1-15, I: 16-30, N: 31-45, G: 46-60, O: 61-75
export const generateBingoCard = () => {
  const card = [];
  const ranges = [
    { min: 1, max: 15 },  // B
    { min: 16, max: 30 }, // I
    { min: 31, max: 45 }, // N
    { min: 46, max: 60 }, // G
    { min: 61, max: 75 }  // O
  ];

  // Generate 5 numbers for each column within its range
  const columns = ranges.map((range, colIndex) => {
    const columnNumbers = new Set();
    while (columnNumbers.size < 5) {
      const num = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      columnNumbers.add(num);
    }
    const sortedColumn = Array.from(columnNumbers).sort((a, b) => a - b);
    
    // Replace the middle cell of the N column (index 2) with FREE
    if (colIndex === 2) {
      // The middle cell in the N column is always at index 2 after sorting too, 
      // but we need to ensure it's specifically 'FREE' as requested.
      // Standard Bingo cards usually have the numbers sorted in columns.
      sortedColumn[2] = "FREE";
    }
    return sortedColumn;
  });

  // Return the columns directly (5x5 grid where card[col][row])
  return columns;
};

// Check if a player's marked numbers make a Bingo
// card is assumed to be in column-based format: [colB, colI, colN, colG, colO]
export const checkBingo = (card, marked, calledNumbers) => {
  const validMarked = marked.filter(n => calledNumbers.includes(n) || n === "FREE");

  // Check columns (outer loop is column index)
  for (let col = 0; col < 5; col++) {
    let colComplete = true;
    for (let row = 0; row < 5; row++) {
      if (card[col][row] !== "FREE" && !validMarked.includes(card[col][row])) {
        colComplete = false;
        break;
      }
    }
    if (colComplete) return true;
  }

  // Check rows (outer loop is row index)
  for (let row = 0; row < 5; row++) {
    let rowComplete = true;
    for (let col = 0; col < 5; col++) {
      if (card[col][row] !== "FREE" && !validMarked.includes(card[col][row])) {
        rowComplete = false;
        break;
      }
    }
    if (rowComplete) return true;
  }

  // Check diagonals
  let diag1Complete = true;
  let diag2Complete = true;
  for (let i = 0; i < 5; i++) {
    // Top-left to bottom-right: (col 0, row 0), (col 1, row 1), ...
    if (card[i][i] !== "FREE" && !validMarked.includes(card[i][i])) diag1Complete = false;
    // Top-right to bottom-left: (col 4, row 0), (col 3, row 1), ...
    if (card[4 - i][i] !== "FREE" && !validMarked.includes(card[4 - i][i])) diag2Complete = false;
  }
  if (diag1Complete || diag2Complete) return true;

  return false;
};
