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
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id,10)).filter(Boolean) : [];
const DEFAULT_BOT_USERNAME = process.env.BOT_USERNAME || 'Fyugguibfbot'; // fallback

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN environment variable is required');
}

// Initialize bot in webhook mode (no polling)
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

// In-memory storage (consider moving to a persistent DB for production)
const users = new Map();
const products = new Map();
const userStates = new Map();
const botSettings = new Map();
let productIdCounter = 1;
let maintenanceMode = false;

// In-memory chat sessions: userId -> { with, productId, role }
const chatSessions = new Map();

// Initialize default settings
botSettings.set('welcome_message', `🎓 Welcome to Jimma University Marketplace!

🏪 Buy & Sell within JU Community
📚 Books, Electronics, Clothes & more
🔒 Safe campus transactions
📢 Join our channel: ${CHANNEL_ID}

Start by browsing items or selling yours!`);

botSettings.set('channel_link', CHANNEL_ID);
botSettings.set('bot_username', `@${DEFAULT_BOT_USERNAME}`);

// Helper functions for bot username (persisted in botSettings)
function getBotUsername() {
  const u = botSettings.get('bot_username') || process.env.BOT_USERNAME || '';
  if (!u) return '';
  return u.startsWith('@') ? u : '@' + u;
}
function getBotUsernameForLink() {
  const u = botSettings.get('bot_username') || process.env.BOT_USERNAME || DEFAULT_BOT_USERNAME;
  return u.startsWith('@') ? u.substring(1) : u;
}
// Categories
const CATEGORIES = [
  '📚 Academic Books',
  '💻 Electronics', 
  '👕 Clothes & Fashion',
  '🏠 Furniture & Home',
  '📝 Study Materials',
  '🎮 Entertainment',
  '🍔 Food & Drinks',
  '🚗 Transportation',
  '🎒 Accessories',
  '❓ Others'
];

// Utility
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
  return user.firstName || 'Seller';
}

// --- Chat helpers ---
async function startChatBetweenUsers(buyerId, sellerId, productId) {
  if (buyerId === sellerId) {
    await bot.sendMessage(buyerId, '⚠️ You are the seller of this product.');
    return;
  }
  if (chatSessions.has(buyerId)) {
    await bot.sendMessage(buyerId, '⚠️ You already have an active chat. End it first.');
    return;
  }
  if (chatSessions.has(sellerId)) {
    await bot.sendMessage(buyerId, '⚠️ Seller is currently in another chat. Try later.');
    return;
  }
  chatSessions.set(buyerId, { with: sellerId, productId, role: 'buyer' });
  chatSessions.set(sellerId, { with: buyerId, productId, role: 'seller' });

  await bot.sendMessage(buyerId, '💬 Chat started with the seller! Type your message. Press the button to end chat.', {
    reply_markup: { inline_keyboard: [[{ text: '❌ End Chat', callback_data: 'end_chat' }]] }
  });

  try {
    await bot.sendMessage(sellerId, `💬 A buyer started a chat about your product (ID: ${productId}). You can reply here.`, {
      reply_markup: { inline_keyboard: [[{ text: '❌ End Chat', callback_data: 'end_chat' }]] }
    });
  } catch (err) {
    // Seller might not have started the bot - inform buyer and cleanup
    await bot.sendMessage(buyerId, '⚠️ Could not start chat because the seller has not started the bot or has blocked the bot.');
    chatSessions.delete(buyerId);
    chatSessions.delete(sellerId);
  }
}

async function endChat(userId) {
  const session = chatSessions.get(userId);
  if (!session) {
    await bot.sendMessage(userId, 'ℹ️ You have no active chat.');
    return;
  }
  const otherId = session.with;
  chatSessions.delete(userId);
  chatSessions.delete(otherId);
  try { await bot.sendMessage(userId, '✅ Chat ended.'); } catch(e) {}
  try { await bot.sendMessage(otherId, '✅ The other party ended the chat.'); } catch(e) {}
}
// --- end chat helpers ---

// Main menu
async function showMainMenu(chatId) {
  const options = {
    reply_markup: {
      keyboard: [
        [{ text: '🛍️ Browse Products' }, { text: '➕ Sell Item' }],
        [{ text: '📋 My Products' }, { text: '📞 Contact Admin' }],
        [{ text: 'ℹ️ Help' }]
      ],
      resize_keyboard: true
    }
  };
  await bot.sendMessage(chatId, `🏪 *Jimma University Marketplace*\n\nWelcome to JU Student Marketplace! 🎓\n\nChoose an option below:`, { parse_mode: 'Markdown', ...options });
}

