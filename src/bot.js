// src/bot.js
import { Telegraf, Markup, session } from 'telegraf';
import axios from 'axios';
import cloudinary from 'cloudinary';
import dotenv from 'dotenv';
import { pool } from './db.js';
import { registerTelegramUser, loginTelegramUser } from './services/userService.js';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
bot.use(session());
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000/api';

// Cloudinary configuration
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware to ensure user is registered
bot.use(async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) {
    const telegramId = String(ctx.from.id);
    const username = ctx.from.username || `user_${telegramId}`;
    
    // Auto-register/login
    const result = await registerTelegramUser(telegramId, username);
    if (result.success) {
      ctx.state.user = result.user || { id: result.userId, username: result.username };
    }
  }
  return next();
});

const resetDepositFlow = (ctx) => {
  if (!ctx.session) return;
  delete ctx.session.depositStep;
  delete ctx.session.depositAmount;
};

const resetWithdrawFlow = (ctx) => {
  if (!ctx.session) return;
  delete ctx.session.withdrawStep;
  delete ctx.session.withdrawAmount;
  delete ctx.session.withdrawMethod;
};

// Main Menu Keyboard
const getMainKeyboard = (userId) => {
  const url = process.env.FRONTEND_URL || 'http://localhost:5173';
  return Markup.keyboard([
    [Markup.button.webApp('🎮 ቢንጎ', `${url}/?tg_user_id=${userId}`), '🎮 ጨዋታ ጀምር'],
    ['💰 ሂሳብ', '🏆 የመሪዎች ዝርዝር'],
    ['💳 ገንዘብ አስገባ', '💸 ገንዘብ አውጣ'],
    ['👥 ወዳጆችን ጋብዝ'],
    ['ℹ️ መመሪያ', '🏁 የጨዋታ ዘዴዎች'],
    ['📞 ድጋፍ']
  ]).resize();
};

