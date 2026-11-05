import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { isAdminUser } from '../lib/adminAccess'

/** Renders children only for admin accounts; everyone else is sent to their dashboard. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  if (!isAdminUser()) return <Navigate to="/employer/dashboard" replace />
  return <>{children}</>
}
