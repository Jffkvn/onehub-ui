import {
  WORKBOOK_DEFAULT_MAX_ROWS,
  WORKBOOK_MAX_BYTES,
  WORKBOOK_TIMEOUT_MS,
  hasXlsxMagicBytes,
  parseWorkbookBuffer,
  type ParseWorkbookOptions,
  type ParsedWorkbookResult,
} from './workbookCore'

export {
  WORKBOOK_DEFAULT_MAX_ROWS,
  WORKBOOK_MAX_BYTES,
  WORKBOOK_TIMEOUT_MS,
  hasXlsxMagicBytes,
  parseWorkbookBuffer,
  sanitizeWorkbookCell,
  type ParseWorkbookOptions,
  type ParsedWorkbookResult,
} from './workbookCore'

export interface ReadWorkbookFileResult extends ParsedWorkbookResult {
  buffer: ArrayBuffer
  fileName: string
}

interface WorkerResponseMessage {
  id: number
  ok: boolean
  result?: ParsedWorkbookResult
  error?: string
}

let nextRequestId = 1

function parseInWorker(
  buffer: ArrayBuffer,
  options: ParseWorkbookOptions,
): Promise<ParsedWorkbookResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(parseWorkbookBuffer(buffer, options))
  }

  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    let settled = false
    const worker = new Worker(new URL('./workbookParser.worker.ts', import.meta.url), {
      type: 'module',
    })

    const cleanup = () => {
      globalThis.clearTimeout(timer)
      worker.terminate()
    }

    const timer = globalThis.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Workbook parsing timed out. Split large files into smaller batches.'))
    }, WORKBOOK_TIMEOUT_MS)

    worker.addEventListener('message', (event: MessageEvent<WorkerResponseMessage>) => {
      if (settled || event.data?.id !== id) return
      settled = true
      cleanup()
      if (event.data.ok && event.data.result) {
        resolve(event.data.result)
      } else {
        reject(new Error(event.data.error || 'Could not parse workbook.'))
      }
    })

    worker.addEventListener('error', () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Workbook parser worker encountered an error.'))
    })

    // Clone buffer so callers retain the original bytes for SHA-256 hashing.
    const workerBuffer = buffer.slice(0)
    worker.postMessage({ id, buffer: workerBuffer, options }, [workerBuffer])
  })
}

function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result)
      } else {
        reject(new Error('Could not read workbook bytes.'))
      }
    }
    reader.onerror = () => reject(new Error('Could not read workbook file.'))
    reader.readAsArrayBuffer(file)
  })
}

/** Validate a user-selected `.xlsx` file and parse it inside a bounded Web Worker. */
export async function readWorkbookFile(
  file: File,
  options: ParseWorkbookOptions = {},
): Promise<ReadWorkbookFileResult> {
  const maxBytes = options.maxBytes ?? WORKBOOK_MAX_BYTES
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('Only .xlsx Excel workbooks are supported.')
  }
  if (file.size <= 0) {
    throw new Error('The selected workbook is empty.')
  }
  if (file.size > maxBytes) {
    throw new Error(`Workbook exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`)
  }

  const buffer = await fileToArrayBuffer(file)
  if (!hasXlsxMagicBytes(buffer)) {
    throw new Error('File signature does not match a valid .xlsx workbook.')
  }

  const parsed = await parseInWorker(buffer, {
    ...options,
    maxBytes,
    maxRows: options.maxRows ?? WORKBOOK_DEFAULT_MAX_ROWS,
  })

  return {
    ...parsed,
    buffer,
    fileName: file.name,
  }
}