// Commands
bot.start(async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);
    const webAppUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/?tg_user_id=${telegramId}`;
    
    // Set the Menu Button for this user
    await ctx.setChatMenuButton({
      type: 'web_app',
      text: 'ቢንጎ',
      web_app: { url: webAppUrl }
    });

    ctx.reply(`እንኳን ወደ ቢንጎ በደህና መጡ! 🎮\n${ctx.from.first_name} ተጫውተው ያሸንፋ!`, getMainKeyboard(telegramId));
  } catch (error) {
    console.error('Error in start command:', error);
    ctx.reply(`እንኳን ወደ ቢንጎ በደህና መጡ! 🎮\n${ctx.from.first_name} ተጫውተው ያሸንፋ!`);
  }
});

bot.command('register', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const username = ctx.from.username || `user_${telegramId}`;
  ctx.reply('በቴሌግራም መለያዎ በኩል አስቀድሞ ተመዝግበዋል።');
});

bot.command('balance', async (ctx) => {
  try {
    if (!ctx.state.user) return ctx.reply('በመጀመሪያ /start ብለው ይመዝገቡ።');
    const [rows] = await pool.query('SELECT main_balance, bonus_balance FROM wallets WHERE user_id = ?', [ctx.state.user.id]);
    const { main_balance, bonus_balance } = rows[0] || { main_balance: 0, bonus_balance: 0 };
    ctx.reply(`💰  ሂሳብዎ:\nዋና: ${main_balance} ብር\nቦነስ: ${bonus_balance} ብር`);
  } catch (error) {
    ctx.reply('ሂሳብ ማመጣት አልተሳካም።');
  }
});

bot.hears('💰 ሂሳብዎ', async (ctx) => {
  try {
    if (!ctx.state.user) return ctx.reply('በመጀመሪያ /start ብለው ይመዝገቡ።');
    const [rows] = await pool.query('SELECT main_balance, bonus_balance FROM wallets WHERE user_id = ?', [ctx.state.user.id]);
    const { main_balance, bonus_balance } = rows[0] || { main_balance: 0, bonus_balance: 0 };
    ctx.reply(`💰 ሂሳብዎ:\nዋና: ${main_balance} ብር\nቦነስ: ${bonus_balance} ብር`);
  } catch (error) {
    ctx.reply('ሂሳብ ማመጣት አልተሳካም።');
  }
});

bot.command('coin_balance', async (ctx) => {
  try {
    if (!ctx.state.user) return ctx.reply('በመጀመሪያ /start ብለው ይመዝገቡ።');
    const [rows] = await pool.query('SELECT bonus_balance FROM wallets WHERE user_id = ?', [ctx.state.user.id]);
    const balance = rows[0]?.bonus_balance || 0;
    ctx.reply(`🪙 የኮይን ሂሳብህ: ${balance} ኮይኖች`);
  } catch (error) {
    ctx.reply('የኮይን ሂሳብ ማመጣት አልተሳካም።');
  }
});

bot.command('play', (ctx) => {
  ctx.reply('ለመጫወት ዋጋ ምረጥ፦', Markup.inlineKeyboard([
    [Markup.button.callback('10 ብር', 'stake_10'), Markup.button.callback('25 ብር', 'stake_25')],
    [Markup.button.callback('50 ብር', 'stake_50'), Markup.button.callback('100 ብር', 'stake_100')],
    [Markup.button.webApp('🎮 ቢንጎ', `${process.env.FRONTEND_URL || 'http://localhost:5173'}/?tg_user_id=${ctx.from.id}`)]
  ]));
});

bot.hears('🎮 ጨዋታ ጀምር', (ctx) => {
  ctx.reply('ለመጫወት ዋጋ ምረጥ፦', Markup.inlineKeyboard([
    [Markup.button.callback('10 ብር', 'stake_10'), Markup.button.callback('25 ብር', 'stake_25')],
    [Markup.button.callback('50 ብር', 'stake_50'), Markup.button.callback('100 ብር', 'stake_100')],
    [Markup.button.webApp('🎮 ቢንጎ', `${process.env.FRONTEND_URL || 'http://localhost:5173'}/?tg_user_id=${ctx.from.id}`)]
  ]));
});

// Stake handling
bot.action(/stake_(\d+)/, async (ctx) => {
  const amount = ctx.match[1];
  try {
    const webAppUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/?stake=${amount}&tg_user_id=${ctx.from.id}`;
    ctx.reply(`የ ${amount} ብር መረጥህ! ወደ ጨዋታ ክፍል ለመግባት ከታች ያለውን ቁልፍ ተጫን።`, Markup.inlineKeyboard([
      [Markup.button.webApp('🎮 ቢንጎ', webAppUrl)]
    ]));
  } catch (error) {
    ctx.reply('ዋጋ መምረጥ አልተሳካም።');
  }
});

bot.command('leader_board', async (ctx) => {
  try {
    const [rows] = await pool.query('SELECT u.username, w.main_balance FROM users u JOIN wallets w ON u.id = w.user_id ORDER BY w.main_balance DESC LIMIT 10');
    let message = '🏆 የሳምንቱ መሪዎች ዝርዝር:\n\n';
    rows.forEach((row, index) => {
      message += `${index + 1}. ${row.username} - ${row.main_balance} ETB\n`;
    });
    ctx.reply(message);
  } catch (error) {
    ctx.reply('መሪዎችን ማመጣት አልተሳካም።');
  }
});

bot.hears('🏆 መሪዎች ዝርዝር', async (ctx) => {
  try {
    const [rows] = await pool.query('SELECT u.username, w.main_balance FROM users u JOIN wallets w ON u.id = w.user_id ORDER BY w.main_balance DESC LIMIT 10');
    let message = '🏆 የሳምንቱ መሪዎች ዝርዝር:\n\n';
    rows.forEach((row, index) => {
      message += `${index + 1}. ${row.username} - ${row.main_balance} ETB\n`;
    });
    ctx.reply(message);
  } catch (error) {
    ctx.reply('መሪዎችን ማመጣት አልተሳካም።');
  }
});

bot.command('deposit', (ctx) => {
  if (!ctx.state.user) return ctx.reply('በመጀመሪያ /start ብለው ይመዝገቡ።');
  resetWithdrawFlow(ctx);
  ctx.session = { ...ctx.session, depositStep: 'amount' };
  ctx.reply('💳 ገንዘብ ማስገቢያ\n\nማስገባት የምትፈልገውን መጠን አስገባ።');
});

