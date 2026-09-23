import { Composer } from "./composer";
import { requireAppUser } from "@/lib/auth";
import { DraftIdSchema } from "@/lib/draft";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { readonly searchParams: Promise<{ draft?: string }> }) {
  const draftId = DraftIdSchema.safeParse((await searchParams).draft);
  const user = await requireAppUser(draftId.success ? `/?draft=${draftId.data}` : "/");
  return <Composer displayName={user.displayName} />;
}
