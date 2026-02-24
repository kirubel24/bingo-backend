import { pool } from '../db.js'
import cloudinary from 'cloudinary'

const MIN_DEPOSIT = 10

export const uploadScreenshot = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' })
    
    // Convert buffer to base64 for Cloudinary
    const b64 = Buffer.from(req.file.buffer).toString('base64')
    const dataURI = "data:" + req.file.mimetype + ";base64," + b64
    
    const result = await cloudinary.v2.uploader.upload(dataURI, {
      folder: 'bingo_web_deposits'
    })
    
    res.json({ success: true, url: result.secure_url })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

export const createDeposit = async (req, res) => {
  try {
    const userId = req.user.id
    const [[ust]] = await pool.query('SELECT blocked, deactivated, banned_until FROM users WHERE id=?', [userId])
    const isDeactivated = Number(ust?.deactivated || 0) === 1
    const isBanned = ust?.banned_until ? new Date(ust.banned_until).getTime() > Date.now() : false
    if (isDeactivated || isBanned) return res.status(403).json({ success: false, message: 'Account is not allowed to deposit' })
    
    const { amount, method, screenshot_url } = req.body || {}
    if (!amount || Number(amount) < MIN_DEPOSIT) return res.status(400).json({ success: false, message: `Minimum deposit: ${MIN_DEPOSIT} ETB` })
    if (!method || !screenshot_url) return res.status(400).json({ success: false, message: 'Missing required fields (amount, method, screenshot_url)' })
    
    // limit attempts: 1 per user per X minutes
    const LIMIT_MINUTES = 3
    const [recent] = await pool.query('SELECT id FROM deposit_requests WHERE user_id=? AND created_at >= NOW() - INTERVAL ? MINUTE AND status="pending"', [userId, LIMIT_MINUTES])
    if (recent.length) return res.status(429).json({ success: false, message: `Please wait ${LIMIT_MINUTES} minutes before submitting another request` })
    
    const [ins] = await pool.query('INSERT INTO deposit_requests (user_id, amount, method, screenshot_url, status, source) VALUES (?,?,?,?,"pending","web")', [userId, amount, method, screenshot_url])
    res.json({ success: true, id: ins.insertId, status: 'pending' })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

export const getDepositStatus = async (req, res) => {
  try {
    const userId = req.user.id
    const id = req.params.id
    const [rows] = await pool.query('SELECT id, amount, method, status, created_at FROM deposit_requests WHERE id=? AND user_id=?', [id, userId])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' })
    res.json({ success: true, deposit: rows[0] })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const createWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id
    const [[ust]] = await pool.query('SELECT blocked, deactivated, banned_until FROM users WHERE id=?', [userId])
    const isBlocked = Number(ust?.blocked || 0) === 1
    const isDeactivated = Number(ust?.deactivated || 0) === 1
    const isBanned = ust?.banned_until ? new Date(ust.banned_until).getTime() > Date.now() : false
    if (isBlocked || isDeactivated || isBanned) return res.status(403).json({ success: false, message: 'Withdrawals are restricted for your account' })
    const { amount, method, receiver } = req.body || {}
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' })
    if (!method || !receiver) return res.status(400).json({ success: false, message: 'Missing fields' })
    const [bal] = await pool.query('SELECT main_balance FROM wallets WHERE user_id=?', [userId])
    const main = bal.length ? Number(bal[0].main_balance) : 0
    if (Number(amount) > main) return res.status(400).json({ success: false, message: 'Insufficient balance' })
    const [ins] = await pool.query('INSERT INTO withdrawals (user_id, amount, method, receiver, status) VALUES (?,?,?,?,"pending")', [userId, amount, method, receiver])
    await pool.query('INSERT INTO transactions (user_id, type, amount, method, reference, status) VALUES (?,?,?,?,?,"pending")', [userId, 'withdrawal', amount, method, receiver])
    res.json({ success: true, id: ins.insertId, status: 'pending' })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const getWithdrawalStatus = async (req, res) => {
  try {
    const userId = req.user.id
    const id = req.params.id
    const [rows] = await pool.query('SELECT id, amount, method, receiver, status, created_at, processed_at FROM withdrawals WHERE id=? AND user_id=?', [id, userId])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' })
    res.json({ success: true, withdrawal: rows[0] })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const getPublicSettings = async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT k,v FROM settings')
    const map = {}; rows.forEach(r => map[r.k] = r.v)
    res.json({ success: true, settings: map })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const getOverview = async (req, res) => {
  try {
    const userId = req.user.id
    const [[ust]] = await pool.query('SELECT blocked, deactivated, banned_until FROM users WHERE id=?', [userId])
    const isDeactivated = Number(ust?.deactivated || 0) === 1
    const isBanned = ust?.banned_until ? new Date(ust.banned_until).getTime() > Date.now() : false
    if (isDeactivated || isBanned) return res.status(403).json({ success: false, message: 'Account access restricted' })
    const [wb] = await pool.query('SELECT main_balance, bonus_balance FROM wallets WHERE user_id=?', [userId])
    const main_balance = wb.length ? Number(wb[0].main_balance) : 0
    const bonus_balance = wb.length ? Number(wb[0].bonus_balance) : 0
    const [td] = await pool.query('SELECT COALESCE(SUM(amount),0) AS s FROM deposits WHERE user_id=? AND status="approved"', [userId])
    const total_deposited = Number(td[0]?.s || 0)
    const [tw] = await pool.query('SELECT COALESCE(SUM(amount),0) AS s FROM withdrawals WHERE user_id=? AND status="paid"', [userId])
    const total_withdrawn = Number(tw[0]?.s || 0)
    const [pw] = await pool.query('SELECT COUNT(*) AS c FROM withdrawals WHERE user_id=? AND status="pending"', [userId])
    const pending_withdrawals = Number(pw[0]?.c || 0)
    const [lt] = await pool.query('SELECT id, type, amount, method AS provider, status, created_at FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 5', [userId])
    res.json({ success: true, overview: { main_balance, bonus_balance, total_deposited, total_withdrawn, pending_withdrawals, last_transactions: lt } })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const getTransactions = async (req, res) => {
  try {
    const userId = req.user.id
    const [[ust]] = await pool.query('SELECT deactivated, banned_until FROM users WHERE id=?', [userId])
    const isDeactivated = Number(ust?.deactivated || 0) === 1
    const isBanned = ust?.banned_until ? new Date(ust.banned_until).getTime() > Date.now() : false
    if (isDeactivated || isBanned) return res.status(403).json({ success: false, message: 'Account access restricted' })
    const filter = (req.query.filter || req.query.type || 'all').toLowerCase()
    let sql = 'SELECT id, type, amount, method AS provider, status, created_at FROM transactions WHERE user_id=?'
    const params = [userId]
    if (filter === 'withdrawal') { sql += ' AND type=?'; params.push('withdrawal') }
    else if (filter === 'deposit') { sql += ' AND type=?'; params.push('deposit') }
    else if (filter === 'bonus') { sql += ' AND type=?'; params.push('bonus') }
    else if (filter === 'win') { sql += ' AND type=? AND method=?'; params.push('adjustment', 'win') }
    else if (filter === 'purchase') { sql += ' AND type=? AND method=?'; params.push('adjustment', 'stake') }
    else if (filter === 'refund') { sql += ' AND type=? AND method=?'; params.push('adjustment', 'refund') }
    sql += ' ORDER BY created_at DESC LIMIT 200'
    const [rows] = await pool.query(sql, params)
    res.json({ success: true, transactions: rows })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const listMyWithdrawals = async (req, res) => {
  try {
    const userId = req.user.id
    const [[ust]] = await pool.query('SELECT deactivated, banned_until FROM users WHERE id=?', [userId])
    const isDeactivated = Number(ust?.deactivated || 0) === 1
    const isBanned = ust?.banned_until ? new Date(ust.banned_until).getTime() > Date.now() : false
    if (isDeactivated || isBanned) return res.status(403).json({ success: false, message: 'Account access restricted' })
    const status = (req.query.status || '').toLowerCase()
    let sql = 'SELECT id, amount, method, receiver, status, created_at, processed_at FROM withdrawals WHERE user_id=?'
    const params = [userId]
    if (status === 'pending' || status === 'paid' || status === 'rejected') { sql += ' AND status=?'; params.push(status) }
    sql += ' ORDER BY created_at DESC LIMIT 200'
    const [rows] = await pool.query(sql, params)
    res.json({ success: true, withdrawals: rows })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const applyStake = async (req, res) => {
  try {
    const userId = req.user.id
    const [[ust]] = await pool.query('SELECT blocked, deactivated, banned_until FROM users WHERE id=?', [userId])
    const isBlocked = Number(ust?.blocked || 0) === 1
    const isDeactivated = Number(ust?.deactivated || 0) === 1
    const isBanned = ust?.banned_until ? new Date(ust.banned_until).getTime() > Date.now() : false
    if (isBlocked || isDeactivated || isBanned) return res.status(403).json({ success: false, message: 'Purchases are restricted for your account' })
    const { amount, round_id } = req.body || {}
    const amt = Number(amount)
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' })
    if (round_id) {
      const [existing] = await pool.query('SELECT id FROM transactions WHERE user_id=? AND type="adjustment" AND method="stake" AND status IN ("success","approved","paid") AND reference=? LIMIT 1', [userId, String(round_id)])
      if (existing.length) {
        return res.json({ success: true })
      }
    }
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [rows] = await conn.query('SELECT main_balance FROM wallets WHERE user_id=? FOR UPDATE', [userId])
      const current = rows.length ? Number(rows[0].main_balance) : 0
      if (amt > current) {
        await conn.rollback(); conn.release()
        return res.status(400).json({ success: false, message: 'Insufficient balance' })
      }
      if (rows.length) {
        await conn.query('UPDATE wallets SET main_balance=main_balance-? WHERE user_id=?', [amt, userId])
      } else {
        await conn.query('INSERT INTO wallets (user_id, main_balance, bonus_balance) VALUES (?, ?, 0)', [userId, Math.max(0, current - amt)])
      }
      await conn.query('INSERT INTO transactions (user_id, type, amount, method, reference, status) VALUES (?,?,?,?,?,"success")', [userId, 'adjustment', amt, 'stake', round_id || null])
      await conn.commit(); conn.release()
      res.json({ success: true })
    } catch (e) { try { await conn.rollback() } catch {} conn.release(); throw e }
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const applyWinnerReward = async (req, res) => {
  try {
    const userId = req.user.id
    const [[ust]] = await pool.query('SELECT deactivated, banned_until FROM users WHERE id=?', [userId])
    const isDeactivated = Number(ust?.deactivated || 0) === 1
    const isBanned = ust?.banned_until ? new Date(ust.banned_until).getTime() > Date.now() : false
    if (isDeactivated || isBanned) return res.status(403).json({ success: false, message: 'Account access restricted' })
    const { amount, round_id } = req.body || {}
    const amt = Number(amount)
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' })
    if (round_id) {
      const [existing] = await pool.query('SELECT id FROM transactions WHERE user_id=? AND type="adjustment" AND method="win" AND status IN ("success","approved","paid") AND reference=? LIMIT 1', [userId, String(round_id)])
      if (existing.length) {
        return res.json({ success: true })
      }
    }
    const [r] = await pool.query('UPDATE wallets SET main_balance=main_balance+? WHERE user_id=?', [amt, userId])
    if (!r.affectedRows) {
      await pool.query('INSERT INTO wallets (user_id, main_balance, bonus_balance) VALUES (?,?,0)', [userId, amt])
    }
    await pool.query('INSERT INTO transactions (user_id, type, amount, method, reference, status) VALUES (?,?,?,?,?,"success")', [userId, 'adjustment', amt, 'win', round_id || null])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const applyStakeRefund = async (req, res) => {
  try {
    const userId = req.user.id
    const { amount, round_id, room_id } = req.body || {}
    const amt = Number(amount)
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' })
    if (round_id) {
      const [refExisting] = await pool.query('SELECT id FROM transactions WHERE user_id=? AND type="adjustment" AND method="refund" AND status IN ("success","approved","paid") AND reference=? LIMIT 1', [userId, String(round_id)])
      if (refExisting.length) {
        return res.json({ success: true })
      }
      const [stakeExisting] = await pool.query('SELECT id FROM transactions WHERE user_id=? AND type="adjustment" AND method="stake" AND status IN ("success","approved","paid") AND reference=? LIMIT 1', [userId, String(round_id)])
      if (!stakeExisting.length) {
        return res.status(400).json({ success: false, message: 'No stake found for round' })
      }
    }
    if (room_id != null) {
      try {
        const { getGame } = await import('../services/gameService.js')
        const g = getGame(String(room_id))
        if (g && g.started) {
          return res.status(409).json({ success: false, message: 'Game already started' })
        }
      } catch {}
    }
    const [r] = await pool.query('UPDATE wallets SET main_balance=main_balance+? WHERE user_id=?', [amt, userId])
    if (!r.affectedRows) {
      await pool.query('INSERT INTO wallets (user_id, main_balance, bonus_balance) VALUES (?,?,0)', [userId, amt])
    }
    await pool.query('INSERT INTO transactions (user_id, type, amount, method, reference, status) VALUES (?,?,?,?,?,"success")', [userId, 'adjustment', amt, 'refund', round_id || null])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}

export const transferBalance = async (req, res) => {
  try {
    const fromUserId = req.user.id
    const { toUsername, amount } = req.body || {}
    const amt = Number(amount)

    if (!toUsername || !amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid recipient or amount' })
    }

    const [[ust]] = await pool.query('SELECT blocked, deactivated, banned_until FROM users WHERE id=?', [fromUserId])
    if (ust?.blocked || ust?.deactivated || (ust?.banned_until && new Date(ust.banned_until) > new Date())) {
      return res.status(403).json({ success: false, message: 'Transfers are restricted for your account' })
    }

    const [recipients] = await pool.query('SELECT id FROM users WHERE username = ?', [toUsername])
    if (recipients.length === 0) {
      return res.status(404).json({ success: false, message: 'Recipient not found' })
    }
    const toUserId = recipients[0].id

    if (fromUserId === toUserId) {
      return res.status(400).json({ success: false, message: 'Cannot transfer to yourself' })
    }

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [bal] = await conn.query('SELECT main_balance FROM wallets WHERE user_id = ? FOR UPDATE', [fromUserId])
      const current = bal.length ? Number(bal[0].main_balance) : 0

      if (amt > current) {
        await conn.rollback(); conn.release()
        return res.status(400).json({ success: false, message: 'Insufficient balance' })
      }

      await conn.query('UPDATE wallets SET main_balance = main_balance - ? WHERE user_id = ?', [amt, fromUserId])
      const [updateTo] = await conn.query('UPDATE wallets SET main_balance = main_balance + ? WHERE user_id = ?', [amt, toUserId])
      if (!updateTo.affectedRows) {
        await conn.query('INSERT INTO wallets (user_id, main_balance, bonus_balance) VALUES (?, ?, 0)', [toUserId, amt])
      }

      await conn.query('INSERT INTO transactions (user_id, type, amount, method, reference, status) VALUES (?, "adjustment", ?, "transfer_out", ?, "success")', [fromUserId, amt, toUsername])
      await conn.query('INSERT INTO transactions (user_id, type, amount, method, reference, status) VALUES (?, "adjustment", ?, "transfer_in", ?, "success")', [toUserId, amt, req.user.username])

      await conn.commit(); conn.release()
      res.json({ success: true, message: 'Transfer successful' })
    } catch (e) {
      try { await conn.rollback() } catch {}
      conn.release()
      throw e
    }
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

export const getLeaderboard = async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.username, w.main_balance 
      FROM users u 
      JOIN wallets w ON u.id = w.user_id 
      ORDER BY w.main_balance DESC 
      LIMIT 10
    `)
    res.json({ success: true, leaderboard: rows })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

export const applyBonus = async (req, res) => {
  try {
    const userId = req.user.id
    const [[ust]] = await pool.query('SELECT deactivated, banned_until FROM users WHERE id=?', [userId])
    const isDeactivated = Number(ust?.deactivated || 0) === 1
    const isBanned = ust?.banned_until ? new Date(ust.banned_until).getTime() > Date.now() : false
    if (isDeactivated || isBanned) return res.status(403).json({ success: false, message: 'Account access restricted' })
    const { amount, source } = req.body || {}
    const amt = Number(amount)
    const src = String(source || 'bonus')
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' })
    const [r] = await pool.query('UPDATE wallets SET bonus_balance=bonus_balance+? WHERE user_id=?', [amt, userId])
    if (!r.affectedRows) {
      await pool.query('INSERT INTO wallets (user_id, main_balance, bonus_balance) VALUES (?,?,?)', [userId, 0, amt])
    }
    await pool.query('INSERT INTO transactions (user_id, type, amount, method, status) VALUES (?,?,?,?,"success")', [userId, 'bonus', amt, src])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ success: false, message: e.message }) }
}