bot.hears('💳 ተቀማጭ', (ctx) => {
  if (!ctx.state.user) return ctx.reply(' በመጀመሪያ /start ብለው ይመዝገቡ።');
  resetWithdrawFlow(ctx);
  ctx.session = { ...ctx.session, depositStep: 'amount' };
  ctx.reply('💳 ገንዘብ አስገባ\n\nማስገባት የምትፈልገውን መጠን አስገባ።');
});

// Handle screenshot uploads for deposits
bot.on('photo', async (ctx) => {
  try {
    if (!ctx.state.user) return ctx.reply('በመጀመሪያ /start ብለው ይመዝገቡ።');
    if (!ctx.session || ctx.session.depositStep !== 'screenshot') {
      return ctx.reply('እባክህ መጀመሪያ የገንዘብ ማስገቢያ ለመጀመር የ 💳 ገንዘብ አስገባን ተጫን።');
    }

    const amount = ctx.session.depositAmount;
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const fileUrl = await bot.telegram.getFileLink(fileId);
    
    ctx.reply('ገንዘብ መግባቱን ማረጋገጥ በሂደት ላይ ነው...');

    // Upload to Cloudinary
    const uploadResponse = await cloudinary.v2.uploader.upload(fileUrl.href, {
      folder: 'bingo_deposits',
    });

    // Save to database
    await pool.query(
      'INSERT INTO deposit_requests (user_id, amount, screenshot_url, status, source) VALUES (?, ?, ?, "pending", "telegram")',
      [ctx.state.user.id, amount, uploadResponse.secure_url]
    );

    ctx.session.depositStep = null;
    ctx.session.depositAmount = null;

    ctx.reply(`✅ ለ ${amount}ያስገባክበት ማረጋገጫ ተቀብለናል።\n\n📌 ሁኔታ፡ ማረጋገጫ በመጠባበቅ ላይ\n\nቡድናችን በቅርቡ ያረጋግጣል። ጥያቄው ሲፀድቅ ወይም ሲተወ ማሳወቂያ ታገኛለህ።`, getMainKeyboard(ctx.from.id));
  } catch (error) {
    console.error('Deposit error:', error);
    ctx.reply('❌ ስክሪንሾትህን መላክ አልተሳካም። እባክህ እንደገና ሞክር ወይም እርዳታ ቲሙን ያነጋግሩ።');
  }
});

// Withdrawal Flow
const startWithdrawFlow = async (ctx) => {
  try {
    if (!ctx.state.user) return ctx.reply('በመጀመሪያ /start ብለው ይመዝገብ።');
    const [wb] = await pool.query('SELECT main_balance FROM wallets WHERE user_id=?', [ctx.state.user.id]);
    const balance = wb.length ? Number(wb[0].main_balance) : 0;
    const [pw] = await pool.query('SELECT COUNT(*) AS c FROM withdrawals WHERE user_id=? AND status="pending"', [ctx.state.user.id]);
    if (pw[0].c > 0) {
      return ctx.reply('❌ አስቀድሞ በመመርመር ላይ ያለ ገንዘብ የማሶጣት ጥያቄ አለህ። እባክህ እስኪገባ ድረስ ተጠብቅ።');
    }
    const minWithdrawal = 50;
    ctx.session = { ...ctx.session, withdrawStep: 'amount', balance, minWithdrawal };
    return ctx.reply(`💸 የገንዘብ ማውጣት ጥያቄ\nየሚገኝ ሂሳብህ፡ ${balance} ብር\nአነስተኛው የማውጣት መጠን፡ ${minWithdrawal} ብር\nለመውጣት የምትፈልገውን መጠን አስገባ።`);
  } catch (error) {
    console.error('Withdraw command error:', error);
    return ctx.reply('የማውጣት ሂደት መጀመር አልተሳካም።');
  }
};

bot.command('withdraw', startWithdrawFlow);

bot.hears('💸 ገንዘብ አውጣ', async (ctx) => {
  await startWithdrawFlow(ctx);
});

