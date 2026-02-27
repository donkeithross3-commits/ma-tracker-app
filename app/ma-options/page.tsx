import { auth } from "@/auth";
import MAOptionsContent from "@/components/ma-options/MAOptionsContent";

// Force dynamic rendering - this page requires auth
export const dynamic = 'force-dynamic';

export default async function MAOptionsPage() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-gray-950 px-3 py-2">
      <div className="max-w-[1800px] mx-auto">
        <MAOptionsContent
          initialUser={session?.user ? { name: session.user.name, email: session.user.email, alias: session.user.alias } : undefined}
        />
      </div>
    </div>
  );
}
