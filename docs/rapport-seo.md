# Rapport d'optimisation SEO – Libre Antenne

## Résumé exécutif
- **Priorité haute – Auto-héberger les dépendances front et industrialiser le bundling** : Tailwind, Preact, Chart.js, Three.js, marked, lucide et les polices Inter sont encore servis depuis Google/esm.sh. Mettre en place un bundler (Vite/ESBuild) pour produire des bundles versionnés et auto-héberger CSS/polices afin de réduire la latence, supprimer les requêtes tierces et garantir la conformité RGPD.【F:public/index.html†L66-L107】【F:public/scripts/core/deps.js†L1-L74】
- **Priorité haute – Encadrer la génération d'articles automatisée** : le `DailyArticleService` publie directement les contenus OpenAI (texte + image) sans relecture humaine. Instaurer un workflow éditorial et un contrôle qualité manuel demeure indispensable pour la crédibilité et l'E-E-A-T.【F:src/services/DailyArticleService.ts†L332-L405】
- **Priorité moyenne – Structurer la boutique pour le SEO commercial** : la page `/boutique` ne fait remonter qu'un schéma `OfferCatalog` générique alors que le service expose déjà prix, visuels, fournisseurs et avantages pour chaque produit. Générer des balises `Product`/`Offer` par article (et désindexer les variantes `?checkout=`) renforcera la visibilité e-commerce et évitera les duplications de crawl.【F:src/http/AppServer.ts†L3308-L3398】【F:src/services/ShopService.ts†L53-L146】

## Audit technique détaillé

### Architecture, rendu et crawlabilité
- Les pages stratégiques (`/`, `/membres`, `/blog`, `/blog/...`, `/profil/...`) restent pré-rendues côté serveur avec un `preloadState` sérialisé consommé par le client, évitant les requêtes redondantes au chargement.【F:src/http/AppServer.ts†L2615-L2626】【F:src/http/AppServer.ts†L2799-L2808】【F:src/http/AppServer.ts†L3099-L3115】【F:src/http/SeoRenderer.ts†L326-L356】【F:public/scripts/main.js†L57-L109】
- Le SSR a été étendu aux routes `/classements`, `/boutique` et `/about` : chacune renvoie désormais un `appHtml` complet (classements, catalogue, manifesto) et, quand nécessaire, un `preloadState` aligné sur la navigation client, ce qui sécurise l'indexation et réduit le risque de « soft 404 ».【F:src/http/AppServer.ts†L3183-L3370】

### Pilotage du crawl (robots & sitemap)
- Le `robots.txt` autorise l'intégralité du site hors `/admin` et `/bannir`, tandis que le sitemap assemble les routes statiques et dynamiques (blog, profils, activités) avec un filtrage correct des membres masqués.【F:public/robots.txt†L1-L6】【F:src/http/AppServer.ts†L585-L711】
- Les URLs statiques (home, boutique, about, classements) n'exposent toujours pas de `lastmod` dédié dans le sitemap. Alimenter `formatSitemapDate` avec des timestamps métiers améliorera la fraîcheur perçue par les moteurs.【F:src/http/AppServer.ts†L596-L711】
- Les variantes `/boutique?checkout=...` réutilisent le même contenu mais restent servies en `index,follow`. Appliquer `noindex` ou normaliser la canonicalisation côté serveur sur ces états de retour évitera du crawl gaspillé.【F:src/http/AppServer.ts†L3308-L3360】

### Métadonnées et balisage
- `SeoRenderer` demeure la source de vérité pour Open Graph, Twitter et JSON-LD, injectant titres, descriptions, hreflang et scripts structurés de façon cohérente sur l'ensemble des routes SSR.【F:src/http/SeoRenderer.ts†L185-L366】
- La boutique ne déclare qu'un `OfferCatalog` global alors que `ShopService` expose le détail des produits (prix, fournisseurs, visuels). Générer un `ItemList` avec des entrées `Product`/`Offer` enrichira les résultats riches et facilitera Merchant Center.【F:src/http/AppServer.ts†L3308-L3360】【F:src/services/ShopService.ts†L53-L146】

