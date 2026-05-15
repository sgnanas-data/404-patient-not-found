/* ═══════════════════════════════════════════════════════════════
   404 Patient Not Found - Dashboard Application
   ═══════════════════════════════════════════════════════════════ */

let allPatients = [];
let currentPatientId = null;
let charts = {};

const CHART_COLORS = [
    '#0d9488', '#0ea5e9', '#f59e0b', '#f97316',
    '#6366f1', '#10b981', '#ec4899', '#a78bfa'
];

const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            labels: {
                color: '#8b949e',
                font: { family: "'Satoshi', sans-serif", size: 11 },
                padding: 12,
                usePointStyle: true,
                pointStyleWidth: 8,
            }
        }
    }
};

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    loadPatients();
    loadAlerts();

    document.getElementById('patientSearch').addEventListener('input', filterSidebarPatients);
    document.getElementById('patientTableSearch').addEventListener('input', filterTablePatients);
});

// ─── Navigation ───
function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const viewEl = document.getElementById('view-' + viewName);
    if (viewEl) viewEl.classList.add('active');

    const navEl = document.querySelector(`[data-view="${viewName}"]`);
    if (navEl) navEl.classList.add('active');

    const titles = {
        dashboard: ['Dashboard', 'Clinical overview across all patients'],
        patients: ['Patient Registry', 'Complete patient list with clinical data'],
        hl7: ['HL7 v2 Messages', 'FHIR R4 to HL7 v2.4 ADT message generation'],
        ai: ['AI Clinical Summaries', 'Claude-powered clinical decision support'],
        'patient-detail': ['Patient Detail', ''],
    };

    const [title, subtitle] = titles[viewName] || ['', ''];
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageSubtitle').textContent = subtitle;

    if (viewName === 'hl7') populatePatientSelectList('hl7PatientList', onHL7PatientSelect);
    if (viewName === 'ai') populatePatientSelectList('aiPatientList', onAIPatientSelect);
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('collapsed');
}

// ─── Dashboard ───
async function loadDashboard() {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();
        renderStatCards(stats.totals);
        renderTopBarStats(stats.totals);
        renderConditionsChart(stats.top_conditions);
        renderGenderChart(stats.gender_distribution);
        renderAgeChart(stats.age_distribution);
        renderMedicationsChart(stats.top_medications);
        renderEncounterChart(stats.encounters_by_class);
        renderConditionStatusGrid(stats.conditions_by_status);
    } catch (e) {
        console.error('Failed to load dashboard:', e);
    }
}

function renderTopBarStats(totals) {
    document.getElementById('tbPatients').textContent = totals.patients.toLocaleString();
    document.getElementById('tbActiveDx').textContent = totals.active_conditions.toLocaleString();
    document.getElementById('tbActiveRx').textContent = totals.active_medications.toLocaleString();
    document.getElementById('tbEncounters').textContent = totals.encounters.toLocaleString();
}

function renderStatCards(totals) {
    const cards = [
        { label: 'Total Patients', value: totals.patients, icon: 'patients', color: 'teal', dataColor: 'teal', bar: '#0d9488' },
        { label: 'Active Conditions', value: totals.active_conditions, icon: 'conditions', color: 'sky', dataColor: 'sky', bar: '#0ea5e9' },
        { label: 'Active Medications', value: totals.active_medications, icon: 'meds', color: 'amber', dataColor: 'amber', bar: '#f59e0b' },
        { label: 'Total Observations', value: totals.observations, icon: 'obs', color: 'orange', dataColor: 'orange', bar: '#f97316' },
    ];

    const icons = {
        patients: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
        conditions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
        meds: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>',
        obs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    };

    document.getElementById('statCards').innerHTML = cards.map(c => `
        <div class="stat-card" data-color="${c.dataColor}">
            <div class="stat-card-icon ${c.color}">${icons[c.icon]}</div>
            <div class="stat-card-value">${c.value.toLocaleString()}</div>
            <div class="stat-card-label">${c.label}</div>
            <div class="stat-card-bar" style="background: linear-gradient(90deg, ${c.bar}, transparent)"></div>
        </div>
    `).join('');
}

