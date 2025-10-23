'use client';

import dynamic from 'next/dynamic';

const AdminApp = dynamic(() => import('@frontend/admin/AdminApp'), {
  ssr: false,
  loading: () => <div className="flex min-h-screen items-center justify-center">Chargement de l’interface admin…</div>,
});

export default function AdminPage() {
  return <AdminApp />;
}