bot.action('withdraw_method_telebirr', async (ctx) => {
  try {
    if (!ctx.session || ctx.session.withdrawStep !== 'method') {
      await ctx.answerCbQuery('መጀመሪያ በ "አውጣ"  የገንዘብ ማውጣት ሂደትን ጀምር።');
      return;
    }
    ctx.session.withdrawMethod = 'telebirr';
    ctx.session.withdrawStep = 'details';
    await ctx.answerCbQuery();
    await ctx.reply('የቴሌብር ቁጥር አስገባ ገንዘቡን ለመቀበል።');
  } catch {
    try { await ctx.answerCbQuery('ዘዴ መምረጥ አልተሳካም።'); } catch {}
  }
});

bot.action('withdraw_method_cbe', async (ctx) => {
  try {
    if (!ctx.session || ctx.session.withdrawStep !== 'method') {
      await ctx.answerCbQuery('መጀመሪያ በ "አውጣ"  የገንዘብ ማውጣት ሂደትን ጀምር።');
      return;
    }
    ctx.session.withdrawMethod = 'cbe';
    ctx.session.withdrawStep = 'details';ቀ
    await ctx.answerCbQuery();
    await ctx.reply('የCBE ቁጥር አስገባ ገንዘቡን ለመቀበል።');
  } catch {
    try { await ctx.answerCbQuery('ዘዴ መምረጥ አልተሳካም።'); } catch {}
  }
});

bot.on('text', async (ctx, next) => {
  if (!ctx.session || (!ctx.session.withdrawStep && !ctx.session.depositStep)) return next();

  const text = ctx.message.text;

  if (ctx.session.withdrawStep === 'amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('❌  መጠን አስገባ።');
    }
    if (amount < ctx.session.minWithdrawal) {
      return ctx.reply(`❌ አነስተኛው የገንዘብ መጠን ${ctx.session.minWithdrawal} ብር ነው። እባክህ ከዚህ በላይ መጠን አስገባ።`);
    }
    if (amount > ctx.session.balance) {
      return ctx.reply(`❌ በቂ ሂሳብ የለህም። ሂሳብህ ${ctx.session.balance} ብር ነው። እባክህ ዝቅተኛ መጠን አስገባ።`);
    }

    ctx.session.withdrawAmount = amount;
    ctx.session.withdrawStep = 'method';
    return ctx.reply('የማውጫ ዘዴን ምረጥ፦', Markup.inlineKeyboard([
      [Markup.button.callback('Telebirr', 'withdraw_method_telebirr')],
      [Markup.button.callback('CBE', 'withdraw_method_cbe')]
    ]));
  }

  if (ctx.session.depositStep === 'amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 10) {
      return ctx.reply('❌ መጠን አስገባ (ቢያንስ 10 ብር)።');
    }
    ctx.session.depositAmount = amount;
    ctx.session.depositStep = 'screenshot';
    
    // Fetch settings for payment details
    const [settings] = await pool.query('SELECT k,v FROM settings');
    const sMap = {}; settings.forEach(r => sMap[r.k] = r.v);
    
    const message = `💳 ገንዘብ አስገባ ${amount} ብር\n\n` +
      `እባክህ ክፍያህን ወደ ከሚከተሉት መለያዎች ላክ፦\n` +
      `Telebirr: ${sMap.telebirr_number || '09XXXXXXXX'} (${sMap.telebirr_name || 'Name'})\n` +
      `CBE: ${sMap.cbe_account || '1000XXXXXXXX'} (${sMap.cbe_name || 'Name'})\n\n` +
      `ክፍያውን ካፈፀህ በኋላ የውሉ ስክሪንሾትን እዚህ ያስገባ።`;
    
    return ctx.reply(message);
  }

  if (ctx.session.withdrawStep === 'details') {
    const details = text;
    const amount = ctx.session.withdrawAmount;
    const method = ctx.session.withdrawMethod || 'telegram';

    try {
      const conn = await pool.getConnection();
      await conn.beginTransaction();
      
      try {
        const [balRows] = await conn.query('SELECT main_balance FROM wallets WHERE user_id=? FOR UPDATE', [ctx.state.user.id]);
        const current = balRows.length ? Number(balRows[0].main_balance) : 0;
        
        if (amount > current) {
          await conn.rollback(); conn.release();
          delete ctx.session.withdrawStep;
          return ctx.reply('❌ በቂ ሂሳብ የለህም። የማውጣት ጥያቄው ተሰርዟል።');
        }

        await conn.query(
          'INSERT INTO withdrawals (user_id, amount, method, receiver, status) VALUES (?, ?, ?, ?, "pending")',
          [ctx.state.user.id, amount, method, details]
        );

        await conn.query(
          'INSERT INTO transactions (user_id, type, amount, method, reference, status) VALUES (?, "withdrawal", ?, ?, ?, "pending")',
          [ctx.state.user.id, amount, method, details]
        );

        await conn.commit();
        conn.release();

        delete ctx.session.withdrawStep;
        delete ctx.session.withdrawAmount;
        delete ctx.session.withdrawMethod;
        ctx.reply(`✅ የማውጣት ጥያቄህ ተቀብሏል።\nመጠን፡ ${amount} ብር\nሁኔታ፡ ማረጋገጫ በመጠባበቅ ላይ።\nከተላከ በኋላ መልክት ይደርሰሀል።`, getMainKeyboard(ctx.from.id));
      } catch (e) {
        await conn.rollback();
        conn.release();
        throw e;
      }
    } catch (error) {
      console.error('Withdraw processing error:', error);
      ctx.reply('❌ የማውጣት ጥያቄህን ማስኬድ አልተሳካም። እባክህ በኋላ እንደገና ሞክር።');
    }
    return;
  }

  return next();
});

