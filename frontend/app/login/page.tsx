import { AuthPage } from "@/components/auth/AuthPage";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const value = (await searchParams).returnTo;
  return <AuthPage returnTo={Array.isArray(value) ? value[0] : value} />;
}
