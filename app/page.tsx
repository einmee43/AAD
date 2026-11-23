import { Suspense } from 'react';
import { createServerSupabase } from '@/lib/supabase/server';
import LoginScreen from '@/components/LoginScreen';
import DashboardClient from '@/components/DashboardClient';

async function HomeContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const hasEnv =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!hasEnv) {
    return <LoginScreen envMissing />;
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <LoginScreen authError={params.error === 'auth_failed'} />;
  }

  const meta = user.user_metadata || {};
  const userInfo = {
    id: user.id,
    name: meta.full_name || meta.name || meta.custom_claims?.global_name || user.email || 'Player',
    avatar: meta.avatar_url || undefined,
  };

  return <DashboardClient user={userInfo} />;
}

export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 text-zinc-400 flex items-center justify-center text-sm">
          Loading...
        </div>
      }
    >
      <HomeContent searchParams={searchParams} />
    </Suspense>
  );
}
