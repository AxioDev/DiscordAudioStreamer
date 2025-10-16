# Rapport d'optimisation SEO – Libre Antenne

## Résumé exécutif
- **Priorité haute – Activer la compression HTTP sur les assets fingerprintés** : les bundles ESBuild sont désormais hashés et servis avec un cache long, mais Express ne compresse ni HTML ni fichiers statiques. Ajouter `compression` (ou servir des variantes Brotli pré-générées) réduira drastiquement le poids transféré et consolidera les Core Web Vitals en production.【F:scripts/build-client.mjs†L130-L183】【F:src/http/AppServer.ts†L3004-L3050】
- **Priorité moyenne – Stabiliser les dates `lastmod` du sitemap** : les nouvelles règles alimentent enfin chaque URL statique avec des signaux métiers, mais retombent sur `serverBootTimestamp` en cas de données manquantes. Persister ces horodatages (fichiers, timestamps en base) évitera les faux positifs de mise à jour à chaque redéploiement.【F:src/http/AppServer.ts†L825-L848】
- **Priorité moyenne – Harmoniser canoniques et `hreflang` des routes FR/EN** : les routes `/membres` et `/members` partagent le même handler, mais seule la version française est déclarée dans les balises et métadonnées. Déclarer explicitement les alternates et une canonique commune lèvera l’ambiguïté pour Google et Bing.【F:src/http/AppServer.ts†L4320-L4369】

## Audit technique détaillé

### Architecture, rendu et crawlabilité
- Les pages stratégiques (`/`, `/membres`, `/blog`, `/blog/...`, `/profil/...`) restent pré-rendues côté serveur avec un `preloadState` sérialisé consommé par le client, évitant les requêtes redondantes au chargement.【F:src/http/AppServer.ts†L2615-L2626】【F:src/http/AppServer.ts†L2799-L2808】【F:src/http/AppServer.ts†L3099-L3115】【F:src/http/SeoRenderer.ts†L326-L356】【F:public/scripts/main.js†L57-L109】
- Le SSR a été étendu aux routes `/classements`, `/boutique` et `/about` : chacune renvoie désormais un `appHtml` complet (classements, catalogue, manifesto) et, quand nécessaire, un `preloadState` aligné sur la navigation client, ce qui sécurise l'indexation et réduit le risque de « soft 404 ».【F:src/http/AppServer.ts†L3183-L3370】

### Pilotage du crawl (robots & sitemap)
- Le `robots.txt` autorise l'intégralité du site hors `/admin` et `/bannir`, tandis que le sitemap assemble les routes statiques et dynamiques (blog, profils, activités) avec un filtrage correct des membres masqués.【F:public/robots.txt†L1-L6】【F:src/http/AppServer.ts†L585-L711】
- Les entrées statiques du sitemap s’appuient désormais sur les dernières activités (posts, classements, catalogue) avant de retomber sur l’horodatage de démarrage du serveur. Il reste à persister ces dates pour qu’un redéploiement n’entraîne pas de faux rafraîchissements massifs.【F:src/http/AppServer.ts†L825-L848】
- Les variantes `/boutique?checkout=...` déclenchent maintenant un `noindex,follow`, ce qui limite les duplications de crawl sur les retours de paiement.【F:src/http/AppServer.ts†L4395-L4429】

### Métadonnées et balisage
- `SeoRenderer` demeure la source de vérité pour Open Graph, Twitter et JSON-LD, injectant titres, descriptions, hreflang et scripts structurés de façon cohérente sur l'ensemble des routes SSR.【F:src/http/SeoRenderer.ts†L200-L366】
- La boutique expose désormais un `OfferCatalog` enrichi par un `ItemList` de produits complets (prix, moyens de paiement, attributs), ce qui couvre la base pour Merchant Center.【F:src/http/AppServer.ts†L4372-L4429】【F:src/http/AppServer.ts†L2447-L2572】
- Les routes bilingues (`/membres` / `/members`) n'annoncent toujours qu'une canonique française et aucun `hreflang`. Alimenter `alternateLanguages`/`alternateLocales` clarifiera la relation entre les variantes.【F:src/http/AppServer.ts†L4320-L4369】

