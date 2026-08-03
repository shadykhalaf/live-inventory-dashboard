import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import LoginForm from './LoginForm'

export default async function LoginPage({ searchParams }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user && searchParams?.error !== 'unauthorized') {
    return redirect('/')
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#F5F6FB',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif',
      padding: '24px',
      boxSizing: 'border-box'
    }}>
      <LoginForm errorMessage={searchParams?.error === 'unauthorized' ? 'Your email is not authorized to access this dashboard.' : ''} />
    </div>
  )
}
