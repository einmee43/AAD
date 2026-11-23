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
          <img
            src="/icons/discord.png"
            alt="Discord"
            className="w-6 h-6 rounded-full object-contain shrink-0"
          />
          {loading ? 'กำลังพาไปหน้า Discord...' : 'เข้าสู่ระบบด้วย Discord'}
        </button>
      </div>
    </div>
  );
}
