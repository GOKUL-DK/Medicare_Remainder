// profileModal.js — Comprehensive User Profile Viewer & Editor for All Roles
// Displays rich role-specific info (Patients: BG, DOB, Height, Weight, Phone, etc.; Staff: Credentials, Licenses, Hospital)

let currentProfileData = null;
let isEditMode = false;

function calculateAge(dobStr) {
  if (!dobStr) return 'N/A';
  const birth = new Date(dobStr);
  if (isNaN(birth.getTime())) return dobStr;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return `${age} yrs (${dobStr})`;
}

async function openProfileModal() {
  let modal = document.getElementById('profileModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'profileModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal profile-modal" style="max-width:680px; width:95%;">
        <div class="modal-header" style="background:var(--primary-gradient); color:white; border-radius:var(--radius-xl) var(--radius-xl) 0 0; padding:20px 24px;">
          <div style="display:flex; align-items:center; gap:16px; width:100%;">
            <div id="profAvatar" style="width:58px; height:58px; border-radius:50%; background:rgba(255,255,255,0.25); border:2.5px solid white; display:flex; align-items:center; justify-content:center; font-size:26px; flex-shrink:0;">
              👤
            </div>
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <h3 id="profName" style="color:white; margin:0; font-size:18px; font-weight:800;">Loading Profile...</h3>
                <span id="profRoleBadge" class="badge" style="background:white; color:var(--primary); font-weight:800; font-size:11px;">User</span>
              </div>
              <p id="profEmail" style="color:rgba(255,255,255,0.85); font-size:13px; margin:2px 0 0 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                user@medicare.local
              </p>
            </div>
            <button class="modal-close" onclick="closeProfileModal()" style="color:white; background:rgba(255,255,255,0.2); border:none; margin-left:auto;">✕</button>
          </div>
        </div>

        <div class="modal-body" style="padding:22px 24px; max-height:calc(85vh - 120px); overflow-y:auto;">
          <div id="profLoading" style="text-align:center; padding:32px; color:var(--text-muted);">
            <div style="font-size:24px; margin-bottom:8px;">⏳</div>
            Loading profile information...
          </div>

          <div id="profAlert" class="error" style="display:none; margin-bottom:14px;"></div>
          <div id="profSuccess" style="display:none; color:var(--primary); background:var(--primary-light); padding:10px 14px; border-radius:8px; font-size:13px; font-weight:600; margin-bottom:14px; text-align:center;"></div>

          <!-- View Mode -->
          <div id="profViewMode" style="display:none;"></div>

          <!-- Edit Mode -->
          <div id="profEditMode" style="display:none;"></div>
        </div>

        <div class="modal-footer" style="padding:14px 24px; background:var(--bg); border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:11.5px; color:var(--text-dim);" id="profIdLabel">ID: #000</div>
          <div style="display:flex; gap:10px;">
            <button type="button" class="secondary btn-sm" id="btnToggleEdit" onclick="toggleProfileEdit()">✏️ Edit Info</button>
            <button type="button" class="primary btn-sm" id="btnSaveProfile" onclick="saveProfileChanges()" style="display:none;">💾 Save Changes</button>
            <button type="button" class="secondary btn-sm" onclick="closeProfileModal()">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  isEditMode = false;
  document.getElementById('profViewMode').style.display = 'none';
  document.getElementById('profEditMode').style.display = 'none';
  document.getElementById('profLoading').style.display = 'block';
  document.getElementById('profAlert').style.display = 'none';
  document.getElementById('profSuccess').style.display = 'none';
  document.getElementById('btnToggleEdit').style.display = 'inline-flex';
  document.getElementById('btnToggleEdit').textContent = '✏️ Edit Info';
  document.getElementById('btnSaveProfile').style.display = 'none';

  modal.classList.add('open');

  try {
    const res = await API.get('/auth/profile');
    if (!res || !res.profile) throw new Error('Could not retrieve profile data');
    currentProfileData = res;
    renderProfileView(res.profile, res.role);
  } catch (err) {
    document.getElementById('profLoading').style.display = 'none';
    const alertEl = document.getElementById('profAlert');
    alertEl.textContent = err.message || 'Failed to load profile details.';
    alertEl.style.display = 'block';
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) modal.classList.remove('open');
}

function renderProfileView(p, role) {
  document.getElementById('profLoading').style.display = 'none';
  const viewEl = document.getElementById('profViewMode');
  viewEl.style.display = 'block';

  // Header data
  document.getElementById('profName').textContent = p.name || 'User Profile';
  document.getElementById('profEmail').textContent = p.email || '-';

  const roleMeta = {
    patient:    { emoji: '🧑', label: 'Patient', color: 'var(--primary)' },
    doctor:     { emoji: '🩺', label: 'Physician / Doctor', color: 'var(--accent-blue)' },
    pharmacist: { emoji: '💊', label: 'Pharmacist', color: 'var(--accent-purple)' },
    admin:      { emoji: '⚙️', label: 'System Administrator', color: '#1E293B' },
  }[role] || { emoji: '👤', label: role, color: 'var(--primary)' };

  document.getElementById('profAvatar').textContent = roleMeta.emoji;
  const badge = document.getElementById('profRoleBadge');
  badge.textContent = `${roleMeta.emoji} ${roleMeta.label}`;
  badge.style.color = roleMeta.color;

  const idCol = role === 'patient' ? p.patientId : (role === 'doctor' ? p.doctorId : (role === 'pharmacist' ? p.pharmacistId : p.adminId));
  document.getElementById('profIdLabel').textContent = `Account ID: #${role.toUpperCase()}-${idCol || '001'}`;

  let html = '';

  if (role === 'patient') {
    const ageText = calculateAge(p.dateOfBirth);
    html = `
      <!-- Snapshot Grid -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:12px; margin-bottom:20px;">
        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-red); --stat-bg:var(--accent-red-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">🩸</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:20px; color:var(--accent-red);">${p.bloodGroup || 'O+'}</div>
            <div class="stat-label">Blood Group</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--primary); --stat-bg:var(--primary-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">🎂</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:16px;">${p.dateOfBirth ? p.dateOfBirth.split('-')[0] : 'N/A'}</div>
            <div class="stat-label">${ageText.split('(')[0] || 'Age'}</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-blue); --stat-bg:var(--accent-blue-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">📏</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:18px;">${p.height || '175 cm'}</div>
            <div class="stat-label">Height</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-amber); --stat-bg:var(--accent-amber-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">⚖️</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:18px;">${p.weight || '70 kg'}</div>
            <div class="stat-label">Weight</div>
          </div>
        </div>
      </div>

      <!-- Identity & Contact Information -->
      <div style="background:var(--card-bg-alt); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; margin-bottom:16px;">
        <h4 style="margin:0 0 12px 0; font-size:13px; text-transform:uppercase; letter-spacing:0.6px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
          <span>📞</span> Contact & Personal Details
        </h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:13.5px;">
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Phone / Mobile</span>
            <strong style="color:var(--text-main);">${p.phone || '+1 (555) 234-8891'}</strong>
          </div>
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Gender</span>
            <strong style="color:var(--text-main);">${p.gender || 'Not specified'}</strong>
          </div>
          <div style="grid-column: span 2;">
            <span style="color:var(--text-muted); font-size:12px; display:block;">Emergency Contact</span>
            <strong style="color:var(--accent-red);">${p.emergencyContact || 'Not recorded'}</strong>
          </div>
          <div style="grid-column: span 2;">
            <span style="color:var(--text-muted); font-size:12px; display:block;">Home Address</span>
            <span style="color:var(--text-secondary);">${p.address || 'Springfield Medical Community Area'}</span>
          </div>
        </div>
      </div>

      <!-- Clinical Team -->
      <div style="background:var(--card-bg-alt); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; margin-bottom:16px;">
        <h4 style="margin:0 0 12px 0; font-size:13px; text-transform:uppercase; letter-spacing:0.6px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
          <span>🩺</span> Assigned Healthcare Team
        </h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
          <div style="padding:12px; background:white; border:1px solid var(--border-light); border-radius:8px;">
            <span style="font-size:11px; color:var(--primary); font-weight:700; text-transform:uppercase;">Supervising Doctor</span>
            <div style="font-weight:700; font-size:14px; margin-top:3px; color:var(--text-main);">
              ${p.doctor ? p.doctor.name : 'Dr. Smith (General Medicine)'}
            </div>
            <div style="font-size:12px; color:var(--text-muted);">
              ${p.doctor ? (p.doctor.specialization || 'Clinical Medicine') : 'General Medicine'}
            </div>
            ${p.doctor && p.doctor.hospital ? `<div style="font-size:11.5px; color:var(--text-dim); margin-top:2px;">🏥 ${p.doctor.hospital}</div>` : ''}
          </div>

          <div style="padding:12px; background:white; border:1px solid var(--border-light); border-radius:8px;">
            <span style="font-size:11px; color:var(--accent-purple); font-weight:700; text-transform:uppercase;">Dispensing Pharmacist</span>
            <div style="font-weight:700; font-size:14px; margin-top:3px; color:var(--text-main);">
              ${p.pharmacist ? p.pharmacist.name : 'PharmaCist Joe'}
            </div>
            <div style="font-size:12px; color:var(--text-muted);">
              ${p.pharmacist && p.pharmacist.licenseNo ? `License: ${p.pharmacist.licenseNo}` : 'Licensed Clinical Pharmacist'}
            </div>
            ${p.pharmacist && p.pharmacist.pharmacyName ? `<div style="font-size:11.5px; color:var(--text-dim); margin-top:2px;">💊 ${p.pharmacist.pharmacyName}</div>` : ''}
          </div>
        </div>
      </div>

      <!-- Health Profile, Allergies & Latest Vitals -->
      <div style="background:var(--card-bg-alt); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;">
        <h4 style="margin:0 0 10px 0; font-size:13px; text-transform:uppercase; letter-spacing:0.6px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
          <span>📋</span> Clinical Notes & Sensitivities
        </h4>
        <div style="font-size:13.5px; margin-bottom:12px;">
          <span style="color:var(--text-muted); font-size:12px; display:block;">Documented Medical History</span>
          <strong style="color:var(--text-main);">${p.medicalHistory || 'No major chronic conditions noted.'}</strong>
        </div>

        <div style="margin-bottom:12px;">
          <span style="color:var(--text-muted); font-size:12px; display:block; margin-bottom:4px;">Documented Allergies</span>
          <div style="display:flex; flex-wrap:wrap; gap:6px;">
            ${(p.allergies && p.allergies.length > 0)
              ? p.allergies.map(a => `<span class="allergy-chip" style="font-size:11.5px; padding:3px 10px;">⚠️ ${a.allergen} (${a.severity || 'moderate'})</span>`).join('')
              : '<span style="font-size:12.5px; color:var(--text-dim);">No drug allergies registered.</span>'
            }
          </div>
        </div>

        ${p.latestVitals ? `
          <div style="margin-top:12px; padding:10px 12px; background:white; border:1px solid var(--border-light); border-radius:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <span style="font-size:12px; color:var(--text-muted);">❤️ <strong>Latest Vitals:</strong></span>
            <span style="font-size:12px;">BP: <strong>${p.latestVitals.systolic || '-'}/${p.latestVitals.diastolic || '-'} mmHg</strong></span>
            <span style="font-size:12px;">Sugar: <strong>${p.latestVitals.bloodSugar || '-'} mg/dL</strong></span>
            <span style="font-size:12px;">Pulse: <strong>${p.latestVitals.pulse || '-'} BPM</strong></span>
            <span style="font-size:11px; color:var(--text-dim);">(${p.latestVitals.recordedAt ? p.latestVitals.recordedAt.split(' ')[0] : 'recent'})</span>
          </div>
        ` : ''}
      </div>
    `;
  } else if (role === 'doctor') {
    html = `
      <!-- Doctor Credentials Grid -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:20px;">
        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-blue); --stat-bg:var(--accent-blue-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">🩺</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:16px; color:var(--accent-blue);">${p.specialization || 'General Medicine'}</div>
            <div class="stat-label">Specialty</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--primary); --stat-bg:var(--primary-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">👥</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:22px;">${p.assignedPatientsCount || 0}</div>
            <div class="stat-label">Active Patients</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-purple); --stat-bg:var(--accent-purple-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">⏱️</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:16px;">${p.experience || '12+ Years'}</div>
            <div class="stat-label">Clinical Practice</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-teal); --stat-bg:var(--accent-teal-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">📋</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:22px;">${p.totalPrescriptionsSent || 0}</div>
            <div class="stat-label">Prescriptions Sent</div>
          </div>
        </div>
      </div>

      <!-- Professional Profile Details -->
      <div style="background:var(--card-bg-alt); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; margin-bottom:16px;">
        <h4 style="margin:0 0 12px 0; font-size:13px; text-transform:uppercase; letter-spacing:0.6px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
          <span>🎓</span> Qualifications & Practice
        </h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; font-size:13.5px;">
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Medical Degrees & Qualifications</span>
            <strong style="color:var(--text-main);">${p.qualification || 'MBBS, MD (General Medicine)'}</strong>
          </div>
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Medical Council License #</span>
            <strong style="color:var(--accent-blue);">${p.licenseNo || 'MED-REG-58210'}</strong>
          </div>
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Hospital / Affiliation</span>
            <span style="color:var(--text-secondary);">${p.hospital || 'MediCare Metropolitan Hospital'}</span>
          </div>
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Clinical Department</span>
            <span style="color:var(--text-secondary);">${p.department || 'Department of Internal Medicine'}</span>
          </div>
          <div style="grid-column: span 2;">
            <span style="color:var(--text-muted); font-size:12px; display:block;">Official Phone / Pager</span>
            <strong style="color:var(--text-main);">${p.phone || '+1 (555) 432-1001'}</strong>
          </div>
        </div>
      </div>
    `;
  } else if (role === 'pharmacist') {
    html = `
      <!-- Pharmacist Credentials Grid -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:20px;">
        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-purple); --stat-bg:var(--accent-purple-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">📜</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:15px; color:var(--accent-purple);">${p.licenseNo || 'RPH-001'}</div>
            <div class="stat-label">Pharmacy License</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--primary); --stat-bg:var(--primary-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">👥</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:22px;">${p.assignedPatientsCount || 0}</div>
            <div class="stat-label">Patients Served</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-amber); --stat-bg:var(--accent-amber-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">🔄</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:22px;">${p.pendingRefillsCount || 0}</div>
            <div class="stat-label">Pending Refills</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-teal); --stat-bg:var(--accent-teal-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">⏱️</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:16px;">${p.experience || '8 Years'}</div>
            <div class="stat-label">Pharmacy Practice</div>
          </div>
        </div>
      </div>

      <!-- Pharmacy Operations Details -->
      <div style="background:var(--card-bg-alt); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;">
        <h4 style="margin:0 0 12px 0; font-size:13px; text-transform:uppercase; letter-spacing:0.6px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
          <span>💊</span> Pharmacy & Dispensing Unit
        </h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; font-size:13.5px;">
          <div style="grid-column: span 2;">
            <span style="color:var(--text-muted); font-size:12px; display:block;">Primary Dispensary / Facility</span>
            <strong style="color:var(--text-main); font-size:14px;">${p.pharmacyName || 'MediCare Central Clinical Dispensary'}</strong>
          </div>
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Credentials & Degrees</span>
            <span style="color:var(--text-secondary);">${p.qualification || 'Pharm.D, BCPS, RPh'}</span>
          </div>
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Pharmacy Direct Contact</span>
            <strong style="color:var(--text-main);">${p.phone || '+1 (555) 678-2201'}</strong>
          </div>
        </div>
      </div>
    `;
  } else if (role === 'admin') {
    const s = p.systemStats || {};
    html = `
      <!-- Admin Scope Grid -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:12px; margin-bottom:20px;">
        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-blue); --stat-bg:var(--accent-blue-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">🧑</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:22px;">${s.totalPatients || 0}</div>
            <div class="stat-label">Total Patients</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--primary); --stat-bg:var(--primary-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">🩺</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:22px;">${s.totalDoctors || 0}</div>
            <div class="stat-label">Doctors</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-purple); --stat-bg:var(--accent-purple-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">💊</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:22px;">${s.totalPharmacists || 0}</div>
            <div class="stat-label">Pharmacists</div>
          </div>
        </div>

        <div class="stat-card" style="padding:14px; --stat-color:var(--accent-teal); --stat-bg:var(--accent-teal-light); margin:0;">
          <div class="stat-icon" style="width:36px; height:36px; font-size:18px;">📦</div>
          <div class="stat-info">
            <div class="stat-value" style="font-size:22px;">${s.totalMedicines || 0}</div>
            <div class="stat-label">Medicines</div>
          </div>
        </div>
      </div>

      <!-- Admin Identity & Security Clearance -->
      <div style="background:var(--card-bg-alt); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;">
        <h4 style="margin:0 0 12px 0; font-size:13px; text-transform:uppercase; letter-spacing:0.6px; color:var(--text-muted); display:flex; align-items:center; gap:6px;">
          <span>🛡️</span> Administrative Role & Authority
        </h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; font-size:13.5px;">
          <div style="grid-column: span 2;">
            <span style="color:var(--text-muted); font-size:12px; display:block;">Role Title</span>
            <strong style="color:var(--text-main); font-size:14px;">${p.roleTitle || 'Chief Healthcare Systems Administrator'}</strong>
          </div>
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Access & Security Clearance</span>
            <span class="badge" style="background:#0F1B2D; color:white; font-size:11px; padding:3px 8px;">
              ${p.accessLevel || 'Tier-1 Root Clearance'}
            </span>
          </div>
          <div>
            <span style="color:var(--text-muted); font-size:12px; display:block;">Administrative Contact</span>
            <strong style="color:var(--text-main);">${p.phone || '+1 (555) 010-ADMIN'}</strong>
          </div>
          <div style="grid-column: span 2;">
            <span style="color:var(--text-muted); font-size:12px; display:block;">Department</span>
            <span style="color:var(--text-secondary);">${p.department || 'Health Informatics & System Security Infrastructure'}</span>
          </div>
        </div>
      </div>
    `;
  }

  viewEl.innerHTML = html;
}

function toggleProfileEdit() {
  if (!currentProfileData || !currentProfileData.profile) return;
  isEditMode = !isEditMode;

  const viewEl = document.getElementById('profViewMode');
  const editEl = document.getElementById('profEditMode');
  const toggleBtn = document.getElementById('btnToggleEdit');
  const saveBtn = document.getElementById('btnSaveProfile');
  const alertEl = document.getElementById('profAlert');
  const succEl = document.getElementById('profSuccess');

  alertEl.style.display = 'none';
  succEl.style.display = 'none';

  if (!isEditMode) {
    // Switch to view
    viewEl.style.display = 'block';
    editEl.style.display = 'none';
    toggleBtn.textContent = '✏️ Edit Info';
    saveBtn.style.display = 'none';
  } else {
    // Switch to edit
    viewEl.style.display = 'none';
    editEl.style.display = 'block';
    toggleBtn.textContent = '✕ Cancel Edit';
    saveBtn.style.display = 'inline-flex';
    renderProfileEditForm(currentProfileData.profile, currentProfileData.role);
  }
}

function renderProfileEditForm(p, role) {
  const editEl = document.getElementById('profEditMode');
  let formHtml = '';

  if (role === 'patient') {
    formHtml = `
      <form id="profileEditForm" onsubmit="event.preventDefault(); saveProfileChanges();">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group">
            <label>Blood Group</label>
            <select id="edit_bloodGroup">
              ${['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map(bg => `
                <option value="${bg}" ${(p.bloodGroup || 'O+') === bg ? 'selected' : ''}>${bg}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Date of Birth</label>
            <input type="date" id="edit_dateOfBirth" value="${p.dateOfBirth || ''}">
          </div>
          <div class="form-group">
            <label>Height (e.g. 175 cm)</label>
            <input type="text" id="edit_height" value="${p.height || '175 cm'}">
          </div>
          <div class="form-group">
            <label>Weight (e.g. 70 kg)</label>
            <input type="text" id="edit_weight" value="${p.weight || '70 kg'}">
          </div>
          <div class="form-group">
            <label>Phone Number</label>
            <input type="text" id="edit_phone" value="${p.phone || '+1 (555) 234-8891'}">
          </div>
          <div class="form-group">
            <label>Gender</label>
            <select id="edit_gender">
              <option value="Male" ${p.gender === 'Male' ? 'selected' : ''}>Male</option>
              <option value="Female" ${p.gender === 'Female' ? 'selected' : ''}>Female</option>
              <option value="Other" ${p.gender === 'Other' ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <div class="form-group" style="grid-column:span 2;">
            <label>Emergency Contact (Name & Phone)</label>
            <input type="text" id="edit_emergencyContact" value="${p.emergencyContact || ''}">
          </div>
          <div class="form-group" style="grid-column:span 2;">
            <label>Home Address</label>
            <input type="text" id="edit_address" value="${p.address || ''}">
          </div>
          <div class="form-group" style="grid-column:span 2;">
            <label>Medical History Notes</label>
            <textarea id="edit_medicalHistory" rows="2">${p.medicalHistory || ''}</textarea>
          </div>
        </div>
      </form>
    `;
  } else if (role === 'doctor') {
    formHtml = `
      <form id="profileEditForm" onsubmit="event.preventDefault(); saveProfileChanges();">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group">
            <label>Specialization</label>
            <input type="text" id="edit_specialization" value="${p.specialization || ''}">
          </div>
          <div class="form-group">
            <label>Experience</label>
            <input type="text" id="edit_experience" value="${p.experience || ''}">
          </div>
          <div class="form-group">
            <label>Degrees & Qualifications</label>
            <input type="text" id="edit_qualification" value="${p.qualification || ''}">
          </div>
          <div class="form-group">
            <label>License / Registration #</label>
            <input type="text" id="edit_licenseNo" value="${p.licenseNo || ''}">
          </div>
          <div class="form-group">
            <label>Hospital Affiliation</label>
            <input type="text" id="edit_hospital" value="${p.hospital || ''}">
          </div>
          <div class="form-group">
            <label>Department</label>
            <input type="text" id="edit_department" value="${p.department || ''}">
          </div>
          <div class="form-group" style="grid-column:span 2;">
            <label>Direct Phone Number</label>
            <input type="text" id="edit_phone" value="${p.phone || ''}">
          </div>
        </div>
      </form>
    `;
  } else if (role === 'pharmacist') {
    formHtml = `
      <form id="profileEditForm" onsubmit="event.preventDefault(); saveProfileChanges();">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group" style="grid-column:span 2;">
            <label>Dispensary / Pharmacy Name</label>
            <input type="text" id="edit_pharmacyName" value="${p.pharmacyName || ''}">
          </div>
          <div class="form-group">
            <label>License Number</label>
            <input type="text" id="edit_licenseNo" value="${p.licenseNo || ''}">
          </div>
          <div class="form-group">
            <label>Degrees & Qualifications</label>
            <input type="text" id="edit_qualification" value="${p.qualification || ''}">
          </div>
          <div class="form-group">
            <label>Practice Experience</label>
            <input type="text" id="edit_experience" value="${p.experience || ''}">
          </div>
          <div class="form-group">
            <label>Pharmacy Phone Number</label>
            <input type="text" id="edit_phone" value="${p.phone || ''}">
          </div>
        </div>
      </form>
    `;
  } else if (role === 'admin') {
    formHtml = `
      <form id="profileEditForm" onsubmit="event.preventDefault(); saveProfileChanges();">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group" style="grid-column:span 2;">
            <label>Role Title</label>
            <input type="text" id="edit_roleTitle" value="${p.roleTitle || ''}">
          </div>
          <div class="form-group">
            <label>Department</label>
            <input type="text" id="edit_department" value="${p.department || ''}">
          </div>
          <div class="form-group">
            <label>Admin Hotline / Phone</label>
            <input type="text" id="edit_phone" value="${p.phone || ''}">
          </div>
        </div>
      </form>
    `;
  }

  editEl.innerHTML = formHtml;
}

async function saveProfileChanges() {
  if (!currentProfileData || !currentProfileData.role) return;
  const role = currentProfileData.role;
  const saveBtn = document.getElementById('btnSaveProfile');
  const alertEl = document.getElementById('profAlert');
  const succEl = document.getElementById('profSuccess');

  alertEl.style.display = 'none';
  succEl.style.display = 'none';

  const body = {};
  const fieldIds = {
    patient: ['phone', 'bloodGroup', 'dateOfBirth', 'height', 'weight', 'gender', 'emergencyContact', 'address', 'medicalHistory'],
    doctor: ['phone', 'specialization', 'qualification', 'experience', 'licenseNo', 'department', 'hospital'],
    pharmacist: ['phone', 'pharmacyName', 'qualification', 'experience', 'licenseNo'],
    admin: ['phone', 'roleTitle', 'department']
  }[role] || [];

  fieldIds.forEach(f => {
    const el = document.getElementById(`edit_${f}`);
    if (el) body[f] = el.value.trim();
  });

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const res = await API.put('/auth/profile', body);
    succEl.textContent = res.message || 'Profile updated successfully!';
    succEl.style.display = 'block';

    // Refresh profile data
    const updated = await API.get('/auth/profile');
    currentProfileData = updated;

    setTimeout(() => {
      toggleProfileEdit();
      renderProfileView(updated.profile, updated.role);
    }, 600);
  } catch (err) {
    alertEl.textContent = err.message || 'Failed to update profile changes.';
    alertEl.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save Changes';
  }
}
