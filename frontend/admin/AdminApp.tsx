// @ts-nocheck
import * as React from 'react';
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
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import CircularProgress from '@mui/material/CircularProgress';
import CssBaseline from '@mui/material/CssBaseline';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
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

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

const buildDailyIssues = (status: DailyArticleStatus): string[] => {
  const issues: string[] = [];
  if (!status.dependencies.configEnabled) {
    issues.push('Désactivé via OPENAI_DAILY_ARTICLE_DISABLED=1.');
  }
  if (!status.dependencies.openAI) {
    issues.push('Clé API OpenAI absente ou invalide.');
  }
  if (!status.dependencies.blogRepository) {
    issues.push('Référentiel de blog indisponible.');
  }
  if (!status.dependencies.voiceActivityRepository) {
    issues.push('Transcriptions vocales indisponibles.');
  }
  return issues;
};

const buildPersonaIssues = (status: UserPersonaStatus): string[] => {
  const issues: string[] = [];
  if (!status.dependencies.configEnabled) {
    issues.push('Désactivé via OPENAI_PERSONA_DISABLED=1.');
  }
  if (!status.dependencies.openAI) {
    issues.push('Clé API OpenAI absente ou invalide.');
  }
  if (!status.dependencies.voiceActivityRepository) {
    issues.push("Référentiel d'activité indisponible.");
  }
  return issues;
};

const summarizeDailyResult = (status: DailyArticleStatus): string => {
  if (!status.lastResult) {
    return 'Aucune génération effectuée pour le moment.';
  }
  switch (status.lastResult.status) {
    case 'generated': {
      const slug = status.lastResult.slug ? ` (${status.lastResult.slug})` : '';
      return `Dernier article généré avec succès${slug}.`;
    }
    case 'skipped':
      return "Dernier cycle ignoré : pas assez de contenus exploitables.";
    case 'failed': {
      const reason = status.lastResult.error || status.lastResult.reason || 'raison inconnue';
      return `Dernier essai en échec (${reason}).`;
    }
    default:
      return 'Historique de génération indisponible.';
  }
};

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

type DailyArticleGenerationResult = {
  status: 'generated' | 'skipped' | 'failed';
  slug: string | null;
  title?: string;
  publishedAt?: string;
  tags?: string[];
  reason?: string;
  error?: string;
};

type DailyArticleStatus = {
  enabled: boolean;
  running: boolean;
  nextRunAt: string | null;
  lastResult: DailyArticleGenerationResult | null;
  dependencies: {
    openAI: boolean;
    blogRepository: boolean;
    voiceActivityRepository: boolean;
    configEnabled: boolean;
  };
};

type UserPersonaStatus = {
  enabled: boolean;
  running: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  dependencies: {
    openAI: boolean;
    voiceActivityRepository: boolean;
    configEnabled: boolean;
  };
};

