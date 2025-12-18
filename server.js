const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

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
    started: false,
    gameOver: false,

    deck: makeDeck(),
    floor: [],
    hands: { p1: [], p2: [] },
    captured: { p1: [], p2: [] },
    surs: { p1: 0, p2: 0 },
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
      hand: state.hands[viewerKey].map(c => c.id),
      capturedCount: state.captured[viewerKey].length,
      surs: state.surs[viewerKey]
    },
    opp: {
      key: oppKey,
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

function checkAndDealNext(state) {
  const handsEmpty = state.hands.p1.length === 0 && state.hands.p2.length === 0;
  if (!handsEmpty) return;

  if (state.deck.length === 0) { endGame(state); return; }
  dealHands(state);
}

io.on("connection", (socket) => {
  socket.on("createRoom", () => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const state = createGameState(roomId, socket.id);
    rooms.set(roomId, state);
    socket.join(roomId);
    socket.emit("roomCreated", { roomId, youAre: "p1" });
    broadcastState(state);
  });

  // Group-based: auto-create room if missing
  socket.on("joinRoom", ({ roomId }) => {
    const id = String(roomId || "").toUpperCase();
    let state = rooms.get(id);
    if (!state) {
      state = createGameState(id, null);
      rooms.set(id, state);
    }

    if (state.players.p1 && state.players.p2) return socket.emit("errorMsg", "Room is full.");

    if (!state.players.p1) state.players.p1 = socket.id;
    else if (!state.players.p2) state.players.p2 = socket.id;

    state.started = !!(state.players.p1 && state.players.p2);

    socket.join(id);
    socket.emit("joined", { roomId: id, youAre: state.players.p1 === socket.id ? "p1" : "p2" });
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
