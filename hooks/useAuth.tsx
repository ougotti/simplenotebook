'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getCurrentUser, signInWithRedirect, signOut, AuthUser, fetchAuthSession } from 'aws-amplify/auth';
import { configureAmplify } from '../lib/amplify';
import { apiClient } from '../lib/api';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      try {
        await configureAmplify();
        
        const currentUser = await getCurrentUser();
        if (isMounted) {
          setUser(currentUser);
          
          // Set access token for API client
          const session = await fetchAuthSession();
          const accessToken = session.tokens?.accessToken?.toString();
          if (accessToken) {
            apiClient.setAccessToken(accessToken);
          }
        }
      } catch (error) {
        console.log('No authenticated user');
        if (isMounted) {
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithRedirect({
        provider: 'Google',
      });
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setUser(null);
      apiClient.setAccessToken('');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const value = {
    user,
    loading,
    signIn: handleSignIn,
    signOut: handleSignOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}