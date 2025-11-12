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
}

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN);

// In-memory storage
const users = new Map();
const products = new Map();
const userStates = new Map();
const botSettings = new Map();
let productIdCounter = 1;
let maintenanceMode = false;

// Initialize default settings
botSettings.set('welcome_message', `🎓 Welcome to Jimma University Marketplace!

🏪 Buy & Sell within JU Community
📚 Books, Electronics, Clothes & more
🔒 Safe campus transactions
📢 Join our channel: ${CHANNEL_ID}

Start by browsing items or selling yours!`);

botSettings.set('channel_link', CHANNEL_ID);

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

// Maintenance mode handler
async function handleMaintenanceMode(chatId) {
  await bot.sendMessage(chatId,
    `🛠️ *Maintenance Mode*\n\n` +
    `The marketplace is currently undergoing maintenance.\n\n` +
    `We're working to improve your experience and will be back soon!\n\n` +
    `Thank you for your patience! 🎓`,
    { parse_mode: 'Markdown' }
  );
}

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
  
  await bot.sendMessage(chatId, 
    `🏪 *Jimma University Marketplace*\n\n` +
    `Welcome to JU Student Marketplace! 🎓\n\n` +
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
  
  // Handle deep linking for Buy Now
  if (startParam && startParam.startsWith('product_')) {
    const productId = parseInt(startParam.replace('product_', ''));
    await handleBuyNowDeepLink(chatId, productId);
    return;
  }
  
  // Register user
  if (!users.has(userId)) {
    users.set(userId, {
      telegramId: userId,
      username: msg.from.username || '',
      firstName: msg.from.first_name,
      lastName: msg.from.last_name || '',
      joinedAt: new Date(),
      department: '',
      year: ''
    });
  }
  
  const welcomeMessage = botSettings.get('welcome_message')
    .replace('{name}', msg.from.first_name)
    .replace('{username}', msg.from.username || '')
    .replace('{user_count}', users.size.toString())
    .replace('{channel}', botSettings.get('channel_link'));
  
  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  
  await showMainMenu(chatId);
}

// Buy Now deep link handler
async function handleBuyNowDeepLink(chatId, productId) {
  const product = products.get(productId);
  if (!product || product.status !== 'approved') {
    await bot.sendMessage(chatId, '❌ Product not found or no longer available.');
    return;
  }

  const seller = users.get(product.sellerId);
  const sellerUsername = seller?.username ? `@${seller.username}` : 'No username available';

  try {
    if (product.images && product.images.length > 0) {
      await bot.sendPhoto(chatId, product.images[0], {
        caption: `🛒 *PRODUCT DETAILS*\n\n` +
                 `🏷️ *${product.title}*\n` +
                 `💰 *Price:* ${product.price} ETB\n` +
                 `📦 *Category:* ${product.category}\n` +
                 `👤 *Seller:* ${sellerUsername}\n` +
                 `${product.description ? `📝 *Description:* ${product.description}\n` : ''}\n` +
                 `📍 *Campus Meetup Recommended*\n\n` +
                 `💬 *Contact the seller directly to purchase!*`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚨 Report Issue', callback_data: `report_${productId}` }]
          ]
        }
      });
    } else {
      await bot.sendMessage(chatId,
        `🛒 *PRODUCT DETAILS*\n\n` +
        `🏷️ *${product.title}*\n` +
        `💰 *Price:* ${product.price} ETB\n` +
        `📦 *Category:* ${product.category}\n` +
        `👤 *Seller:* ${sellerUsername}\n` +
        `${product.description ? `📝 *Description:* ${product.description}\n` : ''}\n` +
        `📍 *Campus Meetup Recommended*\n\n` +
        `💬 *Contact the seller directly to purchase!*`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚨 Report Issue', callback_data: `report_${productId}` }]
            ]
          }
        }
      );
    }
  } catch (error) {
    await bot.sendMessage(chatId,
      `🛒 *PRODUCT DETAILS*\n\n` +
      `🏷️ *${product.title}*\n` +
      `💰 *Price:* ${product.price} ETB\n` +
      `📦 *Category:* ${product.category}\n` +
      `👤 *Seller:* ${sellerUsername}\n` +
      `${product.description ? `📝 *Description:* ${product.description}\n` : ''}\n` +
      `📍 *Campus Meetup Recommended*\n\n` +
      `💬 *Contact the seller directly to purchase!*`,
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚨 Report Issue', callback_data: `report_${productId}` }]
          ]
        }
      }
    );
  }
}

