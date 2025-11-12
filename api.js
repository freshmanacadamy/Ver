const TelegramBot = require('node-telegram-bot-api');

// Global error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID || '@jumarket';
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN environment variable is required');
  process.exit(1);
}

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

// In-memory storage
const users = new Map();
const products = new Map();
const userStates = new Map();
const botSettings = new Map();
const activeChats = new Map(); // buyerId → { sellerId, productId, startTime, messages: [] }

let productIdCounter = 1;
let maintenanceMode = false;

// Initialize default settings
botSettings.set('welcome_message', `Welcome to Jimma University Marketplace!

Buy & Sell within JU Community
Books, Electronics, Clothes & more
Safe campus transactions
Join our channel: ${CHANNEL_ID}

Start by browsing items or selling yours!`);

botSettings.set('channel_link', CHANNEL_ID);

// --- Helper functions for bot username ---
function getBotUsername() {
  const u = botSettings.get('bot_username') || '';
  return u.startsWith('@') ? u : '@' + u;
}
function getBotUsernameForLink() {
  const u = botSettings.get('bot_username') || '';
  return u.startsWith('@') ? u.substring(1) : u;
}

// Fetch bot username on startup
bot.getMe().then(info => {
  const username = info.username ? `@${info.username}` : '';
  botSettings.set('bot_username', username);
  console.log('Bot username set:', username);
}).catch(err => console.error('Failed to get bot info:', err));

// Categories
const CATEGORIES = [
  'Academic Books',
  'Electronics', 
  'Clothes & Fashion',
  'Furniture & Home',
  'Study Materials',
  'Entertainment',
  'Food & Drinks',
  'Transportation',
  'Accessories',
  'Others'
];

// Utility functions
function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatUsernameForMarkdown(user) {
  if (!user) return 'No username';
  if (user.username) return '`@' + user.username + '`';
  return user.firstName || 'User';
}

// Maintenance mode handler
async function handleMaintenanceMode(chatId) {
  await bot.sendMessage(chatId,
    `*Maintenance Mode*\n\n` +
    `The marketplace is currently undergoing maintenance.\n\n` +
    `We're working to improve your experience and will be back soon!\n\n` +
    `Thank you for your patience!`,
    { parse_mode: 'Markdown' }
  );
}

// Main menu
async function showMainMenu(chatId) {
  const options = {
    reply_markup: {
      keyboard: [
        [{ text: 'Browse Products' }, { text: 'Sell Item' }],
        [{ text: 'My Products' }, { text: 'Contact Admin' }],
        [{ text: 'Help' }]
      ],
      resize_keyboard: true
    }
  };

  await bot.sendMessage(chatId, 
    `*Jimma University Marketplace*\n\n` +
    `Welcome to JU Student Marketplace!\n\n` +
    `Choose an option below:`,
    { parse_mode: 'Markdown', ...options }
  );
}

