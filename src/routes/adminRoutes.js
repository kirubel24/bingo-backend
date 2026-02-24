import express from 'express'
import { requireAdminGate } from '../middleware/auth.js'
import { adminLogin, dashboard, listUsers, updateUser, addUser, deleteUser, blockUser, setUserActive, banUser, unbanUser, listDeposits, approveDeposit, rejectDeposit, listWithdrawals, markWithdrawalPaid, rejectWithdrawal, getSettings, updateSettings, activityLogs, listGames, createGameRoom, lockRoom, unlockRoom, endRoom, setRoomStakeAdmin, setRoomSettingsAdmin, getUserDetails, getUserTransactions, reportsSummary, exportReport, listDepositRequests, approveDepositRequest, rejectDepositRequest } from '../controllers/adminController.js'

const router = express.Router()

router.post('/login', adminLogin)
router.post('/logout', (req, res) => {
  // Use the same cookie attributes logic as login so the cookie is reliably cleared
  let sameSite = 'lax'
  let secure = process.env.NODE_ENV === 'production'
  try {
    const origin = req.headers?.origin || ''
    if (origin) {
      const originUrl = new URL(origin)
      const isSameHost = originUrl.hostname === req.hostname
      if (!isSameHost) {
        sameSite = 'none'
        secure = true
      }
    }
  } catch {
    // Fallback to defaults
  }
  res.clearCookie('admin_session', {
    httpOnly: true,
    sameSite,
    secure,
    path: '/'
  })
  res.json({ success: true, message: 'Logged out' })
})
router.use(requireAdminGate)

router.get('/dashboard', dashboard)

router.get('/users', listUsers)
router.patch('/users/:id', updateUser)
router.post('/users', addUser)
router.delete('/users/:id', deleteUser)
router.post('/users/:id/block', blockUser)
router.post('/users/:id/active', setUserActive)
router.post('/users/:id/ban', banUser)
router.post('/users/:id/unban', unbanUser)
router.get('/users/:id', getUserDetails)
router.get('/users/:id/transactions', getUserTransactions)

router.get('/deposits', listDeposits)
router.post('/deposits/:id/approve', approveDeposit)
router.post('/deposits/:id/reject', rejectDeposit)

router.get('/deposit-requests', listDepositRequests)
router.post('/deposit-requests/:id/approve', approveDepositRequest)
router.post('/deposit-requests/:id/reject', rejectDepositRequest)

router.get('/withdrawals', listWithdrawals)
router.post('/withdrawals/:id/paid', markWithdrawalPaid)
router.post('/withdrawals/:id/reject', rejectWithdrawal)

router.get('/settings', getSettings)
router.post('/settings', updateSettings)

router.get('/activity', activityLogs)

// Game management
router.get('/games', listGames)
router.post('/games', createGameRoom)
router.post('/games/:id/lock', lockRoom)
router.post('/games/:id/unlock', unlockRoom)
router.post('/games/:id/end', endRoom)
router.post('/games/:id/stake', setRoomStakeAdmin)
router.post('/games/:id/settings', setRoomSettingsAdmin)

export default router
router.get('/reports/summary', reportsSummary)
router.get('/reports/export', exportReport)
