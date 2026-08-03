'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function LoginForm({ errorMessage }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(errorMessage || '')
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid #E7E9F3',
      borderRadius: '14px',
      padding: '32px',
      boxShadow: '0 1px 2px rgba(20,20,43,.04), 0 8px 24px -12px rgba(20,20,43,.12)',
      width: '100%',
      maxWidth: '400px',
      boxSizing: 'border-box'
    }}>
      <div style={{
        width: '42px', height: '42px', borderRadius: '11px',
        background: 'linear-gradient(135deg,#6C5CE7,#5B4FE9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 1px 2px rgba(20,20,43,.04), 0 8px 24px -12px rgba(20,20,43,.12)',
        marginBottom: '16px'
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>
      </div>
      <h1 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 8px 0', color: '#1B1E2B' }}>Sign In</h1>
      <p style={{ color: '#6B7089', fontSize: '13px', margin: '0 0 24px 0' }}>Enter your authorized email to view the dashboard.</p>

      {error && <div style={{ background: '#FDECEC', color: '#DC2626', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', border: '1px solid #F7CFCF' }}>{error}</div>}

      <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#6B7089', marginBottom: '6px', textTransform: 'uppercase' }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ boxSizing: 'border-box', width: '100%', border: '1px solid #E7E9F3', borderRadius: '9px', padding: '9px 11px', fontSize: '13px', background: '#FBFBFE', color: '#1B1E2B' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#6B7089', marginBottom: '6px', textTransform: 'uppercase' }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ boxSizing: 'border-box', width: '100%', border: '1px solid #E7E9F3', borderRadius: '9px', padding: '9px 11px', fontSize: '13px', background: '#FBFBFE', color: '#1B1E2B' }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{
            background: '#5B4FE9', color: '#fff', border: 'none', borderRadius: '9px', padding: '10px 14px', fontSize: '13px', fontWeight: '700', cursor: loading ? 'wait' : 'pointer', marginTop: '8px'
          }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