// Start command
async function handleStart(msg, startParam = null) {
  if (maintenanceMode && !ADMIN_IDS.includes(msg.from.id)) {
    await handleMaintenanceMode(msg.chat.id);
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Deep linking: sell
  if (startParam === 'sell') {
    await handleSell(msg);
    return;
  }

  // Deep linking: product
  if (startParam && startParam.startsWith('product_')) {
    const productId = parseInt(startParam.replace('product_', ''));
    await handleBuyNowDeepLink(chatId, productId);
    return;
  }

  // Register user
  if (!users.has(userId)) {
    users.set(userId, {
      telegramId: userId,
      username: msg.from.username || null,
      firstName: msg.from.first_name,
      lastName: msg.from.last_name || '',
      joinedAt: new Date(),
      department: '',
      year: ''
    });
  }

  const welcomeMessage = botSettings.get('welcome_message')
    .replace('{name}', msg.from.first_name)
    .replace('{channel}', botSettings.get('channel_link'));

  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  await showMainMenu(chatId);
}

// Buy Now deep link
async function handleBuyNowDeepLink(chatId, productId) {
  const product = products.get(productId);
  if (!product || product.status !== 'approved') {
    await bot.sendMessage(chatId, 'Product not found or no longer available.');
    return;
  }

  const seller = users.get(product.sellerId);
  const botUsername = getBotUsernameForLink();

  try {
    if (product.images && product.images.length > 0) {
      await bot.sendPhoto(chatId, product.images[0], {
        caption: `*PRODUCT DETAILS*\n\n` +
                 `*${product.title}*\n` +
                 `*Price:* ${product.price} ETB\n` +
                 `*Category:* ${product.category}\n` +
                 `Seller: ${formatUsernameForMarkdown(seller)}\n` +
                 `${product.description ? `*Description:* ${product.description}\n` : ''}\n` +
                 `*Campus Meetup Recommended*\n\n` +
                 `Contact the seller via bot:`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Contact Seller', callback_data: `contact_seller_${productId}` }],
            [{ text: 'Want to Sell?', url: `https://t.me/${botUsername}?start=sell` }],
            [{ text: 'Report Issue', callback_data: `report_${productId}` }]
          ]
        }
      });
    } else {
      await bot.sendMessage(chatId,
        `*PRODUCT DETAILS*\n\n` +
        `*${product.title}*\n` +
        `*Price:* ${product.price} ETB\n` +
        `*Category:* ${product.category}\n` +
        `Seller: ${formatUsernameForMarkdown(seller)}\n` +
        `${product.description ? `*Description:* ${product.description}\n` : ''}\n` +
        `*Campus Meetup Recommended*\n\n` +
        `Contact the seller via bot:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Contact Seller', callback_data: `contact_seller_${productId}` }],
              [{ text: 'Want to Sell?', url: `https://t.me/${botUsername}?start=sell` }],
              [{ text: 'Report Issue', callback_data: `report_${productId}` }]
            ]
          }
        }
      );
    }
  } catch (error) {
    await bot.sendMessage(chatId, 'Error loading product.');
  }
}

