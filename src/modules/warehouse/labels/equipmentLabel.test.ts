import { expect, it } from 'vitest'
import { equipmentLabelPayload, parseEquipmentLabel, renderPrintableEquipmentLabel } from './equipmentLabel'

const id = '215d53cc-4a63-4e68-940b-4861239222d0'

it('recognizes only the full equipment label and normalizes uppercase IDs', () => {
  expect(equipmentLabelPayload(id)).toBe('EQPT:' + id)
  expect(parseEquipmentLabel(' EQPT:' + id.toUpperCase() + ' ')).toBe(id)
  expect(parseEquipmentLabel('https://example.invalid/EQPT:' + id)).toBeNull()
  expect(parseEquipmentLabel('EQPT:' + id + ':extra')).toBeNull()
})

it('prints asset data as text and only accepts a PNG data URL', () => {
  const page = document.implementation.createHTMLDocument()
  const escapedName = '<em>Fiber splicer</em>'
  const equipment = { id, model_name: escapedName, serial_number: 'FS-001' }

  expect(() => renderPrintableEquipmentLabel(page, equipment, 'https://example.invalid/fake.png')).toThrow()
  const image = renderPrintableEquipmentLabel(page, equipment, 'data:image/png;base64,AA==')
  expect(image.getAttribute('alt')).toBe('QR code for FS-001')
  expect(page.body.textContent).toContain(escapedName)
  expect(page.body.textContent).toContain('EQPT:' + id)
  expect(page.querySelector('em')).toBeNull()
})
