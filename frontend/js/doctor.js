requireRole('doctor');

let assignedPatientsCache = [];
let pharmacistsCache = [];
let populationChartInstance = null;
let patientDoughnutInstance = null;
let correlationChartInstance = null;
let currentSelectedPatient = null;
let safetyCheckTimeout = null;

async function init() {
  const user = API.currentUser();
  if (user && user.name) {
    document.getElementById('docTitle').textContent = `🩺 MediCare — Dr. ${user.name}`;
  }

  // Set default due date in prescription form to tomorrow
  const tmrw = new Date();
  tmrw.setDate(tmrw.getDate() + 1);
  const dueInput = document.getElementById('reqDueDate');
  if (dueInput) dueInput.value = tmrw.toISOString().split('T')[0];

  if (window.NotifEngine) {
    NotifEngine.updateUI();
  }

  await loadAssignedPatients();
  await loadPharmacists();
  populateDropdowns();
  await loadBehindSchedule();
  await loadAlerts();
  await loadRequests();
  await loadPatientNotes();
  await loadAnalyticsCharts();
}

async function loadAssignedPatients() {
  assignedPatientsCache = await API.get('/doctor/patients');
  renderPatientsTable();
}

async function loadPharmacists() {
  pharmacistsCache = await API.get('/doctor/pharmacists');
}

function populateDropdowns() {
  const notifSelect = document.getElementById('notifPatient');
  const reqSelect = document.getElementById('reqPatient');
  const pharmSelect = document.getElementById('reqPharmacist');

  if (notifSelect && reqSelect) {
    const patOptions = assignedPatientsCache
      .map((p) => `<option value="${p.patientId}">${p.name} (${p.email})</option>`)
      .join('');

    notifSelect.innerHTML = `<option value="">-- Select Patient --</option>` + patOptions;
    reqSelect.innerHTML = `<option value="">-- Select Patient --</option>` + patOptions;
  }

  if (pharmSelect) {
    const pharmOptions = pharmacistsCache
      .map((ph) => `<option value="${ph.pharmacistId}">${ph.name} ${ph.licenseNo ? `[${ph.licenseNo}]` : ''}</option>`)
      .join('');

    pharmSelect.innerHTML = `<option value="">-- Select Pharmacist --</option>` + pharmOptions;
  }
}

function onReqPatientChange() {
  const patId = parseInt(document.getElementById('reqPatient').value, 10);
  const patient = assignedPatientsCache.find((p) => p.patientId === patId);
  const pharmSelect = document.getElementById('reqPharmacist');

  if (patient && patient.pharmacistId && pharmSelect) {
    pharmSelect.value = patient.pharmacistId;
  }

  checkClinicalSafety();
}

function onReqTypeChange() {
  const type = document.getElementById('reqType').value;
  const dosageInput = document.getElementById('reqDosage');
  const qtyInput = document.getElementById('reqQty');
  const slotSelect = document.getElementById('reqTimeSlot');
  const mealSelect = document.getElementById('reqMealTiming');

  if (type === 'vaccine') {
    dosageInput.placeholder = 'Dose info (e.g. Dose 1 / Booster)';
    qtyInput.style.display = 'none';
    if (slotSelect) slotSelect.style.display = 'none';
    if (mealSelect) mealSelect.style.display = 'none';
    document.getElementById('safetyAlertBox').style.display = 'none';
  } else {
    dosageInput.placeholder = 'Dosage (e.g. 500mg daily)';
    qtyInput.style.display = 'inline-block';
    if (slotSelect) slotSelect.style.display = 'inline-block';
    if (mealSelect) mealSelect.style.display = 'inline-block';
    checkClinicalSafety();
  }
}

// ─── 🛡️ REAL-TIME CLINICAL SAFETY CHECKER ──────────────────────────────────
function debounceSafetyCheck() {
  clearTimeout(safetyCheckTimeout);
  safetyCheckTimeout = setTimeout(checkClinicalSafety, 350);
}

