import type { Session } from 'next-auth'

export function canEditIdentity(session: Session) {
  return session.user.role === 'manager'
}

export function canEditContact(session: Session, ownerId: string | null) {
  return session.user.role === 'manager' || session.user.employeeId === ownerId
}
