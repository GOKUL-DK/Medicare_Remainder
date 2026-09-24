requireRole('admin');

let doctorsCache = [];
let pharmacistsCache = [];

async function loadAll() {
  await loadReports();
  await loadVaccineList();
  await loadThreshold();
  doctorsCache = await API.get('/admin/users/doctor');
  pharmacistsCache = await API.get('/admin/users/pharmacist');
  renderDoctors();
  renderPharmacists();
  await loadPatients();
}

async function loadReports() {
  const r = await API.get('/admin/reports');
  document.getElementById('reports').innerHTML = `
    <div class="stat-card" style="--stat-color:var(--accent-blue); --stat-bg:var(--accent-blue-light);">
      <div class="stat-icon">🧑</div>
      <div class="stat-info">
        <div class="stat-value">${r.totalPatients}</div>
        <div class="stat-label">Total Patients</div>
      </div>
    </div>
    <div class="stat-card" style="--stat-color:var(--primary); --stat-bg:var(--primary-light);">
      <div class="stat-icon">🩺</div>
      <div class="stat-info">
        <div class="stat-value">${r.totalDoctors}</div>
        <div class="stat-label">Doctors</div>
      </div>
    </div>
    <div class="stat-card" style="--stat-color:var(--accent-purple); --stat-bg:var(--accent-purple-light);">
      <div class="stat-icon">💊</div>
      <div class="stat-info">
        <div class="stat-value">${r.totalPharmacists}</div>
        <div class="stat-label">Pharmacists</div>
      </div>
    </div>
    <div class="stat-card" style="--stat-color:var(--accent-teal); --stat-bg:var(--accent-teal-light);">
      <div class="stat-icon">🗂️</div>
      <div class="stat-info">
        <div class="stat-value">${r.totalMedicines}</div>
        <div class="stat-label">Medicines Tracked</div>
      </div>
    </div>
    <div class="stat-card" style="--stat-color:var(--accent-amber); --stat-bg:var(--accent-amber-light);">
      <div class="stat-icon">💉</div>
      <div class="stat-info">
        <div class="stat-value">${r.totalVaccinesDue}</div>
        <div class="stat-label">Vaccines Due</div>
      </div>
    </div>
    <div class="stat-card" style="--stat-color:var(--accent-red); --stat-bg:var(--accent-red-light);">
      <div class="stat-icon">⚠️</div>
      <div class="stat-info">
        <div class="stat-value">${r.missedMedicines}</div>
        <div class="stat-label">Missed Doses</div>
      </div>
    </div>
  `;
  // Update hero banner mini-stats
  const heroMap = [
    ['heroPatCount',  r.totalPatients],
    ['heroDocCount',  r.totalDoctors],
    ['heroPharmCount',r.totalPharmacists],
    ['heroMedCount',  r.totalMedicines],
  ];
  heroMap.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

async function loadThreshold() {
  const s = await API.get('/admin/settings');
  document.getElementById('thresholdInput').value = s.notifyThresholdDays || 7;
}

async function updateThreshold(e) {
  e.preventDefault();
  const val = parseInt(document.getElementById('thresholdInput').value, 10);
  await API.put('/admin/settings/threshold', { notifyThresholdDays: val });
  alert('Threshold updated');
}

async function loadVaccineList() {
  const list = await API.get('/admin/vaccine-list');
  document.getElementById('vaccineListBody').innerHTML = list
    .map((v) => `<tr><td>${v.vaccineName}</td><td><button class="danger" onclick="removeVaccine(${v.listId})">Remove</button></td></tr>`)
    .join('');
}

async function addVaccine(e) {
  e.preventDefault();
  const name = document.getElementById('vaccineName').value;
  await API.post('/admin/vaccine-list', { vaccineName: name });
  document.getElementById('vaccineName').value = '';
  loadVaccineList();
}

async function removeVaccine(id) {
  await API.del(`/admin/vaccine-list/${id}`);
  loadVaccineList();
}

async function addUser(e) {
  e.preventDefault();
  const role = document.getElementById('newRole').value;
  const name = document.getElementById('newName').value;
  const email = document.getElementById('newEmail').value;
  const password = document.getElementById('newPassword').value;
  const extraVal = document.getElementById('newExtra').value;

  const body = { name, email, password };
  if (role === 'doctor') body.specialization = extraVal;
  if (role === 'pharmacist') body.licenseNo = extraVal;

  try {
    await API.post(`/admin/users/${role}`, body);
    alert(`${role} created`);
    ['newName', 'newEmail', 'newPassword', 'newExtra'].forEach((id) => (document.getElementById(id).value = ''));
    loadAll();
  } catch (err) {
    alert(err.message);
  }
}

function renderDoctors() {
  document.getElementById('doctorsBody').innerHTML = doctorsCache
    .map(
      (d) => `<tr><td>${d.name}</td><td>${d.email}</td><td>${d.specialization || '-'}</td>
      <td><button class="danger" onclick="deleteUser('doctor', ${d.doctorId})">Delete</button></td></tr>`
    )
    .join('');
}

function renderPharmacists() {
  document.getElementById('pharmacistsBody').innerHTML = pharmacistsCache
    .map(
      (p) => `<tr><td>${p.name}</td><td>${p.email}</td><td>${p.licenseNo || '-'}</td>
      <td><button class="danger" onclick="deleteUser('pharmacist', ${p.pharmacistId})">Delete</button></td></tr>`
    )
    .join('');
}

async function loadPatients() {
  const patients = await API.get('/admin/users/patient');
  document.getElementById('patientsBody').innerHTML = patients
    .map((p) => {
      const doctorOptions = doctorsCache
        .map((d) => `<option value="${d.doctorId}" ${d.doctorId === p.doctorId ? 'selected' : ''}>${d.name}</option>`)
        .join('');
      const pharmacistOptions = pharmacistsCache
        .map((ph) => `<option value="${ph.pharmacistId}" ${ph.pharmacistId === p.pharmacistId ? 'selected' : ''}>${ph.name}</option>`)
        .join('');
      return `<tr>
        <td>${p.name}</td><td>${p.email}</td>
        <td><select onchange="assignDoctor(${p.patientId}, this.value)"><option value="">-</option>${doctorOptions}</select></td>
        <td><select onchange="assignPharmacist(${p.patientId}, this.value)"><option value="">-</option>${pharmacistOptions}</select></td>
        <td><button class="danger" onclick="deleteUser('patient', ${p.patientId})">Delete</button></td>
      </tr>`;
    })
    .join('');
}

async function assignDoctor(patientId, doctorId) {
  if (!doctorId) return;
  await API.put('/admin/assign-doctor', { patientId, doctorId });
}

async function assignPharmacist(patientId, pharmacistId) {
  if (!pharmacistId) return;
  await API.put('/admin/assign-pharmacist', { patientId, pharmacistId });
}

async function deleteUser(role, id) {
  if (!confirm('Delete this account?')) return;
  await API.del(`/admin/users/${role}/${id}`);
  loadAll();
}

async function exportSystemAuditCSV() {
  const r = await API.get('/admin/reports');
  const patients = await API.get('/admin/users/patient');
  const doctors = await API.get('/admin/users/doctor');
  const pharmacists = await API.get('/admin/users/pharmacist');

  let csvContent = 'data:text/csv;charset=utf-8,';
  csvContent += '=== MEDICARE SYSTEM AUDIT REPORT ===\n';
  csvContent += `Generated At,${new Date().toISOString()}\n`;
  csvContent += `Total Patients,${r.totalPatients}\n`;
  csvContent += `Total Doctors,${r.totalDoctors}\n`;
  csvContent += `Total Pharmacists,${r.totalPharmacists}\n`;
  csvContent += `Total Medicines Tracked,${r.totalMedicines}\n`;
  csvContent += `Total Missed Doses,${r.missedMedicines}\n\n`;

  csvContent += '=== PATIENTS ROSTER ===\n';
  csvContent += 'Patient ID,Name,Email,Assigned Doctor ID,Assigned Pharmacist ID\n';
  patients.forEach((p) => {
    csvContent += `${p.patientId},"${p.name}","${p.email}",${p.doctorId || 'None'},${p.pharmacistId || 'None'}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `MediCare_System_Audit_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

loadAll();