async function checkClinicalSafety() {
  const patientId = document.getElementById('reqPatient')?.value;
  const drugName = document.getElementById('reqItemName')?.value;
  const reqType = document.getElementById('reqType')?.value;
  const alertBox = document.getElementById('safetyAlertBox');
  const alertList = document.getElementById('safetyAlertList');
  const chkOverride = document.getElementById('chkSafetyOverride');

  if (!alertBox || !alertList) return;

  if (reqType === 'vaccine' || !patientId || !drugName || drugName.trim().length < 3) {
    alertBox.style.display = 'none';
    return;
  }

  try {
    const res = await API.post('/doctor/check-safety', {
      patientId: parseInt(patientId, 10),
      medicineName: drugName.trim()
    });

    if (res.warnings && res.warnings.length > 0) {
      alertBox.style.display = 'block';
      if (chkOverride) chkOverride.checked = false;

      alertList.innerHTML = res.warnings.map(w => {
        const isCrit = w.level === 'critical';
        const levelBadge = isCrit
          ? '<span class="badge missed">CRITICAL CONTRAINDICATION</span>'
          : '<span class="badge" style="background:#FEF3C7; color:#92400E; font-weight:bold;">MAJOR INTERACTION</span>';

        return `
          <div class="safety-alert-item ${isCrit ? 'critical' : 'major'}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong style="color:#991B1B;">${w.title}</strong>
              ${levelBadge}
            </div>
            <div style="margin-bottom:4px;">${w.description}</div>
            <div style="font-size:12px; color:#1E40AF; background:#EFF6FF; padding:4px 8px; border-radius:4px;">
              <strong>Clinical Guidance:</strong> ${w.recommendation}
            </div>
          </div>
        `;
      }).join('');
    } else {
      alertBox.style.display = 'none';
    }
  } catch (err) {
    console.error('Safety check error:', err);
  }
}

function toggleSafetyOverride() {
  // Can be used for UI confirmation
}

function renderPatientsTable() {
  const tbody = document.getElementById('patientsBody');
  if (!tbody) return;

  if (assignedPatientsCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No assigned patients found.</td></tr>';
    return;
  }

  tbody.innerHTML = assignedPatientsCache
    .map(
      (p) => `<tr>
        <td><strong>${p.name}</strong></td>
        <td>${p.email}</td>
        <td>${p.pharmacistName ? `💊 ${p.pharmacistName}` : '<span style="color:#888;">Unassigned</span>'}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="secondary btn-sm" onclick="viewDetail(${p.patientId}, '${p.name.replace(/'/g, "\\'")}')">📊 Adherence & Vitals</button>
          <button class="primary btn-sm" onclick="prefillNotify(${p.patientId})">💬 Notify</button>
          <button class="secondary btn-sm" style="background:var(--accent-blue);" onclick="prefillRequest(${p.patientId})">💊 Prescribe</button>
        </td>
      </tr>`
    )
    .join('');
}

function prefillNotify(patientId) {
  const select = document.getElementById('notifPatient');
  if (select) {
    select.value = patientId;
    document.getElementById('notifMessage').focus();
    select.scrollIntoView({ behavior: 'smooth' });
  }
}

function prefillRequest(patientId) {
  const select = document.getElementById('reqPatient');
  if (select) {
    select.value = patientId;
    onReqPatientChange();
    document.getElementById('reqItemName').focus();
    select.scrollIntoView({ behavior: 'smooth' });
  }
}

async function sendPatientNotification(e) {
  e.preventDefault();
  const patientId = document.getElementById('notifPatient').value;
  const message = document.getElementById('notifMessage').value;
  const type = document.getElementById('notifType').value;
  const statusEl = document.getElementById('notifSentStatus');

  statusEl.style.display = 'none';

  try {
    const res = await API.post('/doctor/notify-patient', { patientId, message, type });
    statusEl.textContent = res.message || 'Notification sent to patient!';
    statusEl.style.color = '#0F6E56';
    statusEl.style.display = 'block';

    document.getElementById('notifMessage').value = '';
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 4000);
  } catch (err) {
    statusEl.textContent = err.message || 'Failed to send notification.';
    statusEl.style.color = '#993C1D';
    statusEl.style.display = 'block';
  }
}

