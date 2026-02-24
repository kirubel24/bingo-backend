// src/services/userService.js
import bcrypt from 'bcrypt';
import { pool } from '../db.js';
import { generateBingoCard } from '../utils/bingoCardGenerator.js';

const saltRounds = 10;

export const registerUser = async (username, password) => {
  try {
    // Check if username already exists
    const [existingUsers] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    
    if (existingUsers.length > 0) {
      return { success: false, message: 'Username already exists' };
    }
    
    // Hash the password if provided (web registration)
    const hashedPassword = password ? await bcrypt.hash(password, saltRounds) : null;
    
    // Insert the new user
    const [result] = await pool.query(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword]
    );
    
    return { 
      success: true, 
      message: 'Registration successful',
      userId: result.insertId,
      username
    };
  } catch (error) {
    console.error('Error registering user:', error);
    return { success: false, message: 'Registration failed' };
  }
};

export const registerTelegramUser = async (telegramId, username, phoneNumber) => {
  try {
    // Check if telegram_id already exists
    const [existingUsers] = await pool.query(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );
    
    if (existingUsers.length > 0) {
      return { 
        success: true, 
        message: 'User already exists', 
        userId: existingUsers[0].id,
        user: existingUsers[0]
      };
    }
    
    // Check if username already exists (fallback for mixed systems)
    const [existingUsername] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    
    let finalUsername = username;
    if (existingUsername.length > 0) {
      finalUsername = `${username}_tg_${telegramId.substring(0, 5)}`;
    }

    // Insert the new user
    const [result] = await pool.query(
      'INSERT INTO users (username, telegram_id, phone_number) VALUES (?, ?, ?)',
      [finalUsername, telegramId, phoneNumber]
    );

    // Initialize wallet
    await pool.query('INSERT INTO wallets (user_id, main_balance, bonus_balance) VALUES (?, 0, 0)', [result.insertId]);

    return { 
      success: true, 
      message: 'Registration successful',
      userId: result.insertId,
      username: finalUsername
    };
  } catch (error) {
    console.error('Error registering telegram user:', error);
    return { success: false, message: 'Registration failed' };
  }
};

export const loginTelegramUser = async (telegramId) => {
  try {
    const [users] = await pool.query(
      'SELECT * FROM users WHERE telegram_id = ?',
      [telegramId]
    );
    
    if (users.length === 0) {
      return { success: false, message: 'User not registered' };
    }
    
    const user = users[0];
    const deactivated = Number(user.deactivated || 0) === 1;
    const bannedUntil = user.banned_until ? new Date(user.banned_until) : null;
    const isBanned = bannedUntil && bannedUntil.getTime() > Date.now();
    
    if (deactivated) return { success: false, message: 'Account deactivated' };
    if (isBanned) return { success: false, message: 'Account banned' };

    return { 
      success: true, 
      userId: user.id,
      username: user.username,
      user
    };
  } catch (error) {
    return { success: false, message: 'Login failed' };
  }
};

export const loginUser = async (username, password) => {
  try {
    // Find user by username
    const [users] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    
    if (users.length === 0) {
      return { success: false, message: 'Invalid username or password' };
    }
    
    const user = users[0];
    
    // Compare passwords
    const match = await bcrypt.compare(password, user.password);
    
    if (!match) {
      return { success: false, message: 'Invalid username or password' };
    }
    const deactivated = Number(user.deactivated || 0) === 1;
    const bannedUntil = user.banned_until ? new Date(user.banned_until) : null;
    const isBanned = bannedUntil && bannedUntil.getTime() > Date.now();
    if (deactivated) {
      return { success: false, message: 'Account is deactivated. Contact support.' };
    }
    if (isBanned) {
      return { success: false, message: 'Account is banned.' };
    }

    return { 
      success: true, 
      message: 'Login successful',
      userId: user.id,
      username: user.username
    };
  } catch (error) {
    console.error('Error logging in user:', error);
    return { success: false, message: 'Login failed' };
  }
};

export const getUserCard = async (userId) => {
  try {
    // Check if user has a card assigned
    const [userCards] = await pool.query(
      'SELECT * FROM user_cards WHERE user_id = ?',
      [userId]
    );
    
    if (userCards.length > 0) {
      // User already has a card
      return { 
        success: true,
        cardId: userCards[0].card_id,
        card: generateBingoCard(userCards[0].card_id) // Regenerate card based on card_id
      };
    } else {
      // Return no card found
      return {
        success: false,
        message: 'No card selected'
      };
    }
  } catch (error) {
    console.error('Error getting user card:', error);
    return { success: false, message: 'Failed to get bingo card' };
  }
};

export const getAvailableCards = async () => {
  try {
    // Get all cards that are currently assigned to users
    const query = 'SELECT card_id FROM user_cards';
    const [assignedCards] = await pool.query(query);
    
    // Create an array of assigned card IDs
    const assignedCardIds = assignedCards.map(card => card.card_id);
    
    // Generate array of all card IDs (1-100)
    const allCardIds = Array.from({ length: 100 }, (_, i) => i + 1);
    
    // Filter out assigned cards
    const availableCardIds = allCardIds.filter(id => !assignedCardIds.includes(id));
    
    return {
      success: true,
      availableCards: availableCardIds,
      assignedCards: assignedCardIds
    };
  } catch (error) {
    console.error('Error getting available cards:', error);
    return { success: false, message: 'Failed to get available cards' };
  }
};

export const selectUserCard = async (userId, cardId) => {
  try {
    const [[ust]] = await pool.query('SELECT blocked, deactivated, banned_until FROM users WHERE id=?', [userId])
    const isBlocked = Number(ust?.blocked || 0) === 1
    const isDeactivated = Number(ust?.deactivated || 0) === 1
    const isBanned = ust?.banned_until ? new Date(ust.banned_until).getTime() > Date.now() : false
    if (isBlocked || isDeactivated || isBanned) {
      return { success: false, message: 'Card selection is restricted for your account' }
    }
    // Check if card is already assigned to another user
    const checkCardQuery = 'SELECT * FROM user_cards WHERE card_id = ?';
    const [assignedCards] = await pool.query(checkCardQuery, [cardId]);
    
    if (assignedCards.length > 0 && assignedCards[0].user_id !== userId) {
      return { success: false, message: 'Card already selected by another player' };
    }
    
    // Check if user already has a card
    const checkUserQuery = 'SELECT * FROM user_cards WHERE user_id = ?';
    const [userCards] = await pool.query(checkUserQuery, [userId]);
    
    if (userCards.length > 0) {
      // Update existing card assignment
      const updateQuery = 'UPDATE user_cards SET card_id = ? WHERE user_id = ?';
      await pool.query(updateQuery, [cardId, userId]);
    } else {
      // Create new card assignment
      const insertQuery = 'INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)';
      await pool.query(insertQuery, [userId, cardId]);
    }
    
    // Return the selected card
    return {
      success: true,
      message: 'Card selected successfully',
      cardId: cardId,
      card: generateBingoCard(cardId)
    };
  } catch (error) {
    console.error('Error selecting card:', error);
    return { success: false, message: 'Failed to select card' };
  }
};
