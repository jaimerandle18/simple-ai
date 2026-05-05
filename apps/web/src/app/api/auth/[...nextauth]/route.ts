import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ user, account }) {
      try {
        // Sync user with backend — creates tenant if new
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
        // Store tenantId and userId on the user object for the JWT callback
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
