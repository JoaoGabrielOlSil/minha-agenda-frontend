// A URL da API (API_BASE_URL) fica em config.js, carregado antes deste arquivo.

let statusSelecionadoTemp = "";

// Dados carregados da API
let listaPacientes = [];
let listaMedicos = [];
let listaAgendamentos = [];

document.addEventListener("DOMContentLoaded", () => {
    localStorage.removeItem("api_url"); // resto da versão antiga, que deixava trocar a URL

    verificarStatusConexao();
    carregarTudo();
});

// ---------------------------------------------------------------------------
// UTILITÁRIOS
// ---------------------------------------------------------------------------

// Faz uma requisição autenticada e devolve o JSON. Lança Error com a mensagem da API.
async function api(path, { method = "GET", body, query } = {}) {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("Por favor, faça a autenticação clicando em \"Autenticar API\".");

    let url = `${API_BASE_URL}${path}`;
    if (query) url += `?${new URLSearchParams(query)}`;

    const options = { method, headers: { "Authorization": `Bearer ${token}` } };
    if (body !== undefined) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch(url, options);
    } catch (e) {
        throw new Error("Erro de conexão com a API (rede ou CORS).");
    }

    const data = await response.json().catch(() => null);

    if (response.status === 401) {
        localStorage.removeItem("token");
        verificarStatusConexao();
        throw new Error("Sessão expirada. Autentique-se novamente.");
    }
    if (!response.ok) {
        throw new Error(formatarErro(data, response.status));
    }
    return data;
}

function formatarErro(data, status) {
    const detail = data && data.detail;
    if (Array.isArray(detail)) {
        // Erros 422 do FastAPI vêm como lista
        return detail.map(d => `${(d.loc || []).slice(-1)[0] || ""}: ${d.msg}`).join("\n");
    }
    if (status === 403) return detail || "Seu usuário não tem permissão para esta ação (precisa ser admin ou dev).";
    return detail || `Erro ${status} na API.`;
}

function fecharModal(id) {
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById(id));
    if (modalInstance) modalInstance.hide();
}

function somenteDigitos(valor) {
    return (valor || "").replace(/\D/g, "");
}

function formatarCpf(cpf) {
    const d = somenteDigitos(cpf);
    return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : (cpf || "");
}

// "AAAA-MM-DD" -> "DD/MM/AAAA"
function formatarData(data) {
    if (!data) return "-";
    const [ano, mes, dia] = data.split("-");
    return `${dia}/${mes}/${ano}`;
}