// Browse products
async function handleBrowse(msg) {
  if (maintenanceMode) {
    await handleMaintenanceMode(msg.chat.id);
    return;
  }

  const chatId = msg.chat.id;
  
  const approvedProducts = Array.from(products.values())
    .filter(product => product.status === 'approved')
    .slice(0, 10);

  if (approvedProducts.length === 0) {
    await bot.sendMessage(chatId,
      `🛍️ *Browse Products*\n\n` +
      `No products available yet.\n\n` +
      `Be the first to list an item! 💫\n` +
      `Use "➕ Sell Item" to get started.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  await bot.sendMessage(chatId,
    `🛍️ *Available Products (${approvedProducts.length})*\n\n` +
    `Latest items from JU students:`,
    { parse_mode: 'Markdown' }
  );
  
  for (const product of approvedProducts) {
    const seller = users.get(product.sellerId);
    
    const buyNowUrl = `https://t.me/${bot.options.username}?start=product_${product.id}`;
    
    const browseKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛒 Buy Now', url: buyNowUrl }]
        ]
      }
    };
    
    try {
      if (product.images && product.images.length > 0) {
        await bot.sendPhoto(chatId, product.images[0], {
          caption: `🏷️ *${product.title}*\n\n` +
                   `💰 *Price:* ${product.price} ETB\n` +
                   `📦 *Category:* ${product.category}\n` +
                   `👤 *Seller:* ${seller?.firstName || 'JU Student'}\n` +
                   `${product.description ? `📝 *Description:* ${product.description}\n` : ''}` +
                   `\n📍 *Campus Meetup*`,
          parse_mode: 'Markdown',
          reply_markup: browseKeyboard.reply_markup
        });
      } else {
        await bot.sendMessage(chatId,
          `🏷️ *${product.title}*\n\n` +
          `💰 *Price:* ${product.price} ETB\n` +
          `📦 *Category:* ${product.category}\n` +
          `👤 *Seller:* ${seller?.firstName || 'JU Student'}\n` +
          `${product.description ? `📝 *Description:* ${product.description}\n` : ''}`,
          { parse_mode: 'Markdown', reply_markup: browseKeyboard.reply_markup }
        );
      }
    } catch (error) {
      await bot.sendMessage(chatId,
        `🏷️ *${product.title}*\n\n` +
        `💰 *Price:* ${product.price} ETB\n` +
        `📦 *Category:* ${product.category}\n` +
        `👤 *Seller:* ${seller?.firstName || 'JU Student'}\n` +
        `${product.description ? `📝 *Description:* ${product.description}\n` : ''}`,
        { parse_mode: 'Markdown', reply_markup: browseKeyboard.reply_markup }
      );
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
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
    `🛍️ *Sell Your Item - Step 1/4*\n\n` +
    `📸 *Send Product Photo*\n\n` +
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
      `✅ *Photo received!*\n\n` +
      `🏷️ *Step 2/4 - Product Title*\n\n` +
      `Enter a clear title for your item:\n\n` +
      `Examples:\n` +
      `• "Calculus Textbook 3rd Edition"\n` +
      `• "iPhone 12 - 128GB - Like New"\n` +
      `• "Engineering Calculator FX-991ES"`,
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
    .filter(product => product.sellerId === userId);
  
  if (userProducts.length === 0) {
    await bot.sendMessage(chatId,
      `📋 *My Products*\n\n` +
      `You haven't listed any products yet.\n\n` +
      `Start selling with "➕ Sell Item"! 💫`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  let message = `📋 *Your Products (${userProducts.length})*\n\n`;
  
  userProducts.forEach((product, index) => {
    const statusIcon = 
      product.status === 'approved' ? '✅' :
      product.status === 'pending' ? '⏳' :
      product.status === 'rejected' ? '❌' : '❓';
    
    message += `${index + 1}. ${statusIcon} *${product.title}*\n`;
    message += `   💰 ${product.price} ETB | ${product.category}\n`;
    message += `   🏷️ ${product.status.charAt(0).toUpperCase() + product.status.slice(1)}\n\n`;
  });
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

// Contact Admin
async function handleContact(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const user = users.get(userId);
  const userName = user ? user.firstName : 'User';
  
  const contactKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📧 Report Issue', callback_data: 'report_issue' },
          { text: '💡 Suggestion', callback_data: 'give_suggestion' }
        ],
        [
          { text: '🚨 Urgent Help', callback_data: 'urgent_help' },
          { text: '🤔 General Question', callback_data: 'general_question' }
        ]
      ]
    }
  };
  
  await bot.sendMessage(chatId,
    `📞 *Contact Administration*\n\n` +
    `Hello ${userName}! 👋\n\n` +
    `*How can we help you today?*\n\n` +
    `Select your issue type below:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: contactKeyboard.reply_markup 
    }
  );
}

// Help command
async function handleHelp(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const isAdmin = ADMIN_IDS.includes(userId);
  
  let helpMessage = `ℹ️ *Jimma University Marketplace Help*\n\n` +
    `*How to Buy:*\n` +
    `1. Click "🛍️ Browse Products"\n` +
    `2. View available items\n` +
    `3. Click "🛒 Buy Now"\n` +
    `4. Contact seller directly\n` +
    `5. Arrange campus meetup\n\n` +
    `*How to Sell:*\n` +
    `1. Click "➕ Sell Item"\n` +
    `2. Send product photo\n` +
    `3. Add title, price, and description\n` +
    `4. Select category\n` +
    `5. Wait for admin approval\n` +
    `6. Item appears in ${botSettings.get('channel_link')}\n\n` +
    `*Safety Guidelines:*\n` +
    `• Meet in public campus areas\n` +
    `• Verify items before payment\n` +
    `• Use cash transactions\n` +
    `• Report suspicious activity\n\n` +
    `*User Commands:*\n` +
    `/start - Start the bot\n` +
    `/help - Show this help\n` +
    `/browse - Browse products\n` +
    `/sell - List a new product\n` +
    `/myproducts - View your products\n` +
    `/status - Check statistics\n` +
    `/contact - Contact administration\n`;
  
  if (isAdmin) {
    helpMessage += `\n*⚡ Admin Commands:*\n` +
      `/admin - Admin panel\n` +
      `/pending - Pending approvals\n` +
      `/stats - Statistics\n` +
      `/users - All users\n` +
      `/allproducts - All products\n` +
      `/broadcast - Send to all users\n` +
      `/messageuser - Message individual user\n` +
      `/setwelcome - Set welcome message\n` +
      `/setchannel - Set channel link\n` +
      `/maintenance - Maintenance mode\n`;
  }
  
  await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
}

// Status command
async function handleStatus(msg) {
  const chatId = msg.chat.id;
  
  const totalProducts = products.size;
  const approvedProducts = Array.from(products.values()).filter(p => p.status === 'approved').length;
  const pendingProducts = Array.from(products.values()).filter(p => p.status === 'pending').length;
  const totalUsers = users.size;
  
  const statusMessage = `📊 *Marketplace Status*\n\n` +
    `👥 *Users:* ${totalUsers}\n` +
    `🛍️ *Total Products:* ${totalProducts}\n` +
    `✅ *Approved:* ${approvedProducts}\n` +
    `⏳ *Pending:* ${pendingProducts}\n` +
    `❌ *Rejected:* ${totalProducts - approvedProducts - pendingProducts}\n\n` +
    `🏪 *JU Marketplace* - Active and Running! 🎓`;
  
  await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
}

// Handle regular messages for product creation
// Handle regular messages for product creation
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
        
        await bot.sendMessage(chatId,
          `✅ Title set: "${text.trim()}"\n\n` +
          `💰 *Step 3/4 - Product Price*\n\n` +
          `Enter the price in ETB:\n\n` +
          `Example: 1500`,
          { parse_mode: 'Markdown' }
        );
        break;
        
      case 'awaiting_product_price':
        try {
          // Validate user state
          if (!userState.productData) {
            await bot.sendMessage(chatId, '❌ Session expired. Please start over with /sell');
            userStates.delete(userId);
            return;
          }
          
          // Validate input
          if (!text || text.trim() === '') {
            await bot.sendMessage(chatId, '❌ Please enter a price amount.');
            return;
          }
          
          // Clean and validate price
          const cleanText = text.trim().replace(/[^\d]/g, '');
          const price = parseInt(cleanText);
          
          if (isNaN(price) || price <= 0) {
            await bot.sendMessage(chatId, 
              '❌ Please enter a valid price (numbers only).\n\n' +
              'Examples:\n' +
              '• 1500\n' +
              '• 500\n' +
              '• 7500'
            );
            return;
          }
          
          if (price > 1000000) { // Sanity check
            await bot.sendMessage(chatId, '❌ Price seems too high. Please enter a reasonable amount.');
            return;
          }
          
          // Update state
          userState.productData.price = price;
          userState.state = 'awaiting_product_description';
          userStates.set(userId, userState);
          
          // Ask for description
          await bot.sendMessage(chatId,
            `✅ Price set: ${price} ETB\n\n` +
            `📝 *Step 4/4 - Product Description*\n\n` +
            `Add a description (optional):\n\n` +
            `• Condition (New/Used)\n` +
            `• Features/Specifications\n` +
            `• Reason for selling\n` +
            `• Any defects or issues\n\n` +
            `*Type /skip to skip description*`,
            { parse_mode: 'Markdown' }
          );
          
        } catch (error) {
          console.error('Price processing error:', error);
          await bot.sendMessage(chatId, 
            '❌ Sorry, there was an error processing the price. Please enter numbers only.'
          );
        }
        break;
        
      case 'awaiting_product_description':
        try {
          if (text === '/skip') {
            userState.productData.description = 'No description provided';
          } else {
            userState.productData.description = text;
          }
          await selectProductCategory(chatId, userId, userState);
        } catch (error) {
          console.error('Description processing error:', error);
          await bot.sendMessage(chatId, '❌ Error processing description. Please try again.');
        }
        break;
    }
  } catch (error) {
    console.error('Product creation error:', error);
    await bot.sendMessage(chatId, 
      '❌ Sorry, there was an unexpected error. Please start over with /sell'
    );
    userStates.delete(userId);
  }
          }

// Select product category
async function selectProductCategory(chatId, userId, userState) {
  const categoryKeyboard = {
    reply_markup: {
      inline_keyboard: [
        ...CATEGORIES.map(category => [
          { text: category, callback_data: `category_${category}` }
        ]),
        [
          { text: '🚫 Cancel', callback_data: 'cancel_product' }
        ]
      ]
    }
  };
  
  userState.state = 'awaiting_product_category';
  userStates.set(userId, userState);
  
  await bot.sendMessage(chatId,
    `📂 *Select Category*\n\n` +
    `Choose the category that best fits your item:`,
    { parse_mode: 'Markdown', ...categoryKeyboard }
  );
}

// Complete product creation
async function completeProductCreation(chatId, userId, userState, category, callbackQueryId = null) {
  const user = users.get(userId);
  
  // Create product
  const product = {
    id: productIdCounter++,
    sellerId: userId,
    sellerUsername: user.username || '',
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
  
  // Notify admins
  await notifyAdminsAboutNewProduct(product);
  
  if (callbackQueryId) {
    await bot.answerCallbackQuery(callbackQueryId, { 
      text: '✅ Product submitted for admin approval!' 
    });
  }
  
  await bot.sendMessage(chatId,
    `✅ *Product Submitted Successfully!*\n\n` +
    `🏷️ *${product.title}*\n` +
    `💰 ${product.price} ETB | ${product.category}\n\n` +
    `⏳ *Status:* Waiting for admin approval\n\n` +
    `Your product will appear in ${botSettings.get('channel_link')} after approval.`,
    { parse_mode: 'Markdown' }
  );
  
  await showMainMenu(chatId);
}

// Notify admins about new product
async function notifyAdminsAboutNewProduct(product) {
  const seller = users.get(product.sellerId);
  let notifiedCount = 0;

  for (const adminId of ADMIN_IDS) {
    try {
      const approveKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve_${product.id}` },
              { text: '❌ Reject', callback_data: `reject_${product.id}` }
            ],
            [
              { text: '📨 Message Seller', callback_data: `message_seller_${product.sellerId}` }
            ]
          ]
        }
      };

      // Try to send with image first
      try {
        if (product.images && product.images.length > 0) {
          await bot.sendPhoto(adminId, product.images[0], {
            caption: `🆕 *NEW PRODUCT FOR APPROVAL*\n\n` +
                     `🏷️ *Title:* ${product.title}\n` +
                     `💰 *Price:* ${product.price} ETB\n` +
                     `📂 *Category:* ${product.category}\n` +
                     `👤 *Seller:* ${seller?.firstName || 'Student'} (@${seller?.username || 'No username'})\n` +
                     `${product.description ? `📝 *Description:* ${product.description}\n` : ''}` +
                     `⏰ *Submitted:* ${product.createdAt.toLocaleString()}\n\n` +
                     `*Quick Actions Below ↓*`,
            parse_mode: 'Markdown',
            reply_markup: approveKeyboard.reply_markup
          });
        } else {
          await bot.sendMessage(adminId,
            `🆕 *NEW PRODUCT FOR APPROVAL*\n\n` +
            `🏷️ *Title:* ${product.title}\n` +
            `💰 *Price:* ${product.price} ETB\n` +
            `📂 *Category:* ${product.category}\n` +
            `👤 *Seller:* ${seller?.firstName || 'Student'} (@${seller?.username || 'No username'})\n` +
            `${product.description ? `📝 *Description:* ${product.description}\n` : ''}` +
            `⏰ *Submitted:* ${product.createdAt.toLocaleString()}\n\n` +
            `*Click buttons to approve/reject:*`,
            { parse_mode: 'Markdown', ...approveKeyboard }
          );
        }
      } catch (photoError) {
        // Fallback to text message
        await bot.sendMessage(adminId,
          `🆕 *NEW PRODUCT FOR APPROVAL*\n\n` +
          `🏷️ *Title:* ${product.title}\n` +
          `💰 *Price:* ${product.price} ETB\n` +
          `📂 *Category:* ${product.category}\n` +
          `👤 *Seller:* ${seller?.firstName || 'Student'} (@${seller?.username || 'No username'})\n` +
          `${product.description ? `📝 *Description:* ${product.description}\n` : ''}` +
          `⏰ *Submitted:* ${product.createdAt.toLocaleString()}\n\n` +
          `*Click buttons to approve/reject:*`,
          { parse_mode: 'Markdown', ...approveKeyboard }
        );
      }
      
      notifiedCount++;
      console.log(`Notification sent to admin: ${adminId}`);

    } catch (error) {
      console.error(`Failed to notify admin ${adminId}:`, error.message);
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  return notifiedCount;
}

