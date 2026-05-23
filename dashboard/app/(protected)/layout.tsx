import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";
import { SideNav } from "@/components/SideNav";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookie = cookies().get(COOKIE_NAME)?.value;
  const secret = process.env.DASHBOARD_SESSION_SECRET || "";
  if (!secret || !verifySession(secret, cookie)) {
    redirect("/login");
  }
  return (
    <div className="md:pl-56 min-h-svh pb-20 md:pb-8">
      <SideNav />
      <div className="max-w-[720px] mx-auto px-4 md:px-8 py-6 md:py-10">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
