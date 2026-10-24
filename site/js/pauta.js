// A pauta livre da sala: sem música, só a linha da voz de cada um correndo da
// direita pra esquerda. Serve pra aquecer e pra conferir o microfone.

const JANELA_MS = 8000;  // quanto tempo de história cabe na tela
const MIDI_BAIXO = 36;   // Dó2, bem grave
const MIDI_ALTO = 84;    // Dó6, bem agudo
const EMENDA_MS = 150;   // pontos mais longe que isso no tempo não se ligam

export function ajustarTela(tela) {
  const dpr = window.devicePixelRatio || 1;
  const L = Math.round(tela.clientWidth * dpr), A = Math.round(tela.clientHeight * dpr);
  if (tela.width !== L || tela.height !== A) { tela.width = L; tela.height = A; }
  return { L, A, dpr };
}

export function desenharPauta(ctx, L, A, dpr, cantores, agora) {
  const margemEsq = 24 * dpr, margemDir = 24 * dpr, topo = 24 * dpr;
  const faixa = 10 * dpr;  // uma tirinha por cantor: "tinha voz aqui?"
  const rodape = (cantores.size * (faixa + 4 * dpr)) + 24 * dpr;
  const altura = A - topo - rodape;
  const x = (t) => L - margemDir - ((agora - t) / JANELA_MS) * (L - margemEsq - margemDir);
  const y = (midi) => topo + ((MIDI_ALTO - midi) / (MIDI_ALTO - MIDI_BAIXO)) * altura;

  // Uma linha por semitom, mais forte no Dó (sem o nome das notas: na festa
  // ninguém precisa dele). O fundo quem pinta é quem chama.
  for (let m = MIDI_BAIXO; m <= MIDI_ALTO; m++) {
    const dó = m % 12 === 0;
    ctx.strokeStyle = dó ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(margemEsq, y(m));
    ctx.lineTo(L - margemDir, y(m));
    ctx.stroke();
  }

  ctx.lineWidth = 5 * dpr;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const c of cantores.values()) {
    while (c.pontos.length && c.pontos[0].t < agora - JANELA_MS) c.pontos.shift();
    ctx.strokeStyle = c.cor;
    ctx.fillStyle = c.cor;
    let anterior = null;
    for (const p of c.pontos) {
      if (p.midi === null || p.midi < MIDI_BAIXO || p.midi > MIDI_ALTO) { anterior = null; continue; }
      if (anterior && p.t - anterior.t < EMENDA_MS && Math.abs(p.midi - anterior.midi) < 2) {
        ctx.beginPath();
        ctx.moveTo(x(anterior.t), y(anterior.midi));
        ctx.lineTo(x(p.t), y(p.midi));
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x(p.t), y(p.midi), 2.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      anterior = p;
    }
  }

  let base = topo + altura + 16 * dpr;
  for (const c of cantores.values()) {
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(margemEsq, base, L - margemEsq - margemDir, faixa);
    ctx.fillStyle = c.cor;
    for (const p of c.pontos) {
      if (p.voz) ctx.fillRect(x(p.t), base, (50 / JANELA_MS) * (L - margemEsq - margemDir) + 1, faixa);
    }
    base += faixa + 4 * dpr;
  }

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  ctx.moveTo(L - margemDir, topo);
  ctx.lineTo(L - margemDir, A - 8 * dpr);
  ctx.stroke();
  ctx.setLineDash([]);
}
