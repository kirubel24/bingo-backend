import { pool } from '../db.js'
import { getAllGames, createGame as createGameRoomSvc, setLocked as setRoomLocked, setStake as setRoomStake, setSettings as setRoomSettings, endGameNow } from '../services/gameService.js'
import { getIo } from '../socketRef.js'
import { sendBotNotification } from '../bot.js'

const log = async (adminId, action, targetType, targetId, details) => {
  await pool.query('INSERT INTO activity_logs (admin_id, action, target_type, target_id, details) VALUES (?,?,?,?,?)', [adminId, action, targetType, targetId, JSON.stringify(details || {})])
}

export const dashboard = async (req, res) => {
  try {
    const [u] = await pool.query('SELECT COUNT(*) AS total_users FROM users')
    const total_users = u[0]?.total_users || 0
    const [dd] = await pool.query('SELECT COALESCE(SUM(amount),0) AS total_deposits_today FROM deposits WHERE DATE(created_at)=CURDATE() AND status="approved"')
    const total_deposits_today = dd[0]?.total_deposits_today || 0
    const [wd] = await pool.query('SELECT COALESCE(SUM(amount),0) AS total_withdrawals_today FROM withdrawals WHERE DATE(created_at)=CURDATE() AND status="paid"')
    const total_withdrawals_today = wd[0]?.total_withdrawals_today || 0
    let total_wallets = 0
    const [wmc] = await pool.query("SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='wallets' AND COLUMN_NAME='main_balance'")
    if (wmc[0]?.c) {
      const [tw] = await pool.query('SELECT COALESCE(SUM(main_balance),0) AS total_wallets FROM wallets')
      total_wallets = tw[0]?.total_wallets || 0
    } else {
      total_wallets = 0
    }
    const [pd] = await pool.query('SELECT COUNT(*) AS pending_deposits FROM deposits WHERE status="pending"')
    const pending_deposits = pd[0]?.pending_deposits || 0
    const [pw] = await pool.query('SELECT COUNT(*) AS pending_withdrawals FROM withdrawals WHERE status="pending"')
    const pending_withdrawals = pw[0]?.pending_withdrawals || 0
    const activeRooms = Object.keys(getAllGames()).length
    res.json({ success: true, data: { total_users, total_deposits_today, total_withdrawals_today, total_wallets, active_rooms: activeRooms, pending_deposits, pending_withdrawals } })
  } catch (e) { res.status(500).json({ success:false, message:e.message }) }
}

export const listUsers = async (req, res) => {
  const { q, blocked, deactivated } = req.query || {}
  let sql = 'SELECT id, username, role, blocked, deactivated, banned_until, ban_reason FROM users WHERE 1=1'
  const params = []
  if (q) { sql += ' AND username LIKE ?'; params.push(`%${q}%`) }
  if (blocked != null) { sql += ' AND blocked=?'; params.push(blocked ? 1 : 0) }
  if (deactivated != null) { sql += ' AND deactivated=?'; params.push(deactivated ? 1 : 0) }
  const [rows] = await pool.query(sql, params)
  res.json({ success: true, users: rows })
}

export const updateUser = async (req, res) => {
  const id = req.params.id
  const { main_balance, role } = req.body
  if (main_balance != null) {
    await pool.query('INSERT INTO wallets (user_id, main_balance, bonus_balance) VALUES (?,?,0) ON DUPLICATE KEY UPDATE main_balance=?', [id, main_balance, main_balance])
  }
  if (role) {
    await pool.query('UPDATE users SET role=? WHERE id=?', [role, id])
  }
  await log(req.user.id, 'update_user', 'user', id, { main_balance, role })
  res.json({ success: true })
}

