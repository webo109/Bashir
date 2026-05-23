"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shake, setShake] = useState(false);

  // Browser autofill doesn't fire onChange in React. Sync state from the DOM
  // shortly after mount so the Enter button doesn't appear disabled on autofilled
  // passwords.
  useEffect(() => {
    const t = setTimeout(() => {
      const v = inputRef.current?.value ?? "";
      if (v && v !== pw) setPw(v);
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = pw || inputRef.current?.value || "";
    setPending(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: value }),
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
          ref={inputRef}
          type="password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          autoComplete="current-password"
          className={shake ? "animate-[shake_0.4s]" : ""}
        />
        {error && <p className="text-sm text-[#C45A3D]">{error}</p>}
        <Button
          type="submit"
          disabled={pending}
          className="bg-[#1A1614] text-[#FBFAF7] hover:bg-[#3D362F]"
        >
          {pending ? "…" : "Enter"}
        </Button>
      </form>
    </main>
  );
}
