const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, authorize('patient'));

// ---- viewDashboard() ----
router.get('/dashboard', (req, res) => {
  const patient = db
    .prepare('SELECT patientId, name, email, dateOfBirth, medicalHistory, doctorId, pharmacistId FROM Patient WHERE patientId = ?')
    .get(req.user.id);

  const upcomingMedicines = db
    .prepare("SELECT * FROM Medicine WHERE patientId = ? AND status = 'pending' ORDER BY dueDate LIMIT 5")
    .all(req.user.id);

  const upcomingVaccinations = db
    .prepare("SELECT * FROM Vaccination WHERE patientId = ? AND status = 'pending' ORDER BY dueDate LIMIT 5")
    .all(req.user.id);

  const unreadNotifications = db
    .prepare('SELECT COUNT(*) AS c FROM Notification WHERE patientId = ? AND isRead = 0')
    .get(req.user.id).c;

  res.json({ patient, upcomingMedicines, upcomingVaccinations, unreadNotifications });
});

// ---- viewPrescribedMedicines() ----
router.get('/medicines', (req, res) => {
  res.json(db.prepare('SELECT * FROM Medicine WHERE patientId = ? ORDER BY dueDate').all(req.user.id));
});

// ---- viewVaccinationSchedule() ----
router.get('/vaccinations', (req, res) => {
  res.json(db.prepare('SELECT * FROM Vaccination WHERE patientId = ? ORDER BY dueDate').all(req.user.id));
});

// ---- markMedicineTaken() ----
router.put('/medicines/:id/taken', (req, res) => {
  const med = db
    .prepare('SELECT * FROM Medicine WHERE medicineId = ? AND patientId = ?')
    .get(req.params.id, req.user.id);
  if (!med) return res.status(404).json({ error: 'Medicine not found' });

  const now = new Date();
  const due = med.dueDate ? new Date(med.dueDate) : null;
  const onTime = !due || now <= due;
  const status = onTime ? 'taken' : 'taken-late';

  db.prepare('UPDATE Medicine SET status = ?, takenAt = ? WHERE medicineId = ?')
    .run(status, now.toISOString(), req.params.id);

  if (!onTime) {
    db.prepare("INSERT INTO Notification (patientId, message, type) VALUES (?, ?, 'alert')")
      .run(req.user.id, `Late dose: ${med.name} (${med.dosage || 'standard dosage'}) was due ${med.dueDate} and was taken late.`);
  }

  res.json({ message: 'Marked as taken', onTime });
});

// ---- mark vaccination taken (equivalent action for vaccinations) ----
router.put('/vaccinations/:id/taken', (req, res) => {
  db.prepare("UPDATE Vaccination SET status = 'taken' WHERE vaccinationId = ? AND patientId = ?")
    .run(req.params.id, req.user.id);
  res.json({ message: 'Marked as taken' });
});

// ---- viewNotificationHistory() ----
router.get('/notifications', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM Notification WHERE patientId = ? ORDER BY isRead ASC, timestamp DESC')
    .all(req.user.id);
  res.json(rows);
});

// ---- mark single notification as read ----
router.put('/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE Notification SET isRead = 1 WHERE notificationId = ? AND patientId = ?')
    .run(req.params.id, req.user.id);
  const unreadCount = db
    .prepare('SELECT COUNT(*) AS c FROM Notification WHERE patientId = ? AND isRead = 0')
    .get(req.user.id).c;
  res.json({ message: 'Marked as read', unreadCount });
});

// ---- mark all notifications as read ----
router.put('/notifications/read-all', (req, res) => {
  db.prepare('UPDATE Notification SET isRead = 1 WHERE patientId = ?').run(req.user.id);
  res.json({ message: 'All notifications marked as read', unreadCount: 0 });
});

// ---- SUBMIT PATIENT SYMPTOM / NOTE TO DOCTOR ----
router.post('/notes', (req, res) => {
  const { subject, message, severity = 'normal' } = req.body;
  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are required' });
  }

  const patient = db.prepare('SELECT name, doctorId FROM Patient WHERE patientId = ?').get(req.user.id);
  if (!patient || !patient.doctorId) {
    return res.status(400).json({ error: 'You do not have a supervising doctor assigned' });
  }

  const info = db.prepare(`
    INSERT INTO PatientNote (patientId, doctorId, subject, message, severity, status)
    VALUES (?, ?, ?, ?, ?, 'open')
  `).run(req.user.id, patient.doctorId, subject.trim(), message.trim(), severity);

  // Notify doctor through an alert
  const alertMsg = `Patient Note [${severity === 'urgent' ? 'URGENT' : 'Feedback'}]: ${patient.name} sent: "${subject.trim()}"`;
  db.prepare(`
    INSERT INTO Notification (patientId, message, type, isRead)
    VALUES (?, ?, 'alert', 0)
  `).run(req.user.id, alertMsg);

  res.status(201).json({ message: 'Note sent to your doctor successfully!', noteId: info.lastInsertRowid });
});