// Create a new user manually (admin)
export const addUser = async (req, res) => {
  const { username, password, role } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ success:false, message:'username and password required' })
  }
  const r = role && ['user','super_admin','finance_admin','support_admin'].includes(role) ? role : 'user'
  try {
    const [result] = await pool.query('INSERT INTO users (username, password, role, blocked, deactivated) VALUES (?,?,?,?,0)', [username, password, r, 0])
    const userId = result.insertId
    await pool.query('INSERT INTO wallets (user_id, main_balance, bonus_balance) VALUES (?,?,?)', [userId, 0, 0])
    await log(req.user.id, 'add_user', 'user', userId, { username, role: r })
    res.json({ success:true, id:userId })
  } catch (e) {
    res.status(500).json({ success:false, message:e.message })
  }
}

// Permanently delete a user (with confirmation on client side)
export const deleteUser = async (req, res) => {
  const id = req.params.id
  try {
    await pool.query('DELETE FROM wallets WHERE user_id=?', [id])
    await pool.query('DELETE FROM users WHERE id=?', [id])
    await log(req.user.id, 'delete_user', 'user', id, {})
    res.json({ success:true })
  } catch (e) {
    res.status(500).json({ success:false, message:e.message })
  }
}

export const blockUser = async (req, res) => {
  const id = req.params.id
  const { blocked } = req.body || { blocked: 1 }
  await pool.query('UPDATE users SET blocked=? WHERE id=?', [blocked ? 1 : 0, id])
  await log(req.user.id, 'block_user', 'user', id, { blocked })
  res.json({ success: true })
}

// Activate/Deactivate user (soft delete toggle)
export const setUserActive = async (req, res) => {
  const id = req.params.id
  const { deactivated } = req.body || {}
  const flag = deactivated ? 1 : 0
  await pool.query('UPDATE users SET deactivated=? WHERE id=?', [flag, id])
  await log(req.user.id, 'set_user_active', 'user', id, { deactivated: flag })
  res.json({ success:true })
}

// Ban user temporarily or permanently
export const banUser = async (req, res) => {
  const id = req.params.id
  const { until, reason } = req.body || {}
  // If until not provided, treat as permanent ban (NULL means no ban; set far future for permanent)
  let bannedUntil = null
  if (until) {
    bannedUntil = new Date(until)
    if (isNaN(bannedUntil.getTime())) return res.status(400).json({ success:false, message:'Invalid until datetime' })
  } else {
    bannedUntil = new Date('2999-12-31T23:59:59Z')
  }
  await pool.query('UPDATE users SET banned_until=?, ban_reason=? WHERE id=?', [bannedUntil, reason || null, id])
  await log(req.user.id, 'ban_user', 'user', id, { until: bannedUntil, reason: reason || null })
  res.json({ success:true })
}

// Remove ban
export const unbanUser = async (req, res) => {
  const id = req.params.id
  await pool.query('UPDATE users SET banned_until=NULL, ban_reason=NULL WHERE id=?', [id])
  await log(req.user.id, 'unban_user', 'user', id, {})
  res.json({ success: true })
}

export const listDeposits = async (req, res) => {
  const { status, method, user, days } = req.query
  let sql = 'SELECT d.*, u.username FROM deposits d JOIN users u ON u.id=d.user_id WHERE 1=1'
  const params = []
  if (status) { sql += ' AND d.status=?'; params.push(status) }
  if (method) { sql += ' AND d.method=?'; params.push(method) }
  if (user) { sql += ' AND d.user_id=?'; params.push(user) }
  if (days) { sql += ' AND d.created_at >= NOW() - INTERVAL ? DAY'; params.push(days) }
  sql += ' ORDER BY d.created_at DESC'
  const [rows] = await pool.query(sql)
  
  // Also fetch from deposit_requests if status is pending
  if (status === 'pending') {
    const [reqRows] = await pool.query(`
      SELECT dr.id, dr.user_id, dr.amount, dr.method, dr.screenshot_url as txid, dr.status, dr.created_at, u.username 
      FROM deposit_requests dr 
      JOIN users u ON dr.user_id = u.id 
      WHERE dr.status = 'pending'
    `)
    rows.push(...reqRows)
  }

  res.json({ success: true, deposits: rows })
}

