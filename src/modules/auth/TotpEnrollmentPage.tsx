import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, KeyRound } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Input, FormGroup } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import type { TotpEnrollment } from './AuthGateway'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'

export function TotpEnrollmentPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [enrollment, setEnrollment] = useState<TotpEnrollment>()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const enrollmentRequest = useRef<Promise<TotpEnrollment> | undefined>(undefined)

  useEffect(() => {
    let active = true
    const request = enrollmentRequest.current ?? (enrollmentRequest.current = auth.enrollTotp())
    request
      .then((value) => {
        if (active) setEnrollment(value)
      })
      .catch(() => {
        if (active)
          setError('Authenticator setup could not be started. Sign out and try again.')
      })
    return () => {
      active = false
    }
  }, [auth])

  return (
    <AuthLayout
      eyebrow="Required Administrator Security"
      title="Protect your account"
      description="Scan this QR code with an authenticator app (e.g. Google Authenticator, 1Password), then enter its six-digit code."
    >
      {enrollment ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-canvas p-4 text-center">
            <img
              className="h-44 w-44 rounded-md border border-line bg-white p-2 shadow-xs"
              src={enrollment.qrCode}
              alt="Authenticator setup QR code"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSecret((curr) => !curr)}
              className="mt-3 text-xs text-muted hover:text-ink"
            >
              {showSecret ? 'Hide manual secret key' : 'Cannot scan? Show secret key'}
            </Button>

            {showSecret && (
              <code className="mt-2 rounded bg-surface px-2.5 py-1.5 font-mono text-xs text-emerald-600 select-all border border-line">
                {enrollment.secret}
              </code>
            )}
          </div>

          <FormGroup label="Six-digit Code" error={error}>
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
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={code.length !== 6}
            onClick={() => {
              setSubmitting(true)
              setError('')
              auth
                .verifyTotp(enrollment.factorId, code)
                .then(() => {
                  auth.refreshSecurity()
                  void navigate('/dashboard', { replace: true })
                })
                .catch(() => {
                  setError('That code was not accepted. Wait for a new code and try again.')
                })
                .finally(() => {
                  setSubmitting(false)
                })
            }}
            className="w-full"
            leftIcon={<KeyRound className="h-4 w-4" />}
          >
            Verify authenticator
          </Button>

          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              void auth.signOut()
            }}
            className="w-full text-muted hover:text-ink"
          >
            Sign out
          </Button>
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-md bg-rose-tint p-3 text-xs text-rose">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-6 space-y-3">
          <Skeleton shape="circle" className="h-10 w-10 border-2 border-emerald" />
          <p className="font-body text-xs text-soft animate-pulse">Preparing MFA enrolment key…</p>
        </div>
      )}
    </AuthLayout>
  )
}
