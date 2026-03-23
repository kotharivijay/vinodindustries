'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type EntityType = 'company' | 'person' | 'huf' | 'property'

interface Doc {
  id: number
  fileName: string
  tags: string
  description: string
  fileSize: number
  mimeType: string
  expiryDate: string | null
  createdAt: string
}

interface EntityData {
  id: number
  type: EntityType
  name: string
  details: Record<string, string>
  documents: Doc[]
  createdAt: string
}

const TYPE_LABELS: Record<EntityType, string> = { company: 'Company', person: 'Person', huf: 'HUF', property: 'Property' }
const TYPE_ICONS: Record<EntityType, string> = { company: '\u{1F3E2}', person: '\u{1F464}', huf: '\u{1F3E0}', property: '\u{1F3D7}' }

const DETAIL_FIELDS: Record<EntityType, { key: string; label: string }[]> = {
  company: [
    { key: 'pan', label: 'PAN' },
    { key: 'gst', label: 'GST' },
    { key: 'cin', label: 'CIN' },
    { key: 'address', label: 'Address' },
    { key: 'bank', label: 'Bank' },
    { key: 'notes', label: 'Notes' },
  ],
  person: [
    { key: 'pan', label: 'PAN' },
    { key: 'aadhaar', label: 'Aadhaar' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'address', label: 'Address' },
    { key: 'relation', label: 'Relation' },
    { key: 'notes', label: 'Notes' },
  ],
  huf: [
    { key: 'pan', label: 'PAN' },
    { key: 'karta', label: 'Karta' },
    { key: 'members', label: 'Members' },
    { key: 'address', label: 'Address' },
    { key: 'notes', label: 'Notes' },
  ],
  property: [
    { key: 'propertyType', label: 'Property Type' },
    { key: 'address', label: 'Address' },
    { key: 'surveyNo', label: 'Survey No / Khasra No' },
    { key: 'area', label: 'Area' },
    { key: 'areaUnit', label: 'Area Unit' },
    { key: 'ownerName', label: 'Owner Name' },
    { key: 'registrationNo', label: 'Registration No' },
    { key: 'registryDate', label: 'Registry Date' },
    { key: 'currentValue', label: 'Current Value (\u20B9)' },
    { key: 'notes', label: 'Notes' },
  ],
}

const ACCEPT_TYPES = '.pdf,.zip,.jpg,.jpeg,.png,.docx,.xlsx'

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function fileIcon(mime: string): string {
  if (mime.includes('pdf')) return '\u{1F4C4}'
  if (mime.includes('image') || mime.includes('jpg') || mime.includes('jpeg') || mime.includes('png')) return '\u{1F5BC}'
  if (mime.includes('spreadsheet') || mime.includes('xlsx') || mime.includes('excel')) return '\u{1F4CA}'
  if (mime.includes('word') || mime.includes('docx')) return '\u{1F4DD}'
  if (mime.includes('zip') || mime.includes('compressed')) return '\u{1F4E6}'
  return '\u{1F4C4}'
}

