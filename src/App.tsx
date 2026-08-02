import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { ShowcasePage } from '@/pages/Showcase'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ShowcasePage />
      </ToastProvider>
    </QueryClientProvider>
  )
}
