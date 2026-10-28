import { NextResponse } from 'next/server'
import { endSession } from '@/lib/auth'

/** POST /api/auth/logout — delete session row + clear cookie. */
export async function POST() {
  await endSession()
  return NextResponse.json({ ok: true })
}
