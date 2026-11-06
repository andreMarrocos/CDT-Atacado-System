// Display stands (expositores) that can be requested together with an order.
// They carry no price: the order only records type and quantity.
var CDT_ROOT = typeof window !== 'undefined' ? window : globalThis;
CDT_ROOT.CDT_EXPOSITORES = [
  { id: 'display-balcao-pequeno', name: 'Display de balcão pequeno', group: 'Balcão', icon: 'balcao',
    description: 'Display compacto para o caixa ou balcão de atendimento.' },
  { id: 'display-balcao-medio', name: 'Display de balcão médio', group: 'Balcão', icon: 'balcao',
    description: 'Display de balcão com mais espaço para sabores.' },
  { id: 'display-balcao-grande', name: 'Display de balcão grande', group: 'Balcão', icon: 'balcao',
    description: 'Display de balcão em degraus para a linha completa.' },
  { id: 'expositor-giratorio-balcao', name: 'Expositor giratório de balcão', group: 'Balcão', icon: 'giratorio',
    description: 'Expositor que gira, para balcão ou bancada.' },

  { id: 'expositor-gondola-60cm', name: 'Expositor de gôndola 60 cm', group: 'Gôndola', icon: 'gondola',
    description: 'Módulo para prateleira de gôndola de 60 cm.' },
  { id: 'expositor-gondola-1m', name: 'Expositor de gôndola 1 m', group: 'Gôndola', icon: 'gondola',
    description: 'Módulo para prateleira de gôndola de 1 metro.' },
  { id: 'ponta-de-gondola', name: 'Ponta de gôndola', group: 'Gôndola', icon: 'gondola',
    description: 'Expositor para a ponta (cabeceira) da gôndola.' },
  { id: 'clip-strip', name: 'Fita de gancheira (clip strip)', group: 'Gôndola', icon: 'clip',
    description: 'Fita com ganchos para pendurar pacotes na lateral da gôndola.' },

  { id: 'expositor-centro', name: 'Expositor de centro (ilha)', group: 'Chão / Centro', icon: 'centro',
    description: 'Expositor de chão para o meio do corredor, acesso pelos lados.' },
  { id: 'expositor-chao-60cm', name: 'Expositor de chão 60 cm', group: 'Chão / Centro', icon: 'chao',
    description: 'Expositor de chão com 60 cm de largura.' },
  { id: 'expositor-chao-1m', name: 'Expositor de chão 1 m', group: 'Chão / Centro', icon: 'chao',
    description: 'Expositor de chão com 1 metro de largura.' },

  { id: 'painel-parede-ganchos', name: 'Painel de parede com ganchos', group: 'Parede', icon: 'parede',
    description: 'Painel fixado na parede com ganchos para os pacotes.' },
];

