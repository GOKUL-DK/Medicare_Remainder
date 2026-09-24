requireRole('patient');

let notificationsCache = [];
let currentFilter = 'all';
let currentUnreadCount = 0;
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth() + 1; // 1-indexed
let calendarCache = null;

async function init() {
  const user = API.currentUser();
  if (user && user.name) {
    document.getElementById('patientTitle').textContent = `🧑 MediCare — ${user.name}`;
  }

  if (window.NotifEngine) {
    NotifEngine.updateUI();
  }

  await loadDashboard();
  await loadPillbox();
  await loadCalendar();
  await loadVitals();
  await loadAllergies();
  await loadMedicines();
  await loadVaccinations();
  await loadNotifications();
  await loadNotes();
  await loadRefills();
}

async function loadDashboard() {
  const d = await API.get('/patient/dashboard');
  currentUnreadCount = d.unreadNotifications || 0;
  renderDashboardStats(d);
}

function renderDashboardStats(d) {
  const unread = currentUnreadCount;
  const isHighlighted = unread > 0 ? 'has-unread' : '';
  const hintText = unread > 0 ? 'Click to view list' : 'All caught up';

  document.getElementById('dashStats').innerHTML = `
    <div class="stat">
      <div class="num">${d.upcomingMedicines?.length ?? 0}</div>
      <div class="label">Upcoming Medicines</div>
    </div>
    <div class="stat">
      <div class="num">${d.upcomingVaccinations?.length ?? 0}</div>
      <div class="label">Upcoming Vaccinations</div>
    </div>
    <div class="stat clickable ${isHighlighted}" onclick="scrollToNotifications('unread')" title="Click to view unread notifications">
      <div class="num" id="unreadStatNum">${unread}</div>
      <div class="label">Unread Notifications 🔔</div>
      <div style="font-size:11px; margin-top:4px; opacity:0.85;">${hintText}</div>
    </div>
  `;
}

// ─── 📅 DAILY PILLBOX ORGANIZER ──────────────────────────────────────────────
async function loadPillbox() {
  try {
    const data = await API.get('/patient/pillbox');
    renderPillbox(data);
  } catch (err) {
    console.error('Failed to load pillbox:', err);
  }
}

function renderMealBadge(mealTiming) {
  if (mealTiming === 'before_meal') {
    return '<span class="badge-meal before">🥣 Before Meal</span>';
  } else if (mealTiming === 'after_meal') {
    return '<span class="badge-meal after">🍽️ After Meal</span>';
  } else if (mealTiming === 'with_food') {
    return '<span class="badge-meal with-food">🥪 With Food</span>';
  }
  return '<span class="badge-meal">As Directed</span>';
}

function renderPillbox(data) {
  const container = document.getElementById('pillboxContainer');
  const summaryEl = document.getElementById('pillboxSummaryBadge');
  if (!container) return;

  if (summaryEl && data.summary) {
    const { total, taken, pending } = data.summary;
    summaryEl.innerHTML = `
      <span class="badge ${pending === 0 && total > 0 ? 'taken' : 'pending'}" style="font-size:12px; padding:5px 12px;">
        ${taken}/${total} Doses Taken Today (${pending} pending)
      </span>
    `;
  }

  const slotDefs = [
    { key: 'morning', title: '☀️ Morning', time: '6:00 AM – 12:00 PM', color: '#FEF3C7' },
    { key: 'afternoon', title: '🌤️ Afternoon', time: '12:00 PM – 5:00 PM', color: '#E0F2FE' },
    { key: 'evening', title: '🌅 Evening', time: '5:00 PM – 9:00 PM', color: '#FFEDD5' },
    { key: 'night', title: '🌙 Night', time: '9:00 PM – 6:00 AM', color: '#EDE9FE' }
  ];

  const slots = data.slots || {};

  container.innerHTML = slotDefs.map(def => {
    const meds = slots[def.key] || [];
    const medCards = meds.length > 0
      ? meds.map(m => {
          const isTaken = m.status === 'taken' || m.status === 'taken-late';
          const cardClass = isTaken ? 'taken' : '';
          const statusText = isTaken
            ? '<span style="color:#059669; font-weight:700; font-size:12px;">✓ Taken</span>'
            : `<button class="primary btn-sm" onclick="markTaken(${m.medicineId})">✓ Take Now</button>`;

          return `
            <div class="pillbox-med-card ${cardClass}">
              <div class="pillbox-med-header">
                <div>
                  <div class="pillbox-med-name">${m.name}</div>
                  <div class="pillbox-med-dosage">${m.dosage || 'Standard'} • ${m.quantity != null ? `${m.quantity} left` : ''}</div>
                </div>
                ${statusBadge(m.status)}
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
                ${renderMealBadge(m.mealTiming)}
                <div>${statusText}</div>
              </div>
            </div>
          `;
        }).join('')
      : '<div class="pillbox-empty">No medicines scheduled for this slot</div>';

    return `
      <div class="pillbox-slot">
        <div class="pillbox-slot-header">
          <div class="pillbox-slot-title">${def.title}</div>
          <div class="pillbox-slot-time">${def.time}</div>
        </div>
        <div class="pillbox-med-list">
          ${medCards}
        </div>
      </div>
    `;
  }).join('');
}

