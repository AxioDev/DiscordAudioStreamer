export interface AboutPageHighlight {
  title: string;
  body: string;
}

export interface AboutPageHero {
  eyebrow: string;
  title: string;
  paragraphs: string[];
  cta: {
    label: string;
    href: string;
  };
}

export interface AboutPageContent {
  hero: AboutPageHero;
  highlights: AboutPageHighlight[];
}

export const aboutPageContent: AboutPageContent = {
  hero: {
    eyebrow: 'Libre Antenne',
    title: 'À propos de Libre Antenne',
    paragraphs: [
      "Libre Antenne est une zone franche où les voix prennent le pouvoir. Le flux est volontairement brut, capté en direct sur notre serveur Discord pour amplifier les histoires, les confidences et les improvisations qui naissent.",
      "Notre équipe façonne un espace accueillant pour les marginaux créatifs, les gamers insomniaques et toutes les personnes qui ont besoin d’un micro ouvert. Ici, aucune intervention n’est scriptée : la seule règle est de respecter la vibe collective et de laisser la spontanéité guider la conversation.",
    ],
    cta: {
      label: 'Rejoindre la communauté',
      href: 'https://discord.gg/',
    },
  },
  highlights: [
    {
      title: 'Un laboratoire créatif',
      body:
        'Sessions freestyle, confessions lunaires, débats improvisés : chaque passage est un moment unique façonné par la communauté. Le direct nous permet de capturer cette énergie sans filtre.',
    },
    {
      title: 'Technologie artisanale',
      body:
        'Notre mixeur audio fait circuler chaque voix avec finesse. Les outils open source et les contributions des membres permettent d’améliorer constamment la qualité du flux.',
    },
    {
      title: 'Communauté inclusive',
      body:
        'Peu importe ton accent, ton parcours ou ton rythme de vie : tu es accueilli·e tant que tu joues collectif et que tu respectes celles et ceux qui partagent le micro.',
    },
    {
      title: 'Un projet vivant',
      body:
        'Les bénévoles, auditeurs et créateurs participent à l’évolution de Libre Antenne. Chaque nouvelle voix façonne la suite de l’aventure et inspire les fonctionnalités à venir.',
    },
  ],
};

export default aboutPageContent;