async function sendPharmacistRequest(e) {
  e.preventDefault();
  const patientId = document.getElementById('reqPatient').value;
  const pharmacistId = document.getElementById('reqPharmacist').value;
  const requestType = document.getElementById('reqType').value;
  const itemName = document.getElementById('reqItemName').value;
  const dosage = document.getElementById('reqDosage').value;
  const quantity = document.getElementById('reqQty').value;
  const dueDate = document.getElementById('reqDueDate').value;
  const instructions = document.getElementById('reqInstructions').value;
  const timeSlot = document.getElementById('reqTimeSlot')?.value || 'morning';
  const mealTiming = document.getElementById('reqMealTiming')?.value || 'after_meal';
  const safetyOverride = document.getElementById('chkSafetyOverride')?.checked ? 1 : 0;
  const statusEl = document.getElementById('reqSentStatus');

  statusEl.style.display = 'none';

  try {
    const res = await API.post('/doctor/request-pharmacist', {
      patientId,
      pharmacistId,
      requestType,
      itemName,
      dosage,
      quantity,
      dueDate,
      instructions,
      timeSlot,
      mealTiming,
      safetyOverride
    });

    statusEl.textContent = res.message || 'Prescription sent to pharmacist!';
    statusEl.style.color = 'var(--accent-blue)';
    statusEl.style.display = 'block';

    document.getElementById('reqItemName').value = '';
    document.getElementById('reqDosage').value = '';
    document.getElementById('reqQty').value = '';
    document.getElementById('reqInstructions').value = '';
    document.getElementById('safetyAlertBox').style.display = 'none';

    await loadRequests();

    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 4000);
  } catch (err) {
    if (err.requiresOverride || err.status === 409) {
      document.getElementById('safetyAlertBox').style.display = 'block';
      alert('⚠️ Clinical Safety Alert: A drug interaction or allergy was detected! Please review the safety warnings and check the Override authorization box if clinically indicated.');
    } else {
      statusEl.textContent = err.message || 'Failed to send request.';
      statusEl.style.color = '#993C1D';
      statusEl.style.display = 'block';
    }
  }
}

async function loadRequests() {
  const requests = await API.get('/doctor/requests');
  const tbody = document.getElementById('requestsBody');
  if (!tbody) return;

  if (requests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:14px; color:#5F5E5A;">No prescription or vaccine requests sent yet.</td></tr>';
    return;
  }

  tbody.innerHTML = requests
    .map((r) => {
      const isCompleted = r.status === 'completed';
      const statusBadge = isCompleted
        ? '<span class="badge taken">Added to Patient ✅</span>'
        : '<span class="badge pending">Pending Pharmacist ⏳</span>';

      const typeBadge = r.requestType === 'vaccine'
        ? '<span class="badge" style="background:#E1DFFF; color:#211F7A;">Vaccine</span>'
        : '<span class="badge" style="background:#E6F4EA; color:#137333;">Medicine</span>';

      const details = [r.dosage, r.instructions].filter(Boolean).join(' — ') || '-';
      const slotInfo = r.timeSlot ? `<br><small style="color:#64748B;">[${r.timeSlot} • ${r.mealTiming || 'after_meal'}]</small>` : '';

      return `<tr>
        <td>${statusBadge}</td>
        <td>${typeBadge}</td>
        <td><strong>${r.itemName}</strong></td>
        <td>${r.patientName}</td>
        <td>${r.pharmacistName || 'Assigned Pharmacist'}</td>
        <td style="font-size:13px;">${details}${slotInfo}</td>
        <td>${fmtDate(r.dueDate)}</td>
        <td style="font-size:12px; color:#5F5E5A;">${new Date(r.timestamp).toLocaleDateString()}</td>
      </tr>`;
    })
    .join('');
}

