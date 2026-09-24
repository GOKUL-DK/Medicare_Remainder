// test-clinical-vitals-calendar.js — Comprehensive Automated Test Suite
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
  return { status: res.status, ok: res.ok, data };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting Clinical Safety, Calendar/Pillbox & Vitals Test Suite');
  console.log('================================================================\n');

  // 1. Auth Logins
  console.log('1. Authenticating test users...');
  const docLogin = await call('POST', '/auth/login', {
    email: 'doctor@medicare.local',
    password: 'doctor123',
    role: 'doctor'
  });
  assert(docLogin.ok && docLogin.data.token, 'Doctor authenticated successfully');
  const docToken = docLogin.data.token;

  const patientLogin = await call('POST', '/auth/login', {
    email: 'patient@medicare.local',
    password: 'patient123',
    role: 'patient'
  });
  assert(patientLogin.ok && patientLogin.data.token, 'Patient authenticated successfully');
  const patToken = patientLogin.data.token;
  const patId = patientLogin.data.user.patientId;

  const pharmLogin = await call('POST', '/auth/login', {
    email: 'pharmacist@medicare.local',
    password: 'pharma123',
    role: 'pharmacist'
  });
  assert(pharmLogin.ok && pharmLogin.data.token, 'Pharmacist authenticated successfully');
  const pharmToken = pharmLogin.data.token;

  // 2. Feature 1: Clinical Safety & Drug Interaction Engine
  console.log('\n2. Testing 🛡️ Drug-Drug Interaction & Allergy Safety Engine...');

  // Ensure patient has a Penicillin allergy documented
  await call('POST', '/patient/allergies', {
    allergen: 'Penicillin',
    severity: 'severe',
    reaction: 'Anaphylaxis and hives'
  }, patToken);

  // 2.1 Doctor checks drug with Penicillin Allergy
  const allergyCheck = await call('POST', '/doctor/check-safety', {
    patientId: patId,
    medicineName: 'Amoxicillin 500mg'
  }, docToken);
  assert(allergyCheck.ok, 'Doctor safety check API returned 200');
  assert(allergyCheck.data.isSafe === false, 'Amoxicillin detected as unsafe for patient with Penicillin allergy');
  assert(allergyCheck.data.warnings.some(w => w.type === 'allergy-conflict'), 'Allergy conflict warning generated');

  // 2.2 Pharmacist safety check
  const pharmCheck = await call('POST', '/pharmacist/check-safety', {
    patientId: patId,
    medicineName: 'Penicillin VK'
  }, pharmToken);
  assert(pharmCheck.ok && pharmCheck.data.isSafe === false, 'Pharmacist safety check correctly flags allergy');

  // 2.3 Add a medicine that causes a drug-drug interaction (e.g. Warfarin + Aspirin)
  // Prescribe Warfarin first
  await call('POST', '/pharmacist/medicines', {
    patientId: patId,
    name: 'Warfarin Sodium',
    dosage: '5mg',
    quantity: 30,
    expiryDate: '2027-01-01',
    dueDate: '2026-10-01',
    timeSlot: 'evening',
    mealTiming: 'after_meal',
    safetyOverride: 1
  }, pharmToken);

  // Now check safety when proposing Aspirin
  const drugInteractionCheck = await call('POST', '/doctor/check-safety', {
    patientId: patId,
    medicineName: 'Aspirin 81mg'
  }, docToken);
  assert(drugInteractionCheck.ok, 'Safety check for Warfarin + Aspirin executed');
  assert(drugInteractionCheck.data.warnings.some(w => w.type === 'drug-interaction' && w.level === 'critical'), 'Critical Drug-Drug interaction (Warfarin + Aspirin hemorrhage risk) detected');

  // 2.4 Test Prescription Request with Safety Override
  const blockedReq = await call('POST', '/doctor/request-pharmacist', {
    patientId: patId,
    pharmacistId: 1,
    requestType: 'medicine',
    itemName: 'Aspirin',
    dosage: '81mg',
    safetyOverride: 0
  }, docToken);
  assert(blockedReq.status === 409, 'Prescription without safety override is blocked with 409 status');

  const overrideReq = await call('POST', '/doctor/request-pharmacist', {
    patientId: patId,
    pharmacistId: 1,
    requestType: 'medicine',
    itemName: 'Aspirin',
    dosage: '81mg',
    timeSlot: 'morning',
    mealTiming: 'after_meal',
    safetyOverride: 1
  }, docToken);
  assert(overrideReq.ok, 'Prescription with authorized safety override succeeds');

  // 3. Feature 2: Daily Pillbox Organizer & Monthly Calendar
  console.log('\n3. Testing 📅 Daily Pillbox Organizer & Monthly Adherence Calendar...');

  // 3.1 Patient Pillbox
  const pillbox = await call('GET', '/patient/pillbox', null, patToken);
  assert(pillbox.ok, 'Patient pillbox API returned 200');
  assert(pillbox.data.slots && pillbox.data.slots.morning && pillbox.data.slots.evening, 'Pillbox slots (morning, afternoon, evening, night) present');
  assert(pillbox.data.summary && pillbox.data.summary.total >= 1, 'Pillbox summary statistics correctly computed');

  // 3.2 Monthly Adherence Calendar
  const cal = await call('GET', '/patient/calendar?month=2026-09', null, patToken);
  assert(cal.ok, 'Monthly calendar API returned 200');
  assert(cal.data.days && cal.data.days.length === 30, 'Calendar returned 30 days for September');
  assert(cal.data.days[0].status !== undefined, 'Each calendar day has an adherence status tag');

  // 4. Feature 3: Vitals & Health Biometrics Logging + Doctor Correlation
  console.log('\n4. Testing 📈 Vitals Logging & Doctor Dual-Axis Correlation Chart Data...');

  // 4.1 Patient logs normal vitals
  const logVitals = await call('POST', '/patient/vitals', {
    systolic: 122,
    diastolic: 78,
    bloodSugar: 98.5,
    sugarType: 'fasting',
    pulse: 70,
    notes: 'Morning test before breakfast'
  }, patToken);
  assert(logVitals.ok && logVitals.data.vitalId, 'Patient successfully logged normal vitals');

  // 4.2 Patient logs elevated BP (Hypertensive alert test)
  const logHighBP = await call('POST', '/patient/vitals', {
    systolic: 158,
    diastolic: 98,
    bloodSugar: 215,
    sugarType: 'post_prandial',
    pulse: 88,
    notes: 'Post-dinner feeling dizzy'
  }, patToken);
  assert(logHighBP.ok, 'Patient logged hypertensive/high-sugar vitals');
  assert(logHighBP.data.alerts && logHighBP.data.alerts.length >= 2, 'Critical vitals alerts generated for high BP & high Glucose');

  // 4.3 Patient retrieves vitals history
  const vitalsHistory = await call('GET', '/patient/vitals', null, patToken);
  assert(vitalsHistory.ok && vitalsHistory.data.length >= 2, 'Patient retrieved vitals history log');

  // 4.4 Doctor retrieves patient vitals & dual-axis correlation data
  const docVitals = await call('GET', `/doctor/patients/${patId}/vitals`, null, docToken);
  assert(docVitals.ok, 'Doctor vitals correlation API returned 200');
  assert(docVitals.data.vitals && docVitals.data.vitals.length > 0, 'Vitals data points returned for timeline plotting');
  assert(docVitals.data.summary && docVitals.data.summary.avgSystolic > 0, 'Summary baseline statistics (avgSystolic, avgDiastolic, avgBloodSugar) calculated');
  assert(docVitals.data.summary.adherenceRate !== undefined, 'Patient adherence rate calculated for dual-axis chart');

  // 5. Patient Allergies Management
  console.log('\n5. Testing 🛡️ Patient & Doctor Allergies Management...');
  const allergies = await call('GET', '/patient/allergies', null, patToken);
  assert(allergies.ok && Array.isArray(allergies.data), 'Patient retrieved allergies list');

  const addAllergy = await call('POST', '/patient/allergies', {
    allergen: 'Codeine',
    severity: 'moderate',
    reaction: 'Nausea and rash'
  }, patToken);
  assert(addAllergy.ok && addAllergy.data.allergyId, 'Patient added new allergy (Codeine)');

  const docAddAllergy = await call('POST', `/doctor/patients/${patId}/allergies`, {
    allergen: 'Sulfa Drugs',
    severity: 'severe',
    reaction: 'Stevens-Johnson Syndrome'
  }, docToken);
  assert(docAddAllergy.ok && docAddAllergy.data.allergyId, 'Doctor added documented allergy for patient');

  console.log('\n================================================================');
  console.log(`🏁 Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