### Performance & Core Web Vitals
- Les dépendances critiques restent chargées via des CDN externes (Google Fonts, `cdn.tailwindcss.com`, `esm.sh`) avec un JS non fractionné. L'objectif est de migrer vers un pipeline bundlé, minifier/treeshaker les modules et proposer des bundles différenciés (critical vs. lazy) pour réduire TTFB et LCP.【F:public/index.html†L66-L107】【F:public/scripts/core/deps.js†L1-L74】
- Le SSR stabilisé ouvre la voie à une stratégie « streaming + hydrations progressives » : prioriser l'envoi du markup critique, différer Chart.js/Three.js et ne charger les graphes qu'au scroll améliorerait FID/INP tout en réduisant le JS initial.【F:src/http/AppServer.ts†L1205-L1300】【F:public/scripts/core/deps.js†L1-L74】

### Contenus & sémantique
- L'automatisation quotidienne des articles continue d'alimenter le blog sans relecture. Ajouter une validation humaine (fact-check, ton, illustration alternative) et croiser ces contenus avec des liens internes vers profils/archives audio renforcera l'E-E-A-T.【F:src/services/DailyArticleService.ts†L332-L405】【F:src/http/AppServer.ts†L2562-L2824】
- Les sections SSR (home, membres, classements, boutique, about) s'appuient désormais sur un markup riche. Prévoir une routine éditoriale pour rafraîchir les textes/CTA et synchroniser ces contenus avec les actualités du direct garantira la cohérence entre SSR et contenu live.【F:src/http/AppServer.ts†L1205-L2116】【F:src/http/AppServer.ts†L3183-L3434】

### Données structurées & signaux enrichis
- Chaque route SSR majeure injecte du JSON-LD contextualisé (`RadioChannel`, `Blog`, `Article`, `Person`/`ProfilePage`, `Dataset`).【F:src/http/AppServer.ts†L2356-L3434】
- Prochaine étape : ajouter des schémas `AudioObject`/`PodcastSeries` pour les flux live et préparer un `SpeakableSpecification` sur les articles maintenant que l'hydratation est en place.【F:src/http/AppServer.ts†L2562-L3434】

### Suivi & gouvernance
- Intégrer la génération du sitemap, la vérification des balises SEO et des tests de réhydratation (validation de `__PRERENDER_STATE__`) dans la CI aidera à prévenir les régressions introduites par le SSR et le futur bundling.【F:src/http/AppServer.ts†L585-L711】【F:src/http/SeoRenderer.ts†L326-L381】【F:public/scripts/main.js†L57-L109】
- Mettre en place un workflow éditorial (revue humaine + guidelines) pour les articles IA et des alertes sur les temps de réponse du SSR assurera un pilotage continu de la qualité.【F:src/services/DailyArticleService.ts†L332-L405】

## Feuille de route suggérée
1. **M-1** : Industrialiser le bundling front (Vite/ESBuild), auto-héberger polices/dépendances et préparer des bundles critiques + différés pour améliorer les Core Web Vitals.【F:public/index.html†L66-L107】【F:public/scripts/core/deps.js†L1-L74】
2. **M-2** : Étendre le balisage SEO « commerce » : `lastmod` précis sur les pages statiques, `noindex` sur les retours de paiement et JSON-LD `Product`/`Offer` alimenté par `ShopService`.【F:src/http/AppServer.ts†L596-L711】【F:src/http/AppServer.ts†L3308-L3398】【F:src/services/ShopService.ts†L53-L146】
3. **M-3** : Formaliser la gouvernance éditoriale (revue humaine, guidelines SEO) et enrichir les schémas structurés (`AudioObject`, `SpeakableSpecification`) autour des contenus audio et articles automatisés.【F:src/services/DailyArticleService.ts†L332-L405】【F:src/http/AppServer.ts†L2562-L3434】
