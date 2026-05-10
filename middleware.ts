import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session cookie on every request (required by @supabase/ssr)
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const { hostname } = request.nextUrl;

  const isAuthRoute       = pathname.startsWith("/auth");
  const isLoginRoute      = pathname === "/login";
  const isOnboardingRoute = pathname === "/onboarding";
  const isResetRoute      = pathname.startsWith("/auth/reset-password");
  const isPublicApiRoute  = pathname === "/api/places/autocomplete";
  const isQaRoute         = pathname === "/qa" || pathname.startsWith("/qa/");
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost");

  // Keep /qa local-only. In non-local environments it should not be reachable.
  if (isQaRoute && !isLocalhost) {
    const notFoundUrl = request.nextUrl.clone();
    notFoundUrl.pathname = "/404";
    return NextResponse.rewrite(notFoundUrl, { status: 404 });
  }

  // 1. Not logged in → send to /login
  if (!user && !isLoginRoute && !isAuthRoute && !isPublicApiRoute && !isQaRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 2. Logged in but trying to see /login → send home
  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // 3. Logged in but onboarding not done → send to /onboarding
  //    (skip if already on onboarding, any /auth/** route, or reset-password)
  const onboardingDone = !!user?.user_metadata?.username;
  if (user && !onboardingDone && !isOnboardingRoute && !isAuthRoute && !isResetRoute && !isPublicApiRoute && !isQaRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    return NextResponse.redirect(url);
  }

  // 4. Onboarding done, don't let them back to /onboarding
  if (user && onboardingDone && isOnboardingRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
