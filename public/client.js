/* Chahar Barg client (Telegram Mini App + browser testing)
   - slick card UI (pure CSS)
   - light animations for new cards + play action
   - sends display name to server, reads opponent name from state
*/

const socket = io();
const qs = new URLSearchParams(location.search);

const el = (id) => document.getElementById(id);

const createBtn = el("create");
const joinBtn = el("join");
const nameInput = el("name");
const roomInput = el("room");

const statusPill = el("statusPill");
const info = el("info");
const err = el("err");
const hint = el("hint");

const floorEl = el("floor");
const handEl = el("hand");
const turnEl = el("turn");
const deckEl = el("deck");

const myCapEl = el("myCap");
const mySurEl = el("mySur");

const oppHandEl = el("oppHand");
const oppCapEl = el("oppCap");
const oppSurEl = el("oppSur");

const meNameEl = el("meName");
const oppNameEl = el("oppName");

const finalPanel = el("finalPanel");
const finalEl = el("final");
const copyResultBtn = el("copyResult");

let prev = null;
let pendingPlay = null;

function setError(msg) {
  err.textContent = msg || "";
}

function setInfo(msg) {
  info.textContent = msg || "";
}

function setStatus(text, kind = "") {
  statusPill.textContent = text;
  statusPill.classList.remove("ok", "warn", "bad");
  if (kind) statusPill.classList.add(kind);
}

function parseCardId(cardId) {
  const suit = cardId.slice(-1);
  const rank = cardId.slice(0, -1);
  const isRed = suit === "♥" || suit === "♦";
  return { rank, suit, isRed };
}

function createCardNode(cardId, { clickable = false, fresh = false } = {}) {
  const { rank, suit, isRed } = parseCardId(cardId);
  const d = document.createElement("div");
  d.className = `card ${isRed ? "red" : "black"} ${clickable ? "clickable" : ""} ${fresh ? "new" : ""}`.trim();
  d.dataset.cardId = cardId;

  d.innerHTML = `
    <div class="corner tl">${rank}<span class="s">${suit}</span></div>
    <div class="pip">${suit}</div>
    <div class="corner br">${rank}<span class="s">${suit}</span></div>
  `;
  return d;
}

function getTelegramIdentity() {
  try {
    if (!window.Telegram?.WebApp) return null;
    const unsafe = Telegram.WebApp.initDataUnsafe || {};
    const user = unsafe.user || null;
    const chat = unsafe.chat || null;
    return { unsafe, user, chat };
  } catch {
    return null;
  }
}

function getTelegramRoomId() {
  const ident = getTelegramIdentity();
  if (!ident) return null;
  const { unsafe, chat } = ident;
  if (chat && chat.id) return `G_${chat.id}`;
  if (unsafe.chat_instance) return `GI_${unsafe.chat_instance}`;
  return null;
}

function suggestedDisplayName() {
  const ident = getTelegramIdentity();
  if (ident?.user) {
    const u = ident.user;
    return u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(" ");
  }
  return (localStorage.getItem("cb_name") || "").trim();
}

function currentDisplayName() {
  const fromInput = (nameInput.value || "").trim();
  const chosen = fromInput || suggestedDisplayName() || "Player";
  // keep it short and safe
  return chosen.slice(0, 20);
}

function persistName() {
  const n = (nameInput.value || "").trim();
  if (n) localStorage.setItem("cb_name", n.slice(0, 20));
}

function render(state) {
  setError("");

  const isMyTurn = state.turn === state.me.key && !state.gameOver && state.started;
  hint.textContent = state.gameOver
    ? "Match finished."
    : (state.started ? (isMyTurn ? "Your turn — tap a card." : "Wait for opponent…") : "Waiting for 2nd player…");

  // Names
  meNameEl.textContent = state.me.name || (state.me.key === "p1" ? "P1" : "P2");
  oppNameEl.textContent = state.opp.name || "Waiting…";

  // Floor
  floorEl.innerHTML = "";
  const prevFloor = new Set(prev?.floor || []);
  for (const id of state.floor) {
    const node = createCardNode(id, { fresh: !prevFloor.has(id) });
    floorEl.appendChild(node);
  }

  // Hand
  handEl.innerHTML = "";
  const prevHand = new Set(prev?.me?.hand || []);
  for (const id of state.me.hand) {
    const node = createCardNode(id, { clickable: isMyTurn && !pendingPlay, fresh: !prevHand.has(id) });
    if (isMyTurn && !pendingPlay) {
      node.addEventListener("click", () => playCardWithAnimation(state.roomId, id, node));
    }
    handEl.appendChild(node);
  }

  myCapEl.textContent = String(state.me.capturedCount);
  mySurEl.textContent = String(state.me.surs);

  oppHandEl.textContent = String(state.opp.handCount);
  oppCapEl.textContent = String(state.opp.capturedCount);
  oppSurEl.textContent = String(state.opp.surs);

  const turnText =
    state.gameOver ? "Game Over"
      : !state.started ? "Waiting…"
        : (state.turn === state.me.key ? "Your turn" : "Opponent turn");
  turnEl.textContent = turnText;
  deckEl.textContent = `Deck: ${state.deckCount}`;

  if (state.gameOver && state.final) {
    finalPanel.style.display = "";
    finalEl.textContent = prettyResult(state);
  } else {
    finalPanel.style.display = "none";
    finalEl.textContent = "";
  }

  setInfo(`Room: ${state.roomId}`);
  prev = state;
}

