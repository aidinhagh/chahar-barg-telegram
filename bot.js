const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = process.env.BOT_TOKEN;       // DO NOT hardcode
const WEBAPP_URL = process.env.WEBAPP_URL;     // e.g. https://yourdomain.com/

if (!BOT_TOKEN) throw new Error("Missing BOT_TOKEN env var");
if (!WEBAPP_URL) throw new Error("Missing WEBAPP_URL env var");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function isGroup(chat) {
  return chat && (chat.type === "group" || chat.type === "supergroup");
}

function webAppInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🃏 Start Chahar Barg", web_app: { url: WEBAPP_URL } }]
    ]
  };
}

bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;

  if (!isGroup(msg.chat)) {
    return bot.sendMessage(chatId, "Add me to a group to play 2-player Chahar Barg. Then type /play in the group.");
  }
  return bot.sendMessage(chatId, "Ready. Type /play to post the Start button.");
});

bot.onText(/^\/play$/, async (msg) => {
  const chatId = msg.chat.id;

  if (!isGroup(msg.chat)) {
    return bot.sendMessage(chatId, "Use this command inside a group.");
  }

  return bot.sendMessage(
    chatId,
    "Tap to open the game. The room is this group (2 players).",
    { reply_markup: webAppInlineKeyboard() }
  );
});

bot.on("message", (msg) => {
  if (msg.web_app_data?.data) {
    bot.sendMessage(msg.chat.id, `Got web_app_data: ${msg.web_app_data.data}`);
  }
});

console.log("Bot is running (polling).");
