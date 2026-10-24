// A tela de cantar, no jeito do Guitar Hero: as notas da música vêm da direita
// na altura certa (bolinha = nota curta, barra = nota longa) e passam pela
// linha do "agora". A voz de quem canta aparece nessa linha e segue junto pra
// esquerda. A letra fica embaixo e o visualizador, ao fundo.
import { batidaNoTempo, duracaoDaBatida, linhaNaTela, linhaSeguinte, midiDoTom, segundosDaBatida, pedacosDaLinha } from "./musica.js";
import { DIFICULDADES } from "./pontuacao.js";
import { nomeDaNota } from "./nota.js";

const BRANCO = "#F2F2F0";
const APAGADO = "#9A9AA3";
const AMARELO = "#F2C14E";
const CINZA = "#5A5A66";
const AZUL_EMBALO = "#4A90E2";
const FONTE = "Outfit, system-ui, sans-serif";
const FRENTE_SEG = 4;        // quanto da música que vem aparece na tela
const ATRAS_SEG = 1.5;       // e quanto do que já passou
const POSICAO_AGORA = 0.24;  // onde fica a linha do agora, da esquerda pra direita
const PULO_MS = 800;         // quanto dura o nome da nota pulando, quando acerta
const BARRAS = 48;
const ACESA_MS = 300;
const FAISCA_MS = 700;       // quanto dura cada faísca do embalo
const AVISO_EMBALO_MS = 1400;        // quanto tempo a barra do visualizador fica acesa depois de um acerto

// O fundo: três manchas de luz em cores vizinhas no círculo das cores (por
// isso combinam), girando devagar — uma volta inteira por minuto —, cada uma
// passeando um pouco em volta do seu lugar, e
// acendendo um pouco mais quando a música bate forte. Bem apagado, pra a
// letra continuar fácil de ler.
let energiaSuave = 0;
let embaloSuave = 0;

export function fundo(ctx, L, A, { frequencias, agora, parado, embalo = false, pulso = 0 }) {
  embaloSuave = embaloSuave * 0.95 + (embalo ? 0.05 : 0);
  let soma = 0;
  for (let i = 1; i < 12; i++) soma += frequencias[i];
  energiaSuave = energiaSuave * 0.9 + (soma / 11 / 255) * 0.1;
  const energia = parado ? 0.3 : energiaSuave;
  const t = parado ? 0 : agora / 1000;
  const matiz = parado ? 260 : t * 6;
  ctx.fillStyle = "#0F0F14";
  ctx.fillRect(0, 0, L, A);
  const raio = Math.max(L, A) * 0.75;
  for (const [x, y, desvio, forca, fase] of [[0.15, 0.25, 0, 1, 0], [0.85, 0.75, 45, 0.9, 2.1], [0.6, 0.05, -40, 0.6, 4.2]]) {
    const brilho = (0.2 + 0.25 * energia) * forca * (1 + 0.7 * embaloSuave + 0.1 * pulso);
    const cx = L * (x + 0.14 * Math.sin(t * 0.15 + fase)), cy = A * (y + 0.14 * Math.cos(t * 0.12 + fase));
    const luz = ctx.createRadialGradient(cx, cy, 0, cx, cy, raio);
    luz.addColorStop(0, `hsla(${(matiz + desvio) % 360}, 75%, 48%, ${brilho})`);
    luz.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    ctx.fillStyle = luz;
    ctx.fillRect(0, 0, L, A);
  }
}

// As bordas da tela acesas na cor de quem está no embalo, pulsando. Com duas
// pessoas no embalo, cada cor fica mais fraca, e as duas se misturam.
function bordasAcesas(ctx, L, A, dpr, cor, forca, quantos) {
  const largura = 70 * dpr;
  ctx.globalAlpha = Math.max(0, forca) / quantos;
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
    [0, 0, 0, largura, 0, 0, L, largura], [0, A, 0, A - largura, 0, A - largura, L, largura],
    [0, 0, largura, 0, 0, 0, largura, A], [L, 0, L - largura, 0, L - largura, 0, largura, A],
  ]) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, cor);
    g.addColorStop(1, `${cor.slice(0, 7)}00`);
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.globalAlpha = 1;
}

