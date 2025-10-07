# Rapport d'optimisation SEO – Libre Antenne

## Résumé exécutif
- **Priorité haute – Auto-héberger les dépendances front et industrialiser le bundling** : Tailwind, Preact, Chart.js, Three.js, marked, lucide et les polices Inter sont encore servis depuis Google/esm.sh. Mettre en place un bundler (Vite/ESBuild) pour produire des bundles versionnés et auto-héberger CSS/polices afin de réduire la latence, supprimer les requêtes tierces et garantir la conformité RGPD.【F:public/index.html†L76-L101】【F:public/scripts/core/deps.js†L1-L102】
- **Priorité haute – Généraliser le SSR enrichi aux pages statiques restantes** : `/classements`, `/boutique` et `/about` ne livrent que le shell SEO sans `appHtml` ni `preloadState`, ce qui crée un décalage entre métadonnées et contenu réel et fragilise l'indexation. Produire un markup prêt à l'emploi (tableaux, catalogue, manifesto) réduira le risque de « soft 404 » et améliorera le crawl.【F:src/http/AppServer.ts†L2356-L2403】【F:src/http/AppServer.ts†L2460-L2495】【F:src/http/AppServer.ts†L2522-L2559】
- **Priorité moyenne – Encadrer la génération d'articles automatisée** : le `DailyArticleService` publie directement les contenus OpenAI (texte + image) sans relecture humaine. Instaurer un workflow éditorial et un contrôle qualité manuel demeure indispensable pour la crédibilité et l'E-E-A-T.【F:src/services/DailyArticleService.ts†L354-L398】

## Audit technique détaillé

### Architecture, rendu et crawlabilité
- Les pages stratégiques (`/`, `/membres`, `/blog`, `/blog/...`, `/profil/...`) sont pré-rendues côté serveur et injectent désormais un `preloadState` sérialisé (participants, articles, tags) directement consommé par le client, ce qui évite les requêtes redondantes au chargement.【F:src/http/AppServer.ts†L2615-L2626】【F:src/http/AppServer.ts†L2799-L2808】【F:src/http/AppServer.ts†L3099-L3115】【F:src/http/SeoRenderer.ts†L326-L356】【F:public/scripts/main.js†L57-L109】
- Le client détecte la présence de markup serveur et déclenche `hydrate()` pour conserver le contenu SSR existant, limitant les reflows et garantissant une transition fluide vers l'application interactive.【F:public/scripts/main.js†L1090-L1096】
- Les routes `/classements`, `/boutique` et `/about` continuent toutefois de renvoyer uniquement le shell SEO ; leur fournir un `appHtml` (tableaux de scores, catalogue, manifeste) et éventuellement un `preloadState` maintiendra la cohérence entre balises et rendu.【F:src/http/AppServer.ts†L2356-L2403】【F:src/http/AppServer.ts†L2460-L2495】【F:src/http/AppServer.ts†L2522-L2559】

### Pilotage du crawl (robots & sitemap)
- Le `robots.txt` autorise l'intégralité du site hors `/admin` et `/bannir`, tandis que le sitemap assemble les routes statiques et les flux dynamiques (blog, profils, activités) avec un filtrage correct des membres masqués.【F:public/robots.txt†L1-L6】【F:src/http/AppServer.ts†L585-L609】
- Pour aller plus loin, calculer un `lastmod` fiable pour les URLs statiques (home, boutique, about, classements) et enrichir les profils avec la dernière activité ou mise à jour renforcera la fraîcheur perçue. Les helpers existent déjà (`formatSitemapDate`), il suffit de leur fournir des timestamps pertinents.【F:src/http/AppServer.ts†L604-L660】