export default function VaultEntityView({ id }: { id: string }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [entity, setEntity] = useState<EntityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDetails, setEditDetails] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [unlockTime] = useState(Date.now())
  const [timeLeft, setTimeLeft] = useState('')

  // Upload form state
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTags, setUploadTags] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploadExpiry, setUploadExpiry] = useState('')

  const loadEntity = useCallback(async () => {
    try {
      const res = await fetch(`/api/vault/entities/${id}`)
      if (res.status === 403) { router.push('/vault'); return }
      if (!res.ok) { setError('Entity not found'); setLoading(false); return }
      const data = await res.json()
      setEntity(data)
      setEditName(data.name)
      setEditDetails(data.details || {})
    } catch {
      setError('Failed to load entity')
    }
    setLoading(false)
  }, [id, router])

  useEffect(() => {
    ;(async () => {
      // Check vault unlocked
      try {
        const res = await fetch('/api/vault/unlock')
        const data = await res.json()
        if (!data.unlocked) { router.push('/vault'); return }
      } catch { router.push('/vault'); return }
      loadEntity()
    })()
  }, [loadEntity, router])

  // Auto-lock timer
  useEffect(() => {
    const LOCK_DURATION = 15 * 60 * 1000
    const interval = setInterval(() => {
      const elapsed = Date.now() - unlockTime
      const remaining = Math.max(0, LOCK_DURATION - elapsed)
      if (remaining <= 0) {
        fetch('/api/vault/unlock', { method: 'DELETE' }).then(() => router.push('/vault'))
        clearInterval(interval)
        return
      }
      const mins = Math.floor(remaining / 60000)
      const secs = Math.floor((remaining % 60000) / 1000)
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [unlockTime, router])

  const handleSaveEdit = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/vault/entities/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, details: editDetails }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Save failed'); setSaving(false); return }
      setEditing(false)
      await loadEntity()
    } catch { setError('Network error') }
    setSaving(false)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { setError('File too large (max 25MB)'); return }
    setUploadFile(file)
    setShowUploadForm(true)
  }

  const handleUploadSubmit = async () => {
    if (!uploadFile) return
    setUploading(true)
    setError('')
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1]) // strip data:...;base64, prefix
        }
        reader.onerror = reject
        reader.readAsDataURL(uploadFile)
      })

      const res = await fetch('/api/vault/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: id,
          fileName: uploadFile.name,
          fileBase64: base64,
          mimeType: uploadFile.type || 'application/octet-stream',
          tags: uploadTags.trim() || undefined,
          description: uploadDescription.trim() || undefined,
          expiryDate: uploadExpiry || undefined,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Upload failed'); setUploading(false); return }
      setShowUploadForm(false)
      setUploadFile(null)
      setUploadTags('')
      setUploadDescription('')
      setUploadExpiry('')
      await loadEntity()
    } catch { setError('Upload failed') }
    setUploading(false)
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCancelUpload = () => {
    setShowUploadForm(false)
    setUploadFile(null)
    setUploadTags('')
    setUploadDescription('')
    setUploadExpiry('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDownload = async (docId: number, fileName: string) => {
    try {
      const res = await fetch(`/api/vault/documents/${docId}`)
      if (!res.ok) { setError('Download failed'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch { setError('Download failed') }
  }

  const handleDeleteDoc = async (docId: number) => {
    try {
      const res = await fetch(`/api/vault/documents/${docId}`, { method: 'DELETE' })
      if (!res.ok) { setError('Delete failed'); return }
      setDeleteConfirm(null)
      await loadEntity()
    } catch { setError('Delete failed') }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">{'\u{1F512}'}</div>
          <p className="text-amber-700 font-medium">Loading...</p>
        </div>
      </div>
    )
  }

  if (!entity) {
    return (
      <div className="min-h-screen bg-amber-50 p-4">
        <Link href="/vault" className="inline-flex items-center gap-2 bg-amber-100 text-amber-800 px-5 py-3 rounded-xl font-semibold text-base hover:bg-amber-200 transition mb-4">
          {'\u2190'} Back to Vault
        </Link>
        <div className="text-center py-16 text-red-600">
          <p className="font-medium">{error || 'Entity not found'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <div className="bg-white border-b border-amber-200 px-4 py-4 md:px-6 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3">
          <Link href="/vault" className="inline-flex items-center gap-2 bg-amber-100 text-amber-800 px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-amber-200 transition shrink-0">
            {'\u2190'} Back
          </Link>
          <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded-full font-medium shrink-0">
            {'\u{1F512}'} {timeLeft || '15:00'}
          </span>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 max-w-4xl mx-auto">
        {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

        {/* Entity header */}
        <div className="bg-white rounded-xl border border-amber-200 p-5 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">{TYPE_ICONS[entity.type]}</span>
            <div className="flex-1 min-w-0">
              {editing ? (
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full border border-amber-300 rounded-lg px-3 py-2 text-lg font-bold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              ) : (
                <h1 className="text-xl md:text-2xl font-bold text-gray-900 truncate">{entity.name}</h1>
              )}
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium mt-1 inline-block">
                {TYPE_LABELS[entity.type]}
              </span>
            </div>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="bg-amber-100 text-amber-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-amber-200 transition shrink-0"
              >
                {'\u270F\uFE0F'} Edit
              </button>
            )}
          </div>

          {/* Detail fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DETAIL_FIELDS[entity.type].map(f => {
              const val = editing ? (editDetails[f.key] || '') : (entity.details[f.key] || '')
              if (!editing && !val) return null
              return (
                <div key={f.key} className="bg-amber-50 rounded-lg p-3">
                  <p className="text-xs text-amber-600 font-medium mb-1">{f.label}</p>
                  {editing ? (
                    f.key === 'notes' || f.key === 'members' || f.key === 'address' ? (
                      <textarea
                        value={editDetails[f.key] || ''}
                        onChange={e => setEditDetails({ ...editDetails, [f.key]: e.target.value })}
                        rows={2}
                        className="w-full border border-amber-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none resize-none"
                      />
                    ) : f.key === 'propertyType' ? (
                      <select
                        value={editDetails[f.key] || ''}
                        onChange={e => setEditDetails({ ...editDetails, [f.key]: e.target.value })}
                        className="w-full border border-amber-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
                      >
                        <option value="">Select type...</option>
                        <option value="Residential">Residential</option>
                        <option value="Commercial">Commercial</option>
                        <option value="Industrial">Industrial</option>
                        <option value="Land">Land</option>
                        <option value="Plot">Plot</option>
                      </select>
                    ) : f.key === 'areaUnit' ? (
                      <select
                        value={editDetails[f.key] || ''}
                        onChange={e => setEditDetails({ ...editDetails, [f.key]: e.target.value })}
                        className="w-full border border-amber-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
                      >
                        <option value="">Select unit...</option>
                        <option value="sq ft">sq ft</option>
                        <option value="sq mt">sq mt</option>
                        <option value="bigha">bigha</option>
                        <option value="acre">acre</option>
                      </select>
                    ) : f.key === 'registryDate' ? (
                      <input
                        type="date"
                        value={editDetails[f.key] || ''}
                        onChange={e => setEditDetails({ ...editDetails, [f.key]: e.target.value })}
                        className="w-full border border-amber-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                      />
                    ) : (
                      <input
                        type="text"
                        value={editDetails[f.key] || ''}
                        onChange={e => setEditDetails({ ...editDetails, [f.key]: e.target.value })}
                        className="w-full border border-amber-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                      />
                    )
                  ) : (
                    <p className="text-sm text-gray-900 font-medium break-words">{val}</p>
                  )}
                </div>
              )
            })}
          </div>

          {editing && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="bg-amber-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-amber-700 transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => { setEditing(false); setEditName(entity.name); setEditDetails(entity.details || {}) }}
                className="bg-gray-200 text-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-300 transition"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Documents section */}
        <div className="bg-white rounded-xl border border-amber-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-amber-800">{'\u{1F4C2}'} Documents</h2>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_TYPES}
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="bg-amber-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700 transition disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : '+ Upload'}
              </button>
            </div>
          </div>

          {/* Upload form modal */}
          {showUploadForm && uploadFile && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{fileIcon(uploadFile.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{uploadFile.name}</p>
                  <p className="text-xs text-gray-500">{formatSize(uploadFile.size)}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-amber-700 mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={uploadTags}
                    onChange={e => setUploadTags(e.target.value)}
                    placeholder="e.g. aadhaar, id proof, kyc"
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={uploadDescription}
                    onChange={e => setUploadDescription(e.target.value)}
                    placeholder="e.g. Front and back scan of Aadhaar card"
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-700 mb-1">Expiry Date (optional)</label>
                  <input
                    type="date"
                    value={uploadExpiry}
                    onChange={e => setUploadExpiry(e.target.value)}
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleUploadSubmit}
                    disabled={uploading}
                    className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700 transition disabled:opacity-50"
                  >
                    {uploading ? 'Uploading...' : 'Upload Document'}
                  </button>
                  <button
                    onClick={handleCancelUpload}
                    className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {entity.documents.length === 0 ? (
            <div className="text-center py-10 text-amber-600">
              <div className="text-3xl mb-2">{'\u{1F4C4}'}</div>
              <p className="text-sm">No documents yet. Upload PDF, ZIP, JPG, PNG, DOCX, or XLSX files.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {entity.documents.map(doc => (
                <div key={doc.id} className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl shrink-0">{fileIcon(doc.mimeType)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{doc.fileName}</p>
                      {doc.tags && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {doc.tags.split(',').map((tag, i) => (
                            <span key={i} className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      )}
                      {doc.description && (
                        <p className="text-xs text-gray-500 mt-1">{doc.description}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        {formatSize(doc.fileSize)} {'\u00B7'} {new Date(doc.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                      {doc.expiryDate && (() => {
                        const days = Math.ceil((new Date(doc.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                        let cls = 'bg-green-50 text-green-700 border-green-200'
                        let label = `${days}d left`
                        if (days <= 0) { cls = 'bg-red-100 text-red-700 border-red-300'; label = 'EXPIRED' }
                        else if (days <= 15) { cls = 'bg-red-50 text-red-600 border-red-200'; label = `${days}d \u26A0` }
                        else if (days <= 30) { cls = 'bg-amber-50 text-amber-700 border-amber-200'; label = `${days}d` }
                        else if (days <= 60) { cls = 'bg-yellow-50 text-yellow-700 border-yellow-200'; label = `${days}d` }
                        return (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls} inline-block mt-1`}>
                            {new Date(doc.expiryDate).toLocaleDateString('en-IN')} ({label})
                          </span>
                        )
                      })()}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleDownload(doc.id, doc.fileName)}
                        className="bg-amber-100 text-amber-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-amber-200 transition"
                        title="Download"
                      >
                        {'\u2B07\uFE0F'} Download
                      </button>
                      {deleteConfirm === doc.id ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleDeleteDoc(doc.id)}
                            className="bg-red-600 text-white px-2 py-2 rounded-lg text-xs font-medium hover:bg-red-700 transition"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="bg-gray-200 text-gray-600 px-2 py-2 rounded-lg text-xs font-medium hover:bg-gray-300 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(doc.id)}
                          className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-xs font-medium hover:bg-red-100 transition"
                          title="Delete"
                        >
                          {'\u{1F5D1}'} Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
