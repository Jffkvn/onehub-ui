import { parseWorkbookBuffer, type ParseWorkbookOptions, type ParsedWorkbookResult } from './workbookCore'

interface WorkerRequest {
  id: number
  buffer: ArrayBuffer
  options: ParseWorkbookOptions
}

type WorkerResponse =
  | { id: number; ok: true; result: ParsedWorkbookResult }
  | { id: number; ok: false; error: string }

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, options } = event.data
  try {
    const result = parseWorkbookBuffer(buffer, options)
    const response: WorkerResponse = { id, ok: true, result }
    self.postMessage(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not parse workbook.'
    const response: WorkerResponse = { id, ok: false, error: message }
    self.postMessage(response)
  }
})
