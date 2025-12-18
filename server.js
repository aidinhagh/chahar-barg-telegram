const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

// --- Telegram bot (optional) ---
// If you set these env vars, this same process will:
// 1) respond to /start and /play in groups (posts the web-app button)
// 2) send ADMIN a summary of each finished match (room + usernames + scores)
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL; // e.g. https://yourdomain.com/
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // your Telegram numeric chat id

let bot = null;
if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });

  function isGroup(chat) {
    return chat && (chat.type === "group" || chat.type === "supergroup");
  }

  function webAppInlineKeyboard() {
    if (!WEBAPP_URL) return null;
    return {
      inline_keyboard: [[{ text: "🃏 Start Chahar Barg", web_app: { url: WEBAPP_URL } }]],
    };
  }

  // Lightweight commands (kept optional — you can ignore if you already handle commands elsewhere)
  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isGroup(msg.chat)) {
      return bot.sendMessage(chatId, "Add me to a group to play 2‑player Chahar Barg. Then type /play in the group.");
    }
    return bot.sendMessage(chatId, "Ready. Type /play to post the Start button.");
  });

  bot.onText(/^\/play$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isGroup(msg.chat)) {
      return bot.sendMessage(chatId, "Use this command inside a group.");
    }
    const kb = webAppInlineKeyboard();
    if (!kb) {
      return bot.sendMessage(chatId, "WEBAPP_URL is not set on the server.");
    }
    return bot.sendMessage(chatId, "Tap to open the game. The room is this group (2 players).", { reply_markup: kb });
  });
}

