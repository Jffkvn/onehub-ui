import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError } from '@/components/ui/Input'
import { equipmentLabelPayload, parseEquipmentLabel } from './equipmentLabel'

interface ScannerProps {
  onScanned: (label: string) => void
  onClose: () => void
}

export function EquipmentScanner({ onScanned, onClose }: ScannerProps) {
  const viewportId = 'equipment-camera-' + useId()
  const onScannedRef = useRef(onScanned)
  const [status, setStatus] = useState<'starting' | 'active' | 'unavailable'>('starting')
  const [invalidLabel, setInvalidLabel] = useState(false)

  useEffect(() => { onScannedRef.current = onScanned }, [onScanned])

  useEffect(() => {
    let disposed = false
    let accepted = false
    let stopCamera: (() => Promise<void>) | undefined

    async function startCamera() {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        if (disposed) return
        const scanner = new Html5Qrcode(viewportId, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false })

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 8,
            qrbox: (width, height) => {
              const size = Math.floor(Math.min(width, height) * 0.7)
              return { width: size, height: size }
            },
          },
          (value) => {
            if (disposed || accepted) return
            const id = parseEquipmentLabel(value)
            if (!id) {
              setInvalidLabel(true)
              return
            }
            accepted = true
            onScannedRef.current(equipmentLabelPayload(id))
          },
          () => {},
        )

        stopCamera = async () => {
          try {
            await scanner.stop()
            scanner.clear()
          } catch {
            // Closing the dialog already removes the camera viewport.
          }
        }
        if (disposed) void stopCamera()
        else setStatus('active')
      } catch {
        if (!disposed) setStatus('unavailable')
      }
    }

    void startCamera()

    return () => {
      disposed = true
      void stopCamera?.()
    }
  }, [viewportId])

  return <Dialog open title="Scan equipment label" description="Scan the QR code on the asset to find its custody record."
    onOpenChange={(open) => { if (!open) onClose() }}
    footer={<Button type="button" variant="outline" onClick={onClose}>Close scanner</Button>}>
    <div className="space-y-3">
      <div id={viewportId} className="overflow-hidden rounded-md" />
      {status !== 'unavailable' && <p role="status" className="text-sm text-muted">
        {status === 'starting' ? 'Starting camera…' : invalidLabel ? 'This QR code is not an equipment label.' : 'Point the camera at an equipment label.'}
      </p>}
      {status === 'unavailable' && <FieldError>Camera unavailable. Close the scanner and enter the label or serial number.</FieldError>}
    </div>
  </Dialog>
}
