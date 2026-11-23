import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { requireApiForAuth } from '../lib/authConfig'
import {
  clearStoredAuth,
  isApiSessionValid,
  sessionRecentlyValidated,
  setAuthInvalidMessage,
} from '../lib/authSession'
import { ensureApiSession } from '../lib/apiSession'
import { getUser, type UserRole } from '../lib/store'
import { PageLoader } from './SignalLoader'

type Props = {
  children: ReactNode
  role?: UserRole | UserRole[]
}

const INVALID_MSG =
  'Your session expired or could not be verified. Please sign in again to continue.'

/** Email of the user whose session was last verified in this tab. Lets later pages render straight away. */
let verifiedEmail: string | null = null

function alreadyVerified(): boolean {
  const email = getUser()?.email?.trim().toLowerCase()
  return Boolean(email && email === verifiedEmail)
}

/**
 * Protected routes: local session + (when VITE_AUTH_PROVIDER=api) valid Bearer token via /api/me.
 * The first protected page shows a loader while the session is checked; after that, pages render immediately and
 * the check re-runs in the background (redirecting to login if the session has since expired).
 */
export function RequireAuth({ children, role }: Props) {
  const location = useLocation()
  const [ready, setReady] = useState(alreadyVerified)
  const [allowed, setAllowed] = useState(alreadyVerified)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const user = getUser()
      if (!user) {
        verifiedEmail = null
        if (!cancelled) {
          setAllowed(false)
          setReady(true)
        }
        return
      }

      if (
        alreadyVerified() &&
        (!requireApiForAuth() || sessionRecentlyValidated())
      ) {
        verifiedEmail = user.email?.trim().toLowerCase() || null
        if (!cancelled) {
          setAllowed(true)
          setReady(true)
        }
        return
      }

      if (requireApiForAuth()) {
        const valid = await isApiSessionValid()
        if (!valid) {
          verifiedEmail = null
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

      verifiedEmail = user.email?.trim().toLowerCase() || null
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
      <PageLoader label="Verifying your session…" />
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
