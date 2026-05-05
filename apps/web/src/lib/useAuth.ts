'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { api } from './api';

interface AuthData {
  tenantId: string;
  userId: string;
  role: string;
}

let cachedAuth: AuthData | null = null;

export function useAuth() {
  const { data: session, status } = useSession();
  const [auth, setAuth] = useState<AuthData | null>(cachedAuth);
  const [loading, setLoading] = useState(!cachedAuth);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.email) return;
    if (cachedAuth) {
      setAuth(cachedAuth);
      setLoading(false);
      return;
    }

    api('/auth/login', {
      method: 'POST',
      body: {
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
        provider: 'google',
      },
    })
      .then((data) => {
        const authData = {
          tenantId: data.user.tenantId,
          userId: data.user.userId,
          role: data.user.role,
        };
        cachedAuth = authData;
        setAuth(authData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session, status]);

  return { session, auth, loading: status === 'loading' || loading };
}
