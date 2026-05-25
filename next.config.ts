import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone/server.js (self-contained Node bundle) so the
  // Docker runtime image can be minimal. See infra/docker/README.md.
  output: "standalone",

  // HVA-89: admin URL consolidation. Old admin URLs redirect to the new
  // /admin/settings/<group>/<page> hierarchy so existing bookmarks /
  // notification deep-links continue to work after the move.
  async redirects() {
    return [
      { source: "/admin/captains", destination: "/admin/settings/organization/captains", permanent: true },
      { source: "/admin/captains/:path*", destination: "/admin/settings/organization/captains/:path*", permanent: true },
      { source: "/admin/executives", destination: "/admin/settings/organization/executives", permanent: true },
      { source: "/admin/executives/:path*", destination: "/admin/settings/organization/executives/:path*", permanent: true },
      { source: "/admin/content/resources", destination: "/admin/settings/audit-content/resources", permanent: true },
      { source: "/admin/content/resources/:path*", destination: "/admin/settings/audit-content/resources/:path*", permanent: true },
      { source: "/admin/content/categories", destination: "/admin/settings/audit-content/categories", permanent: true },
      { source: "/admin/content/categories/:path*", destination: "/admin/settings/audit-content/categories/:path*", permanent: true },
      { source: "/admin/content/announcements", destination: "/admin/settings/audit-content/announcements", permanent: true },
      { source: "/admin/content/announcements/:path*", destination: "/admin/settings/audit-content/announcements/:path*", permanent: true },
      { source: "/admin/settings/system/customer-support-phone", destination: "/admin/settings/notifications/customer-support-phone", permanent: true },
    ];
  },
};

export default nextConfig;
