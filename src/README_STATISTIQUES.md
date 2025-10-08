# Tableau de bord des statistiques communautaires

Cette section décrit l’implémentation de la page `/statistiques` et des API associées. Elle documente les indicateurs clés présentés au sein du tableau de bord, les paramètres de filtrage disponibles et les requêtes exécutées côté serveur.

## Points d’accès principaux

### API HTTP

- **Endpoint** : `GET /api/statistiques`
- **Service** : [`StatisticsService.getStatistics`](services/StatisticsService.ts)
- **Référentiel** : [`VoiceActivityRepository.getCommunityStatistics`](services/VoiceActivityRepository.ts)
- **Paramètres** :
  - `since` / `until` (ISO 8601) — limite temporelle de l’agrégation.
  - `granularity` (`day`, `week`, `month`, `year`) — taille du bucket temporel.
  - `activity` — liste CSV des types d’activité (`voice`, `text`, `arrivals`, `departures`, `mentions`, `hype`).
  - `channels` — liste CSV d’identifiants de salons à isoler.
  - `userId` — filtre sur un membre spécifique.
  - `heatmap`, `hype` — booleans pour inclure/exclure la heatmap et l’historique « hype ».
  - `limitTop`, `limitChannels` — bornes pour les classements renvoyés.
  - `userSearch` — terme libre pour l’autocomplétion côté UI.

Les paramètres sont normalisés dans `AppServer.parseStatisticsQuery` avant d’être transmis au service. Le service valide les bornes temporelles, applique les valeurs par défaut (30 jours glissants, granularité hebdomadaire) et contraint les limites de résultats.

### Page front-end

- **Module** : `public/scripts/pages/statistiques.js`
- **Route** : `/statistiques` (publique, accessible sans authentification)
- **Intégration** : enregistrée dans `public/scripts/main.js` via `navigateToRoute('statistiques', …)`.

La page récupère les données via l’endpoint précédent, applique les filtres utilisateurs en mettant à jour l’URL (fonction `buildRouteParams`) et affiche les indicateurs via Chart.js.

## Indicateurs clés (KPI)

Chaque métrique est directement issue du snapshot renvoyé par `VoiceActivityRepository.getCommunityStatistics` :

| KPI | Source | Description |
| --- | --- | --- |
| Membres totaux / actifs | `snapshot.totals.totalMembers`, `snapshot.totals.activeMembers` | Taille de la communauté et volume actif sur la période.
| Nouveaux membres | `snapshot.totals.newMembers` et `snapshot.newMembers[]` | Arrivées agrégées par bucket temporel.
| Temps vocal cumulé | `snapshot.totals.voiceMinutes` | Minutes cumulées de présence en salon vocal.
| Messages envoyés | `snapshot.totals.messageCount` | Volume textuel agrégé.
| Moyenne connectés / heure | `snapshot.totals.averageConnectedPerHour` | Audience horaire moyenne.
| Rétention | `snapshot.retention[]` | Retour des membres après 7/30/90 jours (ou fenêtres configurées).
| Classement membres actifs | `snapshot.topMembers[]` | Score combinant temps vocal et messages.
| Activité par salon | `snapshot.channelActivity.voice[]` / `.text[]` | Top salons vocaux et textuels.
| Heatmap horaire | `snapshot.heatmap[]` | Intensité de l’activité par jour & heure (optionnelle).
| Historique hype | `snapshot.hypeHistory[]` | Evolution du score « hype » agrégé (optionnelle).

## Autocomplétion & filtres

- `StatisticsService` appelle `VoiceActivityRepository.searchUsersByName` pour alimenter les suggestions utilisateur lorsque `userSearch` est fourni.
- `VoiceActivityRepository.listActiveChannels` renvoie la liste des salons les plus actifs pour aider à constituer les filtres.
- Le front applique les filtres via `deriveInitialFilters` (lecture des paramètres de route) et `computeApiRequest` (construction de la requête HTTP).

## Performance & rafraîchissement

- Les résultats de `/api/statistiques` sont mis en cache (HTTP) pendant 30 secondes (`Cache-Control: public, max-age=30, stale-while-revalidate=90`).
- Les agrégations SQL sont exécutées dans `VoiceActivityRepository`. Les vues matérialisées/index nécessaires doivent être maintenues côté base (non couvert ici, mais le repository consomme directement les vues dédiées).
- Le front propose un bouton « Actualiser » forçant une nouvelle requête (refresh client uniquement).

## Extensions possibles

- Ajouter des filtres supplémentaires (catégorie de salon, nombre de résultats personnalisable) en étendant `buildRouteParams` côté front et `parseStatisticsQuery` côté serveur.
- Exposer des exports CSV/JSON depuis le même service si besoin d’audit externe.

Cette documentation doit être mise à jour dès que de nouveaux champs sont ajoutés au snapshot ou que la structure de la route évolue.