function prettyResult(state) {
  const f = state.final;
  const p1 = f.p1Name || "P1";
  const p2 = f.p2Name || "P2";
  const winner = f.winner === "draw" ? "Draw" : (f.winner === "p1" ? p1 : p2);

  const row = (label, a, b) => `${label.padEnd(12)} ${String(a).padStart(3)} | ${String(b).padStart(3)}`;
  return [
    `Winner: ${winner}`,
    `Room:   ${state.roomId}`,
    "",
    `${p1} vs ${p2}`,
    "────────────────────────",
    row("Aces", f.p1.aces, f.p2.aces),
    row("Jacks", f.p1.jacks, f.p2.jacks),
    row("10♦", f.p1.tenDiamonds, f.p2.tenDiamonds),
    row("2♣", f.p1.twoClubs, f.p2.twoClubs),
    row("Surs", f.p1.surPoints, f.p2.surPoints),
    row("Clubs", f.p1.clubs, f.p2.clubs),
    "────────────────────────",
    row("TOTAL", f.p1.total, f.p2.total),
  ].join("\n");
}

function playCardWithAnimation(roomId, cardId, node) {
  if (pendingPlay) return;
  pendingPlay = { roomId, cardId };
  // quick feedback
  node.style.animation = "playOut .24s ease-in forwards";
  setTimeout(() => {
    socket.emit("playCard", { roomId, cardId });
    pendingPlay = null;
  }, 220);
}

copyResultBtn?.addEventListener("click", async () => {
  try {
    const txt = finalEl.textContent || "";
    await navigator.clipboard.writeText(txt);
    copyResultBtn.textContent = "Copied";
    setTimeout(() => (copyResultBtn.textContent = "Copy"), 900);
  } catch {
    // ignore
  }
});

createBtn.onclick = () => {
  persistName();
  socket.emit("createRoom", { name: currentDisplayName(), tg: getTelegramIdentity()?.user || null });
};

joinBtn.onclick = () => {
  persistName();
  const id = (roomInput.value || "").trim().toUpperCase();
  if (!id) return setError("Enter a room id.");
  socket.emit("joinRoom", { roomId: id, name: currentDisplayName(), tg: getTelegramIdentity()?.user || null });
};

socket.on("connect", () => setStatus("Connected", "ok"));
socket.on("disconnect", () => setStatus("Disconnected", "bad"));

socket.on("roomCreated", ({ roomId: id, youAre }) => {
  roomInput.value = id;
  history.replaceState(null, "", `?room=${encodeURIComponent(id)}`);
  setInfo(`Room created: ${id} • You are ${youAre}`);
});

socket.on("joined", ({ roomId: id, youAre }) => {
  roomInput.value = id;
  history.replaceState(null, "", `?room=${encodeURIComponent(id)}`);
  setInfo(`Joined: ${id} • You are ${youAre}`);
});

socket.on("state", (state) => render(state));
socket.on("errorMsg", (msg) => setError(msg));

// Auto-fill name
nameInput.value = suggestedDisplayName();

// Auto-join Telegram group room first
const tgRoom = getTelegramRoomId();
if (tgRoom) {
  roomInput.value = tgRoom;
  // join silently
  socket.emit("joinRoom", { roomId: tgRoom, name: currentDisplayName(), tg: getTelegramIdentity()?.user || null });
} else {
  // fallback browser testing
  const autoRoom = (qs.get("room") || "").trim().toUpperCase();
  if (autoRoom) {
    roomInput.value = autoRoom;
    socket.emit("joinRoom", { roomId: autoRoom, name: currentDisplayName(), tg: null });
  }
}

// Telegram Mini App nicety
try {
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
  }
} catch {}
