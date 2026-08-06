import { AuthPageSkeleton } from '@/components/states';

/**
 * D-5, D-8. Name, email and password.
 *
 * `(auth)/layout.tsx` supplies no chrome — each page renders `AuthShell` itself — so this
 * fallback reproduces the centred card, header height and gutters. A bare page skeleton here
 * painted edge to edge and the real form then snapped into a 448 px card below a 64 px header.
 */
export default function AuthSignupLoading() {
  return <AuthPageSkeleton fields={3} />;
}