const SUITS = ["♠", "♥", "♣", "♦"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const VALUES = { A:1, "2":2, "3":3, "4":4, "5":5, "6":6, "7":7, "8":8, "9":9, "10":10, J:11, Q:12, K:13 };

function cardId(rank, suit) { return `${rank}${suit}`; }
function parseCard(id) {
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  return { id, rank, suit, value: VALUES[rank] };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function findSubsetSum(floorCards, targetSum) {
  const numericFloor = floorCards.filter(c => c.value <= 10);
  let result = [];

  function search(index, currentSum, currentCards) {
    if (currentSum === targetSum) { result = currentCards; return true; }
    if (currentSum > targetSum || index === numericFloor.length) return false;

    if (search(index + 1, currentSum + numericFloor[index].value, [...currentCards, numericFloor[index]])) return true;
    return search(index + 1, currentSum, currentCards);
  }

  search(0, 0, []);
  return result;
}

function getCaptures(card, floor) {
  if (card.rank === "J") {
    const captures = floor.filter(c => c.rank !== "K" && c.rank !== "Q");
    return captures.length > 0 ? captures : null;
  }
  if (card.rank === "K") {
    const kings = floor.filter(c => c.rank === "K");
    return kings.length > 0 ? kings : null;
  }
  if (card.rank === "Q") {
    const queens = floor.filter(c => c.rank === "Q");
    return queens.length > 0 ? queens : null;
  }
  const subset = findSubsetSum(floor, 11 - card.value);
  return subset.length > 0 ? subset : null;
}

function calculateScore(pile, surs) {
  const tenDiamonds = pile.some(c => c.rank === "10" && c.suit === "♦") ? 3 : 0;
  const twoClubs = pile.some(c => c.rank === "2" && c.suit === "♣") ? 2 : 0;
  const aces = pile.filter(c => c.rank === "A").length;
  const jacks = pile.filter(c => c.rank === "J").length;
  const surPoints = surs * 5;
  const total = tenDiamonds + twoClubs + aces + jacks + surPoints;
  return { tenDiamonds, twoClubs, aces, jacks, surPoints, total };
}

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(parseCard(cardId(r, s)));
  return shuffle(deck);
}

function dealFloor(state) {
  while (state.floor.length < 4 && state.deck.length) {
    const card = state.deck.pop();
    if (card.rank === "J") {
      const idx = Math.floor(Math.random() * (state.deck.length + 1));
      state.deck.splice(idx, 0, card);
    } else {
      state.floor.push(card);
    }
  }
}

function dealHands(state) {
  if (state.deck.length === 0) return false;
  for (let i = 0; i < 4; i++) {
    if (state.deck.length) state.hands.p1.push(state.deck.pop());
    if (state.deck.length) state.hands.p2.push(state.deck.pop());
  }
  return true;
}

function createGameState(roomId, creatorSocketId) {
  const state = {
    roomId,
    players: { p1: creatorSocketId, p2: null },
    names: { p1: null, p2: null },
    started: false,
    gameOver: false,
    reported: false,

    deck: makeDeck(),
    floor: [],
    hands: { p1: [], p2: [] },
    captured: { p1: [], p2: [] },
    surs: { p1: 0, p2: 0 },
    telegram: { p1: null, p2: null },
    lastCapturedBy: null,

    turn: "p1",
    winner: null,
    final: null
  };

  dealFloor(state);
  dealHands(state);
  return state;
}

const rooms = new Map();

function roomForSocket(socketId) {
  for (const [id, st] of rooms.entries()) {
    if (st.players.p1 === socketId || st.players.p2 === socketId) return id;
  }
  return null;
}

function opponentOf(playerKey) { return playerKey === "p1" ? "p2" : "p1"; }

function sanitizeStateFor(state, viewerKey) {
  const oppKey = opponentOf(viewerKey);
  return {
    roomId: state.roomId,
    started: state.started,
    gameOver: state.gameOver,
    turn: state.turn,
    deckCount: state.deck.length,
    floor: state.floor.map(c => c.id),
    me: {
      key: viewerKey,
      name: state.names[viewerKey] || null,
      hand: state.hands[viewerKey].map(c => c.id),
      capturedCount: state.captured[viewerKey].length,
      surs: state.surs[viewerKey]
    },
    opp: {
      key: oppKey,
      name: state.names[oppKey] || null,
      handCount: state.hands[oppKey].length,
      capturedCount: state.captured[oppKey].length,
      surs: state.surs[oppKey]
    },
    final: state.final
  };
}

function broadcastState(state) {
  if (state.players.p1) io.to(state.players.p1).emit("state", sanitizeStateFor(state, "p1"));
  if (state.players.p2) io.to(state.players.p2).emit("state", sanitizeStateFor(state, "p2"));
}

function endGame(state) {
  state.gameOver = true;

  if (state.floor.length > 0 && state.lastCapturedBy) {
    state.captured[state.lastCapturedBy].push(...state.floor);
    state.floor = [];
  }

  const p1Score = calculateScore(state.captured.p1, state.surs.p1);
  const p2Score = calculateScore(state.captured.p2, state.surs.p2);

  const p1Clubs = state.captured.p1.filter(c => c.suit === "♣").length;
  const p2Clubs = state.captured.p2.filter(c => c.suit === "♣").length;

  if (p1Clubs > p2Clubs) p1Score.total += 7;
  else if (p2Clubs > p1Clubs) p2Score.total += 7;

  let winner = "draw";
  if (p1Score.total > p2Score.total) winner = "p1";
  else if (p2Score.total > p1Score.total) winner = "p2";

  state.winner = winner;
  state.final = {
    winner,
    p1: { ...p1Score, clubs: p1Clubs },
    p2: { ...p2Score, clubs: p2Clubs }
  };
}

function winnerLabel(final) {
  if (!final) return "";
  if (final.winner === "draw") return "Draw";
  return final.winner === "p1" ? "P1" : "P2";
}

function safeMd(s) {
  return String(s || "").replace(/[\_\*\[\]\(\)\~\`\>\#\+\-\=\|\{\}\.\!]/g, "\\$&");
}

async function notifyAdminOnce(state) {
  if (!bot || !ADMIN_CHAT_ID) return;
  if (state.reported) return;
  if (!state.gameOver || !state.final) return;

  state.reported = true;

  const p1Name = state.names.p1 || "p1";
  const p2Name = state.names.p2 || "p2";
  const f = state.final;

  const p1Tg = state.telegram?.p1 || null;
  const p2Tg = state.telegram?.p2 || null;

  const p1Id = p1Tg && typeof p1Tg.id !== "undefined" ? String(p1Tg.id) : "unknown";
  const p2Id = p2Tg && typeof p2Tg.id !== "undefined" ? String(p2Tg.id) : "unknown";

  const p1User = p1Tg && p1Tg.username ? `@${p1Tg.username}` : "-";
  const p2User = p2Tg && p2Tg.username ? `@${p2Tg.username}` : "-";

  const lines = [];
  lines.push("🃏 Chahar Barg — Match Result");
  lines.push(`Room: ${state.roomId}`);
  lines.push(`Players: ${p1Name} vs ${p2Name}`);
  lines.push(`Winner: ${winnerLabel(f)}`);
  lines.push("");
  lines.push(`P1 ${p1Name}: TOTAL=${f.p1.total} | 10♦=${f.p1.tenDiamonds} 2♣=${f.p1.twoClubs} A=${f.p1.aces} J=${f.p1.jacks} Sur=${f.p1.surPoints} Clubs=${f.p1.clubs}`);
  lines.push(`P2 ${p2Name}: TOTAL=${f.p2.total} | 10♦=${f.p2.tenDiamonds} 2♣=${f.p2.twoClubs} A=${f.p2.aces} J=${f.p2.jacks} Sur=${f.p2.surPoints} Clubs=${f.p2.clubs}`);
  lines.push("");
  lines.push(`P1 Telegram: id=${p1Id} username=${p1User}`);
  lines.push(`P2 Telegram: id=${p2Id} username=${p2User}`);

  try {
    await bot.sendMessage(ADMIN_CHAT_ID, lines.join("
"));
  } catch (e) {
    console.error("Failed to notify admin:", e?.message || e);
  }
}


function checkAndDealNext(state) {
  const handsEmpty = state.hands.p1.length === 0 && state.hands.p2.length === 0;
  if (!handsEmpty) return;

  if (state.deck.length === 0) { endGame(state); return; }
  dealHands(state);
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name, tg } = {}) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const state = createGameState(roomId, socket.id);
    if (name) state.names.p1 = String(name).trim().slice(0, 24);
    if (tg && typeof tg === "object") {
      state.telegram.p1 = {
        id: tg.id,
        username: tg.username || null,
        first_name: tg.first_name || null,
        last_name: tg.last_name || null,
      };
    }
    rooms.set(roomId, state);
    socket.join(roomId);
    socket.emit("roomCreated", { roomId, youAre: "p1" });
    broadcastState(state);
  });

  // Group-based: auto-create room if missing
  socket.on("joinRoom", ({ roomId, name, tg }) => {
    const id = String(roomId || "").toUpperCase();
    let state = rooms.get(id);
    if (!state) {
      state = createGameState(id, null);
      rooms.set(id, state);
    }

    if (state.players.p1 && state.players.p2) return socket.emit("errorMsg", "Room is full.");

    if (!state.players.p1) state.players.p1 = socket.id;
    else if (!state.players.p2) state.players.p2 = socket.id;

    const playerKey = state.players.p1 === socket.id ? "p1" : "p2";

    // Save Telegram identity for admin reporting only (not sent to other players)
    if (tg && typeof tg === "object") {
      state.telegram[playerKey] = {
        id: tg.id,
        username: tg.username || null,
        first_name: tg.first_name || null,
        last_name: tg.last_name || null,
      };
    }

    // Store a friendly display name (prefer Telegram username / first_name if present)
    const guessFromTg = (tg && typeof tg === "object")
      ? (tg.username ? `@${tg.username}` : `${tg.first_name || ""} ${tg.last_name || ""}`.trim() || null)
      : null;
    const cleanName = String(guessFromTg || name || "").trim().slice(0, 24);
    if (cleanName) state.names[playerKey] = cleanName;

    state.started = !!(state.players.p1 && state.players.p2);

    socket.join(id);
    socket.emit("joined", { roomId: id, youAre: playerKey });
    broadcastState(state);
  });

  socket.on("playCard", ({ roomId, cardId }) => {
    const id = String(roomId || "").toUpperCase();
    const state = rooms.get(id);
    if (!state || state.gameOver) return;

    const playerKey = state.players.p1 === socket.id ? "p1" : (state.players.p2 === socket.id ? "p2" : null);
    if (!playerKey) return;

    if (!state.started) return socket.emit("errorMsg", "Waiting for second player…");
    if (state.turn !== playerKey) return socket.emit("errorMsg", "Not your turn.");

    const hand = state.hands[playerKey];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return socket.emit("errorMsg", "That card is not in your hand.");

    const played = hand.splice(idx, 1)[0];

    const captures = getCaptures(played, state.floor);
    if (captures && captures.length > 0) {
      state.lastCapturedBy = playerKey;

      for (const cap of captures) {
        const fIdx = state.floor.findIndex(fc => fc.id === cap.id);
        if (fIdx !== -1) state.floor.splice(fIdx, 1);
      }

      state.captured[playerKey].push(played, ...captures);

      if (state.floor.length === 0 && played.rank !== "J") {
        state.surs[playerKey] += 1;
      }
    } else {
      state.floor.push(played);
    }

    state.turn = opponentOf(playerKey);
    checkAndDealNext(state);

    broadcastState(state);

    // If the match just ended, send a private summary to ADMIN_CHAT_ID (if configured)
    if (state.gameOver) notifyAdminOnce(state);
  });

  socket.on("leaveRoom", () => {
    const roomId = roomForSocket(socket.id);
    if (!roomId) return;
    const state = rooms.get(roomId);
    if (!state) return;

    if (state.players.p1 === socket.id) state.players.p1 = null;
    if (state.players.p2 === socket.id) state.players.p2 = null;

    if (!state.players.p1 && !state.players.p2) rooms.delete(roomId);
  });

  socket.on("disconnect", () => {
    const roomId = roomForSocket(socket.id);
    if (!roomId) return;
    const state = rooms.get(roomId);
    if (!state) return;

    if (state.players.p1 === socket.id) state.players.p1 = null;
    if (state.players.p2 === socket.id) state.players.p2 = null;

    state.started = !!(state.players.p1 && state.players.p2);
    if (!state.players.p1 && !state.players.p2) rooms.delete(roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
