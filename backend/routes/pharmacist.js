const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { checkSafety } = require('../services/interactionChecker');

const router = express.Router();
router.use(authenticate, authorize('pharmacist'));

// ---- 🛡️ CLINICAL SAFETY CHECKER FOR PHARMACIST ----
router.post('/check-safety', (req, res) => {
  const { patientId, medicineName } = req.body;
  if (!patientId || !medicineName) {
    return res.status(400).json({ error: 'Patient ID and Medicine Name are required' });
  }

  const safetyResult = checkSafety(patientId, medicineName);
  res.json(safetyResult);
});

// ---- searchPatient() ----
router.get('/patients/search', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = db
    .prepare('SELECT patientId, name, email, dateOfBirth FROM Patient WHERE name LIKE ? OR email LIKE ?')
    .all(q, q);
  res.json(rows);
});

// ---- viewAssignedPatients() ----
router.get('/patients', (req, res) => {
  const rows = db
    .prepare('SELECT patientId, name, email, dateOfBirth, medicalHistory FROM Patient WHERE pharmacistId = ?')
    .all(req.user.id);
  res.json(rows);
});

// ---- addMedicine() ----
router.post('/medicines', (req, res) => {
  const {
    patientId,
    doctorId,
    name,
    dosage,
    quantity,
    expiryDate,
    dueDate,
    timeSlot = 'morning',
    mealTiming = 'after_meal',
    safetyOverride = 0
  } = req.body;

  if (!patientId || !name || !dueDate) {
    return res.status(400).json({ error: 'Patient, medicine name, and due date are required' });
  }

  const safety = checkSafety(patientId, name.trim());
  if (!safety.isSafe && !safetyOverride && (safety.hasCritical || safety.hasMajor)) {
    return res.status(409).json({
      error: 'Clinical Safety Warning: Interaction or Allergy conflict detected',
      warnings: safety.warnings,
      requiresOverride: true
    });
  }

  const info = db
    .prepare(
      `INSERT INTO Medicine (patientId, pharmacistId, doctorId, name, dosage, quantity, expiryDate, dueDate, timeSlot, mealTiming, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(patientId, req.user.id, doctorId || null, name.trim(), dosage, quantity, expiryDate, dueDate, timeSlot || 'morning', mealTiming || 'after_meal');

  db.prepare(
    `INSERT INTO Notification (patientId, message, type) VALUES (?, ?, 'reminder')`
  ).run(patientId, `New medicine scheduled: ${name.trim()} (${dosage || 'Standard'}), due ${dueDate} [${timeSlot || 'morning'}]`);

  res.status(201).json({ id: info.lastInsertRowid, warnings: safety.warnings });
});

// ---- updateMedicine() ----
router.put('/medicines/:id', (req, res) => {
  const fields = Object.keys(req.body);
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => req.body[f]);
  db.prepare(`UPDATE Medicine SET ${setClause} WHERE medicineId = ? AND pharmacistId = ?`)
    .run(...values, req.params.id, req.user.id);
  res.json({ message: 'Updated' });
});

// ---- deleteMedicine() ----
router.delete('/medicines/:id', (req, res) => {
  db.prepare('DELETE FROM Medicine WHERE medicineId = ? AND pharmacistId = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Deleted' });
});

// ---- view all medicines this pharmacist manages ----
router.get('/medicines', (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, p.name AS patientName
    FROM Medicine m
    JOIN Patient p ON p.patientId = m.patientId
    WHERE m.pharmacistId = ?
    ORDER BY m.dueDate DESC
  `).all(req.user.id);
  res.json(rows);
});

// ---- addVaccination() ----
router.post('/vaccinations', (req, res) => {
  const { patientId, vaccineName, dueDate } = req.body;
  const info = db
    .prepare(
      `INSERT INTO Vaccination (patientId, pharmacistId, vaccineName, dueDate, status) VALUES (?, ?, ?, ?, 'pending')`
    )
    .run(patientId, req.user.id, vaccineName, dueDate);

  db.prepare(
    `INSERT INTO Notification (patientId, message, type) VALUES (?, ?, 'reminder')`
  ).run(patientId, `New vaccination scheduled: ${vaccineName}, due ${dueDate}`);

  res.status(201).json({ id: info.lastInsertRowid });
});

// ---- updateVaccination() ----
router.put('/vaccinations/:id', (req, res) => {
  const fields = Object.keys(req.body);
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => req.body[f]);
  db.prepare(`UPDATE Vaccination SET ${setClause} WHERE vaccinationId = ? AND pharmacistId = ?`)
    .run(...values, req.params.id, req.user.id);
  res.json({ message: 'Updated' });
});

router.get('/vaccinations', (req, res) => {
  const rows = db.prepare(`
    SELECT v.*, p.name AS patientName
    FROM Vaccination v
    JOIN Patient p ON p.patientId = v.patientId
    WHERE v.pharmacistId = ?
    ORDER BY v.dueDate DESC
  `).all(req.user.id);
  res.json(rows);
});

// ---- vaccine master list (read-only reference for pharmacists) ----
router.get('/vaccine-list', (req, res) => {
  res.json(db.prepare('SELECT * FROM VaccineMasterList').all());
});

