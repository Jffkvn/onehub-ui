import { describe, expect, it, beforeEach, vi } from 'vitest'
import { getSupabaseClient } from './client'

describe('getSupabaseClient', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://sewbxazwpjbtevckorbl.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'valid-anon-key')
  })

  it('constructs client instance when valid environment variables exist', () => {
    const client = getSupabaseClient()
    expect(client).toBeDefined()
  })
})
