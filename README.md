
---

- [Ce que fait l'application](#ce-que-fait-lapplication)
- [Aperçu](#aperçu)
- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Démarrage rapide](#démarrage-rapide)
- [Configuration (variables d'environnement)](#configuration-variables-denvironnement)
- [Les deux modes de stockage](#les-deux-modes-de-stockage)
- [Routes HTTP](#routes-http)
- [Règles de validation](#règles-de-validation)
- [Tests](#tests)
- [Docker](#docker)
- [Intégration et déploiement continus](#intégration-et-déploiement-continus)
- [Déploiement Kubernetes (Helm)](#déploiement-kubernetes-helm)
- [Structure du projet](#structure-du-projet)
- [Roadmap](#roadmap)
- [Contribuer](#contribuer)
- [Auteurs](#auteurs)
- [Licence](#licence)

---

## Ce que fait l'application

- Affiche la liste des messages signés dans le livre d'or (pseudo, texte).
- Permet de signer le livre via un formulaire HTML simple (aucun framework front, page générée par le serveur).
- Indique en haut de page **où sont stockées les données** (fichier local ou base Postgres).
- Affiche le nombre de messages.
- Nettoie et valide les saisies pour éviter les messages vides ou abusivement longs.
- Attend patiemment que PostgreSQL soit prêt au démarrage (utile en conteneur, où la base démarre souvent *après* l'app).
- Renvoie un HTTP **503** tant que la base n'est pas prête, pour ne pas servir une page cassée.

## Aperçu

```

Stockage actuel : base de donnees Postgres
3 message(s). Si tu lis ceci depuis un conteneur, la boite tourne.

[ Ton pseudo ] [ Ton message ]  ( Signer )

• younes : premier !
• anonyme : je passe en coup de vent
```

## Stack technique

| Domaine | Choix | Pourquoi |
|---|---|---|
| Runtime | **Node.js 22** | Aucune dépendance web : le module `http` natif suffit, moins de surface d'attaque |
| Base de données | **PostgreSQL 16** (via `pg`) | Le mode « vraie base » pour le déploiement en cluster |
| Conteneurisation | **Docker** (`node:22-alpine`) | Image légère, base Alpine |
| CI/CD | **GitLab CI** | Tests → build/push image → déploiement |
| Orchestration | **Kubernetes via Helm** | Chart maison `livredor-kit` |
| Ingress | **Traefik** | `IngressClass` du cluster k3d local |
| Tests | **`node --test`** (runner natif) | Zéro dépendance de test |

## Architecture

```
┌────────────┐      ┌─────────────────────┐      ┌──────────────────┐
│ Navigateur │─────▶│ App Node.js (port   │─────▶│ PostgreSQL :5432 │
│            │◀─────│ 3000)               │◀─────│                  │
└────────────┘      └─────────────────────┘      └──────────────────┘
                       ▲                        (mode DATABASE_URL)
                       │
                    Ingress Traefik              ou bien
                   <release>.promo001.local   ┌──────────────────┐
                                              │ Fichier messages │
                                              │ .json (DATA_DIR) │
                                              └──────────────────┘
```

L'application **choisit son mode toute seule** : si la variable `DATABASE_URL` est définie, elle parle à Postgres ; sinon, elle écrit dans un simple fichier JSON. C'est le même code dans les deux cas, ce qui rend l'app exécutable aussi bien sur un laptop que dans un cluster.

## Démarrage rapide

### En local, sans base de données (mode fichier)

```bash
git clone https://gitlab.com/gallouchy/livredor-ci.git
cd livredor-ci
npm install
npm start
```

L'application écoute sur <http://localhost:3000> et écrit les messages dans `/data/messages.json`.

> Pas envie d'écrire dans `/data` ? Utilise `DATA_DIR=./data npm start`.

### Avec PostgreSQL

```bash
export DATABASE_URL="postgres://livredor:promo001@localhost:5432/livredor"
npm start
```

La table `messages` est créée automatiquement au démarrage si elle n'existe pas.

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute du serveur HTTP |
| `DATA_DIR` | `/data` | Dossier de stockage en mode fichier |
| `DATABASE_URL` | *(vide)* | Chaîne de connexion Postgres. Si définie, bascule en mode base de données |
| `COULEUR` | — | Injectée par le chart Helm (personnalisation) |
| `DEVISE` | — | Injectée par le chart Helm (personnalisation) |

## Les deux modes de stockage

| | Mode fichier | Mode PostgreSQL |
|---|---|---|
| Déclencheur | `DATABASE_URL` absente | `DATABASE_URL` définie |
| Stockage | `$DATA_DIR/messages.json` | Table `messages` |
| Idéal pour | Démo locale, tests rapides | Déploiement en cluster, persistance durable |
| Retry au démarrage | — | 30 tentatives espacées de 2 s |

Schéma de la table créée automatiquement :

```sql
CREATE TABLE IF NOT EXISTS messages (
  id    SERIAL PRIMARY KEY,
  pseudo TEXT NOT NULL,
  texte  TEXT NOT NULL,
  date   TIMESTAMPTZ DEFAULT now()
);
```

## Routes HTTP

| Méthode | Route | Description | Réponse |
|---|---|---|---|
| `GET` | `/` | Affiche la page du livre d'or et la liste des messages | `200 text/html` |
| `POST` | `/message` | Enregistre un message (`pseudo`, `texte` en `form-urlencoded`) | `303` redirection vers `/` |
| — | `GET` (base non prête) | La base Postgres n'est pas encore joignable | `503 text/plain` |

Exemple de signature en ligne de commande :

```bash
curl -i -X POST http://localhost:3000/message \
  --data-urlencode "pseudo=younes" \
  --data-urlencode "texte=deuxième passage !"
```

## Règles de validation

Toute la logique de nettoyage vit dans `validation.js`, testée séparément de `app.js` :

- **Pseudo** : espaces rognés, vide → `anonyme`, tronqué à **40 caractères**.
- **Texte** : espaces rognés, tronqué à **200 caractères**, un texte vide (ou uniquement des espaces) est **rejeté**.

## Tests

```bash
npm test
```

Le projet utilise le runner natif de Node (`node --test`), donc aucune dépendance supplémentaire. Les 4 tests couvrent le nettoyage du pseudo, la troncature, et le rejet des messages vides.

```
✔ un pseudo vide devient anonyme
✔ un pseudo trop long est coupe a 40
✔ un texte trop long est coupe a 200
✔ un message vide est rejete, espaces compris
```

## Docker

Le `Dockerfile` construit une image minimale à partir de `node:22-alpine` :

```bash
docker build -t livredor-ci:local .
docker run -p 3000:3000 -v "$PWD/data:/data" livredor-ci:local
```

Pour brancher une base Postgres, ajoutez simplement l'environnement :

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL="postgres://livredor:promo001@host.docker.internal:5432/livredor" \
  livredor-ci:local
```

## Intégration et déploiement continus

Le pipeline GitLab (`.gitlab-ci.yml`) comporte trois étapes :

| Stage | Job | Action |
|---|---|---|
| `tests` | `tester` | `npm test` dans `node:22-alpine`, sur toutes les branches |
| `build` | `construire-et-pousser` | Build de l'image avec Docker-in-Docker, tag `livredor-ci:<SHA court>`, push sur Docker Hub, uniquement sur `main` |
| `deploy` | `deployer-boutique` | `helm upgrade --install prod ./livredor-kit` dans le namespace `prod` (créé si absent), avec `image.tag` = SHA court du commit, `--wait --timeout 5m`. Exécuté sur le runner `k3d-local` avec le kubeconfig issu de `KUBECONFIG_CONTENT`, uniquement sur `main` |

### Variables CI/CD à définir dans GitLab

| Variable | Contenu |
|---|---|
| `DOCKERHUB_USER` | Identifiant Docker Hub |
| `DOCKERHUB_TOKEN` | Token d'accès Docker Hub (protégé, masqué) |
| `KUBECONFIG_CONTENT` | kubeconfig encodé en base64 (job de déploiement) |

Le job de déploiement tourne sur un runner étiqueté `k3d-local`, ce qui permet de déployer vers un cluster Kubernetes local.

## Déploiement Kubernetes (Helm)

Le chart `livredor-kit/` décrit l'application **et** sa base de données :

- `Deployment` + `Service` pour l'app (2 réplicas par défaut, sondes readiness/liveness, requêtes/limites CPU-mémoire).
- `Deployment` + `Service` pour PostgreSQL 16, avec `strategy: Recreate` et un `PersistentVolumeClaim` de 500 Mi.
- `Secret` contenant le mot de passe Postgres **et** la `DATABASE_URL` consommée par l'app.
- `Ingress` Traefik exposant l'app sur `<release>.promo001.local`.

Déploiement manuel :

```bash
helm upgrade --install prod ./livredor-kit \
  -n prod --create-namespace \
  --set image.tag=<sha-ou-tag> \
  --wait --timeout 5m
```

Pour libérer les ressources :

```bash
helm uninstall prod -n prod
```

### Paramètres du chart (`values.yaml`)

| Clé | Description |
|---|---|
| `replicaCount` | Nombre de réplicas de l'app |
| `image.repository` | Dépôt de l'image (ex. `younes/livredor-ci`) |
| `image.tag` | Tag de l'image (écrasé par le pipeline avec le SHA du commit) |
| `couleur` / `devise` | Variables de personnalisation injectées dans le conteneur |
| `motdepasse` | Mot de passe Postgres (utilisé pour le secret) |
| `ingressClassName` | Classe d'Ingress utilisée (`traefik`) |

## Structure du projet

```
livredor-ci/
├── app.js                 # Serveur HTTP : les deux modes de stockage
├── validation.js          # Règles de nettoyage/validation des messages
├── validation.test.js     # Tests unitaires de validation.js
├── package.json           # Métadonnées et scripts npm
├── Dockerfile             # Image de production (node:22-alpine)
├── .gitlab-ci.yml         # Pipeline : tests → build/push → deploy
├── gitlab-ci.yml          # Variante locale : tests, build/push et un job `helm ls`
└── livredor-kit/          # Chart Helm
    ├── Chart.yaml
    ├── values.yaml
    └── templates/
        ├── livredor.yaml  # Deployment + Service de l'app
        ├── db.yaml        # PVC + Deployment + Service PostgreSQL
        ├── secret.yaml    # Mot de passe et DATABASE_URL
        └── ingress.yaml   # Ingress Traefik
```