// Handle callback queries
async function handleCallbackQuery(callbackQuery) {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;
  
  try {
    // Product category selection
    if (data.startsWith('category_')) {
      const category = data.replace('category_', '');
      const userState = userStates.get(userId);
      
      if (userState && userState.state === 'awaiting_product_category') {
        await completeProductCreation(chatId, userId, userState, category, callbackQuery.id);
      }
      return;
    }
    
    // Cancel product creation
    if (data === 'cancel_product') {
      userStates.delete(userId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Product creation cancelled' });
      await bot.sendMessage(chatId, 'Product creation cancelled.');
      return;
    }
    
    // Admin approval
    if (data.startsWith('approve_')) {
      const productId = parseInt(data.replace('approve_', ''));
      await handleAdminApproval(productId, callbackQuery, true);
      return;
    }
    
    // Admin rejection
    if (data.startsWith('reject_')) {
      const productId = parseInt(data.replace('reject_', ''));
      await handleAdminApproval(productId, callbackQuery, false);
      return;
    }
    
    // Message seller from approval
    if (data.startsWith('message_seller_')) {
      const sellerId = parseInt(data.replace('message_seller_', ''));
      
      if (!ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Admin access required' });
        return;
      }
      
      const seller = users.get(sellerId);
      if (!seller) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Seller not found' });
        return;
      }
      
      userStates.set(userId, { 
        state: 'awaiting_individual_message', 
        targetUserId: sellerId 
      });
      
      await bot.sendMessage(chatId,
        `📨 *Message Seller*\n\n` +
        `Seller: ${seller.firstName} (@${seller.username || 'No username'})\n` +
        `ID: ${sellerId}\n\n` +
        `Please send your message:`,
        { parse_mode: 'Markdown' }
      );
      
      await bot.answerCallbackQuery(callbackQuery.id, { 
        text: `Messaging ${seller.firstName}` 
      });
      return;
    }
    
    // Report product
    if (data.startsWith('report_')) {
      const productId = parseInt(data.replace('report_', ''));
      const product = products.get(productId);
      
      if (!product) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Product not found' });
        return;
      }
      
      userStates.set(userId, { 
        state: 'awaiting_report_reason', 
        reportProductId: productId 
      });
      
      await bot.sendMessage(chatId,
        `🚨 *Report Product*\n\n` +
        `Product: ${product.title}\n` +
        `Price: ${product.price} ETB\n\n` +
        `Please describe the issue:\n\n` +
        `• Wrong information\n` +
        `• Suspicious activity\n` +
        `• Prohibited item\n` +
        `• Other concerns`,
        { parse_mode: 'Markdown' }
      );
      
      await bot.answerCallbackQuery(callbackQuery.id, { 
        text: '📝 Please describe the issue' 
      });
      return;
    }
    
    // Contact admin reasons
    if (data === 'report_issue') {
      userStates.set(userId, { state: 'awaiting_issue_report' });
      await bot.sendMessage(chatId,
        `📧 *Report an Issue*\n\n` +
        `Please describe the issue you're experiencing:\n\n` +
        `• What happened?\n` +
        `• When did it occur?\n` +
        `• Any error messages?\n\n` +
        `Type your report below:`,
        { parse_mode: 'Markdown' }
      );
      await bot.answerCallbackQuery(callbackQuery.id, { text: '📝 Please describe your issue' });
      return;
    }
    
    if (data === 'give_suggestion') {
      userStates.set(userId, { state: 'awaiting_suggestion' });
      await bot.sendMessage(chatId,
        `💡 *Share Your Suggestion*\n\n` +
        `We'd love to hear your ideas for improving the marketplace!\n\n` +
        `What would you like to see?\n` +
        `• New features\n` +
        `• Improvements\n` +
        `• Bug fixes\n` +
        `• Other suggestions\n\n` +
        `Type your suggestion below:`,
        { parse_mode: 'Markdown' }
      );
      await bot.answerCallbackQuery(callbackQuery.id, { text: '💡 We value your suggestions!' });
      return;
    }
    
    if (data === 'urgent_help') {
      userStates.set(userId, { state: 'awaiting_urgent_help' });
      await bot.sendMessage(chatId,
        `🚨 *Urgent Help Request*\n\n` +
        `Please describe your urgent issue:\n\n` +
        `• Safety concern\n` +
        `• Scam attempt\n` +
        `• Emergency situation\n` +
        `• Immediate assistance needed\n\n` +
        `*Note:* For immediate safety issues, also contact campus security.\n\n` +
        `Describe your urgent issue below:`,
        { parse_mode: 'Markdown' }
      );
      await bot.answerCallbackQuery(callbackQuery.id, { text: '🚨 Urgent help requested' });
      return;
    }
    
    if (data === 'general_question') {
      userStates.set(userId, { state: 'awaiting_general_question' });
      await bot.sendMessage(chatId,
        `🤔 *General Question*\n\n` +
        `What would you like to know about the marketplace?\n\n` +
        `Ask your question below and our team will respond soon:`,
        { parse_mode: 'Markdown' }
      );
      await bot.answerCallbackQuery(callbackQuery.id, { text: '❓ Ask your question' });
      return;
    }
    
  } catch (error) {
    console.error('Callback error:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Error processing request' });
  }
}

