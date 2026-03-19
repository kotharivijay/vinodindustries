'use client'

import { useState, useRef, useEffect } from 'react'

interface Option { id: number; name: string }

interface Props {
  options: Option[]
  value: number | null
  onChange: (id: number) => void
  onAddNew: (name: string) => Promise<Option>
  placeholder?: string
  disabled?: boolean
}

export default function ComboSelect({ options, value, onChange, onAddNew, placeholder = 'Select...', disabled }: Props) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.id === value)
  const filtered = options.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase())
  )
  const canAddNew =
    search.trim().length > 0 &&
    !filtered.find((o) => o.name.toLowerCase() === search.toLowerCase())

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100"
        value={open ? search : (selected?.name ?? '')}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => { setSearch(''); setOpen(true) }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-52 overflow-auto">
          {filtered.length === 0 && !canAddNew && (
            <div className="px-3 py-2 text-gray-400 text-sm">No results</div>
          )}
          {filtered.map((o) => (
            <div
              key={o.id}
              className={`px-3 py-2 cursor-pointer text-sm hover:bg-indigo-50 ${value === o.id ? 'bg-indigo-50 font-medium text-indigo-700' : ''}`}
              onMouseDown={() => { onChange(o.id); setOpen(false) }}
            >
              {o.name}
            </div>
          ))}
          {canAddNew && (
            <div
              className="px-3 py-2 text-indigo-600 hover:bg-indigo-50 cursor-pointer text-sm font-medium border-t flex items-center gap-2"
              onMouseDown={async () => {
                setLoading(true)
                try {
                  const item = await onAddNew(search.trim())
                  onChange(item.id)
                  setSearch('')
                  setOpen(false)
                } finally {
                  setLoading(false)
                }
              }}
            >
              {loading ? '...' : `+ Add "${search.trim()}"`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
