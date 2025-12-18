const socket = io();
const qs = new URLSearchParams(location.search);

const el = (id) => document.getElementById(id);

const createBtn = el("create");
const joinBtn = el("join");
const roomInput = el("room");
const info = el("info");
const err = el("err");

const floorEl = el("floor");
const handEl = el("hand");
const turnEl = el("turn");
const deckEl = el("deck");

const myCapEl = el("myCap");
const mySurEl = el("mySur");

const oppHandEl = el("oppHand");
const oppCapEl = el("oppCap");
const oppSurEl = el("oppSur");

const finalPanel = el("finalPanel");
const finalEl = el("final");

function cardColor(cardId) {
  const suit = cardId.slice(-1);
  return (suit === "♥" || suit === "♦") ? "red" : "black";
}

function setError(msg) { err.textContent = msg || ""; }
function setInfo(msg) { info.textContent = msg || ""; }

function getTelegramRoomId() {
  try {
    if (!window.Telegram?.WebApp) return null;
    const unsafe = Telegram.WebApp.initDataUnsafe || {};
    if (unsafe.chat && unsafe.chat.id) return `G_${unsafe.chat.id}`;
    if (unsafe.chat_instance) return `GI_${unsafe.chat_instance}`;
    return null;
  } catch {
    return null;
  }
}

function render(state) {
  setError("");

  floorEl.innerHTML = "";
  state.floor.forEach(id => {
    const d = document.createElement("div");
    d.className = `card ${cardColor(id)}`;
    d.textContent = id;
    floorEl.appendChild(d);
  });

  handEl.innerHTML = "";
  state.me.hand.forEach(id => {
    const d = document.createElement("div");
    const isMyTurn = state.turn === state.me.key && !state.gameOver;
    d.className = `card ${cardColor(id)} ${isMyTurn ? "clickable" : ""}`;
    d.textContent = id;

    if (isMyTurn) {
      d.addEventListener("click", () => {
        socket.emit("playCard", { roomId: state.roomId, cardId: id });
      });
    }
    handEl.appendChild(d);
  });

  myCapEl.textContent = String(state.me.capturedCount);
  mySurEl.textContent = String(state.me.surs);

  oppHandEl.textContent = String(state.opp.handCount);
  oppCapEl.textContent = String(state.opp.capturedCount);
  oppSurEl.textContent = String(state.opp.surs);

  const turnText =
    state.gameOver ? "Game Over"
    : !state.started ? "Waiting for 2nd player…"
    : (state.turn === state.me.key ? "Your turn" : "Opponent’s turn");

  turnEl.textContent = turnText;
  deckEl.textContent = `Deck: ${state.deckCount}`;

  if (state.gameOver && state.final) {
    finalPanel.style.display = "";
    finalEl.textContent = JSON.stringify(state.final, null, 2);
  } else {
    finalPanel.style.display = "none";
    finalEl.textContent = "";
  }

  setInfo(`Room: ${state.roomId} | You: ${state.me.key}`);
}

createBtn.onclick = () => socket.emit("createRoom");

joinBtn.onclick = () => {
  const id = roomInput.value.trim().toUpperCase();
  if (!id) return setError("Enter a room id.");
  socket.emit("joinRoom", { roomId: id });
};

socket.on("roomCreated", ({ roomId: id, youAre }) => {
  roomInput.value = id;
  history.replaceState(null, "", `?room=${encodeURIComponent(id)}`);
  setInfo(`Room created: ${id}. Share this ID with your friend (browser testing). You are ${youAre}.`);
});

socket.on("joined", ({ roomId: id, youAre }) => {
  roomInput.value = id;
  history.replaceState(null, "", `?room=${encodeURIComponent(id)}`);
  setInfo(`Joined room: ${id}. You are ${youAre}.`);
});

socket.on("state", (state) => render(state));
socket.on("errorMsg", (msg) => setError(msg));

// Auto-join: Telegram group room first
const tgRoom = getTelegramRoomId();
if (tgRoom) {
  roomInput.value = tgRoom;
  socket.emit("joinRoom", { roomId: tgRoom });
} else {
  // fallback browser testing
  const autoRoom = (qs.get("room") || "").trim().toUpperCase();
  if (autoRoom) {
    roomInput.value = autoRoom;
    socket.emit("joinRoom", { roomId: autoRoom });
  }
}

// Telegram Mini App nicety
try {
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
  }
} catch {}
