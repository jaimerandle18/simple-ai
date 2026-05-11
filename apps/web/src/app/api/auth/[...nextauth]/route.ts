import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
        const res = await fetch(`${apiUrl}/auth/credentials`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: credentials.email, password: credentials.password }),
        });

        if (!res.ok) return null;

        const data = await res.json();
        return {
          id: data.user.userId,
          email: data.user.email,
          name: data.user.name,
          tenantId: data.user.tenantId,
          userId: data.user.userId,
          role: data.user.role,
        };
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'credentials') return true;

      try {
        const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
        console.log('Auth callback - calling backend:', apiUrl);
        const res = await fetch(`${apiUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email,
            name: user.name,
            image: user.image,
            provider: account?.provider || 'google',
          }),
        });

        if (!res.ok) {
          console.error('Backend auth failed:', await res.text());
          return false;
        }

        const data = await res.json();
        (user as any).tenantId = data.user.tenantId;
        (user as any).userId = data.user.userId;
        (user as any).role = data.user.role;

        return true;
      } catch (err) {
        console.error('Auth sync error:', err);
        return false;
      }
    },
    async jwt({ token, user }) {
      if (user) {
        token.tenantId = (user as any).tenantId;
        token.userId = (user as any).userId;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).tenantId = token.tenantId;
        (session.user as any).userId = token.userId;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
});

export { handler as GET, handler as POST };
