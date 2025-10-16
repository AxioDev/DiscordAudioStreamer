import 'dotenv/config';
import { Pool } from 'pg';

const parseBoolean = (value: string | undefined | null): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL doit être défini pour exécuter la migration.');
    process.exit(1);
    return;
  }

  const useSsl = parseBoolean(process.env.DATABASE_SSL);
  const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tableExistsResult = await client.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'blog_post_proposals'
        ) AS exists
      `,
    );

    const tableExists = tableExistsResult.rows[0]?.exists ?? false;
    if (!tableExists) {
      console.log('La table blog_post_proposals est absente : aucune migration nécessaire.');
      await client.query('COMMIT');
      return;
    }

    const { rows } = await client.query<{
      id: number;
      slug: string;
      title: string;
      excerpt: string | null;
      content_markdown: string;
      cover_image_url: string | null;
      tags: string[] | null;
      seo_description: string | null;
      submitted_at: Date;
    }>(
      `
        SELECT
          id,
          slug,
          title,
          excerpt,
          content_markdown,
          cover_image_url,
          tags,
          seo_description,
          submitted_at
        FROM blog_post_proposals
        ORDER BY submitted_at ASC
      `,
    );

    let migrated = 0;

    for (const row of rows) {
      const publishedAt = row.submitted_at ?? new Date();
      const tags = Array.isArray(row.tags)
        ? row.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter((tag) => tag.length > 0)
        : [];

      const result = await client.query(
        `
          INSERT INTO blog_posts (
            slug,
            title,
            excerpt,
            content_markdown,
            cover_image_url,
            tags,
            seo_description,
            published_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (slug) DO NOTHING
        `,
        [
          row.slug,
          row.title,
          row.excerpt,
          row.content_markdown,
          row.cover_image_url,
          tags,
          row.seo_description,
          publishedAt,
          publishedAt,
        ],
      );

      if (result.rowCount && result.rowCount > 0) {
        migrated += 1;
      }
    }

    const proposalIds = rows.map((row) => row.id);
    if (proposalIds.length > 0) {
      await client.query('DELETE FROM blog_post_proposals WHERE id = ANY($1::int[])', [proposalIds]);
    }

    await client.query('DROP TABLE IF EXISTS blog_post_proposals');

    await client.query('COMMIT');

    if (rows.length === 0) {
      console.log('Aucun article en attente n’a été trouvé, la table blog_post_proposals a été supprimée.');
      return;
    }

    console.log(
      `Migration terminée : ${migrated} article(s) transféré(s), ${proposalIds.length} entrée(s) supprimée(s) et la table blog_post_proposals a été archivée.`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Échec de la migration des articles en attente vers les articles publiés.', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
