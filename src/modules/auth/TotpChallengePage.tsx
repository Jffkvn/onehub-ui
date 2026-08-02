import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, AlertCircle, LogOut } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Input, FormGroup } from '@/components/ui/Input'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'

export function TotpChallengePage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  return (
    <AuthLayout
      eyebrow="Two-Step Verification"
      title="Enter authenticator code"
      description="Use the current 6-digit code from your enrolled authenticator app (e.g. Google Authenticator)."
    >
      <div className="space-y-4">
        <FormGroup label="Six-digit Security Code" error={error}>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            error={Boolean(error)}
            className="text-center font-mono text-lg tracking-widest"
          />
        </FormGroup>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-rose-tint p-3 text-xs text-rose">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          variant="primary"
          size="lg"
          loading={submitting}
          disabled={!auth.verifiedFactorId || code.length !== 6}
          onClick={() => {
            if (!auth.verifiedFactorId) return
            setSubmitting(true)
            setError('')
            auth
              .verifyTotp(auth.verifiedFactorId, code)
              .then(() => {
                auth.refreshSecurity()
                void navigate('/dashboard', { replace: true })
              })
              .catch(() => {
                setError('That code was not accepted. Wait for a new 30-second code and try again.')
              })
              .finally(() => {
                setSubmitting(false)
              })
          }}
          className="w-full"
          leftIcon={<KeyRound className="h-4 w-4" />}
        >
          Verify and continue
        </Button>

        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            void auth.signOut()
          }}
          className="w-full text-muted hover:text-ink"
          leftIcon={<LogOut className="h-4 w-4" />}
        >
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}
