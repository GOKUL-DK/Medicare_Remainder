const BASE = 'http://localhost:3000/api';

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS: ${label}`); pass++; }
  else { console.log(`  FAIL: ${label}`); fail++; }
}

(async () => {
  try {
    console.log('1. Admin login');
    const adminLogin = await call('POST', '/auth/login', { email: 'admin@medicare.local', password: 'admin123', role: 'admin' });
    check('admin token received', !!adminLogin.token);
    const adminToken = adminLogin.token;

    console.log('2. Admin creates Doctor, Pharmacist, Patient');
    const doc = await call('POST', '/admin/users/doctor', { name: 'Dr. Rao', email: 'rao@medicare.local', password: 'pass123', specialization: 'General Medicine' }, adminToken);
    check('doctor created', !!doc.id);

    const pharm = await call('POST', '/admin/users/pharmacist', { name: 'Pharma Priya', email: 'priya@medicare.local', password: 'pass123', licenseNo: 'LIC001' }, adminToken);
    check('pharmacist created', !!pharm.id);

    const pat = await call('POST', '/admin/users/patient', { name: 'Gokul', email: 'gokul@medicare.local', password: 'pass123', dateOfBirth: '2003-05-01', medicalHistory: 'None', doctorId: doc.id, pharmacistId: pharm.id }, adminToken);
    check('patient created', !!pat.id);

    console.log('3. Admin manages vaccine list & threshold');
    const vax = await call('POST', '/admin/vaccine-list', { vaccineName: 'Hepatitis B' }, adminToken);
    check('vaccine added to master list', !!vax.id);
    await call('PUT', '/admin/settings/threshold', { notifyThresholdDays: 5 }, adminToken);
    const settings = await call('GET', '/admin/settings', null, adminToken);
    check('threshold updated', settings.notifyThresholdDays === 5);

    console.log('4. Pharmacist login + operations');
    const pharmLogin = await call('POST', '/auth/login', { email: 'priya@medicare.local', password: 'pass123', role: 'pharmacist' });
    const pharmToken = pharmLogin.token;
    check('pharmacist token received', !!pharmToken);

    const searchResults = await call('GET', `/pharmacist/patients/search?q=Gokul`, null, pharmToken);
    check('searchPatient finds Gokul', searchResults.some((p) => p.name === 'Gokul'));

    const assignedPatients = await call('GET', '/pharmacist/patients', null, pharmToken);
    check('viewAssignedPatients returns Gokul', assignedPatients.length === 1);

    const pastDueMed = await call('POST', '/pharmacist/medicines', {
      patientId: pat.id, doctorId: doc.id, name: 'Paracetamol', dosage: '500mg',
      quantity: 10, expiryDate: '2027-01-01', dueDate: '2020-01-01', // deliberately overdue
    }, pharmToken);
    check('addMedicine (overdue test case) created', !!pastDueMed.id);

    const futureMed = await call('POST', '/pharmacist/medicines', {
      patientId: pat.id, doctorId: doc.id, name: 'Vitamin D', dosage: '1000IU',
      quantity: 30, expiryDate: '2027-06-01', dueDate: '2027-06-01',
    }, pharmToken);
    check('addMedicine (future) created', !!futureMed.id);

    await call('PUT', `/pharmacist/medicines/${futureMed.id}`, { dosage: '2000IU' }, pharmToken);
    const medsAfterUpdate = await call('GET', '/pharmacist/medicines', null, pharmToken);
    check('updateMedicine reflects new dosage', medsAfterUpdate.find((m) => m.medicineId === futureMed.id).dosage === '2000IU');

    const vaxSchedule = await call('POST', '/pharmacist/vaccinations', { patientId: pat.id, vaccineName: 'Hepatitis B', dueDate: '2027-06-01' }, pharmToken);
    check('addVaccination created', !!vaxSchedule.id);

    console.log('5. Patient login + operations');
    const patLogin = await call('POST', '/auth/login', { email: 'gokul@medicare.local', password: 'pass123', role: 'patient' });
    const patToken = patLogin.token;
    check('patient token received', !!patToken);

    const dashboard = await call('GET', '/patient/dashboard', null, patToken);
    check('viewDashboard returns patient info', dashboard.patient.name === 'Gokul');

    const patMeds = await call('GET', '/patient/medicines', null, patToken);
    check('viewPrescribedMedicines returns 2 medicines', patMeds.length === 2);

    const markResult = await call('PUT', `/patient/medicines/${futureMed.id}/taken`, null, patToken);
    check('markMedicineTaken (on time) works', markResult.onTime === true);

    const notifs = await call('GET', '/patient/notifications', null, patToken);
    check('viewNotificationHistory returns reminders', notifs.length >= 2);

    console.log('6. Adherence monitor background job (manual trigger via require)');
    const { checkAndFlagMissed } = require('./services/adherenceMonitor');
    checkAndFlagMissed();
    const medsAfterMonitor = await call('GET', '/pharmacist/medicines', null, pharmToken);
    const overdueOne = medsAfterMonitor.find((m) => m.medicineId === pastDueMed.id);
    check('overdue medicine flagged as missed', overdueOne.status === 'missed');

    console.log('7. Doctor login + operations');
    const docLogin = await call('POST', '/auth/login', { email: 'rao@medicare.local', password: 'pass123', role: 'doctor' });
    const docToken = docLogin.token;
    check('doctor token received', !!docToken);

    const docPatients = await call('GET', '/doctor/patients', null, docToken);
    check('viewAssignedPatients (doctor) returns Gokul', docPatients.length === 1);

    const behind = await call('GET', '/doctor/patients/behind-schedule', null, docToken);
    check('viewBehindSchedulePatients flags Gokul', behind.some((p) => p.patientId === pat.id));

    const adherence = await call('GET', `/doctor/patients/${pat.id}/adherence`, null, docToken);
    check('monitorAdherence returns rate', typeof adherence.adherenceRate === 'number');

    const alerts = await call('GET', '/doctor/alerts', null, docToken);
    check('receiveAlert shows missed-dose alert', alerts.some((a) => a.message.includes('Missed dose')));

    const history = await call('GET', `/doctor/patients/${pat.id}/history`, null, docToken);
    check('viewAdherenceHistory returns records', history.medicineHistory.length >= 1);

    console.log('8. Admin reports reflect activity');
    const reports = await call('GET', '/admin/reports', null, adminToken);
    check('viewSystemReports shows correct counts', reports.totalPatients === 1 && reports.missedMedicines >= 1);

    console.log('9. Password reset');
    await call('POST', '/auth/reset-password', { role: 'patient', email: 'gokul@medicare.local', newPassword: 'newpass456' });
    const reLogin = await call('POST', '/auth/login', { email: 'gokul@medicare.local', password: 'newpass456', role: 'patient' });
    check('resetPassword allows login with new password', !!reLogin.token);

    console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (err) {
    console.error('TEST SCRIPT ERROR:', err.message);
    process.exit(1);
  }
})();