// ---- GET PATIENT NOTES & REPLIES ----
router.get('/notes', (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, d.name AS doctorName, d.specialization
    FROM PatientNote n
    JOIN Doctor d ON d.doctorId = n.doctorId
    WHERE n.patientId = ?
    ORDER BY n.timestamp DESC
  `).all(req.user.id);
  res.json(rows);
});

// ---- REQUEST REFILL FROM PHARMACIST ----
router.post('/refill', (req, res) => {
  const { medicineId, requestNotes } = req.body;
  if (!medicineId) return res.status(400).json({ error: 'Medicine ID is required' });

  const med = db.prepare('SELECT * FROM Medicine WHERE medicineId = ? AND patientId = ?').get(medicineId, req.user.id);
  if (!med) return res.status(404).json({ error: 'Medicine not found' });

  const patient = db.prepare('SELECT name, pharmacistId FROM Patient WHERE patientId = ?').get(req.user.id);
  const pharmId = med.pharmacistId || patient.pharmacistId;
  if (!pharmId) {
    return res.status(400).json({ error: 'No assigned pharmacist found to process refill' });
  }

  const info = db.prepare(`
    INSERT INTO RefillRequest (patientId, medicineId, pharmacistId, status, requestNotes)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(req.user.id, medicineId, pharmId, requestNotes ? requestNotes.trim() : 'Refill requested by patient');

  // Confirmation notification for patient
  db.prepare(`
    INSERT INTO Notification (patientId, message, type, isRead)
    VALUES (?, ?, 'reminder', 0)
  `).run(req.user.id, `Refill requested for ${med.name}. Your pharmacist has been notified.`);

  res.status(201).json({ message: `Refill requested for ${med.name}!`, refillId: info.lastInsertRowid });
});

