import { PrismaClient } from '@prisma/client'

/**
 * Dedicated Prisma client that talks to the Neon pre-migration DB, now
 * repurposed as a backup target. Uses NEON_DATABASE_URL (set in Vercel env).
 *
 * Supabase and Neon share the same Prisma schema (we just ran prisma db push
 * against Neon) so the same client code works against both.
 */
const globalForNeon = globalThis as unknown as { neonPrisma: PrismaClient }

export const neonPrisma =
  globalForNeon.neonPrisma ??
  new PrismaClient({
    datasources: {
      db: { url: process.env.NEON_DATABASE_URL || '' },
    },
    log: ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForNeon.neonPrisma = neonPrisma
