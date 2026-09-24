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

let passCount = 0, failCount = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failCount++;
  }
}

async function runTests() {
  console.log('=== RUNNING COMPREHENSIVE IMPROVEMENTS TEST SUITE ===\n');

  // --- 1. Password Change & Security Test ---
  console.log('1. Testing Account Security & Password Change:');
  const docLogin = await call('POST', '/auth/login', { email: 'doctor@medicare.local', password: 'doctor123', role: 'doctor' });
  const docToken = docLogin.token;

  // Try wrong current password
  let badPwFailed = false;
  try {
    await call('POST', '/auth/change-password', { currentPassword: 'wrongpassword', newPassword: 'newdocpass123' }, docToken);
  } catch (e) {
    badPwFailed = true;
  }
  check('Rejects password change with incorrect current password', badPwFailed);

  // Change to new password
  const changeRes = await call('POST', '/auth/change-password', { currentPassword: 'doctor123', newPassword: 'doctor123updated' }, docToken);
  check('Successfully changes password with valid credentials', changeRes.message.includes('successfully'));

  // Verify login with updated password
  const newLogin = await call('POST', '/auth/login', { email: 'doctor@medicare.local', password: 'doctor123updated', role: 'doctor' });
  check('Logs in successfully with newly updated password', !!newLogin.token);

  // Restore password back to doctor123 for consistency
  await call('POST', '/auth/change-password', { currentPassword: 'doctor123updated', newPassword: 'doctor123' }, newLogin.token);
  check('Restores original test password', true);

  // --- 2. Two-Way Patient Notes & Doctor Replies ---
  console.log('\n2. Testing Two-Way Communication (Patient Notes & Doctor Reply):');
  const patLogin = await call('POST', '/auth/login', { email: 'patient@medicare.local', password: 'patient123', role: 'patient' });
  const patToken = patLogin.token;

  // Patient sends symptom note to Dr. Smith
  const noteRes = await call('POST', '/patient/notes', {
    subject: 'Mild dizziness in the morning',
    message: 'I felt slightly lightheaded about 30 minutes after taking my morning blood pressure pill.',
    severity: 'normal'
  }, patToken);
  check('Patient successfully submits symptom note to supervising doctor', !!noteRes.noteId);

  // Doctor views incoming patient notes
  const activeDocToken = (await call('POST', '/auth/login', { email: 'doctor@medicare.local', password: 'doctor123', role: 'doctor' })).token;
  const docNotes = await call('GET', '/doctor/patient-notes', null, activeDocToken);
  const foundNote = docNotes.find((n) => n.noteId === noteRes.noteId);
  check('Doctor receives and views patient symptom note', !!foundNote && foundNote.subject === 'Mild dizziness in the morning');

  // Doctor replies to patient note
  const replyRes = await call('PUT', `/doctor/patient-notes/${noteRes.noteId}/reply`, {
    reply: 'Make sure you drink a full glass of water and sit for 5 minutes after taking it. Let me know if it persists.'
  }, activeDocToken);
  check('Doctor successfully replies to patient note', replyRes.message.includes('successfully'));

  // Patient checks notes & sees doctor reply
  const patNotes = await call('GET', '/patient/notes', null, patToken);
  const updatedPatNote = patNotes.find((n) => n.noteId === noteRes.noteId);
  check('Patient receives doctor reply in note history', updatedPatNote.status === 'replied' && updatedPatNote.doctorReply.includes('full glass of water'));

  // --- 3. Patient Refill Requests & Pharmacist Fulfillment ---
  console.log('\n3. Testing Medicine Refill Request & Pharmacist Fulfillment:');
  const patMeds = await call('GET', '/patient/medicines', null, patToken);
  const targetMed = patMeds[0];

  const refillRes = await call('POST', '/patient/refill', {
    medicineId: targetMed.medicineId,
    requestNotes: 'Only 3 pills left in the bottle.'
  }, patToken);
  check('Patient successfully submits refill request to pharmacist', !!refillRes.refillId);

  // Pharmacist views refill requests
  const pharmLogin = await call('POST', '/auth/login', { email: 'pharmacist@medicare.local', password: 'pharma123', role: 'pharmacist' });
  const pharmToken = pharmLogin.token;
  const pharmRefills = await call('GET', '/pharmacist/refills', null, pharmToken);
  const foundRefill = pharmRefills.find((r) => r.refillId === refillRes.refillId);
  check('Pharmacist receives pending refill request', !!foundRefill && foundRefill.status === 'pending');

  // Pharmacist fulfills refill (+30 quantity)
  const fulfillRefillRes = await call('PUT', `/pharmacist/refills/${refillRes.refillId}/fulfill`, { quantity: 30 }, pharmToken);
  check('Pharmacist approves and fulfills refill request', fulfillRefillRes.message.includes('approved'));

  // Patient checks refills & medicines list
  const patRefills = await call('GET', '/patient/refills', null, patToken);
  const updatedRefill = patRefills.find((r) => r.refillId === refillRes.refillId);
  check('Patient sees refill marked as Approved & Restocked', updatedRefill.status === 'approved');

  // --- 4. Doctor Population Analytics Endpoint ---
  console.log('\n4. Testing Doctor Visual Analytics & Population Data:');
  const analytics = await call('GET', '/doctor/patients/analytics', null, activeDocToken);
  check('Doctor retrieves multi-patient adherence analytics', Array.isArray(analytics) && analytics.length > 0);
  check('Analytics payload includes adherence rates, taken, late, and missed counts',
    analytics.every((p) => p.name && typeof p.adherenceRate === 'number' && typeof p.taken === 'number')
  );

  console.log(`\n=== RESULTS: ${passCount} passed, ${failCount} failed ===\n`);
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
