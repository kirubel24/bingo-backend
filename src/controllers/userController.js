// src/controllers/userController.js
import { registerUser, loginUser, getUserCard, getAvailableCards, selectUserCard } from '../services/userService.js';

export const handleRegister = async (socket, data) => {
  const { username, password } = data;
  const result = await registerUser(username, password);
  socket.emit('register_response', result);
};

export const handleLogin = async (socket, data) => {
  const { username, password } = data;
  const result = await loginUser(username, password);
  socket.emit('login_response', result);
};

export const handleGetCard = async (socket, data) => {
  const { userId } = data;
  const result = await getUserCard(userId);
  socket.emit('card_data', result);
};

export const handleGetAvailableCards = async (socket, data) => {
  const { userId } = data;
  const result = await getAvailableCards();
  socket.emit('available_cards', result);
};

export const handleSelectCard = async (socket, data) => {
  const { userId, cardId } = data;
  const result = await selectUserCard(userId, cardId);
  socket.emit('card_data', result);
};