// Start command (handles deep links like product_ and chat_)
async function handleStart(msg, startParam = null) {
  if (maintenanceMode && !ADMIN_IDS.includes(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, '🛠️ Under maintenance.');
    return;
  }
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Register user
  if (!users.has(userId)) {
    users.set(userId, {
      telegramId: userId,
      username: msg.from.username || null,
      firstName: msg.from.first_name || '',
      lastName: msg.from.last_name || '',
      joinedAt: new Date()
    });
  }

  if (startParam) {
    if (startParam.startsWith('product_')) {
      const productId = parseInt(startParam.replace('product_', ''), 10);
      await handleBuyNowDeepLink(chatId, productId);
      return;
    }
    if (startParam.startsWith('chat_')) {
      const productId = parseInt(startParam.replace('chat_', ''), 10);
      const product = products.get(productId);
      if (product && product.status === 'approved') {
        await startChatBetweenUsers(userId, product.sellerId, productId);
        return;
      } else {
        await bot.sendMessage(chatId, '❌ Product not available.');
        return;
      }
    }
  }

  const welcomeMessage = (botSettings.get('welcome_message') || '').replace('{name}', msg.from.first_name || '').replace('{user_count}', users.size.toString()).replace('{channel}', botSettings.get('channel_link'));
  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  await showMainMenu(chatId);
}

// Show product details in bot (deep link)
async function handleBuyNowDeepLink(chatId, productId) {
  const product = products.get(productId);
  if (!product || product.status !== 'approved') {
    await bot.sendMessage(chatId, '❌ Product not found or no longer available.');
    return;
  }
  const seller = users.get(product.sellerId) || {};
  try {
    if (product.images && product.images.length > 0) {
      await bot.sendPhoto(chatId, product.images[0], {
        caption: `🛒 *PRODUCT DETAILS*\n\n🏷️ *${product.title}*\n💰 *Price:* ${product.price} ETB\n📦 *Category:* ${product.category}\n${product.description ? `📝 *Description:* ${product.description}\n` : ''}\n📍 *Campus Meetup Recommended*`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Chat with Seller', callback_data: `chatwith_${product.sellerId}_${product.id}` }],
            [{ text: '🚨 Report Issue', callback_data: `report_${product.id}` }]
          ]
        }
      });
    } else {
      await bot.sendMessage(chatId, `🛒 *PRODUCT DETAILS*\n\n🏷️ *${product.title}*\n💰 *Price:* ${product.price} ETB\n📦 *Category:* ${product.category}\n${product.description ? `📝 *Description:* ${product.description}\n` : ''}\n📍 *Campus Meetup Recommended*`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Chat with Seller', callback_data: `chatwith_${product.sellerId}_${product.id}` }],
            [{ text: '🚨 Report Issue', callback_data: `report_${product.id}` }]
          ]
        }
      });
    }
  } catch (err) {
    console.error('Deep link show error:', err);
    await bot.sendMessage(chatId, '❌ Failed to show product details.');
  }
}