// Handle admin approval
async function handleAdminApproval(productId, callbackQuery, approve) {
  const adminId = callbackQuery.from.id;
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const product = products.get(productId);
  
  if (!ADMIN_IDS.includes(adminId)) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Admin access required' });
    return;
  }
  
  if (!product) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Product not found' });
    return;
  }
  
  if (approve) {
    // Approve product
    product.status = 'approved';
    product.approvedBy = adminId;
    
    // Post to channel
    try {
      const seller = users.get(product.sellerId);
      const buyNowUrl = `https://t.me/${bot.options.username}?start=product_${product.id}`;
      
      const channelKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 BUY NOW', url: buyNowUrl }]
          ]
        }
      };
      
      if (product.images && product.images.length > 0) {
        await bot.sendPhoto(CHANNEL_ID, product.images[0], {
          caption: `🏷️ *${product.title}*\n\n` +
                   `💰 *Price:* ${product.price} ETB\n` +
                   `📦 *Category:* ${product.category}\n` +
                   `👤 *Seller:* ${seller.firstName}\n` +
                   `${product.description ? `📝 *Description:* ${product.description}\n` : ''}` +
                   `\n📍 *Jimma University Campus*` +
                   `\n\n🛒 Buy via @${bot.options.username}`,
          parse_mode: 'Markdown',
          reply_markup: channelKeyboard.reply_markup
        });
      } else {
        await bot.sendMessage(CHANNEL_ID,
          `🏷️ *${product.title}*\n\n` +
          `💰 *Price:* ${product.price} ETB\n` +
          `📦 *Category:* ${product.category}\n` +
          `👤 *Seller:* ${seller.firstName}\n` +
          `${product.description ? `📝 *Description:* ${product.description}\n` : ''}` +
          `\n📍 *Jimma University Campus*` +
          `\n\n🛒 Buy via @${bot.options.username}`,
          { parse_mode: 'Markdown', reply_markup: channelKeyboard.reply_markup }
        );
      }
      
      // Notify seller
      await bot.sendMessage(product.sellerId,
        `✅ *Your Product Has Been Approved!*\n\n` +
        `🏷️ *${product.title}*\n` +
        `💰 ${product.price} ETB | ${product.category}\n\n` +
        `🎉 Your product is now live in ${botSettings.get('channel_link')}!\n\n` +
        `Buyers can now find and purchase your item.`,
        { parse_mode: 'Markdown' }
      );
      
      await bot.answerCallbackQuery(callbackQuery.id, { 
        text: '✅ Product approved and posted to channel!' 
      });
      
      // Update approval message
      try {
        await bot.editMessageCaption(
          `✅ *PRODUCT APPROVED*\n\n` +
          `🏷️ *${product.title}*\n` +
          `💰 ${product.price} ETB | ${product.category}\n` +
          `👤 Approved by admin\n` +
          `⏰ ${new Date().toLocaleString()}`,
          {
            chat_id: chatId,
            message_id: message.message_id,
            parse_mode: 'Markdown'
          }
        );
      } catch (editError) {
        // Message might not have a caption, try editing text
        await bot.editMessageText(
          `✅ *PRODUCT APPROVED*\n\n` +
          `🏷️ *${product.title}*\n` +
          `💰 ${product.price} ETB | ${product.category}\n` +
          `👤 Approved by admin\n` +
          `⏰ ${new Date().toLocaleString()}`,
          {
            chat_id: chatId,
            message_id: message.message_id,
            parse_mode: 'Markdown'
          }
        );
      }
      
    } catch (error) {
      console.error('Channel post error:', error);
      await bot.answerCallbackQuery(callbackQuery.id, { 
        text: '❌ Failed to post to channel' 
      });
    }
    
  } else {
    // Reject product
    product.status = 'rejected';
    product.approvedBy = adminId;
    
    // Notify seller
    await bot.sendMessage(product.sellerId,
      `❌ *Product Not Approved*\n\n` +
      `🏷️ *${product.title}*\n\n` +
      `Your product submission was not approved.\n\n` +
      `Possible reasons:\n` +
      `• Poor quality images\n` +
      `• Inappropriate content\n` +
      `• Missing information\n\n` +
      `You can submit again with better details.`,
      { parse_mode: 'Markdown' }
    );
    
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: '❌ Product rejected' 
    });
    
    // Update rejection message
    try {
      await bot.editMessageCaption(
        `❌ *PRODUCT REJECTED*\n\n` +
        `🏷️ *${product.title}*\n` +
        `💰 ${product.price} ETB | ${product.category}\n` +
        `👤 Rejected by admin\n` +
        `⏰ ${new Date().toLocaleString()}`,
        {
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: 'Markdown'
        }
      );
    } catch (editError) {
      await bot.editMessageText(
        `❌ *PRODUCT REJECTED*\n\n` +
        `🏷️ *${product.title}*\n` +
        `💰 ${product.price} ETB | ${product.category}\n` +
        `👤 Rejected by admin\n` +
        `⏰ ${new Date().toLocaleString()}`,
        {
          chat_id: chatId,
          message_id: message.message_id,
          parse_mode: 'Markdown'
        }
      );
    }
  }
}

