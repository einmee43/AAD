'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import KageBackdrop from '@/components/KageBackdrop';
import NextyLogo from '@/components/NextyLogo';

export default function LoginScreen({
  envMissing = false,
  authError = false,
}: {
  envMissing?: boolean;
  authError?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  const handleDiscordLogin = async () => {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className="min-h-screen bg-[#070506] text-zinc-100 relative overflow-hidden flex flex-col items-center justify-center p-6">
      {/* Kage Three.js + Living Backdrop */}
      <KageBackdrop />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-red-500/35 bg-gradient-to-b from-[#1a0b0f]/92 via-[#11080a]/94 to-[#0b0607]/96 p-8 shadow-[0_0_55px_rgba(220,38,38,0.22)] backdrop-blur-xl animate-fade-slide overflow-hidden">
        {/* Top Glowing Accent Bar */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#ff4a63] via-[#ff9a1f] to-[#ff4a63]" />

        {/* Brand Header */}
        <div className="mb-6">
          <NextyLogo size="lg" />
          <p className="mt-2.5 text-[11px] font-semibold tracking-[0.18em] uppercase text-red-300/65">
            Next-Gen Roblox Telemetry &amp; Drop Tracker
          </p>
        </div>

        {/* Main Heading */}
        <div className="mb-7 space-y-1.5">
          <h2 className="text-2xl font-bold tracking-tight text-white">
            ตรวจสอบสิทธิ์ใช้งาน
          </h2>
          <p className="text-sm text-zinc-400">
            เข้าสู่ระบบด้วยบัญชี Discord เพื่อจัดการบอทของ Nexty Hub
          </p>
        </div>

        {envMissing && (
          <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-300">
            <strong>Setup Required:</strong> Add Supabase environment variables to{' '}
            <code>.env.local</code>.
          </div>
        )}

        {authError && (
          <div className="mb-5 rounded-xl border border-rose-500/40 bg-rose-500/15 p-3.5 text-xs text-rose-200">
            เข้าสู่ระบบ Discord ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
          </div>
        )}

        <button
          onClick={handleDiscordLogin}
          disabled={loading || envMissing}
          className="aa-btn aa-btn--primary w-full !h-12 !text-sm"
        >
          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028z" />
          </svg>
          {loading ? 'กำลังพาไปหน้า Discord...' : 'เข้าสู่ระบบด้วย Discord'}
        </button>
      </div>
    </div>
  );
}
