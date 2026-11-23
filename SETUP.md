# คู่มือติดตั้ง AA Drop Tracker (Supabase + Discord Login + Vercel)

## ขั้นตอนที่ 1: สร้าง Database บน Supabase
1. ไปที่ [supabase.com](https://supabase.com) -> **New Project**
2. เข้าเมนู **SQL Editor** -> เปิดไฟล์ `supabase/schema.sql` แล้วก๊อปวางทั้งหมดกด **Run**
3. ไปที่ **Project Settings -> API** เก็บค่า 3 ตัวนี้ไว้:
   * `Project URL` -> `NEXT_PUBLIC_SUPABASE_URL`
   * `anon public` -> `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   * `service_role` (กด Reveal) -> `SUPABASE_SERVICE_ROLE_KEY`

---

## ขั้นตอนที่ 2: เปิด Login ด้วย Discord
1. ไปที่ [Discord Developer Portal](https://discord.com/developers/applications) -> **New Application**
2. เข้าเมนู **OAuth2**:
   * ก๊อป **Client ID** และ **Client Secret**
   * ในช่อง **Redirects** ให้เพิ่ม URL จาก Supabase:
     `https://<PROJECT_ID>.supabase.co/auth/v1/callback`
3. กลับมาที่ **Supabase -> Authentication -> Providers -> Discord**:
   * เปิด **Enable Discord**
   * ใส่ `Client ID` และ `Client Secret` ที่ก๊อปมา แล้วกด **Save**
4. ที่ **Supabase -> Authentication -> URL Configuration**:
   * ใส่ **Site URL** เป็นเว็บ Vercel ของพี่ (เช่น `https://aa-tracker.vercel.app`)
   * ใส่ **Redirect URLs** เพิ่ม `https://aa-tracker.vercel.app/auth/callback` และ `http://localhost:3000/auth/callback`

---

## ขั้นตอนที่ 3: Deploy ขึ้น Vercel
1. อัปโหลดโฟลเดอร์ `aa_tracker` ขึ้น GitHub หรือใช้ `vercel` CLI ในโฟลเดอร์ `aa_tracker`
2. ใน Vercel **Settings -> Environment Variables** ใส่ค่า 3 ตัวจากขั้นตอนที่ 1:
   * `NEXT_PUBLIC_SUPABASE_URL`
   * `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   * `SUPABASE_SERVICE_ROLE_KEY`
3. กด **Deploy**

---

## ขั้นตอนที่ 4: ใช้งานจริงใน MuMu
1. เปิดเว็บที่ Deploy เสร็จ -> กด **Login with Discord**
2. เข้าแท็บ **API Keys** -> กด **Create API Key** (ใส่ Discord Webhook URL ด้วยถ้าอยากให้แจ้งเตือน Rare Drop)
3. ก๊อปโค้ด Config ด้านขวาไปวางหัวไฟล์ `aa_tracker.lua` แล้วรันใน MuMu ได้เลย!