// Browse products (shows chat button)
async function handleBrowse(msg) {
  if (maintenanceMode) {
    await bot.sendMessage(msg.chat.id, '🛠️ Under maintenance.');
    return;
  }
  const chatId = msg.chat.id;
  const approvedProducts = Array.from(products.values()).filter(p => p.status === 'approved').slice(0, 10);
  if (approvedProducts.length === 0) {
    await bot.sendMessage(chatId, `🛍️ *Browse Products*\n\nNo products available yet.\n\nBe the first to list an item!`, { parse_mode: 'Markdown' });
    return;
  }
  await bot.sendMessage(chatId, `🛍️ *Available Products (${approvedProducts.length})*\n\nLatest items from JU students:`, { parse_mode: 'Markdown' });
  for (const product of approvedProducts) {
    try {
      if (product.images && product.images.length > 0) {
        await bot.sendPhoto(chatId, product.images[0], {
          caption: `🏷️ *${product.title}*\n\n💰 *Price:* ${product.price} ETB\n📦 *Category:* ${product.category}\n${product.description ? `📝 *Description:* ${product.description}\n` : ''}\n📍 *Campus Meetup*`,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '💬 Chat with Seller', callback_data: `chatwith_${product.sellerId}_${product.id}` }]] }
        });
      } else {
        await bot.sendMessage(chatId, `🏷️ *${product.title}*\n\n💰 *Price:* ${product.price} ETB\n📦 *Category:* ${product.category}\n${product.description ? `📝 *Description:* ${product.description}\n` : ''}`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '💬 Chat with Seller', callback_data: `chatwith_${product.sellerId}_${product.id}` }]] }
        });
      }
    } catch (err) {
      console.error('Browse item error:', err);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

// Sell item (starts flow)
async function handleSell(msg) {
  if (maintenanceMode) {
    await bot.sendMessage(msg.chat.id, '🛠️ Under maintenance.');
    return;
  }
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  userStates.set(userId, { state: 'awaiting_product_image', productData: {} });
  await bot.sendMessage(chatId, `🛍️ *Sell Your Item - Step 1/4*\n\n📸 *Send Product Photo*\n\nPlease send ONE photo of your item.`, { parse_mode: 'Markdown' });
}

// Handle photo upload during sell flow
async function handlePhoto(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userState = userStates.get(userId);
  if (userState && userState.state === 'awaiting_product_image') {
    const photo = msg.photo[msg.photo.length - 1];
    userState.productData.images = [photo.file_id];
    userState.state = 'awaiting_product_title';
    userStates.set(userId, userState);
    await bot.sendMessage(chatId, `✅ *Photo received!*\n\n🏷️ *Step 2/3 - Product Title*\n\nEnter a clear title for your item:`, { parse_mode: 'Markdown' });
  }
}

// Handle regular messages for product creation and other states
async function handleRegularMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  const userState = userStates.get(userId);
  if (!userState) return;
  try {
    switch (userState.state) {
      case 'awaiting_product_title':
        if (!text || text.trim() === '') {
          await bot.sendMessage(chatId, '❌ Please enter a product title.');
          return;
        }
        userState.productData.title = text.trim();
        userState.state = 'awaiting_product_price';
        userStates.set(userId, userState);
        await bot.sendMessage(chatId, `✅ Title set: "${text.trim()}"\n\n💰 *Step 3/3 - Product Price*\n\nEnter the price in ETB:`, { parse_mode: 'Markdown' });
        break;
      case 'awaiting_product_price':
        if (!text || text.trim() === '') {
          await bot.sendMessage(chatId, '❌ Please enter a price amount.');
          return;
        }
        const cleanText = text.trim().replace(/[^\d]/g, '');
        const price = parseInt(cleanText, 10);
        if (isNaN(price) || price <= 0) {
          await bot.sendMessage(chatId, '❌ Please enter a valid price (numbers only).');
          return;
        }
        if (price > 1000000) {
          await bot.sendMessage(chatId, '❌ Price seems too high. Please enter a reasonable amount.');
          return;
        }
        userState.productData.price = price;
        userState.state = 'awaiting_product_description';
        userStates.set(userId, userState);
        await bot.sendMessage(chatId, `✅ Price set: ${price} ETB\n\n📝 *Step 4/4 - Product Description*\n\nAdd a description (optional). Type /skip to skip.`, { parse_mode: 'Markdown' });
        break;
      case 'awaiting_product_description':
        if (text === '/skip') {
          userState.productData.description = 'No description provided';
        } else {
          userState.productData.description = text || 'No description provided';
        }
        // Skip username step - automatically use Telegram ID as seller
        userState.state = 'awaiting_product_category';
        userStates.set(userId, userState);
        await selectProductCategory(chatId, userId, userState);
        break;
      default:
        // other states ignored here
        break;
    }
  } catch (err) {
    console.error('Product creation error:', err);
    await bot.sendMessage(chatId, '❌ Sorry, there was an error. Please try /sell again.');
    userStates.delete(userId);
  }
}

// Select product category
async function selectProductCategory(chatId, userId, userState) {
  const categoryKeyboard = {
    reply_markup: {
      inline_keyboard: [
        ...CATEGORIES.map(category => ([{ text: category, callback_data: `category_${category}` }] )),
        [{ text: '🚫 Cancel', callback_data: 'cancel_product' }]
      ]
    }
  };
  userState.state = 'awaiting_product_category';
  userStates.set(userId, userState);
  await bot.sendMessage(chatId, `📂 *Select Category*\n\nChoose the category that best fits your item:`, { parse_mode: 'Markdown', reply_markup: categoryKeyboard.reply_markup });
}

// Complete product creation
async function completeProductCreation(chatId, userId, userState, category, callbackQueryId = null) {
  const product = {
    id: productIdCounter++,
    sellerId: userId,
    sellerUsername: null, // no username required
    title: userState.productData.title,
    description: userState.productData.description || '',
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
    try { await bot.answerCallbackQuery(callbackQueryId, { text: '✅ Product submitted for admin approval!' }); } catch(e){}
  }
  await bot.sendMessage(chatId, `✅ *Product Submitted Successfully!* \n\n🏷️ *${product.title}*\n💰 ${product.price} ETB | ${product.category}\n\n⏳ *Status:* Waiting for admin approval`, { parse_mode: 'Markdown' });
  await showMainMenu(chatId);
}

