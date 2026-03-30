import React, { useEffect } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import AppRouter from './router/AppRouter';
import './App.css';

function App() {
  // Globally prevent scroll-wheel from changing number input values
  useEffect(() => {
    const handleWheel = (e) => {
      if (document.activeElement?.type === 'number') {
        document.activeElement.blur();
      }
    };
    document.addEventListener('wheel', handleWheel, { passive: true });
    return () => document.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <HelmetProvider>
      <AuthProvider>
        <AppRouter />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'var(--color-bg-elevated)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-body)',
              boxShadow: 'var(--shadow-xl)',
            },
            success: {
              iconTheme: {
                primary: 'var(--color-success)',
                secondary: 'var(--color-bg-elevated)',
              },
            },
            error: {
              iconTheme: {
                primary: 'var(--color-danger)',
                secondary: 'var(--color-bg-elevated)',
              },
            },
          }}
        />
      </AuthProvider>
    </HelmetProvider>
  );
}

export default App;