function renderConditionsChart(data) {
    const ctx = document.getElementById('conditionsChart');
    if (charts.conditions) charts.conditions.destroy();
    const conditionPalette = [
        '#0d9488', '#0ea5e9', '#f59e0b', '#0891b2',
        '#0e7490', '#155e75', '#164e63', '#06b6d4',
        '#22d3ee', '#67e8f9'
    ];

    charts.conditions = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => truncate(d.name, 30)),
            datasets: [{
                data: data.map(d => d.count),
                backgroundColor: data.map((_, i) => conditionPalette[i % conditionPalette.length]),
                borderColor: data.map((_, i) => conditionPalette[i % conditionPalette.length]),
                borderWidth: 1,
                borderRadius: 4,
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            indexAxis: 'y',
            layout: { padding: { left: 8, right: 8 } },
            plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
            scales: {
                x: { max: 160, grid: { color: 'rgba(22,27,34,0.8)' }, ticks: { color: '#8b949e', font: { size: 11 }, maxTicksLimit: 4 } },
                y: { grid: { display: false }, ticks: { color: '#e6edf3', font: { size: 10 }, padding: 4 } },
            }
        }
    });
}

function renderGenderChart(data) {
    const ctx = document.getElementById('genderChart');
    if (charts.gender) charts.gender.destroy();
    charts.gender = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(d => d.gender.charAt(0).toUpperCase() + d.gender.slice(1)),
            datasets: [{
                data: data.map(d => d.count),
                backgroundColor: ['#0d9488', '#0ea5e9', '#f59e0b'],
                borderColor: '#0d1117',
                borderWidth: 3,
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            cutout: '60%',
            layout: { padding: 0 },
            plugins: {
                ...CHART_DEFAULTS.plugins,
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#8b949e',
                        font: { family: "'Satoshi', sans-serif", size: 10 },
                        padding: 6,
                        boxWidth: 8,
                        boxHeight: 8,
                        usePointStyle: true,
                        pointStyleWidth: 6,
                    }
                }
            }
        }
    });
}

function renderAgeChart(data) {
    const ctx = document.getElementById('ageChart');
    if (charts.age) charts.age.destroy();
    charts.age = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.group),
            datasets: [{
                data: data.map(d => d.count),
                backgroundColor: '#0ea5e9',
                borderColor: '#0ea5e9',
                borderWidth: 1,
                borderRadius: 4,
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            layout: { padding: { bottom: 2, right: 4 } },
            plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#8b949e', font: { size: 10 }, autoSkip: false, maxRotation: 0, padding: 2 } },
                y: { grid: { color: 'rgba(22,27,34,0.8)' }, ticks: { color: '#8b949e', font: { size: 10 }, stepSize: 5 } },
            }
        }
    });
}

function renderMedicationsChart(data) {
    const ctx = document.getElementById('medicationsChart');
    if (charts.meds) charts.meds.destroy();
    charts.meds = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => truncate(d.name, 30)),
            datasets: [{
                data: data.map(d => d.count),
                backgroundColor: '#0d9488',
                borderColor: '#0d9488',
                borderWidth: 1,
                borderRadius: 4,
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            indexAxis: 'y',
            layout: { padding: { right: 8 } },
            plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
            scales: {
                x: { max: 500, grid: { color: 'rgba(22,27,34,0.8)' }, ticks: { color: '#8b949e', font: { size: 11 }, maxTicksLimit: 4 } },
                y: { grid: { display: false }, ticks: { color: '#e6edf3', font: { size: 10 } } },
            }
        }
    });
}