// Notify admins about new product
async function notifyAdminsAboutNewProduct(product) {
  const seller = users.get(product.sellerId) || {};
  for (const adminId of ADMIN_IDS) {
    const approveKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Approve', callback_data: `approve_${product.id}` }, { text: '❌ Reject', callback_data: `reject_${product.id}` }],
          [{ text: '📨 Message Seller', callback_data: `message_seller_${product.sellerId}` }]
        ]
      }
    };
    try {
      if (product.images && product.images.length > 0) {
        await bot.sendPhoto(adminId, product.images[0], {
          caption: `🆕 *NEW PRODUCT FOR APPROVAL*\n\n🏷️ *Title:* ${product.title}\n💰 *Price:* ${product.price}\n📂 *Category:* ${product.category}\n${product.description ? `📝 *Description:* ${product.description}\n` : ''}⏰ *Submitted:* ${product.createdAt.toLocaleString()}\n\n*Quick Actions Below ↓*`,
          parse_mode: 'Markdown',
          reply_markup: approveKeyboard.reply_markup
        });
      } else {
        await bot.sendMessage(adminId, `🆕 *NEW PRODUCT FOR APPROVAL*\n\n🏷️ *Title:* ${product.title}\n💰 *Price:* ${product.price}\n📂 *Category:* ${product.category}\n${product.description ? `📝 *Description:* ${product.description}\n` : ''}\n⏰ *Submitted:* ${product.createdAt.toLocaleString()}\n\n*Click buttons to approve/reject:*`, { parse_mode: 'Markdown', reply_markup: approveKeyboard.reply_markup });
      }
    } catch (err) {
      console.error('Notify admin error:', err);
    }
    await new Promise(r=>setTimeout(r,200));
  }
}

