import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { EquipmentScanner } from './EquipmentScanner'

type Decode = (text: string) => void
const { start, stop, clear } = vi.hoisted(() => ({
  start: vi.fn<(_camera: unknown, _config: unknown, decode: Decode) => Promise<null>>(),
  stop: vi.fn<() => Promise<void>>(),
  clear: vi.fn<() => void>(),
}))

vi.mock('html5-qrcode', () => ({
  Html5QrcodeSupportedFormats: { QR_CODE: 0 },
  Html5Qrcode: class {
    start = start
    stop = stop
    clear = clear
  },
}))

beforeEach(() => {
  start.mockReset()
  start.mockResolvedValue(null)
  stop.mockReset()
  stop.mockResolvedValue(undefined)
  clear.mockReset()
})

it('ignores unrelated QR codes, accepts a warehouse label once, and releases the camera', async () => {
  const scanned = vi.fn()
  const view = render(<EquipmentScanner onScanned={scanned} onClose={vi.fn()} />)
  await screen.findByText('Point the camera at an equipment label.')
  const decode = start.mock.calls[0][2]
  act(() => { decode('https://example.invalid') })
  expect(scanned).not.toHaveBeenCalled()

  const id = '215d53cc-4a63-4e68-940b-4861239222d0'
  act(() => {
    decode('EQPT:' + id)
    decode('EQPT:' + id)
  })
  expect(scanned).toHaveBeenCalledExactlyOnceWith('EQPT:' + id)

  view.unmount()
  await waitFor(() => expect(stop).toHaveBeenCalledOnce())
  expect(clear).toHaveBeenCalledOnce()
})

it('offers manual lookup when starting the camera fails', async () => {
  start.mockRejectedValue(new Error('Camera denied'))
  render(<EquipmentScanner onScanned={vi.fn()} onClose={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('enter the label or serial number')
})
