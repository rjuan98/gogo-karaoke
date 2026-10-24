// A fila de quem canta. Sem rede: dá pra testar no Node. Quem manda na fila é
// o palco; os celulares só pedem.
import { DIFICULDADES } from "./pontuacao.js";
import { idDoYoutube } from "./protocolo.js";

// Pedidos esperando, por pessoa: ninguém lota a fila sozinho.
export const MAXIMO_POR_PESSOA = 3;

let contador = 0;

// Confere um pedido que chegou de um celular. O que chega vem de quem estiver
// do outro lado, então nada é aceito sem conferir. Devolve { pedido } ou { erro }.
export function novoPedido(msg, deId, { musicas, conectados, fila, gerarId = () => `p${++contador}` }) {
  const meus = fila.filter((p) => p.pedidoPor === deId).length;
  if (meus >= MAXIMO_POR_PESSOA) {
    return { erro: `Você já tem ${MAXIMO_POR_PESSOA} músicas na fila. Espere uma delas tocar.` };
  }
  // Vídeo de karaokê do YouTube: toca na hora, sem preparar nada (e sem pontos).
  if (msg?.youtube !== undefined) {
    const video = idDoYoutube(msg.youtube);
    if (!video) return { erro: "Esse link não parece ser de um vídeo do YouTube." };
    return { pedido: { id: gerarId(), youtube: video, titulo: "Vídeo do YouTube", quem: [deId], pedidoPor: deId } };
  }
  const musica = musicas.find((m) => m.id === msg?.musicaId);
  if (!musica) return { erro: "Essa música não está na biblioteca do palco." };
  const com = msg.com === null || msg.com === undefined ? null : String(msg.com);
  if (com !== null && (com === deId || !conectados.has(com))) return { erro: "Essa pessoa não está mais na sala." };
  return {
    pedido: {
      id: gerarId(),
      musicaId: musica.id,
      quem: com ? [deId, com] : [deId],
      dificuldade: DIFICULDADES[msg.dificuldade] ? msg.dificuldade : "medio",
      voz: musica.temVoz ? volumeDaVoz(msg.voz) : 0,
      pedidoPor: deId,
    },
  };
}

// O volume da voz da artista cantando junto: de 0 (desligada) a 1 (alta).
// Vem do celular, então qualquer coisa estranha vira 0.
export function volumeDaVoz(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

// Ordem justa: vai primeiro o pedido de quem cantou menos vezes hoje; no
// empate, vale a ordem de chegada. Assim quem pede música toda hora não
// monopoliza o microfone.
export function filaOrdenada(fila, vezes) {
  const vezesDe = (p) => vezes.get(p.pedidoPor) ?? 0;
  return fila
    .map((p, chegada) => ({ p, chegada }))
    .sort((a, b) => vezesDe(a.p) - vezesDe(b.p) || a.chegada - b.chegada)
    .map(({ p }) => p);
}

// Quem saiu da sala não canta: os pedidos com essa pessoa saem da fila.
export function semQuemSaiu(fila, id) {
  return fila.filter((p) => !p.quem.includes(id));
}
