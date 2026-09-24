const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, authorize('admin'));

const ROLE_TABLES = {
  patient: { table: 'Patient', idCol: 'patientId' },
  pharmacist: { table: 'Pharmacist', idCol: 'pharmacistId' },
  doctor: { table: 'Doctor', idCol: 'doctorId' },
};

// ---- addUserAccount() ----
router.post('/users/:role', (req, res) => {
  const roleInfo = ROLE_TABLES[req.params.role];
  if (!roleInfo) return res.status(400).json({ error: 'Invalid role' });
  const { name, email, password, ...extra } = req.body;
  const hash = bcrypt.hashSync(password, 10);

  try {
    if (req.params.role === 'patient') {
      const info = db
        .prepare(
          `INSERT INTO Patient (name, email, password, dateOfBirth, medicalHistory, doctorId, pharmacistId, adminId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(name, email, hash, extra.dateOfBirth || null, extra.medicalHistory || null,
             extra.doctorId || null, extra.pharmacistId || null, req.user.id);
      return res.status(201).json({ id: info.lastInsertRowid });
    }
    if (req.params.role === 'doctor') {
      const info = db
        .prepare(`INSERT INTO Doctor (name, email, password, specialization, adminId) VALUES (?, ?, ?, ?, ?)`)
        .run(name, email, hash, extra.specialization || null, req.user.id);
      return res.status(201).json({ id: info.lastInsertRowid });
    }
    if (req.params.role === 'pharmacist') {
      const info = db
        .prepare(`INSERT INTO Pharmacist (name, email, password, licenseNo, adminId) VALUES (?, ?, ?, ?, ?)`)
        .run(name, email, hash, extra.licenseNo || null, req.user.id);
      return res.status(201).json({ id: info.lastInsertRowid });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Email already exists or invalid data' });
  }
});

// ---- editUserAccount() ----
router.put('/users/:role/:id', (req, res) => {
  const roleInfo = ROLE_TABLES[req.params.role];
  if (!roleInfo) return res.status(400).json({ error: 'Invalid role' });

  const fields = Object.keys(req.body).filter((k) => k !== 'password');
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => req.body[f]);
  db.prepare(`UPDATE ${roleInfo.table} SET ${setClause} WHERE ${roleInfo.idCol} = ?`)
    .run(...values, req.params.id);
  res.json({ message: 'Updated' });
});

// ---- deleteUserAccount() ----
router.delete('/users/:role/:id', (req, res) => {
  const roleInfo = ROLE_TABLES[req.params.role];
  if (!roleInfo) return res.status(400).json({ error: 'Invalid role' });
  db.prepare(`DELETE FROM ${roleInfo.table} WHERE ${roleInfo.idCol} = ?`).run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ---- list users (helper for admin UI) ----
router.get('/users/:role', (req, res) => {
  const roleInfo = ROLE_TABLES[req.params.role];
  if (!roleInfo) return res.status(400).json({ error: 'Invalid role' });
  const rows = db.prepare(`SELECT * FROM ${roleInfo.table}`).all();
  res.json(rows.map(({ password, ...rest }) => rest));
});

// ---- assignPharmacistToPatient() ----
router.put('/assign-pharmacist', (req, res) => {
  const { patientId, pharmacistId } = req.body;
  db.prepare('UPDATE Patient SET pharmacistId = ? WHERE patientId = ?').run(pharmacistId, patientId);
  res.json({ message: 'Pharmacist assigned' });
});

// ---- assignDoctor (companion to above, not explicitly in class diagram but needed) ----
router.put('/assign-doctor', (req, res) => {
  const { patientId, doctorId } = req.body;
  db.prepare('UPDATE Patient SET doctorId = ? WHERE patientId = ?').run(doctorId, patientId);
  res.json({ message: 'Doctor assigned' });
});

// ---- maintainVaccineList(): add ----
router.post('/vaccine-list', (req, res) => {
  const { vaccineName } = req.body;
  const info = db
    .prepare('INSERT INTO VaccineMasterList (adminId, vaccineName) VALUES (?, ?)')
    .run(req.user.id, vaccineName);
  res.status(201).json({ id: info.lastInsertRowid });
});

// ---- maintainVaccineList(): remove ----
router.delete('/vaccine-list/:id', (req, res) => {
  db.prepare('DELETE FROM VaccineMasterList WHERE listId = ?').run(req.params.id);
  res.json({ message: 'Removed' });
});

// ---- maintainVaccineList(): view ----
router.get('/vaccine-list', (req, res) => {
  res.json(db.prepare('SELECT * FROM VaccineMasterList').all());
});

// ---- setNotificationThreshold() ----
router.put('/settings/threshold', (req, res) => {
  const { notifyThresholdDays } = req.body;
  const existing = db.prepare('SELECT * FROM SystemSettings LIMIT 1').get();
  if (existing) {
    db.prepare('UPDATE SystemSettings SET notifyThresholdDays = ?, adminId = ? WHERE settingId = ?')
      .run(notifyThresholdDays, req.user.id, existing.settingId);
  } else {
    db.prepare('INSERT INTO SystemSettings (adminId, notifyThresholdDays) VALUES (?, ?)')
      .run(req.user.id, notifyThresholdDays);
  }
  res.json({ message: 'Threshold updated' });
});

router.get('/settings', (req, res) => {
  res.json(db.prepare('SELECT * FROM SystemSettings LIMIT 1').get() || {});
});

// ---- viewSystemReports() ----
router.get('/reports', (req, res) => {
  const totalPatients = db.prepare('SELECT COUNT(*) AS c FROM Patient').get().c;
  const totalDoctors = db.prepare('SELECT COUNT(*) AS c FROM Doctor').get().c;
  const totalPharmacists = db.prepare('SELECT COUNT(*) AS c FROM Pharmacist').get().c;
  const totalMedicines = db.prepare('SELECT COUNT(*) AS c FROM Medicine').get().c;
  const totalVaccinesDue = db
    .prepare("SELECT COUNT(*) AS c FROM Vaccination WHERE status = 'pending' AND dueDate <= date('now')")
    .get().c;
  const missedMedicines = db.prepare("SELECT COUNT(*) AS c FROM Medicine WHERE status = 'missed'").get().c;

  res.json({
    totalPatients,
    totalDoctors,
    totalPharmacists,
    totalMedicines,
    totalVaccinesDue,
    missedMedicines,
    generatedAt: new Date().toISOString(),
  });
});

module.exports = router;