function renderEncounterChart(data) {
    const ctx = document.getElementById('encounterChart');
    if (charts.encounter) charts.encounter.destroy();

    const classLabels = {
        AMB: 'Ambulatory', EMER: 'Emergency', IMP: 'Inpatient',
        wellness: 'Wellness', urgentcare: 'Urgent Care', outpatient: 'Outpatient',
        inpatient: 'Inpatient', ambulatory: 'Ambulatory', emergency: 'Emergency',
    };

    const encounterColors = {
        AMB: '#0d9488', ambulatory: '#0d9488',
        EMER: '#f97316', emergency: '#f97316',
        IMP: '#0ea5e9', inpatient: '#0ea5e9',
        wellness: '#0d9488', outpatient: '#0d9488',
        urgentcare: '#f97316', HH: '#f59e0b', VR: '#6366f1',
    };

    charts.encounter = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(d => classLabels[d.class] || d.class),
            datasets: [{
                data: data.map(d => d.count),
                backgroundColor: data.map(d => encounterColors[d.class] || '#16a34a'),
                borderColor: '#0d1117',
                borderWidth: 3,
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            cutout: '55%',
            layout: { padding: 0 },
            plugins: {
                ...CHART_DEFAULTS.plugins,
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#8b949e',
                        font: { family: "'Satoshi', sans-serif", size: 12 },
                        padding: 14,
                        boxWidth: 10,
                        boxHeight: 10,
                        usePointStyle: true,
                        pointStyleWidth: 8,
                    }
                }
            }
        }
    });
}

function renderConditionStatusGrid(data) {
    const grid = document.getElementById('conditionStatusGrid');
    const statusClass = { active: 'status-active', resolved: 'status-resolved', inactive: 'status-inactive' };

    grid.innerHTML = data.map(d => `
        <div class="status-cell ${statusClass[d.status] || 'status-inactive'}">
            <span class="status-cell-name">${d.status.charAt(0).toUpperCase() + d.status.slice(1)}</span>
            <span class="status-cell-count">${d.count.toLocaleString()}</span>
        </div>
    `).join('');
}

// ─── Alerts ───
async function loadAlerts() {
    try {
        const res = await fetch('/api/alerts');
        const alerts = await res.json();
        renderAlertsPanel(alerts, 'alertsPanel');
        const badge = document.getElementById('alertCount');
        if (badge) {
            badge.textContent = alerts.length;
            badge.style.display = alerts.length > 0 ? '' : 'none';
        }
    } catch (e) {
        console.error('Failed to load alerts:', e);
        document.getElementById('alertsPanel').innerHTML = '<div class="empty-state">Failed to load alerts</div>';
    }
}

function renderAlertsPanel(alerts, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (alerts.length === 0) {
        container.innerHTML = '<div class="empty-state">No active alerts</div>';
        return;
    }
    container.innerHTML = alerts.map(a => `
        <div class="alert-item alert-${a.type}" onclick="openPatientDetail('${a.patient_id}')">
            <div class="alert-icon">${a.type === 'critical' ? '!!' : a.type === 'warning' ? '!' : 'i'}</div>
            <div class="alert-body">
                <div class="alert-header-row">
                    <span class="alert-patient">${escapeHtml(a.patient_name)}</span>
                    <span class="alert-category">${escapeHtml(a.category)}</span>
                </div>
                <div class="alert-message">${escapeHtml(a.message)}</div>
            </div>
        </div>
    `).join('');
}

// ─── Vital Trends ───
async function loadVitalTrends(patientId) {
    try {
        const res = await fetch(`/api/vitals/${patientId}`);
        const data = await res.json();
        return data;
    } catch (e) {
        console.error('Failed to load vitals:', e);
        return {};
    }
}

