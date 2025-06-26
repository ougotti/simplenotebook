import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const data = await request.json()
  console.log('Received note:', data)
  return NextResponse.json({ ok: true })
}
