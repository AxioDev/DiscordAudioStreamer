import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Admin,
  BooleanInput,
  Create,
  Datagrid,
  DateField,
  DateTimeInput,
  DeleteButton,
  Edit,
  EditButton,
  FunctionField,
  List,
  Resource,
  Show,
  SimpleForm,
  SimpleShowLayout,
  TextField,
  TextInput,
  useRecordContext,
} from 'react-admin';
import type { DataProvider } from 'react-admin';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { frFR as muiFrFR } from '@mui/material/locale';
import polyglotI18nProvider from 'ra-i18n-polyglot';
import frenchMessages from 'ra-language-french';

const AUTH_STORAGE_KEY = 'la_admin_basic_token';
const API_BASE = '/admin';

interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  json: T;
}

type BlogPostPayload = {
  slug: string;
  title: string;
  excerpt: string | null;
  contentMarkdown: string;
  coverImageUrl: string | null;
  tags: string[];
  seoDescription: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
};

type HiddenMemberPayload = {
  userId: string;
  idea?: string | null;
};

const safeJsonParse = <T,>(input: string | null): T | null => {
  if (!input) {
    return null;
  }
  try {
    return JSON.parse(input) as T;
  } catch (error) {
    console.warn('Impossible de parser la réponse JSON', error);
    return null;
  }
};

