import config from '../src/config';
import {
  buildVectorLiteral,
  ensureDiscordVectorSchema,
  insertDiscordVectors,
} from '../src/services/DiscordVectorRepository';
import { getEmbedding } from '../src/lib/openai';
import { query } from '../src/lib/db';
import VoiceActivityRepository, { type PersonaProfileData } from '../src/services/VoiceActivityRepository';

const TOTAL_STEPS = 7;

interface ActiveMemberPersonaProfile {
  userId: string;
  pseudo: string;
  voiceMinutes: number;
  messageCount: number;
  activityScore: number;
  summary: string | null;
  persona: PersonaProfileData;
}

function logStep(step: number, message: string): void {
  console.log(`[sync:vectors] [${step}/${TOTAL_STEPS}] ${message}`);
}

function logInfo(message: string): void {
  console.log(`[sync:vectors] ${message}`);
}

async function fetchUserColumns(): Promise<Set<string>> {
  const result = await query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'`,
  );

  const columns = new Set<string>();
  for (const row of result.rows ?? []) {
    if (row.column_name) {
      columns.add(row.column_name);
    }
  }
  return columns;
}

async function fetchUserPseudos(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const columns = await fetchUserColumns();
  if (columns.size === 0) {
    return new Map();
  }

  const coalesceCandidates: string[] = [];
  const preferredColumns = ['pseudo', 'display_name', 'nickname', 'username'];
  for (const column of preferredColumns) {
    if (columns.has(column)) {
      coalesceCandidates.push(`NULLIF(TRIM(${column}::text), '')`);
    }
  }
  coalesceCandidates.push('user_id::text');

  const result = await query<{ user_id: string; pseudo_label: string }>(
    `SELECT user_id::text AS user_id,
            COALESCE(${coalesceCandidates.join(', ')}) AS pseudo_label
       FROM users
      WHERE user_id::text = ANY($1::text[])`,
    [userIds],
  );

  const pseudos = new Map<string, string>();
  for (const row of result.rows ?? []) {
    const userId = row.user_id?.trim();
    if (!userId) {
      continue;
    }
    const pseudo = (row.pseudo_label ?? '').trim();
    pseudos.set(userId, pseudo.length > 0 ? pseudo : userId);
  }

  return pseudos;
}

async function fetchPersonaProfiles(
  userIds: string[],
): Promise<Map<string, { summary: string | null; persona: PersonaProfileData }>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const tableExistsResult = await query<{ exists: boolean }>(
    `SELECT to_regclass('public.user_personas') IS NOT NULL AS exists`,
  );

  if (!tableExistsResult.rows?.[0]?.exists) {
    return new Map();
  }

  const result = await query<{
    user_id: string;
    summary: string | null;
    persona: PersonaProfileData | string | null;
  }>(
    `SELECT user_id::text AS user_id,
            summary,
            persona
       FROM user_personas
      WHERE user_id::text = ANY($1::text[])`,
    [userIds],
  );

  const personas = new Map<string, { summary: string | null; persona: PersonaProfileData }>();
  for (const row of result.rows ?? []) {
    const userId = row.user_id?.trim();
    if (!userId) {
      continue;
    }

    let persona: PersonaProfileData | null = null;
    if (row.persona && typeof row.persona === 'object') {
      persona = row.persona as PersonaProfileData;
    } else if (row.persona && typeof row.persona === 'string') {
      try {
        persona = JSON.parse(row.persona) as PersonaProfileData;
      } catch (error) {
        console.warn(`Impossible d'analyser la persona pour l'utilisateur ${userId}`, error);
      }
    }

    if (!persona) {
      continue;
    }

    const summary = typeof row.summary === 'string' ? row.summary.trim() : null;
    personas.set(userId, { summary: summary && summary.length > 0 ? summary : null, persona });
  }

  return personas;
}

