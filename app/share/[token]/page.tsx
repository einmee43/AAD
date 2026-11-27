import { Suspense } from 'react';
import { verifyShareToken } from '@/lib/shareToken';
import { resolveShareVisibility } from '@/lib/shareConfig';
import DashboardClient from '@/components/DashboardClient';

async function ShareContent({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = verifyShareToken(token);

  if (!payload) {
    return (
      <div className="min-h-screen bg-[#070506] text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-[#13080b]/90 p-6 text-center space-y-2 shadow-2xl">
          <div className="text-base font-bold text-white">ลิงก์แชร์ไม่ถูกต้องหรือหมดอายุ</div>
          <p className="text-xs text-zinc-400">
            กรุณาขอลิงก์แชร์ใหม่จากเจ้าของร้านเพื่อดูสถานะฟาร์มแบบเรียลไทม์ครับ
          </p>
        </div>
      </div>
    );
  }

  const initialShareConfig = resolveShareVisibility(payload);

  return (
    <DashboardClient
      user={{
        id: 'share-viewer',
        name: payload.l || 'Nexty Shop Live',
      }}
      readOnly
      shareToken={token}
      shareLabel={payload.l || 'Nexty Shop Live'}
      initialHours={payload.h || 24}
      initialShareConfig={initialShareConfig}
    />
  );
}

export default function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#070506] text-zinc-400 flex items-center justify-center text-sm">
          Loading Live Farm View...
        </div>
      }
    >
      <ShareContent params={params} />
    </Suspense>
  );
}