// Helper for sending notifications
export const sendBotNotification = async (telegramId, message) => {
  try {
    await bot.telegram.sendMessage(telegramId, message);
    return true;
  } catch (error) {
    console.error('Notification error:', error);
    return false;
  }
};

bot.command('invite', (ctx) => {
  const inviteLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
  ctx.reply(`ወዳጆችህን ጋብዝ እና ሽልማት አግኝ! \n\nመጋበዛክ:\n${inviteLink}`);
});

bot.hears('👥 ወዳጆችን ጋብዝ', (ctx) => {
  const inviteLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
  ctx.reply(`ወዳጆችህን ጋብዝ እና ሽልማት አግኝ! \n\nመጋበዛክ:\n${inviteLink}`);
});

bot.command('instruction', (ctx) => {
  ctx.reply('📖 መመሪያዎች፦\n1. መወራረጃ ይምረጡ።\n2. የቢንጎ ካርድዎን ይውሰዱ።\n3. ቁጥሮች ሲጠሩ ምልክት ያድርጉ።\n4. ቀድሞ ካርዱን የሞላ ያሸንፋል!');
});

bot.hears('ℹ️ መመሪያ', (ctx) => {
  ctx.reply('📖 መመሪያዎች፦\n1. መወራረጃ ይምረጡ።\n2. የቢንጎ ካርድዎን ይውሰዱ።\n3. ቁጥሮች ሲጠሩ ምልክት ያድርጉ።\n4. ቀድሞ  ካርዱን የሞላ ያሸንፋል!');
});

bot.command('game_pattern', (ctx) => {
  ctx.reply('🏁 የጨዋታ ዘዴዎች፦\n- አግድም መስመር (Horizontal)\n- ቁልቁል መስመር (Vertical)\n- የአግድም መስመር (Diagonal)\n- አራቱም ማእዘኖች\n- ሙሉ ካርድ (Full house)');
});

bot.hears('🏁 የጨዋታ አቀማመጦች', (ctx) => {
  ctx.reply('🏁 የጨዋታ ዘዴሆች፦\n- አግድም መስመር (Horizontal)\n- ቁልቁል መስመር (Vertical)\n- አግድም ስላሽ (Diagonal)');
});

bot.command('support', (ctx) => {
    ctx.reply('📞 ድጋፍ ለማግኘት፦ @BingoSupportBot ያነጋግሩ ወይም በ support@bingoapp.com ኢሜይል ያድርጉልን');
});

bot.hears('📞 ድጋፍ', (ctx) => {
  ctx.reply('📞 ድጋፍ ለማግኘት፦ @BingoSupportBot ያነጋግሩ ወይም በ support@bingoapp.com ኢሜይል ያድርጉልን');
});

export default bot;
