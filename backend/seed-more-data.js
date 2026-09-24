const BASE = 'http://localhost:3000/api';

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function tryCall(method, path, body, token) {
  try {
    return await call(method, path, body, token);
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('=== Starting Comprehensive Seeding & Multi-Doctor Verification ===\n');

  // 1. Admin login
  console.log('1. Logging in as Admin...');
  const adminLogin = await call('POST', '/auth/login', {
    email: 'admin@medicare.local',
    password: 'admin123',
    role: 'admin'
  });
  const adminToken = adminLogin.token;
  console.log('   Admin logged in successfully.');

  // 2. Add extra doctors
  console.log('\n2. Creating / Ensuring Doctors exist...');
  const doctorsToCreate = [
    { name: 'Dr. Sarah Johnson', email: 'dr.johnson@medicare.local', password: 'doc123', specialization: 'Cardiology' },
    { name: 'Dr. Robert Chen', email: 'dr.chen@medicare.local', password: 'doc123', specialization: 'Endocrinology' },
    { name: 'Dr. Emily Davis', email: 'dr.davis@medicare.local', password: 'doc123', specialization: 'Internal Medicine & Pediatrics' }
  ];

  for (const doc of doctorsToCreate) {
    await tryCall('POST', '/admin/users/doctor', doc, adminToken);
  }

  // Fetch all doctors
  const doctorsList = await call('GET', '/admin/users/doctor', null, adminToken);
  console.log(`   Total doctors now in system: ${doctorsList.length}`);
  doctorsList.forEach(d => console.log(`   - [ID ${d.doctorId}] ${d.name} (${d.specialization}) - ${d.email}`));

  // 3. Add extra pharmacist
  console.log('\n3. Creating / Ensuring Pharmacists exist...');
  await tryCall('POST', '/admin/users/pharmacist', {
    name: 'Pharma Sarah',
    email: 'pharma.sarah@medicare.local',
    password: 'pharma123',
    licenseNo: 'PH-002'
  }, adminToken);

  const pharmacistsList = await call('GET', '/admin/users/pharmacist', null, adminToken);
  console.log(`   Total pharmacists: ${pharmacistsList.length}`);
  pharmacistsList.forEach(p => console.log(`   - [ID ${p.pharmacistId}] ${p.name} - ${p.email}`));

  const pharm1 = pharmacistsList[0];
  const pharm2 = pharmacistsList[1] || pharmacistsList[0];

  // Helper to find doctor ID by email
  const getDocId = (email) => {
    const found = doctorsList.find(d => d.email.toLowerCase() === email.toLowerCase());
    return found ? found.doctorId : doctorsList[0].doctorId;
  };

  const drSmithId = getDocId('doctor@medicare.local');
  const drJohnsonId = getDocId('dr.johnson@medicare.local');
  const drChenId = getDocId('dr.chen@medicare.local');
  const drDavisId = getDocId('dr.davis@medicare.local');

  // 4. Create patients assigned to doctors (multiple patients per doctor)
  console.log('\n4. Creating / Ensuring Multiple Patients per Doctor...');
  const newPatients = [
    // Assigned to Dr. Smith
    { name: 'Alice Walker', email: 'alice@medicare.local', password: 'patient123', dateOfBirth: '1988-03-22', medicalHistory: 'Asthma, Inhaler user', docId: drSmithId, pharmId: pharm1.pharmacistId },
    { name: 'Michael Brown', email: 'michael@medicare.local', password: 'patient123', dateOfBirth: '1975-11-09', medicalHistory: 'Chronic Migraine & Hypertension', docId: drSmithId, pharmId: pharm1.pharmacistId },

    // Assigned to Dr. Sarah Johnson (Cardiology)
    { name: 'David Miller', email: 'david@medicare.local', password: 'patient123', dateOfBirth: '1968-07-14', medicalHistory: 'Coronary Artery Disease, Post-angioplasty', docId: drJohnsonId, pharmId: pharm1.pharmacistId },
    { name: 'Sophia Wilson', email: 'sophia@medicare.local', password: 'patient123', dateOfBirth: '1982-12-05', medicalHistory: 'Cardiac Arrhythmia & High Cholesterol', docId: drJohnsonId, pharmId: pharm2.pharmacistId },

    // Assigned to Dr. Robert Chen (Endocrinology)
    { name: 'James Anderson', email: 'james@medicare.local', password: 'patient123', dateOfBirth: '1979-09-30', medicalHistory: 'Type 2 Diabetes, Neuropathy', docId: drChenId, pharmId: pharm2.pharmacistId },
    { name: 'Emma Taylor', email: 'emma@medicare.local', password: 'patient123', dateOfBirth: '1995-04-18', medicalHistory: 'Hypothyroidism, Iron Deficiency', docId: drChenId, pharmId: pharm2.pharmacistId },

    // Assigned to Dr. Emily Davis (Pediatrics & Internal Med)
    { name: 'Lucas Martinez', email: 'lucas@medicare.local', password: 'patient123', dateOfBirth: '2005-08-20', medicalHistory: 'Seasonal Allergies & Eczema', docId: drDavisId, pharmId: pharm1.pharmacistId }
  ];

  for (const p of newPatients) {
    const res = await tryCall('POST', '/admin/users/patient', {
      name: p.name,
      email: p.email,
      password: p.password,
      dateOfBirth: p.dateOfBirth,
      medicalHistory: p.medicalHistory,
      doctorId: p.docId,
      pharmacistId: p.pharmId
    }, adminToken);
  }

  // Get all patients
  const patientsList = await call('GET', '/admin/users/patient', null, adminToken);
  console.log(`   Total patients now: ${patientsList.length}`);
  for (const p of patientsList) {
    // Ensure doctorId and pharmacistId are set
    const match = newPatients.find(np => np.email === p.email);
    if (match) {
      await tryCall('PUT', '/admin/assign-doctor', { patientId: p.patientId, doctorId: match.docId }, adminToken);
      await tryCall('PUT', '/admin/assign-pharmacist', { patientId: p.patientId, pharmacistId: match.pharmId }, adminToken);
    }
    console.log(`   - [ID ${p.patientId}] ${p.name} (${p.email}) -> Doctor ID ${p.doctorId || match?.docId}, Pharmacist ID ${p.pharmacistId || match?.pharmId}`);
  }

  // 5. Login as Pharmacist and prescribe medicines and vaccinations
  console.log('\n5. Prescribing Medicines & Vaccinations for All Patients...');
  const pharmLogin = await call('POST', '/auth/login', {
    email: pharm1.email,
    password: 'pharma123',
    role: 'pharmacist'
  });
  const pharmToken = pharmLogin.token;

  // Helper dates:
  const today = new Date();
  const dateStr = (offsetDays) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
  };

  const samplePrescriptions = [
    // Alice Walker (Dr. Smith) - Patient with some pending & overdue
    { patientEmail: 'alice@medicare.local', meds: [
      { name: 'Albuterol Inhaler', dosage: '90mcg (2 puffs)', quantity: 1, expiryDate: dateStr(180), dueDate: dateStr(-3) }, // Overdue!
      { name: 'Fluticasone Propionate', dosage: '50mcg', quantity: 1, expiryDate: dateStr(240), dueDate: dateStr(2) },
      { name: 'Montelukast', dosage: '10mg', quantity: 30, expiryDate: dateStr(365), dueDate: dateStr(4) }
    ], vax: [
      { vaccineName: 'Influenza', dueDate: dateStr(-10) }, // Overdue vax!
      { vaccineName: 'COVID-19 Booster', dueDate: dateStr(30) }
    ]},

    // Michael Brown (Dr. Smith) - High adherence
    { patientEmail: 'michael@medicare.local', meds: [
      { name: 'Sumatriptan', dosage: '50mg', quantity: 12, expiryDate: dateStr(300), dueDate: dateStr(3) },
      { name: 'Propranolol', dosage: '40mg', quantity: 60, expiryDate: dateStr(200), dueDate: dateStr(1) }
    ], vax: [
      { vaccineName: 'Tetanus', dueDate: dateStr(60) }
    ]},

    // David Miller (Dr. Sarah Johnson) - Has overdue heart medicine (behind schedule)
    { patientEmail: 'david@medicare.local', meds: [
      { name: 'Clopidogrel', dosage: '75mg', quantity: 30, expiryDate: dateStr(120), dueDate: dateStr(-2) }, // Overdue!
      { name: 'Rosuvastatin', dosage: '20mg', quantity: 30, expiryDate: dateStr(150), dueDate: dateStr(-4) }, // Overdue!
      { name: 'Metoprolol Tartrate', dosage: '25mg', quantity: 60, expiryDate: dateStr(200), dueDate: dateStr(5) }
    ], vax: [
      { vaccineName: 'Pneumococcal', dueDate: dateStr(45) }
    ]},

    // Sophia Wilson (Dr. Sarah Johnson) - Good adherence
    { patientEmail: 'sophia@medicare.local', meds: [
      { name: 'Flecainide', dosage: '50mg', quantity: 60, expiryDate: dateStr(300), dueDate: dateStr(2) },
      { name: 'Losartan', dosage: '50mg', quantity: 30, expiryDate: dateStr(250), dueDate: dateStr(3) }
    ], vax: [
      { vaccineName: 'Influenza', dueDate: dateStr(15) }
    ]},

    // James Anderson (Dr. Robert Chen) - Diabetes patient with overdue insulin/metformin
    { patientEmail: 'james@medicare.local', meds: [
      { name: 'Insulin Glargine', dosage: '20 units at bedtime', quantity: 3, expiryDate: dateStr(90), dueDate: dateStr(-1) }, // Overdue!
      { name: 'Jardiance (Empagliflozin)', dosage: '10mg', quantity: 30, expiryDate: dateStr(180), dueDate: dateStr(1) },
      { name: 'Gabapentin', dosage: '300mg', quantity: 90, expiryDate: dateStr(210), dueDate: dateStr(6) }
    ], vax: [
      { vaccineName: 'Hepatitis B', dueDate: dateStr(-5) } // Overdue vax!
    ]},

    // Emma Taylor (Dr. Robert Chen)
    { patientEmail: 'emma@medicare.local', meds: [
      { name: 'Levothyroxine', dosage: '75mcg', quantity: 90, expiryDate: dateStr(360), dueDate: dateStr(3) },
      { name: 'Ferrous Sulfate', dosage: '325mg', quantity: 60, expiryDate: dateStr(270), dueDate: dateStr(4) }
    ], vax: [
      { vaccineName: 'COVID-19 Booster', dueDate: dateStr(25) }
    ]},

    // Lucas Martinez (Dr. Emily Davis)
    { patientEmail: 'lucas@medicare.local', meds: [
      { name: 'Cetirizine', dosage: '10mg', quantity: 30, expiryDate: dateStr(365), dueDate: dateStr(2) },
      { name: 'Hydrocortisone Cream 1%', dosage: 'Apply twice daily', quantity: 1, expiryDate: dateStr(180), dueDate: dateStr(5) }
    ], vax: [
      { vaccineName: 'Tetanus', dueDate: dateStr(90) }
    ]}
  ];

  for (const item of samplePrescriptions) {
    const pat = patientsList.find(p => p.email === item.patientEmail);
    if (!pat) continue;

    for (const med of item.meds) {
      await tryCall('POST', '/pharmacist/medicines', {
        patientId: pat.patientId,
        doctorId: pat.doctorId,
        name: med.name,
        dosage: med.dosage,
        quantity: med.quantity,
        expiryDate: med.expiryDate,
        dueDate: med.dueDate
      }, pharmToken);
    }

    for (const v of item.vax) {
      await tryCall('POST', '/pharmacist/vaccinations', {
        patientId: pat.patientId,
        vaccineName: v.vaccineName,
        dueDate: v.dueDate
      }, pharmToken);
    }
  }
  console.log('   Prescriptions & vaccines added for all patients.');

  // 6. Simulate some patients taking their medicines (some on time, some late)
  console.log('\n6. Simulating Patient Actions (Marking Taken)...');

  // Michael Brown takes his medicine on time
  const mbUser = patientsList.find(p => p.email === 'michael@medicare.local');
  if (mbUser) {
    const mbLogin = await call('POST', '/auth/login', { email: mbUser.email, password: 'patient123', role: 'patient' });
    const mbMeds = await call('GET', '/patient/medicines', null, mbLogin.token);
    if (mbMeds.length > 0) {
      await call('PUT', `/patient/medicines/${mbMeds[0].medicineId}/taken`, null, mbLogin.token);
      console.log(`   Patient Michael Brown marked medicine [${mbMeds[0].name}] taken.`);
    }
  }

  // Sophia Wilson takes her medicine on time
  const swUser = patientsList.find(p => p.email === 'sophia@medicare.local');
  if (swUser) {
    const swLogin = await call('POST', '/auth/login', { email: swUser.email, password: 'patient123', role: 'patient' });
    const swMeds = await call('GET', '/patient/medicines', null, swLogin.token);
    if (swMeds.length > 0) {
      await call('PUT', `/patient/medicines/${swMeds[0].medicineId}/taken`, null, swLogin.token);
      console.log(`   Patient Sophia Wilson marked medicine [${swMeds[0].name}] taken.`);
    }
  }

  // 7. Verify Each Doctor's View (Multiple Patients, Behind Schedule, Alerts)
  console.log('\n======================================================');
  console.log('7. Verifying Each Doctor Dashboard & Patient Progress:');
  console.log('======================================================\n');

  const doctorLogins = [
    { email: 'doctor@medicare.local', pass: 'doctor123', name: 'Dr. Smith (General Medicine)' },
    { email: 'dr.johnson@medicare.local', pass: 'doc123', name: 'Dr. Sarah Johnson (Cardiology)' },
    { email: 'dr.chen@medicare.local', pass: 'doc123', name: 'Dr. Robert Chen (Endocrinology)' },
    { email: 'dr.davis@medicare.local', pass: 'doc123', name: 'Dr. Emily Davis (Pediatrics)' }
  ];

  for (const docInfo of doctorLogins) {
    console.log(`--- Checking [${docInfo.name}] ---`);
    const docLogin = await call('POST', '/auth/login', { email: docInfo.email, password: docInfo.pass, role: 'doctor' });
    const docToken = docLogin.token;

    // View Assigned Patients
    const assigned = await call('GET', '/doctor/patients', null, docToken);
    console.log(`  Assigned Patients (${assigned.length}):`);
    assigned.forEach(p => console.log(`    * [ID ${p.patientId}] ${p.name} | History: ${p.medicalHistory || 'N/A'}`));

    // View Behind Schedule Patients
    const behind = await call('GET', '/doctor/patients/behind-schedule', null, docToken);
    console.log(`  Patients Behind Schedule (${behind.length}):`);
    if (behind.length === 0) {
      console.log(`    (None currently behind schedule)`);
    } else {
      behind.forEach(p => console.log(`    * ⚠️ [ID ${p.patientId}] ${p.name} (${p.email})`));
    }

    // Check adherence details for each assigned patient
    for (const p of assigned) {
      const adh = await call('GET', `/doctor/patients/${p.patientId}/adherence`, null, docToken);
      console.log(`    -> Patient ${p.name}: Adherence = ${adh.adherenceRate}%, Total Meds = ${adh.totalMedicines}, Missed/Late = ${adh.missedCount || adh.missed}`);
    }

    // View Alerts
    const alerts = await call('GET', '/doctor/alerts', null, docToken);
    console.log(`  Alerts Received (${alerts.length}):`);
    alerts.slice(0, 3).forEach(a => console.log(`    * [${a.patientName}]: ${a.message}`));
    console.log('');
  }

  // 8. Admin system reports
  console.log('8. Admin System Overview Report:');
  const report = await call('GET', '/admin/reports', null, adminToken);
  console.log(`  Total Patients:        ${report.totalPatients}`);
  console.log(`  Total Doctors:         ${report.totalDoctors}`);
  console.log(`  Total Pharmacists:     ${report.totalPharmacists}`);
  console.log(`  Total Medicines:       ${report.totalMedicines}`);
  console.log(`  Total Vaccines Due:    ${report.totalVaccinesDue}`);
  console.log(`  Missed Doses:          ${report.missedMedicines}`);

  console.log('\n=== All seeding and multi-doctor checks completed successfully! ===');
}

main().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
