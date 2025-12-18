# Chahar Barg Multiplayer (2-player) — Telegram Mini App + Socket.IO

## Run the game server locally
npm install
npm start
Open http://localhost:3000

## Run the bot (DO NOT hardcode your token)
### Windows PowerShell:
$env:BOT_TOKEN="PASTE_YOUR_TOKEN"
$env:WEBAPP_URL="https://YOUR-PUBLIC-HTTPS-URL/"
node bot.js

### macOS/Linux:
export BOT_TOKEN="PASTE_YOUR_TOKEN"
export WEBAPP_URL="https://YOUR-PUBLIC-HTTPS-URL/"
node bot.js

## Deploy
Deploy this project to a host that supports Node.js (Render/Railway/Fly/VPS).
Your Web App URL is the deployed HTTPS URL (e.g. https://yourapp.onrender.com/).

Then set WEBAPP_URL to that value and run the bot (host it too for 24/7).

## Notes
- Room id is derived from Telegram group chat (client.js uses Telegram.WebApp.initDataUnsafe).
- For production, add server-side validation of Telegram initData.
