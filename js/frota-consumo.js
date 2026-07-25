// ── SIGUC Frota — consumo médio de combustível ─────────────────
//
// Fonte única do cálculo, usada pelas TRÊS superfícies que mostram
// consumo (antes cada uma tinha sua cópia do mesmo bloco):
//   - pages/frota-app.html      (app do motorista, aba Dados)
//   - pages/frota-veiculos.html (mesa, aba Consumo do veículo)
//   - pages/frota-dashboard.html(KPI da frota + ranking por veículo)
//
// MÉTODO — agregado por odômetro (km total ÷ litros totais).
//
// Substitui o antigo "tanque cheio a tanque cheio", que tinha três
// problemas: (1) dependia de `tanque_cheio`, campo que o motorista
// marca por hábito e não por medição, o que fazia o consumo quase
// nunca aparecer; (2) fazia média não ponderada das taxas, dando o
// mesmo peso a um intervalo de 17 km e a um de 500 km; (3) usava
// abastecimento parcial como fim de janela e perdia os litros dele.
//
// Como funciona: o odômetro do primeiro e do último abastecimento
// delimitam a janela de medição, e os litros que produziram essa
// distância são os de TODOS os abastecimentos MENOS o primeiro.
//
// O primeiro fica de fora porque seu combustível foi queimado ANTES
// do início da janela. O último entra porque repõe justamente o que
// foi gasto até a leitura dele — que já está dentro da janela. Ex.:
//
//   10000 km — 40 L   ← abre a janela; estes 40 L rodaram antes
//   10055 km — 50 L   ← repõem o gasto de 10000→10055
//   10072 km — 50 L   ← repõem o gasto de 10055→10072
//   consumo = (10072-10000) / (50+50) = 0,72 km/L
//
// GUARDA DE CAUDA: abastecimento recente em que o veículo não rodou
// (odômetro igual ao do anterior) jogaria litros no denominador sem
// km no numerador. Esses registros do fim são descartados e a janela
// encerra no último abastecimento que efetivamente andou.
//
// A precisão depende de o nível do tanque ser parecido no primeiro e
// no último abastecimento — erro de fronteira inerente a qualquer
// método agregado, que se dilui conforme cresce o histórico.
//
// Base de confiança: a migration 192 trava o medidor no banco (nunca
// decresce, e as 4 RPCs mantêm frota_veiculos atualizado), e a view
// vw_frota_abastecimentos_detalhe já entrega `litros_final` com o
// ajuste da gestão aplicado.

// Quantos abastecimentos, no mínimo, para haver janela de medição.
const FROTA_CONSUMO_MIN_ABAST = 2

// Calcula o consumo de UM veículo.
//
// `registros` — linhas de vw_frota_abastecimentos_detalhe já
// filtradas pelo veículo E pelo status que a superfície considera
// (a mesa e o dashboard usam só 'validado'; o app do motorista conta
// pendentes+validados e descarta 'rejeitado'). O filtro fica com quem
// chama justamente porque essa regra difere entre as telas.
//
// `medidor` — 'hodometro' | 'horimetro'.
//
// Retorna null quando não há amostra suficiente, ou:
//   { consumo, unidade, distancia, litros, amostras }
// onde `distancia` é km (hodômetro) ou horas (horímetro).
function frotaConsumoVeiculo(registros, medidor) {
  const regs = (registros || [])
    .map(a => ({
      medida: Number(a.medida_no_abastecimento),
      litros: Number(a.litros_final || 0),
      data: a.data_hora,
    }))
    .filter(a => Number.isFinite(a.medida) && a.litros > 0)
    // Empate de data_hora (registro offline sincronizado em lote):
    // desempata pelo medidor, que a 192 garante ser crescente.
    .sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.medida - b.medida)

  // Guarda de cauda: descarta do fim os abastecimentos sem km rodado.
  while (regs.length >= 2 && regs[regs.length - 1].medida === regs[regs.length - 2].medida) {
    regs.pop()
  }

  if (regs.length < FROTA_CONSUMO_MIN_ABAST) return null

  const distancia = regs[regs.length - 1].medida - regs[0].medida
  // Todos os litros MENOS os do primeiro (queimados antes da janela).
  const litros = regs.slice(1).reduce((s, a) => s + a.litros, 0)
  if (distancia <= 0 || litros <= 0) return null

  return {
    consumo: medidor === 'horimetro' ? litros / distancia : distancia / litros,
    unidade: medidor === 'horimetro' ? 'L/h' : 'km/L',
    distancia,
    litros,
    amostras: regs.length - 1,
  }
}

// Consumo agregado de vários veículos (KPI geral do dashboard):
// soma as distâncias e soma os litros, em vez de tirar média das
// médias — senão uma moto que rodou 200 km pesaria igual a uma
// caminhonete que rodou 20.000 km.
//
// Só faz sentido entre veículos do MESMO medidor: quem chama deve
// passar apenas hodômetro (km/L) ou apenas horímetro (L/h).
function frotaConsumoAgregado(resultados, medidor) {
  const validos = (resultados || []).filter(r => r)
  if (!validos.length) return null
  const distancia = validos.reduce((s, r) => s + r.distancia, 0)
  const litros    = validos.reduce((s, r) => s + r.litros, 0)
  if (distancia <= 0 || litros <= 0) return null
  return medidor === 'horimetro' ? litros / distancia : distancia / litros
}

// Formata para exibição: "0,72 km/L" / "3,10 L/h", ou '—'.
function frotaConsumoTexto(resultado) {
  if (!resultado) return '—'
  return `${formatNum(resultado.consumo, 2)} ${resultado.unidade}`
}
