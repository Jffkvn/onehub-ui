import { useState } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { FormGroup, Textarea } from '@/components/ui/Input'
import { useApprovePayrollRun } from '../api/payroll'
import type { PayrollRun } from '@/_contract/types/payroll.types'

export interface ApprovePayrollModalProps {
  run: PayrollRun
  open: boolean
  onOpenChange: (open: boolean) => void
  onApproved?: () => void
}

export function ApprovePayrollModal({
  run,
  open,
  onOpenChange,
  onApproved,
}: ApprovePayrollModalProps) {
  const [reason, setReason] = useState('')
  const approveMutation = useApprovePayrollRun()

  const isValid = reason.trim().length >= 3

  const handleSubmit = async () => {
    if (!isValid) return
    try {
      await approveMutation.mutateAsync({
        id: run.id,
        reason: reason.trim(),
      })
      onOpenChange(false)
      onApproved?.()
    } catch {
      // Handled by mutation state
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-tint text-amber shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-ink">
              Approve &amp; Lock Payroll Run
            </h2>
            <p className="font-body text-xs text-soft">
              {run.periodLabel} · Run #{run.runNumber} ({run.items.length} employees)
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-amber/30 bg-amber-tint/40 p-3 text-xs text-ink space-y-1">
          <p className="font-semibold text-amber">Permanent Action Warning</p>
          <p className="text-soft">
            Approving this run locks all gross salaries, deductions, and net pay calculations.
            Further adjustments will require a supplemental or correction amendment run.
          </p>
        </div>

        <FormGroup
          label="Approval Reason & Audit Note"
          hint="Minimum 3 characters required"
          error={reason.length > 0 && !isValid ? 'Reason must be at least 3 characters long.' : undefined}
        >
          <Textarea
            placeholder="e.g. Verified against attendance logs and authorized by CFO."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-[80px]"
          />
        </FormGroup>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
          <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!isValid}
            loading={approveMutation.isPending}
            onClick={() => void handleSubmit()}
            leftIcon={<Lock className="h-4 w-4" />}
          >
            Approve &amp; Lock Run
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
