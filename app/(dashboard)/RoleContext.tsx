'use client'

import { createContext, useContext } from 'react'

type Role = 'admin' | 'ksi'

const RoleContext = createContext<Role>('admin')

export function RoleProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>
}

export function useRole() {
  return useContext(RoleContext)
}
