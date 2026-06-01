'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, X, Pencil, Trash, Plus, Warning } from '@phosphor-icons/react'

interface CameraBagStyle {
  id: string
  name: string
  style: string
}

export default function SettingsPage() {
  // API Key state
  const [apiKeyStatus, setApiKeyStatus] = useState<'checking' | 'connected' | 'not_set' | 'invalid'>('checking')
  const [keyPreview, setKeyPreview] = useState('')
  const [testingConnection, setTestingConnection] = useState(false)

  // Camera Bag state
  const [styles, setStyles] = useState<CameraBagStyle[]>([])
  const [loadingStyles, setLoadingStyles] = useState(true)
  const [showNewStyleModal, setShowNewStyleModal] = useState(false)
  const [editingStyle, setEditingStyle] = useState<CameraBagStyle | null>(null)
  const [newStyleName, setNewStyleName] = useState('')
  const [newStyleValue, setNewStyleValue] = useState('')

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  // Danger zone state. Both actions require the user to type the
  // matching phrase before the button enables — defense against a stray
  // click wiping a project mid-job.
  const [showClearCanvasConfirm, setShowClearCanvasConfirm] = useState(false)
  const [showClearAssetsConfirm, setShowClearAssetsConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [canvasConfirmText, setCanvasConfirmText] = useState('')
  const [assetsConfirmText, setAssetsConfirmText] = useState('')
  const CLEAR_CANVAS_PHRASE = 'DELETE ALL CANVAS DATA'
  const CLEAR_ASSETS_PHRASE = 'DELETE ALL ASSETS'

  // Check API key on mount
  useEffect(() => {
    checkApiKey()
    loadCameraBag()
  }, [])

  const checkApiKey = async () => {
    try {
      const res = await fetch('/api/generate/test', { method: 'POST' })
      const data = await res.json()
      if (data.connected) {
        setApiKeyStatus('connected')
        setKeyPreview(data.keyPreview)
      } else if (data.error?.includes('not set')) {
        setApiKeyStatus('not_set')
      } else {
        setApiKeyStatus('invalid')
      }
    } catch {
      setApiKeyStatus('not_set')
    }
  }

  const testConnection = async () => {
    setTestingConnection(true)
    await checkApiKey()
    setTestingConnection(false)
  }

  const loadCameraBag = async () => {
    try {
      const res = await fetch('/api/settings/camera-bag')
      if (res.ok) {
        const data = await res.json()
        setStyles(data)
      }
    } catch (error) {
      console.error('Failed to load camera bag:', error)
    } finally {
      setLoadingStyles(false)
    }
  }

  const saveStyle = async () => {
    if (!newStyleName.trim() || !newStyleValue.trim()) return

    try {
      const res = await fetch('/api/settings/camera-bag', {
        method: editingStyle ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingStyle?.id,
          name: newStyleName,
          style: newStyleValue,
        }),
      })
      if (res.ok) {
        await loadCameraBag()
        closeModal()
      }
    } catch (error) {
      console.error('Failed to save style:', error)
    }
  }

  const deleteStyle = async (id: string) => {
    try {
      const res = await fetch('/api/settings/camera-bag', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        await loadCameraBag()
      }
    } catch (error) {
      console.error('Failed to delete style:', error)
    }
  }

  const closeModal = () => {
    setShowNewStyleModal(false)
    setEditingStyle(null)
    setNewStyleName('')
    setNewStyleValue('')
  }

  const openEditModal = (style: CameraBagStyle) => {
    setEditingStyle(style)
    setNewStyleName(style.name)
    setNewStyleValue(style.style)
    setShowNewStyleModal(true)
  }

  const handlePasswordChange = async () => {
    setPasswordError('')
    setPasswordSuccess(false)

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      return
    }

    setChangingPassword(true)
    try {
      const res = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (res.ok) {
        setPasswordSuccess(true)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setPasswordError(data.error || 'Failed to change password')
      }
    } catch {
      setPasswordError('Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  const clearAllCanvasData = async () => {
    if (canvasConfirmText !== CLEAR_CANVAS_PHRASE) return
    setClearing(true)
    try {
      const res = await fetch('/api/settings/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'canvas', confirm: canvasConfirmText }),
      })
      if (res.ok) {
        setShowClearCanvasConfirm(false)
        setCanvasConfirmText('')
      }
    } catch (error) {
      console.error('Failed to clear canvas data:', error)
    } finally {
      setClearing(false)
    }
  }

  const clearAllAssets = async () => {
    if (assetsConfirmText !== CLEAR_ASSETS_PHRASE) return
    setClearing(true)
    try {
      const res = await fetch('/api/settings/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'assets', confirm: assetsConfirmText }),
      })
      if (res.ok) {
        setShowClearAssetsConfirm(false)
        setAssetsConfirmText('')
      }
    } catch (error) {
      console.error('Failed to clear assets:', error)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="glass border-b border-border/50 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center justify-center w-8 h-8 rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} weight="thin" />
          </Link>
          <h1 className="text-lg font-serif tracking-tight">Settings</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">
        {/* fal.ai API Key Section */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">fal.ai API Key</h2>
          <div className="glass rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Connection Status</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {apiKeyStatus === 'checking' && 'Checking...'}
                  {apiKeyStatus === 'connected' && `Connected ${keyPreview}`}
                  {apiKeyStatus === 'not_set' && 'API key not configured'}
                  {apiKeyStatus === 'invalid' && 'Invalid API key'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {apiKeyStatus === 'connected' ? (
                  <span className="flex items-center gap-1.5 text-xs font-mono text-accent">
                    <Check size={14} weight="bold" /> Connected
                  </span>
                ) : apiKeyStatus === 'invalid' ? (
                  <span className="flex items-center gap-1.5 text-xs font-mono text-destructive">
                    <X size={14} weight="bold" /> Invalid key
                  </span>
                ) : null}
                <button
                  onClick={testConnection}
                  disabled={testingConnection}
                  className="px-3 py-1.5 text-xs font-mono rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {testingConnection ? 'Testing...' : 'Test Connection'}
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Add your fal.ai key to your Vercel project under{' '}
                <span className="text-foreground font-mono">Settings → Environment Variables → FAL_KEY</span>, then redeploy.
                The key is never sent to the browser — it lives only in Vercel&apos;s encrypted environment config.
              </p>
            </div>
          </div>
        </section>

        {/* Camera Bag Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Camera Bag</h2>
            <button
              onClick={() => setShowNewStyleModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus size={12} weight="bold" /> New Style
            </button>
          </div>
          <div className="glass rounded-xl divide-y divide-border/50">
            {loadingStyles ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading styles...</div>
            ) : styles.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No saved styles yet</div>
            ) : (
              styles.map(style => (
                <div key={style.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{style.name}</p>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{style.style}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(style)}
                      className="w-7 h-7 rounded-lg glass-hover flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil size={12} weight="thin" />
                    </button>
                    <button
                      onClick={() => deleteStyle(style.id)}
                      className="w-7 h-7 rounded-lg glass-hover flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash size={12} weight="thin" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Password Change Section */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">App Password</h2>
          <div className="glass rounded-xl p-6 space-y-4">
            <div className="space-y-3">
              <input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none transition-colors"
              />
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none transition-colors"
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none transition-colors"
              />
            </div>
            {passwordError && (
              <p className="text-xs text-destructive">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-xs text-accent">Password changed successfully</p>
            )}
            <button
              onClick={handlePasswordChange}
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="px-4 py-2 text-xs font-mono rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-destructive">Danger Zone</h2>
          <div className="glass rounded-xl border border-destructive/20 p-6 space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-foreground">Clear all canvas data</p>
                  <p className="text-xs text-muted-foreground mt-1">Delete all projects and pages from the database</p>
                </div>
                {!showClearCanvasConfirm && (
                  <button
                    onClick={() => setShowClearCanvasConfirm(true)}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Clear Data
                  </button>
                )}
              </div>
              {showClearCanvasConfirm && (
                <div className="flex flex-col gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/30">
                  <p className="text-xs text-muted-foreground">
                    Type <span className="font-mono text-destructive">{CLEAR_CANVAS_PHRASE}</span> to confirm:
                  </p>
                  <input
                    type="text"
                    value={canvasConfirmText}
                    onChange={(e) => setCanvasConfirmText(e.target.value)}
                    placeholder={CLEAR_CANVAS_PHRASE}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg bg-background border border-border/50 focus:border-destructive outline-none"
                    autoFocus
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => {
                        setShowClearCanvasConfirm(false)
                        setCanvasConfirmText('')
                      }}
                      className="px-3 py-1.5 text-xs font-mono rounded-lg glass-hover text-muted-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={clearAllCanvasData}
                      disabled={clearing || canvasConfirmText !== CLEAR_CANVAS_PHRASE}
                      className="px-3 py-1.5 text-xs font-mono rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {clearing ? 'Clearing...' : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border/50" />

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-foreground">Clear all assets</p>
                  <p className="text-xs text-muted-foreground mt-1">Delete all assets and their storage files</p>
                </div>
                {!showClearAssetsConfirm && (
                  <button
                    onClick={() => setShowClearAssetsConfirm(true)}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Clear Assets
                  </button>
                )}
              </div>
              {showClearAssetsConfirm && (
                <div className="flex flex-col gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/30">
                  <p className="text-xs text-muted-foreground">
                    Type <span className="font-mono text-destructive">{CLEAR_ASSETS_PHRASE}</span> to confirm:
                  </p>
                  <input
                    type="text"
                    value={assetsConfirmText}
                    onChange={(e) => setAssetsConfirmText(e.target.value)}
                    placeholder={CLEAR_ASSETS_PHRASE}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg bg-background border border-border/50 focus:border-destructive outline-none"
                    autoFocus
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => {
                        setShowClearAssetsConfirm(false)
                        setAssetsConfirmText('')
                      }}
                      className="px-3 py-1.5 text-xs font-mono rounded-lg glass-hover text-muted-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={clearAllAssets}
                      disabled={clearing || assetsConfirmText !== CLEAR_ASSETS_PHRASE}
                      className="px-3 py-1.5 text-xs font-mono rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {clearing ? 'Clearing...' : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* New/Edit Style Modal */}
      {showNewStyleModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-serif">{editingStyle ? 'Edit Style' : 'New Style'}</h3>
            <input
              type="text"
              placeholder="Style name"
              value={newStyleName}
              onChange={e => setNewStyleName(e.target.value)}
              className="w-full px-4 py-2.5 text-sm rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none transition-colors"
            />
            <textarea
              placeholder="Style string (e.g. 'cinematic still on ARRI Alexa, Cooke lenses, film grain...')"
              value={newStyleValue}
              onChange={e => setNewStyleValue(e.target.value)}
              rows={4}
              className="w-full px-4 py-2.5 text-sm rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none transition-colors resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-xs font-mono rounded-lg glass-hover text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={saveStyle}
                disabled={!newStyleName.trim() || !newStyleValue.trim()}
                className="px-4 py-2 text-xs font-mono rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                {editingStyle ? 'Save Changes' : 'Create Style'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
