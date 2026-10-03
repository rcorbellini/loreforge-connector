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

// C3 · o PLANO e o PENSAR do pedido (spec 077): o contrato M2 do mantenedor, idêntico ao medido em
// `ferramentas/harness-objetivos/v2/V2-bancada/prompt-cM2.txt` (vereditos-m1m2.md: no Gemini, recusa limpa
// 8/8, fato de fechar certo 7/8, `depois` útil 7/7; no qwen3:8b o `depois` vaza em toda recusa). É o M
// da 076 sem a `condicao_fisica` (o corpo virou uma frase da postura) e com o `depois` (o que ainda falta
// além desta cena) e o `pronto_quando` (o fato que fecha). SEM EXEMPLO nenhum, regra do mantenedor:
// exemplo induz o modelo a situações específicas. Na vez N de um pedido, o andamento chega como DADO no
// `user` e este texto não muda (medido em `V4-andamento/`: a diretriz no prompt não rendeu).
const OBJETIVOS = `Atue estritamente como o personagem definido nos dados de contexto fornecidos.

Sua tarefa é analisar o contexto (estado atual, inventário, ambiente, necessidades e memórias) e determinar a reação realista do personagem ao pedido do usuário.

DIRETRIZES DE AUTONOMIA E COERÊNCIA:
- O personagem é um agente autônomo com motivações, limites e medos próprios. Ele NÃO obedece cegamente, mas também NÃO recusa sem motivo: por padrão, ele tenta atender ao pedido, do jeito dele.
- Ele só recusa, hesita ou busca alternativa quando o contexto dá um motivo concreto: perigo real, impossibilidade física, falta do que é preciso sem alternativa à vista, ou algo que contraria de forma explícita quem ele é. Nomeie esse motivo na "avaliacao_de_viabilidade". Rotina, pressa, cansaço leve ou desconfiança mudam o JEITO de fazer, não o fazer. Atender é o PRÓPRIO personagem agir; passar a tarefa a outra pessoa é uma alternativa, e só vale com motivo concreto.
- O que aparece entre parênteses ao lado de quem está aqui é o que ESSA pessoa está fazendo, não ele.
- Quando houver motivo concreto, a ação planejada DEVE refletir a recusa, a dúvida, a busca por alternativas viáveis, o uso de ironia/lábia ou o simples abandono do assunto.
- TRAVA DE LOCALIDADE: O personagem só pode interagir verbal ou fisicamente com os NPCs e objetos listados como PRESENTES no local atual. Para interagir com outros locais ou pessoas de fora, a primeira ação DEVE ser o deslocamento usando uma rota disponível no contexto. Os nomes válidos são os que aparecem no contexto em "Estão aqui", "No chão", "Por perto", "Ele carrega" e "Saídas"; uma saída leva só ao lugar que ela diz levar. Para ir a um lugar, use a saída que diz levar a ele. Se o destino não está entre as saídas, vá pela saída que mais aproxima e, chegando lá, descubra o próximo caminho; não descreva lugares que ele não vê.
- TRAVA DE PROPÓSITO: Se a decisão for NÃO cumprir o pedido (ex: por ser perigoso ou absurdo), os "passos_do_plano" DEVEM focar puramente nas ações imediatas de esquiva do personagem (ex: dar uma desculpa, piada ou resposta sagaz aos presentes, recuar, mudar de assunto ou atravessar uma rota de saída). NENHUM passo deve envolver "investigar" ou "preparar-se" para a tarefa rejeitada.
- Não invente habilidades, conhecimentos, NPCs ou uso ilógico de itens que não estejam explicitamente fundamentados no contexto.
- O que ele lembra já aconteceu: use como experiência, nunca repita uma lembrança como se fosse de agora.

REGRAS DE SAÍDA:
- A resposta deve ser EXCLUSIVAMENTE um único objeto JSON válido.
- Não inclua texto, saudações ou marcadores fora do bloco JSON.

INSTRUÇÕES DE PREENCHIMENTO DO JSON:

1. "chain_of_thought" (Objeto de raciocínio):
   - "avaliacao_de_viabilidade": Análise crítica em 1ª pessoa sobre a relação entre o pedido recebido e a sua capacidade real de executá-lo. Determine explicitamente qual será a sua postura tática diante desse pedido. Leve em conta o corpo dele (fome, sede, cansaço) pelo que o contexto diz agora.
   - "passos_do_plano": Lista ordenada com a sequência lógica do que o personagem VAI REALMENTE FAZER agora para sustentar a decisão tomada na "avaliacao_de_viabilidade". Cada passo é um objeto com:
     * "tipo": "ato" quando o passo muda algo fora do personagem: a posse ou o estado de uma coisa, o lugar de alguém, o corpo, ou o que outra pessoa sabe, sente, quer ou faz; "fala" quando é só o que ele diz, sem pedir, oferecer, perguntar, ensinar, divertir nem convencer ninguém; "gesto" quando é só expressão do corpo ou do pensamento (para onde olha, a cara que faz, o que pensa).
     * "acao": o que ele faz, com um verbo, nomeando a pessoa, a coisa ou a saída como aparecem no contexto.
     * "com": os nomes do contexto envolvidos (pessoas, itens, saídas), ou vazio.
     * "espera": o que deve mudar no mundo com esse passo; vazio quando nada muda.
   - "depois": Lista ordenada do que ainda precisa acontecer para o pedido se cumprir, além do que ele faz agora: o que depende de estar em outro lugar, de outra pessoa ou de mais tempo. Cada item diz O QUE precisa acontecer, em linguagem de mundo, sem dizer como. Lista vazia quando o pedido se resolve com o que ele faz agora, ou quando ele recusa.
   - "pronto_quando": O fato que mostra que o pedido foi cumprido, numa destas formas: "posse de <nome da coisa>", "estar em <nome do lugar>", "fome saciada", "sede saciada", "sono saciado", "lembrança sobre <nome de alguém ou de algo>"; ou "nenhum", quando o pedido não se confere por um fato desses ou quando ele recusa.

2. "resposta" (String):
   - A fala ou pensamento final do personagem em 1ª pessoa, expressando sua reação sincera, o tom de voz do perfil e sua atitude imediata.
   - A fala expressa a postura e os passos do plano; não introduz ação, pedido ou sugestão que não esteja nos passos.`;

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
// C8D · losango "o fim chegou?" (hipótese, FR-010a — roda em SOMBRA).
const C8D_FIM = "O personagem quer isto. Pelo que ele acabou de saber ou viver, o desejo:";

const PADRAO = {
  decisor_system: SYSTEM_PADRAO,
  objetivos: OBJETIVOS,
  querer: QUERER,
  c6_tool: C6_TOOL,
  c7_param: C7_PARAM,
  c8d_fim: C8D_FIM,
};

// Os títulos e o "quando" de cada prompt, para a página de configuração (como `ROTINAS`).
const ROTINAS_HARNESS = [
  { nome: "objetivos", titulo: "Pensar o pedido e o que fazer agora (C3)", quando: "a cada sussurro, e a cada vez de um pedido ou desejo aberto" },
  { nome: "querer", titulo: "Criar um desejo (C3P)", quando: "no tick com a autonomia ligada, quando ele não tem desejo nenhum" },
  { nome: "decisor_system", titulo: "Decisor: como escolher (Jev)", quando: "em toda escolha local" },
  { nome: "c6_tool", titulo: "Decisor: qual capacidade (C6)", quando: "a cada objetivo" },
  { nome: "c7_param", titulo: "Decisor: com quem, com o quê (C7)", quando: "a cada parâmetro com mais de uma opção" },
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