// Handle contact messages
async function handleContactMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  const userState = userStates.get(userId);
  const user = users.get(userId);
  
  if (!userState || !userState.state.includes('awaiting_')) return;
  
  try {
    const userName = user.firstName;
    const userUsername = user.username ? `@${user.username}` : 'No username';
    
    let adminMessage = '';
    let userConfirmation = '';
    let messageType = '';
    
    switch (userState.state) {
      case 'awaiting_report_reason':
        const productId = userState.reportProductId;
        const product = products.get(productId);
        messageType = 'PRODUCT REPORT';
        adminMessage = `🚨 *${messageType}*\n\n` +
                      `*From:* ${userName} (${userUsername})\n` +
                      `*User ID:* ${userId}\n` +
                      `*Product:* ${product.title}\n` +
                      `*Product ID:* ${productId}\n\n` +
                      `*Report:* ${text}\n\n` +
                      `_Time: ${new Date().toLocaleString()}_`;
        
        userConfirmation = `✅ *Issue Reported Successfully!*\n\n` +
                          `We've received your report and will investigate it shortly.\n\n` +
                          `*Reference:* ${messageType}-${Date.now()}\n` +
                          `*Submitted:* ${new Date().toLocaleString()}\n\n` +
                          `We'll contact you if we need more information.`;
        break;
        
      case 'awaiting_issue_report':
        messageType = 'ISSUE REPORT';
        adminMessage = `🚨 *${messageType}*\n\n` +
                      `*From:* ${userName} (${userUsername})\n` +
                      `*User ID:* ${userId}\n\n` +
                      `*Report:* ${text}\n\n` +
                      `_Time: ${new Date().toLocaleString()}_`;
        
        userConfirmation = `✅ *Issue Reported Successfully!*\n\n` +
                          `We've received your report and will investigate it shortly.\n\n` +
                          `*Reference:* ${messageType}-${Date.now()}\n` +
                          `*Submitted:* ${new Date().toLocaleString()}\n\n` +
                          `We'll contact you if we need more information.`;
        break;
        
      case 'awaiting_suggestion':
        messageType = 'SUGGESTION';
        adminMessage = `💡 *${messageType}*\n\n` +
                      `*From:* ${userName} (${userUsername})\n` +
                      `*User ID:* ${userId}\n\n` +
                      `*Suggestion:* ${text}\n\n` +
                      `_Time: ${new Date().toLocaleString()}_`;
        
        userConfirmation = `✅ *Suggestion Received!*\n\n` +
                          `Thank you for your valuable feedback! 🎉\n\n` +
                          `We review all suggestions and will consider it for future updates.\n\n` +
                          `*Reference:* ${messageType}-${Date.now()}`;
        break;
        
      case 'awaiting_urgent_help':
        messageType = 'URGENT HELP';
        adminMessage = `🚨 *${messageType} - IMMEDIATE ATTENTION NEEDED!*\n\n` +
                      `*From:* ${userName} (${userUsername})\n` +
                      `*User ID:* ${userId}\n\n` +
                      `*Urgent Issue:* ${text}\n\n` +
                      `_Time: ${new Date().toLocaleString()}_`;
        
        userConfirmation = `🚨 *Urgent Help Request Submitted!*\n\n` +
                          `We've received your urgent request and will respond as soon as possible.\n\n` +
                          `*If this is a safety emergency, please also contact campus security.*\n\n` +
                          `*Reference:* ${messageType}-${Date.now()}\n` +
                          `*Priority:* HIGH`;
        break;
        
      case 'awaiting_general_question':
        messageType = 'QUESTION';
        adminMessage = `❓ *${messageType}*\n\n` +
                      `*From:* ${userName} (${userUsername})\n` +
                      `*User ID:* ${userId}\n\n` +
                      `*Question:* ${text}\n\n` +
                      `_Time: ${new Date().toLocaleString()}_`;
        
        userConfirmation = `✅ *Question Submitted!*\n\n` +
                          `We've received your question and will respond within 24 hours.\n\n` +
                          `*Reference:* ${messageType}-${Date.now()}\n` +
                          `You can check the /help section for immediate answers.`;
        break;
        
      case 'awaiting_individual_message':
        const targetUserId = userState.targetUserId;
        const targetUser = users.get(targetUserId);
        
        if (!targetUser) {
          await bot.sendMessage(chatId, '❌ User not found.');
          userStates.delete(userId);
          return;
        }
        
        try {
          // Send message to target user
          await bot.sendMessage(targetUserId,
            `📨 *Message from JU Marketplace Admin*\n\n` +
            `${text}\n\n` +
            `*Jimma University Marketplace* 🎓`,
            { parse_mode: 'Markdown' }
          );
          
          await bot.sendMessage(chatId,
            `✅ *Message Sent Successfully!*\n\n` +
            `To: ${targetUser.firstName} (@${targetUser.username || 'No username'})\n` +
            `ID: ${targetUserId}\n\n` +
            `Your message has been delivered.`,
            { parse_mode: 'Markdown' }
          );
          
        } catch (error) {
          await bot.sendMessage(chatId,
            `❌ *Failed to Send Message*\n\n` +
            `User might have blocked the bot or deleted their account.\n\n` +
            `Error: ${error.message}`,
            { parse_mode: 'Markdown' }
          );
        }
        
        userStates.delete(userId);
        return;
    }
    
    // Send notification to all admins
    let adminNotifiedCount = 0;
    for (const adminId of ADMIN_IDS) {
      try {
        await bot.sendMessage(adminId, adminMessage, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📨 Reply to User', callback_data: `message_user_${userId}` },
                { text: '👤 View Profile', callback_data: `view_user_${userId}` }
              ]
            ]
          }
        });
        adminNotifiedCount++;
      } catch (error) {
        console.error(`Failed to notify admin ${adminId}:`, error.message);
      }
    }
    
    // Send confirmation to user
    await bot.sendMessage(chatId, userConfirmation, { parse_mode: 'Markdown' });
    
    // Clear user state
    userStates.delete(userId);
    
    // Show main menu after submission
    await showMainMenu(chatId);
    
  } catch (error) {
    console.error('Contact message handling error:', error);
    await bot.sendMessage(chatId, 
      '❌ Sorry, there was an error submitting your message. Please try again.',
      { parse_mode: 'Markdown' }
    );
  }
}