// ─── 🗓️ INTERACTIVE MONTHLY ADHERENCE CALENDAR ──────────────────────────────
async function loadCalendar(monthStr) {
  try {
    const query = monthStr || `${calCurrentYear}-${String(calCurrentMonth).padStart(2, '0')}`;
    const data = await API.get(`/patient/calendar?month=${query}`);
    calendarCache = data;
    renderCalendar(data);
  } catch (err) {
    console.error('Failed to load calendar:', err);
  }
}

function changeCalMonth(offset) {
  calCurrentMonth += offset;
  if (calCurrentMonth > 12) {
    calCurrentMonth = 1;
    calCurrentYear += 1;
  } else if (calCurrentMonth < 1) {
    calCurrentMonth = 12;
    calCurrentYear -= 1;
  }
  loadCalendar(`${calCurrentYear}-${String(calCurrentMonth).padStart(2, '0')}`);
}

function renderCalendar(data) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const titleEl = document.getElementById('calMonthTitle');
  if (titleEl) {
    titleEl.textContent = `${monthNames[data.monthNumber - 1]} ${data.year}`;
  }

  const grid = document.getElementById('calGrid');
  if (!grid) return;

  // First day of month day-of-week (0=Sun, 1=Mon, ..., 6=Sat)
  const firstDayIndex = new Date(data.year, data.monthNumber - 1, 1).getDay();
  const todayStr = new Date().toISOString().split('T')[0];

  let cellsHtml = '';

  // Empty leading cells for proper day of week alignment
  for (let i = 0; i < firstDayIndex; i++) {
    cellsHtml += '<div class="cal-cell other-month"></div>';
  }

  // Days of the month
  data.days.forEach(day => {
    const isToday = day.date === todayStr ? 'today' : '';
    let badgeHtml = '';
    let dotHtml = '';

    if (day.total > 0) {
      if (day.status === 'complete') {
        dotHtml = '<span class="cal-dot complete"></span>';
        badgeHtml = `<span class="cal-day-badge complete">✓ ${day.taken}/${day.total}</span>`;
      } else if (day.status === 'partial') {
        dotHtml = '<span class="cal-dot partial"></span>';
        badgeHtml = `<span class="cal-day-badge partial">⚠️ ${day.taken}/${day.total}</span>`;
      } else if (day.status === 'missed') {
        dotHtml = '<span class="cal-dot missed"></span>';
        badgeHtml = `<span class="cal-day-badge missed">❌ ${day.missed} Missed</span>`;
      } else {
        dotHtml = '<span class="cal-dot pending"></span>';
        badgeHtml = `<span class="cal-day-badge pending">⏳ ${day.total} Meds</span>`;
      }
    }

    cellsHtml += `
      <div class="cal-cell ${isToday}" onclick="openCalDayModal('${day.date}')">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="cal-day-num">${day.dayNumber}</span>
          ${dotHtml}
        </div>
        <div class="cal-indicators">
          ${badgeHtml}
        </div>
      </div>
    `;
  });

  grid.innerHTML = cellsHtml;
}

