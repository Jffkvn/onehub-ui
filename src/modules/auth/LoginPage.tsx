import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Lock, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Input, FormGroup } from '@/components/ui/Input'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid work email.'),
  password: z.string().min(1, 'Enter your password.'),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [submitError, setSubmitError] = useState('')

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard'

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  })

  useEffect(() => {
    if (auth.status === 'authenticated') void navigate(from, { replace: true })
    if (auth.status === 'mfa_enrollment_required') void navigate('/mfa/enroll', { replace: true })
    if (auth.status === 'mfa_challenge_required') void navigate('/mfa/challenge', { replace: true })
  }, [auth.status, navigate, from])

  return (
    <AuthLayout
      eyebrow="Secure Employee Portal"
      title="Welcome to OneHub"
      description="Sign in with your official Egypro Uganda enterprise account."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          void handleSubmit(async (values) => {
            setSubmitError('')
            try {
              await auth.signIn(values.email, values.password)
            } catch {
              setSubmitError('The email or password was not accepted. Please try again.')
            }
          })(e)
        }}
      >
        <FormGroup label="Work Email" hint="e.g. j.mukasa@egypro.co.ug" error={errors.email?.message}>
          <Input
            type="email"
            placeholder="name@egypro.co.ug"
            autoComplete="username"
            error={Boolean(errors.email)}
            {...register('email')}
          />
        </FormGroup>

        <FormGroup label="Password" error={errors.password?.message}>
          <Input
            type="password"
            placeholder="••••••••••••"
            autoComplete="current-password"
            error={Boolean(errors.password)}
            {...register('password')}
          />
        </FormGroup>

        {submitError && (
          <div className="flex items-center gap-2 rounded-md bg-rose-tint p-3 text-xs text-rose">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={isSubmitting}
          className="w-full"
          leftIcon={<Lock className="h-4 w-4" />}
        >
          Sign in securely
        </Button>
      </form>

      <p className="text-center font-body text-[11px] text-muted">
        Accounts are invitation-only. Contact HR if you need access restored.
      </p>
    </AuthLayout>
  )
}
