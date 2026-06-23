import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  acceptInvite as acceptInviteRequest,
  getMe,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession,
  register as registerRequest,
  type AcceptInvitePayload,
  type LoginPayload,
  type RegisterPayload,
} from '@/api/auth'
import { getAccessToken, getErrorMessage, setAccessToken } from '@/api/client'
import type { AuthUser } from '@/types/api'

interface AuthContextValue {
  user: AuthUser | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (payload: LoginPayload) => Promise<void>
  register: (payload: RegisterPayload) => Promise<void>
  acceptInvite: (payload: AcceptInvitePayload) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function hydrateProfile(token: string) {
  setAccessToken(token)
  return getMe()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [accessToken, setTokenState] = useState<string | null>(getAccessToken())
  const [isLoading, setIsLoading] = useState(true)

  const applySession = useCallback((token: string, nextUser: AuthUser) => {
    setAccessToken(token)
    setTokenState(token)
    setUser(nextUser)
  }, [])

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setTokenState(null)
    setUser(null)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const session = await refreshSession()
        if (cancelled) return
        const profile = await hydrateProfile(session.accessToken)
        if (cancelled) return
        applySession(session.accessToken, profile)
      } catch {
        if (!cancelled) clearSession()
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [applySession, clearSession])

  const login = useCallback(
    async (payload: LoginPayload) => {
      const session = await loginRequest(payload)
      const profile = await hydrateProfile(session.accessToken)
      applySession(session.accessToken, profile)
    },
    [applySession]
  )

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const session = await registerRequest(payload)
      const profile = await hydrateProfile(session.accessToken)
      applySession(session.accessToken, profile)
    },
    [applySession]
  )

  const acceptInvite = useCallback(
    async (payload: AcceptInvitePayload) => {
      const session = await acceptInviteRequest(payload)
      const profile = await hydrateProfile(session.accessToken)
      applySession(session.accessToken, profile)
    },
    [applySession]
  )

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } catch (error) {
      console.warn(getErrorMessage(error, 'Logout failed'))
    } finally {
      clearSession()
    }
  }, [clearSession])

  const refreshUser = useCallback(async () => {
    if (!getAccessToken()) return
    const profile = await getMe()
    setUser(profile)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      isAuthenticated: Boolean(user && accessToken),
      isLoading,
      login,
      register,
      acceptInvite,
      logout,
      refreshUser,
    }),
    [user, accessToken, isLoading, login, register, acceptInvite, logout, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
