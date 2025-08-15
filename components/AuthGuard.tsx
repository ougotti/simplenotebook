'use client';

import { useAuth } from '../hooks/useAuth';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';

function AuthGuardContent({ children }: { children: React.ReactNode }) {
  const { user, loading, signIn } = useAuth();
  const searchParams = useSearchParams();
  const [isProcessingCallback, setIsProcessingCallback] = useState(false);

  // Check if this is an OAuth callback
  useEffect(() => {
    if (!searchParams) return;
    
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    
    if (code && state) {
      setIsProcessingCallback(true);
      
      // Give Amplify time to process the callback
      const OAUTH_CALLBACK_TIMEOUT =
        typeof process !== 'undefined' && process.env.NEXT_PUBLIC_OAUTH_CALLBACK_TIMEOUT
          ? parseInt(process.env.NEXT_PUBLIC_OAUTH_CALLBACK_TIMEOUT, 10)
          : 3000;
      
      const timer = setTimeout(() => {
        setIsProcessingCallback(false);
      }, OAUTH_CALLBACK_TIMEOUT);
      
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  if (loading || isProcessingCallback) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">
            {isProcessingCallback ? 'Processing OAuth callback...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 p-8">
          <div className="text-center">
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
              Welcome to SimpleNotebook
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Sign in with your Google account to access your notes
            </p>
          </div>
          <div>
            <button
              onClick={signIn}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <AuthGuardContent>{children}</AuthGuardContent>
    </Suspense>
  );
}