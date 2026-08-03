import DashboardClient from './DashboardClient'
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Category Inventory Pivot & Stock Coverage',
}

export default async function Page() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase())
  if (!allowedEmails.includes(user.email.toLowerCase())) {
    redirect('/login?error=unauthorized')
  }

  return <DashboardClient />
}