// Admin commands
async function handleAdminCommand(msg, command, args = []) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!ADMIN_IDS.includes(userId)) {
    await bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }
  
  try {
    switch (command) {
      case 'admin':
        await showAdminPanel(chatId);
        break;
        
      case 'pending':
        await showPendingApprovals(chatId);
        break;
        
      case 'stats':
        await showAdminStats(chatId);
        break;
        
      case 'users':
        await showAllUsers(chatId);
        break;
        
      case 'allproducts':
        await showAllProducts(chatId);
        break;
        
      case 'broadcast':
        userStates.set(userId, { state: 'awaiting_broadcast_message' });
        await bot.sendMessage(chatId,
          `📢 *Broadcast to All Users*\n\n` +
          `Send the message you want to broadcast to *ALL* users (${users.size} people).\n\n` +
          `You can use:\n` +
          `• Text and emojis\n` +
          `• Markdown formatting\n` +
          `• Important announcements\n\n` +
          `Type /cancel to cancel.`,
          { parse_mode: 'Markdown' }
        );
        break;
        
      case 'messageuser':
        userStates.set(userId, { state: 'awaiting_user_id_for_message' });
        await bot.sendMessage(chatId,
          `📨 *Message Individual User*\n\n` +
          `Please send the User ID you want to message.\n\n` +
          `You can get User IDs from:\n` +
          `• /users command\n` +
          `• Product approval notifications\n\n` +
          `Type /cancel to cancel.`,
          { parse_mode: 'Markdown' }
        );
        break;
        
      case 'setwelcome':
        const welcomeText = args.join(' ');
        if (!welcomeText) {
          await bot.sendMessage(chatId,
            `Current welcome message:\n\n${botSettings.get('welcome_message')}\n\n` +
            `Usage: /setwelcome Your new welcome message here`,
            { parse_mode: 'Markdown' }
          );
          return;
        }
        botSettings.set('welcome_message', welcomeText);
        await bot.sendMessage(chatId, '✅ Welcome message updated!');
        break;
        
      case 'setchannel':
        const channelLink = args[0];
        if (!channelLink) {
          await bot.sendMessage(chatId,
            `Current channel: ${botSettings.get('channel_link')}\n\n` +
            `Usage: /setchannel @channelusername`,
            { parse_mode: 'Markdown' }
          );
          return;
        }
        botSettings.set('channel_link', channelLink);
        // Update all existing products with new channel link
        await bot.sendMessage(chatId, `✅ Channel link updated to ${channelLink}! All products will show this new link.`);
        break;
        
      case 'maintenance':
        const action = args[0];
        if (action === 'on') {
          maintenanceMode = true;
          await bot.sendMessage(chatId, '🔴 Maintenance mode enabled. Bot is now stopped.');
        } else if (action === 'off') {
          maintenanceMode = false;
          await bot.sendMessage(chatId, '🟢 Maintenance mode disabled. Bot is now running.');
        } else {
          await bot.sendMessage(chatId,
            `Maintenance mode: ${maintenanceMode ? '🔴 ON' : '🟢 OFF'}\n\n` +
            `Usage: /maintenance on|off`,
            { parse_mode: 'Markdown' }
          );
        }
        break;
        
      default:
        await bot.sendMessage(chatId, '❌ Unknown admin command.');
    }
  } catch (error) {
    console.error('Admin command error:', error);
    await bot.sendMessage(chatId, '❌ Error processing admin command.');
  }
}

