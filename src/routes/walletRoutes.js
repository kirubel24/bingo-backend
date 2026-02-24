import express from 'express'
import { requireAuth } from '../middleware/auth.js'
import { createDeposit, getDepositStatus, createWithdrawal, getWithdrawalStatus, getPublicSettings, getOverview, getTransactions, listMyWithdrawals, applyStake, applyWinnerReward, applyStakeRefund, transferBalance, getLeaderboard, uploadScreenshot /*, applyBonus*/ } from '../controllers/walletController.js'
import multer from 'multer'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage() })

router.post('/deposit', requireAuth, createDeposit)
router.get('/deposit/:id', requireAuth, getDepositStatus)
router.post('/upload', requireAuth, upload.single('file'), uploadScreenshot)

router.post('/withdraw', requireAuth, createWithdrawal)
router.get('/withdraw/:id', requireAuth, getWithdrawalStatus)

router.get('/settings', getPublicSettings)

router.get('/overview', requireAuth, getOverview)
router.get('/transactions', requireAuth, getTransactions)
router.get('/withdrawals', requireAuth, listMyWithdrawals)
router.get('/leaderboard', getLeaderboard)
router.post('/transfer', requireAuth, transferBalance)

router.post('/stake', requireAuth, applyStake)
router.post('/win', requireAuth, applyWinnerReward)
router.post('/refund', requireAuth, applyStakeRefund)
// router.post('/bonus', requireAuth, applyBonus)

export default router