function renderVitalCharts(vitalsData, containerEl) {
    if (!containerEl) return;
    const entries = Object.entries(vitalsData);
    if (entries.length === 0) {
        containerEl.innerHTML = '<div class="empty-state">No trend data available</div>';
        return;
    }

    const colors = {
        'Heart Rate': '#ef4444',
        'Systolic BP': '#f97316',
        'Diastolic BP': '#f59e0b',
        'BMI': '#0ea5e9',
        'Glucose': '#a78bfa',
        'O2 Saturation': '#0d9488',
    };

    containerEl.innerHTML = entries.map(([label]) =>
        `<div class="vital-trend-chart"><canvas id="vitalChart_${label.replace(/\s/g, '_')}"></canvas><div class="vital-trend-label">${label}</div></div>`
    ).join('');

    for (const [label, points] of entries) {
        const canvasId = `vitalChart_${label.replace(/\s/g, '_')}`;
        const ctx = document.getElementById(canvasId);
        if (!ctx || points.length === 0) continue;

        const last20 = points.slice(-20);
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: last20.map(p => p.date),
                datasets: [{
                    label: label,
                    data: last20.map(p => p.value),
                    borderColor: colors[label] || '#0d9488',
                    backgroundColor: (colors[label] || '#0d9488') + '18',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                }]
            },
            options: {
                ...CHART_DEFAULTS,
                plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                scales: {
                    x: { display: true, grid: { display: false }, ticks: { color: '#484f58', font: { size: 9 }, maxTicksLimit: 5, maxRotation: 0 } },
                    y: { grid: { color: 'rgba(22,27,34,0.8)' }, ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 4 } }
                }
            }
        });
    }
}

// ─── Patients ───
async function loadPatients() {
    try {
        const res = await fetch('/api/patients');
        allPatients = await res.json();
        renderPatientsTable(allPatients);
        renderSidebarPatients();
        populatePatientSelectList('hl7PatientList', onHL7PatientSelect);
        populatePatientSelectList('aiPatientList', onAIPatientSelect);
    } catch (e) {
        console.error('Failed to load patients:', e);
    }
}

function renderPatientsTable(patients) {
    const tbody = document.getElementById('patientsTableBody');
    tbody.innerHTML = patients.map(p => `
        <tr onclick="openPatientDetail('${p.id}')">
            <td>
                <div style="display:flex;align-items:center;gap:10px">
                    <div class="patient-avatar ${p.gender === 'male' ? 'avatar-m' : 'avatar-f'}" style="width:30px;height:30px;font-size:11px">
                        ${getInitials(p.name)}
                    </div>
                    <span style="font-weight:500">${escapeHtml(p.name)}</span>
                </div>
            </td>
            <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)">${p.birthdate}</td>
            <td><span style="text-transform:capitalize">${p.gender}</span></td>
            <td>${escapeHtml(p.city)}, ${escapeHtml(p.state)}</td>
            <td><span class="count-badge count-dx">${p.condition_count}</span></td>
            <td><span class="count-badge count-rx">${p.medication_count}</span></td>
            <td><span class="count-badge count-enc">${p.encounter_count}</span></td>
            <td><span class="risk-badge risk-${(p.risk || 'Low').toLowerCase()}">${p.risk || 'Low'}</span></td>
            <td><button class="btn-sm" onclick="event.stopPropagation();openPatientDetail('${p.id}')">View</button></td>
        </tr>
    `).join('');
}

function getRecentPatientIds() {
    try { return JSON.parse(localStorage.getItem('recentPatients') || '[]'); } catch { return []; }
}

function trackRecentPatient(patientId) {
    let ids = getRecentPatientIds().filter(id => id !== patientId);
    ids.unshift(patientId);
    ids = ids.slice(0, 10);
    localStorage.setItem('recentPatients', JSON.stringify(ids));
    renderSidebarPatients();
}

function renderSidebarPatients() {
    const container = document.getElementById('recentPatientsList');
    const ids = getRecentPatientIds();
    const patients = ids.map(id => allPatients.find(p => p.id === id)).filter(Boolean);
    if (patients.length === 0) {
        container.innerHTML = '<div style="padding:8px 18px;font-size:11px;color:var(--text-muted)">No recently viewed patients</div>';
        return;
    }
    container.innerHTML = patients.map(p => `
        <div class="recent-patient" onclick="openPatientDetail('${p.id}')">
            <div class="patient-avatar ${p.gender === 'male' ? 'avatar-m' : 'avatar-f'}">
                ${getInitials(p.name)}
            </div>
            <div class="patient-info-mini">
                <div class="patient-name-mini">${escapeHtml(p.name)}</div>
                <div class="patient-meta-mini">${p.gender} &middot; ${p.city}</div>
            </div>
            <span class="risk-badge risk-${(p.risk || 'Low').toLowerCase()}">${p.risk || 'Low'}</span>
        </div>
    `).join('');
}