function tempoLegivel(seg) {
  const s = Math.max(0, Math.floor(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function pilula(ctx, x, y, largura, altura) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(largura, altura), altura, altura / 2);
}

function proximaLinhaEm(musica, parte, batida) {
  const ln = parte.linhas.find((l) => l.inicio > batida);
  return ln ? segundosDaBatida(musica, ln.inicio) : Infinity;
}

function visualizador(ctx, L, A, dpr, { frequencias, ps, agora, grande, parado }) {
  const margem = 32 * dpr;
  const largura = (L - 2 * margem) / BARRAS;
  const alturaMax = grande ? A * 0.42 : 80 * dpr;
  for (let i = 0; i < BARRAS; i++) {
    // Espelhado, como no Windows Media Player: o grave no meio, o agudo nas
    // pontas. Uma música tem quase tudo nos primeiros pedaços do espectro.
    const doMeio = Math.abs(i - (BARRAS - 1) / 2) / (BARRAS / 2);
    const pedaco = Math.min(frequencias.length - 1, Math.floor(1 + doMeio ** 1.3 * 18));
    const nivel = parado ? 0.3 : frequencias[pedaco] / 255;
    const altura = Math.max(4 * dpr, nivel * alturaMax);
    // A música dá a altura; a voz dá a cor: cada cantor tem um pedaço das
    // barras, que acende na cor dele quando ele acerta.
    const p = ps[Math.min(ps.length - 1, Math.floor((i * ps.length) / BARRAS))];
    const acesa = agora - p.ultimoAcerto < ACESA_MS;
    ctx.fillStyle = grande || acesa ? p.cantor.cor : CINZA;
    ctx.globalAlpha = grande ? 0.85 : acesa ? 0.35 : 0.14;
    const y = grande ? A * 0.5 - altura / 2 : A - altura;
    ctx.beginPath();
    ctx.roundRect(margem + i * largura, y, largura - 4 * dpr, altura, 3 * dpr);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function cabecalho(ctx, L, dpr, { musica, rodada, seg }) {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `600 ${22 * dpr}px ${FONTE}`;
  ctx.fillStyle = BRANCO;
  const titulo = `${musica.titulo} · ${musica.artista}`;
  ctx.fillText(titulo, 32 * dpr, 42 * dpr);
  const xPilula = 32 * dpr + ctx.measureText(titulo).width + 14 * dpr;
  ctx.font = `600 ${14 * dpr}px ${FONTE}`;
  const nome = DIFICULDADES[rodada.dificuldade].nome;
  const w = ctx.measureText(nome).width + 24 * dpr;
  ctx.fillStyle = "#26262F";
  ctx.beginPath();
  ctx.roundRect(xPilula, 22 * dpr, w, 28 * dpr, 14 * dpr);
  ctx.fill();
  ctx.fillStyle = "#C9C9CF";
  ctx.fillText(nome, xPilula + 12 * dpr, 41 * dpr);
  // O tempo fica do lado do título: o canto direito é do volume e do "Parar".
  ctx.fillStyle = APAGADO;
  ctx.font = `${18 * dpr}px ${FONTE}`;
  ctx.fillText(`${tempoLegivel(seg)} / ${tempoLegivel(rodada.fimSeg)}`, xPilula + w + 16 * dpr, 42 * dpr);
  const largura = L - 64 * dpr;
  ctx.fillStyle = "#26262F";
  ctx.fillRect(32 * dpr, 58 * dpr, largura, 4 * dpr);
  ctx.fillStyle = APAGADO;
  ctx.fillRect(32 * dpr, 58 * dpr, largura * Math.min(1, Math.max(0, seg / rodada.fimSeg)), 4 * dpr);
}

function faixa(ctx, L, dpr, { musica, p, y0, alt, batida, frente, atras, agora, seg, parado }) {
  const embalo = p.placar.embalo;
  const corDeDestaque = embalo ? AZUL_EMBALO : p.cantor.cor;
  const esq = 32 * dpr, dir = L - 32 * dpr;
  const xAgora = esq + (dir - esq) * POSICAO_AGORA;
  const porBatida = (dir - xAgora) / frente;
  const x = (b) => xAgora + (b - batida) * porBatida;
  const { min, max } = p.faixaDeTons;
  const yTopo = y0 + 50 * dpr, yBase = y0 + alt - 20 * dpr;
  const y = (m) => yBase - ((m - min) / (max - min)) * (yBase - yTopo);
  const grossura = Math.min(18 * dpr, ((yBase - yTopo) / (max - min)) * 0.9);

  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(esq, y0 + alt - dpr, dir - esq, dpr);

  // Nome e pontos ao vivo.
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${20 * dpr}px ${FONTE}`;
  ctx.fillStyle = p.cantor.cor;
  ctx.fillText(p.cantor.nome, esq, y0 + 30 * dpr);
  const wNome = ctx.measureText(p.cantor.nome).width;
  ctx.font = `800 ${24 * dpr}px ${FONTE}`;
  ctx.fillStyle = BRANCO;
  const pontos = p.placar.resumo().pontos.toLocaleString("pt-BR");
  ctx.fillText(pontos, esq + wNome + 12 * dpr, y0 + 30 * dpr);
  // A sequência: aparece a partir de 3 seguidas; com 8, vira "No embalo".
  const xSelo = esq + wNome + 12 * dpr + ctx.measureText(pontos).width + 14 * dpr;
  if (embalo) {
    ctx.font = `800 ${14 * dpr}px ${FONTE}`;
    const texto = "NO EMBALO · +50%";
    const w = ctx.measureText(texto).width + 24 * dpr;
    ctx.fillStyle = p.cantor.cor;
    ctx.beginPath();
    ctx.roundRect(xSelo, y0 + 11 * dpr, w, 26 * dpr, 13 * dpr);
    ctx.fill();
    ctx.fillStyle = "#0F0F14";
    ctx.fillText(texto, xSelo + 12 * dpr, y0 + 29 * dpr);
  } else if (p.placar.sequencia >= 3) {
    ctx.font = `600 ${16 * dpr}px ${FONTE}`;
    ctx.fillStyle = APAGADO;
    ctx.fillText(`${p.placar.sequencia} seguidas`, xSelo, y0 + 30 * dpr);
  }

  // A linha do agora.
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(xAgora - dpr, yTopo - 10 * dpr, 2 * dpr, yBase - yTopo + 20 * dpr);

  ctx.save();
  ctx.beginPath();
  ctx.rect(esq, y0, dir - esq, alt);
  ctx.clip();

  // As notas da música, vindo.
  let temNota = false;
  for (const ln of p.parte.linhas) {
    if (ln.fim < batida - atras || ln.inicio > batida + frente) continue;
    for (const n of ln.notas) {
      const xi = x(n.inicio), xf = x(n.inicio + n.duracao);
      if (xf < esq || xi > dir) continue;
      temNota = true;
      const m = midiDoTom(n.tom);
      // O que já passou mostra o quanto acertou; o que vem fica meio apagado.
      // No embalo, as notas que vêm ganham um halo da cor de quem canta.
      if (embalo && n.inicio >= batida) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = corDeDestaque;
        pilula(ctx, xi - 4 * dpr, y(m) - grossura / 2 - 4 * dpr, xf - xi + 5 * dpr, grossura + 8 * dpr);
        ctx.fill();
      }
      ctx.globalAlpha = n.inicio < batida ? 0.25 + 0.75 * p.placar.fracaoCerta(n) : embalo ? 0.9 : 0.5;
      ctx.fillStyle = corDeDestaque;
      pilula(ctx, xi, y(m) - grossura / 2, xf - xi - 3 * dpr, grossura);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (n.tipo === "ouro" || n.tipo === "falada-ouro") {
        ctx.strokeStyle = AMARELO;
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      }
      if (n.tipo === "livre") continue;
      // No fácil, o nome da nota não serve pra nada: qualquer nota vale.
      if (xi >= xAgora && p.placar.dificuldade !== "facil") {
        ctx.font = `${12 * dpr}px ${FONTE}`;
        ctx.fillStyle = APAGADO;
        ctx.fillText(nomeDaNota(m), xi, y(m) - grossura / 2 - 5 * dpr);
      }
    }
  }

  // A linha da voz: aparece no agora e vai pra esquerda junto com as notas.
  ctx.strokeStyle = corDeDestaque;
  ctx.fillStyle = corDeDestaque;
  ctx.lineWidth = 4 * dpr;
  ctx.lineCap = "round";
  let anterior = null;
  for (const pt of p.rastro) {
    if (pt.batida < batida - atras - 2 || pt.exibido === null) { anterior = null; continue; }
    if (anterior && pt.batida - anterior.batida < 4 && Math.abs(pt.exibido - anterior.exibido) < 2) {
      ctx.beginPath();
      ctx.moveTo(x(anterior.batida), y(anterior.exibido));
      ctx.lineTo(x(pt.batida), y(pt.exibido));
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x(pt.batida), y(pt.exibido), 2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    anterior = pt;
  }
  ctx.restore();

  // Onde a voz está agora, na linha do agora.
  if (agora - p.ultimaLeitura < 300 && p.ultimoExibido !== null) {
    ctx.beginPath();
    ctx.arc(xAgora, y(p.ultimoExibido), 8 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = corDeDestaque;
    ctx.fill();
    ctx.strokeStyle = BRANCO;
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
  }

  // No embalo, cada acerto solta faíscas da bolinha da voz, que voam pra trás
  // junto com o que já passou.
  if (embalo && !parado && agora - p.ultimoAcerto < 80 && p.ultimoExibido !== null) {
    for (let i = 0; i < 2; i++) {
      p.faiscas.push({ t: agora, x: xAgora, y: y(p.ultimoExibido),
        vx: -(80 + Math.random() * 220) * dpr, vy: (Math.random() - 0.65) * 260 * dpr, r: (2 + Math.random() * 3) * dpr });
    }
  }
  p.faiscas = p.faiscas.filter((f) => agora - f.t < FAISCA_MS);
  for (const f of p.faiscas) {
    const idade = (agora - f.t) / FAISCA_MS;
    const s = (agora - f.t) / 1000;
    ctx.globalAlpha = 1 - idade;
    ctx.fillStyle = Math.random() < 0.3 ? BRANCO : p.cantor.cor;
    ctx.beginPath();
    ctx.arc(f.x + f.vx * s, f.y + f.vy * s + 120 * dpr * s * s, f.r * (1 - idade * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Acabou de entrar no embalo: avisa grande, no meio da faixa.
  const desde = agora - p.embaloDesde;
  if (embalo && desde < AVISO_EMBALO_MS) {
    const idade = desde / AVISO_EMBALO_MS;
    ctx.globalAlpha = Math.min(1, (1 - idade) * 2);
    ctx.textAlign = "center";
    ctx.font = `800 ${(40 + 16 * Math.max(0, 1 - idade * 5)) * dpr}px Unbounded, ${FONTE}`;
    ctx.fillStyle = p.cantor.cor;
    ctx.fillText("No embalo!", (xAgora + dir) / 2, (yTopo + yBase) / 2 - idade * 20 * dpr);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  // Acertou uma nota: o nome da nota que a pessoa cantou pula e some.
  p.pulos = p.pulos.filter((pulo) => agora - pulo.t < PULO_MS);
  for (const pulo of p.pulos) {
    const idade = (agora - pulo.t) / PULO_MS;
    ctx.globalAlpha = 1 - idade;
    ctx.font = `800 ${(20 + 8 * Math.max(0, 1 - idade * 4)) * dpr}px ${FONTE}`;
    ctx.fillStyle = p.cantor.cor;
    ctx.fillText(pulo.texto, xAgora + 14 * dpr, y(pulo.exibido) - 14 * dpr - idade * 44 * dpr);
  }
  ctx.globalAlpha = 1;

  // Faixa vazia: diz quando é a vez dessa pessoa.
  if (!temNota) {
    const falta = proximaLinhaEm(musica, p.parte, batida) - seg;
    if (Number.isFinite(falta)) {
      ctx.font = `${18 * dpr}px ${FONTE}`;
      ctx.fillStyle = APAGADO;
      ctx.fillText(`Entra em ${Math.ceil(falta)} s`, xAgora + 20 * dpr, (yTopo + yBase) / 2);
    }
  }
}

// Como nos karaokês conhecidos, a cor "varre" cada sílaba da esquerda pra
// direita no tempo da nota: devagar na nota sustentada, rápido no trecho
// ligeiro. Assim a letra mostra também QUANTO tempo segurar.
function linhaColorida(ctx, L, dpr, ln, cor, batida, y, tamanho, acertos = [], agora = 0) {
  ctx.font = `600 ${tamanho * dpr}px ${FONTE}`;
  const pedacos = pedacosDaLinha(ln);
  const larguras = pedacos.map((p) => ctx.measureText(p.texto).width);
  let x = (L - larguras.reduce((a, b) => a + b, 0)) / 2;
  pedacos.forEach((p, i) => {
    const andou = Math.min(1, Math.max(0, (batida - p.inicio) / Math.max(1, p.fim - p.inicio)));
    ctx.fillStyle = BRANCO;
    ctx.fillText(p.texto, x, y);
    const acerto = acertos.find((a) => a.inicio === p.inicio && agora - a.t < PULO_MS);
    if (acerto) {
      const idade = (agora - acerto.t) / PULO_MS;
      ctx.save();
      ctx.globalAlpha = 1 - idade;
      ctx.shadowColor = cor;
      ctx.shadowBlur = (1 - idade) * 22 * dpr;
      ctx.fillStyle = BRANCO;
      ctx.font = `800 ${tamanho * dpr}px ${FONTE}`;
      ctx.fillText(p.texto, x, y - (1 - idade) * 5 * dpr);
      ctx.restore();
    }
    if (andou > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y - tamanho * dpr * 1.2, larguras[i] * andou, tamanho * dpr * 1.6);
      ctx.clip();
      ctx.fillStyle = cor;
      ctx.fillText(p.texto, x, y);
      ctx.restore();
    }
    x += larguras[i];
  });
}

// Uma linha de letra por parte. Quando as duas partes cantam a mesma linha,
// ela aparece uma vez só, em amarelo: é dos dois.
function letra(ctx, L, A, dpr, { ps, linhas, batida }) {
  const blocos = [];
  ps.forEach((p, i) => {
    p.letrasPulando = p.letrasPulando.filter((acerto) => performance.now() - acerto.t < PULO_MS);
    const ln = linhas[i];
    if (!ln) return;
    const igual = blocos.find((b) => b.ln.inicio === ln.inicio && b.ln.texto === ln.texto);
    if (igual) {
      igual.cor = p.placar.embalo ? AZUL_EMBALO : (igual.embalo ? AZUL_EMBALO : AMARELO);
      igual.embalo ||= p.placar.embalo;
      igual.acertos.push(...p.letrasPulando);
    } else blocos.push({ ln, cor: p.placar.embalo ? AZUL_EMBALO : p.cantor.cor,
      embalo: p.placar.embalo, parte: p.letra ?? p.parte, acertos: [...p.letrasPulando] });
  });
  if (!blocos.length) return;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  // A letra fica acima das barras do visualizador (até 80 px), pra não brigar com elas.
  const tamanho = blocos.length > 1 ? 30 : 38;
  let y = A - (blocos.length > 1 ? 150 : 140) * dpr;
  for (const b of blocos) {
    linhaColorida(ctx, L, dpr, b.ln, b.cor, batida, y, tamanho, b.acertos, performance.now());
    y += (tamanho + 14) * dpr;
  }
  if (blocos.length === 1) {
    const prox = linhaSeguinte(blocos[0].parte, blocos[0].ln);
    if (prox) {
      ctx.font = `${22 * dpr}px ${FONTE}`;
      ctx.fillStyle = APAGADO;
      ctx.textAlign = "center";
      ctx.fillText(prox.texto, L / 2, y);
      ctx.textAlign = "left";
    }
  }
}

function avisoInstrumental(ctx, L, A, dpr, { musica, ps, batida, seg }) {
  const falta = Math.min(...ps.map((p) => proximaLinhaEm(musica, p.parte, batida))) - seg;
  const antesDeTudo = ps.every((p) => p.parte.linhas[0].inicio > batida);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = APAGADO;
  ctx.font = `${22 * dpr}px ${FONTE}`;
  ctx.fillText(antesDeTudo ? "Prepare-se" : "Trecho só instrumental", L / 2, A * 0.2);
  ctx.fillStyle = BRANCO;
  ctx.font = `800 ${40 * dpr}px Unbounded, ${FONTE}`;
  let texto = "Fim!";
  if (Number.isFinite(falta)) {
    const s = Math.max(1, Math.ceil(falta));
    texto = `${antesDeTudo ? "Começa" : "Voltam"} em ${s} segundo${s === 1 ? "" : "s"}`;
  }
  ctx.fillText(texto, L / 2, A * 0.86);
  ctx.textAlign = "left";
}

export function desenharCantando(ctx, L, A, dpr, { musica, rodada, seg, agora, frequencias, parado }) {
  const batida = batidaNoTempo(musica, seg);
  const porSeg = 1 / duracaoDaBatida(musica);
  const frente = FRENTE_SEG * porSeg, atras = ATRAS_SEG * porSeg;
  const ps = rodada.participantes;
  // A letra vem em frases (as linhas picotadas juntas); as notas, como estão.
  const linhas = ps.map((p) => linhaNaTela(p.letra ?? p.parte, batida, 2 * porSeg));
  const temNotaNaTela = ps.some((p) => p.parte.linhas.some((ln) => ln.fim > batida - atras && ln.inicio < batida + frente));
  const instrumental = !temNotaNaTela && linhas.every((l) => !l);

  const noEmbalo = ps.filter((p) => p.placar.embalo);
  const bpm = Math.max(50, Math.min(160, musica.bpm / 4 || 76));
  const pulso = parado ? 0 : (1 + Math.sin((seg - musica.gap / 1000) * bpm / 60 * Math.PI * 2)) / 2;
  fundo(ctx, L, A, { frequencias, agora, parado, embalo: noEmbalo.length > 0, pulso: noEmbalo.length ? pulso : 0 });
  for (const p of noEmbalo) bordasAcesas(ctx, L, A, dpr, AZUL_EMBALO, parado ? 0.5 : 0.4 + 0.25 * pulso, noEmbalo.length);
  visualizador(ctx, L, A, dpr, { frequencias, ps, agora, grande: instrumental, parado });
  cabecalho(ctx, L, dpr, { musica, rodada, seg });
  if (instrumental) {
    avisoInstrumental(ctx, L, A, dpr, { musica, ps, batida, seg });
    return;
  }
  const topo = 84 * dpr, base = A - (ps.length > 1 ? 210 : 200) * dpr;
  const alt = (base - topo) / ps.length;
  ps.forEach((p, i) => faixa(ctx, L, dpr, { musica, p, y0: topo + i * alt, alt, batida, frente, atras, agora, seg, parado }));
  letra(ctx, L, A, dpr, { ps, linhas, batida });

  // 3, 2, 1 antes da primeira nota, com o nome de quem canta: ninguém é pego
  // de surpresa.
  const primeira = Math.min(...ps.map((p) => segundosDaBatida(musica, p.parte.linhas[0].inicio)));
  const falta = primeira - seg;
  if (falta > 0 && falta <= 3) contagemRegressiva(ctx, L, A, dpr, Math.ceil(falta), ps);
}

function contagemRegressiva(ctx, L, A, dpr, numero, ps) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = 0.92;
  ctx.font = `800 ${150 * dpr}px Unbounded, ${FONTE}`;
  ctx.fillStyle = AMARELO;
  ctx.fillText(String(numero), L * 0.62, A * 0.4);
  ctx.font = `600 ${28 * dpr}px ${FONTE}`;
  ctx.fillStyle = BRANCO;
  ctx.fillText(`Vai, ${ps.map((p) => p.cantor.nome).join(" e ")}!`, L * 0.62, A * 0.4 + 115 * dpr);
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