const httpClient = async <T,>(url: string, options: RequestInit = {}): Promise<HttpResponse<T>> => {
  const token = window.localStorage.getItem(AUTH_STORAGE_KEY);
  const headers = new Headers(options.headers || { Accept: 'application/json' });

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Basic ${token}`);
  }

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  const json = text ? safeJsonParse<T>(text) : (null as T | null);

  if (!response.ok) {
    const error: Error & { status?: number } = new Error(
      (json as Record<string, unknown> | null)?.message as string || response.statusText || 'Erreur de requête',
    );
    error.status = response.status;
    throw error;
  }

  return { status: response.status, headers: response.headers, json: (json as T) ?? ({} as T) };
};

const authProvider = {
  login: async ({ username, password }: { username: string; password: string }) => {
    if (!username || !password) {
      throw new Error('Identifiants requis');
    }
    const token = window.btoa(`${username}:${password}`);
    const response = await fetch(`${API_BASE}`, {
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error('Authentification impossible, vérifiez vos identifiants.');
    }
    window.localStorage.setItem(AUTH_STORAGE_KEY, token);
  },
  logout: async () => {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  },
  checkAuth: async () => {
    if (!window.localStorage.getItem(AUTH_STORAGE_KEY)) {
      throw new Error('AUTH_REQUIRED');
    }
  },
  checkError: async (error: { status?: number }) => {
    if (error.status === 401 || error.status === 403) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      throw error;
    }
  },
  getIdentity: async () => {
    const token = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!token) {
      throw new Error('AUTH_REQUIRED');
    }
    try {
      const decoded = window.atob(token);
      const username = decoded.split(':')[0] ?? 'admin';
      return { id: username, fullName: username };
    } catch (error) {
      console.warn('Impossible de décoder le jeton administrateur', error);
      return { id: 'admin', fullName: 'Administrateur' };
    }
  },
  getPermissions: async () => null,
};

const buildListQuery = (params: {
  pagination?: { page: number; perPage: number };
  sort?: { field?: string; order?: string };
  filter?: Record<string, unknown>;
}): string => {
  const searchParams = new URLSearchParams();
  const page = params.pagination?.page ?? 1;
  const perPage = params.pagination?.perPage ?? 25;
  searchParams.set('page', String(page));
  searchParams.set('perPage', String(perPage));
  if (params.sort?.field) {
    searchParams.set('sort', params.sort.field);
  }
  if (params.sort?.order) {
    searchParams.set('order', params.sort.order);
  }
  if (params.filter) {
    searchParams.set('filter', JSON.stringify(params.filter));
  }
  return searchParams.toString();
};

const normalizeDateForApi = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const prepareBlogPostPayload = (data: Record<string, unknown>): BlogPostPayload => {
  const tags = Array.isArray(data.tags)
    ? (data.tags as unknown[])
        .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter((tag) => tag.length > 0)
    : [];

  return {
    slug: typeof data.slug === 'string' ? data.slug : '',
    title: typeof data.title === 'string' ? data.title : '',
    excerpt: typeof data.excerpt === 'string' ? data.excerpt : null,
    contentMarkdown: typeof data.contentMarkdown === 'string' ? data.contentMarkdown : '',
    coverImageUrl: typeof data.coverImageUrl === 'string' ? data.coverImageUrl : null,
    tags,
    seoDescription: typeof data.seoDescription === 'string' ? data.seoDescription : null,
    publishedAt: normalizeDateForApi(data.publishedAt),
    updatedAt: normalizeDateForApi(data.updatedAt),
  };
};

const prepareHiddenMemberPayload = (data: Record<string, unknown>): HiddenMemberPayload => ({
  userId: typeof data.userId === 'string' ? data.userId.trim() : '',
  idea: typeof data.idea === 'string' ? data.idea : null,
});

const fetchBlogPost = async (id: string) => {
  const { json } = await httpClient<{ data: Record<string, unknown> }>(
    `${API_BASE}/blog/posts/${encodeURIComponent(id)}`,
  );
  return json?.data as Record<string, unknown>;
};

const fetchHiddenMember = async (id: string) => {
  const { json } = await httpClient<{ data: Record<string, unknown> }>(
    `${API_BASE}/members/hidden/${encodeURIComponent(id)}`,
  );
  return json?.data as Record<string, unknown>;
};

const dataProvider: DataProvider = {
  getList: async (resource, params) => {
    switch (resource) {
      case 'blog-posts': {
        const query = buildListQuery(params);
        const { json } = await httpClient<{ data: Record<string, unknown>[]; total: number }>(
          `${API_BASE}/blog/posts?${query}`,
        );
        return {
          data: json?.data ?? [],
          total: json?.total ?? 0,
        };
      }
      case 'users': {
        const { json } = await httpClient<{ data: Record<string, unknown>[]; total: number }>(
          `${API_BASE}/members/hidden`,
        );
        return {
          data: json?.data ?? [],
          total: json?.total ?? 0,
        };
      }
      default:
        throw new Error(`Ressource inconnue: ${resource}`);
    }
  },
  getOne: async (resource, params) => {
    switch (resource) {
      case 'blog-posts':
        return { data: await fetchBlogPost(String(params.id)) };
      case 'users':
        return { data: await fetchHiddenMember(String(params.id)) };
      default:
        throw new Error(`Ressource inconnue: ${resource}`);
    }
  },
  getMany: async (resource, params) => {
    const data = await Promise.all(params.ids.map((id) => dataProvider.getOne(resource, { id }).then((response) => response.data)));
    return { data };
  },
  getManyReference: async () => ({ data: [], total: 0 }),
  create: async (resource, params) => {
    switch (resource) {
      case 'blog-posts': {
        const payload = prepareBlogPostPayload(params.data);
        const { json } = await httpClient<{ data: Record<string, unknown> }>(`${API_BASE}/blog/posts`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return { data: json?.data ?? payload };
      }
      case 'users': {
        const payload = prepareHiddenMemberPayload(params.data);
        if (!payload.userId) {
          throw new Error("L'identifiant utilisateur est obligatoire.");
        }
        const { json } = await httpClient<{ data: Record<string, unknown> }>(
          `${API_BASE}/members/${encodeURIComponent(payload.userId)}/hide`,
          {
            method: 'POST',
            body: JSON.stringify({ idea: payload.idea ?? null }),
          },
        );
        return { data: json?.data ?? payload };
      }
      default:
        throw new Error(`Création non disponible pour ${resource}`);
    }
  },
  update: async (resource, params) => {
    switch (resource) {
      case 'blog-posts': {
        const payload = prepareBlogPostPayload(params.data);
        const { json } = await httpClient<{ data: Record<string, unknown> }>(
          `${API_BASE}/blog/posts/${encodeURIComponent(String(params.id))}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          },
        );
        return { data: json?.data ?? payload };
      }
      case 'users': {
        const payload = prepareHiddenMemberPayload(params.data);
        if (!payload.userId) {
          throw new Error("L'identifiant utilisateur est obligatoire.");
        }
        const { json } = await httpClient<{ data: Record<string, unknown> }>(
          `${API_BASE}/members/${encodeURIComponent(payload.userId)}/hide`,
          {
            method: 'POST',
            body: JSON.stringify({ idea: payload.idea ?? null }),
          },
        );
        return { data: json?.data ?? payload };
      }
      default:
        throw new Error(`Mise à jour non disponible pour ${resource}`);
    }
  },
  updateMany: async (resource, params) => {
    const results = await Promise.all(
      params.ids.map((id) => dataProvider.update(resource, { id, data: params.data, previousData: params.previousData })),
    );
    return { data: results.map((entry) => entry.data?.id ?? entry.data?.slug ?? entry.data?.userId) };
  },
  delete: async (resource, params) => {
    switch (resource) {
      case 'blog-posts':
        await httpClient(`${API_BASE}/blog/posts/${encodeURIComponent(String(params.id))}`, { method: 'DELETE' });
        return { data: { id: params.id } };
      case 'users':
        await httpClient(`${API_BASE}/members/${encodeURIComponent(String(params.id))}/hide`, { method: 'DELETE' });
        return { data: { id: params.id } };
      default:
        throw new Error(`Suppression non disponible pour ${resource}`);
    }
  },
  deleteMany: async (resource, params) => {
    const results = await Promise.all(params.ids.map((id) => dataProvider.delete(resource, { id })));
    return { data: results.map((entry) => entry.data?.id) };
  },
};

const TagsField: React.FC<{ source?: string }> = ({ source = 'tags' }) => {
  const record = useRecordContext<Record<string, unknown>>();
  const value = record?.[source];
  if (!Array.isArray(value) || value.length === 0) {
    return <span>Aucun</span>;
  }
  return <span>{value.join(', ')}</span>;
};