function filterSidebarPatients() {
    const q = document.getElementById('patientSearch').value.toLowerCase();
    if (!q) { renderSidebarPatients(); return; }
    const ids = getRecentPatientIds();
    const patients = ids.map(id => allPatients.find(p => p.id === id)).filter(Boolean);
    const filtered = patients.filter(p => p.name.toLowerCase().includes(q) || p.city.toLowerCase().includes(q));
    const container = document.getElementById('recentPatientsList');
    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding:8px 18px;font-size:11px;color:var(--text-muted)">No matches</div>';
        return;
    }
    container.innerHTML = filtered.map(p => `
        <div class="recent-patient" onclick="openPatientDetail('${p.id}')">
            <div class="patient-avatar ${p.gender === 'male' ? 'avatar-m' : 'avatar-f'}">
                ${getInitials(p.name)}
            </div>
            <div class="patient-info-mini">
                <div class="patient-name-mini">${escapeHtml(p.name)}</div>
                <div class="patient-meta-mini">${p.gender} &middot; ${p.city}</div>
            </div>
            <span class="risk-badge risk-${(p.risk || 'Low').toLowerCase()}">${p.risk || 'Low'}</span>
        </div>
    `).join('');
}

function filterTablePatients() {
    const q = document.getElementById('patientTableSearch').value.toLowerCase();
    const filtered = allPatients.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.gender.toLowerCase().includes(q)
    );
    renderPatientsTable(filtered);
}

// ─── Patient Detail ───
async function openPatientDetail(patientId) {
    currentPatientId = patientId;
    trackRecentPatient(patientId);
    showView('patient-detail');

    const detailEl = document.getElementById('view-patient-detail');
    detailEl.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Loading patient data...</div>';
    detailEl.classList.add('active');

    try {
        const res = await fetch(`/api/patient/${patientId}`);
        const data = await res.json();
        renderPatientDetail(data);
    } catch (e) {
        detailEl.innerHTML = '<div class="empty-state">Failed to load patient data</div>';
    }
}