// Handle callback queries
async function handleCallbackQuery(callbackQuery) {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message ? message.chat.id : callbackQuery.from.id;
  try {
    // chatwith handler
    if (data && data.startsWith('chatwith_')) {
      const parts = data.split('_');
      const sellerId = parseInt(parts[1], 10);
      const productId = parseInt(parts[2], 10);
      await startChatBetweenUsers(userId, sellerId, productId);
      try { await bot.answerCallbackQuery(callbackQuery.id, { text: '💬 Chat request sent.' }); } catch(e){}
      return;
    }
    // category selection
    if (data && data.startsWith('category_')) {
      const category = data.replace('category_', '');
      const userState = userStates.get(userId);
      if (userState && userState.state === 'awaiting_product_category') {
        await completeProductCreation(chatId, userId, userState, category, callbackQuery.id);
      } else {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Session expired.' });
      }
      return;
    }
    if (data === 'cancel_product') {
      userStates.delete(userId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Product creation cancelled' });
      await bot.sendMessage(chatId, 'Product creation cancelled.');
      return;
    }
    if (data === 'end_chat') {
      await endChat(userId);
      try { await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Chat ended.' }); } catch(e){}
      return;
    }
    // admin approve/reject
    if (data && data.startsWith('approve_')) {
      const productId = parseInt(data.replace('approve_', ''), 10);
      await handleAdminApproval(productId, callbackQuery, true);
      return;
    }
    if (data && data.startsWith('reject_')) {
      const productId = parseInt(data.replace('reject_', ''), 10);
      await handleAdminApproval(productId, callbackQuery, false);
      return;
    }
    if (data && data.startsWith('message_seller_')) {
      const sellerId = parseInt(data.replace('message_seller_', ''), 10);
      if (!ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Admin access required' });
        return;
      }
      const seller = users.get(sellerId);
      if (!seller) { await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Seller not found' }); return; }
      userStates.set(userId, { state: 'awaiting_individual_message', targetUserId: sellerId });
      await bot.sendMessage(chatId, `📨 *Message Seller*\n\nSeller: ${seller.firstName}\nID: ${sellerId}\n\nPlease send your message:`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id, { text: `Messaging ${seller.firstName}` });
      return;
    }
    // reports and contact handlers
    if (data === 'report_issue') {
      userStates.set(userId, { state: 'awaiting_issue_report' });
      await bot.sendMessage(chatId, `📧 *Report an Issue*\n\nPlease describe the issue you're experiencing:`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id, { text: '📝 Please describe your issue' });
      return;
    }
    if (data === 'give_suggestion') {
      userStates.set(userId, { state: 'awaiting_suggestion' });
      await bot.sendMessage(chatId, `💡 *Share Your Suggestion*\n\nType your suggestion below:`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id, { text: '💡 We value your suggestions!' });
      return;
    }
    if (data === 'urgent_help') {
      userStates.set(userId, { state: 'awaiting_urgent_help' });
      await bot.sendMessage(chatId, `🚨 *Urgent Help Request*\n\nPlease describe your urgent issue:`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id, { text: '🚨 Urgent help requested' });
      return;
    }
    if (data === 'general_question') {
      userStates.set(userId, { state: 'awaiting_general_question' });
      await bot.sendMessage(chatId, `🤔 *General Question*\n\nAsk your question below:`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(callbackQuery.id, { text: '❓ Ask your question' });
      return;
    }
  } catch (err) {
    console.error('Callback error:', err);
    try { await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Error processing request' }); } catch(e){}
  }
}

// Admin approval handler
async function handleAdminApproval(productId, callbackQuery, approve) {
  const adminId = callbackQuery.from.id;
  const message = callbackQuery.message;
  const chatId = message ? message.chat.id : adminId;
  const product = products.get(productId);
  if (!ADMIN_IDS.includes(adminId)) { await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Admin access required' }); return; }
  if (!product) { await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Product not found' }); return; }
  if (approve) {
    product.status = 'approved'; product.approvedBy = adminId;
    try {
      const buyUrl = `https://t.me/${getBotUsernameForLink()}?start=chat_${product.id}`;
      const channelKeyboard = { reply_markup: { inline_keyboard: [[{ text: '💬 Chat with Seller', url: buyUrl }]] } };
      if (product.images && product.images.length > 0) {
        await bot.sendPhoto(CHANNEL_ID, product.images[0], {
          caption: `🏷️ *${product.title}*\n\n💰 *Price:* ${product.price} ETB\n📦 *Category:* ${product.category}\n${product.description ? `\n📝 *Description:* ${product.description}\n` : ''}\n📍 *Jimma University Campus*\n\n💬 Chat via @${getBotUsernameForLink()}`,
          parse_mode: 'Markdown',
          reply_markup: channelKeyboard.reply_markup
        });
      } else {
        await bot.sendMessage(CHANNEL_ID, `🏷️ *${product.title}*\n\n💰 *Price:* ${product.price} ETB\n📦 *Category:* ${product.category}\n${product.description ? `\n📝 *Description:* ${product.description}\n` : ''}\n📍 *Jimma University Campus*\n\n💬 Chat via @${getBotUsernameForLink()}`, { parse_mode: 'Markdown', reply_markup: channelKeyboard.reply_markup });
      }
      try { await bot.sendMessage(product.sellerId, `✅ *Your Product Has Been Approved!* - ${product.title}`, { parse_mode: 'Markdown' }); } catch(e){ console.error('Notify seller error', e); }
      await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Product approved and posted to channel!' });
      // update admin message
      try { await bot.editMessageText(`✅ *PRODUCT APPROVED*\n\n🏷️ *${product.title}*\n💰 ${product.price} ETB | ${product.category}\n👤 Approved by admin\n⏰ ${new Date().toLocaleString()}`, { chat_id: chatId, message_id: message.message_id, parse_mode: 'Markdown' }); } catch(e) {}
    } catch (err) {
      console.error('Channel post error:', err);
      await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Failed to post to channel' });
    }
  } else {
    product.status = 'rejected'; product.approvedBy = adminId;
    try { await bot.sendMessage(product.sellerId, `❌ *Product Not Approved* - ${product.title}`, { parse_mode: 'Markdown' }); } catch(e){}
    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Product rejected' });
    try { await bot.editMessageText(`❌ *PRODUCT REJECTED*\n\n🏷️ *${product.title}*\n💰 ${product.price} ETB | ${product.category}\n👤 Rejected by admin\n⏰ ${new Date().toLocaleString()}`, { chat_id: chatId, message_id: message.message_id, parse_mode: 'Markdown' }); } catch(e) {}
  }
}

// Contact and other message handling
async function handleContactMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  const userState = userStates.get(userId);
  const user = users.get(userId);
  const contactStates = new Set(['awaiting_report_reason','awaiting_issue_report','awaiting_suggestion','awaiting_urgent_help','awaiting_general_question','awaiting_individual_message']);
  if (!userState || !contactStates.has(userState.state)) return;
  try {
    const userName = user ? user.firstName : 'User';
    const userUsername = user && user.username ? formatUsernameForMarkdown(user) : 'No username';
    let adminMessage = ''; let userConfirmation = ''; let messageType = '';
    switch (userState.state) {
      case 'awaiting_report_reason':
        const productId = userState.reportProductId; const product = products.get(productId);
        messageType = 'PRODUCT REPORT';
        adminMessage = `🚨 *${messageType}*\n\n*From:* ${userName} (${userUsername})\n*User ID:* ${userId}\n*Product:* ${product.title}\n*Product ID:* ${productId}\n\n*Report:* ${text}\n\n_Time: ${new Date().toLocaleString()}_`;
        userConfirmation = `✅ *Issue Reported Successfully!*`;
        break;
      case 'awaiting_issue_report':
        messageType = 'ISSUE REPORT';
        adminMessage = `🚨 *${messageType}*\n\n*From:* ${userName} (${userUsername})\n*User ID:* ${userId}\n\n*Report:* ${text}\n\n_Time: ${new Date().toLocaleString()}_`;
        userConfirmation = `✅ *Issue Reported Successfully!*`;
        break;
      case 'awaiting_suggestion':
        messageType = 'SUGGESTION';
        adminMessage = `💡 *${messageType}*\n\n*From:* ${userName} (${userUsername})\n*User ID:* ${userId}\n\n*Suggestion:* ${text}\n\n_Time: ${new Date().toLocaleString()}_`;
        userConfirmation = `✅ *Suggestion Received!*`;
        break;
      case 'awaiting_urgent_help':
        messageType = 'URGENT HELP';
        adminMessage = `🚨 *${messageType} - IMMEDIATE ATTENTION NEEDED!*\n\n*From:* ${userName} (${userUsername})\n*User ID:* ${userId}\n\n*Urgent Issue:* ${text}\n\n_Time: ${new Date().toLocaleString()}_`;
        userConfirmation = `🚨 *Urgent Help Request Submitted!*`;
        break;
      case 'awaiting_general_question':
        messageType = 'QUESTION';
        adminMessage = `❓ *${messageType}*\n\n*From:* ${userName} (${userUsername})\n*User ID:* ${userId}\n\n*Question:* ${text}\n\n_Time: ${new Date().toLocaleString()}_`;
        userConfirmation = `✅ *Question Submitted!*`;
        break;
      case 'awaiting_individual_message':
        const targetUserId = userState.targetUserId; const targetUser = users.get(targetUserId);
        if (!targetUser) { await bot.sendMessage(chatId, '❌ User not found.'); userStates.delete(userId); return; }
        try {
          await bot.sendMessage(targetUserId, `📨 *Message from Admin*\n\n${text}`, { parse_mode: 'Markdown' });
          await bot.sendMessage(chatId, `✅ *Message Sent!* To: ${targetUser.firstName}`, { parse_mode: 'Markdown' });
        } catch (err) {
          await bot.sendMessage(chatId, `❌ Failed to send message. ${err.message}`);
        }
        userStates.delete(userId); return;
    }
    // Notify admins
    for (const adminId of ADMIN_IDS) {
      try { await bot.sendMessage(adminId, adminMessage, { parse_mode: 'Markdown' }); } catch(e){}
    }
    await bot.sendMessage(chatId, userConfirmation, { parse_mode: 'Markdown' });
    userStates.delete(userId);
    await showMainMenu(chatId);
  } catch (err) {
    console.error('Contact handling error:', err);
    await bot.sendMessage(chatId, '❌ Error submitting your message.');
  }
}

// Admin commands and helpers (abbreviated for brevity - kept from previous file)
async function handleAdminCommand(msg, command, args = []) {
  const chatId = msg.chat.id; const userId = msg.from.id;
  if (!ADMIN_IDS.includes(userId)) { await bot.sendMessage(chatId, '❌ Admin access required.'); return; }
  try {
    switch (command) {
      case 'admin': await showAdminPanel(chatId); break;
      case 'pending': await showPendingApprovals(chatId); break;
      case 'stats': await showAdminStats(chatId); break;
      case 'users': await showAllUsers(chatId); break;
      case 'allproducts': await showAllProducts(chatId); break;
      case 'broadcast': userStates.set(userId, { state: 'awaiting_broadcast_message' }); await bot.sendMessage(chatId, '📢 Send broadcast message now.'); break;
      case 'messageuser': userStates.set(userId, { state: 'awaiting_user_id_for_message' }); await bot.sendMessage(chatId, '📨 Send user id now.'); break;
      case 'setwelcome': const welcomeText = args.join(' '); if (!welcomeText) { await bot.sendMessage(chatId, `Current welcome: ${botSettings.get('welcome_message')}`); return; } botSettings.set('welcome_message', welcomeText); await bot.sendMessage(chatId, '✅ Welcome updated'); break;
      case 'setchannel': const channelLink = args[0]; if (!channelLink) { await bot.sendMessage(chatId, `Current channel: ${botSettings.get('channel_link')}`); return; } botSettings.set('channel_link', channelLink); await bot.sendMessage(chatId, `✅ Channel updated to ${channelLink}`); break;
      case 'maintenance': const action = args[0]; if (action === 'on') { maintenanceMode = true; await bot.sendMessage(chatId, '🔴 Maintenance on'); } else if (action === 'off') { maintenanceMode = false; await bot.sendMessage(chatId, '🟢 Maintenance off'); } else { await bot.sendMessage(chatId, `Maintenance: ${maintenanceMode}`); } break;
      default: await bot.sendMessage(chatId, '❌ Unknown admin command.'); break;
    }
  } catch (err) { console.error('Admin cmd error', err); await bot.sendMessage(chatId, '❌ Error processing admin command.'); }
}

// Various admin view functions (kept concise)
async function showAdminPanel(chatId) {
  const pendingCount = Array.from(products.values()).filter(p => p.status === 'pending').length;
  const adminKeyboard = { reply_markup: { keyboard: [[{ text: `⏳ Pending (${pendingCount})` }, { text: '📊 Stats' }],[{ text: '📨 Message User' }, { text: '📢 Broadcast' }],[{ text: '👥 Users' }, { text: '🛍️ All Products' }],[{ text: '✏️ Set Welcome' }, { text: '📢 Set Channel' }],[{ text: `${maintenanceMode ? '🟢 Start Bot' : '🔴 Stop Bot'}` }],[{ text: '🏪 Main Menu' }]], resize_keyboard: true } };
  await bot.sendMessage(chatId, `⚡ *Admin Panel*\n\nUsers: ${users.size}\nProducts: ${products.size}\nPending: ${pendingCount}`, { parse_mode: 'Markdown', ...adminKeyboard });
}
async function showPendingApprovals(chatId) {
  const pendingProducts = Array.from(products.values()).filter(p => p.status === 'pending');
  if (pendingProducts.length === 0) { await bot.sendMessage(chatId, '✅ No products pending approval.'); return; }
  for (const product of pendingProducts) {
    const approveKeyboard = { reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve_${product.id}` }, { text: '❌ Reject', callback_data: `reject_${product.id}` }],[{ text: '📨 Message Seller', callback_data: `message_seller_${product.sellerId}` }]] } };
    try {
      if (product.images && product.images.length > 0) { await bot.sendPhoto(chatId, product.images[0], { caption: `⏳ Pending: ${product.title}\nPrice: ${product.price}`, parse_mode: 'Markdown', reply_markup: approveKeyboard.reply_markup }); } else { await bot.sendMessage(chatId, `⏳ Pending: ${product.title}\nPrice: ${product.price}`, { parse_mode: 'Markdown', reply_markup: approveKeyboard.reply_markup }); }
    } catch(e){}
    await new Promise(r=>setTimeout(r,150));
  }
}
async function showAdminStats(chatId) {
  const totalProducts = products.size; const approvedProducts = Array.from(products.values()).filter(p=>p.status==='approved').length; const pendingProducts = Array.from(products.values()).filter(p=>p.status==='pending').length; const totalUsers = users.size;
  await bot.sendMessage(chatId, `📊 Users: ${totalUsers}\nProducts: ${totalProducts}\nApproved: ${approvedProducts}\nPending: ${pendingProducts}`, { parse_mode: 'Markdown' });
}
async function showAllUsers(chatId) {
  const userList = Array.from(users.values()); if (userList.length===0) { await bot.sendMessage(chatId, 'No users'); return; }
  let msg = `👥 Users (${userList.length})\n\n`; userList.slice(0,20).forEach((u,i)=>{ msg += `${i+1}. ${u.firstName} - ${u.telegramId}\n`; }); await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}
async function showAllProducts(chatId) {
  const all = Array.from(products.values()); if (all.length===0) { await bot.sendMessage(chatId, 'No products'); return; }
  let msg = `🛍️ All Products (${all.length})\n\n`; all.forEach((p,i)=>{ msg += `${i+1}. ${p.title} | ${p.price} ETB | ${p.status}\n`; }); await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

// Handle broadcast confirmation and other admin flows (kept minimal)
async function handleBroadcastMessage(msg) {
  const userId = msg.from.id; const userState = userStates.get(userId);
  if (userState && userState.state==='awaiting_broadcast_message') {
    const text = msg.text;
    for (const u of users.keys()) {
      try { await bot.sendMessage(u, text); } catch(e) {}
    }
    await bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${users.size} users.`);
    userStates.delete(userId);
  }
}

// Handle user id for messaging (admin)
async function handleUserIdForMessage(msg) {
  const userId = msg.from.id; const userState = userStates.get(userId);
  if (userState && userState.state === 'awaiting_user_id_for_message') {
    const id = parseInt(msg.text, 10); if (isNaN(id)) { await bot.sendMessage(msg.chat.id, '❌ Invalid ID'); return; }
    userStates.set(userId, { state: 'awaiting_individual_message', targetUserId: id }); await bot.sendMessage(msg.chat.id, `Now send the message to user ${id}`);
  }
}

// Cancel
async function handleCancel(msg) {
  const chatId = msg.chat.id; const userId = msg.from.id; if (userStates.has(userId)) { userStates.delete(userId); await bot.sendMessage(chatId, '❌ Action cancelled.'); await showMainMenu(chatId); } else { await bot.sendMessage(chatId, 'ℹ️ No active action.'); await showMainMenu(chatId); }
}

// Main message handler
async function handleMessage(msg) {
  // If user is in active chat, forward messages to counterpart
  try {
    const uid = msg.from.id;
    if (chatSessions.has(uid)) {
      const session = chatSessions.get(uid);
      const targetId = session.with;
      if (msg.text) await bot.sendMessage(targetId, `💬 ${session.role === 'buyer' ? 'Buyer' : 'Seller'}: ${msg.text}`);
      if (msg.photo) { const photo = msg.photo[msg.photo.length - 1]; await bot.sendPhoto(targetId, photo.file_id, { caption: `📷 ${session.role === 'buyer' ? 'Buyer' : 'Seller'} sent a photo.` }); }
      return;
    }
  } catch (fwdErr) { console.error('Forward error', fwdErr); }

  const text = msg.text;
  if (!text && !msg.photo) return;

  // Commands and keyboard actions
  if (text && text.startsWith('/')) {
    const [command, ...args] = text.slice(1).split(' ');
    switch (command.toLowerCase()) {
      case 'start': const startParam = args[0]; await handleStart(msg, startParam); break;
      case 'help': await handleHelp(msg); break;
      case 'browse': await handleBrowse(msg); break;
      case 'sell': await handleSell(msg); break;
      case 'myproducts': await handleMyProducts(msg); break;
      case 'contact': await handleContact(msg); break;
      case 'status': await handleStatus(msg); break;
      case 'cancel': await handleCancel(msg); break;
      case 'admin': case 'pending': case 'stats': case 'users': case 'allproducts': case 'broadcast': case 'messageuser': case 'setwelcome': case 'setchannel': case 'maintenance': await handleAdminCommand(msg, command.toLowerCase(), args); break;
      default: await handleRegularMessage(msg);
    }
    return;
  }

  // Photo during sell flow
  if (msg.photo) {
    await handlePhoto(msg);
    return;
  }

  // Keyboard button text handlers
  if (text === '🛍️ Browse Products') { await handleBrowse(msg); return; }
  if (text === '➕ Sell Item') { await handleSell(msg); return; }
  if (text === '📋 My Products') { await handleMyProducts(msg); return; }
  if (text === '📞 Contact Admin') { await handleContact(msg); return; }
  if (text === 'ℹ️ Help') { await handleHelp(msg); return; }

  // State-driven messages (product creation, contact, admin flows)
  const state = userStates.get(msg.from.id)?.state;
  if (state && state.startsWith('awaiting_product')) { await handleRegularMessage(msg); return; }
  if (state && state.startsWith('awaiting_')) { await handleContactMessage(msg); return; }
  if (state && state === 'awaiting_user_id_for_message') { await handleUserIdForMessage(msg); return; }
  if (state && state === 'awaiting_broadcast_message') { await handleBroadcastMessage(msg); return; }

  // Default fallback
  await bot.sendMessage(msg.chat.id, 'ℹ️ I did not understand that. Use /help.');
}

// Help
async function handleHelp(msg) {
  const chatId = msg.chat.id; const isAdmin = ADMIN_IDS.includes(msg.from.id);
  let helpMessage = `ℹ️ *Help*\n\nHow to buy: Click Browse → Chat with Seller\nHow to sell: /sell\n`;
  if (isAdmin) helpMessage += `\nAdmin commands available.`;
  await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
}

// My products
async function handleMyProducts(msg) {
  const chatId = msg.chat.id; const userId = msg.from.id;
  const list = Array.from(products.values()).filter(p=>p.sellerId===userId);
  if (list.length===0) { await bot.sendMessage(chatId, '📋 You have no products.'); return; }
  let m = `📋 Your Products (${list.length})\n\n`; list.forEach((p,i)=>{ m += `${i+1}. ${p.title} | ${p.price} ETB | ${p.status}\n`; });
  await bot.sendMessage(chatId, m, { parse_mode: 'Markdown' });
}

// Status
async function handleStatus(msg) {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `👥 Users: ${users.size}\n🛍️ Products: ${products.size}`, { parse_mode: 'Markdown' });
}

// Vercel handler (webhook endpoint)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'online', timestamp: new Date().toISOString(), users: users.size, products: products.size });
  if (req.method === 'POST') {
    try {
      const update = req.body;
      if (update.message) {
        if (update.message.photo) {
          await handlePhoto(update.message);
        } else if (update.message.text) {
          await handleMessage(update.message);
        }
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Processing error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ JU Marketplace Bot (chat-enabled) configured for Vercel!');
