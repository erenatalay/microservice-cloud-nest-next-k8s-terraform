'use client';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import Cookies from 'js-cookie';
import { useRouter } from 'next/navigation';

export interface User {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  avatar?: string;
  phone?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (user: User, tokens: AuthTokens) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
  getAccessToken: () => string | null;
  isTokenValid: () => boolean;
}

const COOKIE_DOMAIN =
  typeof window !== 'undefined' && window.location.hostname.includes('.local')
    ? '.ecommerce.local'
    : undefined;

const COOKIE_BASE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  secure: false,
  domain: COOKIE_DOMAIN,
} as const;

const COOKIE_CONFIG = {
  accessToken: {
    ...COOKIE_BASE_OPTIONS,
    expires: 1,
  },
  refreshToken: {
    ...COOKIE_BASE_OPTIONS,
    expires: 7,
  },
  user: {
    ...COOKIE_BASE_OPTIONS,
    expires: 7,
  },
} as const;

const COOKIE_KEYS = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  user: 'user',
} as const;

function decodeToken(token: string): { exp: number; id: string } | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch {
    return null;
  }
}


function checkTokenValidity(token: string | undefined): boolean {
  if (!token) return false;

  const payload = decodeToken(token);
  if (!payload?.exp) return false;


  const bufferMs = 5 * 60 * 1000;
  return Date.now() < payload.exp * 1000 - bufferMs;
}


function parseUserFromCookie(): User | null {
  try {
    const storedUser = Cookies.get(COOKIE_KEYS.user);
    return storedUser ? JSON.parse(storedUser) : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });


  useEffect(() => {
    const initializeAuth = () => {
      const accessToken = Cookies.get(COOKIE_KEYS.accessToken);
      const user = parseUserFromCookie();

      if (accessToken && user && checkTokenValidity(accessToken)) {
        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        clearAuthData();
        setState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    };

    initializeAuth();
  }, []);

  const clearAuthData = useCallback(() => {
    const removeOptions = { path: '/', domain: COOKIE_DOMAIN };
    Cookies.remove(COOKIE_KEYS.accessToken, removeOptions);
    Cookies.remove(COOKIE_KEYS.refreshToken, removeOptions);
    Cookies.remove(COOKIE_KEYS.user, removeOptions);
  }, []);


  const login = useCallback((user: User, tokens: AuthTokens) => {

    Cookies.set(COOKIE_KEYS.user, JSON.stringify(user), COOKIE_CONFIG.user);
    Cookies.set(
      COOKIE_KEYS.accessToken,
      tokens.accessToken,
      COOKIE_CONFIG.accessToken,
    );
    Cookies.set(
      COOKIE_KEYS.refreshToken,
      tokens.refreshToken,
      COOKIE_CONFIG.refreshToken,
    );

    setState({
      user,
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  const logout = useCallback(() => {
    clearAuthData();
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
    router.push('/login');
  }, [clearAuthData, router]);


  const updateUser = useCallback((updates: Partial<User>) => {
    setState((prev) => {
      if (!prev.user) return prev;

      const updatedUser = { ...prev.user, ...updates };
      Cookies.set(
        COOKIE_KEYS.user,
        JSON.stringify(updatedUser),
        COOKIE_CONFIG.user,
      );

      return { ...prev, user: updatedUser };
    });
  }, []);

  const getAccessToken = useCallback((): string | null => {
    return Cookies.get(COOKIE_KEYS.accessToken) || null;
  }, []);

  const isTokenValid = useCallback((): boolean => {
    const token = Cookies.get(COOKIE_KEYS.accessToken);
    return checkTokenValidity(token);
  }, []);

  const contextValue = useMemo<AuthContextType>(
    () => ({
      ...state,
      login,
      logout,
      updateUser,
      getAccessToken,
      isTokenValid,
    }),
    [state, login, logout, updateUser, getAccessToken, isTokenValid],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}





export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export function withAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>,
) {
  return function WithAuthComponent(props: P) {
    const { isAuthenticated, isLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
      if (!isLoading && !isAuthenticated) {
        router.push('/login');
      }
    }, [isAuthenticated, isLoading, router]);

    if (isLoading) {
      return (
        <div className="flex h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      );
    }

    if (!isAuthenticated) {
      return null;
    }

    return <WrappedComponent {...props} />;
  };
}