// ---- DOCTOR PRESCRIPTION / VACCINATION REQUESTS ----
router.get('/requests', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, p.name AS patientName, p.email AS patientEmail,
           d.name AS doctorName, d.specialization AS doctorSpecialization
    FROM DoctorRequest r
    JOIN Patient p ON p.patientId = r.patientId
    JOIN Doctor d ON d.doctorId = r.doctorId
    WHERE r.pharmacistId = ? OR r.pharmacistId IS NULL
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.timestamp DESC
  `).all(req.user.id);
  res.json(rows);
});

// ---- Fulfill doctor request (auto-add to patient schedule) ----
router.put('/requests/:id/fulfill', (req, res) => {
  const request = db.prepare('SELECT * FROM DoctorRequest WHERE requestId = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status === 'completed') {
    return res.status(400).json({ error: 'Request is already completed' });
  }

  const doctor = db.prepare('SELECT name FROM Doctor WHERE doctorId = ?').get(request.doctorId);
  const docName = doctor ? doctor.name : 'Supervising Doctor';

  const patient = db.prepare('SELECT name FROM Patient WHERE patientId = ?').get(request.patientId);
  const patName = patient ? patient.name : 'Patient';

  const defaultDue = request.dueDate || new Date().toISOString().split('T')[0];

  if (request.requestType === 'medicine') {
    // Add 180 days default for expiry if not provided
    const exp = new Date();
    exp.setDate(exp.getDate() + 180);
    const defaultExpiry = exp.toISOString().split('T')[0];

    db.prepare(`
      INSERT INTO Medicine (patientId, pharmacistId, doctorId, name, dosage, quantity, expiryDate, dueDate, timeSlot, mealTiming, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      request.patientId,
      req.user.id,
      request.doctorId,
      request.itemName,
      request.dosage || 'As prescribed',
      request.quantity || 30,
      defaultExpiry,
      defaultDue,
      request.timeSlot || 'morning',
      request.mealTiming || 'after_meal'
    );

    // Notify patient
    db.prepare(`
      INSERT INTO Notification (patientId, message, type, isRead)
      VALUES (?, ?, 'reminder', 0)
    `).run(
      request.patientId,
      `New medicine scheduled per Dr. ${docName}: ${request.itemName} (${request.dosage || 'Standard'}). Ready for pickup / intake due ${defaultDue} [${request.timeSlot || 'morning'}].`
    );
  } else {
    // Vaccine
    db.prepare(`
      INSERT INTO Vaccination (patientId, pharmacistId, vaccineName, dueDate, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(
      request.patientId,
      req.user.id,
      request.itemName,
      defaultDue
    );

    // Notify patient
    db.prepare(`
      INSERT INTO Notification (patientId, message, type, isRead)
      VALUES (?, ?, 'reminder', 0)
    `).run(
      request.patientId,
      `New vaccination scheduled per Dr. ${docName}: ${request.itemName}, scheduled for ${defaultDue}.`
    );
  }

  // Mark request as completed
  db.prepare("UPDATE DoctorRequest SET status = 'completed' WHERE requestId = ?").run(req.params.id);

  // Notify doctor via alert
  db.prepare(`
    INSERT INTO Notification (patientId, message, type)
    VALUES (?, ?, 'alert')
  `).run(
    request.patientId,
    `Prescription fulfilled: ${request.itemName} for ${patName} has been processed and added to schedule.`
  );

  res.json({ message: `Request fulfilled! ${request.itemName} has been scheduled for ${patName}.` });
});

// ---- PATIENT REFILL REQUESTS ----
router.get('/refills', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, p.name AS patientName, p.email AS patientEmail,
           m.name AS medicineName, m.dosage, m.quantity AS currentQuantity, m.dueDate
    FROM RefillRequest r
    JOIN Patient p ON p.patientId = r.patientId
    JOIN Medicine m ON m.medicineId = r.medicineId
    WHERE r.pharmacistId = ? OR r.pharmacistId IS NULL
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.requestedAt DESC
  `).all(req.user.id);
  res.json(rows);
});

// ---- Fulfill Patient Refill Request ----
router.put('/refills/:id/fulfill', (req, res) => {
  const refill = db.prepare('SELECT * FROM RefillRequest WHERE refillId = ?').get(req.params.id);
  if (!refill) return res.status(404).json({ error: 'Refill request not found' });
  if (refill.status === 'approved') return res.status(400).json({ error: 'Refill is already fulfilled' });

  const med = db.prepare('SELECT * FROM Medicine WHERE medicineId = ?').get(refill.medicineId);
  if (!med) return res.status(404).json({ error: 'Medicine record not found' });

  const addedQty = req.body.quantity ? parseInt(req.body.quantity, 10) : 30;
  const newQty = (med.quantity || 0) + addedQty;

  // Extend due date if needed
  const due = new Date();
  due.setDate(due.getDate() + 30);
  const nextDueDate = due.toISOString().split('T')[0];

  db.prepare(`
    UPDATE Medicine
    SET quantity = ?, status = 'pending', dueDate = ?
    WHERE medicineId = ?
  `).run(newQty, nextDueDate, med.medicineId);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE RefillRequest
    SET status = 'approved', fulfilledAt = ?
    WHERE refillId = ?
  `).run(now, req.params.id);

  const patient = db.prepare('SELECT name FROM Patient WHERE patientId = ?').get(refill.patientId);
  const patName = patient ? patient.name : 'Patient';

  // Notify Patient
  db.prepare(`
    INSERT INTO Notification (patientId, message, type, isRead)
    VALUES (?, ?, 'reminder', 0)
  `).run(
    refill.patientId,
    `Refill Approved: Your refill for ${med.name} (+${addedQty} pills) has been approved and restocked. Next due: ${nextDueDate}.`
  );

  res.json({ message: `Refill for ${med.name} approved and restocked (+${addedQty} pills) for ${patName}!` });
});

module.exports = router;
