import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const providerError = searchParams.get("error");
  const providerErrorDescription = searchParams.get("error_description");
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") ? nextParam : "/dashboard";

  if (providerError) {
    const message = providerErrorDescription || providerError;
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(`Google sign in failed: ${message}`)}`
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(`OAuth session exchange failed: ${error.message}`)}`
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Missing OAuth code in callback")}`
  );
}