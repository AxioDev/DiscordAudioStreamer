# Rapport d'optimisation SEO – Libre Antenne

## Résumé exécutif
- **Priorité haute – Sécuriser la livraison des bundles fingerprintés** : le build ESBuild génère désormais scripts, CSS et polices auto-hébergés, mais Express les sert sans directive de cache longue durée. Configurer `express.static` avec un `Cache-Control` fort (et prévoir un header plus souple pour `index.html`) permettra de capitaliser sur le versioning par hash, d’améliorer le LCP et de supprimer les requêtes répétées après navigation.【F:scripts/build-client.mjs†L105-L184】【F:src/http/AppServer.ts†L3004-L3022】
- **Priorité moyenne – Industrialiser la revue éditoriale des propositions IA** : les articles quotidiens OpenAI arrivent maintenant comme brouillons dans `blog_post_proposals`. Il faut définir un flux de validation (checklist E-E-A-T, publication manuelle, suivi des références) pour transformer ces propositions en billets publiés sans risquer de contenus non conformes.【F:src/services/DailyArticleService.ts†L355-L406】【F:src/services/BlogProposalService.ts†L145-L220】【F:src/services/BlogRepository.ts†L573-L609】
- **Priorité moyenne – Structurer la boutique pour le SEO commercial** : la page `/boutique` ne fait remonter qu'un schéma `OfferCatalog` générique alors que le service expose déjà prix, visuels, fournisseurs et avantages pour chaque produit. Générer des balises `Product`/`Offer` par article (et désindexer les variantes `?checkout=`) renforcera la visibilité e-commerce et évitera les duplications de crawl.【F:src/http/AppServer.ts†L3308-L3360】【F:src/services/ShopService.ts†L53-L146】

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
- Le bundler ESBuild produit désormais des bundles fingerprintés (JS, CSS et police Inter) injectés par le SSR. Sans configuration de cache, chaque navigation ressert néanmoins ces fichiers. Définir `max-age=31536000, immutable` sur `/assets` (et conserver un cache court sur `index.html`) exploitera enfin le versioning par hash et stabilisera le LCP.【F:scripts/build-client.mjs†L105-L184】【F:src/http/AppServer.ts†L3004-L3022】
- Le SSR stabilisé ouvre la voie à une stratégie « streaming + hydrations progressives » : prioriser l'envoi du markup critique, différer Chart.js/Three.js et ne charger les graphes qu'au scroll améliorerait FID/INP tout en réduisant le JS initial.【F:src/http/AppServer.ts†L1205-L1300】【F:public/scripts/core/deps.js†L1-L74】

### Contenus & sémantique
- Les articles IA sont maintenant enregistrés comme propositions (`blog_post_proposals`) plutôt que publiés automatiquement. Structurer une revue éditoriale (validation factuelle, enrichissement interne, publication dans `blog_posts`) et tracer les références `proposalReference` reste indispensable pour préserver l'E-E-A-T.【F:src/services/DailyArticleService.ts†L355-L406】【F:src/services/BlogProposalService.ts†L145-L220】【F:src/services/BlogRepository.ts†L573-L609】
- Les sections SSR (home, membres, classements, boutique, about) s'appuient désormais sur un markup riche. Prévoir une routine éditoriale pour rafraîchir les textes/CTA et synchroniser ces contenus avec les actualités du direct garantira la cohérence entre SSR et contenu live.【F:src/http/AppServer.ts†L1205-L2116】【F:src/http/AppServer.ts†L3183-L3434】

### Données structurées & signaux enrichis
- Chaque route SSR majeure injecte du JSON-LD contextualisé (`RadioChannel`, `Blog`, `Article`, `Person`/`ProfilePage`, `Dataset`).【F:src/http/AppServer.ts†L2356-L3434】
- Prochaine étape : ajouter des schémas `AudioObject`/`PodcastSeries` pour les flux live et préparer un `SpeakableSpecification` sur les articles maintenant que l'hydratation est en place.【F:src/http/AppServer.ts†L2562-L3434】

### Suivi & gouvernance
- Automatiser dans la CI `npm run build` (vérification du manifest, présence des préloads et nettoyage des fallbacks) ainsi que les tests de réhydratation (`__PRERENDER_STATE__`) limitera les régressions SEO lors des déploiements SSR.【F:scripts/build-client.mjs†L105-L184】【F:src/http/SeoRenderer.ts†L400-L473】【F:public/scripts/main.js†L57-L109】
- Mettre en place un workflow éditorial (revue humaine + guidelines) pour les articles IA et des alertes sur les temps de réponse du SSR assurera un pilotage continu de la qualité.【F:src/services/DailyArticleService.ts†L355-L406】

## Feuille de route suggérée
1. **M-1** : Configurer les en-têtes de cache (`Cache-Control`, `ETag`) sur les assets fingerprintés et monitorer les tailles de bundles pour capitaliser sur le build ESBuild en production.【F:scripts/build-client.mjs†L105-L184】【F:src/http/AppServer.ts†L3004-L3022】
2. **M-2** : Étendre le balisage SEO « commerce » : `lastmod` précis sur les pages statiques, `noindex` sur les retours de paiement et JSON-LD `Product`/`Offer` alimenté par `ShopService`.【F:src/http/AppServer.ts†L596-L711】【F:src/http/AppServer.ts†L3308-L3398】【F:src/services/ShopService.ts†L53-L146】
3. **M-3** : Formaliser la gouvernance éditoriale (revue humaine, guidelines SEO) et enrichir les schémas structurés (`AudioObject`, `SpeakableSpecification`) autour des contenus audio et articles automatisés.【F:src/services/DailyArticleService.ts†L355-L406】【F:src/http/AppServer.ts†L2562-L3434】
