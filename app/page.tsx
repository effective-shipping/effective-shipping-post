import { Composer } from "./composer";
import { getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <Composer displayName={user?.displayName ?? "Your account"} />;
}