function escaparHtml(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function linhaMensagem(colspan, html, classe = "text-muted") {
    return `<tr><td colspan="${colspan}" class="text-center ${classe} py-4">${html}</td></tr>`;
}

const MSG_LOGIN = '<i class="fas fa-lock me-2"></i>Por favor, faça a autenticação clicando em <b>"Autenticar API"</b> no menu lateral.';

// ---------------------------------------------------------------------------
// NAVEGAÇÃO E AUTENTICAÇÃO
// ---------------------------------------------------------------------------

function mostrarAba(nomeAba) {
    document.querySelectorAll(".sidebar .nav-link").forEach(link => link.classList.remove("active"));
    const navItem = document.getElementById(`nav-${nomeAba}`);
    if (navItem) navItem.classList.add("active");

    document.querySelectorAll(".tab-section").forEach(sec => sec.classList.remove("active"));
    const secaoAtiva = document.getElementById(`aba-${nomeAba}`);
    if (secaoAtiva) secaoAtiva.classList.add("active");
}

function verificarStatusConexao() {
    const token = localStorage.getItem("token");
    const badge = document.getElementById("status-conexao");
    if (!badge) return;

    if (token) {
        badge.className = "badge bg-success p-2 w-100";
        badge.innerHTML = '<i class="fas fa-check-circle me-1"></i>Conectado';
    } else {
        badge.className = "badge bg-danger p-2 w-100";
        badge.innerHTML = '<i class="fas fa-times-circle me-1"></i>Desconectado';
    }
}

async function autenticarAPI(event) {
    if (event) event.preventDefault();

    const email = document.getElementById("auth-email").value.trim();
    const senha = document.getElementById("auth-senha").value.trim();

    try {
        const response = await fetch(`${API_BASE_URL}/auth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ username: email, password: senha })
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem("token", data.access_token);
            verificarStatusConexao();
            fecharModal("modalAuth");
            alert("Autenticação realizada com sucesso!");
            carregarTudo();
        } else {
            const errData = await response.json().catch(() => ({}));
            alert(`Erro na Autenticação: ${errData.detail || "E-mail ou senha incorretos"}`);
        }
    } catch (error) {
        console.error("Erro na requisição de login:", error);
        alert("Erro ao conectar à API. Verifique sua conexão ou as configurações de CORS da API.");
    }
}

// Carrega pacientes, médicos e agendamentos
async function carregarTudo() {
    await Promise.all([carregarPacientes(), carregarMedicos()]);
    await carregarAgendamentos(); // depois, para calcular o histórico dos pacientes
}

// ---------------------------------------------------------------------------
// AGENDAMENTOS
// ---------------------------------------------------------------------------

// Status da consulta vindos da API
const STATUS_AGENDAMENTO = {
    pendente:   { label: "Pendente",         classe: "bg-warning text-dark" },
    confirmado: { label: "Confirmado",       classe: "bg-success" },
    concluido:  { label: "Concluído",        classe: "bg-info text-dark" },
    ausente:    { label: "Paciente Ausente", classe: "bg-secondary" },
    cancelado:  { label: "Cancelado",        classe: "bg-danger" }
};

function getStatusBadge(status) {
    const s = STATUS_AGENDAMENTO[status] || { label: status || "Pendente", classe: "bg-light text-dark" };
    return `<span class="badge ${s.classe} badge-status">${escaparHtml(s.label)}</span>`;
}

// Status do médico vindos da API
const STATUS_MEDICO = {
    ativo:   { label: "Ativo",     classe: "bg-success" },
    ferias:  { label: "Em Férias", classe: "bg-warning text-dark" },
    inativo: { label: "Inativo",   classe: "bg-secondary" }
};

function formatarDataHora(date, time) {
    if (!date) return "-";
    return `${date} às ${(time || "").slice(0, 5)}`;
}

async function carregarAgendamentos() {
    const tbody = document.getElementById("tabela-agendamentos");
    if (!tbody) return;

    if (!localStorage.getItem("token")) {
        tbody.innerHTML = linhaMensagem(9, MSG_LOGIN);
        atualizarEstatisticas([]);
        return;
    }

    try {
        listaAgendamentos = await api("/appointments/list");
        renderizarAgendamentos(listaAgendamentos);
        atualizarEstatisticas(listaAgendamentos);
        renderizarPacientes(); // atualiza o histórico de consultas
    } catch (error) {
        console.error("Erro ao carregar agendamentos:", error);
        tbody.innerHTML = linhaMensagem(9, escaparHtml(error.message), "text-danger");
    }
}

function renderizarAgendamentos(agendamentos) {
    const tbody = document.getElementById("tabela-agendamentos");
    if (!tbody) return;

    if (!agendamentos || agendamentos.length === 0) {
        tbody.innerHTML = linhaMensagem(9, "Nenhum agendamento encontrado.");
        return;
    }

    tbody.innerHTML = "";

    agendamentos.forEach(item => {
        const tr = document.createElement("tr");
        const id = item.id;

        tr.innerHTML = `
            <td>#${escaparHtml(id)}</td>
            <td><strong>${escaparHtml(item.patient_name)}</strong></td>
            <td>${formatarCpf(item.patient_cpf)}</td>
            <td>${escaparHtml(item.doctor_name)}</td>
            <td>${formatarDataHora(item.date, item.time)}</td>
            <td>${getStatusBadge(item.status)}</td>
            <td><small class="text-muted fw-semibold">${item.reason ? escaparHtml(item.reason) : "<em>-</em>"}</small></td>
            <td>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-success text-nowrap" onclick="enviarWhatsApp('${id}')" title="Enviar WhatsApp">
                        <i class="fab fa-whatsapp me-1"></i>WhatsApp
                    </button>
                    <button class="btn btn-sm btn-primary text-nowrap" onclick="enviarEmail('${id}')" title="Enviar E-mail">
                        <i class="fas fa-envelope me-1"></i>E-mail
                    </button>
                </div>
            </td>
            <td class="text-nowrap">
                <button class="btn btn-sm btn-outline-dark fw-bold px-3 me-1" onclick="abrirPopUpAcoes('${id}')">
                    Opções <i class="fas fa-chevron-down ms-1 fs-7"></i>
                </button>
                <button class="btn btn-sm btn-outline-primary me-1" onclick="abrirModalEditarAgendamento('${id}')" title="Editar Agendamento">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="excluirAgendamento('${id}')" title="Excluir Agendamento">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });
}

function atualizarEstatisticas(agendamentos) {
    if (!Array.isArray(agendamentos)) return;

    const total = agendamentos.length;
    const confirmados = agendamentos.filter(a => a.status === "confirmado" || a.status === "concluido").length;
    const pendentes = agendamentos.filter(a => a.status === "pendente").length;

    const elTotal = document.getElementById("stat-total");
    const elConfirmados = document.getElementById("stat-confirmados");
    const elPendentes = document.getElementById("stat-pendentes");

    if (elTotal) elTotal.innerText = total;
    if (elConfirmados) elConfirmados.innerText = confirmados;
    if (elPendentes) elPendentes.innerText = pendentes;
}

// Preenche os selects de paciente e médico (value = CPF). Só lista médicos ativos.
function preencherSelectsAgendamento(selectPaciente, selectMedico) {
    if (selectPaciente) {
        selectPaciente.innerHTML = `<option value="">-- Escolha um paciente --</option>`;
        listaPacientes.forEach(p => {
            selectPaciente.innerHTML += `<option value="${escaparHtml(p.cpf)}">${escaparHtml(p.name)} (${formatarCpf(p.cpf)})</option>`;
        });
    }

    if (selectMedico) {
        selectMedico.innerHTML = `<option value="">-- Escolha um médico --</option>`;
        listaMedicos.filter(m => m.status === "ativo").forEach(m => {
            selectMedico.innerHTML += `<option value="${escaparHtml(m.cpf)}">${escaparHtml(m.name)} - ${escaparHtml(m.doctor_specialty)}</option>`;
        });
    }
}

// NOVO AGENDAMENTO
function prepararModalNovoAgendamento() {
    preencherSelectsAgendamento(
        document.getElementById("novo-agendamento-paciente"),
        document.getElementById("novo-agendamento-medico")
    );
    document.getElementById("novo-agendamento-cpf").value = "";
}

// EDITAR AGENDAMENTO
function abrirModalEditarAgendamento(id) {
    const agendamento = listaAgendamentos.find(a => a.id === id);
    if (!agendamento) return;

    const selectPaciente = document.getElementById("edit-agendamento-paciente");
    const selectMedico = document.getElementById("edit-agendamento-medico");
    preencherSelectsAgendamento(selectPaciente, selectMedico);

    // Se o paciente/médico do agendamento não estiver mais nas listas, mantém como opção
    if (!listaPacientes.some(p => p.cpf === agendamento.patient_cpf)) {
        selectPaciente.innerHTML += `<option value="${escaparHtml(agendamento.patient_cpf)}">${escaparHtml(agendamento.patient_name)} (${formatarCpf(agendamento.patient_cpf)})</option>`;
    }
    // (inclui médico de férias/inativo que já estava no agendamento)
    if (agendamento.doctor_cpf && !selectMedico.querySelector(`option[value="${agendamento.doctor_cpf}"]`)) {
        selectMedico.innerHTML += `<option value="${escaparHtml(agendamento.doctor_cpf)}">${escaparHtml(agendamento.doctor_name)}</option>`;
    }

    document.getElementById("edit-agendamento-id").value = id;
    document.getElementById("edit-agendamento-titulo-id").innerText = `#${id}`;
    selectPaciente.value = agendamento.patient_cpf;
    selectMedico.value = agendamento.doctor_cpf || "";
    document.getElementById("edit-agendamento-cpf").value = formatarCpf(agendamento.patient_cpf);
    document.getElementById("edit-agendamento-datahora").value = `${agendamento.date}T${(agendamento.time || "").slice(0, 5)}`;

    const modal = new bootstrap.Modal(document.getElementById("modalEditarAgendamento"));
    modal.show();
}

function atualizarCpfEditarAgendamento() {
    const cpf = document.getElementById("edit-agendamento-paciente").value;
    document.getElementById("edit-agendamento-cpf").value = cpf ? formatarCpf(cpf) : "";
}

async function salvarEdicaoAgendamento(event) {
    event.preventDefault();

    const id = document.getElementById("edit-agendamento-id").value;
    const selectPaciente = document.getElementById("edit-agendamento-paciente");
    const cpf = selectPaciente.value;
    const paciente = listaPacientes.find(p => p.cpf === cpf);
    const pacienteNome = paciente ? paciente.name : (listaAgendamentos.find(a => a.id === id) || {}).patient_name;
    const medicoCpf = document.getElementById("edit-agendamento-medico").value;
    const dataHoraRaw = document.getElementById("edit-agendamento-datahora").value;

    if (!cpf || !medicoCpf || !dataHoraRaw) {
        alert("Por favor, preencha todos os campos obrigatórios.");
        return;
    }

    const [date, hora] = dataHoraRaw.split("T");

    try {
        await api("/appointments/update", {
            method: "PUT",
            query: { id },
            body: {
                patient_name: pacienteNome,
                patient_cpf: cpf,
                doctor_cpf: medicoCpf,
                date: date,
                time: `${hora}:00`
            }
        });

        alert(`Agendamento #${id} atualizado com sucesso!`);
        fecharModal("modalEditarAgendamento");
        carregarAgendamentos();
    } catch (error) {
        alert(`Erro ao atualizar agendamento:\n${error.message}`);
    }
}

// EXCLUIR AGENDAMENTO
async function excluirAgendamento(id) {
    const agendamento = listaAgendamentos.find(a => a.id === id);
    const descricao = agendamento
        ? `#${id} de ${agendamento.patient_name} (${formatarDataHora(agendamento.date, agendamento.time)})`
        : `#${id}`;

    if (!confirm(`Tem certeza que deseja excluir o agendamento ${descricao}?`)) return;

    try {
        await api("/appointments/delete", { method: "DELETE", query: { id } });
        carregarAgendamentos();
    } catch (error) {
        alert(`Erro ao excluir agendamento:\n${error.message}`);
    }
}

function atualizarCpfNovoAgendamento() {
    const cpf = document.getElementById("novo-agendamento-paciente").value;
    document.getElementById("novo-agendamento-cpf").value = cpf ? formatarCpf(cpf) : "";
}

async function salvarNovoAgendamento(event) {
    event.preventDefault();

    const cpf = document.getElementById("novo-agendamento-paciente").value;
    const paciente = listaPacientes.find(p => p.cpf === cpf);
    const medicoCpf = document.getElementById("novo-agendamento-medico").value;
    const dataHoraRaw = document.getElementById("novo-agendamento-datahora").value; // "AAAA-MM-DDTHH:MM"
    const status = document.getElementById("novo-agendamento-status").value;

    if (!paciente || !medicoCpf || !dataHoraRaw) {
        alert("Por favor, preencha todos os campos obrigatórios.");
        return;
    }

    const [date, hora] = dataHoraRaw.split("T");

    try {
        const criado = await api("/appointments/create", {
            method: "POST",
            body: {
                patient_name: paciente.name,
                patient_cpf: paciente.cpf,
                doctor_cpf: medicoCpf,
                date: date,
                time: `${hora}:00`
            }
        });

        // A API sempre cria como "pendente"; se escolheu outro status, atualiza em seguida
        if (status && status !== "pendente") {
            await api("/appointments/status", { method: "PUT", query: { id: criado.id, status } });
        }

        alert(`Agendamento #${criado.id} para ${paciente.name} cadastrado com sucesso!`);
        fecharModal("modalNovoAgendamento");
        document.getElementById("form-novo-agendamento").reset();
        carregarAgendamentos();
    } catch (error) {
        alert(`Erro ao cadastrar agendamento:\n${error.message}`);
    }
}

// AÇÕES DE AGENDAMENTO (POP-UP MODAL)
function abrirPopUpAcoes(id) {
    const agendamento = listaAgendamentos.find(a => a.id === id);
    const paciente = agendamento ? agendamento.patient_name : "";

    document.getElementById("popup-agendamento-id").value = id;
    document.getElementById("modalAcoesTitulo").innerHTML = `<i class="fas fa-sliders-h me-2 text-primary"></i>Agendamento #${escaparHtml(id)} - ${escaparHtml(paciente)}`;

    ocultarFormMotivo();

    const modal = new bootstrap.Modal(document.getElementById("modalPopUpAcoes"));
    modal.show();
}

function mostrarFormMotivo(status) {
    statusSelecionadoTemp = status;
    const container = document.getElementById("form-motivo-container");
    const label = document.getElementById("label-motivo-titulo");

    if (status === "ausente") {
        label.innerText = "Informe o Motivo da Ausência do Paciente:";
    } else {
        label.innerText = "Informe o Motivo do Cancelamento:";
    }

    document.getElementById("popup-motivo-texto").value = "";
    container.style.display = "block";
}

function ocultarFormMotivo() {
    statusSelecionadoTemp = "";
    const container = document.getElementById("form-motivo-container");
    if (container) container.style.display = "none";
}

async function executarAcaoPopUp(novoStatus, motivo = "") {
    const id = document.getElementById("popup-agendamento-id").value;

    const query = { id, status: novoStatus };
    if (motivo) query.reason = motivo; // a API só guarda o motivo para "ausente" e "cancelado"

    try {
        await api("/appointments/status", { method: "PUT", query });
        const label = (STATUS_AGENDAMENTO[novoStatus] || {}).label || novoStatus;
        alert(`Agendamento #${id} atualizado para "${label}" com sucesso!`);
        fecharModal("modalPopUpAcoes");
        carregarAgendamentos();
    } catch (error) {
        alert(`Erro ao atualizar agendamento:\n${error.message}`);
    }
}

async function confirmarComMotivo() {
    const motivoText = document.getElementById("popup-motivo-texto").value.trim();
    if (!motivoText) {
        alert("Por favor, digite um motivo.");
        return;
    }
    await executarAcaoPopUp(statusSelecionadoTemp, motivoText);
}

// NOTIFICAÇÕES (a API monta a mensagem e devolve o link pronto)
// with_link: false -> mensagem sem link; o paciente responde SIM/NÃO e a recepção confirma pelo sistema
async function abrirMensagem(id, canal) {
    try {
        const { url } = await api(`/appointments/notify/${canal}-link`, { query: { id, with_link: false } });
        window.open(url, "_blank");
    } catch (error) {
        alert(`Erro ao gerar mensagem:\n${error.message}`);
    }
}

function enviarWhatsApp(id) {
    abrirMensagem(id, "whatsapp");
}

function enviarEmail(id) {
    abrirMensagem(id, "email");
}

// ---------------------------------------------------------------------------
// PACIENTES
// ---------------------------------------------------------------------------

async function carregarPacientes() {
    const tbody = document.getElementById("tabela-pacientes");
    if (!tbody) return;

    if (!localStorage.getItem("token")) {
        listaPacientes = [];
        tbody.innerHTML = linhaMensagem(8, MSG_LOGIN);
        return;
    }

    try {
        listaPacientes = await api("/patients/list");
        renderizarPacientes();
    } catch (error) {
        console.error("Erro ao carregar pacientes:", error);
        tbody.innerHTML = linhaMensagem(8, escaparHtml(error.message), "text-danger");
    }
}

function renderizarPacientes() {
    const tbody = document.getElementById("tabela-pacientes");
    if (!tbody || !localStorage.getItem("token")) return;

    if (listaPacientes.length === 0) {
        tbody.innerHTML = linhaMensagem(8, "Nenhum paciente cadastrado.");
        return;
    }

    tbody.innerHTML = "";
    listaPacientes.forEach(p => {
        const consultas = listaAgendamentos.filter(a => a.patient_cpf === p.cpf).length;
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>#${escaparHtml(p.id)}</td>
            <td><strong>${escaparHtml(p.name)}</strong></td>
            <td>${formatarCpf(p.cpf)}</td>
            <td>${escaparHtml(p.tel)}</td>
            <td>${escaparHtml(p.email)}</td>
            <td>${formatarData(p.dt_nasc)}</td>
            <td><span class="badge bg-light text-dark">${consultas} consultas</span></td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" onclick="abrirModalEditarPaciente('${p.cpf}')" title="Editar Cadastro">
                    <i class="fas fa-edit me-1"></i>Editar
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="excluirPaciente('${p.cpf}')" title="Excluir">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function salvarNovoPaciente(event) {
    event.preventDefault();
    const nome = document.getElementById("novo-paciente-nome").value.trim();

    try {
        await api("/patients/create", {
            method: "POST",
            body: {
                name: nome,
                cpf: somenteDigitos(document.getElementById("novo-paciente-cpf").value),
                tel: document.getElementById("novo-paciente-telefone").value.trim(),
                email: document.getElementById("novo-paciente-email").value.trim(),
                dt_nasc: document.getElementById("novo-paciente-dtnasc").value
            }
        });

        alert(`Paciente ${nome} cadastrado com sucesso!`);
        fecharModal("modalNovoPaciente");
        document.getElementById("form-novo-paciente").reset();
        carregarPacientes();
    } catch (error) {
        alert(`Erro ao cadastrar paciente:\n${error.message}`);
    }
}

function abrirModalEditarPaciente(cpf) {
    const paciente = listaPacientes.find(p => p.cpf === cpf);
    if (!paciente) return;

    document.getElementById("edit-paciente-id").value = paciente.cpf; // CPF atual é a chave na API
    document.getElementById("edit-paciente-nome").value = paciente.name;
    document.getElementById("edit-paciente-cpf").value = formatarCpf(paciente.cpf);
    document.getElementById("edit-paciente-telefone").value = paciente.tel;
    document.getElementById("edit-paciente-email").value = paciente.email;
    document.getElementById("edit-paciente-dtnasc").value = paciente.dt_nasc || "";

    const modal = new bootstrap.Modal(document.getElementById("modalEditarPaciente"));
    modal.show();
}

async function salvarEdicaoPaciente(event) {
    event.preventDefault();
    const cpfAtual = document.getElementById("edit-paciente-id").value;
    const nome = document.getElementById("edit-paciente-nome").value.trim();

    try {
        await api("/patients/update", {
            method: "PUT",
            query: { cpf: cpfAtual },
            body: {
                name: nome,
                cpf: somenteDigitos(document.getElementById("edit-paciente-cpf").value),
                tel: document.getElementById("edit-paciente-telefone").value.trim(),
                email: document.getElementById("edit-paciente-email").value.trim(),
                dt_nasc: document.getElementById("edit-paciente-dtnasc").value
            }
        });

        alert(`Cadastro do paciente ${nome} atualizado com sucesso!`);
        fecharModal("modalEditarPaciente");
        await carregarPacientes();
        carregarAgendamentos();
    } catch (error) {
        alert(`Erro ao atualizar paciente:\n${error.message}`);
    }
}

async function excluirPaciente(cpf) {
    if (!confirm("Tem certeza que deseja remover este paciente do sistema?")) return;

    try {
        await api("/patients/delete", { method: "DELETE", query: { cpf } });
        await carregarPacientes();
        carregarAgendamentos();
    } catch (error) {
        alert(`Erro ao excluir paciente:\n${error.message}`);
    }
}

// ---------------------------------------------------------------------------
// MÉDICOS
// ---------------------------------------------------------------------------

async function carregarMedicos() {
    const tbody = document.getElementById("tabela-medicos");
    if (!tbody) return;

    if (!localStorage.getItem("token")) {
        listaMedicos = [];
        tbody.innerHTML = linhaMensagem(7, MSG_LOGIN);
        return;
    }

    try {
        listaMedicos = await api("/doctors/list");
        renderizarMedicos();
    } catch (error) {
        console.error("Erro ao carregar médicos:", error);
        tbody.innerHTML = linhaMensagem(7, escaparHtml(error.message), "text-danger");
    }
}

function renderizarMedicos() {
    const tbody = document.getElementById("tabela-medicos");
    if (!tbody) return;

    if (listaMedicos.length === 0) {
        tbody.innerHTML = linhaMensagem(7, "Nenhum médico cadastrado.");
        return;
    }

    tbody.innerHTML = "";
    listaMedicos.forEach(m => {
        const st = STATUS_MEDICO[m.status] || { label: m.status || "-", classe: "bg-light text-dark" };
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>#${escaparHtml(m.id)}</td>
            <td><strong>${escaparHtml(m.name)}</strong></td>
            <td>${m.registration ? escaparHtml(m.registration) : "-"}</td>
            <td><span class="badge bg-info text-dark">${escaparHtml(m.doctor_specialty)}</span></td>
            <td>${escaparHtml(m.tel)}</td>
            <td><span class="badge ${st.classe}">${escaparHtml(st.label)}</span></td>
            <td>
                <button class="btn btn-sm btn-outline-primary me-1" onclick="abrirModalEditarMedico('${m.cpf}')" title="Editar Cadastro">
                    <i class="fas fa-edit me-1"></i>Editar
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="excluirMedico('${m.cpf}')" title="Excluir">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function salvarNovoMedico(event) {
    event.preventDefault();
    const nome = document.getElementById("novo-medico-nome").value.trim();

    try {
        await api("/doctors/create", {
            method: "POST",
            body: {
                name: nome,
                cpf: somenteDigitos(document.getElementById("novo-medico-cpf").value),
                email: document.getElementById("novo-medico-email").value.trim(),
                tel: document.getElementById("novo-medico-telefone").value.trim(),
                doctor_specialty: document.getElementById("novo-medico-especialidade").value.trim(),
                registration: document.getElementById("novo-medico-crm").value.trim() || null,
                status: document.getElementById("novo-medico-status").value
            }
        });

        alert(`Médico ${nome} cadastrado com sucesso!`);
        fecharModal("modalNovoMedico");
        document.getElementById("form-novo-medico").reset();
        carregarMedicos();
    } catch (error) {
        alert(`Erro ao cadastrar médico:\n${error.message}`);
    }
}

function abrirModalEditarMedico(cpf) {
    const medico = listaMedicos.find(m => m.cpf === cpf);
    if (!medico) return;

    document.getElementById("edit-medico-id").value = medico.cpf; // CPF atual é a chave na API
    document.getElementById("edit-medico-nome").value = medico.name;
    document.getElementById("edit-medico-email").value = medico.email;
    document.getElementById("edit-medico-crm").value = medico.registration || "";
    document.getElementById("edit-medico-especialidade").value = medico.doctor_specialty;
    document.getElementById("edit-medico-telefone").value = medico.tel;
    document.getElementById("edit-medico-status").value = medico.status || "ativo";

    const modal = new bootstrap.Modal(document.getElementById("modalEditarMedico"));
    modal.show();
}

async function salvarEdicaoMedico(event) {
    event.preventDefault();
    const cpf = document.getElementById("edit-medico-id").value;
    const nome = document.getElementById("edit-medico-nome").value.trim();

    try {
        await api("/doctors/update", {
            method: "PUT",
            query: { cpf },
            body: {
                name: nome,
                email: document.getElementById("edit-medico-email").value.trim(),
                tel: document.getElementById("edit-medico-telefone").value.trim(),
                doctor_specialty: document.getElementById("edit-medico-especialidade").value.trim(),
                registration: document.getElementById("edit-medico-crm").value.trim() || null,
                status: document.getElementById("edit-medico-status").value
            }
        });

        alert(`Cadastro do médico ${nome} atualizado com sucesso!`);
        fecharModal("modalEditarMedico");
        await carregarMedicos();
        carregarAgendamentos();
    } catch (error) {
        alert(`Erro ao atualizar médico:\n${error.message}`);
    }
}

async function excluirMedico(cpf) {
    if (!confirm("Tem certeza que deseja remover este profissional do sistema?")) return;

    try {
        await api("/doctors/delete", { method: "DELETE", query: { cpf } });
        carregarMedicos();
    } catch (error) {
        alert(`Erro ao excluir médico:\n${error.message}`);
    }
}
