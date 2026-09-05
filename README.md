# true_or_action

Jeu action ou vérité multijoueur en temps réel, salons privés par code.
Chat texte uniquement. Cible principale : connexions mobiles instables
(3G, data facturée cher) en Afrique de l'Est et de l'Ouest.

## Stack

- **Backend** : Node 20, Express, Socket.io, `pg` (pas d'ORM)
- **Frontend** : React + Vite, CSS écrit à la main (aucune librairie UI)
- **Base de données** : PostgreSQL (Neon)

## Structure

```
t_or_d/
├── server/          API HTTP + Socket.io + logique de jeu
│   └── src/
│       ├── config/      configuration (env, etc.)
│       ├── db/          accès PostgreSQL
│       ├── game/        machine à états du jeu (pure, testable sans socket)
│       ├── middleware/  middlewares Express
│       ├── routes/      routes HTTP (auth, questions...)
│       └── sockets/     handlers Socket.io
└── client/          application React (Vite)
    └── src/
        ├── components/  composants réutilisables
        ├── hooks/       hooks React (socket, auth...)
        └── screens/     écrans (accueil, menu, salon, partie, fin)
```

## Prérequis

- Node.js ≥ 20
- Un fichier `.env` à la racine (voir `.env.example` pour les clés
  attendues). Ce fichier n'est jamais commité.

## Installation

```bash
cd server && npm install
cd ../client && npm install
```

## Développement

```bash
# terminal 1 — API + Socket.io
cd server && npm run dev

# terminal 2 — client Vite
cd client && npm run dev
```

Le serveur lit le `.env` situé à la racine du dépôt (pas dans `/server`).
