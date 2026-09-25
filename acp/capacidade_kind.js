// O mapeamento Loreforge-específico entre uma capacidade (o `name` técnico de uma
// tool, ex. "attack") e o vocabulário do protocolo — `data-model.md`, "Capacidade →
// ToolKind". `ToolKind` real (schema v2): read | edit | delete | move | search |
// execute | think | fetch | switch_mode | other.
//
// `kind` é SÓ dica de ícone — errar para "other" é inofensivo (o client cai num
// ícone genérico); forçar uma categoria errada sugere uma UI que não faz sentido
// (ex. "attack" como "execute" sugeriria uma metáfora de terminal de comando para um
// golpe de espada). Por isso o default é sempre seguro, e a tabela não precisa ser
// exaustiva — uma capacidade nova nasce em "other" até alguém decidir que merece
// categoria melhor.

"use strict";

const _KIND_POR_CAPACIDADE = {
  // move — deslocamento de verdade
  travel_to: "move",
  enter_route: "move",

  // search — consulta, buscar informação (não é "read" de arquivo)
  investigate: "search",
  ask_about: "search",
  ask_wares: "search",
  ask_directions: "search",
  consultar_memoria: "search",
  observe: "search",
  observe_entity: "search",

  // edit — o caso raro que bate de verdade: editar o conteúdo de uma entidade
  write: "edit",

  // o resto (ação física/social sobre item ou personagem) não tem categoria melhor
  // que "other" no vocabulário de um editor de código — listados aqui só para
  // documentar a decisão, não porque o valor mudaria o default:
  attack: "other",
  persuade: "other",
  persuade_give: "other",
  steal: "other",
  carry: "other",
  take: "other",
  give: "other",
  stow: "other",
  drop: "other",
  equip: "other",
  unequip: "other",
  buy: "other",
  trade: "other",
  shove: "other",
  open: "other",
  close: "other",
  forage: "other",
  butcher: "other",
  brew: "other",
  cook: "other",
  kindle_fire: "other",
  sing: "other",
  accuse: "other",
  set_intention: "other",
  sleep: "other",
  wake_up: "other",
  narrate: "other",
};

// `kindDe(nome)` — nunca lança por capacidade desconhecida (uma capacidade nova no
// mundo não pode quebrar a tela de quem a observa).
function kindDe(nomeCapacidade) {
  return _KIND_POR_CAPACIDADE[nomeCapacidade] || "other";
}

// `tituloDe(nomeCapacidade, descricaoDoTool)` — o texto PRIMÁRIO que a tela mostra
// (FR-016). `descricaoDoTool` é a `description` que `mundo.js` já cacheia de
// `tools/list` (mundo.js:218-233) — a mesma fonte que `loreforge-portal` cura,
// player-facing desde a spec 043/item 036. Nunca devolve o `nomeCapacidade` cru:
// sem descrição disponível, cai num rótulo genérico em vez de vazar o nome técnico.
function tituloDe(nomeCapacidade, descricaoDoTool) {
  const desc = (descricaoDoTool || "").trim();
  if (desc) return desc;
  return "Uma tentativa está em curso";
}

module.exports = { kindDe, tituloDe };