// Simple generic line drawings for each display family.
CDT_ROOT.CDT_EXPOSITOR_ICONS = {
  balcao: '<svg viewBox="0 0 72 92" class="exp-icon" aria-hidden="true"><rect x="8" y="58" width="56" height="20" rx="3" fill="#a64e34"/><rect x="14" y="40" width="44" height="18" rx="2" fill="#f3e1d5" stroke="#a64e34" stroke-width="2"/><rect x="20" y="24" width="32" height="16" rx="2" fill="#f3e1d5" stroke="#a64e34" stroke-width="2"/><g fill="#235c34"><rect x="18" y="44" width="8" height="10" rx="1"/><rect x="32" y="44" width="8" height="10" rx="1"/><rect x="46" y="44" width="8" height="10" rx="1"/><rect x="25" y="28" width="8" height="10" rx="1"/><rect x="39" y="28" width="8" height="10" rx="1"/></g></svg>',
  giratorio: '<svg viewBox="0 0 72 92" class="exp-icon" aria-hidden="true"><rect x="33" y="14" width="6" height="64" fill="#a64e34"/><ellipse cx="36" cy="80" rx="22" ry="5" fill="#a64e34"/><g fill="#f3e1d5" stroke="#a64e34" stroke-width="2"><rect x="14" y="18" width="44" height="14" rx="2"/><rect x="14" y="38" width="44" height="14" rx="2"/><rect x="14" y="58" width="44" height="14" rx="2"/></g><g fill="#235c34"><rect x="20" y="21" width="6" height="8"/><rect x="46" y="41" width="6" height="8"/><rect x="33" y="61" width="6" height="8"/></g></svg>',
  gondola: '<svg viewBox="0 0 72 92" class="exp-icon" aria-hidden="true"><rect x="10" y="8" width="52" height="78" rx="2" fill="#fff" stroke="#a64e34" stroke-width="2"/><g fill="#a64e34"><rect x="10" y="28" width="52" height="3"/><rect x="10" y="50" width="52" height="3"/><rect x="10" y="72" width="52" height="3"/></g><g fill="#235c34"><rect x="15" y="16" width="7" height="12"/><rect x="25" y="16" width="7" height="12"/><rect x="35" y="16" width="7" height="12"/><rect x="45" y="16" width="7" height="12"/><rect x="15" y="38" width="7" height="12"/><rect x="25" y="38" width="7" height="12"/><rect x="35" y="38" width="7" height="12"/><rect x="15" y="60" width="7" height="12"/><rect x="25" y="60" width="7" height="12"/></g></svg>',
  clip: '<svg viewBox="0 0 72 92" class="exp-icon" aria-hidden="true"><rect x="33" y="6" width="6" height="80" rx="2" fill="#a64e34"/><g fill="#f3e1d5" stroke="#235c34" stroke-width="2"><rect x="22" y="14" width="28" height="16" rx="2"/><rect x="22" y="36" width="28" height="16" rx="2"/><rect x="22" y="58" width="28" height="16" rx="2"/></g></svg>',
  centro: '<svg viewBox="0 0 72 92" class="exp-icon" aria-hidden="true"><path d="M10 80 L36 66 L62 80 L36 90 Z" fill="#a64e34"/><path d="M14 30 L36 20 L58 30 L58 78 L36 88 L14 78 Z" fill="#f3e1d5" stroke="#a64e34" stroke-width="2"/><path d="M36 20 L36 88" stroke="#a64e34" stroke-width="2"/><g fill="#235c34"><rect x="19" y="38" width="6" height="9"/><rect x="27" y="35" width="6" height="9"/><rect x="40" y="35" width="6" height="9"/><rect x="48" y="38" width="6" height="9"/><rect x="19" y="56" width="6" height="9"/><rect x="40" y="54" width="6" height="9"/></g></svg>',
  chao: '<svg viewBox="0 0 72 92" class="exp-icon" aria-hidden="true"><rect x="16" y="6" width="40" height="12" rx="2" fill="#a64e34"/><rect x="16" y="18" width="40" height="66" fill="#f3e1d5" stroke="#a64e34" stroke-width="2"/><g fill="#a64e34"><rect x="16" y="38" width="40" height="2"/><rect x="16" y="58" width="40" height="2"/></g><g fill="#235c34"><rect x="21" y="26" width="7" height="11"/><rect x="32" y="26" width="7" height="11"/><rect x="43" y="26" width="7" height="11"/><rect x="21" y="46" width="7" height="11"/><rect x="32" y="46" width="7" height="11"/><rect x="21" y="66" width="7" height="11"/></g><rect x="12" y="84" width="48" height="4" fill="#a64e34"/></svg>',
  parede: '<svg viewBox="0 0 72 92" class="exp-icon" aria-hidden="true"><rect x="8" y="10" width="56" height="72" rx="3" fill="#f3e1d5" stroke="#a64e34" stroke-width="2"/><g fill="#a64e34"><circle cx="22" cy="24" r="2"/><circle cx="36" cy="24" r="2"/><circle cx="50" cy="24" r="2"/><circle cx="22" cy="50" r="2"/><circle cx="36" cy="50" r="2"/><circle cx="50" cy="50" r="2"/></g><g fill="#235c34"><rect x="17" y="28" width="10" height="14" rx="1"/><rect x="31" y="28" width="10" height="14" rx="1"/><rect x="45" y="28" width="10" height="14" rx="1"/><rect x="17" y="54" width="10" height="14" rx="1"/><rect x="31" y="54" width="10" height="14" rx="1"/></g></svg>',
};
