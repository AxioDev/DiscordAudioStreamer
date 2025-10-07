# Rapport d'optimisation SEO – Libre Antenne

## Résumé exécutif
- **Priorité haute – Hydrater le HTML pré-rendu et partager l'état initial** : les routes critiques injectent désormais un HTML SSR, mais le client reconstruit l'application avec `render()` sans réutiliser ce markup ni exploiter le placeholder `<!--APP_STATE-->`. Basculer sur `hydrate()` et transmettre l'état préchargé permettra de conserver le contenu immédiat et d'éviter un second aller-retour réseau pour les mêmes données.【F:src/http/AppServer.ts†L448-L458】【F:src/http/SeoRenderer.ts†L326-L356】【F:public/scripts/main.js†L993-L1004】
- **Priorité haute – Auto-héberger les dépendances front et industrialiser le bundling** : Tailwind, Preact, Chart.js, Three.js, marked, lucide et les polices Inter sont encore servis depuis Google/esm.sh. Mettre en place un bundler (Vite/ESBuild) pour produire des bundles versionnés et auto-héberger CSS/polices afin de réduire la latence, supprimer les requêtes tierces et garantir la conformité RGPD.【F:public/index.html†L76-L100】【F:public/scripts/core/deps.js†L1-L101】
- **Priorité moyenne – Étendre le pré-rendu aux pages encore vides côté bot** : `/classements`, `/boutique` et `/about` renvoient seulement le shell SEO. Leur fournir un `appHtml` (statique ou partiellement hydraté) garantirait un rendu indexable cohérent avec les métadonnées envoyées.【F:src/http/AppServer.ts†L2328-L2484】
- **Priorité moyenne – Encadrer la génération d'articles automatisée** : le `DailyArticleService` publie directement les contenus OpenAI (texte + image) sans étape de validation. Instaurer un workflow éditorial et un contrôle qualité manuel reste indispensable pour la crédibilité et l'E-E-A-T.【F:src/services/DailyArticleService.ts†L354-L390】

## Audit technique détaillé

### Architecture, rendu et crawlabilité
- Les pages stratégiques (`/`, `/membres`, `/blog`, `/blog/...`, `/profil/...`) sont maintenant pré-rendues côté serveur à partir des services internes (statistiques, blog, activité vocale) avant d'être injectées dans le template SEO.【F:src/http/AppServer.ts†L1156-L1260】【F:src/http/AppServer.ts†L2708-L3014】
- Les placeholders `<!--APP_HTML-->` et `<!--APP_STATE-->` sont correctement gérés dans le renderer, mais aucun état n'est encore sérialisé et le client réinitialise l'UI via `render()`. Préparer un objet `preloadState` pour chaque page et migrer vers `hydrate()` évitera les reflows post-chargement.【F:src/http/SeoRenderer.ts†L326-L356】【F:public/scripts/main.js†L993-L1004】
- Poursuivre l'effort sur les routes restantes (classements, boutique, about) en produisant un HTML accessible aux crawlers limitera les pages « soft 404 » en Search Console.【F:src/http/AppServer.ts†L2328-L2484】

### Pilotage du crawl (robots & sitemap)
- Le `robots.txt` autorise désormais tout le site hors `/admin` et `/bannir`, tandis que `getStaticSitemapDescriptors()` + les builders dynamiques couvrent la home, le blog, les profils actifs et filtrent bien les membres masqués.【F:public/robots.txt†L1-L6】【F:src/http/AppServer.ts†L523-L603】
- Pour aller plus loin, calculer un `lastmod` fiable pour les URLs statiques (home, boutique, about) et enrichir les profils avec la dernière activité ou mise à jour renforcera la fraîcheur perçue. Les helpers existent déjà (`formatSitemapDate`), il suffit de leur fournir des timestamps pertinents.【F:src/http/AppServer.ts†L604-L660】

