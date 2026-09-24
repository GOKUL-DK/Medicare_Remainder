const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { SECRET, authenticate } = require('../middleware/auth');

const router = express.Router();

const ROLE_TABLES = {
  patient: { table: 'Patient', idCol: 'patientId' },
  pharmacist: { table: 'Pharmacist', idCol: 'pharmacistId' },
  doctor: { table: 'Doctor', idCol: 'doctorId' },
  admin: { table: 'Admin', idCol: 'adminId' },
};

// POST /api/auth/login  { email, password, role }
router.post('/login', (req, res) => {
  const { email, password, role } = req.body;
  const roleInfo = ROLE_TABLES[role];
  if (!roleInfo) return res.status(400).json({ error: 'Invalid role' });

  const user = db.prepare(`SELECT * FROM ${roleInfo.table} WHERE email = ?`).get(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = bcrypt.compareSync(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const id = user[roleInfo.idCol];
  const token = jwt.sign({ id, role, name: user.name, email: user.email }, SECRET, { expiresIn: '8h' });

  const { password: _pw, ...safeUser } = user;
  res.json({ token, user: safeUser, role });
});

// POST /api/auth/change-password  { currentPassword, newPassword } -- for logged-in users
router.post('/change-password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }

  const roleInfo = ROLE_TABLES[req.user.role];
  if (!roleInfo) return res.status(400).json({ error: 'Invalid user role' });

  const user = db.prepare(`SELECT * FROM ${roleInfo.table} WHERE ${roleInfo.idCol} = ?`).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const ok = bcrypt.compareSync(currentPassword, user.password);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare(`UPDATE ${roleInfo.table} SET password = ? WHERE ${roleInfo.idCol} = ?`).run(hash, req.user.id);

  res.json({ message: 'Password changed successfully' });
});

// POST /api/auth/reset-password  { role, email, newPassword }  -- used by Admin
router.post('/reset-password', (req, res) => {
  const { role, email, newPassword } = req.body;
  const roleInfo = ROLE_TABLES[role];
  if (!roleInfo) return res.status(400).json({ error: 'Invalid role' });

  const hash = bcrypt.hashSync(newPassword, 10);
  const result = db
    .prepare(`UPDATE ${roleInfo.table} SET password = ? WHERE email = ?`)
    .run(hash, email);

  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Password reset successfully' });
});

// GET /api/auth/profile -- returns role-tailored profile details
router.get('/profile', authenticate, (req, res) => {
  const role = req.user.role;
  const roleInfo = ROLE_TABLES[role];
  if (!roleInfo) return res.status(400).json({ error: 'Invalid user role' });

  const user = db.prepare(`SELECT * FROM ${roleInfo.table} WHERE ${roleInfo.idCol} = ?`).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User profile not found' });

  const { password: _pw, ...safeProfile } = user;

  // Augment with role-specific relational details
  if (role === 'patient') {
    // Assigned Doctor
    if (user.doctorId) {
      const doc = db.prepare('SELECT doctorId, name, specialization, email, phone, hospital, department FROM Doctor WHERE doctorId = ?').get(user.doctorId);
      safeProfile.doctor = doc || null;
    }
    // Assigned Pharmacist
    if (user.pharmacistId) {
      const pharm = db.prepare('SELECT pharmacistId, name, email, licenseNo, phone, pharmacyName FROM Pharmacist WHERE pharmacistId = ?').get(user.pharmacistId);
      safeProfile.pharmacist = pharm || null;
    }
    // Latest Vitals
    try {
      const latestVitals = db.prepare('SELECT * FROM PatientVitals WHERE patientId = ? ORDER BY recordedAt DESC LIMIT 1').get(user.patientId);
      safeProfile.latestVitals = latestVitals || null;
    } catch (e) {
      safeProfile.latestVitals = null;
    }
    // Known Allergies
    try {
      const allergies = db.prepare('SELECT * FROM PatientAllergy WHERE patientId = ? ORDER BY diagnosedAt DESC').all(user.patientId);
      safeProfile.allergies = allergies || [];
    } catch (e) {
      safeProfile.allergies = [];
    }
    // Total & Active Meds
    try {
      const medStats = db.prepare(`
        SELECT 
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('pending', 'active') THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END) AS taken
        FROM Medicine WHERE patientId = ?
      `).get(user.patientId);
      safeProfile.medStats = medStats || { total: 0, active: 0, taken: 0 };
    } catch (e) {
      safeProfile.medStats = { total: 0, active: 0, taken: 0 };
    }
  } else if (role === 'doctor') {
    // Total assigned patients count
    try {
      const pCount = db.prepare('SELECT COUNT(*) as count FROM Patient WHERE doctorId = ?').get(user.doctorId);
      safeProfile.assignedPatientsCount = pCount ? pCount.count : 0;
    } catch (e) {
      safeProfile.assignedPatientsCount = 0;
    }
    // Active / total prescription requests
    try {
      const reqCount = db.prepare('SELECT COUNT(*) as count FROM DoctorRequest WHERE doctorId = ?').get(user.doctorId);
      safeProfile.totalPrescriptionsSent = reqCount ? reqCount.count : 0;
    } catch (e) {
      safeProfile.totalPrescriptionsSent = 0;
    }
  } else if (role === 'pharmacist') {
    // Total assigned patients count
    try {
      const pCount = db.prepare('SELECT COUNT(*) as count FROM Patient WHERE pharmacistId = ?').get(user.pharmacistId);
      safeProfile.assignedPatientsCount = pCount ? pCount.count : 0;
    } catch (e) {
      safeProfile.assignedPatientsCount = 0;
    }
    // Pending refill requests
    try {
      const refillsCount = db.prepare('SELECT COUNT(*) as count FROM RefillRequest WHERE pharmacistId = ? AND status = ?').get(user.pharmacistId, 'pending');
      safeProfile.pendingRefillsCount = refillsCount ? refillsCount.count : 0;
    } catch (e) {
      safeProfile.pendingRefillsCount = 0;
    }
  } else if (role === 'admin') {
    // System overview counts
    try {
      const p = db.prepare('SELECT COUNT(*) as c FROM Patient').get();
      const d = db.prepare('SELECT COUNT(*) as c FROM Doctor').get();
      const ph = db.prepare('SELECT COUNT(*) as c FROM Pharmacist').get();
      const m = db.prepare('SELECT COUNT(*) as c FROM Medicine').get();
      safeProfile.systemStats = {
        totalPatients: p ? p.c : 0,
        totalDoctors: d ? d.c : 0,
        totalPharmacists: ph ? ph.c : 0,
        totalMedicines: m ? m.c : 0
      };
    } catch (e) {
      safeProfile.systemStats = { totalPatients: 0, totalDoctors: 0, totalPharmacists: 0, totalMedicines: 0 };
    }
  }

  res.json({ profile: safeProfile, role });
});

// PUT /api/auth/profile -- update permissible fields
router.put('/profile', authenticate, (req, res) => {
  const role = req.user.role;
  const roleInfo = ROLE_TABLES[role];
  if (!roleInfo) return res.status(400).json({ error: 'Invalid user role' });

  const body = req.body || {};

  if (role === 'patient') {
    const fields = ['phone', 'bloodGroup', 'height', 'weight', 'gender', 'address', 'emergencyContact', 'medicalHistory', 'dateOfBirth'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    });
    if (updates.length > 0) {
      values.push(req.user.id);
      db.prepare(`UPDATE Patient SET ${updates.join(', ')} WHERE patientId = ?`).run(...values);
    }
  } else if (role === 'doctor') {
    const fields = ['phone', 'specialization', 'qualification', 'experience', 'licenseNo', 'department', 'hospital'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    });
    if (updates.length > 0) {
      values.push(req.user.id);
      db.prepare(`UPDATE Doctor SET ${updates.join(', ')} WHERE doctorId = ?`).run(...values);
    }
  } else if (role === 'pharmacist') {
    const fields = ['phone', 'pharmacyName', 'qualification', 'experience', 'licenseNo'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    });
    if (updates.length > 0) {
      values.push(req.user.id);
      db.prepare(`UPDATE Pharmacist SET ${updates.join(', ')} WHERE pharmacistId = ?`).run(...values);
    }
  } else if (role === 'admin') {
    const fields = ['phone', 'roleTitle', 'department'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    });
    if (updates.length > 0) {
      values.push(req.user.id);
      db.prepare(`UPDATE Admin SET ${updates.join(', ')} WHERE adminId = ?`).run(...values);
    }
  }

  res.json({ message: 'Profile updated successfully' });
});

module.exports = router;