### Performance & Core Web Vitals
- Le bundler ESBuild produit désormais des bundles fingerprintés (JS, CSS et polices) injectés avec un cache long d’un an côté Express, ce qui sécurise la réutilisation des assets entre pages.【F:scripts/build-client.mjs†L130-L183】【F:src/http/AppServer.ts†L3004-L3050】
- Le SSR stabilisé ouvre la voie à une stratégie « streaming + hydrations progressives » : prioriser l'envoi du markup critique, différer Chart.js/Three.js et ne charger les graphes qu'au scroll améliorerait FID/INP tout en réduisant le JS initial.【F:src/http/AppServer.ts†L1205-L1300】【F:public/scripts/core/deps.js†L1-L74】
- Aucun middleware de compression n'est encore appliqué : même avec des assets minifiés, chaque réponse HTML/JSON reste servie brute. Activer Brotli/Gzip (ou livrer des variantes précompressées) s'impose avant la mise en prod CDN.【F:src/http/AppServer.ts†L3004-L3050】

### Contenus & sémantique
- Les articles IA générés quotidiennement sont désormais publiés directement dans `blog_posts`. Une revue éditoriale a posteriori (vérifications factuelles, enrichissement interne) reste indispensable pour préserver l’E-E-A-T et maintenir un contenu fiable.【F:src/services/DailyArticleService.ts†L360-L411】【F:src/services/BlogRepository.ts†L271-L332】
- Les sections SSR (home, membres, classements, boutique, about) s'appuient désormais sur un markup riche. Prévoir une routine éditoriale pour rafraîchir les textes/CTA et synchroniser ces contenus avec les actualités du direct garantira la cohérence entre SSR et contenu live.【F:src/http/AppServer.ts†L1205-L2116】【F:src/http/AppServer.ts†L3183-L3434】

### Données structurées & signaux enrichis
- Chaque route SSR majeure injecte du JSON-LD contextualisé (`RadioChannel`, `Blog`, `Article`, `Person`/`ProfilePage`, `Dataset`).【F:src/http/AppServer.ts†L2356-L3434】
- La page d’accueil ne sert encore qu’un schéma `RadioChannel`; ajouter des `AudioObject` (diffusion live), `PodcastEpisode` ou `SpeakableSpecification` permettra de tirer parti des extraits audio dans Google/Assistant.【F:src/http/AppServer.ts†L5009-L5034】

### Suivi & gouvernance
- Automatiser dans la CI `npm run build` (vérification du manifest, présence des préloads et nettoyage des fallbacks) ainsi que les tests de réhydratation (`__PRERENDER_STATE__`) limitera les régressions SEO lors des déploiements SSR.【F:scripts/build-client.mjs†L105-L184】【F:src/http/SeoRenderer.ts†L400-L473】【F:public/scripts/main.js†L57-L109】
- Mettre en place un workflow éditorial (revue humaine + guidelines) pour les articles IA et des alertes sur les temps de réponse du SSR assurera un pilotage continu de la qualité.【F:src/services/DailyArticleService.ts†L355-L406】

## Feuille de route suggérée
1. **M-1** : Déployer la compression HTTP côté Node (ou servir des fichiers précompressés) et établir un budget Core Web Vitals pour suivre l’impact en prod.【F:src/http/AppServer.ts†L3004-L3050】
2. **M-2** : Persister des horodatages de mise à jour pour le sitemap et enrichir les balises `hreflang`/canoniques sur les routes bilingues (`/membres`, `/members`).【F:src/http/AppServer.ts†L825-L848】【F:src/http/AppServer.ts†L4320-L4369】
3. **M-3** : Poursuivre la gouvernance éditoriale (workflow IA) et ajouter des schémas audio (`AudioObject`, `SpeakableSpecification`) pour renforcer la visibilité des contenus live et générés.【F:src/services/DailyArticleService.ts†L355-L406】【F:src/http/AppServer.ts†L5009-L5034】