### Métadonnées et balisage
- `SeoRenderer` demeure la source de vérité pour les balises Open Graph, Twitter et JSON-LD, injectant systématiquement titres, descriptions, hreflang et scripts structurés.【F:src/http/SeoRenderer.ts†L296-L339】
- Documenter un guide interne (format d'images, longueur des descriptions, gestion des `news_keywords`) permettra d'aligner les contributions humaines et générées avec les métadonnées préconfigurées côté serveur.【F:src/http/AppServer.ts†L2464-L2558】

### Performance & Core Web Vitals
- Les dépendances critiques restent chargées via des CDN externes (Google Fonts, `cdn.tailwindcss.com`, `esm.sh`) avec un JS non fractionné. L'objectif est de migrer vers un pipeline bundlé, minifier/treeshaker les modules et proposer des bundles différenciés (critical vs. lazy) pour réduire TTFB et LCP.【F:public/index.html†L76-L100】【F:public/scripts/core/deps.js†L1-L101】
- La présence d'un SSR ouvre la porte à une stratégie « streaming + hydrations progressives » : prioriser l'envoi du markup critique, différer Chart.js/Three.js et ne charger les graphes qu'au scroll améliorerait FID/INP.【F:src/http/AppServer.ts†L1156-L1260】【F:public/scripts/core/deps.js†L1-L101】

### Contenus & sémantique
- L'automatisation quotidienne des articles continue d'alimenter le blog sans relecture. Ajouter une validation humaine (fact-check, ton, illustration alternative) et croiser ces contenus avec des liens internes vers profils/archives audio renforcera l'E-E-A-T.【F:src/services/DailyArticleService.ts†L354-L428】【F:src/http/AppServer.ts†L2660-L2721】
- Les pages pré-rendues exposent désormais des sections riches (membres, articles, FAQ). Prévoir une routine de mise à jour éditoriale pour ces blocs (ex. témoignages, programme hebdo) garantira la cohérence entre SSR et contenu live.【F:src/http/AppServer.ts†L735-L900】【F:src/http/AppServer.ts†L1156-L1260】

### Données structurées & signaux enrichis
- Chaque route SSR majeure injecte du JSON-LD contextualisé (`RadioChannel`, `Blog`, `Article`, `Person`/`ProfilePage`, `Dataset`).【F:src/http/AppServer.ts†L2307-L3014】
- Prochaine étape : ajouter des schémas `AudioObject`/`PodcastSeries` pour les flux live et préparer un `SpeakableSpecification` sur les articles une fois l'hydratation stabilisée.【F:src/http/AppServer.ts†L2660-L3014】

### Suivi & gouvernance
- Intégrer la génération du sitemap, la vérification des balises SEO et un test d'hydratation dans la CI aidera à prévenir les régressions introduites par le SSR et le futur bundling.【F:src/http/AppServer.ts†L523-L603】【F:src/http/SeoRenderer.ts†L326-L356】
- Mettre en place un workflow éditorial (revue humaine + guidelines) pour les articles IA et des alertes sur les temps de réponse du SSR assurera un pilotage continu de la qualité.【F:src/services/DailyArticleService.ts†L354-L428】

## Feuille de route suggérée
1. **M-1** : Finaliser le SSR côté client (hydratation, `preloadState`, monitoring des erreurs) puis lancer l'industrialisation du bundling pour auto-héberger toutes les dépendances critiques.【F:src/http/SeoRenderer.ts†L326-L356】【F:public/scripts/core/deps.js†L1-L101】
2. **M-2** : Étendre le pré-rendu aux pages restantes (classements, boutique, about) et enrichir le sitemap avec des `lastmod` pertinents issus des services métier.【F:src/http/AppServer.ts†L2328-L2484】【F:src/http/AppServer.ts†L523-L603】
3. **M-3** : Structurer la gouvernance éditoriale (workflow de validation, checklists SEO) et lancer les schémas spécifiques audio/speakable pour capitaliser sur le SSR stabilisé.【F:src/services/DailyArticleService.ts†L354-L428】【F:src/http/AppServer.ts†L2660-L3014】