async function loadPatientNotes() {
  const notes = await API.get('/doctor/patient-notes');
  const tbody = document.getElementById('patientNotesBody');
  const badge = document.getElementById('openNotesBadge');
  if (!tbody) return;

  const openCount = (notes || []).filter((n) => n.status === 'open').length;
  if (badge) {
    if (openCount > 0) {
      badge.textContent = `${openCount} Open Inquiry`;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  if (!notes || notes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:16px; color:var(--text-muted);">No patient notes or symptom reports yet.</td></tr>';
    return;
  }

  tbody.innerHTML = notes
    .map((n) => {
      const isOpen = n.status === 'open';
      const statusBadge = isOpen
        ? '<span class="badge unread">Open Inquiry</span>'
        : '<span class="badge taken">Replied ✓</span>';

      const severityBadge = n.severity === 'urgent'
        ? '<span class="badge missed" style="margin-left:4px;">⚠️ Urgent</span>'
        : '';

      const replyHtml = n.doctorReply
        ? `<span style="font-size:12px; color:var(--primary); font-weight:600;">"${n.doctorReply}"</span>`
        : '<span style="color:var(--text-dim); font-size:12px;">Awaiting response</span>';

      const actionHtml = isOpen
        ? `<button class="primary btn-sm" onclick="promptReply(${n.noteId}, '${n.patientName}', '${n.subject.replace(/'/g, "\\'")}')">Reply ✍️</button>`
        : '<span style="font-size:12px; color:var(--text-muted);">Closed</span>';

      return `<tr ${isOpen ? 'style="background:#FFF9F7;"' : ''}>
        <td>${statusBadge}</td>
        <td><strong>${n.patientName}</strong></td>
        <td><strong>${n.subject}</strong> ${severityBadge}</td>
        <td style="font-size:13px;">${n.message}</td>
        <td>${replyHtml}</td>
        <td>${actionHtml}</td>
      </tr>`;
    })
    .join('');
}

async function promptReply(noteId, patientName, subject) {
  const reply = prompt(`Reply to ${patientName} regarding "${subject}":`);
  if (!reply || !reply.trim()) return;

  try {
    const res = await API.put(`/doctor/patient-notes/${noteId}/reply`, { reply: reply.trim() });
    alert(res.message || 'Reply sent to patient!');
    await loadPatientNotes();
  } catch (err) {
    alert(err.message || 'Failed to send reply');
  }
}

// ─── 📊 POPULATION ANALYTICS & CHARTS ───────────────────────────────────────
async function loadAnalyticsCharts() {
  const analyticsData = await API.get('/doctor/patients/analytics');
  if (!analyticsData || analyticsData.length === 0) return;

  const ctxPop = document.getElementById('populationChart')?.getContext('2d');
  if (ctxPop && window.Chart) {
    if (populationChartInstance) populationChartInstance.destroy();

    const labels = analyticsData.map((d) => d.name);
    const adherenceRates = analyticsData.map((d) => d.adherenceRate);
    const backgroundColors = adherenceRates.map((r) => (r >= 80 ? '#0F6E56' : r >= 50 ? '#D97706' : '#DC2626'));

    populationChartInstance = new Chart(ctxPop, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Adherence Rate (%)',
          data: adherenceRates,
          backgroundColor: backgroundColors,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 100,
            ticks: { callback: (v) => v + '%' }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Adherence: ${ctx.parsed.y}%`
            }
          }
        }
      }
    });
  }

  // Load first patient into details as default
  if (analyticsData.length > 0 && !currentSelectedPatient) {
    viewDetail(analyticsData[0].patientId, analyticsData[0].name, false);
  }
}

function renderDoughnutChart(taken, late, missed, pending) {
  const ctx = document.getElementById('patientDoughnutChart')?.getContext('2d');
  if (!ctx || !window.Chart) return;

  if (patientDoughnutInstance) patientDoughnutInstance.destroy();

  patientDoughnutInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Taken On-Time', 'Taken Late', 'Missed', 'Pending'],
      datasets: [{
        data: [taken, late, missed, pending],
        backgroundColor: ['#0F6E56', '#F59E0B', '#DC2626', '#CBD5E1'],
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
      },
      cutout: '65%'
    }
  });
}

// ─── 📈 DUAL-AXIS CLINICAL CORRELATION GRAPH ────────────────────────────────
function renderCorrelationChart(vitalsList, adherenceRate) {
  const ctx = document.getElementById('vitalsCorrelationChart')?.getContext('2d');
  if (!ctx || !window.Chart) return;

  if (correlationChartInstance) correlationChartInstance.destroy();

  if (!vitalsList || vitalsList.length === 0) {
    // Empty state
    correlationChartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels: ['No vitals recorded'], datasets: [] },
      options: { responsive: true, maintainAspectRatio: false }
    });
    return;
  }

  const labels = vitalsList.map(v => {
    const d = new Date(v.recordedAt);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const systolicData = vitalsList.map(v => v.systolic);
  const diastolicData = vitalsList.map(v => v.diastolic);
  const bloodSugarData = vitalsList.map(v => v.bloodSugar);
  const adherencePoints = vitalsList.map(() => adherenceRate);

  correlationChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Systolic BP (mmHg)',
          data: systolicData,
          borderColor: '#DC2626',
          backgroundColor: '#DC2626',
          borderWidth: 2.5,
          tension: 0.3,
          yAxisID: 'yBiometrics',
          pointRadius: 4
        },
        {
          label: 'Diastolic BP (mmHg)',
          data: diastolicData,
          borderColor: '#EA580C',
          backgroundColor: '#EA580C',
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.3,
          yAxisID: 'yBiometrics',
          pointRadius: 3
        },
        {
          label: 'Blood Glucose (mg/dL)',
          data: bloodSugarData,
          borderColor: '#2563EB',
          backgroundColor: '#2563EB',
          borderWidth: 2,
          tension: 0.3,
          yAxisID: 'yBiometrics',
          pointRadius: 4
        },
        {
          label: 'Medication Adherence (%)',
          data: adherencePoints,
          borderColor: '#059669',
          backgroundColor: 'rgba(5, 150, 105, 0.1)',
          fill: true,
          borderWidth: 2,
          yAxisID: 'yAdherence',
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        yBiometrics: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'BP & Glucose (mmHg / mg/dL)', font: { size: 11, weight: 'bold' } },
          min: 40,
          max: 220
        },
        yAdherence: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Adherence Rate (%)', font: { size: 11, weight: 'bold' } },
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => v + '%' }
        }
      },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}${ctx.dataset.yAxisID === 'yAdherence' ? '%' : ''}`
          }
        }
      }
    }
  });
}

