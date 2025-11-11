const TelegramBot = require('node-telegram-bot-api');

module.exports = async (req, res) => {
  // Get bot token from environment variables
  const token = process.env.BOT_TOKEN;
  
  if (!token) {
    return res.status(500).json({ error: 'BOT_TOKEN not set' });
  }

  const bot = new TelegramBot(token);

  // Only handle POST requests (webhook updates)
  if (req.method === 'POST') {
    try {
      const update = req.body;
      
      // Process the update
      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text;

        console.log(`Received message: ${text} from ${chatId}`);

        // Handle commands
        if (text === '/start') {
          await bot.sendMessage(chatId, 'Welcome! I am a simple bot hosted on Vercel. Send me a message!');
        } else if (text === '/help') {
          await bot.sendMessage(chatId, 'Available commands:\n/start - Start the bot\n/help - Show this help\n/echo [text] - Echo your text');
        } else if (text.startsWith('/echo')) {
          const echoText = text.substring(6);
          await bot.sendMessage(chatId, `You said: ${echoText}`);
        } else {
          await bot.sendMessage(chatId, `You said: "${text}"\n\nUse /help to see available commands.`);
        }
      }

      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Error processing update:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    // For GET requests, show setup instructions
    res.status(200).json({
      message: 'Telegram Bot is running!',
      instructions: [
        '1. Set BOT_TOKEN environment variable in Vercel',
        '2. Set webhook URL: https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_VERCEL_URL>/api',
        '3. Start chatting with your bot!'
      ]
    });
  }
};
