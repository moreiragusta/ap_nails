/*
 * Conteúdo fixo da landing — mantido pela NUKKI.
 * Serviços, preços, horários, endereço e contatos vêm do painel da Amanda.
 */

export const content = {
  ownerFullName: 'Amanda Penteado',
  headline: 'Unhas bem cuidadas também são autoestima',
  intro: 'Atendimento individual e com hora marcada. Escolha o serviço, veja os horários livres e agende em menos de um minuto.',
  logo: '/brand/logo.webp',

  about: {
    title: 'Sobre mim',
    // TODO(NUKKI): substituir pela foto e pelo texto enviados pela Amanda.
    photo: '/gallery/trabalho-2.webp',
    paragraphs: [
      'Oi, eu sou a Amanda! Cuido de cada atendimento com calma e atenção, porque acredito que unhas bem feitas mudam o jeito como a gente se sente.',
      'Trabalho com manicure, esmaltação em gel e alongamento, sempre com materiais de qualidade e todo o cuidado com a higiene. Aqui o horário é só seu.',
    ],
  },

  // TODO(NUKKI): trocar pelas fotos originais em alta resolução (formato WebP, ~1200px).
  gallery: [
    { src: '/gallery/trabalho-1.webp', alt: 'Unhas nude com francesinha e uma unha com glitter rosé' },
    { src: '/gallery/trabalho-2.webp', alt: 'Francesinha clássica em unhas quadradas' },
    { src: '/gallery/trabalho-3.webp', alt: 'Esmaltação malva com detalhe em folha de ouro' },
    { src: '/gallery/trabalho-4.webp', alt: 'Unhas amendoadas em tons nude e rosé' },
  ],

  // TODO(NUKKI): confirmar as regras com a Amanda.
  faq: [
    {
      q: 'Como confirmo meu horário?',
      a: 'Depois de agendar pelo site, a Amanda te chama no WhatsApp para confirmar. É só responder a mensagem.',
    },
    {
      q: 'Preciso cancelar ou remarcar. Como faço?',
      a: 'Chame a Amanda no WhatsApp com a maior antecedência possível, assim o horário fica livre para outra cliente.',
    },
    {
      q: 'Quais formas de pagamento são aceitas?',
      a: 'Pix, dinheiro e cartão de débito ou crédito (por aproximação).',
    },
    {
      q: 'E se eu me atrasar?',
      a: 'Avise pelo WhatsApp. Como os horários são encaixados um após o outro, atrasos longos podem exigir remarcação.',
    },
    {
      q: 'Quanto tempo dura a esmaltação em gel?',
      a: 'Em média de 2 a 3 semanas, dependendo dos cuidados e do crescimento das unhas.',
    },
  ],

  privacyNote: 'Seu nome e WhatsApp são usados apenas para combinar o seu atendimento.',
  credit: { label: 'Desenvolvido por NUKKI', href: '#' },
};