async function loadBehindSchedule() {
  const rows = await API.get('/doctor/patients/behind-schedule');
  const tbody = document.getElementById('behindBody');
  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:12px; color:var(--primary); font-weight:600;">No patients currently behind schedule. All on track! ✅</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(
      (p) => `<tr>
        <td><strong>${p.name}</strong></td>
        <td>${p.email}</td>
        <td>
          <button class="secondary btn-sm" onclick="viewDetail(${p.patientId}, '${p.name.replace(/'/g, "\\'")}')">View Audit</button>
          <button class="primary btn-sm" onclick="prefillNotify(${p.patientId})">💬 Notify</button>
        </td>
      </tr>`
    )
    .join('');
}

async function loadAlerts() {
  const alerts = await API.get('/doctor/alerts');
  const tbody = document.getElementById('alertsBody');
  if (!tbody) return;

  if (alerts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:12px; color:var(--text-muted);">No alerts received.</td></tr>';
    return;
  }

  tbody.innerHTML = alerts
    .slice(0, 10)
    .map(
      (a) => `<tr>
        <td><strong>${a.patientName}</strong></td>
        <td>${a.message}</td>
        <td style="font-size:12px; color:var(--text-muted);">${new Date(a.timestamp).toLocaleString()}</td>
      </tr>`
    )
    .join('');
}

async function viewDetail(patientId, name, scrollToCard = true) {
  const data = await API.get(`/doctor/patients/${patientId}/adherence`);
  const vitalsData = await API.get(`/doctor/patients/${patientId}/vitals`);
  const allergies = await API.get(`/doctor/patients/${patientId}/allergies`);

  currentSelectedPatient = { patientId, name, data, vitalsData, allergies };

  document.getElementById('detailCard').style.display = 'block';
  document.getElementById('detailName').textContent = name;
  const subEl = document.getElementById('detailSubtitle');
  if (subEl) subEl.textContent = 'Clinical Adherence & Biometrics Audit';
  document.getElementById('detailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('adherenceRate').textContent = data.adherenceRate + '%';
  document.getElementById('totalMeds').textContent = data.totalMedicines;
  document.getElementById('missedCount').textContent = (data.missedCount || 0) + (data.lateCount || 0);

  // Vitals stats
  const avgBPEl = document.getElementById('avgBP');
  const avgSugarEl = document.getElementById('avgGlucose');
  if (avgBPEl && vitalsData.summary) {
    avgBPEl.textContent = vitalsData.summary.avgSystolic && vitalsData.summary.avgDiastolic
      ? `${vitalsData.summary.avgSystolic}/${vitalsData.summary.avgDiastolic}`
      : 'N/A';
  }
  if (avgSugarEl && vitalsData.summary) {
    avgSugarEl.textContent = vitalsData.summary.avgBloodSugar != null
      ? `${vitalsData.summary.avgBloodSugar}`
      : 'N/A';
  }

  const titleEl = document.getElementById('patientDoughnutTitle');
  if (titleEl) titleEl.textContent = `${name}'s Adherence Breakdown`;

  renderDoughnutChart(
    data.takenCount || 0,
    data.lateCount || 0,
    data.missedCount || 0,
    data.pendingCount || 0
  );

  // Render Dual-Axis Correlation Chart
  renderCorrelationChart(vitalsData.vitals || [], data.adherenceRate || 100);

  // Render Allergies
  renderPatientAllergies(allergies || []);

  document.getElementById('historyBody').innerHTML = (data.medicines || [])
    .map((m) => `<tr>
      <td><strong>${m.name}</strong></td>
      <td>${m.dosage || '-'}</td>
      <td style="text-transform:capitalize;">${m.timeSlot || 'morning'} • ${(m.mealTiming || 'after_meal').replace(/_/g, ' ')}</td>
      <td>${fmtDate(m.dueDate)}</td>
      <td>${statusBadge(m.status)}</td>
    </tr>`)
    .join('') || '<tr><td colspan="5">No medicines prescribed for this patient.</td></tr>';

  if (scrollToCard) {
    document.getElementById('detailCard').scrollIntoView({ behavior: 'smooth' });
  }
}

function closeDetailCard() {
  document.getElementById('detailCard').style.display = 'none';
}

function renderPatientAllergies(list) {
  const container = document.getElementById('patientAllergiesList');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = '<span style="font-size:13px; color:#991B1B; font-style:italic;">No documented allergies for this patient.</span>';
    return;
  }

  container.innerHTML = list.map(a => `
    <span class="allergy-chip ${a.severity || 'moderate'}">
      🛡️ <strong>${a.allergen}</strong> (${a.severity.toUpperCase()}${a.reaction ? `: ${a.reaction}` : ''})
      <button class="btn-remove" onclick="removePatientAllergyFromDoctor(${a.allergyId})" title="Remove allergy">&times;</button>
    </span>
  `).join('');
}