// Browse products
async function handleBrowse(msg) {
  if (maintenanceMode) {
    await handleMaintenanceMode(msg.chat.id);
    return;
  }

  const chatId = msg.chat.id;
  const botUsername = getBotUsernameForLink();

  const approvedProducts = Array.from(products.values())
    .filter(p => p.status === 'approved')
    .slice(0, 10);

  if (approvedProducts.length === 0) {
    await bot.sendMessage(chatId,
      `*Browse Products*\n\n` +
      `No products available yet.\n\n` +
      `Be the first to list an item!\n` +
      `Use "Sell Item" to get started.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await bot.sendMessage(chatId,
    `*Available Products (${approvedProducts.length})*\n\n` +
    `Latest items from JU students:`,
    { parse_mode: 'Markdown' }
  );

  for (const product of approvedProducts) {
    const seller = users.get(product.sellerId) || {};
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Contact Seller', callback_data: `contact_seller_${product.id}` }],
          [{ text: 'Want to Sell?', url: `https://t.me/${botUsername}?start=sell` }]
        ]
      }
    };

    try {
      if (product.images && product.images.length > 0) {
        await bot.sendPhoto(chatId, product.images[0], {
          caption: `*${product.title}*\n\n` +
                   `*Price:* ${product.price} ETB\n` +
                   `*Category:* ${product.category}\n` +
                   `Seller: ${formatUsernameForMarkdown(seller)}\n` +
                   `${product.description ? `*Description:* ${product.description}\n` : ''}` +
                   `\n*Campus Meetup*`,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else {
        await bot.sendMessage(chatId,
          `*${product.title}*\n\n` +
          `*Price:* ${product.price} ETB\n` +
          `*Category:* ${product.category}\n` +
          `Seller: ${formatUsernameForMarkdown(seller)}\n` +
          `${product.description ? `*Description:* ${product.description}\n` : ''}`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }
    } catch (error) {
      await bot.sendMessage(chatId, `Error loading product ${product.id}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }
}

// Sell item
async function handleSell(msg) {
  if (maintenanceMode) {
    await handleMaintenanceMode(msg.chat.id);
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  userStates.set(userId, {
    state: 'awaiting_product_image',
    productData: {}
  });

  await bot.sendMessage(chatId,
    `*Sell Your Item - Step 1/5*\n\n` +
    `*Send Product Photo*\n\n` +
    `Please send ONE photo of your item.`,
    { parse_mode: 'Markdown' }
  );
}

// Handle photo upload
async function handlePhoto(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userState = userStates.get(userId);

  if (userState && userState.state === 'awaiting_product_image') {
    const photo = msg.photo[msg.photo.length - 1];
    userState.productData.images = [photo.file_id];
    userState.state = 'awaiting_product_title';
    userStates.set(userId, userState);

    await bot.sendMessage(chatId,
      `Photo received!\n\n` +
      `*Step 2/5 - Product Title*\n\n` +
      `Enter a clear title:\n\n` +
      `Examples:\n` +
      `• "Calculus Textbook 3rd Edition"\n` +
      `• "iPhone 12 - 128GB - Like New"`,
      { parse_mode: 'Markdown' }
    );
  }
}

// My Products
async function handleMyProducts(msg) {
  if (maintenanceMode) {
    await handleMaintenanceMode(msg.chat.id);
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const userProducts = Array.from(products.values())
    .filter(p => p.sellerId === userId);

  if (userProducts.length === 0) {
    await bot.sendMessage(chatId,
      `*My Products*\n\n` +
      `You haven't listed any products yet.\n\n` +
      `Start selling with "Sell Item"!`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let message = `*Your Products (${userProducts.length})*\n\n`;
  userProducts.forEach((p, i) => {
    const status = p.status === 'approved' ? 'Approved' : p.status === 'pending' ? 'Pending' : 'Rejected';
    message += `${i + 1}. ${status} *${p.title}*\n`;
    message += `   ${p.price} ETB | ${p.category}\n\n`;
  });

  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

// Contact Admin
async function handleContact(msg) {
  const chatId = msg.chat.id;
  const contactKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Report Issue', callback_data: 'report_issue' }],
        [{ text: 'Suggestion', callback_data: 'give_suggestion' }],
        [{ text: 'Urgent Help', callback_data: 'urgent_help' }],
        [{ text: 'General Question', callback_data: 'general_question' }]
      ]
    }
  };

  await bot.sendMessage(chatId,
    `*Contact Administration*\n\n` +
    `How can we help you today?\n\n` +
    `Select your issue type:`,
    { parse_mode: 'Markdown', ...contactKeyboard }
  );
}

// Help
async function handleHelp(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isAdmin = ADMIN_IDS.includes(userId);

  let help = `*JU Marketplace Help*\n\n` +
    `*How to Buy:*\n` +
    `1. Click "Browse Products"\n` +
    `2. Click "Contact Seller"\n` +
    `3. Chat via bot\n` +
    `4. Arrange campus meetup\n\n` +
    `*How to Sell:*\n` +
    `1. Click "Sell Item"\n` +
    `2. Follow steps\n` +
    `3. Wait for approval\n` +
    `4. Posted in ${botSettings.get('channel_link')}\n\n` +
    `*Safety:*\n` +
    `• Meet in public\n` +
    `• Verify item\n` +
    `• Use cash\n` +
    `• Report issues\n\n` +
    `*Commands:*\n` +
    `/start /help /browse /sell /myproducts /contact`;

  if (isAdmin) {
    help += `\n\n*Admin Commands:*\n` +
      `/admin /pending /stats /users /allproducts /broadcast /messageuser /setwelcome /setchannel /maintenance /viewchat`;
  }

  await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
}

// Handle regular messages
async function handleRegularMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  const userState = userStates.get(userId);

  if (!userState) return;

  try {
    switch (userState.state) {
      case 'awaiting_product_title':
        if (!text?.trim()) {
          await bot.sendMessage(chatId, 'Please enter a title.');
          return;
        }
        userState.productData.title = text.trim();
        userState.state = 'awaiting_product_price';
        userStates.set(userId, userState);

        await bot.sendMessage(chatId,
          `Title: "${text.trim()}"\n\n` +
          `*Step 3/5 - Price*\n\n` +
          `Enter price in ETB (e.g., 1500):`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_product_price':
        const price = parseInt(text.replace(/[^\d]/g, ''));
        if (isNaN(price) || price <= 0) {
          await bot.sendMessage(chatId, 'Enter valid price (numbers only).');
          return;
        }
        userState.productData.price = price;
        userState.state = 'awaiting_product_description';
        userStates.set(userId, userState);

        await bot.sendMessage(chatId,
          `Price: ${price} ETB\n\n` +
          `*Step 4/5 - Description (optional)*\n\n` +
          `Type /skip to skip`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_product_description':
        userState.productData.description = text === '/skip' ? 'No description' : text;
        userState.state = 'awaiting_product_category';
        userStates.set(userId, userState);
        await selectProductCategory(chatId, userId, userState);
        break;
    }
  } catch (error) {
    await bot.sendMessage(chatId, 'Error. Start over with /sell');
    userStates.delete(userId);
  }
}

// Select category
async function selectProductCategory(chatId, userId, userState) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        ...CATEGORIES.map(c => [{ text: c, callback_data: `category_${c}` }]),
        [{ text: 'Cancel', callback_data: 'cancel_product' }]
      ]
    }
  };

  await bot.sendMessage(chatId,
    `*Select Category*\n\n` +
    `Choose the best category:`,
    { parse_mode: 'Markdown', ...keyboard }
  );
}

