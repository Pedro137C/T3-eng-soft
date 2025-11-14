// Aguarda o HTML ser totalmente carregado
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. CONFIGURAÇÃO E SELETORES ---
    
    // URL da API T3 (verifique se a porta 5000 está correta)
    const API_URL = "http://localhost:5000";

    // Seletores da Navegação
    const navDashboard = document.getElementById('nav-dashboard');
    const navSubmit = document.getElementById('nav-submit');
    const viewDashboard = document.getElementById('view-dashboard');
    const viewSubmit = document.getElementById('view-submit');

    // Seletores da View "Enviar Dados"
    const xmlInput = document.getElementById('xml-input');
    const validationStatus = document.getElementById('validation-status');
    const btnImportExample = document.getElementById('btn-import-example');
    const btnValidateClient = document.getElementById('btn-validate-client');
    const btnSubmitT3 = document.getElementById('btn-submit-t3');

    // Seletores da View "Dashboard"
    const kpiTemp = document.getElementById('kpi-temp');
    const kpiSolo = document.getElementById('kpi-solo');
    const kpiLuz = document.getElementById('kpi-luz');
    const kpiCount = document.getElementById('kpi-count');
    const readingsTableBody = document.getElementById('readings-table-body');
    const chartCanvas = document.getElementById('temperature-chart');

    let temperatureChart = null; // Variável para guardar a instância do gráfico
    let ultimoXMLValido = ""; // Armazena o XML validado

    // --- 2. LÓGICA DE NAVEGAÇÃO (SPA) ---
    
    function showView(viewToShow) {
        // Esconde todas
        [viewDashboard, viewSubmit].forEach(v => v.classList.remove('active'));
        // Remove 'active' de todos os botões
        [navDashboard, navSubmit].forEach(b => b.classList.remove('active'));

        // Mostra a view correta
        if (viewToShow === 'dashboard') {
            viewDashboard.classList.add('active');
            navDashboard.classList.add('active');
            carregarDashboard(); // Recarrega os dados ao visitar o dashboard
        } else {
            viewSubmit.classList.add('active');
            navSubmit.classList.add('active');
        }
    }

    navDashboard.addEventListener('click', () => showView('dashboard'));
    navSubmit.addEventListener('click', () => showView('submit'));

    // --- 3. LÓGICA DA VIEW "ENVIAR DADOS" ---

    // (Seção 3 - T4) XML de Exemplo (T2)
    const EXEMPLO_XML_T2 = `<?xml version="1.0" encoding="UTF-8"?>
<estufa id="estufaPrincipal"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:noNamespaceSchemaLocation="estufa.xsd">
    <sensores>
        <sensor id="tNorte" tipo="temperatura" unidade="C">
            <localizacao>Parede Norte, 1.5m altura</localizacao>
        </sensor>
        <sensor id="uSoloB1" tipo="umidadeSolo" unidade="%">
            <localizacao>Bancada 1, Vaso 3</localizacao>
        </sensor>
        <sensor id="luzTeto" tipo="luminosidade" unidade="lux">
            <localizacao>Acima da Bancada 1</localizacao>
        </sensor>
    </sensores>
    <leituras>
        <leitura sensorRef="tNorte">
            <dataHora>2025-10-30T10:30:00-03:00</dataHora>
            <valor>24.5</valor>
        </leitura>
        <leitura sensorRef="uSoloB1">
            <dataHora>2025-10-30T10:30:00-03:00</dataHora>
            <valor>55.2</valor>
        </leitura>
        <leitura sensorRef="luzTeto">
            <dataHora>2025-10-30T10:30:00-03:00</dataHora>
            <valor>115000</valor>
        </leitura>
    </leituras>
</estufa>`;

    btnImportExample.addEventListener('click', () => {
        xmlInput.value = EXEMPLO_XML_T2;
        setStatus('Exemplo T2 importado. Por favor, valide.', 'normal');
        btnSubmitT3.disabled = true;
    });

    // (Seção 4 - T4) Validação no Cliente
    btnValidateClient.addEventListener('click', () => {
        const xmlText = xmlInput.value;
        if (!xmlText.trim()) {
            setStatus('Erro: O XML não pode estar vazio.', 'error');
            return;
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "application/xml");

        // 1. Valida Sintaxe (Parser Error)
        const parserError = xmlDoc.getElementsByTagName("parsererror");
        if (parserError.length > 0) {
            setStatus(`Erro de Sintaxe XML:\n${parserError[0].textContent}`, 'error');
            btnSubmitT3.disabled = true;
            return;
        }

        // 2. Valida Regras T2 (Faixas e IDREF)
        const errosValidacao = validarClienteXML(xmlDoc);
        if (errosValidacao.length > 0) {
            setStatus(`Erros de Validação (T2):\n- ${errosValidacao.join('\n- ')}`, 'error');
            btnSubmitT3.disabled = true;
        } else {
            setStatus('XML VÁLIDO (Cliente)! Pronto para enviar ao T3.', 'success');
            btnSubmitT3.disabled = false; // Habilita o botão de envio
            ultimoXMLValido = xmlText; // Armazena o XML bom
        }
    });

    // (Seção 6 - T4) Envio para a API T3
    btnSubmitT3.addEventListener('click', async () => {
        if (!ultimoXMLValido) {
            setStatus('Erro: XML não validado.', 'error');
            return;
        }

        setStatus('Enviando para o T3 (localhost:5000)...', 'normal');

        try {
            const response = await fetch(`${API_URL}/api/xml`, {
                method: "POST",
                headers: { "Content-Type": "application/xml" },
                body: ultimoXMLValido // Envia a string XML
            });

            const result = await response.json();

            if (!response.ok) {
                // Erro 400 (do T3) ou 500
                setStatus(`Erro do Servidor (T3):\n${result.code}\n${result.message || result.details}`, 'error');
            } else {
                // Sucesso 201
                setStatus(`Sucesso (T3)!\nXML salvo com ID:\n${result.id}`, 'success');
                ultimoXMLValido = ""; // Limpa
                btnSubmitT3.disabled = true; // Desabilita
            }
        } catch (error) {
            console.error("Erro de rede:", error);
            setStatus('Erro de Rede: Não foi possível conectar ao T3.\nVerifique se o servidor T3 (api.py) está a rodar.', 'error');
        }
    });

    /**
     * (Função Auxiliar - Validação T2/T4)
     * Valida o XML contra as regras do T2.
     * @param {XMLDocument} xmlDoc - O documento XML parseado.
     * @returns {string[]} - Uma lista de strings de erro.
     */
    function validarClienteXML(xmlDoc) {
        const erros = [];
        const limites = {
            "temperatura": [-10.0, 60.0],
            "umidadeAr": [0.0, 100.0],
            "umidadeSolo": [0.0, 100.0],
            "luminosidade": [0.0, 200000.0]
        };

        const sensorIds = new Set();
        xmlDoc.querySelectorAll("sensores sensor").forEach(s => sensorIds.add(s.getAttribute("id")));
        if (sensorIds.size === 0) erros.push("Nenhum sensor (<sensor>) definido.");

        xmlDoc.querySelectorAll("leituras leitura").forEach((leitura, i) => {
            const sensorRef = leitura.getAttribute("sensorRef");
            const valorNode = leitura.querySelector("valor");
            
            if (!sensorRef || !sensorIds.has(sensorRef)) {
                erros.push(`Leitura[${i}]: 'sensorRef' ("${sensorRef || 'nulo'}") é inválido.`);
            }

            if (!valorNode) {
                erros.push(`Leitura[${i}]: Tag <valor> ausente.`);
                return;
            }

            const valor = parseFloat(valorNode.textContent);
            const sensorTipo = xmlDoc.querySelector(`sensor[id="${sensorRef}"]`)?.getAttribute("tipo");

            if (sensorTipo && limites[sensorTipo]) {
                const [min, max] = limites[sensorTipo];
                if (isNaN(valor) || valor < min || valor > max) {
                    erros.push(`Leitura[${i}]: Valor ${valor} para '${sensorRef}' (${sensorTipo}) fora da faixa [${min}, ${max}].`);
                }
            }
        });
        return erros;
    }

    /**
     * (Função Auxiliar) Define a mensagem no painel de status
     */
    function setStatus(message, type) {
        validationStatus.textContent = message;
        validationStatus.className = type; // 'normal', 'success', ou 'error'
    }


    // --- 4. LÓGICA DA VIEW "DASHBOARD" ---

    /**
     * (Seção 6 T4) Busca e renderiza os dados do dashboard
     */
    async function carregarDashboard() {
        setStatus('A carregar dados do T3...', 'normal');
        try {
            // Chama o GET /api/consulta do T3
            const response = await fetch(`${API_URL}/api/consulta`);
            if (!response.ok) {
                throw new Error(`Falha no T3: ${response.statusText}`);
            }
            const data = await response.json();
            
            // Se não houver dados
            if (data.totalResultados === 0) {
                readingsTableBody.innerHTML = `<tr><td colspan="5">Nenhum dado encontrado no T3. Envie dados na aba "Enviar Dados".</td></tr>`;
                kpiTemp.textContent = "-";
                kpiSolo.textContent = "-";
                kpiLuz.textContent = "-";
                kpiCount.textContent = "0";
                return;
            }

            // (Seção 7 T4) Renderiza os Indicadores (KPIs, Tabela, Gráfico)
            renderizarKPIs(data.leituras);
            renderizarTabela(data.leituras);
            renderizarGrafico(data.leituras);

        } catch (error) {
            console.error("Falha ao carregar dashboard:", error);
            readingsTableBody.innerHTML = `<tr><td colspan="5" style="color: red;">Erro ao carregar dados do T3. Verifique se o T3 (api.py) está a rodar.</td></tr>`;
        }
    }

    function renderizarKPIs(leituras) {
        // Filtra leituras por tipo e calcula médias
        const temps = leituras.filter(l => l.tipo === 'temperatura').map(l => l.valor);
        const solos = leituras.filter(l => l.tipo === 'umidadeSolo').map(l => l.valor);
        const luzes = leituras.filter(l => l.tipo === 'luminosidade').map(l => l.valor);
        
        const media = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : "-";

        kpiTemp.textContent = `${media(temps)} °C`;
        kpiSolo.textContent = `${media(solos)} %`;
        kpiLuz.textContent = `${media(luzes)} lux`;
        kpiCount.textContent = leituras.length;
    }

    function renderizarTabela(leituras) {
        readingsTableBody.innerHTML = ""; // Limpa a tabela
        // Pega as 10 últimas leituras
        const leiturasRecentes = leituras.sort((a, b) => new Date(b.dataHora) - new Date(a.dataHora)).slice(0, 10);
        
        if (leiturasRecentes.length === 0) {
            readingsTableBody.innerHTML = `<tr><td colspan="5">Nenhum dado para exibir.</td></tr>`;
            return;
        }

        leiturasRecentes.forEach(l => {
            const row = `<tr>
                <td>${l.sensorId}</td>
                <td>${l.tipo}</td>
                <td>${l.valor} ${l.unidade}</td>
                <td>${new Date(l.dataHora).toLocaleString('pt-BR')}</td>
                <td>${l.arquivoOrigem}</td>
            </tr>`;
            readingsTableBody.innerHTML += row;
        });
    }

    function renderizarGrafico(leituras) {
        // Filtra apenas dados de temperatura
        const dadosTemp = leituras
            .filter(l => l.tipo === 'temperatura')
            .sort((a, b) => new Date(a.dataHora) - new Date(b.dataHora)); // Ordena por data

        // Prepara dados para o Chart.js
        const labels = dadosTemp.map(l => new Date(l.dataHora).toLocaleTimeString('pt-BR'));
        const data = dadosTemp.map(l => l.valor);

        // Destrói o gráfico anterior se ele existir (para não sobrepor)
        if (temperatureChart) {
            temperatureChart.destroy();
        }

        // Cria o novo gráfico
        temperatureChart = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Temperatura (°C)',
                    data: data,
                    borderColor: '#0077b6',
                    backgroundColor: 'rgba(0, 119, 182, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1 // Linha levemente curvada
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: false // Não força o gráfico a começar do 0
                    }
                }
            }
        });
    }

    // --- 5. INICIALIZAÇÃO ---
    showView('dashboard'); // Começa na view do dashboard
});
