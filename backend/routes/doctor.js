const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { checkAndFlagMissed } = require('../services/adherenceMonitor');
const { checkSafety, checkPatientMedicationConflicts } = require('../services/interactionChecker');

const router = express.Router();
router.use(authenticate, authorize('doctor'));

// ---- viewAssignedPatients() with pharmacist info ----
router.get('/patients', (req, res) => {
  const rows = db
    .prepare(`
      SELECT p.patientId, p.name, p.email, p.dateOfBirth, p.medicalHistory, p.pharmacistId, ph.name AS pharmacistName
      FROM Patient p
      LEFT JOIN Pharmacist ph ON ph.pharmacistId = p.pharmacistId
      WHERE p.doctorId = ?
    `)
    .all(req.user.id);
  res.json(rows);
});

// ---- list all pharmacists (for doctor to select) ----
router.get('/pharmacists', (req, res) => {
  const rows = db.prepare('SELECT pharmacistId, name, email, licenseNo FROM Pharmacist').all();
  res.json(rows);
});

// ---- monitorAdherence(): per-patient adherence summary ----
router.get('/patients/:id/adherence', (req, res) => {
  const patient = db
    .prepare('SELECT patientId, name, pharmacistId FROM Patient WHERE patientId = ? AND doctorId = ?')
    .get(req.params.id, req.user.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found or not assigned to you' });

  const medicines = db.prepare('SELECT * FROM Medicine WHERE patientId = ?').all(req.params.id);
  const vaccinations = db.prepare('SELECT * FROM Vaccination WHERE patientId = ?').all(req.params.id);

  const total = medicines.length;
  const taken = medicines.filter((m) => m.status === 'taken').length;
  const late = medicines.filter((m) => m.status === 'taken-late').length;
  const missed = medicines.filter((m) => m.status === 'missed').length;
  const pending = medicines.filter((m) => m.status === 'pending').length;
  const adherenceRate = total > 0 ? Math.round((taken / total) * 100) : 100;

  res.json({
    patient,
    medicines,
    vaccinations,
    adherenceRate,
    totalMedicines: total,
    takenCount: taken,
    lateCount: late,
    missedCount: missed,
    pendingCount: pending,
    missed: missed + late,
  });
});

// ---- Population-level analytics for all assigned patients (for comparison bar chart) ----
router.get('/patients/analytics', (req, res) => {
  try { checkAndFlagMissed(); } catch (e) { /* ignore */ }

  const patients = db
    .prepare('SELECT patientId, name, email FROM Patient WHERE doctorId = ?')
    .all(req.user.id);

  const data = patients.map((p) => {
    const medicines = db.prepare('SELECT status FROM Medicine WHERE patientId = ?').all(p.patientId);
    const total = medicines.length;
    const taken = medicines.filter((m) => m.status === 'taken').length;
    const late = medicines.filter((m) => m.status === 'taken-late').length;
    const missed = medicines.filter((m) => m.status === 'missed').length;
    const pending = medicines.filter((m) => m.status === 'pending').length;
    const adherenceRate = total > 0 ? Math.round((taken / total) * 100) : 100;

    return {
      patientId: p.patientId,
      name: p.name,
      email: p.email,
      totalMedicines: total,
      taken,
      late,
      missed,
      pending,
      adherenceRate,
    };
  });

  res.json(data);
});

// ---- viewBehindSchedulePatients() ----
router.get('/patients/behind-schedule', (req, res) => {
  try { checkAndFlagMissed(); } catch (e) { /* ignore */ }
  const rows = db
    .prepare(
      `SELECT DISTINCT p.patientId, p.name, p.email
       FROM Patient p
       JOIN Medicine m ON m.patientId = p.patientId
       WHERE p.doctorId = ?
         AND (
           (m.status = 'pending' AND m.dueDate < date('now'))
           OR m.status = 'taken-late'
           OR m.status = 'missed'
         )`
    )
    .all(req.user.id);
  res.json(rows);
});

// ---- viewAdherenceHistory() ----
router.get('/patients/:id/history', (req, res) => {
  const patient = db
    .prepare('SELECT patientId, name FROM Patient WHERE patientId = ? AND doctorId = ?')
    .get(req.params.id, req.user.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found or not assigned to you' });

  const medicineHistory = db
    .prepare("SELECT * FROM Medicine WHERE patientId = ? AND status != 'pending' ORDER BY takenAt DESC")
    .all(req.params.id);
  const notifications = db
    .prepare("SELECT * FROM Notification WHERE patientId = ? AND type = 'alert' ORDER BY timestamp DESC")
    .all(req.params.id);

  res.json({ patient, medicineHistory, alerts: notifications });
});

// ---- receiveAlert(): list alerts sent to this doctor's patients ----
router.get('/alerts', (req, res) => {
  try { checkAndFlagMissed(); } catch (e) { /* ignore */ }
  const rows = db
    .prepare(
      `SELECT n.*, p.name AS patientName
       FROM Notification n
       JOIN Patient p ON p.patientId = n.patientId
       WHERE p.doctorId = ? AND n.type = 'alert'
       ORDER BY n.timestamp DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

// Alias: /patients/behind → /patients/behind-schedule
router.get('/patients/behind', (req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.patientId, p.name, p.email
       FROM Patient p
       JOIN Medicine m ON m.patientId = p.patientId
       WHERE p.doctorId = ?
         AND (
           (m.status = 'pending' AND m.dueDate < date('now'))
           OR m.status = 'taken-late'
           OR m.status = 'missed'
         )`
    )
    .all(req.user.id);
  res.json(rows);
});

// ---- SEND NOTIFICATION TO A SPECIFIC PATIENT ----
router.post('/notify-patient', (req, res) => {
  const { patientId, message, type = 'doctor-message' } = req.body;
  if (!patientId || !message || !message.trim()) {
    return res.status(400).json({ error: 'Patient and message are required' });
  }

  const patient = db
    .prepare('SELECT patientId, name FROM Patient WHERE patientId = ? AND doctorId = ?')
    .get(patientId, req.user.id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found or not assigned to you' });
  }

  const doctor = db.prepare('SELECT name FROM Doctor WHERE doctorId = ?').get(req.user.id);
  const docName = doctor ? doctor.name : 'Your Doctor';
  const formattedMessage = `👨‍⚕️ [${docName}]: ${message.trim()}`;

  db.prepare(`
    INSERT INTO Notification (patientId, message, type, isRead)
    VALUES (?, ?, ?, 0)
  `).run(patientId, formattedMessage, type);

  res.status(201).json({ message: `Notification sent to ${patient.name} successfully!` });
});

// ---- LIST NOTIFICATIONS SENT BY THIS DOCTOR ----
router.get('/notifications/sent', (req, res) => {
  const rows = db
    .prepare(`
      SELECT n.*, p.name AS patientName
      FROM Notification n
      JOIN Patient p ON p.patientId = n.patientId
      WHERE p.doctorId = ? AND n.type = 'doctor-message'
      ORDER BY n.timestamp DESC
      LIMIT 20
    `)
    .all(req.user.id);
  res.json(rows);
});

// ---- 🛡️ REAL-TIME CLINICAL SAFETY & INTERACTION CHECKER ----
router.post('/check-safety', (req, res) => {
  const { patientId, medicineName } = req.body;
  if (!patientId || !medicineName) {
    return res.status(400).json({ error: 'Patient ID and Medicine Name are required' });
  }

  const patient = db
    .prepare('SELECT patientId, name FROM Patient WHERE patientId = ? AND doctorId = ?')
    .get(patientId, req.user.id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found or not assigned to you' });
  }

  const safetyResult = checkSafety(patientId, medicineName);
  res.json({
    patientName: patient.name,
    ...safetyResult
  });
});

// ---- PATIENT ALLERGIES ----
router.get('/patients/:id/allergies', (req, res) => {
  const patient = db
    .prepare('SELECT patientId, name FROM Patient WHERE patientId = ? AND doctorId = ?')
    .get(req.params.id, req.user.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const allergies = db
    .prepare('SELECT * FROM PatientAllergy WHERE patientId = ? ORDER BY diagnosedAt DESC')
    .all(req.params.id);
  res.json(allergies);
});

router.post('/patients/:id/allergies', (req, res) => {
  const { allergen, severity = 'moderate', reaction } = req.body;
  if (!allergen || !allergen.trim()) {
    return res.status(400).json({ error: 'Allergen name is required' });
  }

  const patient = db
    .prepare('SELECT patientId, name FROM Patient WHERE patientId = ? AND doctorId = ?')
    .get(req.params.id, req.user.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const info = db.prepare(`
    INSERT INTO PatientAllergy (patientId, allergen, severity, reaction)
    VALUES (?, ?, ?, ?)
  `).run(req.params.id, allergen.trim(), severity, reaction ? reaction.trim() : null);

  res.status(201).json({ message: 'Allergy documented successfully', allergyId: info.lastInsertRowid });
});

router.delete('/patients/:id/allergies/:allergyId', (req, res) => {
  const patient = db
    .prepare('SELECT patientId FROM Patient WHERE patientId = ? AND doctorId = ?')
    .get(req.params.id, req.user.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  db.prepare('DELETE FROM PatientAllergy WHERE allergyId = ? AND patientId = ?')
    .run(req.params.allergyId, req.params.id);
  res.json({ message: 'Allergy removed' });
});

// ---- 📈 PATIENT VITALS & CORRELATION TIMELINE ----
router.get('/patients/:id/vitals', (req, res) => {
  const patient = db
    .prepare('SELECT patientId, name FROM Patient WHERE patientId = ? AND doctorId = ?')
    .get(req.params.id, req.user.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found or not assigned to you' });

  const vitals = db
    .prepare('SELECT * FROM PatientVitals WHERE patientId = ? ORDER BY recordedAt ASC')
    .all(req.params.id);

  const medicines = db
    .prepare('SELECT medicineId, name, dosage, dueDate, status, takenAt FROM Medicine WHERE patientId = ? ORDER BY dueDate ASC')
    .all(req.params.id);

  // Calculate baseline health biometrics stats
  let avgSystolic = null;
  let avgDiastolic = null;
  let avgBloodSugar = null;
  let avgPulse = null;

  const validBP = vitals.filter(v => v.systolic && v.diastolic);
  if (validBP.length > 0) {
    avgSystolic = Math.round(validBP.reduce((sum, v) => sum + v.systolic, 0) / validBP.length);
    avgDiastolic = Math.round(validBP.reduce((sum, v) => sum + v.diastolic, 0) / validBP.length);
  }

  const validSugar = vitals.filter(v => v.bloodSugar != null);
  if (validSugar.length > 0) {
    avgBloodSugar = Math.round(validSugar.reduce((sum, v) => sum + v.bloodSugar, 0) / validSugar.length);
  }

  const validPulse = vitals.filter(v => v.pulse != null);
  if (validPulse.length > 0) {
    avgPulse = Math.round(validPulse.reduce((sum, v) => sum + v.pulse, 0) / validPulse.length);
  }

  // Baseline medication adherence
  const total = medicines.length;
  const taken = medicines.filter(m => m.status === 'taken').length;
  const late = medicines.filter(m => m.status === 'taken-late').length;
  const missed = medicines.filter(m => m.status === 'missed').length;
  const adherenceRate = total > 0 ? Math.round((taken / total) * 100) : 100;

  res.json({
    patient,
    vitals,
    medicines,
    summary: {
      avgSystolic,
      avgDiastolic,
      avgBloodSugar,
      avgPulse,
      adherenceRate,
      totalMedicines: total,
      takenCount: taken,
      lateCount: late,
      missedCount: missed
    }
  });
});

// ---- CONTACT PHARMACIST: REQUEST NEW MEDICINE OR VACCINE FOR PATIENT ----
router.post('/request-pharmacist', (req, res) => {
  const {
    patientId,
    pharmacistId,
    requestType,
    itemName,
    dosage,
    quantity,
    dueDate,
    instructions,
    timeSlot = 'morning',
    mealTiming = 'after_meal',
    safetyOverride = 0
  } = req.body;

  if (!patientId || !requestType || !itemName || !itemName.trim()) {
    return res.status(400).json({ error: 'Patient, request type, and medicine/vaccine name are required' });
  }

  const patient = db
    .prepare('SELECT patientId, name, pharmacistId FROM Patient WHERE patientId = ? AND doctorId = ?')
    .get(patientId, req.user.id);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found or not assigned to you' });
  }

  const assignedPharmacistId = pharmacistId || patient.pharmacistId;
  if (!assignedPharmacistId) {
    return res.status(400).json({ error: 'No pharmacist specified and patient has no assigned pharmacist' });
  }

  // Check safety if it is a medicine and not explicitly overridden
  let safetyWarnings = [];
  if (requestType === 'medicine') {
    const safety = checkSafety(patientId, itemName.trim());
    if (!safety.isSafe) {
      safetyWarnings = safety.warnings;
      if (!safetyOverride && (safety.hasCritical || safety.hasMajor)) {
        return res.status(409).json({
          error: 'Clinical Safety Warning: Interaction or Allergy detected',
          warnings: safety.warnings,
          requiresOverride: true
        });
      }
    }
  }

  const info = db.prepare(`
    INSERT INTO DoctorRequest (doctorId, pharmacistId, patientId, requestType, itemName, dosage, quantity, dueDate, instructions, timeSlot, mealTiming, safetyOverride, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    req.user.id,
    assignedPharmacistId,
    patientId,
    requestType,
    itemName.trim(),
    dosage ? dosage.trim() : null,
    quantity ? parseInt(quantity, 10) : null,
    dueDate || null,
    instructions ? instructions.trim() : null,
    timeSlot || 'morning',
    mealTiming || 'after_meal',
    safetyOverride ? 1 : 0
  );

  const doctor = db.prepare('SELECT name FROM Doctor WHERE doctorId = ?').get(req.user.id);
  const docName = doctor ? doctor.name : 'Doctor';

  // Inform patient as well
  db.prepare(`
    INSERT INTO Notification (patientId, message, type, isRead)
    VALUES (?, ?, 'doctor-prescription-order', 0)
  `).run(
    patientId,
    `Prescription order: ${docName} requested ${requestType === 'vaccine' ? 'vaccine' : 'medicine'} [${itemName.trim()}]. Pharmacist notified to dispense.`
  );

  res.status(201).json({
    message: 'Prescription/vaccine request sent to pharmacist successfully',
    requestId: info.lastInsertRowid,
    safetyWarnings
  });
});

// ---- LIST REQUESTS SENT BY THIS DOCTOR ----
router.get('/requests', (req, res) => {
  const rows = db
    .prepare(`
      SELECT r.*, p.name AS patientName, ph.name AS pharmacistName
      FROM DoctorRequest r
      JOIN Patient p ON p.patientId = r.patientId
      LEFT JOIN Pharmacist ph ON ph.pharmacistId = r.pharmacistId
      WHERE r.doctorId = ?
      ORDER BY r.timestamp DESC
    `)
    .all(req.user.id);
  res.json(rows);
});

// ---- INCOMING PATIENT NOTES / SYMPTOMS ----
router.get('/patient-notes', (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, p.name AS patientName, p.email AS patientEmail
    FROM PatientNote n
    JOIN Patient p ON p.patientId = n.patientId
    WHERE n.doctorId = ?
    ORDER BY CASE WHEN n.status = 'open' THEN 0 ELSE 1 END, n.timestamp DESC
  `).all(req.user.id);
  res.json(rows);
});

// ---- DOCTOR REPLIES TO PATIENT NOTE ----
router.put('/patient-notes/:id/reply', (req, res) => {
  const { reply } = req.body;
  if (!reply || !reply.trim()) {
    return res.status(400).json({ error: 'Reply text is required' });
  }

  const note = db.prepare('SELECT * FROM PatientNote WHERE noteId = ? AND doctorId = ?').get(req.params.id, req.user.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE PatientNote
    SET doctorReply = ?, repliedAt = ?, status = 'replied'
    WHERE noteId = ?
  `).run(reply.trim(), now, req.params.id);

  const doc = db.prepare('SELECT name FROM Doctor WHERE doctorId = ?').get(req.user.id);
  const docName = doc ? doc.name : 'Your Doctor';

  // Create unread notification for the patient
  db.prepare(`
    INSERT INTO Notification (patientId, message, type, isRead)
    VALUES (?, ?, 'doctor-message', 0)
  `).run(
    note.patientId,
    `👨‍⚕️ [${docName}] replied to your note "${note.subject}": "${reply.trim()}"`
  );

  res.json({ message: 'Reply sent to patient successfully!' });
});

module.exports = router;