// Show admin panel
async function showAdminPanel(chatId) {
  const pendingCount = Array.from(products.values()).filter(p => p.status === 'pending').length;
  
  const adminKeyboard = {
    reply_markup: {
      keyboard: [
        [{ text: `⏳ Pending (${pendingCount})` }, { text: '📊 Stats' }],
        [{ text: '📨 Message User' }, { text: '📢 Broadcast' }],
        [{ text: '👥 Users' }, { text: '🛍️ All Products' }],
        [{ text: '✏️ Set Welcome' }, { text: '📢 Set Channel' }],
        [{ text: `${maintenanceMode ? '🟢 Start Bot' : '🔴 Stop Bot'}` }],
        [{ text: '🏪 Main Menu' }]
      ],
      resize_keyboard: true
    }
  };
  
  await bot.sendMessage(chatId,
    `⚡ *JU Marketplace Admin Panel*\n\n` +
    `*Quick Stats:*\n` +
    `• 👥 Users: ${users.size}\n` +
    `• 🛍️ Products: ${products.size}\n` +
    `• ⏳ Pending: ${pendingCount}\n` +
    `• 🔧 Status: ${maintenanceMode ? '🔴 STOPPED' : '🟢 RUNNING'}\n\n` +
    `Choose an option below:`,
    { parse_mode: 'Markdown', ...adminKeyboard }
  );
}

