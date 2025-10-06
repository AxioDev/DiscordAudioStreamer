# Rapport d'optimisation SEO – Libre Antenne

## Résumé exécutif
- **Priorité haute – Stabiliser un rendu indexable des pages clés** : malgré une excellente génération de métadonnées côté serveur, tout le contenu principal est rendu via une application Preact côté client. Sans exécution JavaScript, les moteurs ne voient qu'un shell vide, ce qui fragilise l'indexation du direct, des profils et du blog. Mettre en place un rendu pré-généré (SSR, SSG ou prerendering) pour les routes critiques (`/`, `/membres`, `/blog`, `/profil/...`).【F:public/scripts/main.js†L1-L200】【F:src/http/AppServer.ts†L1488-L1993】
- **Priorité haute – Publier un `robots.txt` et un sitemap XML** : aucun fichier n'est exposé actuellement, ce qui empêche de contrôler le crawl et d'annoncer les URLs importantes (blog, profils, pages statiques). Créer et servir ces deux fichiers depuis `public/` et mettre à jour la Search Console une fois en ligne.【822e67†L1-L1】【7ab7a0†L1-L1】
- **Priorité haute – Sécuriser les performances (Core Web Vitals)** : les librairies (Preact, Chart.js, Three.js, lucide), Tailwind et les polices sont chargées depuis des CDN externes, ce qui alourdit le temps de chargement initial du SPA. Auto-héberger les dépendances critiques, activer le code splitting et différer les composants coûteux (charts 3D) hors de la vue initiale.【F:public/index.html†L84-L98】【F:public/scripts/core/deps.js†L1-L43】
- **Priorité moyenne – Enrichir la stratégie de contenus** : la page d'accueil a un ton fort mais peu descriptif du service et des bénéfices. Prévoir des sections éditoriales structurées (FAQ, témoignages, programme) et optimiser les CTA pour capter des requêtes longues traînes liées au streaming communautaire.【F:public/scripts/pages/home.js†L64-L156】
- **Priorité moyenne – Industrialiser les signaux de données structurées** : l'infrastructure `SeoRenderer` est robuste, mais il faut documenter une check-list pour que chaque nouvel article, membre mis en avant ou page commerciale fournisse systématiquement image dédiée, mots-clés et métadonnées conformes aux schémas utilisés.【F:src/http/SeoRenderer.ts†L1-L240】【F:src/http/AppServer.ts†L1488-L1993】

## Audit technique détaillé

### Architecture, rendu et crawlabilité
- L'application repose sur un bundle Preact unique monté sur `#app`. Sans JS, la page reste vide car aucun HTML statique n'est fourni en dehors du shell initial.【F:public/index.html†L100-L104】【F:public/scripts/main.js†L1-L200】
- `AppServer` fournit des métadonnées personnalisées pour chaque route via `SeoRenderer`, mais la réponse HTML renvoyée demeure le même shell. Mettre en place un moteur de rendu côté serveur (ex : Preact SSR + cache) ou un prerendering programmatique (Puppeteer/Nitro) pour livrer des sections HTML déjà remplies aux bots et aux partages sociaux.【F:src/http/AppServer.ts†L1488-L1993】
- Les pages de recherche ou de modération sont protégées par `noindex`, ce qui est cohérent. Prévoir une QA régulière pour éviter de propager `noindex` sur des pages stratégiques lors d'ajouts futurs.【F:src/http/AppServer.ts†L1488-L1993】

### Pilotage du crawl (robots & sitemap)
- Aucun `robots.txt` ni sitemap n'est distribué depuis `public/`, ce qui limite la maîtrise du budget crawl et la découverte des pages profondes (profils, articles). Créer un `robots.txt` autorisant le crawl des sections publiques et pointant vers un `sitemap.xml` généré automatiquement (ex : depuis les routes Express ou un script CRON).【822e67†L1-L1】【7ab7a0†L1-L1】
- Une fois le sitemap en place, automatiser sa mise à jour (invalidation après nouveau billet, nouveau produit, profil mis en avant) et notifier Google/Bing pour accélérer l'indexation.

