// As regras da sala, sem rede nenhuma — por isso dá pra testar no Node.
// Usam: o palco, que manda na sala, e o celular.

// O servidor que apresenta um aparelho ao outro é público e compartilhado com
// outros apps; o prefixo separa as nossas salas das deles.
export const PREFIXO = "gogo-";

// Uma cor por cantor, na ordem em que entram. As duas primeiras são as do dueto.
export const CORES = ["#1D9E75", "#E0703F", "#8F88E8", "#E0709A", "#4A90E2", "#BA7517"];

// Código que dá pra ditar em voz alta numa festa: consoante, vogal, consoante,
// vogal, consoante (LUMEN, BOLAD). Sem C, Q e X, que formam as palavras feias
// mais comuns; a lista pega as que sobram. Vai aparecer grande na TV.
const CONSOANTES = "BDFGJLMNPRSTVZ";
const VOGAIS = "AEIOU";
const PROIBIDOS = ["PUT", "BOS", "FOD", "VIAD", "PAU", "ROL", "TET", "PEID", "MERD", "BUN", "PIRU", "PINT", "GOZ", "BOB"];

export function codigoNovo(aleatorio = Math.random) {
  for (;;) {
    let codigo = "";
    for (let i = 0; i < 5; i++) {
      const letras = i % 2 === 0 ? CONSOANTES : VOGAIS;
      codigo += letras[Math.floor(aleatorio() * letras.length)];
    }
    if (!PROIBIDOS.some((p) => codigo.includes(p))) return codigo;
  }
}

// O que a pessoa digitou ou o que veio no link, do jeito que a sala usa.
export function limparCodigo(texto) {
  return String(texto ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
}

// "localhost" quer dizer "este aparelho". Um QR code com esse endereço manda o
// celular procurar o site dentro dele mesmo — e ele não acha nada.
export function enderecoSoDesteAparelho(hostname) {
  const h = String(hostname ?? "").toLowerCase();
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(h) || h.endsWith(".localhost");
}

// O código do vídeo (11 letras) em qualquer jeito de link do YouTube que a
// pessoa colar: youtu.be/…, watch?v=…, shorts/…, embed/…, music.youtube.com.
export function idDoYoutube(texto) {
  const s = String(texto ?? "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/(?:shorts|embed|live|v)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  return m && /youtu\.?be/.test(s) ? m[1] : null;
}

export function idDoPalco(codigo) {
  return PREFIXO + codigo;
}

export function corDoCantor(numero) {
  return CORES[(numero - 1) % CORES.length];
}

export function nomeLimpo(nome, numero) {
  const limpo = String(nome ?? "").trim().slice(0, 20);
  return limpo || `Cantor ${numero}`;
}

function numeroEntre(valor, minimo, maximo) {
  // null e "" virariam 0 no Number(); aqui "não veio" continua sendo "não veio".
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= minimo && n <= maximo ? n : null;
}

// O que chega do celular vem de quem estiver do outro lado da conexão:
// o palco confere antes de desenhar.
export function notaRecebida(msg) {
  return {
    hz: numeroEntre(msg?.hz, 20, 5000),
    voz: msg?.voz === true,
    atraso: numeroEntre(msg?.atraso, 0, 10000),
  };
}
