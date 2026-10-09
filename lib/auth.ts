// DEMO AUTH. Replace this file with your own authentication.
// Every visitor is the same demo user, so you can run the whole flow without
// building sign-in first. getCurrentUser must return the signed-in user.
export type User = { id: string; email: string; name: string };

export async function getCurrentUser(): Promise<User> {
  if (process.env.BACHS_API_KEY?.startsWith("sk_live_")) {
    throw new Error("Replace demo authentication and the local store before using live keys.");
  }
  return {
    id: "demo-user",
    email: process.env.DEMO_USER_EMAIL || "demo@example.com",
    name: "Demo User",
  };
}
