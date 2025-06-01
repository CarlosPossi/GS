let mapa;
let perigoCirculos = [];
let rotas = [];
let marcadoresSeguros = [];
let pessoas = [];
let evacRelatorio = [];
let rotasBloqueadas = [];
const cacheRotas = {};
const rotasMap = {};

const VELOCIDADE_BASE = 0.0500;

window.onload = () => {
    iniciarMapa();
    carregarDados();
};

function iniciarMapa() {
    mapa = L.map('mapa').setView([-23.561684, -46.625378], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(mapa);
}

async function carregarDados() {
    const resposta = await fetch('dados.json');
    const dados = await resposta.json();

    const desastres = dados.desastres;

    if (desastres.length > 0) {
        atualizarPainelClima(desastres[0], "1");
    }

    if (desastres.length > 1) {
        atualizarPainelClima(desastres[1], "2");
    }
}

async function simularDesastre() {
    try {
        const dados = await fetch('dados.json').then(r => r.json());

        limparMapa();
        evacRelatorio = [];
        gerarRotasBloqueadasAleatorias(dados);

        mostrarPontosSeguros(dados.pontosSeguros);

        for (let idx = 0; idx < dados.desastres.length; idx++) {
            const desastre = dados.desastres[idx];
            await desenharPerigo(desastre, dados.pontosSeguros);

            for (let i = 0; i < 6; i++) {
                criarPessoa(desastre, dados.pontosSeguros, idx * 6 + i + 1, i);
            }
        }

        atualizarRelatorio();
    } catch (error) {
        console.error('Erro ao simular desastre:', error);
    }
}

function gerarRotasBloqueadasAleatorias(dados) {
    rotasBloqueadas = [];
    dados.desastres.forEach(desastre => {
        dados.pontosSeguros.forEach(ponto => {
            if (Math.random() < 0.3) {
                rotasBloqueadas.push({ origem: desastre.localPerigo, destino: ponto.local });
            }
        });
    });
}

function limparMapa() {
    perigoCirculos.forEach(c => mapa.removeLayer(c));
    rotas.forEach(r => mapa.removeLayer(r));
    marcadoresSeguros.forEach(m => mapa.removeLayer(m));
    pessoas.forEach(p => mapa.removeLayer(p.marker));

    perigoCirculos = [];
    rotas = [];
    marcadoresSeguros = [];
    pessoas = [];
    Object.keys(rotasMap).forEach(k => {
        if (rotasMap[k]) mapa.removeLayer(rotasMap[k]);
    });
    Object.keys(rotasMap).forEach(k => delete rotasMap[k]);

    document.getElementById('relatorio').innerHTML = '';
}

function mostrarPontosSeguros(pontos) {
    pontos.forEach(p => {
        const marker = L.marker(p.local, { icon: abrigoIcon() })
            .addTo(mapa)
            .bindPopup(`🟢 ${p.nome}`);
        marcadoresSeguros.push(marker);
    });
}

async function desenharPerigo(desastre, pontosSeguros) {
    const origem = desastre.localPerigo;

    const rotasDesenhadasNesteDesastre = new Set();

    const circulo = L.circle(origem, {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.4,
        radius: 200,
    })
        .addTo(mapa)
        .bindPopup(`${desastre.risco} ⚠️`);
    perigoCirculos.push(circulo);

    for (const ponto of pontosSeguros) {
        const chaveRota = `${origem.join(',')}_${ponto.local.join(',')}`;

        if (rotasDesenhadasNesteDesastre.has(chaveRota)) continue;

        const bloqueada = rotaEstaBloqueada(origem, ponto.local);

        // Remove rota já desenhada (livre ou bloqueada) antes de desenhar
        if (rotasMap[chaveRota]) {
            mapa.removeLayer(rotasMap[chaveRota]);
            rotas = rotas.filter(r => r !== rotasMap[chaveRota]);
            delete rotasMap[chaveRota];
        }

        // Se rota bloqueada, desenhe em vermelho tracejado
        // Se rota livre, desenhe em verde normal
        const res = await obterRotaGeoJSON(origem, ponto.local);
        if (!res) continue;

        const tipoRota = bloqueada ? 'bloqueada' : 'melhor';
        const rota = desenharRotaGeoJSON(res.geojson, tipoRota);

        rotas.push(rota);
        rotasMap[chaveRota] = rota;
        rotasDesenhadasNesteDesastre.add(chaveRota);

        rota.bindPopup(bloqueada ? `Rota BLOQUEADA para: ${ponto.nome}` : `Rota para: ${ponto.nome}`);
    }
}

function rotaEstaBloqueada(origem, destino) {
    return rotasBloqueadas.some(rb =>
        coordenadasIguais(rb.origem, origem) && coordenadasIguais(rb.destino, destino)
    );
}

function atualizarPainelClima(dados, painelId) {
    document.getElementById('temp' + painelId).textContent = dados.temperatura;
    document.getElementById('pressao' + painelId).textContent = dados.pressao;
    document.getElementById('vento' + painelId).textContent = dados.vento;
    document.getElementById('risco' + painelId).textContent = dados.risco;
}

async function criarTodasPessoas(desastres, pontosSeguros) {
    const promessas = [];

    desastres.forEach((desastre, desastreIndex) => {
        const numeroPessoas = 10;

        for (let i = 0; i < numeroPessoas; i++) {
            const id = `${desastreIndex}-${i}`;
            promessas.push(criarPessoaAsync(desastre, pontosSeguros, id, i));
        }
    });
    await Promise.all(promessas);
}

async function criarPessoa(desastre, pontosSeguros, id, pessoaIndex) {
    const origemBase = desastre.localPerigo;
    const origem = deslocarAleatoriamente(origemBase);

    const abrigosRotasLivres = pontosSeguros.filter(
        abrigo => !rotaEstaBloqueada(origemBase, abrigo.local)
    );

    let abrigoEscolhido;
    let tipoRota;

    if (abrigosRotasLivres.length > 0) {
        abrigoEscolhido = abrigosRotasLivres[pessoaIndex % abrigosRotasLivres.length];
        tipoRota = 'melhor';
    } else {
        abrigoEscolhido = encontrarMaisProximo(origem, pontosSeguros);
        tipoRota = 'bloqueada';
    }

    const marker = L.marker(origem, { icon: pessoaIcon() }).addTo(mapa);

    const pessoa = {
        id,
        marker,
        origem,
        destino: abrigoEscolhido.local,
        abrigoNome: abrigoEscolhido.nome,
        risco: desastre.risco,
        temperatura: desastre.temperatura,
        pressao: desastre.pressao,
        vento: desastre.vento,
        progresso: 0,
        tempoInicio: Date.now(),
        tempoEvacuacao: 0,
        tipoRota,
    };

    pessoas.push(pessoa);

    await desenharRotaPessoa(pessoa);
}



function deslocarAleatoriamente([latBase, lonBase]) {
    const deslocLat = (Math.random() - 0.5) * 0.001;
    const deslocLon = (Math.random() - 0.5) * 0.001;
    return [latBase + deslocLat, lonBase + deslocLon];
}

async function desenharRotaPessoa(pessoa) {
    const res = await obterRotaGeoJSON(pessoa.origem, pessoa.destino);
    if (!res) return;

    const rota = desenharRotaGeoJSON(res.geojson, pessoa.tipoRota);
    rotas.push(rota);
    pessoa.caminho = res.coordenadas;
    moverPessoaAoLongoDaRota(pessoa);
}

function moverPessoaAoLongoDaRota(pessoa) {
    if (!pessoa.caminho || pessoa.caminho.length < 2) return;

    const velocidade = VELOCIDADE_BASE * (0.8 + Math.random() * 0.4);
    let i = 0;

    const interval = setInterval(() => {
        const atual = pessoa.caminho[i];
        const proximo = pessoa.caminho[i + 1];

        if (!proximo) {
            clearInterval(interval);
            pessoa.marker.setLatLng(pessoa.caminho[pessoa.caminho.length - 1]);
            pessoa.tempoEvacuacao = (Date.now() - pessoa.tempoInicio) / 1000;
            registrarEvacuacao(pessoa);
            atualizarRelatorio();
            return;
        }

        const lat = atual[0] + (proximo[0] - atual[0]) * pessoa.progresso;
        const lon = atual[1] + (proximo[1] - atual[1]) * pessoa.progresso;
        pessoa.marker.setLatLng([lat, lon]);

        pessoa.progresso += velocidade;

        if (pessoa.progresso >= 1) {
            pessoa.progresso = 0;
            i++;
        }
    }, 50);
}

function registrarEvacuacao(pessoa) {
    evacRelatorio.push({
        id: pessoa.id,
        abrigo: pessoa.abrigoNome,
        tempo: pessoa.tempoEvacuacao.toFixed(1),
        risco: pessoa.risco,
    });
}

function atualizarRelatorio() {
    const container = document.getElementById('relatorio');
    if (!evacRelatorio.length) {
        container.innerHTML = '<p class="empty-msg">Nenhum dado disponível no relatório.</p>';
        return;
    }
    container.innerHTML = evacRelatorio
        .sort((a, b) => a.id - b.id)
        .map(ev => {
            let classeRisco = '';
            if (ev.risco.toLowerCase() === 'baixo') classeRisco = 'baixo';
            else if (ev.risco.toLowerCase() === 'medio' || ev.risco.toLowerCase() === 'médio') classeRisco = 'medio';
            else if (ev.risco.toLowerCase() === 'alto') classeRisco = 'alto';

            return `
              <div class="card">
                <div class="card-header">
                  <span class="id">#${ev.id}</span>
                  <span class="risco ${classeRisco}" title="Nível de risco">${ev.risco}</span>
                </div>
                <div class="card-body">
                  <p><strong>Abrigo:</strong> ${ev.abrigo}</p>
                  <p><strong>Tempo:</strong> ${ev.tempo}s</p>
                </div>
              </div>
            `;
        }).join('');

    gerarGrafico(evacRelatorio);
}



function gerarGrafico(evacRelatorio) {
    const temposPorAbrigo = {};

    evacRelatorio.forEach(ev => {
        if (!temposPorAbrigo[ev.abrigo]) temposPorAbrigo[ev.abrigo] = [];
        temposPorAbrigo[ev.abrigo].push(parseFloat(ev.tempo));
    });

    const labels = Object.keys(temposPorAbrigo);
    const medias = labels.map(abrigo => {
        const tempos = temposPorAbrigo[abrigo];
        const soma = tempos.reduce((acc, v) => acc + v, 0);
        return (soma / tempos.length).toFixed(2);
    });

    const ctx = document.getElementById('graficoEvacuacao').getContext('2d');


    if (window.chartInstancia) window.chartInstancia.destroy();

    window.chartInstancia = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Tempo Médio de Evacuação (s)',
                data: medias,
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Tempo (s)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Abrigos'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: context => `${context.dataset.label}: ${context.raw} segundos`
                    }
                }
            }
        }
    });
}

