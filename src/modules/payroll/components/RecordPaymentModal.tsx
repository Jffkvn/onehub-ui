import { useState } from 'react'
import { Receipt, CheckCircle2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input, FormGroup, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useRecordPayrollPayment } from '../api/payroll'
import type { PayrollPayment, PayrollRun } from '@/_contract/types/payroll.types'

export interface RecordPaymentModalProps {
  run: PayrollRun
  open: boolean
  onOpenChange: (open: boolean) => void
  onRecorded?: () => void
}

export function RecordPaymentModal({
  run,
  open,
  onOpenChange,
  onRecorded,
}: RecordPaymentModalProps) {
  const today = new Date().toISOString().slice(0, 10)
  const [paidOn, setPaidOn] = useState(today)
  const [reference, setReference] = useState('')
  const [method, setMethod] = useState<PayrollPayment['method']>('bank')
  const [notes, setNotes] = useState('')

  const recordMutation = useRecordPayrollPayment()

  const isValid = reference.trim().length >= 3 && paidOn <= today

  const handleSubmit = async () => {
    if (!isValid || recordMutation.isPending) return
    try {
      await recordMutation.mutateAsync({
        runId: run.id,
        paidOn,
        reference: reference.trim(),
        method,
        notes: notes.trim() || undefined,
      })
      onOpenChange(false)
      onRecorded?.()
    } catch {
      // Handled by mutation state
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-tint text-emerald-600 shrink-0">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-ink">
              Record Disbursement Payment
            </h2>
            <p className="font-body text-xs text-soft">
              Total Net Amount: <strong className="font-mono text-ink whitespace-nowrap tabular-nums">UGX {run.totalNet.toLocaleString()}</strong>
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <FormGroup label="Payment Date" hint="Cannot be in the future">
            <Input
              type="date"
              max={today}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </FormGroup>

          <FormGroup label="Disbursement Method">
            <Select
              value={method}
              onValueChange={(val) => setMethod(val as PayrollPayment['method'])}
              options={[
                { value: 'bank', label: 'Bank Transfer (Stanbic / Centenary)' },
                { value: 'mobile_money', label: 'MTN Mobile Money Bulk Pay' },
                { value: 'cash', label: 'Cash Disbursement' },
                { value: 'other', label: 'Other Settlement' },
              ]}
            />
          </FormGroup>

          <FormGroup
            label="Payment Reference / Transaction Batch ID"
            hint="Minimum 3 characters required"
            error={reference.length > 0 && reference.trim().length < 3 ? 'Reference must be at least 3 characters.' : undefined}
          >
            <Input
              placeholder="e.g. STANBIC-BATCH-20260728-01"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </FormGroup>

          <FormGroup label="Payment Notes (Optional)">
            <Textarea
              placeholder="e.g. Batch processed successfully via Stanbic Online Corporate Gateway."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[70px]"
            />
          </FormGroup>
        </div>

        {recordMutation.isError && (
          <div role="alert" className="rounded-md bg-rose-tint p-3 text-xs text-rose">
            {recordMutation.error instanceof Error
              ? recordMutation.error.message
              : 'Unable to record disbursement payment. Please try again.'}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
          <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!isValid}
            loading={recordMutation.isPending}
            onClick={() => void handleSubmit()}
            leftIcon={<CheckCircle2 className="h-4 w-4" />}
          >
            Record Payment
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
