const vaultSessions = new Map<string, { key: Buffer; expiresAt: number }>()

const VAULT_TIMEOUT = 15 * 60 * 1000 // 15 minutes

export function setVaultKey(userEmail: string, key: Buffer): void {
  vaultSessions.set(userEmail, { key, expiresAt: Date.now() + VAULT_TIMEOUT })
}

export function getVaultKey(userEmail: string): Buffer | null {
  const session = vaultSessions.get(userEmail)
  if (!session) return null
  if (Date.now() > session.expiresAt) {
    vaultSessions.delete(userEmail)
    return null
  }
  // Refresh timeout on access
  session.expiresAt = Date.now() + VAULT_TIMEOUT
  return session.key
}

export function clearVaultKey(userEmail: string): void {
  vaultSessions.delete(userEmail)
}

export function isVaultUnlocked(userEmail: string): boolean {
  return getVaultKey(userEmail) !== null
}
