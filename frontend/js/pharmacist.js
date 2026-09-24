requireRole('pharmacist');

let assignedPatients = [];
let pharmSafetyTimeout = null;

async function init() {
  const user = API.currentUser();
  if (user && user.name) {
    document.getElementById('pharmTitle').textContent = `💊 MediCare — ${user.name}`;
  }

  assignedPatients = await API.get('/pharmacist/patients');
  populatePatientSelects();
  await loadVaccineOptions();
  renderAssigned();
  await loadMedicines();
  await loadRequests();
  await loadRefills();
}

function populatePatientSelects() {
  const options = assignedPatients.map((p) => `<option value="${p.patientId}">${p.name} (${p.email})</option>`).join('');
  document.getElementById('medPatient').innerHTML = options;
  document.getElementById('vaxPatient').innerHTML = options;
}

async function loadVaccineOptions() {
  const list = await API.get('/pharmacist/vaccine-list');
  document.getElementById('vaxName').innerHTML = list
    .map((v) => `<option value="${v.vaccineName}">${v.vaccineName}</option>`)
    .join('');
}

function renderAssigned() {
  const tbody = document.getElementById('assignedBody');
  if (!tbody) return;

  if (assignedPatients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:12px; color:var(--text-muted);">No patients assigned to you yet.</td></tr>';
    return;
  }

  tbody.innerHTML = assignedPatients
    .map((p) => `<tr><td><strong>${p.name}</strong></td><td>${p.email}</td><td>${p.medicalHistory || '-'}</td></tr>`)
    .join('');
}

async function searchPatients(e) {
  e.preventDefault();
  const q = document.getElementById('searchQ').value;
  const results = await API.get(`/pharmacist/patients/search?q=${encodeURIComponent(q)}`);
  document.getElementById('searchResults').innerHTML = results
    .map((p) => `<tr><td><strong>${p.name}</strong></td><td>${p.email}</td><td>${fmtDate(p.dateOfBirth)}</td></tr>`)
    .join('') || '<tr><td colspan="3">No patients found.</td></tr>';
}

// ─── 🛡️ PHARMACIST REAL-TIME CLINICAL SAFETY CHECK ──────────────────────────
function debouncePharmSafety() {
  clearTimeout(pharmSafetyTimeout);
  pharmSafetyTimeout = setTimeout(checkPharmSafety, 350);
}

