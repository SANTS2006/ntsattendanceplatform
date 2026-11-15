import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ApiError } from '@/api/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Never retry authorization/validation failures.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster position="top-right" toastOptions={{ duration: 4000, className: '!bg-white !text-slate-800 !rounded-xl !shadow-lg', style: { fontSize: '14px' } }} />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
