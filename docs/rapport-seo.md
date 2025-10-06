# Rapport d'optimisation SEO – Libre Antenne

## Résumé exécutif
- **Priorité haute – Délivrer un HTML indexable pour les pages clés** : l'application reste un SPA Preact monté sur `#app` sans rendu statique. Les moteurs reçoivent uniquement le shell vide de `index.html`, le contenu étant hydraté via `main.js`. Implémenter un SSR/SSG ou un pré-rendu côté serveur pour `/`, `/membres`, `/blog`, `/profil/...`, etc.【F:public/index.html†L12-L101】【F:public/scripts/main.js†L1-L200】
- **Priorité haute – Consolider le couple robots/sitemap** : un `robots.txt` et un sitemap dynamique sont désormais exposés, mais le sitemap liste encore `/bannir` (route volontairement « disallow ») et ignore les pages dynamiques (profils, propositions). Harmoniser robots et sitemap, et couvrir toutes les URLs indexables avec dates de mise à jour fiables.【F:public/robots.txt†L1-L6】【F:src/http/AppServer.ts†L520-L800】
- **Priorité haute – Maîtriser le coût de chargement du front** : Tailwind, Preact, Chart.js, Three.js, lucide et les polices sont toujours chargés via des CDN `esm.sh`/Google, ce qui rallonge le TTFB/LCP et dépend du réseau tiers. Mettre en place un bundler (Vite/ESBuild) pour servir des bundles auto-hébergés, activer le code splitting et n'hydrater que les vues critiques au premier rendu.【F:public/index.html†L76-L99】【F:public/scripts/core/deps.js†L1-L101】
- **Priorité moyenne – Encadrer la production éditoriale automatisée** : la génération quotidienne d'articles via OpenAI publie directement dans le blog. Formaliser une relecture humaine (fact-check, ton) avant mise en ligne et prévoir des gabarits visuels cohérents pour les images générées.【F:src/services/DailyArticleService.ts†L354-L511】【F:src/http/AppServer.ts†L874-L896】

## Audit technique détaillé

### Architecture, rendu et crawlabilité
- Le site reste entièrement rendu côté client : sans JavaScript, on ne voit que le conteneur vide de `index.html`, même si les métadonnées sont bien générées côté serveur par `SeoRenderer`. La mise en place d'un SSR/SSG (Preact render-to-string, prerendering Puppeteer ou Vite SSR) est indispensable pour rendre les flux, profils et articles crawlables dès la réponse initiale.【F:public/index.html†L12-L101】【F:public/scripts/main.js†L1-L200】
- `SeoRenderer` fournit un en-tête complet (titres, balises sociales, JSON-LD, breadcrumbs). Conserver cette logique comme source de vérité et la brancher sur un rendu HTML pré-généré afin d'éviter les incohérences métadonnées/contenu.【F:src/http/SeoRenderer.ts†L95-L200】

### Pilotage du crawl (robots & sitemap)
- `robots.txt` autorise désormais le crawl global et bloque `/admin` et `/bannir`. Veiller à maintenir ce fichier à jour (ex. nouvelles zones privées) et à surveiller la Search Console pour détecter les blocages inattendus.【F:public/robots.txt†L1-L6】
- Le sitemap dynamique couvre les pages statiques principales et le blog, mais inclut `/bannir` (non indexable) et omet les profils, archives audio et futurs contenus générés. Étendre `buildSitemapEntries()` pour lister les profils publics, retirer les routes « disallow » et injecter des dates `lastmod` fiables (publication / mise à jour réelle).【F:src/http/AppServer.ts†L520-L799】

### Métadonnées et balisage
- Les routes serveur injectent des métadonnées adaptées (Open Graph, Twitter, JSON-LD Article/Profile) via `SeoRenderer`. Documenter un guide interne pour garantir image 1200×630, description ≤160 caractères et cohérence des tags à chaque nouvelle page.【F:src/http/SeoRenderer.ts†L95-L200】【F:src/http/AppServer.ts†L1701-L2310】
- Ajouter des microdonnées spécifiques aux contenus audio (ex. `AudioObject` ou `PodcastSeries`) pour renforcer la compréhension des flux live et des replays lorsque le SSR sera en place.【F:src/http/AppServer.ts†L1701-L2310】

### Performance & Core Web Vitals
- Les dépendances critiques sont chargées depuis des CDN externes (`cdn.tailwindcss.com`, `esm.sh`, Google Fonts). Auto-héberger CSS/polices, générer un bundle JS optimisé et différer Chart.js/Three.js hors de la vue initiale pour réduire le blocage du main thread.【F:public/index.html†L76-L99】【F:public/scripts/core/deps.js†L1-L101】
- Segmenter le code (lazy loading des pages blog/classements) et exploiter un pré-chauffage serveur pour limiter le coût du SPA lors des transitions. Un audit Lighthouse régulier permettra de suivre LCP/FID/CLS.

### Contenus & sémantique
- La page d'accueil gagne à expliciter davantage la proposition de valeur (format d'émission, horaires, bénéfices pour nouveaux auditeurs) avec des sections structurées (`h2/h3`, FAQ) une fois le SSR déployé.【F:public/scripts/pages/home.js†L64-L156】
- Les articles générés automatiquement doivent être relus, enrichis de visuels réels quand c'est possible et reliés à des contenus internes (profils, archives audio) pour renforcer l'E-E-A-T et réduire les risques de duplications.【F:src/services/DailyArticleService.ts†L354-L511】

### Données structurées & signaux enrichis
- Le JSON-LD Article/Profile est en place côté serveur. Ajouter des `BreadcrumbList` et des `SpeakableSpecification` pour les contenus audio/texte lorsque le rendu HTML sera stabilisé, et valider régulièrement via Rich Results Test.【F:src/http/AppServer.ts†L1701-L2310】
- Publier un flux RSS/Atom pour le blog et les chroniques quotidiennes afin de faciliter la syndication et renforcer la découverte des nouveaux contenus.【F:src/http/AppServer.ts†L1701-L2310】

### Suivi & gouvernance
- Intégrer la génération du sitemap et la vérification robots/structured data dans la CI (tests e2e ou scripts) pour détecter les régressions avant mise en production.【F:src/http/AppServer.ts†L520-L799】
- Mettre en place une revue éditoriale pour les articles IA (workflow dans l'admin) et un tableau de bord Search Console/Analytics dédié aux pages live, profils et blog pour prioriser les optimisations.

## Feuille de route suggérée
1. **M-1** : implémenter SSR/prerender sur les pages publiques critiques, revoir le bundling (auto-hébergement des assets, splitting) et corriger le sitemap (`/bannir`, profils, dates `lastmod`).
2. **M-2** : enrichir les pages éditoriales (FAQ, sections services, intertitres), formaliser la relecture des articles automatisés et intégrer de nouveaux schémas (`AudioObject`, `Speakable`).
3. **M-3** : automatiser la génération/validation sitemap & structured data dans la CI, publier un flux RSS et suivre Lighthouse + Search Console dans un rapport mensuel.
4. **Continu** : monitorer les Core Web Vitals, ajuster la stratégie de contenus, cultiver des partenariats/presse pour booster la notoriété.