### Métadonnées et balisage
- `SeoRenderer` demeure la source de vérité pour les balises Open Graph, Twitter et JSON-LD, injectant systématiquement titres, descriptions, hreflang et scripts structurés.【F:src/http/SeoRenderer.ts†L296-L339】
- Documenter un guide interne (format d'images, longueur des descriptions, gestion des `news_keywords`) permettra d'aligner les contributions humaines et générées avec les métadonnées préconfigurées côté serveur.【F:src/http/AppServer.ts†L2464-L2558】

### Performance & Core Web Vitals
- Les dépendances critiques restent chargées via des CDN externes (Google Fonts, `cdn.tailwindcss.com`, `esm.sh`) avec un JS non fractionné. L'objectif est de migrer vers un pipeline bundlé, minifier/treeshaker les modules et proposer des bundles différenciés (critical vs. lazy) pour réduire TTFB et LCP.【F:public/index.html†L76-L101】【F:public/scripts/core/deps.js†L1-L102】
- Le SSR stabilisé ouvre la porte à une stratégie « streaming + hydrations progressives » : prioriser l'envoi du markup critique, différer Chart.js/Three.js et ne charger les graphes qu'au scroll améliorerait FID/INP tout en réduisant le JS initial.【F:src/http/AppServer.ts†L1205-L1300】【F:public/scripts/core/deps.js†L1-L102】

### Contenus & sémantique
- L'automatisation quotidienne des articles continue d'alimenter le blog sans relecture. Ajouter une validation humaine (fact-check, ton, illustration alternative) et croiser ces contenus avec des liens internes vers profils/archives audio renforcera l'E-E-A-T.【F:src/services/DailyArticleService.ts†L354-L398】【F:src/http/AppServer.ts†L2562-L2824】
- Les pages pré-rendues exposent désormais des sections riches (home, membres, blog). Prévoir une routine de mise à jour éditoriale pour ces blocs (ex. témoignages, programme hebdo) garantira la cohérence entre SSR et contenu live.【F:src/http/AppServer.ts†L1205-L1300】【F:src/http/AppServer.ts†L2615-L3115】

### Données structurées & signaux enrichis
- Chaque route SSR majeure injecte du JSON-LD contextualisé (`RadioChannel`, `Blog`, `Article`, `Person`/`ProfilePage`, `Dataset`).【F:src/http/AppServer.ts†L2356-L3115】
- Prochaine étape : ajouter des schémas `AudioObject`/`PodcastSeries` pour les flux live et préparer un `SpeakableSpecification` sur les articles maintenant que l'hydratation est en place.【F:src/http/AppServer.ts†L2562-L3115】

### Suivi & gouvernance
- Intégrer la génération du sitemap, la vérification des balises SEO et des tests de réhydratation (validation de `__PRERENDER_STATE__`) dans la CI aidera à prévenir les régressions introduites par le SSR et le futur bundling.【F:src/http/AppServer.ts†L585-L609】【F:src/http/SeoRenderer.ts†L326-L356】【F:public/scripts/main.js†L57-L109】
- Mettre en place un workflow éditorial (revue humaine + guidelines) pour les articles IA et des alertes sur les temps de réponse du SSR assurera un pilotage continu de la qualité.【F:src/services/DailyArticleService.ts†L354-L398】

## Feuille de route suggérée
1. **M-1** : Industrialiser le bundling front (Vite/ESBuild), auto-héberger polices/dépendances et préparer des bundles critiques + différés pour améliorer les Core Web Vitals.【F:public/index.html†L76-L101】【F:public/scripts/core/deps.js†L1-L102】
2. **M-2** : Étendre le pré-rendu et le `preloadState` aux pages statiques (classements, boutique, about) puis exposer des `lastmod` précis dans le sitemap pour fiabiliser l'indexation.【F:src/http/AppServer.ts†L2356-L2559】【F:src/http/AppServer.ts†L585-L609】
3. **M-3** : Formaliser la gouvernance éditoriale (revue humaine, guidelines SEO) et enrichir les schémas structurés (`AudioObject`, `SpeakableSpecification`) autour des contenus audio et articles automatisés.【F:src/services/DailyArticleService.ts†L354-L398】【F:src/http/AppServer.ts†L2562-L3115】