### Métadonnées et balisage
- Le template de base définit correctement titre, description, balises Open Graph/Twitter et données structurées `BroadcastService`, ce qui offre une base solide pour la homepage.【F:public/index.html†L13-L75】
- `SeoRenderer` ajoute dynamiquement des schémas `WebPage`, `Dataset`, `CollectionPage`, `Article`, `ProfilePage`, etc. Vérifier lors des QA que chaque page possède une image de partage pertinente et que les descriptions générées ne dépassent pas ~160 caractères pour éviter les troncatures.【F:src/http/SeoRenderer.ts†L1-L240】【F:src/http/AppServer.ts†L1488-L1993】
- Retirer ou actualiser la balise `meta keywords` (obsolète) pour éviter de signaler une optimisation datée et privilégier des FAQ ou HowTo en JSON-LD lorsque c'est pertinent.【F:public/index.html†L19-L23】

### Performance & Core Web Vitals
- Tailwind est chargé via CDN et les polices Google sont préchargées en externe. Auto-héberger les assets critiques, activer `font-display: swap` et intégrer les styles essentiels directement dans le bundle pour réduire le blocking time.【F:public/index.html†L84-L98】
- Les dépendances lourdes (Chart.js, Three.js, lucide) sont importées à travers `esm.sh`, ce qui provoque plusieurs requêtes tierces et retards de parsing. Mettre en place un bundling côté serveur (esbuild, Vite) pour produire un bundle optimisé et segmenter les features (différer les charts hors viewport).【F:public/scripts/core/deps.js†L1-L43】
- Auditer les interactions audio/temps réel pour s'assurer que les WebSocket/SSE ne bloquent pas le thread principal et que les statistiques ne sont chargées qu'après LCP.

### Contenus & sémantique
- La page d'accueil possède un `h1` clair mais un slogan très centré sur l'ambiance interne. Ajouter des sections plus descriptives (format d'émission, horaires, participation, bénéfices pour nouveaux venus) et une FAQ structurée pour capter des requêtes informationnelles.【F:public/scripts/pages/home.js†L64-L156】
- Structurer les pages blog avec des chapeaux, intertitres (`h2`/`h3`) et blocs rich media afin d'améliorer la lisibilité une fois le rendu SSR en place.

### Données structurées & signaux enrichis
- Les pages blog génèrent déjà un schéma `Article` avec dates, tags et image de couverture lorsque disponible. Documenter un workflow pour garantir une image 1200×630, une description optimisée et la cohérence des tags lors de chaque publication.【F:src/http/AppServer.ts†L1798-L1872】
- Les profils membres exposent un schéma `ProfilePage` avec statistiques (InteractionCounter). S'assurer que les données alimentées (présence, messages) sont toujours cohérentes et actualisées pour éviter des signaux contradictoires entre structured data et contenu rendu visuellement.【F:src/http/AppServer.ts†L1914-L2012】

### Suivi & gouvernance
- Mettre en place une checklist SEO dans le pipeline de publication (contrôle du rendu HTML, test Lighthouse, validation Schema.org, vérification robots/sitemap).
- Préparer des dashboards Search Console/Analytics dédiés aux pages clés (flux audio, blog, profils) pour mesurer l'impact des optimisations et ajuster le contenu éditorial.

## Feuille de route suggérée
1. **M-1** : implémenter SSR/prerender, publier `robots.txt` + `sitemap.xml`, auto-héberger les assets critiques.
2. **M-2** : refonte éditoriale de la homepage, ajout d'une FAQ + sections descriptives, amélioration des images Open Graph.
3. **M-3** : automatiser la génération du sitemap et des données structurées, intégrer tests Lighthouse/Schema.org dans la CI.
4. **Continu** : suivi Search Console, production régulière d'articles optimisés, outreach ciblé (partenariats podcasts/communautés) pour renforcer l'autorité.
