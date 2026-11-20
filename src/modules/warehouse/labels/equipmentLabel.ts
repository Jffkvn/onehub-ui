const equipmentLabel = /^eqpt:([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/iu
const pngDataUrl = /^data:image\/png;base64,[a-z0-9+/]+=*$/iu

type LabelAsset = { id: string; model_name: string; serial_number: string }

export function equipmentLabelPayload(id: string) {
  return 'EQPT:' + id
}

export function parseEquipmentLabel(value: string) {
  return equipmentLabel.exec(value.trim())?.[1].toLowerCase() ?? null
}

export function renderPrintableEquipmentLabel(page: Document, asset: LabelAsset, url: string) {
  if (!pngDataUrl.test(url)) throw new Error('The QR label image is unavailable.')
  page.title = 'Equipment label · ' + asset.serial_number

  const style = page.createElement('style')
  style.textContent = `
    @page { margin: 8mm; }
    body { margin: 0; padding: 8mm; background: #fff; color: #000; font-family: system-ui, sans-serif; }
    main { width: 58mm; padding: 3mm; border: 1px solid #000; text-align: center; box-sizing: border-box; }
    h1 { font-size: 11pt; margin: 0; }
    p { font-size: 9pt; margin: 1mm 0; overflow-wrap: anywhere; }
    code { display: block; font-size: 6pt; overflow-wrap: anywhere; }
    img { width: 38mm; height: 38mm; display: block; margin: auto; }
    @media print { body { padding: 0; } }
  `
  page.head.append(style)

  const label = page.createElement('main')
  const heading = page.createElement('h1')
  heading.textContent = 'EGYPRO ONEHUB'
  const model = page.createElement('p')
  model.textContent = asset.model_name
  const serial = page.createElement('p')
  serial.textContent = asset.serial_number
  const code = page.createElement('code')
  code.textContent = equipmentLabelPayload(asset.id)

  const image = page.createElement('img')
  image.alt = 'QR code for ' + asset.serial_number
  image.src = url

  label.append(heading, image, model, serial, code)
  page.body.replaceChildren(label)
  return image
}

export async function printEquipmentLabel(asset: LabelAsset, url: string) {
  const popup = window.open('', '_blank', 'popup,width=500,height=620')
  if (!popup) throw new Error('Allow pop-ups for OneHub to open the print preview.')
  try {
    popup.opener = null
    const image = renderPrintableEquipmentLabel(popup.document, asset, url)
    await image.decode()
    if (popup.closed) return
    popup.addEventListener('afterprint', () => popup.close(), { once: true })
    popup.focus()
    popup.print()
  } catch {
    popup.close()
    throw new Error('The equipment label could not be opened for printing.')
  }
}
