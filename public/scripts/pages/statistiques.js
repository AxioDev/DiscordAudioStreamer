import {
  Fragment,
  html,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Activity,
  AlertCircle,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  MessageSquare,
  Mic,
  RefreshCcw,
  Search,
  Users,
  X,
} from '../core/deps.js';
import { loadChart } from '../core/chart-loader.js';

const RANGE_PRESETS = [
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: '90d', label: '90 jours' },
  { value: '180d', label: '6 mois' },
  { value: '365d', label: '12 mois' },
  { value: 'custom', label: 'Personnalisé' },
];

const GRANULARITY_OPTIONS = [
  { value: 'day', label: 'Quotidien' },
  { value: 'week', label: 'Hebdomadaire' },
  { value: 'month', label: 'Mensuel' },
  { value: 'year', label: 'Annuel' },
];

const ACTIVITY_FILTERS = [
  { value: 'voice', label: 'Vocal' },
  { value: 'text', label: 'Texte' },
  { value: 'arrivals', label: 'Arrivées' },
  { value: 'departures', label: 'Départs' },
  { value: 'mentions', label: 'Mentions' },
  { value: 'hype', label: 'Hype' },
];

const DEFAULT_ACTIVITY_TYPES = new Set(ACTIVITY_FILTERS.map((entry) => entry.value));

const DAY_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const normalizeSearch = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .normalize('NFD')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
};

const formatInteger = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  return numeric.toLocaleString('fr-FR');
};

const formatMinutes = (minutes) => {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '0 min';
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remaining = Math.round(minutes % 60);
    if (remaining === 0) {
      return `${hours} h`;
    }
    return `${hours} h ${remaining} min`;
  }
  return `${Math.round(minutes)} min`;
};

const formatPercentage = (value) => {
  if (!Number.isFinite(value)) {
    return '0%';
  }
  return `${(value * 100).toFixed(1)}%`;
};

const formatIsoDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
};

const deriveInitialFilters = (params = {}) => {
  const normalizedRange = typeof params.range === 'string' ? params.range.trim() : null;
  const sinceParam = typeof params.since === 'string' ? params.since.trim() : '';
  const untilParam = typeof params.until === 'string' ? params.until.trim() : '';
  const hasCustomRange = sinceParam || untilParam;
  const rangePreset = hasCustomRange
    ? 'custom'
    : RANGE_PRESETS.some((preset) => preset.value === normalizedRange)
      ? normalizedRange
      : '30d';
  const granularityParam = typeof params.granularity === 'string' ? params.granularity.trim().toLowerCase() : '';
  const granularity = GRANULARITY_OPTIONS.some((option) => option.value === granularityParam)
    ? granularityParam
    : 'week';
  const activityParam = typeof params.activity === 'string' ? params.activity : '';
  const selectedActivities = (() => {
    const set = new Set(DEFAULT_ACTIVITY_TYPES);
    if (!activityParam) {
      return set;
    }
    const tokens = activityParam
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => DEFAULT_ACTIVITY_TYPES.has(token));
    if (tokens.length === 0) {
      return set;
    }
    return new Set(tokens);
  })();
  const channelsParam = typeof params.channels === 'string' ? params.channels : '';
  const selectedChannels = channelsParam
    ? Array.from(
        new Set(
          channelsParam
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      )
    : [];
  const userId = typeof params.userId === 'string' && params.userId.trim().length > 0 ? params.userId.trim() : null;
  const includeHeatmap = params.heatmap === 'false' || params.heatmap === '0' ? false : true;
  const includeHypeHistory = params.hype === 'false' || params.hype === '0' ? false : true;

  return {
    rangePreset,
    customSince: rangePreset === 'custom' ? sinceParam : '',
    customUntil: rangePreset === 'custom' ? untilParam : '',
    granularity,
    activityTypes: selectedActivities,
    selectedChannels,
    userId,
    includeHeatmap,
    includeHypeHistory,
    limitTopMembers: 15,
    limitChannels: 12,
    userSearch: null,
  };
};

const buildRouteParams = (filters) => {
  const params = {};
  if (filters.rangePreset === 'custom') {
    if (filters.customSince) {
      params.since = filters.customSince;
    }
    if (filters.customUntil) {
      params.until = filters.customUntil;
    }
  } else if (filters.rangePreset !== '30d') {
    params.range = filters.rangePreset;
  }
  if (filters.granularity && filters.granularity !== 'week') {
    params.granularity = filters.granularity;
  }
  const activityList = Array.from(filters.activityTypes).sort();
  if (activityList.length > 0 && activityList.length < DEFAULT_ACTIVITY_TYPES.size) {
    params.activity = activityList.join(',');
  }
  if (filters.selectedChannels.length > 0) {
    params.channels = filters.selectedChannels.join(',');
  }
  if (filters.userId) {
    params.userId = filters.userId;
  }
  if (!filters.includeHeatmap) {
    params.heatmap = 'false';
  }
  if (!filters.includeHypeHistory) {
    params.hype = 'false';
  }
  return params;
};