type AdminOverview = {
  timestamp: string;
  dailyArticle: DailyArticleStatus;
  userPersona: UserPersonaStatus;
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

const Dashboard: React.FC = () => {
  const [state, setState] = React.useState<{
    loading: boolean;
    data: AdminOverview | null;
    error: Error | null;
  }>({ loading: true, data: null, error: null });

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { json } = await httpClient<AdminOverview>(`${API_BASE}`);
        if (!cancelled) {
          setState({ loading: false, data: json, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ loading: false, data: null, error: error as Error });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const dailyStatus = state.data?.dailyArticle;
  const personaStatus = state.data?.userPersona;

  return (
    <Stack spacing={3} sx={{ padding: 3, maxWidth: 960 }}>
      <Typography variant="h4" component="h1">
        Services IA & conformité
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Dernière mise à jour : {formatDateTime(state.data?.timestamp)}
      </Typography>

      {state.loading ? (
        <Stack direction="row" spacing={2} alignItems="center">
          <CircularProgress size={24} />
          <Typography variant="body2">Chargement des statuts…</Typography>
        </Stack>
      ) : state.error ? (
        <Alert severity="error">{state.error.message}</Alert>
      ) : (
        <>
          {dailyStatus ? (
            <Card variant="outlined">
              <CardHeader title="Journal automatique IA" subheader="DailyArticleService" />
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Statut : {dailyStatus.enabled ? 'activé' : 'désactivé'}
                </Typography>
                <Typography variant="body2">
                  Prochaine exécution planifiée : {formatDateTime(dailyStatus.nextRunAt)}
                </Typography>
                <Typography variant="body2">{summarizeDailyResult(dailyStatus)}</Typography>
                <Typography variant="body2" sx={{ marginTop: 2 }}>
                  Pour suspendre la génération automatique, définis la variable d’environnement{' '}
                  <code style={{ marginLeft: 4, marginRight: 4 }}>OPENAI_DAILY_ARTICLE_DISABLED=1</code>
                  {' '}ou retire la clé <code>OPENAI_API_KEY</code> puis redémarre le bot. Une demande peut aussi être envoyée à{' '}
                  <a href="mailto:axiocontactezmoi@protonmail.com" style={{ marginLeft: 4 }}>
                    axiocontactezmoi@protonmail.com
                  </a>{' '}
                  pour une désactivation immédiate.
                </Typography>
                {!dailyStatus.enabled && dailyStatus.dependencies.configEnabled && (
                  <Alert severity="info" sx={{ marginTop: 2 }}>
                    Le service est stoppé mais pourra être relancé lorsque les dépendances seront rétablies.
                  </Alert>
                )}
                {buildDailyIssues(dailyStatus).length > 0 && (
                  <Alert severity="warning" sx={{ marginTop: 2 }}>
                    {buildDailyIssues(dailyStatus).join(' ')}
                  </Alert>
                )}
                <Button
                  sx={{ marginTop: 2 }}
                  variant="outlined"
                  size="small"
                  component="a"
                  href="/cgu#transferts-internationaux"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Consulter la politique de données
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Alert severity="info">Statut du journal automatique indisponible.</Alert>
          )}

          {personaStatus ? (
            <Card variant="outlined">
              <CardHeader title="Profils IA des membres" subheader="UserPersonaService" />
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Statut : {personaStatus.enabled ? 'activé' : 'désactivé'}
                </Typography>
                <Typography variant="body2">
                  Prochaine exécution planifiée : {formatDateTime(personaStatus.nextRunAt)}
                </Typography>
                <Typography variant="body2">
                  Dernière exécution : {formatDateTime(personaStatus.lastRunAt)}
                </Typography>
                <Typography variant="body2" sx={{ marginTop: 2 }}>
                  Pour arrêter la génération des fiches, définis{' '}
                  <code style={{ marginLeft: 4, marginRight: 4 }}>OPENAI_PERSONA_DISABLED=1</code>{' '}
                  (ou retire la clé <code>OPENAI_API_KEY</code>) et redémarre le service. Les membres peuvent demander un retrait
                  ou une anonymisation via{' '}
                  <a href="mailto:axiocontactezmoi@protonmail.com" style={{ marginLeft: 4 }}>
                    axiocontactezmoi@protonmail.com
                  </a>{' '}ou dans le salon Discord #support.
                </Typography>
                {buildPersonaIssues(personaStatus).length > 0 && (
                  <Alert severity="warning" sx={{ marginTop: 2 }}>
                    {buildPersonaIssues(personaStatus).join(' ')}
                  </Alert>
                )}
                <Button
                  sx={{ marginTop: 2 }}
                  variant="outlined"
                  size="small"
                  component="a"
                  href="/cgu#transferts-internationaux"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Voir les garanties de transfert
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Alert severity="info">Statut des fiches membres indisponible.</Alert>
          )}
        </>
      )}
    </Stack>
  );
};

const theme = createTheme({}, muiFrFR);

const AdminApp: React.FC = () => (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <Admin
      title="Libre Antenne · Administration"
      dataProvider={dataProvider}
      authProvider={authProvider}
      i18nProvider={i18nProvider}
      basename="/admin"
      dashboard={Dashboard}
    >
      <Resource name="blog-posts" list={BlogPostList} edit={BlogPostEdit} create={BlogPostCreate} show={BlogPostShow} />
      <Resource name="users" list={HiddenMemberList} edit={HiddenMemberEdit} create={HiddenMemberCreate} />
    </Admin>
  </ThemeProvider>
);

export default AdminApp;