async function addPatientAllergyFromDoctor(e) {
  e.preventDefault();
  if (!currentSelectedPatient) return;

  const allergen = document.getElementById('docAllergenInput').value;
  const severity = document.getElementById('docSeverityInput').value;
  const reaction = document.getElementById('docReactionInput').value;

  try {
    await API.post(`/doctor/patients/${currentSelectedPatient.patientId}/allergies`, {
      allergen,
      severity,
      reaction
    });

    document.getElementById('docAllergenInput').value = '';
    document.getElementById('docReactionInput').value = '';

    await viewDetail(currentSelectedPatient.patientId, currentSelectedPatient.name, false);
  } catch (err) {
    alert(err.message || 'Failed to add allergy');
  }
}

async function removePatientAllergyFromDoctor(allergyId) {
  if (!currentSelectedPatient) return;
  if (!confirm('Remove this allergy record from the patient profile?')) return;

  try {
    await API.delete(`/doctor/patients/${currentSelectedPatient.patientId}/allergies/${allergyId}`);
    await viewDetail(currentSelectedPatient.patientId, currentSelectedPatient.name, false);
  } catch (err) {
    alert(err.message || 'Failed to remove allergy');
  }
}

function exportClinicalReport() {
  if (!currentSelectedPatient) {
    alert('Please select a patient first from the list below to export their report.');
    return;
  }

  const p = currentSelectedPatient;
  const user = API.currentUser();
  const printMeta = document.getElementById('printMeta');
  const printDate = document.getElementById('printDate');

  if (printMeta) {
    printMeta.textContent = `Patient: ${p.name} | Supervising Doctor: Dr. ${user?.name || 'Practitioner'} | Date: ${new Date().toLocaleDateString()}`;
  }
  if (printDate) {
    printDate.textContent = new Date().toLocaleDateString();
  }

  window.print();
}

function exportAdherenceCSV() {
  if (!currentSelectedPatient) {
    alert('Please select a patient first from the list below to export data.');
    return;
  }

  const p = currentSelectedPatient;
  const meds = p.data.medicines || [];

  let csvContent = 'data:text/csv;charset=utf-8,';
  csvContent += 'Patient Name,Medicine Name,Dosage,Slot,Meal Timing,Quantity,Due Date,Expiry Date,Status,Taken At\n';

  meds.forEach((m) => {
    const row = [
      `"${p.name}"`,
      `"${m.name}"`,
      `"${m.dosage || ''}"`,
      `"${m.timeSlot || 'morning'}"`,
      `"${m.mealTiming || 'after_meal'}"`,
      m.quantity || '',
      m.dueDate || '',
      m.expiryDate || '',
      m.status,
      `"${m.takenAt || ''}"`
    ].join(',');
    csvContent += row + '\n';
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Adherence_Report_${p.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

init();
