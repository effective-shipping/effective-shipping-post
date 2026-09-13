import { Composer } from "./composer";
import { requireAppUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireAppUser("/");
  return <Composer displayName={user.displayName} />;
}