async function renderPatientDetail(data) {
    const { patient, conditions, medications, encounters, observations } = data;
    const container = document.getElementById('view-patient-detail');

    const age = calculateAge(patient.birthdate);
    const activeConds = conditions.filter(c => c.status === 'active');
    const activeMeds = medications.filter(m => m.status === 'active');
    const recentEnc = encounters.slice(0, 10);

    const patientData = allPatients.find(p => p.id === patient.id);
    const risk = patientData ? patientData.risk || 'Low' : 'Low';

    const vitalTypes = ['Body Height', 'Body Weight', 'Body Mass Index', 'Systolic Blood Pressure',
                        'Diastolic Blood Pressure', 'Heart rate', 'Respiratory rate', 'Body Temperature'];
    const recentVitals = {};
    for (const obs of observations) {
        if (vitalTypes.includes(obs.type) && !recentVitals[obs.type]) {
            recentVitals[obs.type] = obs;
        }
    }

    const timelineEvents = buildTimeline(conditions, medications, encounters);

    document.getElementById('pageTitle').textContent = patient.name;
    document.getElementById('pageSubtitle').textContent = `${patient.gender} · ${age} years · ${patient.city}, ${patient.state}`;

    container.innerHTML = `
        <div class="detail-header">
            <div class="detail-avatar ${patient.gender === 'male' ? 'avatar-m' : 'avatar-f'}">
                ${getInitials(patient.name)}
            </div>
            <div class="detail-info">
                <h2>${escapeHtml(patient.name)} <span class="risk-badge risk-${risk.toLowerCase()}">${risk} Risk</span></h2>
                <div class="detail-meta">
                    <span>DOB: ${patient.birthdate} (${age}y)</span>
                    <span style="text-transform:capitalize">${patient.gender}</span>
                    <span>${escapeHtml(patient.city)}, ${escapeHtml(patient.state)}</span>
                    <span>Race: ${escapeHtml(patient.race)}</span>
                    <span>${patient.phone || 'No phone'}</span>
                </div>
            </div>
        </div>

        <div class="detail-grid">
            <div class="detail-left">
                <div class="card">
                    <div class="card-header">
                        <h3>Clinical Timeline</h3>
                        <span class="card-badge">${timelineEvents.length} events</span>
                    </div>
                    <div class="clinical-timeline" id="clinicalTimeline">
                        ${timelineEvents.length === 0 ? '<div class="empty-state">No timeline data</div>' :
                          timelineEvents.slice(0, 20).map(ev => `
                            <div class="tl-item">
                                <div class="tl-dot tl-${ev.category}"></div>
                                <div class="tl-content">
                                    <div class="tl-date">${formatDate(ev.date)}</div>
                                    <div class="tl-title">${escapeHtml(ev.title)}</div>
                                    <div class="tl-detail">${escapeHtml(ev.detail)}</div>
                                </div>
                                <span class="tl-tag tl-tag-${ev.category}">${ev.category}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>Active Conditions</h3>
                        <span class="card-badge badge-red">${activeConds.length}</span>
                    </div>
                    <div class="condition-list">
                        ${activeConds.length === 0 ? '<div class="empty-state">No active conditions</div>' :
                          activeConds.map(c => `
                            <div class="condition-item">
                                <div class="condition-dot dot-active"></div>
                                <div>
                                    <div class="condition-name">${escapeHtml(c.description)}</div>
                                    <div class="condition-code">${c.icd10_code ? 'ICD-10: ' + c.icd10_code : 'SNOMED: ' + c.snomed_code} · Onset: ${formatDate(c.onset_date)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>Current Medications</h3>
                        <span class="card-badge badge-blue">${activeMeds.length}</span>
                    </div>
                    <div class="medication-list">
                        ${activeMeds.length === 0 ? '<div class="empty-state">No active medications</div>' :
                          activeMeds.map(m => `
                            <div class="med-item">
                                <div class="med-name">${escapeHtml(m.name)}</div>
                                <div class="med-meta">
                                    <span class="med-status med-status-active">active</span>
                                    ${m.dosage ? ' · ' + escapeHtml(m.dosage) : ''}
                                    · Since ${formatDate(m.date)}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>Recent Encounters</h3>
                        <span class="card-badge">${encounters.length} total</span>
                    </div>
                    <div class="encounter-timeline">
                        ${recentEnc.map(e => `
                            <div class="enc-item">
                                <div class="enc-date">${formatDate(e.start_date)}</div>
                                <div>
                                    <div class="enc-type">${escapeHtml(e.type)}</div>
                                    <div class="enc-reason">${e.reason ? escapeHtml(e.reason) : 'No reason recorded'} · ${e.provider ? escapeHtml(e.provider) : ''}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="detail-right">
                <div class="card">
                    <div class="card-header"><h3>Recent Vitals & Labs</h3></div>
                    <div class="vitals-grid">
                        ${Object.entries(recentVitals).map(([type, obs]) => `
                            <div class="vital-card">
                                <div class="vital-label">${shortVitalName(type)}</div>
                                <div class="vital-value">${obs.value}<span class="vital-unit">${obs.unit}</span></div>
                                <div class="vital-date">${formatDate(obs.date)}</div>
                            </div>
                        `).join('')}
                        ${Object.keys(recentVitals).length === 0 ? '<div class="empty-state" style="grid-column:1/-1">No vitals recorded</div>' : ''}
                    </div>
                </div>

                <div class="card">
                    <div class="card-header"><h3>Vital Trends</h3></div>
                    <div id="vitalTrendsContainer" class="vital-trends-container">
                        <div class="loading-state"><div class="loading-spinner"></div>Loading trends...</div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header"><h3>Patient Alerts</h3></div>
                    <div id="patientAlertsContainer">
                        <div class="loading-state"><div class="loading-spinner"></div>Loading alerts...</div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header"><h3>Interoperability</h3></div>
                    <div class="quick-actions">
                        <button class="btn btn-teal" onclick="viewHL7ForCurrent()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
                            View HL7 v2 ADT Message
                        </button>
                        <button class="btn btn-purple" onclick="viewAIForCurrent()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="14" r="4"/><path d="M21 17.5a9 9 0 0 0-18 0"/></svg>
                            Generate AI Clinical Summary
                        </button>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header"><h3>Patient Summary</h3></div>
                    <div style="font-size:13px;color:var(--text-secondary);line-height:1.6">
                        <div style="margin-bottom:8px"><strong style="color:var(--text-primary)">Total Conditions:</strong> ${conditions.length} (${activeConds.length} active)</div>
                        <div style="margin-bottom:8px"><strong style="color:var(--text-primary)">Total Medications:</strong> ${medications.length} (${activeMeds.length} active)</div>
                        <div style="margin-bottom:8px"><strong style="color:var(--text-primary)">Total Encounters:</strong> ${encounters.length}</div>
                        <div><strong style="color:var(--text-primary)">Total Observations:</strong> ${observations.length}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const vitalsData = await loadVitalTrends(patient.id);
    renderVitalCharts(vitalsData, document.getElementById('vitalTrendsContainer'));

    try {
        const alertsRes = await fetch('/api/alerts');
        const allAlerts = await alertsRes.json();
        const patientAlerts = allAlerts.filter(a => a.patient_id === patient.id);
        renderAlertsPanel(patientAlerts.length > 0 ? patientAlerts : [], 'patientAlertsContainer');
        if (patientAlerts.length === 0) {
            document.getElementById('patientAlertsContainer').innerHTML = '<div class="empty-state">No active alerts for this patient</div>';
        }
    } catch (e) {
        document.getElementById('patientAlertsContainer').innerHTML = '<div class="empty-state">Failed to load alerts</div>';
    }
}

function buildTimeline(conditions, medications, encounters) {
    const events = [];
    for (const c of conditions) {
        events.push({
            date: c.onset_date || '',
            category: 'diagnosis',
            title: c.description,
            detail: `${c.status} - ${c.icd10_code || c.snomed_code || 'No code'}`,
        });
    }
    for (const m of medications) {
        events.push({
            date: m.date || '',
            category: 'medication',
            title: m.name,
            detail: `${m.status} ${m.dosage ? '- ' + m.dosage : ''}`,
        });
    }
    for (const e of encounters) {
        events.push({
            date: e.start_date || '',
            category: 'encounter',
            title: e.type,
            detail: e.reason || 'No reason recorded',
        });
    }
    events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return events;
}

// ─── HL7 ───
function populatePatientSelectList(containerId, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = allPatients.map(p => `
        <div class="ps-item" data-id="${p.id}" onclick="(${onSelect.name})('${p.id}', this)">
            <div class="patient-avatar ${p.gender === 'male' ? 'avatar-m' : 'avatar-f'}" style="width:28px;height:28px;font-size:10px">
                ${getInitials(p.name)}
            </div>
            <span class="ps-name">${escapeHtml(p.name)}</span>
            <span class="ps-meta">${p.gender} · ${p.city}</span>
        </div>
    `).join('');
}

async function onHL7PatientSelect(patientId, el) {
    document.querySelectorAll('#hl7PatientList .ps-item').forEach(i => i.classList.remove('selected'));
    el.classList.add('selected');

    const output = document.getElementById('hl7Output');
    output.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Generating HL7 v2 message...</div>';

    try {
        const res = await fetch(`/api/hl7/${patientId}`);
        const data = await res.json();

        document.getElementById('hl7Badge').style.display = '';

        output.innerHTML = data.segments.map(seg => {
            const parts = seg.split('|');
            const segName = parts[0];
            const rest = parts.slice(1).map(f => `<span class="hl7-pipe">|</span><span class="hl7-field">${escapeHtml(f)}</span>`).join('');
            return `<div class="hl7-segment"><span class="hl7-seg-name">${segName}</span>${rest}</div>`;
        }).join('');

        const info = document.getElementById('hl7SegmentInfo');
        info.style.display = '';
        info.innerHTML = `
            <strong>Message Details:</strong> ${data.message_type} (HL7 v${data.hl7_version})<br>
            <strong>Patient:</strong> ${escapeHtml(data.patient_name)}<br>
            <strong>Segments:</strong> ${data.segment_count} (MSH, EVN, PID, PV1${data.segment_count > 4 ? ', DG1×' + (data.segment_count - 4) : ''})
        `;
    } catch (e) {
        output.innerHTML = '<div class="empty-state">Failed to generate HL7 message</div>';
    }
}

function viewHL7ForCurrent() {
    if (!currentPatientId) return;
    showView('hl7');
    setTimeout(() => {
        const item = document.querySelector(`#hl7PatientList .ps-item[data-id="${currentPatientId}"]`);
        if (item) {
            item.scrollIntoView({ block: 'center' });
            onHL7PatientSelect(currentPatientId, item);
        }
    }, 100);
}

// ─── AI Summary ───
async function onAIPatientSelect(patientId, el) {
    document.querySelectorAll('#aiPatientList .ps-item').forEach(i => i.classList.remove('selected'));
    el.classList.add('selected');

    const output = document.getElementById('aiOutput');
    output.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Generating AI clinical summary...<br><span style="font-size:11px;color:var(--text-muted)">This may take a few seconds</span></div>';

    try {
        const res = await fetch(`/api/summary/${patientId}`);
        const data = await res.json();

        document.getElementById('aiSummaryTitle').textContent = `Clinical Summary - ${data.patient_name}`;
        const modelBadge = document.getElementById('aiModel');
        modelBadge.style.display = '';
        modelBadge.textContent = data.model;

        output.innerHTML = markdownToHtml(data.summary);
    } catch (e) {
        output.innerHTML = '<div class="empty-state">Failed to generate AI summary. Check ANTHROPIC_API_KEY.</div>';
    }
}

function viewAIForCurrent() {
    if (!currentPatientId) return;
    showView('ai');
    setTimeout(() => {
        const item = document.querySelector(`#aiPatientList .ps-item[data-id="${currentPatientId}"]`);
        if (item) {
            item.scrollIntoView({ block: 'center' });
            onAIPatientSelect(currentPatientId, item);
        }
    }, 100);
}

// ─── Utilities ───
function getInitials(name) {
    const parts = name.split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

function calculateAge(birthdate) {
    if (!birthdate) return '?';
    const today = new Date();
    const birth = new Date(birthdate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return dateStr.substring(0, 10);
}

function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
}

function shortVitalName(name) {
    const map = {
        'Body Height': 'Height',
        'Body Weight': 'Weight',
        'Body Mass Index': 'BMI',
        'Systolic Blood Pressure': 'Systolic BP',
        'Diastolic Blood Pressure': 'Diastolic BP',
        'Heart rate': 'Heart Rate',
        'Respiratory rate': 'Resp. Rate',
        'Body Temperature': 'Temperature',
    };
    return map[name] || name;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function markdownToHtml(md) {
    if (!md) return '';
    let html = md
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        .replace(/---/g, '<hr>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');

    html = html.replace(/((?:<li>.*?<\/li>(?:<br>)*)+)/g, function(match) {
        return '<ul>' + match.replace(/(<\/li>)(<br>)+/g, '$1').replace(/(<br>)+$/g, '') + '</ul>';
    });
    html = html.replace(/^(<br>)+/, '');
    html = html.replace(/(<\/h[123]>)(<br>)+/g, '$1');
    html = html.replace(/(<br>)+(<h[123]>)/g, '$2');

    return html;
}
