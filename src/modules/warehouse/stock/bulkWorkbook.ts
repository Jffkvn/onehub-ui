import type { StockCommand } from './stockApi'

export const bulkTemplates = {
  item_master: {
    title: 'Item master',
    sheet: 'Item Master Upload',
    headers: ['Type', 'Name', 'Description', 'SKU', 'Unit of Measure', 'Reorder Level', 'Serial Number', 'Model Name', 'Is Sensitive', 'Current Warehouse Name', 'Condition Notes'],
  },
  goods_received: {
    title: 'Goods received',
    sheet: 'Goods Received Upload',
    headers: ['Receipt Reference', 'Warehouse Name', 'SKU or Serial', 'Quantity', 'Unit Price'],
    command: 'rpc_bulk_receive_stock',
  },
  opening_stock: {
    title: 'Opening stock',
    sheet: 'Opening Stock Upload',
    headers: ['Warehouse Name', 'SKU', 'Quantity'],
    command: 'rpc_bulk_opening_stock',
  },
  stock_adjustment: {
    title: 'Stock adjustments',
    sheet: 'Stock Adjustment Upload',
    headers: ['Warehouse Name', 'SKU or Serial', 'Quantity', 'Reason'],
    command: 'rpc_bulk_adjust_stock',
  },
} as const

export type BulkKind = keyof typeof bulkTemplates
type WorkbookRow = { number: number; values: string[] }
type RowError = { row: number; message: string }
type Values = Record<string, string>

export interface BulkPreview {
  headers: readonly string[]
  rows: WorkbookRow[]
  errors: RowError[]
  command: StockCommand | null
}

function normalizeNumber(value: string) {
  return /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value) ? value.replaceAll(',', '') : value
}

function integer(value: string, min: number) {
  const number = Number(value)
  return /^-?\d+$/.test(value) && Number.isInteger(number) && number >= min && number <= 2147483647
}

function parseItemMaster(records: { row: number; values: Values }[], errors: RowError[]): StockCommand {
  const categories: { name: string; description: string }[] = []
  const consumables = []
  const equipment = []
  const skus = new Set<string>()
  const serials = new Set<string>()
  const names = new Set<string>()

  for (const { row, values } of records) {
    const flag = (message: string) => errors.push({ row, message })
    const type = values.Type.toLowerCase()
    const description = values.Description
    if (type === 'category') {
      const name = values.Name
      if (!name || name.length > 100) flag('Enter a category name of up to 100 characters.')
      if (names.has(name.toLowerCase())) flag('Category name occurs more than once.')
      names.add(name.toLowerCase())
      categories.push({ name, description })
    } else if (type === 'consumable') {
      const sku = values.SKU.toUpperCase()
      const name = values.Name
      const unit = values['Unit of Measure']
      const reorder = normalizeNumber(values['Reorder Level'] || '0')
      if (!sku || !/^[A-Z0-9-]+$/.test(sku)) flag('SKU must contain only letters, numbers and hyphens.')
      if (!name || !description || !unit) flag('Name, category (Description) and Unit of Measure are required.')
      if (!integer(reorder, 0)) flag('Reorder Level must be a non-negative whole number.')
      if (skus.has(sku)) flag('SKU occurs more than once.')
      skus.add(sku)
      consumables.push({ name, sku, category_name: description, unit_of_measure: unit, reorder_level: Number(reorder) })
    } else if (type === 'equipment') {
      const serial = values['Serial Number']
      const model = values['Model Name']
      const sensitive = values['Is Sensitive'].toLowerCase()
      if (!model || !serial || !description) flag('Model Name, Serial Number and category (Description) are required.')
      if (sensitive && !['true', 'false', 'yes', 'no', '1', '0'].includes(sensitive)) flag('Is Sensitive must be TRUE or FALSE.')
      if (serials.has(serial.toLowerCase())) flag('Serial number occurs more than once.')
      serials.add(serial.toLowerCase())
      equipment.push({
        model_name: model, serial_number: serial, category_name: description,
        current_warehouse_name: values['Current Warehouse Name'],
        is_sensitive: ['true', 'yes', '1'].includes(sensitive),
        condition_notes: values['Condition Notes'],
      })
    } else {
      flag('Type must be category, consumable or equipment.')
    }
  }

  return {
    name: 'rpc_bulk_import_item_master',
    args: { p_categories: categories, p_consumables: consumables, p_equipment: equipment },
  }
}

export function prepareBulkWorkbook(kind: BulkKind, sheet: string, cells: string[][]): BulkPreview {
  const template = bulkTemplates[kind]
  if (sheet.trim().toLowerCase() !== template.sheet.toLowerCase()) {
    throw new Error('Use the worksheet named "' + template.sheet + '".')
  }

  const headers = (cells[0] ?? []).map((value) => value.trim().toLowerCase())
  const columns = template.headers.map((header) => headers.indexOf(header.toLowerCase()))
  if (columns.includes(-1) || new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) {
    throw new Error('The column headings must match the downloaded template, with each heading present once.')
  }

  const rows = cells.slice(1).flatMap((line, index) => {
    if (!line.some((cell) => cell.trim())) return []
    return [{ number: index + 2, values: columns.map((column) => line[column]?.trim() ?? '') }]
  })
  if (!rows.length) throw new Error('The worksheet contains no stock records.')

  const records = rows.map(({ number, values }) => ({
    row: number,
    values: Object.fromEntries(template.headers.map((header, index) => [header, values[index]])),
  }))
  const errors: RowError[] = []

  if (kind === 'item_master') {
    const command = parseItemMaster(records, errors)
    return { headers: template.headers, rows, errors, command: errors.length ? null : command }
  }

  const payload = records.map(({ row, values }) => {
    const flag = (message: string) => errors.push({ row, message })
    const warehouse = values['Warehouse Name']
    const identifier = values[kind === 'opening_stock' ? 'SKU' : 'SKU or Serial']
    const quantity = normalizeNumber(values.Quantity)
    if (!warehouse) flag('Warehouse Name is required.')
    if (!identifier) flag(kind === 'opening_stock' ? 'SKU is required.' : 'SKU or Serial is required.')
    const isAdjustment = kind === 'stock_adjustment'
    if (!integer(quantity, isAdjustment ? -2147483647 : 1) || Number(quantity) === 0) {
      flag(isAdjustment ? 'Enter a non-zero whole number for Quantity.' : 'Enter a positive whole number for Quantity.')
    }
    const shared = { warehouse_name: warehouse, quantity: Number(quantity) }
    if (kind === 'opening_stock') return { ...shared, sku: identifier }

    if (isAdjustment) {
      if (!values.Reason) flag('Reason is required.')
      return { ...shared, sku_or_serial: identifier, reason: values.Reason }
    }

    const reference = values['Receipt Reference']
    const price = normalizeNumber(values['Unit Price'])
    if (!reference) flag('Receipt Reference is required.')
    if (!/^\d+(?:\.\d{1,2})?$/.test(price) || Number(price) > 9999999999999.99) flag('Enter a non-negative Unit Price with up to two decimal places.')
    return { ...shared, sku_or_serial: identifier, receipt_reference: reference, unit_price: Number(price) }
  })

  return {
    headers: template.headers, rows, errors,
    command: errors.length ? null : { name: bulkTemplates[kind].command, args: { p_rows: payload } },
  }
}
