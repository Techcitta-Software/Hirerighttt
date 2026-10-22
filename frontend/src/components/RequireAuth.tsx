import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { requireApiForAuth } from '../lib/authConfig'
import {
  clearStoredAuth,
  isApiSessionValid,
  setAuthInvalidMessage,
} from '../lib/authSession'
import { ensureApiSession } from '../lib/apiSession'
import { getUser, type UserRole } from '../lib/store'

type Props = {
  children: ReactNode
  role?: UserRole | UserRole[]
}

const INVALID_MSG =
  'Your session expired or could not be verified. Please sign in again to continue.'

/**
 * Protected routes: local session + (when VITE_AUTH_PROVIDER=api) valid Bearer token via /api/me.
 */
export function RequireAuth({ children, role }: Props) {
  const location = useLocation()
  const [ready, setReady] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const user = getUser()
      if (!user) {
        if (!cancelled) {
          setAllowed(false)
          setReady(true)
        }
        return
      }

      if (requireApiForAuth()) {
        const valid = await isApiSessionValid()
        if (!valid) {
          clearStoredAuth()
          setAuthInvalidMessage(INVALID_MSG)
          if (!cancelled) {
            setAllowed(false)
            setReady(true)
          }
          return
        }
      } else {
        await ensureApiSession()
      }

      if (!cancelled) {
        setAllowed(true)
        setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
    // Validate once per mount; route changes reuse cached /api/me when still fresh.
  }, [])

  if (!ready) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }} role="status">
        Verifying your session…
      </div>
    )
  }

  const user = getUser()
  if (!user || !allowed) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname, reason: 'auth_required' }}
      />
    )
  }

  if (role) {
    const allowedRoles = Array.isArray(role) ? role : [role]
    const current = user.role ?? 'jobseeker'
    if (!allowedRoles.includes(current)) {
      return (
        <Navigate
          to={current === 'employer' ? '/employer/dashboard' : '/dashboard'}
          replace
        />
      )
    }
  }

  return <>{children}</>
}