const computeRange = (filters) => {
  const now = new Date();
  let until = filters.rangePreset === 'custom' && filters.customUntil ? new Date(filters.customUntil) : now;
  if (!(until instanceof Date) || Number.isNaN(until.getTime())) {
    until = now;
  }
  let since;
  switch (filters.rangePreset) {
    case '7d':
      since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      since = new Date(until.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case '180d':
      since = new Date(until.getTime() - 180 * 24 * 60 * 60 * 1000);
      break;
    case '365d':
      since = new Date(until.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    case 'custom': {
      if (filters.customSince) {
        const parsed = new Date(filters.customSince);
        if (!Number.isNaN(parsed.getTime())) {
          since = parsed;
          break;
        }
      }
      since = new Date(until.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    }
    case '30d':
    default:
      since = new Date(until.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }
  if (filters.rangePreset === 'custom' && filters.customUntil) {
    const parsed = new Date(filters.customUntil);
    if (!Number.isNaN(parsed.getTime())) {
      until = parsed;
    }
  }
  if (filters.rangePreset === 'custom' && filters.customSince) {
    const parsed = new Date(filters.customSince);
    if (!Number.isNaN(parsed.getTime())) {
      since = parsed;
    }
  }
  if (since.getTime() > until.getTime()) {
    since = new Date(until.getTime() - 24 * 60 * 60 * 1000);
  }
  return { since, until };
};

const computeApiRequest = (filters) => {
  const { since, until } = computeRange(filters);
  const query = new URLSearchParams();
  query.set('since', since.toISOString());
  query.set('until', until.toISOString());
  if (filters.granularity) {
    query.set('granularity', filters.granularity);
  }
  const activityList = Array.from(filters.activityTypes).sort();
  if (activityList.length > 0) {
    query.set('activity', activityList.join(','));
  }
  if (filters.selectedChannels.length > 0) {
    query.set('channels', filters.selectedChannels.join(','));
  }
  if (filters.userId) {
    query.set('userId', filters.userId);
  }
  query.set('limitTop', String(filters.limitTopMembers));
  query.set('limitChannels', String(filters.limitChannels));
  query.set('heatmap', filters.includeHeatmap ? 'true' : 'false');
  query.set('hype', filters.includeHypeHistory ? 'true' : 'false');
  if (filters.userSearch) {
    query.set('userSearch', filters.userSearch);
  }
  return {
    queryString: query.toString(),
    since,
    until,
    routeParams: buildRouteParams(filters),
  };
};

const StatisticsChart = ({ type = 'line', data, options, height = 320 }) => {
  const canvasRef = useRef(null);
  const chartKey = useMemo(() => JSON.stringify({ data, options, type }), [data, options, type]);
  useEffect(() => {
    if (!canvasRef.current || !data) {
      return undefined;
    }

    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    let chartInstance = null;
    let isActive = true;

    loadChart()
      .then((Chart) => {
        if (!isActive) {
          return;
        }
        chartInstance = new Chart(context, {
          type,
          data,
          options,
        });
      })
      .catch((error) => {
        console.error('Failed to load chart library', error);
      });

    return () => {
      isActive = false;
      if (chartInstance) {
        chartInstance.destroy();
      }
    };
  }, [chartKey]);
  return html`<div class="w-full overflow-hidden rounded-xl bg-slate-900/70 p-4 shadow-inner shadow-slate-950/40">
    <canvas ref=${canvasRef} height=${height}></canvas>
  </div>`;
};

const MetricCard = ({ icon: Icon, label, value, sublabel, trend }) => {
  const trendClass = trend
    ? trend > 0
      ? 'text-emerald-300'
      : trend < 0
        ? 'text-rose-300'
        : 'text-slate-400'
    : 'text-slate-400';
  const trendLabel = trend != null ? `${trend > 0 ? '+' : ''}${(trend * 100).toFixed(1)}%` : null;
  return html`<div class="flex flex-1 min-w-[220px] items-center gap-4 rounded-2xl border border-slate-800/70 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/30">
    <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800/80 text-amber-300">
      ${Icon ? html`<${Icon} class="h-6 w-6" aria-hidden="true" />` : null}
    </div>
    <div class="flex flex-1 flex-col">
      <p class="text-sm uppercase tracking-wide text-slate-400">${label}</p>
      <p class="text-2xl font-semibold text-white">${value}</p>
      ${sublabel ? html`<p class="text-xs text-slate-400">${sublabel}</p>` : null}
    </div>
    ${trendLabel
      ? html`<div class="text-right text-sm font-medium ${trendClass}">${trendLabel}</div>`
      : null}
  </div>`;
};

const ChannelMultiSelect = ({
  id,
  channels = [],
  selectedIds = [],
  selectedDetails = [],
  onToggle,
  onClear,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const panelId = id ? `${id}-panel` : undefined;

  const selectedSet = useMemo(() => new Set(selectedIds.map((value) => String(value))), [selectedIds]);

  const pillDetails = useMemo(() => {
    if (selectedDetails && selectedDetails.length > 0) {
      return selectedDetails;
    }
    return selectedIds.map((channelId) => ({ channelId, channelName: channelId }));
  }, [selectedDetails, selectedIds]);

  const filteredChannels = useMemo(() => {
    if (!query) {
      return channels;
    }
    const normalized = normalizeSearch(query);
    if (!normalized) {
      return channels;
    }
    return channels.filter((channel) => (channel.searchLabel ?? '').includes(normalized));
  }, [channels, query]);

  const summaryLabel = useMemo(() => {
    if (pillDetails.length === 0) {
      return 'Tous les salons';
    }
    if (pillDetails.length === 1) {
      const channel = pillDetails[0];
      return channel.channelName ?? `Salon ${channel.channelId}`;
    }
    if (pillDetails.length === 2) {
      const [first, second] = pillDetails;
      return `${first.channelName ?? first.channelId}, ${second.channelName ?? second.channelId}`;
    }
    const [first, second] = pillDetails;
    return `${first.channelName ?? first.channelId}, ${second.channelName ?? second.channelId} +${pillDetails.length - 2}`;
  }, [pillDetails]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const handleSearchChange = useCallback((event) => {
    setQuery(event?.target?.value ?? '');
  }, []);

  const handleToggleOption = useCallback(
    (channelId) => {
      if (typeof onToggle === 'function') {
        onToggle(channelId);
      }
    },
    [onToggle],
  );

  const handleClear = useCallback(() => {
    if (typeof onClear === 'function') {
      onClear();
    }
  }, [onClear]);

  return html`<div class="space-y-3">
    <div class="relative" ref=${containerRef}>
      <button
        id=${id}
        type="button"
        class="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-800/70 bg-slate-900/80 px-3 py-2 text-left text-sm font-medium text-slate-200 shadow-inner shadow-slate-950/30 transition hover:border-slate-600 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
        aria-haspopup="listbox"
        aria-expanded=${open}
        aria-controls=${panelId}
        onClick=${() => setOpen((prev) => !prev)}
      >
        <span class="truncate">${summaryLabel}</span>
        <${ChevronDown}
          class=${`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      ${open
        ? html`<div
            id=${panelId}
            role="listbox"
            class="absolute left-0 right-0 top-full z-30 mt-2 w-full overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/95 shadow-xl shadow-slate-950/40 backdrop-blur supports-[backdrop-filter]:bg-slate-950/80"
          >
            <div class="border-b border-slate-800/70 bg-slate-900/60 p-3">
              <div class="flex items-center gap-2">
                <div class="relative flex-1">
                  <${Search}
                    class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                    aria-hidden="true"
                  />
                  <input
                    ref=${searchRef}
                    type="search"
                    placeholder="Rechercher un salon…"
                    class="w-full rounded-lg border border-slate-700/70 bg-slate-900/90 px-9 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                    value=${query}
                    onInput=${handleSearchChange}
                  />
                </div>
                ${selectedIds.length > 0
                  ? html`<button
                      type="button"
                      class="whitespace-nowrap rounded-lg border border-slate-700/70 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
                      onClick=${handleClear}
                    >
                      Tout effacer
                    </button>`
                  : null}
              </div>
            </div>
            <div class="max-h-64 overflow-y-auto py-2">
              ${filteredChannels.length > 0
                ? filteredChannels.map((channel) => {
                    const active = selectedSet.has(channel.channelId);
                    const optionLabel = channel.channelName ?? `Salon ${channel.channelId}`;
                    const typeLabel = channel.channelType === 'voice' ? 'Vocal' : channel.channelType === 'text' ? 'Texte' : '';
                    return html`<button
                      key=${channel.channelId}
                      type="button"
                      role="option"
                      aria-selected=${active}
                      class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800/60"
                      onClick=${() => handleToggleOption(channel.channelId)}
                    >
                      <span class="flex min-w-0 flex-1 items-center gap-2">
                        ${channel.channelType === 'voice'
                          ? html`<${Mic} class="h-4 w-4 text-violet-200/80" aria-hidden="true" />`
                          : channel.channelType === 'text'
                            ? html`<${MessageSquare} class="h-4 w-4 text-sky-200/80" aria-hidden="true" />`
                            : null}
                        <span class="truncate">${optionLabel}</span>
                      </span>
                      ${active
                        ? html`<span class="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-amber-200">
                            <${Check} class="h-4 w-4" aria-hidden="true" />
                          </span>`
                        : typeLabel
                          ? html`<span class="text-xs uppercase tracking-wide text-slate-500">${typeLabel}</span>`
                          : null}
                    </button>`;
                  })
                : html`<p class="px-4 py-3 text-sm text-slate-400">Aucun salon ne correspond à cette recherche.</p>`}
            </div>
          </div>`
        : null}
    </div>
    ${pillDetails.length > 0
      ? html`<div class="flex flex-wrap gap-2">
          ${pillDetails.map((channel) => {
            const label = channel.channelName ?? `Salon ${channel.channelId}`;
            return html`<span
              key=${`selected-${channel.channelId}`}
              class="inline-flex items-center gap-2 rounded-full bg-slate-800/80 px-3 py-1 text-xs text-slate-200"
            >
              <span class="max-w-[10rem] truncate sm:max-w-[12rem]">${label}</span>
              <button
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700/70 text-slate-300 transition hover:bg-slate-600"
                onClick=${() => handleToggleOption(channel.channelId)}
                aria-label=${`Retirer ${label}`}
              >
                <${X} class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>`;
          })}
          ${selectedIds.length > 0
            ? html`<button
                type="button"
                class="rounded-full border border-slate-700/70 px-3 py-1 text-xs font-semibold text-amber-200 transition hover:border-amber-300/60 hover:text-amber-100"
                onClick=${handleClear}
              >
                Effacer
              </button>`
            : null}
        </div>`
      : null}
  </div>`;
};

const deriveActivitySummary = (snapshot, filters) => {
  if (!snapshot) {
    return null;
  }
  const showVoice = filters.activityTypes.has('voice');
  const showText = filters.activityTypes.has('text');
  const labels = snapshot.activitySeries.map((entry) => entry.bucket);
  const datasets = [];
  if (showVoice) {
    datasets.push({
      label: 'Minutes vocales',
      data: snapshot.activitySeries.map((entry) => entry.voiceMinutes),
      borderColor: '#38bdf8',
      backgroundColor: 'rgba(56, 189, 248, 0.15)',
      tension: 0.3,
      fill: true,
    });
  }
  if (showText) {
    datasets.push({
      label: 'Messages envoyés',
      data: snapshot.activitySeries.map((entry) => entry.messageCount),
      borderColor: '#f472b6',
      backgroundColor: 'rgba(244, 114, 182, 0.15)',
      tension: 0.3,
      fill: true,
      yAxisID: showVoice ? 'y1' : 'y',
    });
  }
  const activeSeries = snapshot.activitySeries.map((entry) => entry.activeMembers);
  return {
    labels,
    datasets,
    activeSeries,
  };
};

const buildActivityChartConfig = (summary) => {
  if (!summary) {
    return null;
  }
  const labels = summary.labels.map((value) => {
    try {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
      }
    } catch (error) {
      // ignore
    }
    return value;
  });
  const datasets = summary.datasets.map((dataset, index) => ({
    ...dataset,
    borderWidth: 2,
    pointRadius: 0,
    order: index,
  }));
  return {
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          labels: { usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              if (context.dataset.label === 'Minutes vocales') {
                return `${context.dataset.label}: ${formatMinutes(context.parsed.y)}`;
              }
              if (context.dataset.label === 'Messages envoyés') {
                return `${context.dataset.label}: ${formatInteger(context.parsed.y)}`;
              }
              return `${context.dataset.label}: ${context.parsed.y}`;
            },
          },
        },
      },
      scales: {
        y: {
          title: { display: true, text: 'Minutes vocales' },
          ticks: {
            callback: (value) => formatMinutes(value),
          },
        },
        y1: {
          display: datasets.some((dataset) => dataset.yAxisID === 'y1'),
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            callback: (value) => formatInteger(value),
          },
          title: { display: datasets.some((dataset) => dataset.yAxisID === 'y1'), text: 'Messages' },
        },
      },
    },
  };
};

const buildNewMembersChart = (snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.newMembers) || snapshot.newMembers.length === 0) {
    return null;
  }
  const labels = snapshot.newMembers.map((entry) => {
    const date = new Date(entry.bucket);
    return Number.isNaN(date.getTime())
      ? entry.bucket
      : date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  });
  return {
    data: {
      labels,
      datasets: [
        {
          label: 'Nouveaux membres',
          data: snapshot.newMembers.map((entry) => entry.count),
          backgroundColor: 'rgba(34, 197, 94, 0.55)',
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => formatInteger(value),
          },
        },
      },
    },
  };
};

const buildHypeChart = (snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.hypeHistory) || snapshot.hypeHistory.length === 0) {
    return null;
  }
  const labels = snapshot.hypeHistory.map((entry) => {
    const date = new Date(entry.bucketStart);
    return Number.isNaN(date.getTime())
      ? entry.bucketStart
      : date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  });
  return {
    data: {
      labels,
      datasets: [
        {
          label: 'Score moyen normalisé',
          data: snapshot.hypeHistory.map((entry) => entry.averageSchScore ?? 0),
          borderColor: '#facc15',
          backgroundColor: 'rgba(250, 204, 21, 0.2)',
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => `${value}`,
          },
        },
      },
    },
  };
};

const buildChannelSeries = (channelActivity, limit) => {
  if (!channelActivity) {
    return { voice: [], text: [] };
  }
  const voice = channelActivity.voice
    .slice(0, limit)
    .map((entry) => ({
      id: entry.channelId ?? '–',
      name: entry.channelName ?? (entry.channelId ? `Salon ${entry.channelId}` : 'Salon vocal'),
      voiceMinutes: entry.voiceMinutes,
      activityScore: entry.voiceMinutes,
    }));
  const text = channelActivity.text
    .slice(0, limit)
    .map((entry) => ({
      id: entry.channelId ?? '–',
      name: entry.channelName ?? (entry.channelId ? `Salon ${entry.channelId}` : 'Salon textuel'),
      messageCount: entry.messageCount,
      activityScore: entry.messageCount,
    }));
  return { voice, text };
};

const buildHeatmapMatrix = (snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.heatmap)) {
    return { matrix: Array.from({ length: 7 }, () => Array(24).fill(0)), max: 0 };
  }
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  let max = 0;
  for (const entry of snapshot.heatmap) {
    const dayIndex = Number(entry.dayOfWeek);
    const hour = Number(entry.hour);
    if (!Number.isFinite(dayIndex) || !Number.isFinite(hour)) {
      continue;
    }
    const clampedDay = ((Math.round(dayIndex) % 7) + 7) % 7;
    const clampedHour = Math.max(0, Math.min(23, Math.round(hour)));
    const value = Number(entry.value);
    const safeValue = Number.isFinite(value) ? value : 0;
    matrix[clampedDay][clampedHour] += safeValue;
    if (matrix[clampedDay][clampedHour] > max) {
      max = matrix[clampedDay][clampedHour];
    }
  }
  return { matrix, max };
};

const HeatmapGrid = ({ matrix, max }) => {
  const scaleValue = (value) => {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    if (!Number.isFinite(max) || max <= 0) {
      return 0.1;
    }
    return Math.max(0.1, value / max);
  };
  return html`<div class="overflow-x-auto">
    <table class="w-full min-w-[640px] border-separate border-spacing-1">
      <thead>
        <tr class="text-xs uppercase tracking-wider text-slate-400">
          <th class="px-2 py-1 text-left">Jour</th>
          ${Array.from({ length: 24 }, (_, hour) =>
            html`<th key=${`hour-${hour}`} class="px-1 py-1 text-center">${hour}</th>`,
          )}
        </tr>
      </thead>
      <tbody>
        ${matrix.map((row, dayIndex) => {
          return html`<tr key=${`day-${dayIndex}`}>
            ${[
              html`<th class="whitespace-nowrap px-2 py-1 text-left text-sm text-slate-300">${DAY_LABELS[dayIndex]}</th>`,
              ...row.map((value, hour) => {
                const ratio = scaleValue(value);
                const background = `rgba(56, 189, 248, ${ratio})`;
                return html`<td
                  key=${`cell-${dayIndex}-${hour}`}
                  class="h-6 w-6 rounded-md text-center text-[10px] text-slate-900"
                  style=${`background:${background}`}
                >${value > 0 ? Math.round(value) : ''}</td>`;
              }),
            ]}
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
};

const SuggestionsList = ({ suggestions, onSelect }) => {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return null;
  }
  return html`<ul class="mt-2 space-y-1 rounded-xl border border-slate-800/70 bg-slate-900/90 p-2 shadow-lg shadow-slate-950/40">
    ${suggestions.map((suggestion) =>
      html`<li key=${suggestion.userId}>
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800/80"
          onClick=${() => onSelect(suggestion)}
        >
          <span class="font-medium">${suggestion.displayName}</span>
          ${suggestion.username ? html`<span class="text-xs text-slate-400">@${suggestion.username}</span>` : null}
        </button>
      </li>`,
    )}
  </ul>`;
};

const areRouteParamsEqual = (left = {}, right = {}) => {
  const keys = new Set([
    ...Object.keys(left ?? {}),
    ...Object.keys(right ?? {}),
  ]);
  for (const key of keys) {
    const a = left?.[key] ?? null;
    const b = right?.[key] ?? null;
    if (a !== b) {
      return false;
    }
  }
  return true;
};

const normalizeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return fallback;
};

const normalizeNullableNumber = (value) => {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeSnapshot = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const totalsSource = raw.totals && typeof raw.totals === 'object' ? raw.totals : {};
  const totals = {
    totalMembers: normalizeNumber(totalsSource.totalMembers),
    activeMembers: normalizeNumber(totalsSource.activeMembers),
    newMembers: normalizeNumber(totalsSource.newMembers),
    voiceMinutes: normalizeNumber(totalsSource.voiceMinutes),
    messageCount: normalizeNumber(totalsSource.messageCount),
    averageConnectedPerHour: normalizeNumber(totalsSource.averageConnectedPerHour),
    retentionRate: normalizeNullableNumber(totalsSource.retentionRate),
    growthRate: normalizeNullableNumber(totalsSource.growthRate),
  };

  const activitySeries = Array.isArray(raw.activitySeries)
    ? raw.activitySeries
        .map((entry) => ({
          bucket: typeof entry.bucket === 'string' ? entry.bucket : '',
          voiceMinutes: normalizeNumber(entry.voiceMinutes),
          messageCount: normalizeNumber(entry.messageCount),
          activeMembers: normalizeNumber(entry.activeMembers),
        }))
        .filter((entry) => entry.bucket.length > 0)
    : [];

  const newMembers = Array.isArray(raw.newMembers)
    ? raw.newMembers
        .map((entry) => ({
          bucket: typeof entry.bucket === 'string' ? entry.bucket : '',
          count: normalizeNumber(entry.count),
        }))
        .filter((entry) => entry.bucket.length > 0)
    : [];

  const topMembers = Array.isArray(raw.topMembers)
    ? raw.topMembers
        .map((entry) => ({
          userId: typeof entry.userId === 'string' ? entry.userId : null,
          displayName: typeof entry.displayName === 'string' ? entry.displayName : 'Membre',
          username: typeof entry.username === 'string' ? entry.username : null,
          voiceMinutes: normalizeNumber(entry.voiceMinutes),
          messageCount: normalizeNumber(entry.messageCount),
          activityScore: normalizeNumber(entry.activityScore),
        }))
        .filter((entry) => entry.userId)
    : [];

  const normalizeChannelList = (list) =>
    Array.isArray(list)
      ? list
          .map((entry) => ({
            channelId:
              typeof entry.channelId === 'string'
                ? entry.channelId
                : entry.channelId != null
                  ? String(entry.channelId)
                  : null,
            channelName: typeof entry.channelName === 'string' ? entry.channelName : null,
            voiceMinutes: normalizeNumber(entry.voiceMinutes),
            messageCount: normalizeNumber(entry.messageCount),
          }))
          .filter((entry) => entry.channelId)
      : [];

  const channelActivitySource = raw.channelActivity && typeof raw.channelActivity === 'object' ? raw.channelActivity : {};
  const channelActivity = {
    voice: normalizeChannelList(channelActivitySource.voice),
    text: normalizeChannelList(channelActivitySource.text),
  };

  const retention = Array.isArray(raw.retention)
    ? raw.retention
        .map((entry) => ({
          windowDays: normalizeNumber(entry.windowDays),
          returningUsers: normalizeNumber(entry.returningUsers),
          totalUsers: normalizeNumber(entry.totalUsers),
          rate: normalizeNullableNumber(entry.rate),
        }))
        .filter((entry) => entry.windowDays > 0)
    : [];

  const heatmap = Array.isArray(raw.heatmap)
    ? raw.heatmap.map((entry) => ({
        source: entry.source === 'voice' || entry.source === 'text' ? entry.source : 'voice',
        dayOfWeek: normalizeNumber(entry.dayOfWeek),
        hour: normalizeNumber(entry.hour),
        value: normalizeNumber(entry.value),
      }))
    : [];

  const hypeHistory = Array.isArray(raw.hypeHistory)
    ? raw.hypeHistory
        .map((entry) => ({
          bucketStart: typeof entry.bucketStart === 'string' ? entry.bucketStart : '',
          averageSchScore: normalizeNullableNumber(entry.averageSchScore),
          leaderCount: normalizeNumber(entry.leaderCount),
        }))
        .filter((entry) => entry.bucketStart.length > 0)
    : [];

  const availableChannels = Array.isArray(raw.availableChannels)
    ? raw.availableChannels
        .map((entry) => ({
          channelId:
            typeof entry.channelId === 'string'
              ? entry.channelId
              : entry.channelId != null
                ? String(entry.channelId)
                : null,
          channelName: typeof entry.channelName === 'string' ? entry.channelName : null,
          channelType:
            entry.channelType === 'text' || entry.channelType === 'voice' ? entry.channelType : 'unknown',
          activityScore: normalizeNumber(entry.activityScore),
        }))
        .filter((entry) => entry.channelId)
    : [];

  const availableUsers = Array.isArray(raw.availableUsers)
    ? raw.availableUsers
        .map((entry) => ({
          userId: typeof entry.userId === 'string' ? entry.userId : null,
          displayName: typeof entry.displayName === 'string' ? entry.displayName : 'Membre',
          username: typeof entry.username === 'string' ? entry.username : null,
          avatarUrl: typeof entry.avatarUrl === 'string' ? entry.avatarUrl : null,
        }))
        .filter((entry) => entry.userId)
    : [];

  const generatedAt = typeof raw.generatedAt === 'string' ? raw.generatedAt : null;
  const timezone = typeof raw.timezone === 'string' ? raw.timezone : 'Europe/Paris';

  return {
    generatedAt,
    timezone,
    totals,
    newMembers,
    activitySeries,
    topMembers,
    channelActivity,
    retention,
    heatmap,
    hypeHistory,
    availableChannels,
    availableUsers,
  };
};

const areFiltersEqual = (a, b) => {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (
    a.rangePreset !== b.rangePreset ||
    a.customSince !== b.customSince ||
    a.customUntil !== b.customUntil ||
    a.granularity !== b.granularity ||
    a.userId !== b.userId ||
    a.includeHeatmap !== b.includeHeatmap ||
    a.includeHypeHistory !== b.includeHypeHistory
  ) {
    return false;
  }
  if (a.selectedChannels.length !== b.selectedChannels.length) {
    return false;
  }
  const leftChannels = [...a.selectedChannels].sort();
  const rightChannels = [...b.selectedChannels].sort();
  for (let index = 0; index < leftChannels.length; index += 1) {
    if (leftChannels[index] !== rightChannels[index]) {
      return false;
    }
  }
  if (a.activityTypes.size !== b.activityTypes.size) {
    return false;
  }
  for (const type of a.activityTypes) {
    if (!b.activityTypes.has(type)) {
      return false;
    }
  }
  return true;
};

const findUserDetails = (snapshot, userId) => {
  if (!snapshot || !userId) {
    return null;
  }
  const fromTop = snapshot.topMembers.find((entry) => entry.userId === userId);
  if (fromTop) {
    return {
      userId: fromTop.userId,
      displayName: fromTop.displayName,
      username: fromTop.username,
    };
  }
  const fromSuggestions = snapshot.availableUsers.find((entry) => entry.userId === userId);
  if (fromSuggestions) {
    return {
      userId: fromSuggestions.userId,
      displayName: fromSuggestions.displayName,
      username: fromSuggestions.username,
    };
  }
  return {
    userId,
    displayName: `Membre ${userId}`,
    username: null,
  };
};

const LoadingState = () => {
  return html`<div class="flex items-center gap-2 text-sm text-slate-300">
    <span class="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-transparent"></span>
    Chargement des statistiques…
  </div>`;
};

const formatDisplayDate = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }
  return value.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export const StatistiquesPage = ({ params = {}, onSyncRoute, bootstrap = null }) => {
  const paramsSignature = useMemo(() => JSON.stringify(params ?? {}), [params]);
  const initialFilters = useMemo(() => deriveInitialFilters(params), [paramsSignature]);
  const [filters, setFilters] = useState(initialFilters);

  useEffect(() => {
    setFilters((prev) => {
      if (areFiltersEqual(prev, initialFilters)) {
        return prev;
      }
      return initialFilters;
    });
  }, [initialFilters]);

  const bootstrapSnapshot = useMemo(() => normalizeSnapshot(bootstrap?.snapshot ?? null), [bootstrap]);
  const [snapshot, setSnapshot] = useState(bootstrapSnapshot);
  const [loading, setLoading] = useState(!bootstrapSnapshot);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(bootstrapSnapshot?.generatedAt ?? null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const bootstrapConsumedRef = useRef(!bootstrapSnapshot);
  const abortControllerRef = useRef(null);
  const routeSyncRef = useRef(buildRouteParams(initialFilters));

  const updateFilters = useCallback((updater) => {
    setFilters((prev) => {
      const draft = {
        ...prev,
        activityTypes: new Set(prev.activityTypes),
        selectedChannels: [...prev.selectedChannels],
      };
      const result = typeof updater === 'function' ? updater(draft) || draft : { ...draft, ...updater };
      const normalizedActivity = result.activityTypes instanceof Set
        ? new Set(result.activityTypes)
        : new Set(draft.activityTypes);
      const normalizedChannels = Array.isArray(result.selectedChannels)
        ? result.selectedChannels.map((value) => String(value)).filter((value) => value.length > 0)
        : draft.selectedChannels;
      normalizedChannels.sort();
      return {
        ...result,
        activityTypes: normalizedActivity,
        selectedChannels: Array.from(new Set(normalizedChannels)),
      };
    });
  }, []);

  const apiRequest = useMemo(() => computeApiRequest(filters), [filters]);

  useEffect(() => {
    if (typeof onSyncRoute !== 'function') {
      return;
    }
    const nextParams = apiRequest.routeParams;
    if (!areRouteParamsEqual(routeSyncRef.current, nextParams)) {
      routeSyncRef.current = nextParams;
      onSyncRoute(nextParams, { replace: true });
    }
  }, [apiRequest, onSyncRoute]);

  useEffect(() => {
    if (!bootstrapConsumedRef.current) {
      bootstrapConsumedRef.current = true;
      return;
    }

    const endpoint = apiRequest.queryString ? `/api/statistiques?${apiRequest.queryString}` : '/api/statistiques';
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setError('');

    const fetchStatistics = async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Réponse inattendue (${response.status})`);
        }
        const payload = await response.json();
        const nextSnapshot = normalizeSnapshot(payload?.statistics ?? null);
        if (!nextSnapshot) {
          throw new Error('Instantané vide.');
        }
        setSnapshot(nextSnapshot);
        setLastUpdated(nextSnapshot.generatedAt ?? new Date().toISOString());
        setError('');
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        console.warn('Impossible de charger les statistiques communautaires', err);
        setError("Statistiques momentanément indisponibles. Réessaie dans quelques instants.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchStatistics();

    return () => {
      controller.abort();
    };
  }, [apiRequest, refreshIndex]);

  useEffect(() => () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const handleRangePresetChange = useCallback((value) => {
    updateFilters((draft) => {
      draft.rangePreset = value;
      if (value !== 'custom') {
        draft.customSince = '';
        draft.customUntil = '';
      }
      return draft;
    });
  }, [updateFilters]);

  const handleCustomSinceChange = useCallback((event) => {
    const value = event?.target?.value ?? '';
    updateFilters((draft) => {
      draft.customSince = value;
      return draft;
    });
  }, [updateFilters]);

  const handleCustomUntilChange = useCallback((event) => {
    const value = event?.target?.value ?? '';
    updateFilters((draft) => {
      draft.customUntil = value;
      return draft;
    });
  }, [updateFilters]);

  const handleGranularityChange = useCallback((event) => {
    const value = event?.target?.value ?? 'week';
    updateFilters({ granularity: value });
  }, [updateFilters]);

  const handleActivityToggle = useCallback((value) => {
    if (!value) {
      return;
    }
    updateFilters((draft) => {
      if (draft.activityTypes.has(value)) {
        draft.activityTypes.delete(value);
        if (draft.activityTypes.size === 0) {
          DEFAULT_ACTIVITY_TYPES.forEach((entry) => draft.activityTypes.add(entry));
        }
      } else {
        draft.activityTypes.add(value);
      }
      return draft;
    });
  }, [updateFilters]);

  const handleChannelToggle = useCallback((channelId) => {
    if (!channelId) {
      return;
    }
    updateFilters((draft) => {
      const normalized = String(channelId);
      const index = draft.selectedChannels.indexOf(normalized);
      if (index >= 0) {
        draft.selectedChannels.splice(index, 1);
      } else {
        draft.selectedChannels.push(normalized);
      }
      return draft;
    });
  }, [updateFilters]);

  const handleClearChannels = useCallback(() => {
    updateFilters({ selectedChannels: [] });
  }, [updateFilters]);

  const handleUserSearchChange = useCallback((event) => {
    const value = event?.target?.value ?? '';
    const normalized = value.trim();
    updateFilters({ userSearch: normalized.length >= 2 ? normalized : null });
  }, [updateFilters]);

  const handleUserSelect = useCallback((suggestion) => {
    if (!suggestion || typeof suggestion !== 'object') {
      return;
    }
    const userId = typeof suggestion.userId === 'string' ? suggestion.userId : null;
    if (!userId) {
      return;
    }
    updateFilters({ userId, userSearch: null });
  }, [updateFilters]);

  const handleUserClear = useCallback(() => {
    updateFilters({ userId: null, userSearch: null });
  }, [updateFilters]);

  const handleHeatmapToggle = useCallback((event) => {
    const checked = Boolean(event?.target?.checked);
    updateFilters({ includeHeatmap: checked });
  }, [updateFilters]);

  const handleHypeToggle = useCallback((event) => {
    const checked = Boolean(event?.target?.checked);
    updateFilters({ includeHypeHistory: checked });
  }, [updateFilters]);

  const handleRefresh = useCallback(() => {
    setRefreshIndex((prev) => prev + 1);
  }, []);

  const activitySummary = useMemo(() => deriveActivitySummary(snapshot, filters), [snapshot, filters]);
  const activityChartConfig = useMemo(() => buildActivityChartConfig(activitySummary), [activitySummary]);
  const newMembersChart = useMemo(() => buildNewMembersChart(snapshot), [snapshot]);
  const hypeChart = useMemo(
    () => (filters.includeHypeHistory ? buildHypeChart(snapshot) : null),
    [filters.includeHypeHistory, snapshot],
  );
  const channelSeries = useMemo(
    () => buildChannelSeries(snapshot?.channelActivity ?? null, filters.limitChannels ?? 12),
    [snapshot, filters.limitChannels],
  );
  const heatmapMatrix = useMemo(
    () => (filters.includeHeatmap ? buildHeatmapMatrix(snapshot) : null),
    [snapshot, filters.includeHeatmap],
  );

  const availableChannels = snapshot?.availableChannels ?? [];
  const channelOptions = useMemo(() => {
    const map = new Map();
    const register = (source = {}) => {
      const channelId =
        typeof source.channelId === 'string'
          ? source.channelId
          : source.channelId != null
            ? String(source.channelId)
            : null;
      if (!channelId) {
        return;
      }
      const existing = map.get(channelId);
      const rawName = typeof source.channelName === 'string' ? source.channelName.trim() : '';
      const previousName = existing?.channelName ?? '';
      const channelName = rawName && (!previousName || rawName.length > previousName.length)
        ? rawName
        : previousName || rawName || `Salon ${channelId}`;
      const sourceType = source.channelType === 'voice' || source.channelType === 'text' ? source.channelType : null;
      const channelType = sourceType ?? existing?.channelType ?? 'unknown';
      const numericScore = Number(
        source.activityScore ?? source.voiceMinutes ?? source.messageCount ?? existing?.activityScore ?? 0,
      );
      const activityScore = Number.isFinite(numericScore)
        ? Math.max(numericScore, existing?.activityScore ?? 0)
        : existing?.activityScore ?? 0;
      map.set(channelId, {
        channelId,
        channelName,
        channelType,
        activityScore,
      });
    };

    availableChannels.forEach((entry) => register(entry));
    (snapshot?.channelActivity?.voice ?? []).forEach((entry) =>
      register({
        channelId: entry.channelId,
        channelName: entry.channelName,
        channelType: 'voice',
        activityScore: entry.voiceMinutes ?? entry.activityScore ?? 0,
      }),
    );
    (snapshot?.channelActivity?.text ?? []).forEach((entry) =>
      register({
        channelId: entry.channelId,
        channelName: entry.channelName,
        channelType: 'text',
        activityScore: entry.messageCount ?? entry.activityScore ?? 0,
      }),
    );

    const entries = Array.from(map.values()).map((entry) => ({
      ...entry,
      searchLabel: normalizeSearch(`${entry.channelName} ${entry.channelId}`),
    }));
    entries.sort((a, b) => {
      const scoreDiff = (b.activityScore ?? 0) - (a.activityScore ?? 0);
      if (Math.abs(scoreDiff) > 0.01) {
        return scoreDiff;
      }
      return (a.channelName ?? '').localeCompare(b.channelName ?? '', 'fr', { sensitivity: 'base' });
    });
    return entries;
  }, [availableChannels, snapshot]);

  const channelOptionIndex = useMemo(
    () => new Map(channelOptions.map((entry) => [entry.channelId, entry])),
    [channelOptions],
  );
  const selectedChannels = filters.selectedChannels;
  const selectedChannelDetails = useMemo(
    () =>
      selectedChannels.map((channelId) =>
        channelOptionIndex.get(channelId) ?? {
          channelId,
          channelName: channelId,
          channelType: 'unknown',
        },
      ),
    [channelOptionIndex, selectedChannels],
  );

  const selectedUser = useMemo(() => findUserDetails(snapshot, filters.userId), [snapshot, filters.userId]);

  const averageActiveMembers = useMemo(() => {
    if (!activitySummary || !Array.isArray(activitySummary.activeSeries) || activitySummary.activeSeries.length === 0) {
      return null;
    }
    const total = activitySummary.activeSeries.reduce((acc, value) => acc + Number(value || 0), 0);
    return total / activitySummary.activeSeries.length;
  }, [activitySummary]);

  const totals = snapshot?.totals ?? {
    totalMembers: 0,
    activeMembers: 0,
    newMembers: 0,
    voiceMinutes: 0,
    messageCount: 0,
    averageConnectedPerHour: 0,
    retentionRate: null,
    growthRate: null,
  };

  const rangeLabel = useMemo(() => {
    const { since, until } = apiRequest;
    const sinceLabel = formatDisplayDate(since);
    const untilLabel = formatDisplayDate(until);
    if (sinceLabel && untilLabel) {
      return `${sinceLabel} → ${untilLabel}`;
    }
    if (sinceLabel) {
      return `Depuis le ${sinceLabel}`;
    }
    if (untilLabel) {
      return `Jusqu’au ${untilLabel}`;
    }
    return '';
  }, [apiRequest]);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) {
      return '';
    }
    const parsed = new Date(lastUpdated);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    return parsed.toLocaleString('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }, [lastUpdated]);

  return html`
    <div class="flex flex-col gap-10">
      <header class="space-y-4">
        <div class="flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <span class="rounded-full bg-emerald-400/10 px-3 py-1 font-medium text-emerald-200">Communauté</span>
          <span>${rangeLabel}</span>
          ${lastUpdatedLabel
            ? html`<span class="flex items-center gap-2 text-xs text-slate-400">
                <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
                Mise à jour ${lastUpdatedLabel}
              </span>`
            : null}
        </div>
        <div class="flex flex-col gap-3">
          <h1 class="text-3xl font-semibold text-white sm:text-4xl">Tableau de bord des statistiques Discord</h1>
          <p class="max-w-3xl text-base text-slate-300">
            Analyse l’évolution de la communauté Libre Antenne : croissance des membres, activité vocale, messages envoyés et
            périodes de forte affluence. Utilise les filtres pour explorer une période, un salon ou un membre en particulier.
          </p>
        </div>
      </header>

      <section class="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6 shadow-lg shadow-slate-950/30">
        <div class="flex flex-col gap-6">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <h2 class="text-lg font-semibold text-white">Filtres</h2>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-xl border border-slate-700/70 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
              onClick=${handleRefresh}
            >
              <${RefreshCcw} class="h-4 w-4" aria-hidden="true" />
              Actualiser
            </button>
          </div>
          <div class="grid gap-5 lg:grid-cols-2">
            <div class="space-y-4">
              <div>
                <p class="text-xs uppercase tracking-wide text-slate-400">Période</p>
                <div class="mt-2 flex flex-wrap gap-2">
                  ${RANGE_PRESETS.map((preset) => {
                    const isActive = filters.rangePreset === preset.value;
                    const classes = [
                      'rounded-xl px-3 py-2 text-sm font-medium transition',
                      isActive
                        ? 'bg-amber-400/20 text-amber-100 ring-2 ring-amber-300/60'
                        : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800/80',
                    ].join(' ');
                    return html`<button
                      key=${preset.value}
                      type="button"
                      class=${classes}
                      onClick=${() => handleRangePresetChange(preset.value)}
                    >
                      ${preset.label}
                    </button>`;
                  })}
                </div>
                ${filters.rangePreset === 'custom'
                  ? html`<div class="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-200">
                      <label class="flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-slate-400">Depuis</span>
                        <input
                          type="date"
                          value=${filters.customSince}
                          onInput=${handleCustomSinceChange}
                          class="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                        />
                      </label>
                      <label class="flex flex-col gap-1">
                        <span class="text-xs uppercase tracking-wide text-slate-400">Jusqu’au</span>
                        <input
                          type="date"
                          value=${filters.customUntil}
                          onInput=${handleCustomUntilChange}
                          class="rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                        />
                      </label>
                    </div>`
                  : null}
              </div>

              <div>
                <label class="text-xs uppercase tracking-wide text-slate-400" for="statistiques-granularite">Granularité</label>
                <div class="relative mt-2">
                  <select
                    id="statistiques-granularite"
                    class="w-full appearance-none rounded-xl border border-slate-800/70 bg-slate-900/80 px-3 py-2 pr-10 text-sm text-slate-100 shadow-inner shadow-slate-950/30 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                    value=${filters.granularity}
                    onInput=${handleGranularityChange}
                  >
                    ${GRANULARITY_OPTIONS.map((option) =>
                      html`<option key=${option.value} value=${option.value}>${option.label}</option>`,
                    )}
                  </select>
                  <${ChevronDown}
                    class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                </div>
              </div>

              <div>
                <p class="text-xs uppercase tracking-wide text-slate-400">Type d’activité</p>
                <div class="mt-2 flex flex-wrap gap-2">
                  ${ACTIVITY_FILTERS.map((filter) => {
                    const active = filters.activityTypes.has(filter.value);
                    const classes = [
                      'rounded-xl px-3 py-2 text-sm font-medium transition',
                      active
                        ? 'bg-sky-400/20 text-sky-100 ring-2 ring-sky-300/60'
                        : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800/80',
                    ].join(' ');
                    return html`<button
                      key=${filter.value}
                      type="button"
                      class=${classes}
                      onClick=${() => handleActivityToggle(filter.value)}
                    >
                      ${filter.label}
                    </button>`;
                  })}
                </div>
              </div>
            </div>

            <div class="space-y-5">
              <div>
                <label class="text-xs uppercase tracking-wide text-slate-400" for="statistiques-channel-filter">Salons</label>
                <${ChannelMultiSelect}
                  id="statistiques-channel-filter"
                  channels=${channelOptions}
                  selectedIds=${filters.selectedChannels}
                  selectedDetails=${selectedChannelDetails}
                  onToggle=${handleChannelToggle}
                  onClear=${handleClearChannels}
                />
              </div>

              <div>
                <label class="text-xs uppercase tracking-wide text-slate-400" for="statistiques-user-search">Utilisateur</label>
                <input
                  id="statistiques-user-search"
                  type="search"
                  placeholder="Rechercher un membre…"
                  class="mt-2 w-full rounded-lg border border-slate-700/70 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                  onInput=${handleUserSearchChange}
                />
                ${filters.userSearch
                  ? html`<${SuggestionsList}
                      suggestions=${snapshot?.availableUsers ?? []}
                      onSelect=${handleUserSelect}
                    />`
                  : null}
                ${selectedUser
                  ? html`<div class="mt-3 flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                      <div class="flex flex-col">
                        <span class="font-medium text-white">${selectedUser.displayName}</span>
                        ${selectedUser.username
                          ? html`<span class="text-xs text-slate-400">@${selectedUser.username}</span>`
                          : null}
                      </div>
                      <button
                        type="button"
                        class="rounded-lg border border-transparent px-2 py-1 text-xs font-medium text-slate-300 hover:border-slate-600"
                        onClick=${handleUserClear}
                      >
                        Réinitialiser
                      </button>
                    </div>`
                  : null}
              </div>

              <div class="flex flex-wrap gap-6">
                <label class="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-slate-600 bg-slate-900 text-amber-400 focus:ring-amber-300"
                    checked=${filters.includeHeatmap}
                    onChange=${handleHeatmapToggle}
                  />
                  <span>Afficher la heatmap horaire</span>
                </label>
                <label class="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-slate-600 bg-slate-900 text-amber-400 focus:ring-amber-300"
                    checked=${filters.includeHypeHistory}
                    onChange=${handleHypeToggle}
                  />
                  <span>Afficher l’historique hype</span>
                </label>
              </div>
            </div>
          </div>
          ${loading ? html`<${LoadingState} />` : null}
          ${error
            ? html`<div class="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                <${AlertCircle} class="h-4 w-4" aria-hidden="true" />
                ${error}
              </div>`
            : null}
        </div>
      </section>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <${MetricCard}
          icon=${Users}
          label="Membres"
          value=${formatInteger(totals.totalMembers)}
          sublabel=${`Actifs : ${formatInteger(totals.activeMembers)}`}
          trend=${totals.growthRate}
        />
        <${MetricCard}
          icon=${CalendarDays}
          label="Nouveaux membres"
          value=${formatInteger(totals.newMembers)}
          sublabel="Sur la période sélectionnée"
        />
        <${MetricCard}
          icon=${Clock3}
          label="Temps vocal cumulé"
          value=${formatMinutes(totals.voiceMinutes)}
          sublabel=${averageActiveMembers != null
            ? `Moyenne ${formatInteger(Math.round(averageActiveMembers))} membres actifs`
            : 'Membres actifs stables'}
        />
        <${MetricCard}
          icon=${MessageSquare}
          label="Messages envoyés"
          value=${formatInteger(totals.messageCount)}
          sublabel=${`Moyenne ${formatInteger(Math.round(totals.averageConnectedPerHour))} connectés / heure`}
        />
      </section>

      <section class="grid gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:gap-8">
        <div class="space-y-6 xl:space-y-8">
          <div class="space-y-4">
            <h3 class="text-lg font-semibold text-white">Evolution de l’activité</h3>
            ${activityChartConfig
              ? html`<${StatisticsChart} type="line" data=${activityChartConfig.data} options=${activityChartConfig.options} />`
              : html`<p class="rounded-xl border border-slate-800/60 bg-slate-900/60 p-6 text-sm text-slate-300">
                  Aucune donnée d’activité disponible pour cette période.
                </p>`}
          </div>
          <div class="space-y-4">
            <h3 class="text-lg font-semibold text-white">Nouveaux membres</h3>
            ${newMembersChart
              ? html`<${StatisticsChart} type="bar" data=${newMembersChart.data} options=${newMembersChart.options} />`
              : html`<p class="rounded-xl border border-slate-800/60 bg-slate-900/60 p-6 text-sm text-slate-300">
                  Aucun arrivant détecté sur cette période.
                </p>`}
          </div>
          ${filters.includeHypeHistory
            ? html`<div class="space-y-4">
                <h3 class="text-lg font-semibold text-white">Tendance hype globale</h3>
                ${hypeChart
                  ? html`<${StatisticsChart} type="line" data=${hypeChart.data} options=${hypeChart.options} />`
                  : html`<p class="rounded-xl border border-slate-800/60 bg-slate-900/60 p-6 text-sm text-slate-300">
                      Pas encore de données hype pour cette plage temporelle.
                    </p>`}
              </div>`
            : null}
        </div>

        <div class="grid gap-6 xl:gap-8">
          <div class="flex flex-col rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 shadow-inner shadow-slate-950/30">
            <h3 class="text-lg font-semibold text-white">Top membres actifs</h3>
            <p class="mt-1 text-xs text-slate-400">Classement combinant temps vocal et messages.</p>
            <div class="mt-4 space-y-3">
              ${(snapshot?.topMembers ?? []).slice(0, filters.limitTopMembers ?? 15).map((member, index) => {
                const rank = index + 1;
                const highlighted = selectedUser && selectedUser.userId === member.userId;
                const containerClass = [
                  'flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition',
                  highlighted
                    ? 'border-amber-400/50 bg-amber-500/10'
                    : 'border-slate-800/60 bg-slate-900/50 hover:border-slate-700/70',
                ].join(' ');
                return html`<div key=${member.userId} class=${containerClass}>
                  <div class="flex items-center gap-3">
                    <span class="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800/70 text-sm font-semibold text-amber-200">${rank}</span>
                    <div class="flex flex-col">
                      <span class="font-medium text-white">${member.displayName}</span>
                      ${member.username
                        ? html`<span class="text-xs text-slate-400">@${member.username}</span>`
                        : null}
                    </div>
                  </div>
                  <div class="flex flex-col items-end text-xs text-slate-300">
                    <span>${formatMinutes(member.voiceMinutes)}</span>
                    <span>${formatInteger(member.messageCount)} messages</span>
                  </div>
                </div>`;
              })}
              ${(snapshot?.topMembers ?? []).length === 0
                ? html`<p class="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 text-sm text-slate-300">
                    Aucun membre actif n’a été recensé sur cette période.
                  </p>`
                : null}
            </div>
          </div>

          <div class="flex flex-col rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 shadow-inner shadow-slate-950/30">
            <h3 class="text-lg font-semibold text-white">Taux de rétention</h3>
            <p class="mt-1 text-xs text-slate-400">Pourcentage de membres revenus après X jours.</p>
            <ul class="mt-3 space-y-2">
              ${(snapshot?.retention ?? []).map((entry) => {
                const rateLabel = entry.rate != null ? formatPercentage(entry.rate) : '—';
                return html`<li key=${`retention-${entry.windowDays}`} class="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                  <span>${entry.windowDays} jours</span>
                  <span class="font-semibold text-emerald-200">${rateLabel}</span>
                </li>`;
              })}
              ${(snapshot?.retention ?? []).length === 0
                ? html`<li class="rounded-xl border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                    Pas encore de données de rétention.
                  </li>`
                : null}
            </ul>
          </div>
        </div>
      </section>

      <section class="grid gap-6 lg:grid-cols-2">
        <div class="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5 shadow-inner shadow-slate-950/30">
          <h3 class="text-lg font-semibold text-white">Salons vocaux les plus actifs</h3>
          <p class="mt-1 text-xs text-slate-400">Top ${filters.limitChannels ?? 12} selon le temps passé en vocal.</p>
          <ul class="mt-3 space-y-2">
            ${channelSeries.voice.length > 0
              ? channelSeries.voice.map((channel) => {
                  const label = channel.name ?? `Salon ${channel.id}`;
                  return html`<li key=${`voice-${channel.id}`} class="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                    <span>${label}</span>
                    <span>${formatMinutes(channel.voiceMinutes)}</span>
                  </li>`;
                })
              : html`<li class="rounded-xl border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                  Aucun salon vocal actif sur cette période.
                </li>`}
          </ul>
        </div>
        <div class="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5 shadow-inner shadow-slate-950/30">
          <h3 class="text-lg font-semibold text-white">Salons textuels les plus actifs</h3>
          <p class="mt-1 text-xs text-slate-400">Top ${filters.limitChannels ?? 12} selon le volume de messages.</p>
          <ul class="mt-3 space-y-2">
            ${channelSeries.text.length > 0
              ? channelSeries.text.map((channel) => {
                  const label = channel.name ?? `Salon ${channel.id}`;
                  return html`<li key=${`text-${channel.id}`} class="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                    <span>${label}</span>
                    <span>${formatInteger(channel.messageCount)} messages</span>
                  </li>`;
                })
              : html`<li class="rounded-xl border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                  Aucun salon textuel actif sur cette période.
                </li>`}
          </ul>
        </div>
      </section>

      ${filters.includeHeatmap
        ? html`<section class="space-y-4">
            <h3 class="text-lg font-semibold text-white">Périodes de pic d’activité</h3>
            ${heatmapMatrix && heatmapMatrix.max > 0
              ? html`<div class="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-5 shadow-inner shadow-slate-950/30">
                  <${HeatmapGrid} matrix=${heatmapMatrix.matrix} max=${heatmapMatrix.max} />
                </div>`
              : html`<p class="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-6 text-sm text-slate-300">
                  Pas encore de heatmap disponible pour cette sélection.
                </p>`}
          </section>`
        : null}
    </div>
  `;
};