function openCalDayModal(dateStr) {
  if (!calendarCache) return;
  const day = calendarCache.days.find(d => d.date === dateStr);
  if (!day) return;

  const modal = document.getElementById('calDayModal');
  const title = document.getElementById('calModalTitle');
  const content = document.getElementById('calModalContent');

  title.textContent = `📅 Schedule Details for ${dateStr}`;

  if (!day.medicines || day.medicines.length === 0) {
    content.innerHTML = `
      <div style="text-align:center; padding:20px; color:var(--text-muted);">
        No medicines were scheduled on this date.
      </div>
    `;
  } else {
    content.innerHTML = `
      <div style="margin-bottom:12px; display:flex; gap:10px;">
        <span class="badge taken">${day.taken} Taken</span>
        ${day.late > 0 ? `<span class="badge missed">${day.late} Taken Late</span>` : ''}
        ${day.missed > 0 ? `<span class="badge missed">${day.missed} Missed</span>` : ''}
        ${day.pending > 0 ? `<span class="badge pending">${day.pending} Pending</span>` : ''}
      </div>
      <table>
        <thead>
          <tr>
            <th>Medicine</th>
            <th>Dosage</th>
            <th>Slot & Meal</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${day.medicines.map(m => `
            <tr>
              <td><strong>${m.name}</strong></td>
              <td>${m.dosage || '-'}</td>
              <td>${m.timeSlot || 'morning'} • ${renderMealBadge(m.mealTiming)}</td>
              <td>${statusBadge(m.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  modal.classList.add('open');
}

function closeCalModal() {
  document.getElementById('calDayModal').classList.remove('open');
}

// ─── 📈 VITALS & HEALTH BIOMETRICS ──────────────────────────────────────────
async function loadVitals() {
  try {
    const vitals = await API.get('/patient/vitals');
    renderVitals(vitals || []);
  } catch (err) {
    console.error('Failed to load vitals:', err);
  }
}

function classifyBP(sys, dia) {
  if (!sys || !dia) return { label: 'Unrecorded', cls: 'normal' };
  if (sys < 120 && dia < 80) return { label: 'Optimal (<120/80)', cls: 'normal' };
  if (sys <= 129 && dia < 80) return { label: 'Elevated (120-129)', cls: 'elevated' };
  if (sys <= 139 || dia <= 89) return { label: 'Stage 1 Hypertension', cls: 'stage1' };
  return { label: 'Stage 2 Hypertension (≥140/90)', cls: 'high' };
}

function classifySugar(sugar, type) {
  if (!sugar) return { label: 'Unrecorded', cls: 'normal' };
  if (sugar < 70) return { label: 'Low Glucose (<70)', cls: 'high' };
  if (type === 'fasting') {
    if (sugar <= 99) return { label: 'Normal Fasting (70-99)', cls: 'normal' };
    if (sugar <= 125) return { label: 'Pre-diabetes (100-125)', cls: 'elevated' };
    return { label: 'Elevated Fasting (≥126)', cls: 'high' };
  }
  if (sugar <= 140) return { label: 'Normal Post-Meal (<140)', cls: 'normal' };
  if (sugar <= 199) return { label: 'Elevated Post-Meal (140-199)', cls: 'elevated' };
  return { label: 'High Glucose (≥200)', cls: 'high' };
}

function renderVitals(list) {
  const cardsGrid = document.getElementById('vitalsCardsGrid');
  const tbody = document.getElementById('vitalsHistoryBody');

  if (list.length > 0) {
    const latest = list[0];
    const bpClass = classifyBP(latest.systolic, latest.diastolic);
    const sugarClass = classifySugar(latest.bloodSugar, latest.sugarType);

    if (cardsGrid) {
      cardsGrid.innerHTML = `
        <div class="vital-metric-card">
          <div class="title">Blood Pressure</div>
          <div class="value">${latest.systolic && latest.diastolic ? `${latest.systolic}/${latest.diastolic}` : '-'} <span class="unit">mmHg</span></div>
          <span class="vital-badge ${bpClass.cls}">${bpClass.label}</span>
        </div>
        <div class="vital-metric-card">
          <div class="title">Blood Glucose</div>
          <div class="value">${latest.bloodSugar != null ? latest.bloodSugar : '-'} <span class="unit">mg/dL</span></div>
          <span class="vital-badge ${sugarClass.cls}">${sugarClass.label} (${latest.sugarType || 'random'})</span>
        </div>
        <div class="vital-metric-card">
          <div class="title">Pulse / Heart Rate</div>
          <div class="value">${latest.pulse != null ? latest.pulse : '-'} <span class="unit">BPM</span></div>
          <span class="vital-badge normal">${latest.pulse ? (latest.pulse < 60 ? 'Bradycardia' : latest.pulse > 100 ? 'Tachycardia' : 'Normal (60-100 BPM)') : 'Normal'}</span>
        </div>
      `;
    }
  } else if (cardsGrid) {
    cardsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align:center; padding:18px; color:var(--text-muted); background:#F8FAFC; border-radius:8px;">
        No vitals logged yet. Use the form below to record your first measurement!
      </div>
    `;
  }

  if (tbody) {
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:14px; color:var(--text-muted);">No vitals history recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = list.slice(0, 10).map(v => {
      const bpStatus = classifyBP(v.systolic, v.diastolic);
      const sugarStatus = classifySugar(v.bloodSugar, v.sugarType);

      return `
        <tr>
          <td style="font-size:12px; color:var(--text-muted);">${new Date(v.recordedAt).toLocaleString()}</td>
          <td><strong>${v.systolic && v.diastolic ? `${v.systolic}/${v.diastolic} mmHg` : '-'}</strong></td>
          <td><strong>${v.bloodSugar != null ? `${v.bloodSugar} mg/dL` : '-'}</strong> <span style="font-size:11px; color:#64748B;">(${v.sugarType})</span></td>
          <td>${v.pulse != null ? `${v.pulse} bpm` : '-'}</td>
          <td>
            <span class="vital-badge ${bpStatus.cls}">${bpStatus.label}</span>
          </td>
          <td style="font-size:12px;">${v.notes || '-'}</td>
        </tr>
      `;
    }).join('');
  }
}

async function submitPatientVitals(e) {
  e.preventDefault();
  const systolic = document.getElementById('vitalSys').value;
  const diastolic = document.getElementById('vitalDia').value;
  const bloodSugar = document.getElementById('vitalSugar').value;
  const sugarType = document.getElementById('vitalSugarType').value;
  const pulse = document.getElementById('vitalPulse').value;
  const notes = document.getElementById('vitalNotes').value;
  const statusEl = document.getElementById('vitalsStatus');

  statusEl.style.display = 'none';

  try {
    const res = await API.post('/patient/vitals', {
      systolic,
      diastolic,
      bloodSugar,
      sugarType,
      pulse,
      notes
    });

    statusEl.textContent = res.message || 'Health vitals recorded successfully!';
    statusEl.style.color = 'var(--primary)';
    statusEl.style.display = 'block';

    document.getElementById('vitalSys').value = '';
    document.getElementById('vitalDia').value = '';
    document.getElementById('vitalSugar').value = '';
    document.getElementById('vitalPulse').value = '';
    document.getElementById('vitalNotes').value = '';

    await loadVitals();
    await loadNotifications();

    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 4000);
  } catch (err) {
    statusEl.textContent = err.message || 'Failed to record vitals';
    statusEl.style.color = 'var(--accent-red)';
    statusEl.style.display = 'block';
  }
}

// ─── 🛡️ PATIENT ALLERGIES & SENSITIVITIES ────────────────────────────────────
async function loadAllergies() {
  try {
    const list = await API.get('/patient/allergies');
    renderAllergies(list || []);
  } catch (err) {
    console.error('Failed to load allergies:', err);
  }
}

function renderAllergies(list) {
  const container = document.getElementById('allergiesList');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = '<span style="font-size:13px; color:var(--text-muted); font-style:italic;">No known allergies documented.</span>';
    return;
  }

  container.innerHTML = list.map(a => `
    <span class="allergy-chip ${a.severity || 'moderate'}">
      🛡️ <strong>${a.allergen}</strong> (${a.severity.toUpperCase()}${a.reaction ? `: ${a.reaction}` : ''})
      <button class="btn-remove" onclick="removeAllergy(${a.allergyId})" title="Remove allergy">&times;</button>
    </span>
  `).join('');
}

async function submitPatientAllergy(e) {
  e.preventDefault();
  const allergen = document.getElementById('allergyName').value;
  const severity = document.getElementById('allergySeverity').value;
  const reaction = document.getElementById('allergyReaction').value;

  try {
    await API.post('/patient/allergies', { allergen, severity, reaction });
    document.getElementById('allergyName').value = '';
    document.getElementById('allergyReaction').value = '';
    await loadAllergies();
  } catch (err) {
    alert(err.message || 'Failed to add allergy');
  }
}

async function removeAllergy(id) {
  if (!confirm('Remove this allergy record?')) return;
  try {
    await API.delete(`/patient/allergies/${id}`);
    await loadAllergies();
  } catch (err) {
    alert(err.message || 'Failed to remove allergy');
  }
}

// ─── 💊 MEDICINES & VACCINATIONS ────────────────────────────────────────────
async function loadMedicines() {
  const meds = await API.get('/patient/medicines');
  document.getElementById('medsBody').innerHTML = (meds || [])
    .map((m) => {
      const isPending = m.status === 'pending' || m.status === 'missed';
      const takeBtn = isPending
        ? `<button class="primary btn-sm" onclick="markTaken(${m.medicineId})">Take Dose</button>`
        : '<span style="color:#64748B; font-size:12px;">Completed</span>';

      const refillBtn = `<button class="secondary btn-sm" onclick="promptRefill(${m.medicineId}, '${m.name.replace(/'/g, "\\'")}')">🔄 Refill</button>`;

      const slotMeal = `
        <span style="font-weight:600; font-size:12px; text-transform:capitalize;">${m.timeSlot || 'morning'}</span>
        <br>${renderMealBadge(m.mealTiming)}
      `;

      return `<tr>
        <td><strong>${m.name}</strong></td>
        <td>${m.dosage || '-'}</td>
        <td>${slotMeal}</td>
        <td>${m.quantity != null ? `${m.quantity} pills` : '-'}</td>
        <td>${fmtDate(m.dueDate)}</td>
        <td>${statusBadge(m.status)}</td>
        <td style="display:flex; gap:6px;">
          ${takeBtn}
          ${refillBtn}
        </td>
      </tr>`;
    })
    .join('') || '<tr><td colspan="7">No medicines prescribed.</td></tr>';
}

async function markTaken(id) {
  const result = await API.put(`/patient/medicines/${id}/taken`);
  alert(result.onTime ? 'Marked as taken — on time! 💊' : 'Marked as taken (late) — your doctor has been notified.');
  await loadMedicines();
  await loadPillbox();
  await loadCalendar();
  await loadDashboard();
  await loadNotifications();
}

async function promptRefill(medicineId, medicineName) {
  const notes = prompt(`Request refill for ${medicineName}. Any note for your pharmacist?`, 'Refill requested by patient');
  if (notes === null) return;

  try {
    const res = await API.post('/patient/refill', { medicineId, requestNotes: notes });
    alert(res.message || 'Refill request sent to pharmacist!');
    await loadRefills();
    await loadNotifications();
  } catch (err) {
    alert(err.message || 'Failed to request refill');
  }
}

async function loadRefills() {
  const refills = await API.get('/patient/refills');
  const tbody = document.getElementById('refillsBody');
  if (!tbody) return;

  if (!refills || refills.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:12px; color:var(--text-muted);">No refill requests submitted yet.</td></tr>';
    return;
  }

  tbody.innerHTML = refills
    .map((r) => {
      const isApproved = r.status === 'approved';
      const statusBadge = isApproved
        ? '<span class="badge taken">Approved & Restocked ✅</span>'
        : '<span class="badge pending">Pending Pharmacist ⏳</span>';

      return `<tr>
        <td>${statusBadge}</td>
        <td><strong>${r.medicineName}</strong> (${r.dosage || ''})</td>
        <td>${r.pharmacistName || 'Assigned Pharmacist'}</td>
        <td style="font-size:13px;">${r.requestNotes || '-'}</td>
        <td style="font-size:12px; color:var(--text-muted);">${new Date(r.requestedAt).toLocaleDateString()}</td>
      </tr>`;
    })
    .join('');
}

async function loadVaccinations() {
  const vax = await API.get('/patient/vaccinations');
  document.getElementById('vaxBody').innerHTML = (vax || [])
    .map((v) => `<tr>
      <td><strong>${v.vaccineName}</strong></td>
      <td>${fmtDate(v.dueDate)}</td>
      <td>${statusBadge(v.status)}</td>
      <td>${v.status !== 'taken' ? `<button class="primary btn-sm" onclick="markVaxTaken(${v.vaccinationId})">Mark Taken</button>` : '-'}</td>
    </tr>`)
    .join('') || '<tr><td colspan="4">No vaccination schedule found.</td></tr>';
}

async function markVaxTaken(id) {
  await API.put(`/patient/vaccinations/${id}/taken`);
  await loadVaccinations();
  await loadDashboard();
}

async function loadNotifications() {
  const notifs = await API.get('/patient/notifications');
  notificationsCache = notifs || [];
  updateNotificationBadges();
  renderNotifications();
}

function updateNotificationBadges() {
  currentUnreadCount = notificationsCache.filter((n) => n.isRead === 0).length;

  const totalEl = document.getElementById('totalNotifCount');
  if (totalEl) totalEl.textContent = notificationsCache.length;

  const badgeEl = document.getElementById('unreadFilterBadge');
  if (badgeEl) badgeEl.textContent = currentUnreadCount;

  const statNumEl = document.getElementById('unreadStatNum');
  if (statNumEl) statNumEl.textContent = currentUnreadCount;

  const markAllBtn = document.getElementById('btnMarkAllRead');
  if (markAllBtn) {
    markAllBtn.style.display = currentUnreadCount > 0 ? 'inline-block' : 'none';
  }
}

function setNotifFilter(filter) {
  currentFilter = filter;
  const btnAll = document.getElementById('filterAll');
  const btnUnread = document.getElementById('filterUnread');
  if (btnAll && btnUnread) {
    if (filter === 'unread') {
      btnAll.classList.remove('active');
      btnUnread.classList.add('active');
    } else {
      btnAll.classList.add('active');
      btnUnread.classList.remove('active');
    }
  }
  renderNotifications();
}

function formatNotifTypeBadge(type) {
  if (type === 'doctor-message') return '<span class="badge" style="background:var(--accent-purple-light); color:var(--accent-purple); font-weight:bold;">👨‍⚕️ Doctor Note</span>';
  if (type === 'doctor-reminder') return '<span class="badge" style="background:#FFF0D4; color:#6E4200; font-weight:bold;">⏰ Doctor Reminder</span>';
  if (type === 'doctor-warning') return '<span class="badge missed">⚠️ Urgent Notice</span>';
  if (type === 'doctor-checkin') return '<span class="badge" style="background:var(--primary-light); color:var(--primary); font-weight:bold;">📋 Health Check-in</span>';
  if (type === 'doctor-prescription-order') return '<span class="badge" style="background:var(--accent-blue-light); color:var(--accent-blue); font-weight:bold;">💊 Rx Order</span>';
  if (type === 'alert') return '<span class="badge missed">Alert</span>';
  if (type === 'reminder') return '<span class="badge pending">Reminder</span>';
  if (type === 'expiry') return '<span class="badge pending">Expiry</span>';
  return `<span class="badge ${type || 'info'}">${type || 'general'}</span>`;
}

function renderNotifications() {
  const tbody = document.getElementById('notifBody');
  if (!tbody) return;

  let items = notificationsCache;
  if (currentFilter === 'unread') {
    items = items.filter((n) => n.isRead === 0);
  }

  if (items.length === 0) {
    const emptyMsg = currentFilter === 'unread'
      ? 'No unread notifications! You are all caught up.'
      : 'No notifications found.';
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:18px; color:var(--text-muted);">${emptyMsg}</td></tr>`;
    return;
  }

  tbody.innerHTML = items
    .map((n) => {
      const isUnread = n.isRead === 0;
      const rowClass = isUnread ? 'class="unread-row"' : '';
      const statusBadge = isUnread
        ? '<span class="badge unread">Unread</span>'
        : '<span class="badge read">Read</span>';
      const actionHtml = isUnread
        ? `<button class="primary btn-sm" onclick="markOneRead(${n.notificationId})">Mark Read</button>`
        : '<span style="color:var(--text-muted); font-size:12px;">✓ Read</span>';

      return `<tr ${rowClass}>
        <td>${statusBadge}</td>
        <td class="${isUnread ? 'msg-cell' : ''}">${n.message}</td>
        <td>${formatNotifTypeBadge(n.type)}</td>
        <td style="font-size:12px; color:var(--text-muted);">${new Date(n.timestamp).toLocaleString()}</td>
        <td>${actionHtml}</td>
      </tr>`;
    })
    .join('');
}

async function markOneRead(id) {
  try {
    await API.put(`/patient/notifications/${id}/read`);
    const found = notificationsCache.find((n) => n.notificationId === id);
    if (found) found.isRead = 1;

    updateNotificationBadges();
    renderNotifications();
  } catch (err) {
    alert(err.message || 'Failed to mark as read');
  }
}

async function markAllNotificationsRead() {
  try {
    await API.put('/patient/notifications/read-all');
    notificationsCache.forEach((n) => (n.isRead = 1));
    updateNotificationBadges();
    renderNotifications();
  } catch (err) {
    alert(err.message || 'Failed to mark all as read');
  }
}

function scrollToNotifications(filter) {
  if (filter) {
    setNotifFilter(filter);
  }
  const el = document.getElementById('notificationsCard');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

// ─── 🩺 SUBMIT PATIENT SYMPTOM / NOTE TO DOCTOR ─────────────────────────────
async function submitPatientNote(e) {
  e.preventDefault();
  const subject = document.getElementById('noteSubject').value;
  const severity = document.getElementById('noteSeverity').value;
  const message = document.getElementById('noteMessage').value;
  const statusEl = document.getElementById('noteStatus');

  statusEl.style.display = 'none';

  try {
    const res = await API.post('/patient/notes', { subject, message, severity });
    statusEl.textContent = res.message || 'Note sent to your supervising doctor!';
    statusEl.style.color = 'var(--accent-purple)';
    statusEl.style.display = 'block';

    document.getElementById('noteSubject').value = '';
    document.getElementById('noteMessage').value = '';

    await loadNotes();

    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 4000);
  } catch (err) {
    statusEl.textContent = err.message || 'Failed to send note.';
    statusEl.style.color = 'var(--accent-red)';
    statusEl.style.display = 'block';
  }
}

async function loadNotes() {
  const notes = await API.get('/patient/notes');
  const tbody = document.getElementById('patientNotesBody');
  if (!tbody) return;

  if (!notes || notes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:14px; color:var(--text-muted);">No notes submitted to your doctor yet.</td></tr>';
    return;
  }

  tbody.innerHTML = notes
    .map((n) => {
      const isReplied = n.status === 'replied';
      const statusBadge = isReplied
        ? '<span class="badge taken">Doctor Replied ✅</span>'
        : '<span class="badge pending">Awaiting Doctor ⏳</span>';

      const replyHtml = n.doctorReply
        ? `<strong style="color:var(--primary);">👨‍⚕️ ${n.doctorName}:</strong> "${n.doctorReply}"`
        : '<span style="color:var(--text-dim); font-size:12px;">Pending response</span>';

      return `<tr>
        <td>${statusBadge}</td>
        <td><strong>${n.subject}</strong> ${n.severity === 'urgent' ? '<span class="badge missed">Urgent</span>' : ''}</td>
        <td style="font-size:13px;">${n.message}</td>
        <td style="font-size:13px;">${replyHtml}</td>
        <td style="font-size:12px; color:var(--text-muted);">${new Date(n.timestamp).toLocaleDateString()}</td>
      </tr>`;
    })
    .join('');
}

init();
