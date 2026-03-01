import { auth } from "@/auth";
import ChartsPageClient from "@/components/ma-options/charts/ChartsPageClient";

// Force dynamic rendering - this page requires auth
export const dynamic = 'force-dynamic';

export default async function ChartsPage() {
  const session = await auth();

  return (
    <ChartsPageClient
      initialUser={session?.user ? { name: session.user.name, email: session.user.email } : undefined}
    />
  );
}
