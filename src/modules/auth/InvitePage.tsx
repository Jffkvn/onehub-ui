import { useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ShieldCheck, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Input, FormGroup } from '@/components/ui/Input'
import type { AuthSession } from './AuthGateway'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'

const passwordSchema = z
  .object({
    password: z.string().min(10, 'Use at least 10 characters.'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })

type PasswordValues = z.infer<typeof passwordSchema>

export function InvitePage() {
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash')
  const auth = useAuth()
  const navigate = useNavigate()
  const passwordId = useId()
  const confirmationId = useId()
  const pendingInvite = useRef<{ token: string; request: Promise<AuthSession> } | null>(null)
  const [inviteError, setInviteError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
  })

  async function activate({ password }: PasswordValues) {
    if (!tokenHash) return
    setInviteError('')
    const attempt = pendingInvite.current?.token === tokenHash
      ? pendingInvite.current
      : { token: tokenHash, request: auth.acceptInvite(tokenHash) }
    pendingInvite.current = attempt

    const invitedSession = await attempt.request.catch(() => null)
    if (!invitedSession) {
      pendingInvite.current = null
      setInviteError('This invitation link is invalid or has expired.')
      return
    }

    try {
      await auth.setInitialPassword(password, invitedSession.userId)
      void navigate('/', { replace: true })
    } catch {
      setInviteError('Your password could not be saved. Request a new invitation if this continues.')
    }
  }

  return (
    <AuthLayout
      eyebrow="OneHub invitation"
      title="Create your password"
      description="Choose a private password to finish activating your OneHub account."
    >
      {(!tokenHash || inviteError) && (
        <div className="flex items-center gap-2 rounded-md bg-rose-tint p-3 text-xs text-rose">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{inviteError || 'This invitation link is invalid or incomplete.'}</span>
        </div>
      )}

      {tokenHash && (
        <form className="space-y-4" onSubmit={(event) => { void handleSubmit(activate)(event) }}>
          <FormGroup label="New Password" htmlFor={passwordId} hint="At least 10 characters" error={errors.password?.message}>
            <Input
              id={passwordId}
              type="password"
              placeholder="••••••••••••"
              autoComplete="new-password"
              error={Boolean(errors.password)}
              {...register('password')}
            />
          </FormGroup>

          <FormGroup label="Confirm Password" htmlFor={confirmationId} error={errors.confirmPassword?.message}>
            <Input
              id={confirmationId}
              type="password"
              placeholder="••••••••••••"
              autoComplete="new-password"
              error={Boolean(errors.confirmPassword)}
              {...register('confirmPassword')}
            />
          </FormGroup>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={isSubmitting}
            className="w-full"
            leftIcon={<ShieldCheck className="h-4 w-4" />}
          >
            Activate account
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
