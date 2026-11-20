import * as XLSX from 'xlsx'

export const WORKBOOK_MAX_BYTES = 5 * 1024 * 1024
export const WORKBOOK_DEFAULT_MAX_ROWS = 1001
export const WORKBOOK_TIMEOUT_MS = 15_000

export interface ParseWorkbookOptions {
  preferredSheetName?: string
  maxRows?: number
  maxBytes?: number
}

export interface ParsedWorkbookResult {
  sheetName: string
  rows: string[][]
}

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/

function toLiteralText(value: unknown): string {
  if (typeof value === 'string') return value.split('\u0000').join('')
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return ''
}

/** Neutralize spreadsheet formula triggers on exported string cells. */
export function sanitizeWorkbookCell(value: unknown): string {
  const str = toLiteralText(value)
  return FORMULA_PREFIX_RE.test(str) ? `'${str}` : str
}

/** Verify ZIP local file header magic bytes (`PK\x03\x04`) required by `.xlsx`. */
export function hasXlsxMagicBytes(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false
  const header = new Uint8Array(buffer, 0, 4)
  return header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04
}

/** Synchronously parse a bounded `.xlsx` ArrayBuffer into normalized string rows. */
export function parseWorkbookBuffer(
  buffer: ArrayBuffer,
  options: ParseWorkbookOptions = {},
): ParsedWorkbookResult {
  const maxBytes = options.maxBytes ?? WORKBOOK_MAX_BYTES
  const maxRows = options.maxRows ?? WORKBOOK_DEFAULT_MAX_ROWS

  if (buffer.byteLength === 0) {
    throw new Error('The selected workbook is empty.')
  }
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Workbook exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`)
  }
  if (!hasXlsxMagicBytes(buffer)) {
    throw new Error('File is not a valid .xlsx workbook.')
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(new Uint8Array(buffer), {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      cellDates: false,
      dateNF: 'yyyy-mm-dd',
      dense: false,
    })
  } catch {
    throw new Error('Unable to read workbook. Ensure it is an unencrypted .xlsx file.')
  }

  if (workbook.SheetNames.length === 0) {
    throw new Error('The uploaded workbook contains no worksheets.')
  }

  const preferred = options.preferredSheetName?.trim().toLowerCase()
  const matchedSheetName = preferred
    ? workbook.SheetNames.find((name) => name.trim().toLowerCase() === preferred)
    : undefined
  const sheetName = matchedSheetName ?? workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheetName || !sheet) {
    throw new Error('The selected worksheet could not be read.')
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  })

  if (rawRows.length > maxRows) {
    throw new Error(
      `Workbook contains ${rawRows.length} rows, exceeding the ${maxRows - 1}-row data limit per upload.`,
    )
  }

  const rows = rawRows.map((row) =>
    Array.isArray(row) ? row.map((cell) => toLiteralText(cell).trim()) : [],
  )

  return { sheetName, rows }
}
