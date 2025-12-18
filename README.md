# Chahar Barg Multiplayer (2-player) — Telegram Mini App + Socket.IO

## Run the game server locally
npm install
npm start
Open http://localhost:3000

## Telegram bot + admin match reports (recommended)
The server can run the Telegram bot **and** send you a private result message after each match.

Set these env vars before `npm start`:
- `BOT_TOKEN` — your bot token
- `WEBAPP_URL` — your deployed HTTPS URL (used for the "Start" button)
- `ADMIN_CHAT_ID` — your personal numeric Telegram chat id (where match results are sent)

### Windows PowerShell
```powershell
$env:BOT_TOKEN="PASTE_YOUR_TOKEN"
$env:WEBAPP_URL="https://YOUR-PUBLIC-HTTPS-URL/"
$env:ADMIN_CHAT_ID="123456789"
npm start
```

### macOS/Linux
```bash
export BOT_TOKEN="PASTE_YOUR_TOKEN"
export WEBAPP_URL="https://YOUR-PUBLIC-HTTPS-URL/"
export ADMIN_CHAT_ID="123456789"
npm start
```

## Legacy bot.js
`bot.js` is kept for reference, but you don't need it if you run the server with `BOT_TOKEN` (the server will start the bot itself).

## Deploy
Deploy this project to a host that supports Node.js (Render/Railway/Fly/VPS).
Your Web App URL is the deployed HTTPS URL (e.g. https://yourapp.onrender.com/).

Set `WEBAPP_URL` to that value, set `BOT_TOKEN` + `ADMIN_CHAT_ID`, and run the server.

## Notes
- Room id is derived from Telegram group chat (client.js uses Telegram.WebApp.initDataUnsafe).
- For production, add server-side validation of Telegram initData.
