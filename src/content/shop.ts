export interface ShopContentHighlight {
  label: string;
}

export interface ShopContentHero {
  eyebrow: string;
  title: string;
  description: string;
  highlights: ShopContentHighlight[];
  support: {
    eyebrow: string;
    body: string;
  };
}

export interface ShopContentSection {
  title: string;
  description: string;
}

export interface ShopContent {
  hero: ShopContentHero;
  sections: {
    verifiedPayments: ShopContentSection;
    cryptoFriendly: ShopContentSection;
  };
}

export const SHOP_CONTENT: ShopContent = {
  hero: {
    eyebrow: 'Boutique officielle',
    title: 'La Boutique Libre Antenne',
    description:
      'Soutiens la libre antenne et repars avec des pièces conçues pour les noctambules, les gamers et les voix libres. Paiement sécurisé via Stripe, PayPal ou CoinGate.',
    highlights: [
      { label: 'Stripe, PayPal & CoinGate' },
      { label: 'Livraison France & Europe' },
      { label: 'Production à la demande' },
    ],
    support: {
      eyebrow: 'Libre antenne',
      body: 'Chaque achat finance l’hébergement du bot, le mixage audio et la préparation de nouvelles émissions en roue libre. Merci de faire tourner la radio indépendante.',
    },
  },
  sections: {
    verifiedPayments: {
      title: 'Paiements vérifiés',
      description:
        'Stripe chiffre chaque transaction et accepte la plupart des cartes, Apple Pay et Google Pay. Aucun numéro sensible n’est stocké sur nos serveurs.',
    },
    cryptoFriendly: {
      title: 'Crypto friendly',
      description:
        'CoinGate permet de régler en Bitcoin, Lightning Network et plus de 70 altcoins, avec conversion instantanée en euros ou conservation en crypto.',
    },
  },
};