function formatPersonaDocument(profile: ActiveMemberPersonaProfile): string {
  const sections: string[] = [
    `Profil Libre Antenne — ${profile.pseudo}`,
    '',
    'Statistiques d’activité (30 derniers jours environ) :',
    `- Minutes passées en vocal : ${profile.voiceMinutes}`,
    `- Messages publiés : ${profile.messageCount}`,
    `- Score d’activité combiné : ${profile.activityScore}`,
  ];

  if (profile.summary) {
    sections.push('', profile.summary);
  }

  const appendInsights = (
    title: string,
    items: Array<{ title: string; detail: string; confidence: string }> | undefined,
  ): void => {
    if (!items || items.length === 0) {
      return;
    }
    sections.push('', title);
    for (const item of items) {
      const detail = item.detail?.trim() ?? '';
      sections.push(`- ${item.title} — ${detail.length > 0 ? detail : '(détail indisponible)'} (confiance : ${item.confidence})`);
    }
  };

  const persona = profile.persona;
  appendInsights('Points forts', persona.highlights);
  appendInsights('Identité — Rôles', persona.identity?.roles);
  appendInsights('Identité — Langues', persona.identity?.languages);
  appendInsights('Identité — Lieux', persona.identity?.locations);
  appendInsights('Centres d’intérêt', persona.interests);
  appendInsights('Expertise', persona.expertise);
  appendInsights('Personnalité — Traits', persona.personality?.traits);
  appendInsights('Personnalité — Communication', persona.personality?.communication);
  appendInsights('Personnalité — Valeurs', persona.personality?.values);
  appendInsights('Préférences — Aime', persona.preferences?.likes);
  appendInsights('Préférences — N’aime pas', persona.preferences?.dislikes);
  appendInsights('Préférences — Conseils de collaboration', persona.preferences?.collaborationTips);
  appendInsights('Préférences — Formats de contenu', persona.preferences?.contentFormats);
  appendInsights('Initiateurs de conversation', persona.conversationStarters);
  appendInsights('Style de vie', persona.lifestyle);
  appendInsights(
    'Citations notables',
    persona.notableQuotes?.map((quote) => ({
      title: quote.context ? `Citation (${quote.context})` : 'Citation',
      detail: quote.quote,
      confidence: 'medium',
    })),
  );
  appendInsights('Avertissements', persona.disclaimers);

  return sections.join('\n');
}

async function loadActiveMemberProfiles(limit: number): Promise<ActiveMemberPersonaProfile[]> {
  const voiceActivityRepository = new VoiceActivityRepository({
    url: config.database?.url,
    ssl: Boolean(config.database?.ssl),
  });

  const stats = await voiceActivityRepository.getCommunityStatistics({ limitTopMembers: limit });
  const topMembers = stats.topMembers.filter((member) => typeof member.userId === 'string');

  if (topMembers.length === 0) {
    return [];
  }

  const userIds = topMembers.map((member) => member.userId);
  const [personaMap, pseudoMap] = await Promise.all([
    fetchPersonaProfiles(userIds),
    fetchUserPseudos(userIds),
  ]);

  const profiles: ActiveMemberPersonaProfile[] = [];
  for (const member of topMembers) {
    const userId = member.userId;
    if (!userId) {
      continue;
    }

    const personaRecord = personaMap.get(userId);
    if (!personaRecord) {
      console.warn(`Aucune fiche persona disponible pour l'utilisateur ${userId}, membre ignoré.`);
      continue;
    }

    const pseudo = pseudoMap.get(userId) ?? member.displayName ?? member.username ?? userId;
    profiles.push({
      userId,
      pseudo,
      voiceMinutes: member.voiceMinutes,
      messageCount: member.messageCount,
      activityScore: member.activityScore,
      summary: personaRecord.summary,
      persona: personaRecord.persona,
    });
  }

  return profiles;
}

async function main(): Promise<void> {
  process.env.ALLOW_MISSING_BOT_TOKEN = process.env.ALLOW_MISSING_BOT_TOKEN ?? '1';

  logInfo('Initialisation de la synchronisation des profils Libre Antenne.');

  logStep(1, 'Vérification de la configuration de la base de données…');
  if (!config.database?.url) {
    throw new Error('DATABASE_URL must be configured to synchronize discord_vectors.');
  }

  logStep(2, 'Vérification de la configuration OpenAI…');
  if (!config.openAI?.apiKey) {
    throw new Error('OPENAI_API_KEY must be configured to synchronize discord_vectors.');
  }

  logStep(3, 'Mise à jour du schéma de la table discord_vectors…');
  await ensureDiscordVectorSchema();

  logStep(4, 'Purge des entrées existantes…');
  await query('DELETE FROM discord_vectors;');
  logInfo('Anciennes entrées supprimées.');

  logStep(5, 'Récupération des membres actifs et de leurs personas…');
  const activeMembers = await loadActiveMemberProfiles(10);
  if (activeMembers.length === 0) {
    throw new Error("Impossible de charger les profils des membres actifs : aucune persona disponible.");
  }
  logInfo(`Profils actifs chargés : ${activeMembers.length}`);

  logStep(6, 'Calcul des embeddings des membres actifs…');
  const memberDocuments = await Promise.all(
    activeMembers.map(async (member) => {
      const content = formatPersonaDocument(member);
      const embedding = await getEmbedding(content);
      return {
        content,
        metadata: {
          source: 'libre-antenne-member',
          pseudo: member.pseudo,
          userId: member.userId,
        },
        vectorLiteral: buildVectorLiteral(embedding),
      };
    }),
  );

  logStep(7, 'Insertion des profils en base…');
  await insertDiscordVectors(memberDocuments);
  logInfo(`Insertion terminée pour ${memberDocuments.length} profils.`);
}

void main()
  .then(() => {
    console.log('discord_vectors table synchronized successfully.');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Failed to synchronize discord_vectors table.', error);
    process.exit(1);
  });
