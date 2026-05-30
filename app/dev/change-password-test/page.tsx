import { permanentRedirect } from 'next/navigation';

// HVA-76: change-password lifted to /profile/change-password. The dev path
// 308s so any stale bookmark / muscle-memory link still works.
export const dynamic = 'force-dynamic';

export default function ChangePasswordTestRedirect() {
  permanentRedirect('/profile/change-password');
}
