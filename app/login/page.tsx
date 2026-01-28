import { signIn } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; registered?: string }>
}) {
  const params = await searchParams

  async function handleLogin(formData: FormData) {
    "use server"

    const email = formData.get("email") as string
    const password = formData.get("password") as string

    try {
      await signIn("credentials", {
        email,
        password,
        redirectTo: params.callbackUrl || "/",
      })
    } catch (error) {
      // NextAuth throws a redirect error on successful login
      // This is expected behavior, so we just rethrow it
      throw error
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">M&A Tracker</CardTitle>
          <CardDescription>
            Sign in to access the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={handleLogin} className="space-y-4">
            {params.registered && (
              <div className="bg-green-50 text-green-600 p-3 rounded-md text-sm">
                Account created successfully! Please sign in.
              </div>
            )}

            {params.error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
                Invalid email or password. Please try again.
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="don@limitlessventures.us"
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>

            <Button type="submit" className="w-full">
              Sign In
            </Button>

            <div className="text-sm text-center text-gray-600 mt-4">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-blue-600 hover:underline">
                Sign up
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