export const approveDeposit = async (req, res) => {
  const id = req.params.id
  const adminId = req.user?.id ?? 0
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    
    // Check both tables
    let dep = null
    let table = 'deposits'
    
    const [rows] = await conn.query('SELECT * FROM deposits WHERE id=? AND status="pending" FOR UPDATE', [id])
    if (rows.length) {
      dep = rows[0]
    } else {
      const [reqRows] = await conn.query('SELECT * FROM deposit_requests WHERE id=? AND status="pending" FOR UPDATE', [id])
      if (reqRows.length) {
        dep = reqRows[0]
        table = 'deposit_requests'
      }
    }

    if (!dep) { await conn.rollback(); conn.release(); return res.status(400).json({ success: false, message: 'Already processed or not found' }) }

    await conn.query(`UPDATE ${table} SET status="approved"${table==='deposits'?', verified_at=NOW()':''} WHERE id=?`, [id])

    await conn.query('INSERT INTO wallets (user_id, main_balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE main_balance = main_balance + ?', [dep.user_id, dep.amount, dep.amount])

    const ref = table === 'deposits' ? dep.txid : 'Screenshot'
    await conn.query('INSERT INTO transactions (user_id, type, amount, status, method, reference) VALUES (?, "deposit", ?, "success", ?, ?)', [dep.user_id, dep.amount, dep.method || 'unknown', ref])
    
    // Notify via Bot
    const [uRows] = await conn.query('SELECT telegram_id FROM users WHERE id=?', [dep.user_id]);
    if (uRows[0]?.telegram_id) {
      await sendBotNotification(uRows[0].telegram_id, `🎉 የ ${dep.amount} ብር የመያዣ ጥያቄህ ተፀድቋል! ሂሳብህ ዘምኗል።`);
    }

    await conn.commit(); conn.release()
    await log(adminId, 'approve_deposit', 'deposit', id, { amount: dep.amount })
    res.json({ success: true })
  } catch (e) {
    try { await conn.rollback() } catch {}
    conn.release()
    res.status(500).json({ success: false, message: e.message })
  }
}

export const rejectDeposit = async (req, res) => {
  const id = req.params.id
  const adminId = req.user?.id ?? 0
  
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    
    let dep = null
    let table = 'deposits'
    
    const [rows] = await conn.query('SELECT * FROM deposits WHERE id=? AND status="pending" FOR UPDATE', [id])
    if (rows.length) {
      dep = rows[0]
    } else {
      const [reqRows] = await conn.query('SELECT * FROM deposit_requests WHERE id=? AND status="pending" FOR UPDATE', [id])
      if (reqRows.length) {
        dep = reqRows[0]
        table = 'deposit_requests'
      }
    }

    if (!dep) { await conn.rollback(); conn.release(); return res.status(400).json({ success: false, message: 'Already processed or not found' }) }

    await conn.query(`UPDATE ${table} SET status="rejected"${table==='deposits'?', verified_at=NOW()':''} WHERE id=?`, [id])
    
    // Notify via Bot
    const [uRows] = await conn.query('SELECT telegram_id FROM users WHERE id=?', [dep.user_id]);
    if (uRows[0]?.telegram_id) {
      await sendBotNotification(uRows[0].telegram_id, `❌ የ ${dep.amount} ብር የመያዣ ጥያቄህ ተደርሶታል።`);
    }

    await conn.commit(); conn.release()
    await log(adminId, 'reject_deposit', 'deposit', id, {})
    res.json({ success: true })
  } catch (e) {
    try { await conn.rollback() } catch {}
    conn.release()
    res.status(500).json({ success: false, message: e.message })
  }
}