const blogPostFilters = [
  <TextInput key="search" source="q" label="Recherche" alwaysOn />,
  <TextInput key="tags" source="tags" label="Tags (séparés par des virgules)" />,
  <BooleanInput key="onlyPublished" source="onlyPublished" label="Publiés uniquement" />,
];

const BlogPostList: React.FC = (props) => (
  <List {...props} filters={blogPostFilters} sort={{ field: 'updatedAt', order: 'DESC' }}>
    <Datagrid rowClick="edit">
      <TextField source="title" label="Titre" />
      <TextField source="slug" label="Slug" />
      <DateField source="publishedAt" label="Publication" showTime />
      <DateField source="updatedAt" label="Mise à jour" showTime />
      <EditButton />
      <DeleteButton />
    </Datagrid>
  </List>
);

const TagsInputParse = (value: string | undefined): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    : [];

const TagsInputFormat = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';

const BlogPostFormFields: React.FC<{ disableSlug?: boolean }> = ({ disableSlug = false }) => (
  <>
    <TextInput source="slug" label="Slug" disabled={disableSlug} required fullWidth />
    <TextInput source="title" label="Titre" required fullWidth />
    <TextInput source="excerpt" label="Accroche" multiline fullWidth />
    <TextInput source="coverImageUrl" label="Image de couverture" fullWidth />
    <TextInput source="seoDescription" label="Description SEO" multiline fullWidth />
    <TextInput
      source="tags"
      label="Tags"
      helperText="Séparer les tags par des virgules"
      format={TagsInputFormat}
      parse={TagsInputParse}
      fullWidth
    />
    <DateTimeInput source="publishedAt" label="Publié le" />
    <DateTimeInput source="updatedAt" label="Mis à jour" />
    <TextInput source="contentMarkdown" label="Contenu (Markdown)" multiline minRows={12} fullWidth />
  </>
);

const BlogPostCreate: React.FC = (props) => (
  <Create {...props} mutationMode="pessimistic">
    <SimpleForm>
      <BlogPostFormFields />
    </SimpleForm>
  </Create>
);

const BlogPostEdit: React.FC = (props) => (
  <Edit {...props} mutationMode="pessimistic">
    <SimpleForm>
      <BlogPostFormFields disableSlug />
    </SimpleForm>
  </Edit>
);

const BlogPostShow: React.FC = (props) => (
  <Show {...props}>
    <SimpleShowLayout>
      <TextField source="title" label="Titre" />
      <TextField source="slug" label="Slug" />
      <TagsField source="tags" />
      <DateField source="publishedAt" label="Publication" showTime />
      <DateField source="updatedAt" label="Mise à jour" showTime />
      <FunctionField
        label="Contenu"
        render={(record?: Record<string, unknown>) => (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.875rem' }}>
            {record?.contentMarkdown as string}
          </pre>
        )}
      />
    </SimpleShowLayout>
  </Show>
);

const HiddenMemberList: React.FC = (props) => (
  <List {...props} sort={{ field: 'hiddenAt', order: 'DESC' }}>
    <Datagrid>
      <TextField source="userId" label="Identifiant" />
      <TextField source="idea" label="Motif" />
      <DateField source="hiddenAt" label="Masqué le" showTime />
      <DeleteButton />
    </Datagrid>
  </List>
);

const HiddenMemberCreate: React.FC = (props) => (
  <Create {...props} mutationMode="pessimistic">
    <SimpleForm>
      <TextInput source="userId" label="Identifiant utilisateur" required fullWidth />
      <TextInput source="idea" label="Motif" fullWidth />
    </SimpleForm>
  </Create>
);

const HiddenMemberEdit: React.FC = (props) => (
  <Edit {...props} mutationMode="pessimistic">
    <SimpleForm>
      <TextInput source="userId" label="Identifiant utilisateur" disabled fullWidth />
      <TextInput source="idea" label="Motif" fullWidth />
      <TextInput
        source="hiddenAt"
        label="Masqué le"
        disabled
        format={(value: unknown) => (value ? new Date(value as string).toLocaleString('fr-FR') : '')}
        parse={(value) => value}
      />
    </SimpleForm>
  </Edit>
);

const i18nProvider = polyglotI18nProvider(() => frenchMessages, 'fr');

const theme = createTheme({}, muiFrFR);

const App: React.FC = () => (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <Admin
      title="Libre Antenne · Administration"
      dataProvider={dataProvider}
      authProvider={authProvider}
      i18nProvider={i18nProvider}
      basename="/admin"
    >
      <Resource name="blog-posts" list={BlogPostList} edit={BlogPostEdit} create={BlogPostCreate} show={BlogPostShow} />
      <Resource name="users" list={HiddenMemberList} edit={HiddenMemberEdit} create={HiddenMemberCreate} />
    </Admin>
  </ThemeProvider>
);

const container = document.getElementById('admin-root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
