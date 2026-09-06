export default {
  commun: {
    connecte: 'Connecté',
    reconnexion: 'Reconnexion…',
    horsLigne: 'Hors ligne',
    connexionBloquee: 'Ta connexion réseau bloque ce jeu — essaie un autre réseau',
    chargement: 'Chargement…',
    copier: 'Copier',
    copie: 'Copié !',
    envoyer: 'Envoyer',
    quitter: 'Quitter',
    hote: 'Hôte',
    secondesRestantes: '{{count}}s',
    pointsGagnes: '+{{points}}',
    fermer: 'Fermer',
    themeClair: 'Thème clair',
    themeSombre: 'Thème sombre',
  },

  accueil: {
    logoAction: 'Action',
    logoSep: 'ou',
    logoVerite: 'Vérité',
    tagline: 'Salons privés, en temps réel, entre amis.',
    pseudo: 'Pseudo',
    email: 'Email',
    motDePasse: 'Mot de passe',
    sInscrire: "S'inscrire",
    seConnecter: 'Se connecter',
    dejaUnCompte: 'Déjà un compte ?',
    pasEncoreDeCompte: 'Pas encore de compte ?',
    jouerSansCompte: 'Jouer sans compte',
    jouer: 'Jouer',
    revenirConnexion: 'Retour à la connexion',
  },

  menu: {
    salut: 'Salut {{pseudo}} !',
    seDeconnecter: 'Se déconnecter',
    creerUnSalon: 'Créer un salon',
    creerUnSalonHint: "Vous devenez l'hôte et choisissez les réglages ensuite.",
    codeDuSalon: 'Code du salon',
    codeDuSalonPlaceholder: 'ABCDEF',
    rejoindre: 'Rejoindre',
    gererMesQuestions: 'Gérer mes questions',
    bientotDisponible: 'Bientôt disponible.',
    commentJouer: 'Comment jouer',
  },

  invite: {
    badge: 'Invité',
    creerUnCompte: 'Créer un compte',
    creerUnCompteHint: 'Ajoutez un email et un mot de passe pour retrouver votre compte sur un autre appareil. Tout est conservé : pseudo, parties, questions.',
  },

  salon: {
    codeLabel: 'Code du salon',
    joueurs: 'Joueurs ({{count}}/{{max}})',
    nombreMaxJoueurs: 'Nombre maximum de joueurs',
    encoreJoueurs: {
      one: 'Encore {{count}} joueur pour pouvoir lancer.',
      other: 'Encore {{count}} joueurs pour pouvoir lancer.',
    },
    finDePartie: 'Fin de partie',
    tours: 'Tours',
    score: 'Score',
    nombreDeTours: 'Nombre de tours',
    scoreCible: 'Score cible',
    scoreCibleAffiche: 'Score cible : {{score}} points',
    toursAffiche: { one: '{{count}} tour', other: '{{count}} tours' },
    tempsDeReponse: 'Temps de réponse',
    secondes: { one: '{{count}} seconde', other: '{{count}} secondes' },
    secondesAffiche: { one: '{{count}} seconde pour répondre', other: '{{count}} secondes pour répondre' },
    tempsDeReponseHint: '30 secondes convient à des réponses courtes, 90 à des réponses écrites plus longues.',
    niveauDesQuestions: 'Niveau des questions',
    langueDesQuestions: 'Langue des questions',
    commentJouer: 'Comment jouer',
    lancerLaPartie: 'Lancer la partie',
    enAttenteHoteLance: "En attente que l'hôte lance la partie…",
    quitterLeSalon: 'Quitter le salon',
    pressePapiersIndisponible: 'Presse-papiers indisponible',
    copieImpossible: 'Impossible de copier automatiquement, notez le code manuellement.',
    reglesDuJeu: 'Règles du jeu',
    aucuneRegleActive: 'Aucune règle spéciale activée.',
    categorie: 'Catégorie',
    categorieGeneral: 'Entre amis',
    categorieCouple: 'En couple',
    categorieGeneralHint: 'La banque de questions habituelle, pour un groupe.',
    categorieCoupleHint: "Une banque dédiée à deux, du léger à l'intime. Verrouillé à 2 joueurs, sans niveau.",
  },

  regles: {
    refusCouteux: {
      nom: 'Le refus qui coûte',
      description: 'Passer son tour coûte 2 points ; le joueur suivant choisit alors sa question parmi 3.',
    },
    doubleOuRien: {
      nom: 'Le double ou rien',
      description:
        'Avant de voir la question, tenter le niveau du dessus : points doublés en cas de réponse, rien sinon.',
    },
    questionRetournee: {
      nom: 'La question retournée',
      description:
        'Une fois par partie, renvoyez votre question au joueur qui vous a le mieux noté au tour précédent.',
    },
    tourSurprise: {
      nom: 'Le tour surprise',
      description: 'Environ un tour sur cinq : tout le monde répond à la même question, puis vote pour la meilleure.',
    },
    pariMutuel: {
      nom: 'Le pari mutuel (2 joueurs)',
      description: "À deux, l'autre parie sur votre réponse avant de l'entendre — vu juste rapporte 2 points.",
    },
  },

  niveau: {
    label: {
      1: 'Tout public',
      2: 'Entre amis',
      3: 'Sans filtre',
    },
    description: {
      1: 'Questions légères, adaptées à tous les groupes.',
      2: "Plus osé, pour un groupe qui se connaît déjà bien.",
      3: 'Sans limite — à réserver à un groupe averti.',
    },
  },

  partie: {
    preparationDuTour: 'Préparation du tour…',
    verite: 'Vérité',
    action: 'Action',
    questionIndisponible: 'Question indisponible pour ce tour.',
    ecrisTaReponse: 'Écris ta réponse…',
    estEnTrainDeRepondre: '{{pseudo}} est en train de répondre…',
    tourEnResolution: 'Tour en cours de résolution…',
    enAttenteDesVotes: 'En attente des votes des autres joueurs…',
    voteEnvoye: 'Vote envoyé, en attente des autres…',
    pouceHaut: 'Pouce vers le haut',
    pouceBas: 'Pouce vers le bas',
    tourTermine: 'Tour terminé, préparation du suivant…',
    resultatAttente: 'En attente du tirage',
    resultat: 'Résultat : {{type}}',
    gagnePoints: {
      one: '{{pseudo}} gagne {{points}} point',
      other: '{{pseudo}} gagne {{points}} points',
    },
    reponseGuillemet: '« {{reponse}} »',
    reponseDansLeChat: 'Réponse envoyée, votez dans le chat ci-dessous.',
    tempsEcoule: 'Temps écoulé, aucune réponse.',
    recapitulatif: 'Récapitulatif',
    recapVide: 'Aucun tour joué pour le moment.',

    // Règle A : le refus qui coûte
    refuser: 'Refuser de répondre (-2 points)',
    refusResultat: '{{pseudo}} a refusé de répondre (-2 points)',
    choisirUneQuestion: 'Choisis la question qui te sera posée',
    choisirCelleCi: 'Choisir celle-ci',
    enAttenteChoixDeQuestion: '{{pseudo}} choisit sa prochaine question…',

    // Règle B : le double ou rien
    doubleOuRienTitre: 'Double ou rien ?',
    doubleOuRienTexte: 'Tenter le niveau du dessus : points doublés si tu réponds, rien si tu ne réponds pas.',
    doubleOuRienAccepter: 'Tenter (niveau supérieur)',
    doubleOuRienRefuser: 'Rester à ce niveau',
    enAttenteDoubleOuRien: '{{pseudo}} décide de tenter le double ou rien…',
    doubleOuRienBadge: 'Double ou rien',

    // Règle C : la question retournée
    retournerLaQuestion: 'Retourner la question',
    questionRetourneeMessage: 'Question retournée à {{pseudo}}',

    // Règle D : le tour surprise
    tourSurpriseTitre: 'Tour surprise !',
    tourSurpriseTexte: 'Tout le monde répond à la même question.',
    tourSurpriseProgression: '{{count}} / {{total}} ont répondu',
    tourSurpriseVoterTitre: 'Vote pour la meilleure réponse',
    tourSurpriseDejaVote: 'Vote envoyé, en attente des autres…',
    tourSurpriseGagnant: {
      one: '{{pseudo}} gagne le tour surprise ({{points}} point)',
      other: '{{pseudo}} gagne le tour surprise ({{points}} points)',
    },

    // Règle E : le pari mutuel
    pariEcrisTonPari: 'Que va répondre {{pseudo}} ?',
    pariEnvoyer: 'Parier',
    pariEnvoye: 'Pari envoyé, en attente de la réponse…',
    pariJugerTitre: 'Le pari de {{pseudo}}',
    pariVuJuste: 'Vu juste (+2)',
    pariACote: 'À côté',
    pariResultatJuste: '{{pseudo}} avait vu juste (+2 points)',
    pariResultatACote: '{{pseudo}} était à côté',
  },

  chat: {
    titre: 'Chat',
    aucunMessage: "Aucun message pour l'instant.",
    envoiEnCours: 'Envoi…',
    echecReessayer: 'Échec, réessayer',
    ecrireUnMessage: 'Écrire un message…',
    messageLabel: 'Message',
    tropDeMessages: 'Trop de messages envoyés, patiente un instant.',
    repondre: 'Répondre',
    reponseA: 'Réponse à {{pseudo}}',
    annulerLaReponse: 'Annuler la réponse',
  },

  fin: {
    partieTerminee: 'Partie terminée',
    classementIndisponible: 'Classement indisponible.',
    rejouer: 'Rejouer',
    enAttenteHoteRelance: "En attente que l'hôte relance une partie…",
  },

  app: {
    etatSalonInconnu: 'État de salon inconnu. Essayez de recharger la page.',
  },

  didacticiel: {
    titre: 'Comment jouer',
    compris: 'Compris, on joue !',

    essentielTitre: "L'essentiel",
    tourTitre: 'Le tour',
    tourTexte: 'La roue tire Vérité ou Action. Le joueur actif répond, les autres votent.',
    pointsTitre: 'Les points',
    pointsTexte:
      'Vérité rapporte {{verite}} point, Action {{action}} points. Chaque pouce vers le haut ajoute {{bonus}} point.',
    tempsTitre: 'Le temps',
    tempsTexte:
      '{{answer}} secondes pour répondre, {{vote}} secondes pour voter. Passé ce délai, le tour se termine sans point.',
    voteTitre: 'Le vote',
    voteTexte: 'Un pouce vers le haut donne un point bonus. À 2 joueurs, le vote est sauté.',

    niveauxTitre: 'Les niveaux',
    niveauxTexte:
      "L'hôte choisit un niveau : Tout public, Entre amis, ou Sans filtre. Le tirage est cumulatif : un niveau élevé pioche aussi dans les niveaux plus légers, pas seulement dans le sien.",

    coupleTitre: 'Le mode couple',
    coupleTexte:
      "Une banque de questions dédiée à deux, du léger à l'intime, sans notion de niveau — à vous deux de décider où vous arrêter. Verrouillé à 2 joueurs pour rester dans son contexte.",

    langueTitre: 'La langue des questions',
    langueTexte:
      "L'hôte choisit la langue dans laquelle les questions sont piochées, indépendamment de la langue d'interface de chacun.",

    reglesTitre: 'Les règles optionnelles',
    reglesAucuneActive: 'Aucune règle optionnelle activée dans cette partie.',

    reponseTitre: 'Répondre à un message',
    reponseTexte:
      "Appui long sur un message (ou survol puis clic sur ordinateur) pour lui répondre — la citation renvoie au message d'origine d'un tap.",

    recapTitre: 'Le récapitulatif',
    recapTexte: 'Le bouton "Récapitulatif" retrouve à tout moment les questions et réponses des tours précédents.',

    nouveautesTitre: 'Nouveautés',
    nouveautesIntro: "Depuis votre dernière visite, l'application s'est enrichie :",
    voirDidacticielComplet: 'Voir le didacticiel complet',
  },

  erreurLimite: {
    titre: 'Un problème est survenu',
    description:
      "Quelque chose s'est mal passé. Rechargez la page pour continuer — votre partie reprendra là où elle en était.",
    recharger: 'Recharger',
  },

  erreurs: {
    NETWORK_ERROR: 'Erreur réseau, vérifiez votre connexion.',
    SOCKET_NOT_CONNECTED: 'Non connecté au serveur.',
    SOCKET_TIMEOUT: 'Le serveur ne répond pas, réessayez.',
    INVALID_SETTINGS: 'Réglages de fin de partie invalides.',
    INVALID_NIVEAU: 'Niveau invalide.',
    INVALID_LANGUE: 'Langue invalide.',
    INVALID_MAX_PLAYERS: 'Le nombre maximum de joueurs doit être entre 2 et 20.',
    INVALID_ANSWER_SEC: 'Le temps de réponse doit être 30, 45, 60 ou 90 secondes.',
    MAX_PLAYERS_BELOW_CURRENT: 'Impossible de descendre sous le nombre de joueurs déjà présents.',
    INVALID_CATEGORIE: 'Catégorie invalide.',
    CATEGORIE_TOO_MANY_PLAYERS: 'Impossible de passer en mode couple : trop de joueurs sont déjà dans le salon (maximum 2).',
    CATEGORIE_LOCKS_NIVEAU: "Le niveau ne s'applique pas en mode couple.",
    CATEGORIE_LOCKS_MAX_PLAYERS: 'Le nombre de joueurs est verrouillé à 2 en mode couple.',
    ROOM_NOT_JOINABLE: "Ce salon n'est plus accessible.",
    ROOM_FULL: 'Le salon est complet.',
    ALREADY_IN_ROOM: 'Vous êtes déjà dans ce salon.',
    ROOM_NOT_FOUND: 'Salon introuvable.',
    CANNOT_START: 'Il faut au moins {{min}} joueurs pour lancer la partie.',
    NOT_ENOUGH_QUESTIONS:
      'Questions insuffisantes pour {{maxTurns}} tours : il manque {{missingVerite}} vérité(s) et {{missingAction}} action(s).',
    NO_QUESTIONS_LEFT: 'Plus de question disponible.',
    NOT_YOUR_TURN: "Ce n'est pas votre tour.",
    EMPTY_ANSWER: 'La réponse ne peut pas être vide.',
    INVALID_PHASE: 'Action invalide pour le moment.',
    STALE_TURN: 'Ce tour est déjà terminé.',
    CANNOT_VOTE_SELF: 'Vous ne pouvez pas voter pour vous-même.',
    PLAYER_NOT_FOUND: 'Joueur introuvable.',
    ALREADY_VOTED: 'Vous avez déjà voté.',
    INVALID_VOTE: 'Vote invalide.',
    ROOM_NOT_FINISHED: "La partie n'est pas terminée.",
    EMPTY_MESSAGE: 'Le message ne peut pas être vide.',
    MESSAGE_TOO_LONG: 'Le message dépasse {{maxLength}} caractères.',
    RATE_LIMITED: 'Trop de messages envoyés, patiente un instant.',
    NOT_HOST: "Seul l'hôte peut faire cette action.",
    NOT_IN_ROOM: "Vous n'êtes dans aucun salon.",
    REPLY_TARGET_NOT_FOUND: 'Message cité introuvable.',
    REGLE_DISABLED: "Cette règle n'est pas activée dans ce salon.",
    INVALID_REGLE: 'Règle invalide.',
    QUESTION_RETOURNEE_INDISPONIBLE: "Impossible de retourner la question sur ce tour.",
    PARI_MUTUEL_INDISPONIBLE: 'Le pari mutuel est indisponible ici.',
    SURPRISE_VOTE_INVALID: 'Ce joueur ne peut pas recevoir de vote.',
    ALREADY_ANSWERED: 'Vous avez déjà répondu.',
    INVALID_CHOICE: 'Ce choix ne fait pas partie des propositions.',
    INTERNAL_ERROR: 'Erreur interne, réessayez.',
    AUTH_REQUIRED: 'Authentification requise.',
    INVALID_TOKEN: 'Session expirée, reconnectez-vous.',
    INVALID_PSEUDO: 'Le pseudo doit contenir {{min}} à {{max}} caractères (lettres, chiffres, _ ou -).',
    INVALID_EMAIL: 'Adresse email invalide.',
    INVALID_PASSWORD: 'Le mot de passe doit contenir au moins {{minLength}} caractères.',
    PSEUDO_TAKEN: 'Ce pseudo est déjà pris.',
    EMAIL_TAKEN: 'Cet email est déjà utilisé.',
    INVALID_CREDENTIALS: 'Email ou mot de passe incorrect.',
    UNAUTHORIZED: 'Authentification requise.',
    GUEST_NOT_FOUND: 'Session invité introuvable, reconnectez-vous.',
    INVALID_GUEST_TOKEN: 'Session invité invalide.',
    NOT_A_GUEST: "Ce compte n'est pas un compte invité.",
    GUEST_NOT_ALLOWED: 'Cette action est réservée aux comptes complets.',
  },
};
