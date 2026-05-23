"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shake, setShake] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setPending(false);
    if (res.ok) {
      router.push("/today");
      router.refresh();
    } else {
      setError("Try again.");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
  }

  return (
    <main className="min-h-svh flex items-center justify-center bg-[#FBFAF7] px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[#ECE7DD] p-8 flex flex-col gap-4 text-center"
      >
        <div>
          <h1 className="font-serif text-3xl text-[#1A1614]">
            Bashir <span className="text-[#9C7847] text-2xl ml-1">بشير</span>
          </h1>
          <p className="text-xs uppercase tracking-wider text-[#7A7066] mt-1">
            Bearer of good news
          </p>
        </div>
        <Input
          type="password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          className={shake ? "animate-[shake_0.4s]" : ""}
        />
        {error && <p className="text-sm text-[#C45A3D]">{error}</p>}
        <Button type="submit" disabled={pending || !pw}>
          {pending ? "…" : "Enter"}
        </Button>
      </form>
    </main>
  );
}