async function checkPharmSafety() {
  const patientId = document.getElementById('medPatient')?.value;
  const drugName = document.getElementById('medName')?.value;
  const alertBox = document.getElementById('pharmSafetyAlertBox');
  const alertList = document.getElementById('pharmSafetyAlertList');
  const chkOverride = document.getElementById('chkPharmOverride');

  if (!alertBox || !alertList) return;

  if (!patientId || !drugName || drugName.trim().length < 3) {
    alertBox.style.display = 'none';
    return;
  }

  try {
    const res = await API.post('/pharmacist/check-safety', {
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
              <strong>Recommendation:</strong> ${w.recommendation}
            </div>
          </div>
        `;
      }).join('');
    } else {
      alertBox.style.display = 'none';
    }
  } catch (err) {
    console.error('Pharm safety check error:', err);
  }
}

async function addMedicine(e) {
  e.preventDefault();
  const body = {
    patientId: document.getElementById('medPatient').value,
    name: document.getElementById('medName').value,
    dosage: document.getElementById('medDosage').value,
    quantity: document.getElementById('medQty').value,
    expiryDate: document.getElementById('medExpiry').value,
    dueDate: document.getElementById('medDue').value,
    timeSlot: document.getElementById('medTimeSlot')?.value || 'morning',
    mealTiming: document.getElementById('medMealTiming')?.value || 'after_meal',
    safetyOverride: document.getElementById('chkPharmOverride')?.checked ? 1 : 0
  };

  try {
    await API.post('/pharmacist/medicines', body);
    alert('Medicine added to patient schedule!');
    ['medName', 'medDosage', 'medQty', 'medExpiry', 'medDue'].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('pharmSafetyAlertBox').style.display = 'none';
    await loadMedicines();
  } catch (err) {
    if (err.requiresOverride || err.status === 409) {
      document.getElementById('pharmSafetyAlertBox').style.display = 'block';
      alert('⚠️ Clinical Safety Conflict: An interaction or documented allergy was detected. Check the authorization box if clinical override is justified.');
    } else {
      alert(err.message || 'Failed to add medicine');
    }
  }
}

async function addVaccination(e) {
  e.preventDefault();
  const body = {
    patientId: document.getElementById('vaxPatient').value,
    vaccineName: document.getElementById('vaxName').value,
    dueDate: document.getElementById('vaxDue').value,
  };
  await API.post('/pharmacist/vaccinations', body);
  alert('Vaccination scheduled for patient!');
  document.getElementById('vaxDue').value = '';
}

async function loadMedicines() {
  const meds = await API.get('/pharmacist/medicines');
  document.getElementById('medicinesBody').innerHTML = (meds || [])
    .map((m) => {
      const patientName = m.patientName || (assignedPatients.find((p) => p.patientId === m.patientId)?.name) || `Patient #${m.patientId}`;
      const slotInfo = `<br><small style="color:#64748B;">[${m.timeSlot || 'morning'} • ${(m.mealTiming || 'after_meal').replace(/_/g, ' ')}]</small>`;

      return `<tr>
        <td><strong>${patientName}</strong></td>
        <td><strong>${m.name}</strong>${slotInfo}</td>
        <td>${m.dosage || '-'}</td>
        <td>${fmtDate(m.dueDate)}</td>
        <td>${statusBadge(m.status)}</td>
        <td style="display:flex; gap:6px;">
          <button class="secondary btn-sm" onclick="printPrescriptionSlip('${patientName.replace(/'/g, "\\'")}', '${m.name.replace(/'/g, "\\'")}', '${m.dosage || ''}', '${m.dueDate}', '${m.timeSlot || 'morning'}', '${m.mealTiming || 'after_meal'}')">🖨️ Label Slip</button>
          <button class="danger btn-sm" onclick="deleteMedicine(${m.medicineId})">Delete</button>
        </td>
      </tr>`;
    })
    .join('') || '<tr><td colspan="6" style="text-align:center; padding:12px; color:var(--text-muted);">No medicines currently managed.</td></tr>';
}

async function deleteMedicine(id) {
  if (!confirm('Delete this medicine record?')) return;
  await API.del(`/pharmacist/medicines/${id}`);
  await loadMedicines();
}

async function loadRequests() {
  const reqs = await API.get('/pharmacist/requests');
  const tbody = document.getElementById('requestsBody');
  const badge = document.getElementById('pendingReqCountBadge');
  if (!tbody) return;

  const pendingCount = (reqs || []).filter((r) => r.status === 'pending').length;
  if (badge) {
    if (pendingCount > 0) {
      badge.textContent = `${pendingCount} Pending`;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  if (!reqs || reqs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px; color:var(--text-muted);">No doctor prescription or vaccine requests found.</td></tr>';
    return;
  }

  tbody.innerHTML = reqs
    .map((r) => {
      const isPending = r.status === 'pending';
      const statusBadge = isPending
        ? '<span class="badge pending">Pending Action ⏳</span>'
        : '<span class="badge taken">Fulfilled ✅</span>';

      const typeBadge = r.requestType === 'vaccine'
        ? '<span class="badge" style="background:var(--accent-purple-light); color:var(--accent-purple);">Vaccine</span>'
        : '<span class="badge" style="background:var(--primary-light); color:var(--primary);">Medicine</span>';

      const details = [r.dosage, r.instructions].filter(Boolean).join(' — ') || '-';
      const slotInfo = r.timeSlot ? `<br><small style="color:#64748B;">[${r.timeSlot} • ${r.mealTiming || 'after_meal'}]</small>` : '';

      const actionHtml = isPending
        ? `<button class="primary btn-sm" onclick="fulfillRequest(${r.requestId})">Approve & Dispense ✅</button>`
        : '<span style="color:var(--text-muted); font-size:12px;">Added to Schedule</span>';

      return `<tr ${isPending ? 'style="background:#FFFBF2;"' : ''}>
        <td>${statusBadge}</td>
        <td>${typeBadge}</td>
        <td><strong>${r.itemName}</strong></td>
        <td>${r.patientName}</td>
        <td><strong>${r.doctorName}</strong> <span style="font-size:11px; color:var(--text-muted);">(${r.doctorSpecialization || 'Doctor'})</span></td>
        <td style="font-size:13px;">${details}${slotInfo}</td>
        <td>${fmtDate(r.dueDate)}</td>
        <td>${actionHtml}</td>
      </tr>`;
    })
    .join('');
}

async function fulfillRequest(requestId) {
  try {
    const res = await API.put(`/pharmacist/requests/${requestId}/fulfill`);
    alert(res.message || 'Request fulfilled and scheduled for patient!');
    await loadRequests();
    await loadMedicines();
  } catch (err) {
    alert(err.message || 'Failed to fulfill request');
  }
}

async function loadRefills() {
  const refills = await API.get('/pharmacist/refills');
  const tbody = document.getElementById('refillsBody');
  const badge = document.getElementById('pendingRefillBadge');
  if (!tbody) return;

  const pendingCount = (refills || []).filter((r) => r.status === 'pending').length;
  if (badge) {
    if (pendingCount > 0) {
      badge.textContent = `${pendingCount} Refill Pending`;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  if (!refills || refills.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:14px; color:var(--text-muted);">No patient refill requests pending.</td></tr>';
    return;
  }

  tbody.innerHTML = refills
    .map((r) => {
      const isPending = r.status === 'pending';
      const statusBadge = isPending
        ? '<span class="badge pending">Needs Refill ⏳</span>'
        : '<span class="badge taken">Refilled ✅</span>';

      const actionHtml = isPending
        ? `<button class="primary btn-sm" style="background:var(--accent-amber);" onclick="fulfillRefill(${r.refillId}, '${r.medicineName}')">Approve (+30) 🔄</button>`
        : '<span style="color:var(--text-muted); font-size:12px;">Restocked</span>';

      return `<tr ${isPending ? 'style="background:#FFFBF0;"' : ''}>
        <td>${statusBadge}</td>
        <td><strong>${r.patientName}</strong></td>
        <td><strong>${r.medicineName}</strong> (${r.dosage || ''})</td>
        <td>${r.currentQuantity != null ? `${r.currentQuantity} pills left` : '-'}</td>
        <td style="font-size:13px;">${r.requestNotes || '-'}</td>
        <td style="font-size:12px; color:var(--text-muted);">${new Date(r.requestedAt).toLocaleDateString()}</td>
        <td>${actionHtml}</td>
      </tr>`;
    })
    .join('');
}

async function fulfillRefill(refillId, medicineName) {
  const qty = prompt(`Approve refill for ${medicineName}. Number of pills to restock:`, '30');
  if (!qty) return;

  try {
    const res = await API.put(`/pharmacist/refills/${refillId}/fulfill`, { quantity: parseInt(qty, 10) });
    alert(res.message || 'Refill approved!');
    await loadRefills();
    await loadMedicines();
  } catch (err) {
    alert(err.message || 'Failed to fulfill refill');
  }
}

function printPrescriptionSlip(patientName, medName, dosage, dueDate, timeSlot, mealTiming) {
  const win = window.open('', '_blank', 'width=600,height=440');
  win.document.write(`
    <html>
    <head>
      <title>Prescription Label — ${patientName}</title>
      <style>
        body { font-family: sans-serif; padding: 20px; border: 2px dashed #333; margin: 10px; }
        h2 { margin: 0 0 10px; color: #0F6E56; border-bottom: 2px solid #0F6E56; padding-bottom: 5px; }
        p { margin: 6px 0; font-size: 14px; }
        .rx-warning { background: #FEF3C7; padding: 8px; border-radius: 4px; font-size: 12px; margin-top: 15px; font-weight: bold; }
        .slot-badge { background: #E0F2FE; color: #075985; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
      </style>
    </head>
    <body>
      <h2>🏥 MediCare Pharmacy Dispensing Label</h2>
      <p><strong>Patient Name:</strong> ${patientName}</p>
      <p><strong>Medication:</strong> ${medName}</p>
      <p><strong>Dosage / Regimen:</strong> ${dosage || 'As directed by physician'}</p>
      <p><strong>Time Slot & Meal:</strong> <span class="slot-badge">${timeSlot || 'Morning'} (${(mealTiming || 'after_meal').replace(/_/g, ' ')})</span></p>
      <p><strong>Scheduled Due / Next Refill:</strong> ${dueDate}</p>
      <p class="rx-warning">⚠️ Keep out of reach of children. Store in a cool, dry place away from direct sunlight.</p>
      <script>window.print();<\/script>
    </body>
    </html>
  `);
}

init();