// Telegram deposit requests
export const listDepositRequests = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT dr.*, u.username 
      FROM deposit_requests dr 
      JOIN users u ON dr.user_id = u.id 
      WHERE dr.status = 'pending' 
      ORDER BY dr.created_at DESC
    `)
    res.json({ success: true, deposits: rows })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const approveDepositRequest = async (req, res) => {
  const id = req.params.id
  const adminId = req.user?.id || 0
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query('SELECT * FROM deposit_requests WHERE id=? AND status="pending" FOR UPDATE', [id])
    if (!rows.length) { await conn.rollback(); conn.release(); return res.status(400).json({ success: false, message: 'Not found or already processed' }) }
    const dr = rows[0]

    await conn.query('UPDATE deposit_requests SET status="approved" WHERE id=?', [id])
    await conn.query('INSERT INTO wallets (user_id, main_balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE main_balance = main_balance + ?', [dr.user_id, dr.amount, dr.amount])
    await conn.query('INSERT INTO transactions (user_id, type, amount, status, method, reference) VALUES (?, "deposit", ?, "success", ?, "Request Approved")', [dr.user_id, dr.amount, dr.method || 'unknown'])
    
    // Notify via Bot if applicable
    const [uRows] = await conn.query('SELECT telegram_id FROM users WHERE id=?', [dr.user_id]);
    if (uRows[0]?.telegram_id) {
      await sendBotNotification(uRows[0].telegram_id, `🎉 የ ${dr.amount} ክፍያዎ ተቀብለናል! ሂሳብዎ ላይ ተጨምሯል። መልካም እድል!`);
    }

    await conn.commit()
    conn.release()
    await log(adminId, 'approve_deposit_request', 'deposit_request', id, { amount: dr.amount })
    res.json({ success: true })
  } catch (e) {
    await conn.rollback()
    conn.release()
    res.status(500).json({ success: false, message: e.message })
  }
}

export const rejectDepositRequest = async (req, res) => {
  const id = req.params.id
  const adminId = req.user?.id || 0
  try {
    const [rows] = await pool.query('SELECT * FROM deposit_requests WHERE id=? AND status="pending"', [id])
    if (!rows.length) return res.status(400).json({ success: false, message: 'Not found or already processed' })
    const dr = rows[0]

    await pool.query('UPDATE deposit_requests SET status="rejected" WHERE id=?', [id])
    
    // Notify via Bot if applicable
    const [uRows] = await pool.query('SELECT telegram_id FROM users WHERE id=?', [dr.user_id]);
    if (uRows[0]?.telegram_id) {
      await sendBotNotification(uRows[0].telegram_id, `❌ የ ${dr.amount} ክፍያዎ ውድቅ ተደርጓል። እባክዎ የላኩት ማስረጃ ትክክል መሆኑን ያረጋግጡ። ለተጨማሪ መረጃ የደንበኞች አገልግሎትን ያነጋግሩ።`);
    }

    await log(adminId, 'reject_deposit_request', 'deposit_request', id, {})
    res.json({ success: true })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const listWithdrawals = async (req, res) => {
  const { status, method, user, days } = req.query
  let sql = 'SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE 1=1'
  const params = []
  if (status) { sql += ' AND w.status=?'; params.push(status) }
  if (method) { sql += ' AND w.method=?'; params.push(method) }
  if (user) { sql += ' AND w.user_id=?'; params.push(user) }
  if (days) { sql += ' AND w.created_at >= NOW() - INTERVAL ? DAY'; params.push(days) }
  sql += ' ORDER BY w.created_at DESC'
  const [rows] = await pool.query(sql, params)
  res.json({ success: true, withdrawals: rows })
}

export const markWithdrawalPaid = async (req, res) => {
  const id = req.params.id
  const adminId = req.user?.id ?? 0
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query('SELECT * FROM withdrawals WHERE id=? AND status="pending" FOR UPDATE', [id])
    if (!rows.length) { await conn.rollback(); conn.release(); return res.status(400).json({ success: false, message: 'Already processed' }) }
    const w = rows[0]

    const [balRows] = await conn.query('SELECT main_balance FROM wallets WHERE user_id=? FOR UPDATE', [w.user_id])
    const current = balRows.length ? Number(balRows[0].main_balance) : 0
    if (w.amount > current) {
      await conn.rollback(); conn.release(); return res.status(400).json({ success: false, message: 'Insufficient balance' })
    }

    await conn.query('UPDATE withdrawals SET status="paid", processed_at=NOW() WHERE id=?', [id])
    await conn.query('UPDATE wallets SET main_balance = main_balance - ? WHERE user_id=?', [w.amount, w.user_id])
    await conn.query('UPDATE transactions SET status="paid" WHERE user_id=? AND type="withdrawal" AND reference=?', [w.user_id, w.receiver])
    
    // Notify via Bot if applicable
    const [uRows] = await conn.query('SELECT telegram_id FROM users WHERE id=?', [w.user_id]);
    if (uRows[0]?.telegram_id) {
      await sendBotNotification(uRows[0].telegram_id, `🎉 የ ${w.amount} ብር ማውጫዎ ተሳክቷል! ብሩ ወደ አካውንትዎ ተልኳል። እባክዎ ሂሳብዎን ያረጋግጡ።`);
    }

    await conn.commit(); conn.release()
    await log(adminId, 'withdraw_paid', 'withdrawal', id, { amount: w.amount })
    res.json({ success: true })
  } catch (e) {
    try { await conn.rollback() } catch {}
    conn.release()
    res.status(500).json({ success: false, message: e.message })
  }
}

export const rejectWithdrawal = async (req, res) => {
  const id = req.params.id
  const adminId = req.user?.id ?? 0
  const [rows] = await pool.query('SELECT * FROM withdrawals WHERE id=? AND status="pending"', [id])
  if (!rows.length) return res.status(400).json({ success: false, message: 'Already processed' })
  await pool.query('UPDATE withdrawals SET status="rejected", processed_at=NOW() WHERE id=?', [id])
  await pool.query('UPDATE transactions SET status="rejected" WHERE user_id=? AND type="withdrawal" AND reference=?', [rows[0].user_id, rows[0].receiver])
  
  // Notify via Bot if applicable
  const [uRows] = await pool.query('SELECT telegram_id FROM users WHERE id=?', [rows[0].user_id]);
  if (uRows[0]?.telegram_id) {
    await sendBotNotification(uRows[0].telegram_id, `❌ የ ${rows[0].amount} ብር ማውጫው አልተሳካም። የላኩት መረጃ ስህተት አለበት ወይም በቂ ሂሳብ የለዎትም። እባክዎ መረጃዎን አረጋግጠው ድጋሚ ይሞክሩ ወይም እርዳታ ይጠይቁ።`);
  }

  await log(adminId, 'withdraw_reject', 'withdrawal', id, {})
  res.json({ success: true })
}

export const getSettings = async (req, res) => {
  const [rows] = await pool.query('SELECT k,v FROM settings')
  const map = {}; rows.forEach(r => map[r.k] = r.v)
  res.json({ success: true, settings: map })
}

export const updateSettings = async (req, res) => {
  const adminId = req.user?.id ?? 0
  const entries = Object.entries(req.body || {})
  for (const [k,v] of entries) {
    await pool.query('INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=?', [k, v, v])
  }
  await log(adminId, 'update_settings', 'settings', '-', req.body)
  res.json({ success: true })
}

export const activityLogs = async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 200')
  res.json({ success: true, logs: rows })
}
export const adminLogin = async (req, res) => {
  const { username, password } = req.body || {}
  if (username !== 'admin' || password !== 'admin123') {
    return res.status(401).json({ success:false, message:'Invalid admin credentials' })
  }
  // Determine cookie attributes based on frontend origin for reliable cross-site usage
  let sameSite = 'lax'
  let secure = process.env.NODE_ENV === 'production'
  try {
    const origin = req.headers?.origin || ''
    if (origin) {
      const originUrl = new URL(origin)
      const isSameHost = originUrl.hostname === req.hostname
      // If frontend is on a different host (e.g. Vercel + separate API host),
      // we must use SameSite=None and Secure for the cookie to be sent
      if (!isSameHost) {
        sameSite = 'none'
        secure = true
      }
    }
  } catch {
    // Fallback to defaults above if origin parsing fails
  }
  res.cookie('admin_session', '1', {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  })
  res.json({ success:true })
}

// -------------------- Game Management --------------------
export const listGames = async (req, res) => {
  const games = getAllGames()
  const data = Object.entries(games).map(([id, g]) => ({
    id,
    players: g.players?.length || 0,
    started: !!g.started,
    locked: !!g.locked,
    stake: Number(g.stake || 0),
    type: g.type || null,
    maxPlayers: g.maxPlayers != null ? Number(g.maxPlayers) : null,
    calledNumbers: (g.calledNumbers || []).length
  }))
  res.json({ success:true, games: data })
}

export const createGameRoom = async (req, res) => {
  const { gameId, stake, maxPlayers, type } = req.body || {}
  if (!gameId) return res.status(400).json({ success:false, message:'gameId required' })
  const g = createGameRoomSvc(gameId)
  const settings = {}
  if (stake != null) settings.stake = Number(stake)
  if (maxPlayers != null) settings.maxPlayers = Number(maxPlayers)
  if (type) settings.type = String(type)
  if (Object.keys(settings).length) setRoomSettings(gameId, settings)
  await log(req.user.id, 'create_game_room', 'game', gameId, settings)
  const io = getIo(); if (io) io.emit('admin_game_created', { gameId, stake: Number(g.stake || 0) })
  res.json({ success:true })
}

export const lockRoom = async (req, res) => {
  const id = req.params.id
  const g = getAllGames()[id] || null
  if (g && g.locked) {
    return res.status(409).json({ success:false, message:'Already locked', game_state: 'locked' })
  }
  const locked = setRoomLocked(id, true)
  await log(req.user.id, 'lock_room', 'game', id, { locked })
  const io = getIo(); if (io) io.to(id).emit('room_locked', { gameId: id })
  res.json({ success:true, game_state: 'locked' })
}

export const unlockRoom = async (req, res) => {
  const id = req.params.id
  const g = getAllGames()[id] || null
  if (g && !g.locked) {
    return res.status(409).json({ success:false, message:'Already open', game_state: 'open' })
  }
  const locked = setRoomLocked(id, false)
  await log(req.user.id, 'unlock_room', 'game', id, { locked })
  const io = getIo(); if (io) io.to(id).emit('room_unlocked', { gameId: id })
  res.json({ success:true, game_state: 'open' })
}

export const endRoom = async (req, res) => {
  const id = req.params.id
  const ok = endGameNow(id)
  const io = getIo(); if (io) io.to(id).emit('game_end')
  await log(req.user.id, 'end_room', 'game', id, { ok })
  res.json({ success:true })
}

// Configure stake for a room
export const setRoomStakeAdmin = async (req, res) => {
  const id = req.params.id
  const { stake } = req.body || {}
  const s = Number(stake || 0)
  setRoomStake(id, s)
  await log(req.user.id, 'set_room_stake', 'game', id, { stake: s })
  const io = getIo(); if (io) io.to(id).emit('room_stake_set', { gameId: id, stake: s })
  res.json({ success:true })
}

export const setRoomSettingsAdmin = async (req, res) => {
  const id = req.params.id
  const { maxPlayers, type, stake } = req.body || {}
  const applied = setRoomSettings(id, { maxPlayers, type, stake })
  await log(req.user.id, 'set_room_settings', 'game', id, applied)
  const io = getIo(); if (io) io.to(id).emit('room_settings_set', { gameId: id, ...applied })
  res.json({ success:true, settings: applied })
}

// User transactions/history
export const getUserDetails = async (req, res) => {
  const id = req.params.id
  const [[user]] = await pool.query('SELECT id, username, role, blocked, deactivated, banned_until, ban_reason, created_at FROM users WHERE id=?', [id])
  if (!user) return res.status(404).json({ success:false, message:'User not found' })
  const [[wallet]] = await pool.query('SELECT main_balance, bonus_balance FROM wallets WHERE user_id=?', [id])
  res.json({ success:true, user, wallet: wallet || { main_balance:0, bonus_balance:0 } })
}

export const getUserTransactions = async (req, res) => {
  const id = req.params.id
  const { days, type } = req.query || {}
  let sql = 'SELECT id, type, amount, status, method, reference, created_at FROM transactions WHERE user_id=?'
  const params = [id]
  if (type) { sql += ' AND type=?'; params.push(type) }
  if (days) { sql += ' AND created_at >= NOW() - INTERVAL ? DAY'; params.push(days) }
  sql += ' ORDER BY created_at DESC'
  const [rows] = await pool.query(sql, params)
  res.json({ success:true, transactions: rows })
}

// Reports & Analytics
const groupExpr = (range) => {
  if (range === 'weekly') return 'YEARWEEK(created_at)'
  if (range === 'monthly') return "DATE_FORMAT(created_at,'%Y-%m')"
  return 'DATE(created_at)'
}

export const reportsSummary = async (req, res) => {
  const range = (req.query.range || 'daily').toLowerCase()
  const g = groupExpr(range)
  const [rev] = await pool.query(`SELECT ${g} AS bucket, COALESCE(SUM(amount),0) AS total FROM deposits WHERE status='approved' GROUP BY bucket ORDER BY bucket DESC LIMIT 90`)
  const [payouts] = await pool.query(`SELECT ${g} AS bucket, COALESCE(SUM(amount),0) AS total FROM withdrawals WHERE status='paid' GROUP BY bucket ORDER BY bucket DESC LIMIT 90`)
  const [bets] = await pool.query(`SELECT ${g} AS bucket, COALESCE(SUM(amount),0) AS total FROM transactions WHERE type='adjustment' AND method='stake' AND status IN ('success','approved','paid') GROUP BY bucket ORDER BY bucket DESC LIMIT 90`)
  const [growth] = await pool.query(`SELECT ${g} AS bucket, COUNT(*) AS total FROM users GROUP BY bucket ORDER BY bucket DESC LIMIT 90`)
  res.json({ success:true, range, revenue: rev, payouts, bets, user_growth: growth })
}

const toCsv = (rows) => {
  if (!rows || !rows.length) return 'bucket,total\n'
  const header = Object.keys(rows[0]).join(',')
  const body = rows.map(r => Object.values(r).join(',')).join('\n')
  return `${header}\n${body}`
}

export const exportReport = async (req, res) => {
  const range = (req.query.range || 'daily').toLowerCase()
  const type = (req.query.type || 'revenue').toLowerCase()
  const format = (req.query.format || 'csv').toLowerCase()
  const g = groupExpr(range)
  let rows = []
  if (type === 'revenue') {
    const [rev] = await pool.query(`SELECT ${g} AS bucket, COALESCE(SUM(amount),0) AS total FROM deposits WHERE status='approved' GROUP BY bucket ORDER BY bucket DESC LIMIT 365`)
    rows = rev
  } else if (type === 'payouts') {
    const [p] = await pool.query(`SELECT ${g} AS bucket, COALESCE(SUM(amount),0) AS total FROM withdrawals WHERE status='paid' GROUP BY bucket ORDER BY bucket DESC LIMIT 365`)
    rows = p
  } else if (type === 'bets') {
    const [b] = await pool.query(`SELECT ${g} AS bucket, COALESCE(SUM(amount),0) AS total FROM transactions WHERE type='adjustment' AND method='stake' AND status IN ('success','approved','paid') GROUP BY bucket ORDER BY bucket DESC LIMIT 365`)
    rows = b
  } else if (type === 'user_growth') {
    const [ug] = await pool.query(`SELECT ${g} AS bucket, COUNT(*) AS total FROM users GROUP BY bucket ORDER BY bucket DESC LIMIT 365`)
    rows = ug
  } else {
    return res.status(400).json({ success:false, message:'Invalid type' })
  }
  if (format === 'csv' || format === 'excel') {
    const csv = toCsv(rows)
    res.setHeader('Content-Type', format === 'excel' ? 'application/vnd.ms-excel' : 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${range}.csv"`)
    return res.send(csv)
  }
  res.json({ success:true, rows })
}
