'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getCurrentUser, signInWithRedirect, signOut, AuthUser, fetchAuthSession } from 'aws-amplify/auth';
import { configureAmplify } from '../lib/amplify';
import { apiClient } from '../lib/api';
import { getConfig, isLocalMode } from '../lib/config';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
  isLocal: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Fake user for local development
const LOCAL_USER: AuthUser = {
  userId: 'local-user',
  username: 'local-user',
  signInDetails: {
    loginId: 'local@example.com',
  },
} as AuthUser;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocal, setIsLocal] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      try {
        const config = await getConfig();
        const localMode = isLocalMode(config);
        
        if (isMounted) {
          setIsLocal(localMode);
        }
        
        if (localMode) {
          // Use fake authentication for local development
          console.log('Running in local mode - using fake authentication');
          if (isMounted) {
            setUser(LOCAL_USER);
          }
        } else {
          // Use real AWS Amplify authentication
          await configureAmplify();
          
          const currentUser = await getCurrentUser();
          if (isMounted) {
            setUser(currentUser);
            
            // Set ID token for API client (Cognito User Pool Authorizer expects ID tokens)
            const session = await fetchAuthSession();
            const idToken = session.tokens?.idToken?.toString();
            if (idToken) {
              apiClient.setBearerToken(idToken);
            }
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
      if (isLocal) {
        // In local mode, just set the fake user
        setUser(LOCAL_USER);
      } else {
        await signInWithRedirect({
          provider: 'Google',
        });
      }
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  const handleSignOut = async () => {
    try {
      if (isLocal) {
        // In local mode, just clear the user
        setUser(null);
      } else {
        await signOut();
        setUser(null);
        apiClient.setBearerToken('');
      }
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const value = {
    user,
    loading,
    signIn: handleSignIn,
    signOut: handleSignOut,
    isLocal,
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