"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Loader } from "@/components/Loader";

function CallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { loginWithGoogleCode } = useAuth();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const code = params.get("code");
    if (!code) {
      router.replace("/login?error=google");
      return;
    }
    const redirectUri = `${window.location.origin}/auth/google/callback`;
    loginWithGoogleCode(code, redirectUri)
      .then(() => router.replace("/chat"))
      .catch(() => router.replace("/login?error=google"));
  }, [params, router, loginWithGoogleCode]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface">
      <Loader label="Completing Google sign-in" />
    </main>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense>
      <CallbackInner />
    </Suspense>
  );
}