// Show pending approvals
async function showPendingApprovals(chatId) {
  const pendingProducts = Array.from(products.values())
    .filter(product => product.status === 'pending')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  if (pendingProducts.length === 0) {
    await bot.sendMessage(chatId, '✅ No products pending approval.');
    return;
  }
  
  await bot.sendMessage(chatId, `⏳ Pending Approvals (${pendingProducts.length}):`);
  
  for (const product of pendingProducts) {
    const seller = users.get(product.sellerId);
    const timeAgo = getTimeAgo(product.createdAt);
    
    const approveKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approve_${product.id}` },
            { text: '❌ Reject', callback_data: `reject_${product.id}` }
          ],
          [
            { text: '📨 Message Seller', callback_data: `message_seller_${product.sellerId}` }
          ]
        ]
      }
    };
    
    try {
      if (product.images && product.images.length > 0) {
        await bot.sendPhoto(chatId, product.images[0], {
          caption: `⏳ *Pending Approval* (${timeAgo})\n\n` +
                   `🏷️ *Title:* ${product.title}\n` +
                   `💰 *Price:* ${product.price} ETB\n` +
                   `📂 *Category:* ${product.category}\n` +
                   `👤 *Seller:* ${seller?.firstName || 'Student'} (@${seller?.username || 'No username'})\n` +
                   `${product.description ? `📝 *Description:* ${product.description}\n` : ''}` +
                   `📅 *Submitted:* ${product.createdAt.toLocaleString()}`,
          parse_mode: 'Markdown',
          reply_markup: approveKeyboard.reply_markup
        });
      } else {
        await bot.sendMessage(chatId,
          `⏳ *Pending Approval* (${timeAgo})\n\n` +
          `🏷️ *Title:* ${product.title}\n` +
          `💰 *Price:* ${product.price} ETB\n` +
          `📂 *Category:* ${product.category}\n` +
          `👤 *Seller:* ${seller?.firstName || 'Student'} (@${seller?.username || 'No username'})\n` +
          `${product.description ? `📝 *Description:* ${product.description}\n` : ''}`,
          { parse_mode: 'Markdown', reply_markup: approveKeyboard.reply_markup }
        );
      }
    } catch (error) {
      await bot.sendMessage(chatId,
        `⏳ *Pending Approval* (${timeAgo})\n\n` +
        `🏷️ *Title:* ${product.title}\n` +
        `💰 *Price:* ${product.price} ETB\n` +
        `📂 *Category:* ${product.category}\n` +
        `👤 *Seller:* ${seller?.firstName || 'Student'}\n` +
        `${product.description ? `📝 *Description:* ${product.description}\n` : ''}`,
        { parse_mode: 'Markdown', reply_markup: approveKeyboard.reply_markup }
      );
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

// Show admin stats
async function showAdminStats(chatId) {
  const totalProducts = products.size;
  const approvedProducts = Array.from(products.values()).filter(p => p.status === 'approved').length;
  const pendingProducts = Array.from(products.values()).filter(p => p.status === 'pending').length;
  const rejectedProducts = Array.from(products.values()).filter(p => p.status === 'rejected').length;
  const totalUsers = users.size;
  
  const today = new Date();
  const todayProducts = Array.from(products.values())
    .filter(p => p.createdAt.toDateString() === today.toDateString()).length;
  
  const todayUsers = Array.from(users.values())
    .filter(u => u.joinedAt.toDateString() === today.toDateString()).length;
  
  await bot.sendMessage(chatId,
    `📊 *Marketplace Statistics*\n\n` +
    `👥 *User Statistics:*\n` +
    `• Total Registered: ${totalUsers} users\n` +
    `• New Today: ${todayUsers} users\n\n` +
    `🛍️ *Product Statistics:*\n` +
    `• Total Products: ${totalProducts} items\n` +
    `• ✅ Approved: ${approvedProducts} items\n` +
    `• ⏳ Pending: ${pendingProducts} items\n` +
    `• ❌ Rejected: ${rejectedProducts} items\n` +
    `• New Today: ${todayProducts} items\n\n` +
    `📈 *Marketplace Health:*\n` +
    `• Approval Rate: ${totalProducts > 0 ? ((approvedProducts / totalProducts) * 100).toFixed(1) : 0}%\n` +
    `• Daily Growth: +${todayProducts} products, +${todayUsers} users\n\n` +
    `🕒 *Last Updated:* ${new Date().toLocaleString()}`,
    { parse_mode: 'Markdown' }
  );
}

// Show all users
async function showAllUsers(chatId) {
  const userList = Array.from(users.values());
  
  if (userList.length === 0) {
    await bot.sendMessage(chatId, 'No users registered yet.');
    return;
  }
  
  let message = `👥 *Registered Users (${userList.length})*\n\n`;
  
  userList.slice(0, 15).forEach((user, index) => {
    const userProducts = Array.from(products.values()).filter(p => p.sellerId === user.telegramId).length;
    
    message += `${index + 1}. ${user.firstName} (@${user.username || 'No username'})\n`;
    message += `   🆔 ${user.telegramId}\n`;
    message += `   🛍️ Products: ${userProducts}\n`;
    message += `   📅 Joined: ${user.joinedAt.toLocaleDateString()}\n\n`;
  });
  
  if (userList.length > 15) {
    message += `... and ${userList.length - 15} more users.`;
  }
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

// Show all products
async function showAllProducts(chatId) {
  const allProducts = Array.from(products.values());
  
  if (allProducts.length === 0) {
    await bot.sendMessage(chatId, 'No products in the system.');
    return;
  }
  
  let message = `🛍️ *All Products (${allProducts.length})*\n\n`;
  
  allProducts.forEach((product, index) => {
    const seller = users.get(product.sellerId);
    const statusIcon = product.status === 'approved' ? '✅' : product.status === 'pending' ? '⏳' : '❌';
    
    message += `${index + 1}. ${statusIcon} *${product.title}*\n`;
    message += `   💰 ${product.price} ETB | ${product.category}\n`;
    message += `   👤 ${seller?.firstName || 'Unknown'}\n`;
    message += `   🏷️ ${product.status} | 📅 ${product.createdAt.toLocaleDateString()}\n\n`;
  });
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

// Handle broadcast message
async function handleBroadcastMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  const userState = userStates.get(userId);
  
  if (userState && userState.state === 'awaiting_broadcast_message') {
    const confirmKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Yes, Send to All', callback_data: `confirm_broadcast_${encodeURIComponent(text)}` },
            { text: '❌ Cancel', callback_data: 'cancel_broadcast' }
          ]
        ]
      }
    };
    
    await bot.sendMessage(chatId,
      `📢 *Broadcast Confirmation*\n\n` +
      `*Your Message:*\n"${text}"\n\n` +
      `*This will be sent to:* ${users.size} users\n\n` +
      `Are you sure you want to send this broadcast?`,
      { parse_mode: 'Markdown', ...confirmKeyboard }
    );
    
    userStates.delete(userId);
  }
}

// Handle user ID for messaging
async function handleUserIdForMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  const userState = userStates.get(userId);
  
  if (userState && userState.state === 'awaiting_user_id_for_message') {
    const targetUserId = parseInt(text);
    if (isNaN(targetUserId)) {
      await bot.sendMessage(chatId, '❌ Please enter a valid numeric User ID.');
      return;
    }
    
    const targetUser = users.get(targetUserId);
    if (!targetUser) {
      await bot.sendMessage(chatId, '❌ User not found. Please check the User ID.');
      return;
    }
    
    userStates.set(userId, { 
      state: 'awaiting_individual_message', 
      targetUserId: targetUserId 
    });
    
    await bot.sendMessage(chatId,
      `📨 *Message to ${targetUser.firstName}*\n\n` +
      `User: ${targetUser.firstName} (@${targetUser.username || 'No username'})\n` +
      `ID: ${targetUserId}\n\n` +
      `Now please send the message you want to send:`,
      { parse_mode: 'Markdown' }
    );
  }
}

// Cancel command
async function handleCancel(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (userStates.has(userId)) {
    userStates.delete(userId);
    await bot.sendMessage(chatId, '❌ Action cancelled.');
    await showMainMenu(chatId);
  } else {
    await bot.sendMessage(chatId, 'ℹ️ No active action to cancel.');
    await showMainMenu(chatId);
  }
}

// Main message handler
    // Main message handler
async function handleMessage(msg) {
  const text = msg.text;
  
  if (!text) return;
  
  // Handle commands
  if (text.startsWith('/')) {
    const [command, ...args] = text.slice(1).split(' ');
    
    switch (command.toLowerCase()) {
      case 'start':
        const startParam = args[0];
        await handleStart(msg, startParam);
        break;
      case 'help':
      case 'ℹ️':
        await handleHelp(msg);
        break;
      case 'browse':
        await handleBrowse(msg);
        break;
      case 'sell':
        await handleSell(msg);
        break;
      case 'myproducts':
        await handleMyProducts(msg);
        break;
      case 'contact':
        await handleContact(msg);
        break;
      case 'status':
        await handleStatus(msg);
        break;
      case 'cancel':
        await handleCancel(msg);
        break;
      // Admin commands
      case 'admin':
      case 'pending':
      case 'stats':
      case 'users':
      case 'allproducts':
      case 'broadcast':
      case 'messageuser':
      case 'setwelcome':
      case 'setchannel':
      case 'maintenance':
        await handleAdminCommand(msg, command.toLowerCase(), args);
        break;
      default:
        await handleRegularMessage(msg);
    }
  } else {
    // Handle regular messages
    if (msg.text === '🛍️ Browse Products') {
      await handleBrowse(msg);
    } else if (msg.text === '➕ Sell Item') {
      await handleSell(msg);
    } else if (msg.text === '📋 My Products') {
      await handleMyProducts(msg);
    } else if (msg.text === '📞 Contact Admin') {
      await handleContact(msg);
    } else if (msg.text === 'ℹ️ Help') {
      await handleHelp(msg);
    } else if (userStates.get(msg.from.id)?.state === 'awaiting_broadcast_message') {
      await handleBroadcastMessage(msg);
    } else if (userStates.get(msg.from.id)?.state === 'awaiting_user_id_for_message') {
      await handleUserIdForMessage(msg);
    } else {
      // Handle both product creation and contact messages
      await handleRegularMessage(msg);
      await handleContactMessage(msg);
    }
  }
}

// Vercel handler
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle GET requests
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      message: 'JU Marketplace Bot is running on Vercel!',
      timestamp: new Date().toISOString(),
      stats: {
        users: users.size,
        products: products.size,
        maintenance: maintenanceMode
      }
    });
  }
  
  // Handle POST requests (Telegram webhook)
  if (req.method === 'POST') {
    try {
      const update = req.body;
      
      // Handle different update types
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
    } catch (error) {
      console.error('Error processing update:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ JU Marketplace Bot configured for Vercel!');
