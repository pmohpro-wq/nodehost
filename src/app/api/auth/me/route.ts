import { NextResponse } from 'next/server'
import { getSessionUser, needsFirstAdmin } from '@/lib/auth'

/**
 * GET /api/auth/me — current viewer (null for guests) + whether the
 * instance still awaits its first admin (drives the sign-up hint).
 */
export async function GET() {
  const user = await getSessionUser()
  return NextResponse.json({
    ok: true,
    user,
    firstUserPending: await needsFirstAdmin(),
  })
}