function coordenadasIguais(a, b) {
    return a[0] === b[0] && a[1] === b[1];
}

function encontrarMaisProximo(origem, pontos) {
    let maisProximo = null;
    let menorDist = Infinity;

    pontos.forEach(p => {
        const dist = distanciaEuclidiana(origem, p.local);
        if (dist < menorDist) {
            menorDist = dist;
            maisProximo = p;
        }
    });

    return maisProximo;
}

function distanciaEuclidiana([x1, y1], [x2, y2]) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

function abrigoIcon() {
    return L.icon({
        iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
        iconSize: [32, 32],
    });
}

function pessoaIcon() {
    return L.icon({
        iconUrl: 'https://img.icons8.com/color/48/000000/person-male.png',
        iconSize: [24, 24],
    });
}

async function obterRotaGeoJSON(origem, destino) {
    const chave = `${origem.join(',')}_${destino.join(',')}`;
    if (cacheRotas[chave]) return cacheRotas[chave];

    const url = `http://router.project-osrm.org/route/v1/driving/${origem[1]},${origem[0]};${destino[1]},${destino[0]}?overview=full&geometries=geojson`;

    try {
        const resposta = await fetch(url);
        const dados = await resposta.json();
        const geojson = dados.routes[0].geometry;
        const coordenadas = geojson.coordinates.map(([lon, lat]) => [lat, lon]);

        const resultado = { geojson, coordenadas };
        cacheRotas[chave] = resultado;
        return resultado;
    } catch (err) {
        console.error('Erro ao buscar rota OSRM:', err);
        return null;
    }
}


function desenharRotaGeoJSON(geojson, tipo) {
    let geojsonDeslocado = geojson;
    if (tipo === 'bloqueada') {
        geojsonDeslocado = deslocarGeoJSON(geojson, 0.00005);
    }

    const cor = tipo === 'bloqueada' ? 'red' : 'green';
    const dashArray = tipo === 'bloqueada' ? '8, 12' : null;

    const rota = L.geoJSON(geojsonDeslocado, {
        style: {
            color: cor,
            weight: 5,
            opacity: 0.7,
            dashArray: dashArray,
        }
    }).addTo(mapa);

    return rota;
}

function deslocarGeoJSON(geojson, delta) {
    const newCoords = geojson.coordinates.map(([lon, lat]) => [lon, lat + delta]);
    return {
        ...geojson,
        coordinates: newCoords
    };
}