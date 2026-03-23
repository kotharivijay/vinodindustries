import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100000

// Derive encryption key from password + salt
export function deriveKey(password: string, salt: string): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512')
}

// Generate a random salt
export function generateSalt(): string {
  return crypto.randomBytes(32).toString('hex')
}

// Generate a random IV
export function generateIV(): string {
  return crypto.randomBytes(IV_LENGTH).toString('hex')
}

// Encrypt text string
export function encrypt(text: string, key: Buffer, iv: string): string {
  const ivBuf = Buffer.from(iv, 'hex')
  const cipher = crypto.createCipheriv(ALGORITHM, key, ivBuf)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return authTag + ':' + encrypted
}

// Decrypt text string
export function decrypt(encryptedData: string, key: Buffer, iv: string): string {
  const ivBuf = Buffer.from(iv, 'hex')
  const [authTagHex, encHex] = encryptedData.split(':')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf)
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(encHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// Encrypt binary data (for files) — returns base64 string
export function encryptBuffer(data: Buffer, key: Buffer, iv: string): string {
  const ivBuf = Buffer.from(iv, 'hex')
  const cipher = crypto.createCipheriv(ALGORITHM, key, ivBuf)
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Store as: authTag(hex):encrypted(base64)
  return authTag.toString('hex') + ':' + encrypted.toString('base64')
}

// Decrypt binary data — returns Buffer
export function decryptBuffer(encryptedData: string, key: Buffer, iv: string): Buffer {
  const ivBuf = Buffer.from(iv, 'hex')
  const [authTagHex, encBase64] = encryptedData.split(':')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf)
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encBase64, 'base64')), decipher.final()])
  return decrypted
}

// Hash password for storage (using crypto, not bcrypt)
export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex')
}

// Verify password against hash
export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const computed = hashPassword(password, salt)
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'))
}
