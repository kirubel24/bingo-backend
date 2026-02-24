import express from "express";
import { getAllGames } from "../services/gameService.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.json(getAllGames());
});

export default router;