// Complete product
async function completeProductCreation(chatId, userId, userState, category, callbackQueryId = null) {
  const product = {
    id: productIdCounter++,
    sellerId: userId,
    title: userState.productData.title,
    description: userState.productData.description,
    price: userState.productData.price,
    category: category,
    images: userState.productData.images || [],
    status: 'pending',
    createdAt: new Date(),
    approvedBy: null
  };

  products.set(product.id, product);
  userStates.delete(userId);
  await notifyAdminsAboutNewProduct(product);

  if (callbackQueryId) {
    await bot.answerCallbackQuery(callbackQueryId, { text: 'Submitted!' });
  }

  await bot.sendMessage(chatId,
    `*Product Submitted!*\n\n` +
    `*${product.title}*\n` +
    `${product.price} ETB | ${product.category}\n\n` +
    `Waiting for admin approval.`,
    { parse_mode: 'Markdown' }
  );
  await showMainMenu(chatId);
}

// Notify admins
async function notifyAdminsAboutNewProduct(product) {
  const seller = users.get(product.sellerId);
  for (const adminId of ADMIN_IDS) {
    try {
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Approve', callback_data: `approve_${product.id}` }],
            [{ text: 'Reject', callback_data: `reject_${product.id}` }],
            [{ text: 'Message Seller', callback_data: `message_seller_${product.sellerId}` }]
          ]
        }
      };

      if (product.images?.length > 0) {
        await bot.sendPhoto(adminId, product.images[0], {
          caption: `*NEW PRODUCT*\n\n` +
                   `*Title:* ${product.title}\n` +
                   `*Price:* ${product.price}\n` +
                   `*Category:* ${product.category}\n` +
                   `Seller: ${formatUsernameForMarkdown(seller)}\n` +
                   `${product.description ? `*Desc:* ${product.description}\n` : ''}` +
                   `Submitted: ${product.createdAt.toLocaleString()}`,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else {
        await bot.sendMessage(adminId,
          `*NEW PRODUCT*\n\n` + 
          `*Title:* ${product.title}\n` +
          `*Price:* ${product.price}\n` +
          `*Category:* ${product.category}\n` +
          `Seller: ${formatUsernameForMarkdown(seller)}\n` +
          `${product.description ? `*Desc:* ${product.description}\n` : ''}`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }
    } catch (err) {
      console.error(`Notify admin ${adminId} failed:`, err.message);
    }
  }
}

// Callback query handler
async function handleCallbackQuery(callbackQuery) {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  try {
    // Category
    if (data.startsWith('category_')) {
      const category = data.replace('category_', '');
      const userState = userStates.get(userId);
      if (userState?.state === 'awaiting_product_category') {
        await completeProductCreation(chatId, userId, userState, category, callbackQuery.id);
      }
      return;
    }

    // Cancel
    if (data === 'cancel_product') {
      userStates.delete(userId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Cancelled' });
      await bot.sendMessage(chatId, 'Product creation cancelled.');
      return;
    }

    // Contact Seller
    if (data.startsWith('contact_seller_')) {
      const productId = parseInt(data.replace('contact_seller_', ''));
      const product = products.get(productId);
      if (!product || product.status !== 'approved') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Not available' });
        return;
      }

      const buyerId = userId;
      const sellerId = product.sellerId;

      if (buyerId === sellerId) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'You are the seller!' });
        return;
      }

      if (activeChats.has(buyerId) || activeChats.has(sellerId)) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Chat already open' });
        return;
      }

      activeChats.set(buyerId, { sellerId, productId, startTime: new Date(), messages: [] });
      activeChats.set(sellerId, { buyerId, productId, startTime: new Date(), messages: [] });

      const endBtn = { reply_markup: { inline_keyboard: [[{ text: 'End Chat', callback_data: 'end_chat' }]] } };

      await bot.sendMessage(buyerId, `Chat started with seller of *${product.title}*.\nType your message.`, { parse_mode: 'Markdown', ...endBtn });
      await bot.sendMessage(sellerId, `Buyer wants to talk about *${product.title}*.\nReply here.`, { parse_mode: 'Markdown', ...endBtn });

      // Notify admins
      for (const adminId of ADMIN_IDS) {
        try {
          await bot.sendMessage(adminId,
            `*NEW CHAT*\n*Item:* ${product.title}\n*Buyer:* \`${buyerId}\` | *Seller:* \`${sellerId}\``,
            {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: 'View Chat', callback_data: `admin_viewchat_${productId}` }]] }
            }
          );
        } catch (err) {}
      }

      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Chat opened!' });
      return;
    }

    // End Chat
    if (data === 'end_chat') {
      const partnerId = activeChats.get(userId)?.sellerId ?? activeChats.get(userId)?.buyerId;
      if (partnerId) {
        activeChats.delete(userId);
        activeChats.delete(partnerId);
        await bot.sendMessage(partnerId, 'Chat ended by the other party.');
      }
      await bot.editMessageReplyMarkup({}, { chat_id: chatId, message_id: message.message_id });
      await bot.sendMessage(chatId, 'Chat ended.');
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Closed' });
      return;
    }

    // Admin: View Chat
    if (data.startsWith('admin_viewchat_')) {
      if (!ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Admin only' });
        return;
      }
      const productId = parseInt(data.replace('admin_viewchat_', ''));
      const chat = Array.from(activeChats.values()).find(c => c.productId === productId);
      if (!chat || chat.messages.length === 0) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'No messages' });
        return;
      }
      const buyer = users.get(chat.sellerId ? chat.buyerId : userId);
      const seller = users.get(chat.sellerId || chat.buyerId);
      const product = products.get(chat.productId);
      let msg = `*Chat: "${product.title}"*\n\n` +
                `Buyer: ${buyer?.firstName} (\`${buyer?.telegramId}\`)\n` +
                `Seller: ${seller?.firstName} (\`${seller?.telegramId}\`)\n\n` +
                `*Messages:*\n`;
      chat.messages.forEach(m => {
        const sender = m.from === (chat.sellerId || chat.buyerId) ? 'Seller' : 'Buyer';
        msg += `\n[${new Date(m.time).toLocaleTimeString()}] *${sender}:* ${m.text}`;
      });
      await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    // Admin: View Chats List
    if (data === 'admin_view_chats') {
      if (!ADMIN_IDS.includes(userId)) return;
      await bot.sendMessage(chatId, 'Use /viewchat or /viewchat <id>');
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    // Report, etc.
    if (data.startsWith('report_')) {
      userStates.set(userId, { state: 'awaiting_report_reason', reportProductId: parseInt(data.replace('report_', '')) });
      await bot.sendMessage(chatId, `*Report Product*\n\nDescribe the issue:`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    if (['report_issue', 'give_suggestion', 'urgent_help', 'general_question'].includes(data)) {
      userStates.set(userId, { state: `awaiting_${data}` });
      await bot.sendMessage(chatId, `Please describe:`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    // Admin approval
    if (data.startsWith('approve_') || data.startsWith('reject_')) {
      const isApprove = data.startsWith('approve_');
      const productId = parseInt(data.replace(/^(approve|reject)_/, ''));
      await handleAdminApproval(productId, callbackQuery, isApprove);
      return;
    }

    if (data.startsWith('message_seller_')) {
      const sellerId = parseInt(data.replace('message_seller_', ''));
      if (!ADMIN_IDS.includes(userId)) return;
      userStates.set(userId, { state: 'awaiting_individual_message', targetUserId: sellerId });
      await bot.sendMessage(chatId, `Send message to seller ${sellerId}:`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

  } catch (error) {
    console.error('Callback error:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Error' });
  }
}

// Admin approval
async function handleAdminApproval(productId, callbackQuery, approve) {
  const adminId = callbackQuery.from.id;
  if (!ADMIN_IDS.includes(adminId)) return;

  const product = products.get(productId);
  if (!product) return;

  if (approve) {
    product.status = 'approved';
    product.approvedBy = adminId;

    const botUsername = getBotUsernameForLink();
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Contact Seller', callback_data: `contact_seller_${product.id}` }],
          [{ text: 'Want to Sell?', url: `https://t.me/${botUsername}?start=sell` }]
        ]
      }
    };

    try {
      if (product.images?.length > 0) {
        await bot.sendPhoto(CHANNEL_ID, product.images[0], {
          caption: `*${product.title}*\n\n` +
                   `*Price:* ${product.price} ETB\n` +
                   `*Category:* ${product.category}\n` +
                   `${product.description ? `*Description:* ${product.description}\n` : ''}` +
                   `\n*Jimma University Campus*\n` +
                   `\nContact via @${botUsername}`,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else {
        await bot.sendMessage(CHANNEL_ID,
          `*${product.title}*\n\n` +
          `*Price:* ${product.price} ETB\n` +
          `*Category:* ${product.category}\n` +
          `${product.description ? `*Description:* ${product.description}\n` : ''}` +
          `\nContact via @${botUsername}`,
          { parse_mode: 'Markdown', ...keyboard }
        );
      }

      await bot.sendMessage(product.sellerId, `Your product *${product.title}* is approved and live!`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Channel post failed:', err);
    }
  } else {
    product.status = 'rejected';
    await bot.sendMessage(product.sellerId, `Your product *${product.title}* was not approved. Try again with better details.`, { parse_mode: 'Markdown' });
  }

  await bot.answerCallbackQuery(callbackQuery.id, { text: approve ? 'Approved' : 'Rejected' });
}

// Chat relay
async function handleChatRelay(msg) {
  const userId = msg.from.id;
  const text = msg.text;
  const chatInfo = activeChats.get(userId);
  if (!chatInfo) return false;

  const partnerId = chatInfo.sellerId ?? chatInfo.buyerId;
  const product = products.get(chatInfo.productId);
  const prefix = userId === (chatInfo.sellerId ?? chatInfo.buyerId) ? 'Seller' : 'Buyer';
  const fwd = `${prefix}: ${text}\n\n*Item:* ${product.title}`;

  // Store message
  const entry = activeChats.get(userId);
  entry.messages.push({ from: userId, text, time: new Date() });
  activeChats.set(userId, entry);
  const partnerEntry = activeChats.get(partnerId);
  partnerEntry.messages.push({ from: userId, text, time: new Date() });
  activeChats.set(partnerId, partnerEntry);

  await bot.sendMessage(partnerId, fwd, { parse_mode: 'Markdown' });
  await bot.sendMessage(msg.chat.id, 'Message sent.', { parse_mode: 'Markdown' });
  return true;
}

// Admin commands
async function handleAdminCommand(msg, command, args) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    await bot.sendMessage(chatId, 'Admin access required.');
    return;
  }

  switch (command) {
    case 'admin':
      await showAdminPanel(chatId);
      break;
    case 'viewchat':
      const id = args[0] ? parseInt(args[0]) : null;
      if (!id) {
        const list = Array.from(activeChats.entries())
          .filter(([k, v]) => v.sellerId)
          .map(([b, v]) => `• ${b} ↔ ${v.sellerId} | ${products.get(v.productId)?.title}`);
        await bot.sendMessage(chatId, list.length ? list.join('\n') : 'No active chats');
        return;
      }
      // view specific
      const chat = Array.from(activeChats.values()).find(c => c.productId === id);
      if (!chat) {
        await bot.sendMessage(chatId, 'No chat found');
        return;
      }
      let msg = `*Chat ID ${id}*\n\n`;
      chat.messages.forEach(m => {
        const sender = m.from === (chat.sellerId || chat.buyerId) ? 'Seller' : 'Buyer';
        msg += `[${new Date(m.time).toLocaleTimeString()}] *${sender}:* ${m.text}\n`;
      });
      await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      break;
    case 'maintenance':
      const action = args[0];
      if (action === 'on') maintenanceMode = true;
      else if (action === 'off') maintenanceMode = false;
      await bot.sendMessage(chatId, `Maintenance: ${maintenanceMode ? 'ON' : 'OFF'}`);
      break;
    // ... other admin commands (stats, broadcast, etc.) can be added
  }
}

// Admin panel
async function showAdminPanel(chatId) {
  const keyboard = {
    reply_markup: {
      keyboard: [
        [{ text: 'Pending (0)' }, { text: 'Stats' }],
        [{ text: 'Message User' }, { text: 'Broadcast' }],
        [{ text: 'Users' }, { text: 'All Products' }],
        [{ text: 'Set Welcome' }, { text: 'Set Channel' }],
        [{ text: 'View Chats', callback_data: 'admin_view_chats' }],
        [{ text: 'Main Menu' }]
      ],
      resize_keyboard: true
    }
  };

  await bot.sendMessage(chatId,
    `*Admin Panel*\n\n` +
    `Users: ${users.size} | Products: ${products.size}\n` +
    `Status: ${maintenanceMode ? 'STOPPED' : 'RUNNING'}`,
    { parse_mode: 'Markdown', ...keyboard }
  );
}

// Main message handler
async function handleMessage(msg) {
  const text = msg.text;
  if (!text) return;

  // Chat relay first
  if (await handleChatRelay(msg)) return;

  if (text.startsWith('/')) {
    const [cmd, ...args] = text.slice(1).split(' ');
    const lower = cmd.toLowerCase();

    if (lower === 'start') {
      const param = args.join(' ');
      await handleStart(msg, param);
    } else if (['help', 'browse', 'sell', 'myproducts', 'contact'].includes(lower)) {
      const handler = {
        help: handleHelp,
        browse: handleBrowse,
        sell: handleSell,
        myproducts: handleMyProducts,
        contact: handleContact
      }[lower];
      if (handler) await handler(msg);
    } else if (ADMIN_IDS.includes(msg.from.id)) {
      await handleAdminCommand(msg, lower, args);
    } else {
      await handleRegularMessage(msg);
    }
  } else {
    // Keyboard buttons
    if (text === 'Browse Products') await handleBrowse(msg);
    else if (text === 'Sell Item') await handleSell(msg);
    else if (text === 'My Products') await handleMyProducts(msg);
    else if (text === 'Contact Admin') await handleContact(msg);
    else if (text === 'Help') await handleHelp(msg);
    else await handleRegularMessage(msg);
  }
}

// Vercel handler
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      message: 'JU Marketplace Bot Running',
      users: users.size,
      products: products.size,
      maintenance: maintenanceMode
    });
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;
      if (update.message) {
        if (update.message.photo) await handlePhoto(update.message);
        else if (update.message.text) await handleMessage(update.message);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      }
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Update error:', error);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('JU Marketplace Bot ready for Vercel!');
