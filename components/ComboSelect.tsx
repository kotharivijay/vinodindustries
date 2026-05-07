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
  /**
   * If true and the operator types a name not in the list, leaving the field
   * (blur / Tab) auto-creates the master and selects it instead of
   * requiring a click on the "+ Add" row. Useful for free-form masters like
   * weavers where every new supplier is a legitimate addition.
   */
  autoCreateOnBlur?: boolean
}

export default function ComboSelect({ options, value, onChange, onAddNew, placeholder = 'Select...', disabled, autoCreateOnBlur }: Props) {
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
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100 dark:disabled:bg-gray-800"
        value={open ? search : (selected?.name ?? '')}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        // On focus, keep the selected name in the search box AND select all
        // text so the operator can either start typing (replaces) or arrow
        // through to refine — was clearing the field, which felt like the
        // selection was lost.
        onFocus={(e) => { setSearch(selected?.name ?? ''); setOpen(true); e.target.select() }}
        onBlur={async () => {
          // Leave a 150ms grace so a click on a dropdown row registers BEFORE
          // we react to the blur (otherwise mouse-down → blur → auto-create
          // races the click and creates a duplicate).
          if (!autoCreateOnBlur) return
          const trimmed = search.trim()
          if (!trimmed) return
          if (!canAddNew) return
          setLoading(true)
          try {
            const item = await onAddNew(trimmed)
            // Guard against APIs returning a non-Option shape (e.g. an error
            // body) — better to leave the field empty than crash the page.
            if (item && typeof item.id === 'number') {
              onChange(item.id)
              setSearch('')
              setOpen(false)
            }
          } catch {
            // Silent: surfaces in the parent's error path on save if it matters.
          } finally { setLoading(false) }
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-20 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg mt-1 max-h-52 overflow-auto">
          {filtered.length === 0 && !canAddNew && (
            <div className="px-3 py-2 text-gray-400 dark:text-gray-500 text-sm">No results</div>
          )}
          {filtered.map((o) => (
            <div
              key={o.id}
              className={`px-3 py-2 cursor-pointer text-sm text-gray-800 dark:text-gray-100 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 ${value === o.id ? 'bg-indigo-50 dark:bg-indigo-900/30 font-medium text-indigo-700 dark:text-indigo-400' : ''}`}
              onMouseDown={() => { onChange(o.id); setOpen(false) }}
            >
              {o.name}
            </div>
          ))}
          {canAddNew && (
            <div
              className="px-3 py-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 cursor-pointer text-sm font-medium border-t border-gray-200 dark:border-gray-700 flex items-center gap-2"
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
