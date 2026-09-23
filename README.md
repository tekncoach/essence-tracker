# essence-tracker

[![Site](https://img.shields.io/badge/site-tekncoach.github.io%2Fessence--tracker-f08a3c)](https://tekncoach.github.io/essence-tracker/)
[![Déploiement](https://github.com/tekncoach/essence-tracker/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/tekncoach/essence-tracker/actions/workflows/pages/pages-build-deployment)
[![Dernier commit](https://img.shields.io/github/last-commit/tekncoach/essence-tracker)](https://github.com/tekncoach/essence-tracker/commits/main)
[![Données](https://img.shields.io/badge/données-prix--carburants.gouv.fr-000091)](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/)
![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8)

Carte des stations-service françaises avec le prix, la fraîcheur et la disponibilité de chaque carburant. Page statique, sans compte : tout tourne dans le navigateur, et les réglages de chaque utilisateur (carburants préférés, favoris, point de départ) restent dans son `localStorage`. Seules les alertes de retour d'un carburant passent par un petit service, un Worker Cloudflare (`worker/`).

## Fonctionnalités

- Carte des stations autour de soi (géolocalisation), d'une ville, d'un code postal ou d'une adresse, rechargée quand on se déplace.
- Pins par marque, dont la taille et l'opacité suivent le prix : plus le pin est gros, moins c'est cher. Stations en rupture ou fermées en petit point gris.
- Fiche station : prix et date de déclaration de chaque carburant, ruptures avec leur date de début, automate 24/24 ou passage en caisse selon les horaires du jour, liens vers la fiche officielle et, pour les TotalEnergies, vers leur locator.
- Vue en liste des stations visibles, triée par prix ou par distance.
- Carburants préférés dans l'ordre choisi, favoris, point de départ (clic droit ou appui long sur la carte).
- Installable comme une app (PWA).
- Alerte de retour d'un carburant indisponible dans une station : notification push quand il revient, vérifiée chaque heure, à usage unique, valable 7 jours. Sur iPhone, l'app doit être installée sur l'écran d'accueil.

## Sources de données

| Donnée | Source | Accès |
|---|---|---|
| Stations, prix, ruptures, horaires | [Flux instantané prix-carburants](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/) (ministère de l'Économie) | API, depuis le navigateur |
| Marque et nom de station | [API 2aaz](https://api.prix-carburants.2aaz.fr) (communautaire) | `brands/` pré-généré pour l'Île-de-France et l'Oise, sinon appelée une fois par station puis mise en cache |
| Position précise des stations | OpenStreetMap via Overpass (tag `ref:FR:prix-carburants`) | par zone de 0,1°, en cache 30 jours |
| Recherche d'adresse | [Base Adresse Nationale](https://adresse.data.gouv.fr) | API, depuis le navigateur |
| Code des stations TotalEnergies | Woosmap, rapproché par distance | `total-codes.json`, pré-généré |

Le flux officiel n'a ni la marque ni le nom des stations, arrondit les coordonnées (~100 m, parfois des kilomètres d'erreur) et omet parfois un carburant en rupture : c'est ce que les autres sources compensent.

## Lancer en local

```sh
python3 -m http.server 8765
```

Puis ouvrir http://localhost:8765. La géolocalisation et l'installation en app exigent `localhost` ou https.

## Régénérer les données pré-calculées

```sh
python3 scripts/update_brands.py                                 # brands/, départements listés en tête du script
TE_WOOSMAP_KEY=woos-… python3 scripts/update_total_codes.py      # total-codes.json
```

`TE_WOOSMAP_KEY` est la clé publique que le front de locator.totalenergies.com envoie à api.woosmap.com (onglet réseau du navigateur). Elle n'est pas versionnée.

## Alertes (`worker/`)

Un Worker Cloudflare enregistre les alertes (station, carburant, abonnement Web Push) dans un espace KV, interroge chaque heure le flux officiel (complété par 2aaz quand le flux ne dit rien du carburant), envoie une notification pour chaque carburant revenu et supprime l'alerte. Web Push est implémenté en WebCrypto (`worker/src/push.js`).

```sh
cd worker
npm install
npm test                 # chiffrement et signature VAPID contre l'implémentation de référence
npm run dev              # Worker local ; vérification horaire déclenchée par /cdn-cgi/local/scheduled
npm run deploy
```

La clé privée VAPID est un secret du Worker (`wrangler secret put VAPID_PRIVATE_JWK`) et, en local, dans `worker/.dev.vars`, non versionné. La clé publique est dans `worker/wrangler.jsonc` et `index.html`.

## Crédits

Logos des marques issus de mon-essence.fr, pictogrammes de carburants issus de locator.totalenergies.com. Fonds de carte © contributeurs OpenStreetMap.
