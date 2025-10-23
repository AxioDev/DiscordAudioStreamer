import AppShell from '@frontend/AppShell';

interface SitePageProps {
  params: { slug?: string[] };
  searchParams?: Record<string, string | string[] | undefined>;
}

function buildInitialUrl(params: SitePageProps['params'], searchParams: SitePageProps['searchParams']) {
  const segments = Array.isArray(params?.slug) ? params.slug : [];
  const pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}` || '/';
  const query = new URLSearchParams();

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === 'string') {
        query.append(key, value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          query.append(key, item);
        }
      }
    }
  }

  const queryString = query.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export default function SitePage({ params, searchParams }: SitePageProps) {
  const initialUrl = buildInitialUrl(params, searchParams);
  return <AppShell initialUrl={initialUrl} />;
}
