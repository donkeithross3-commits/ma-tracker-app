import { auth } from "@/auth";
import AIResearchContent from "@/components/ai-research/AIResearchContent";

export const dynamic = "force-dynamic";

export default async function AIResearchPage() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-gray-950 px-3 py-2">
      <div className="max-w-[1800px] mx-auto">
        <AIResearchContent
          initialUser={
            session?.user
              ? { name: session.user.name, email: session.user.email }
              : undefined
          }
        />
      </div>
    </div>
  );
}
