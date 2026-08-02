import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ShieldCheck, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Input, FormGroup } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
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
  const [accepted, setAccepted] = useState(false)
  const [inviteError, setInviteError] = useState(
    tokenHash ? '' : 'This invitation link is invalid or incomplete.',
  )

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
  })

  useEffect(() => {
    if (!tokenHash) return
    let active = true
    auth
      .acceptInvite(tokenHash)
      .then(() => {
        if (active) setAccepted(true)
      })
      .catch(() => {
        if (active) setInviteError('This invitation link is invalid or has expired.')
      })
    return () => {
      active = false
    }
  }, [auth, tokenHash])

  return (
    <AuthLayout
      eyebrow="Invitation Accepted"
      title="Create your password"
      description="Choose a private password to finish activating your OneHub account."
    >
      {inviteError && (
        <div className="flex items-center gap-2 rounded-md bg-rose-tint p-3 text-xs text-rose">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{inviteError}</span>
        </div>
      )}

      {accepted ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            void handleSubmit(async ({ password }) => {
              setInviteError('')
              try {
                await auth.setInitialPassword(password)
                void navigate('/dashboard', { replace: true })
              } catch {
                setInviteError(
                  'Your password could not be saved. Request a new invitation if this continues.',
                )
              }
            })(e)
          }}
        >
          <FormGroup label="New Password" hint="At least 10 characters" error={errors.password?.message}>
            <Input
              type="password"
              placeholder="••••••••••••"
              autoComplete="new-password"
              error={Boolean(errors.password)}
              {...register('password')}
            />
          </FormGroup>

          <FormGroup label="Confirm Password" error={errors.confirmPassword?.message}>
            <Input
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
      ) : !inviteError ? (
        <div className="flex flex-col items-center justify-center p-6 space-y-3">
          <Skeleton shape="circle" className="h-10 w-10 border-2 border-emerald" />
          <p className="font-body text-xs text-soft animate-pulse">Checking invitation details…</p>
        </div>
      ) : null}
    </AuthLayout>
  )
}