// ---- GET REFILL STATUSES ----
router.get('/refills', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, m.name AS medicineName, m.dosage, ph.name AS pharmacistName
    FROM RefillRequest r
    JOIN Medicine m ON m.medicineId = r.medicineId
    LEFT JOIN Pharmacist ph ON ph.pharmacistId = r.pharmacistId
    WHERE r.patientId = ?
    ORDER BY r.requestedAt DESC
  `).all(req.user.id);
  res.json(rows);
});

// ---- 📅 DAILY PILLBOX ORGANIZER ----
router.get('/pillbox', (req, res) => {
  const medicines = db
    .prepare('SELECT * FROM Medicine WHERE patientId = ? ORDER BY dueDate ASC')
    .all(req.user.id);

  const todayStr = new Date().toISOString().split('T')[0];

  const slots = {
    morning: [],
    afternoon: [],
    evening: [],
    night: []
  };

  medicines.forEach(m => {
    // Determine slot
    const slot = (m.timeSlot && slots[m.timeSlot.toLowerCase()]) ? m.timeSlot.toLowerCase() : 'morning';
    slots[slot].push({
      ...m,
      timeSlot: slot,
      mealTiming: m.mealTiming || 'after_meal'
    });
  });

  const total = medicines.length;
  const taken = medicines.filter(m => m.status === 'taken' || m.status === 'taken-late').length;
  const pending = medicines.filter(m => m.status === 'pending').length;

  res.json({
    today: todayStr,
    slots,
    summary: {
      total,
      taken,
      pending
    }
  });
});

// ---- 🗓️ MONTHLY INTERACTIVE ADHERENCE CALENDAR ----
router.get('/calendar', (req, res) => {
  const monthQuery = req.query.month || new Date().toISOString().substring(0, 7); // e.g. "2026-09"
  const [yearStr, monthStr] = monthQuery.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10); // 1-indexed

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Invalid month parameter. Format: YYYY-MM' });
  }

  // Days in month
  const daysInMonth = new Date(year, month, 0).getDate();

  // Fetch all medicines with dueDate or takenAt in this month
  const monthPrefix = `${yearStr}-${monthStr.padStart(2, '0')}`;
  const medicines = db
    .prepare(`
      SELECT * FROM Medicine
      WHERE patientId = ? AND (dueDate LIKE ? OR takenAt LIKE ?)
    `)
    .all(req.user.id, `${monthPrefix}%`, `${monthPrefix}%`);

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
    const dayMeds = medicines.filter(m => {
      const dueMatch = m.dueDate && m.dueDate.startsWith(dayStr);
      const takenMatch = m.takenAt && m.takenAt.startsWith(dayStr);
      return dueMatch || takenMatch;
    });

    const total = dayMeds.length;
    const taken = dayMeds.filter(m => m.status === 'taken').length;
    const late = dayMeds.filter(m => m.status === 'taken-late').length;
    const missed = dayMeds.filter(m => m.status === 'missed').length;
    const pending = dayMeds.filter(m => m.status === 'pending').length;

    let status = 'none';
    if (total > 0) {
      if (missed > 0) status = 'missed';
      else if (pending > 0 && taken === 0 && late === 0) status = 'pending';
      else if (taken + late === total) status = 'complete';
      else status = 'partial';
    }

    days.push({
      date: dayStr,
      dayNumber: d,
      total,
      taken,
      late,
      missed,
      pending,
      status,
      medicines: dayMeds
    });
  }

  res.json({
    month: monthQuery,
    year,
    monthNumber: month,
    daysInMonth,
    days
  });
});

// ---- 📈 PATIENT VITALS & BIOMETRICS ----
router.get('/vitals', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM PatientVitals WHERE patientId = ? ORDER BY recordedAt DESC')
    .all(req.user.id);
  res.json(rows);
});

router.post('/vitals', (req, res) => {
  const { systolic, diastolic, bloodSugar, sugarType = 'random', pulse, notes } = req.body;

  const sys = systolic ? parseInt(systolic, 10) : null;
  const dia = diastolic ? parseInt(diastolic, 10) : null;
  const sugar = bloodSugar ? parseFloat(bloodSugar) : null;
  const pul = pulse ? parseInt(pulse, 10) : null;

  if (sys == null && sugar == null && pul == null) {
    return res.status(400).json({ error: 'Please provide at least one vital sign (Blood Pressure, Blood Sugar, or Pulse)' });
  }

  const info = db.prepare(`
    INSERT INTO PatientVitals (patientId, systolic, diastolic, bloodSugar, sugarType, pulse, notes, recordedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(req.user.id, sys, dia, sugar, sugarType, pul, notes ? notes.trim() : null);

  // Check for critical health flags and alert doctor/patient
  const patient = db.prepare('SELECT name, doctorId FROM Patient WHERE patientId = ?').get(req.user.id);
  const alerts = [];

  if (sys >= 140 || dia >= 90) {
    alerts.push(`High Blood Pressure Reading: ${sys}/${dia} mmHg`);
  }
  if (sugar > 200) {
    alerts.push(`Elevated Blood Glucose: ${sugar} mg/dL (${sugarType})`);
  } else if (sugar && sugar < 70) {
    alerts.push(`Low Blood Glucose Warning: ${sugar} mg/dL (${sugarType})`);
  }

  if (alerts.length > 0 && patient && patient.doctorId) {
    const alertMsg = `⚠️ Vitals Alert for ${patient.name}: ${alerts.join(', ')}`;
    db.prepare(`
      INSERT INTO Notification (patientId, message, type, isRead)
      VALUES (?, ?, 'alert', 0)
    `).run(req.user.id, alertMsg);
  }

  res.status(201).json({
    message: 'Health vitals recorded successfully!',
    vitalId: info.lastInsertRowid,
    alerts
  });
});

// ---- 🛡️ PATIENT ALLERGIES ----
router.get('/allergies', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM PatientAllergy WHERE patientId = ? ORDER BY diagnosedAt DESC')
    .all(req.user.id);
  res.json(rows);
});

router.post('/allergies', (req, res) => {
  const { allergen, severity = 'moderate', reaction } = req.body;
  if (!allergen || !allergen.trim()) {
    return res.status(400).json({ error: 'Allergen name is required' });
  }

  const info = db.prepare(`
    INSERT INTO PatientAllergy (patientId, allergen, severity, reaction)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, allergen.trim(), severity, reaction ? reaction.trim() : null);

  res.status(201).json({ message: 'Allergy recorded successfully', allergyId: info.lastInsertRowid });
});

router.delete('/allergies/:id', (req, res) => {
  db.prepare('DELETE FROM PatientAllergy WHERE allergyId = ? AND patientId = ?')
    .run(req.params.id, req.user.id);
  res.json({ message: 'Allergy removed' });
});

module.exports = router;
