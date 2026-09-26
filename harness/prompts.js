// OS PROMPTS DO HARNESS — os da Mente nova e os do Jev, num lugar só (research R13).
//
// O Jev e a Mente são UM ecossistema que responde pelo personagem, e quem monta a
// própria mesa pode tunar os dois do mesmo jeito: `extensoes/prompts/<nome>.txt`
// substitui o padrão (o mecanismo do `_sys` de `mente.js`, spec 044).
//
// Todo texto usado sai com a sua VERSÃO (sha256 curto do texto EFETIVO), que vai em
// cada caixa do registro (FR-026). Sem ela, o relatório misturaria mesas com prompts
// diferentes, e o diagnóstico de tool ausente ou inconsistente sairia falso.
//
// Os textos padrão são os MEDIDOS nas baterias de `ferramentas/harness-objetivos/v1`:
// mudar um deles sem bateria é mudar o número sem saber.

"use strict";

const crypto = require("crypto");
const { SYSTEM_PADRAO } = require("./decider");

// C3 · objetivos (B2, prompt P1).
const OBJETIVOS = `Você é A Mente de um personagem de RPG num mundo persistente.

Recebe uma INSTRUÇÃO e a cena. Sua tarefa NÃO é narrar nem escolher ferramentas: é listar,
em ordem, os OBJETIVOS que ele cumpre AGORA para atender a instrução.

- Um objetivo por linha, começando com hífen.
- Cada objetivo é UMA coisa que MUDA O MUNDO, dita com um verbo e o objeto.
- NÃO liste gestos que fazem parte de um objetivo (abrir, levantar, levar à boca, engolir,
  olhar, se aproximar, andar até): quem come JÁ leva à boca.
- NÃO repita o que já foi feito.
- TODO objetivo cita, pelo nome exato da cena, a coisa ou a pessoa sobre a qual age.
- Se a instrução pede algo que NÃO está na cena, escreva o objetivo mesmo assim com o nome que a
  instrução usou. NUNCA troque por outra coisa parecida que esteja aqui.
- Liste SÓ o que a instrução pede — em geral 1 a 3 objetivos. Não acrescente nada por conta
  própria: nada de explorar, observar ou andar se a instrução não pediu.
- Se a instrução não pede nada que se faça no mundo (um pensamento, um sentimento), responda
  apenas: - (nada)
- Não escreva mais nada além da lista.`;

// C3P · planejar (B9, PLAN_V1) + o que o caso 2 pediu: o 1º passo possível AGORA.
// O nome dele e o que carrega descem como DADO no user (memória
// `restricao-conhecida-desce-como-dado`), não como proibição aqui.
const PLANEJAR = `Você é A Mente de um personagem de RPG num mundo persistente.

Recebe um DESEJO do personagem e a cena. Sua tarefa NÃO é agir: é PLANEJAR o caminho até o desejo.

Responda exatamente neste formato:
DESEJO: <o desejo, em uma linha>
PASSOS:
- <um passo por linha, na ordem>
FIM: uma destas formas, com o nome REAL — "posse de Faca de Mercador", "estar em Cais Velho", "fome saciada",
     "sede saciada", "sono saciado", "lembrança sobre Nuno" — ou "nenhum"

Regras dos passos:
- 2 a 6 passos. Cada passo é UM objetivo, não um gesto.
- O PRIMEIRO passo é algo que ele consegue fazer AGORA, com o que está na cena ou com o que carrega.
- Um passo PODE ser abstrato quando ainda não se sabe como fazê-lo ("descobrir onde o Nuno está").
- Quando o passo for concreto, cite pelo nome exato da cena a pessoa, a coisa ou o lugar.
- NUNCA invente pessoas, lugares ou objetos que não estão na cena nem nas lembranças dele. Se precisar
  de algo que ele ainda não conhece, o passo é DESCOBRIR (perguntar, procurar, lembrar).
- Não declare o desejo cumprido; quem confere é o mundo.

Regra do FIM: use "nenhum" quando o desejo não se confere por um fato simples (amizade, ajudar, aprender).`;

// C3P no tick sem desejo: "o que eu quero agora?" (o antigo `refletir`, agora com formato).
const QUERER = `Você é A Mente de um personagem de RPG num mundo persistente, num momento sem nada a fazer.

Olhe o que o corpo dele pede, o que ele lembra e quem está à volta, e diga UMA coisa que ele quer que
seja verdade logo e ainda não é — dele, concreta, apontando uma pessoa, um lugar ou uma coisa pelo nome.
Se o corpo pede algo (fome, sede, sono), isso vem primeiro.

Responda com UMA linha só, em 1ª pessoa, começando com "Quero": o desejo, e nada mais.`;

// C6 · a pergunta da tool (B5 "atual").
const C6_TOOL = "Qual capacidade executa este passo do roteiro?";
// C7 · a pergunta do parâmetro (B6). `{papel}`, `{tool}` e `{desc}` são preenchidos.
const C7_PARAM = "Neste passo, quem ou o que ocupa o papel '{papel}' da capacidade '{tool}'? {desc}";
// C8 · losango "o que o passo espera" (hipótese, FR-009a — roda em SOMBRA).
const C8_PASSO = "O personagem tentava cumprir este passo. Pelo que mudou, o passo:";
// C8D · losango "o fim chegou?" (hipótese, FR-010a — roda em SOMBRA).
const C8D_FIM = "O personagem quer isto. Pelo que ele acabou de saber ou viver, o desejo:";

const PADRAO = {
  decisor_system: SYSTEM_PADRAO,
  objetivos: OBJETIVOS,
  planejar: PLANEJAR,
  querer: QUERER,
  c6_tool: C6_TOOL,
  c7_param: C7_PARAM,
  c8_passo: C8_PASSO,
  c8d_fim: C8D_FIM,
};

// Os títulos e o "quando" de cada prompt, para a página de configuração (como `ROTINAS`).
const ROTINAS_HARNESS = [
  { nome: "objetivos", titulo: "Dizer o que quer (C3)", quando: "a cada sussurro, e no passo abstrato de um desejo" },
  { nome: "querer", titulo: "Criar um desejo (C3P)", quando: "no tick, quando ele não tem desejo nenhum" },
  { nome: "planejar", titulo: "Traçar e retraçar o caminho (C3P/C3R)", quando: "quando o desejo nasce, e quando um passo se esgota" },
  { nome: "decisor_system", titulo: "Decisor: como escolher (Jev)", quando: "em toda escolha local" },
  { nome: "c6_tool", titulo: "Decisor: qual capacidade (C6)", quando: "a cada objetivo" },
  { nome: "c7_param", titulo: "Decisor: com quem, com o quê (C7)", quando: "a cada parâmetro com mais de uma opção" },
  { nome: "c8_passo", titulo: "Decisor: o passo andou? (C8, em sombra)", quando: "depois de cada ação de um desejo" },
  { nome: "c8d_fim", titulo: "Decisor: o desejo se cumpriu? (C8D, em sombra)", quando: "quando o fim não se confere por regra" },
];

function versao(texto) {
  return crypto.createHash("sha256").update(String(texto)).digest("hex").slice(0, 8);
}

// O texto efetivo de um prompt: o da extensão da mesa, se houver, senão o padrão.
function prompt(nome, extensoes) {
  const p = extensoes && extensoes.prompts && extensoes.prompts[nome];
  return typeof p === "string" && p.trim() ? p : PADRAO[nome];
}

function comVersao(nome, extensoes) {
  const texto = prompt(nome, extensoes);
  return { texto, versao: versao(texto) };
}

module.exports = { PADRAO, ROTINAS_HARNESS, versao, prompt, comVersao };
