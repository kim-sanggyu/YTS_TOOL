import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { yttsDb } from "@/lib/db/oracle"

interface YttsUser {
  USER_ID: number
  USERNAME: string
  PASSWORD: string
  NAME: string
  ROLE: string | null
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: "아이디", type: "text" },
        password: { label: "비밀번호", type: "password" },
      },
      authorize: async (credentials) => {
        if (!credentials?.username || !credentials?.password) return null

        const rows = await yttsDb.query<YttsUser>(
          "SELECT USER_ID, USERNAME, PASSWORD, NAME, ROLE FROM YTTS_USERS WHERE USERNAME = :1",
          [credentials.username]
        )

        const user = rows[0]
        if (!user) return null

        const valid = await bcrypt.compare(credentials.password as string, user.PASSWORD)
        if (!valid) return null

        return {
          id: String(user.USER_ID),
          name: user.NAME,
          email: user.USERNAME,
          role: user.ROLE ?? "USER",
        }
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role
        token.id   = user.id  // USER_ID를 JWT에 보존
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string
        ;(session.user as { id?: string }).id    = token.id as string  // 세션에 USER_ID 전달
      }
      return session
    },
  },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
})
