import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const data = await request.json()
  // TODO: persist note data
  return NextResponse.json({ ok: true, data }, { status: 201 })
}
