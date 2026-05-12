import { Router } from 'express'

// Modules will be imported here as they are built
import { authRouter } from '../modules/auth/auth.router'
import { usersRouter } from '../modules/users/users.router'
import { leadsRouter } from '../modules/leads/leads.router'
import { invitesRouter } from '@/modules/invites/invites.router'
// import { dealsRouter } from '../modules/deals/deals.router'
// import { documentsRouter } from '../modules/documents/documents.router'

export const router = Router()

router.use('/auth', authRouter)
router.use('/users', usersRouter)
router.use('/leads', leadsRouter)
router.use('/invites', invitesRouter)
// router.use('/deals', dealsRouter)
// router.use('/documents', documentsRouter)

// Placeholder until modules are built
router.get('/', (_req, res) => {
  res.json({ message: 'Sellora API v1' })
})