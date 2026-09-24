// db.js — uses sql.js (pure JS/WASM SQLite, no native build required)
//
// Exports a SYNCHRONOUS-LOOKING proxy that all routes can use as:
//   const db = require('../db');
//   db.prepare('...').get(...)
//
// Internally, the real DB is initialized async. server.js must call and
// await `db.ready` before starting the HTTP server to ensure the DB is
// ready before any requests arrive.

const path      = require('path');
const fs        = require('fs');
const bcrypt    = require('bcryptjs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'medicare.db');

// ── Internal state ────────────────────────────────────────────────────────────
let _realDb  = null;   // the actual sql.js Database instance (set after init)
let _dbProxy = null;   // the proxy object returned to callers

// ── Helpers ───────────────────────────────────────────────────────────────────
function saveDb() {
  fs.writeFileSync(DB_PATH, Buffer.from(_realDb.export()));
}

function normaliseParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function rowsToObjects(result) {
  if (!result || !result.values.length) return [];
  return result.values.map(row => {
    const obj = {};
    result.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function makeProxy() {
  function prepare(sql) {
    return {
      get(...params) {
        const res = _realDb.exec(sql, normaliseParams(params));
        if (!res.length) return undefined;
        return rowsToObjects(res[0])[0];
      },
      all(...params) {
        const res = _realDb.exec(sql, normaliseParams(params));
        if (!res.length) return [];
        return rowsToObjects(res[0]);
      },
      run(...params) {
        _realDb.run(sql, normaliseParams(params));
        const meta = _realDb.exec('SELECT last_insert_rowid() AS id');
        const changes = typeof _realDb.getRowsModified === 'function' ? _realDb.getRowsModified() : 1;
        saveDb();
        const row = meta[0]?.values[0] ?? [null];
        return { lastInsertRowid: row[0], changes };
      }
    };
  }

  return {
    prepare,
    exec(sql)   { _realDb.run(sql); saveDb(); },
    pragma(str) { _realDb.run(`PRAGMA ${str}`); },
  };
}

// ── Async initializer (called once; server.js awaits db.ready) ────────────────
const ready = initSqlJs().then(SQL => {
  _realDb = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  _realDb.run('PRAGMA foreign_keys = ON');

  // Schema — separate run() per table (sql.js doesn't support multi-statement)
  _realDb.run(`CREATE TABLE IF NOT EXISTS Admin (
    adminId  INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    email    TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS Doctor (
    doctorId       INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    email          TEXT UNIQUE NOT NULL,
    password       TEXT NOT NULL,
    specialization TEXT,
    adminId        INTEGER,
    FOREIGN KEY (adminId) REFERENCES Admin(adminId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS Pharmacist (
    pharmacistId INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    email        TEXT UNIQUE NOT NULL,
    password     TEXT NOT NULL,
    licenseNo    TEXT,
    adminId      INTEGER,
    FOREIGN KEY (adminId) REFERENCES Admin(adminId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS Patient (
    patientId      INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    email          TEXT UNIQUE NOT NULL,
    password       TEXT NOT NULL,
    dateOfBirth    TEXT,
    medicalHistory TEXT,
    doctorId       INTEGER,
    pharmacistId   INTEGER,
    adminId        INTEGER,
    FOREIGN KEY (doctorId)     REFERENCES Doctor(doctorId),
    FOREIGN KEY (pharmacistId) REFERENCES Pharmacist(pharmacistId),
    FOREIGN KEY (adminId)      REFERENCES Admin(adminId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS Medicine (
    medicineId   INTEGER PRIMARY KEY AUTOINCREMENT,
    patientId    INTEGER NOT NULL,
    pharmacistId INTEGER,
    doctorId     INTEGER,
    name         TEXT NOT NULL,
    dosage       TEXT,
    quantity     INTEGER,
    expiryDate   TEXT,
    dueDate      TEXT,
    status       TEXT DEFAULT 'pending',
    takenAt      TEXT,
    FOREIGN KEY (patientId)    REFERENCES Patient(patientId),
    FOREIGN KEY (pharmacistId) REFERENCES Pharmacist(pharmacistId),
    FOREIGN KEY (doctorId)     REFERENCES Doctor(doctorId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS Vaccination (
    vaccinationId INTEGER PRIMARY KEY AUTOINCREMENT,
    patientId     INTEGER NOT NULL,
    pharmacistId  INTEGER,
    vaccineName   TEXT NOT NULL,
    dueDate       TEXT,
    status        TEXT DEFAULT 'pending',
    FOREIGN KEY (patientId)    REFERENCES Patient(patientId),
    FOREIGN KEY (pharmacistId) REFERENCES Pharmacist(pharmacistId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS Notification (
    notificationId INTEGER PRIMARY KEY AUTOINCREMENT,
    patientId      INTEGER NOT NULL,
    message        TEXT NOT NULL,
    type           TEXT,
    timestamp      TEXT DEFAULT CURRENT_TIMESTAMP,
    isRead         INTEGER DEFAULT 0,
    FOREIGN KEY (patientId) REFERENCES Patient(patientId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS VaccineMasterList (
    listId      INTEGER PRIMARY KEY AUTOINCREMENT,
    adminId     INTEGER,
    vaccineName TEXT NOT NULL,
    FOREIGN KEY (adminId) REFERENCES Admin(adminId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS SystemSettings (
    settingId           INTEGER PRIMARY KEY AUTOINCREMENT,
    adminId             INTEGER,
    notifyThresholdDays INTEGER DEFAULT 7,
    FOREIGN KEY (adminId) REFERENCES Admin(adminId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS DoctorRequest (
    requestId    INTEGER PRIMARY KEY AUTOINCREMENT,
    doctorId     INTEGER NOT NULL,
    pharmacistId INTEGER,
    patientId    INTEGER NOT NULL,
    requestType  TEXT NOT NULL,
    itemName     TEXT NOT NULL,
    dosage       TEXT,
    quantity     INTEGER,
    dueDate      TEXT,
    instructions TEXT,
    status       TEXT DEFAULT 'pending',
    timestamp    TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctorId)     REFERENCES Doctor(doctorId),
    FOREIGN KEY (pharmacistId) REFERENCES Pharmacist(pharmacistId),
    FOREIGN KEY (patientId)    REFERENCES Patient(patientId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS PatientNote (
    noteId       INTEGER PRIMARY KEY AUTOINCREMENT,
    patientId    INTEGER NOT NULL,
    doctorId     INTEGER NOT NULL,
    subject      TEXT NOT NULL,
    message      TEXT NOT NULL,
    severity     TEXT DEFAULT 'normal',
    doctorReply  TEXT,
    repliedAt    TEXT,
    timestamp    TEXT DEFAULT CURRENT_TIMESTAMP,
    status       TEXT DEFAULT 'open',
    FOREIGN KEY (patientId) REFERENCES Patient(patientId),
    FOREIGN KEY (doctorId)  REFERENCES Doctor(doctorId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS RefillRequest (
    refillId     INTEGER PRIMARY KEY AUTOINCREMENT,
    patientId    INTEGER NOT NULL,
    medicineId   INTEGER NOT NULL,
    pharmacistId INTEGER NOT NULL,
    status       TEXT DEFAULT 'pending',
    requestNotes TEXT,
    requestedAt  TEXT DEFAULT CURRENT_TIMESTAMP,
    fulfilledAt  TEXT,
    FOREIGN KEY (patientId)    REFERENCES Patient(patientId),
    FOREIGN KEY (medicineId)   REFERENCES Medicine(medicineId),
    FOREIGN KEY (pharmacistId) REFERENCES Pharmacist(pharmacistId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS PatientVitals (
    vitalId    INTEGER PRIMARY KEY AUTOINCREMENT,
    patientId  INTEGER NOT NULL,
    systolic   INTEGER,
    diastolic  INTEGER,
    bloodSugar REAL,
    sugarType  TEXT DEFAULT 'random',
    pulse      INTEGER,
    notes      TEXT,
    recordedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(patientId)
  )`);

  _realDb.run(`CREATE TABLE IF NOT EXISTS PatientAllergy (
    allergyId   INTEGER PRIMARY KEY AUTOINCREMENT,
    patientId   INTEGER NOT NULL,
    allergen    TEXT NOT NULL,
    severity    TEXT DEFAULT 'moderate',
    reaction    TEXT,
    diagnosedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patientId) REFERENCES Patient(patientId)
  )`);

  // Column migrations for time slots, meal timing, and safety overrides
  try { _realDb.run("ALTER TABLE Medicine ADD COLUMN timeSlot TEXT DEFAULT 'morning'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Medicine ADD COLUMN mealTiming TEXT DEFAULT 'after_meal'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE DoctorRequest ADD COLUMN timeSlot TEXT DEFAULT 'morning'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE DoctorRequest ADD COLUMN mealTiming TEXT DEFAULT 'after_meal'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE DoctorRequest ADD COLUMN safetyOverride INTEGER DEFAULT 0"); } catch (e) {}

  // ── Role-Specific Detailed Profile Column Migrations ───────────────────────
  // Patient fields: phone, bloodGroup, height, weight, gender, address, emergencyContact
  try { _realDb.run("ALTER TABLE Patient ADD COLUMN phone TEXT"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Patient ADD COLUMN bloodGroup TEXT DEFAULT 'O+'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Patient ADD COLUMN height TEXT DEFAULT '175 cm'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Patient ADD COLUMN weight TEXT DEFAULT '70 kg'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Patient ADD COLUMN gender TEXT DEFAULT 'Male'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Patient ADD COLUMN address TEXT"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Patient ADD COLUMN emergencyContact TEXT"); } catch (e) {}

  // Doctor fields: phone, qualification, experience, licenseNo, department, hospital
  try { _realDb.run("ALTER TABLE Doctor ADD COLUMN phone TEXT"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Doctor ADD COLUMN qualification TEXT DEFAULT 'MD, MBBS'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Doctor ADD COLUMN experience TEXT DEFAULT '12+ Years'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Doctor ADD COLUMN licenseNo TEXT DEFAULT 'MED-REG-58210'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Doctor ADD COLUMN department TEXT DEFAULT 'Department of Internal Medicine'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Doctor ADD COLUMN hospital TEXT DEFAULT 'MediCare Metropolitan Hospital'"); } catch (e) {}

  // Pharmacist fields: phone, pharmacyName, qualification, experience
  try { _realDb.run("ALTER TABLE Pharmacist ADD COLUMN phone TEXT"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Pharmacist ADD COLUMN pharmacyName TEXT DEFAULT 'MediCare Central Clinical Dispensary'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Pharmacist ADD COLUMN qualification TEXT DEFAULT 'Pharm.D, BCPS, RPh'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Pharmacist ADD COLUMN experience TEXT DEFAULT '8 Years Clinical Pharmacy'"); } catch (e) {}

  // Admin fields: phone, roleTitle, department, accessLevel
  try { _realDb.run("ALTER TABLE Admin ADD COLUMN phone TEXT DEFAULT '+1 (555) 010-ADMIN'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Admin ADD COLUMN roleTitle TEXT DEFAULT 'Chief Healthcare Systems Administrator'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Admin ADD COLUMN department TEXT DEFAULT 'Health Informatics & System Security'"); } catch (e) {}
  try { _realDb.run("ALTER TABLE Admin ADD COLUMN accessLevel TEXT DEFAULT 'Tier-1 Root Clearance (Full Platform Access)'"); } catch (e) {}

  // Populate default rich profile values for known patients if phone is null
  try {
    _realDb.run(`
      UPDATE Patient SET
        phone = COALESCE(phone, '+1 (555) 234-8891'),
        bloodGroup = COALESCE(bloodGroup, 'O+'),
        height = COALESCE(height, '176 cm'),
        weight = COALESCE(weight, '72 kg'),
        gender = COALESCE(gender, 'Male'),
        address = COALESCE(address, '142 Elmwood Terrace, Springfield, IL 62701'),
        emergencyContact = COALESCE(emergencyContact, 'Mary Patient (Spouse) — +1 (555) 234-8899')
      WHERE patientId = 1 OR email = 'patient@medicare.local'
    `);

    _realDb.run(`
      UPDATE Patient SET
        phone = COALESCE(phone, '+1 (555) 345-1289'),
        bloodGroup = COALESCE(bloodGroup, 'A+'),
        height = COALESCE(height, '165 cm'),
        weight = COALESCE(weight, '58 kg'),
        gender = COALESCE(gender, 'Female'),
        address = COALESCE(address, '78 Riverbed Road, Apt 2C, Springfield, IL 62702'),
        emergencyContact = COALESCE(emergencyContact, 'David Walker (Brother) — +1 (555) 345-9988')
      WHERE patientId = 2 OR email = 'alice@medicare.local'
    `);

    _realDb.run(`
      UPDATE Patient SET
        phone = COALESCE(phone, '+1 (555) 918-2736'),
        bloodGroup = COALESCE(bloodGroup, 'B+'),
        height = COALESCE(height, '180 cm'),
        weight = COALESCE(weight, '82 kg'),
        gender = COALESCE(gender, 'Male'),
        address = COALESCE(address, '502 Pinecrest Blvd, Springfield, IL 62704'),
        emergencyContact = COALESCE(emergencyContact, 'Sarah Brown (Wife) — +1 (555) 918-9900')
      WHERE patientId = 3 OR email = 'michael@medicare.local'
    `);

    // Generic defaults for any other patient where phone is null
    _realDb.run(`
      UPDATE Patient SET
        phone = COALESCE(phone, '+1 (555) 789-0123'),
        bloodGroup = COALESCE(bloodGroup, 'O+'),
        height = COALESCE(height, '172 cm'),
        weight = COALESCE(weight, '68 kg'),
        gender = COALESCE(gender, 'Not Specified'),
        address = COALESCE(address, 'MediCare Regional Clinic Community, Springfield'),
        emergencyContact = COALESCE(emergencyContact, 'Next of Kin — +1 (555) 000-HELP')
      WHERE phone IS NULL
    `);

    // Doctor profile specifics
    _realDb.run(`
      UPDATE Doctor SET
        phone = COALESCE(phone, '+1 (555) 432-1001'),
        qualification = COALESCE(qualification, 'MBBS, MD (General Medicine), FACP'),
        experience = COALESCE(experience, '15 Years Senior Clinical Practice'),
        licenseNo = COALESCE(licenseNo, 'GMC-MED-58190'),
        department = COALESCE(department, 'Department of Primary Care & Internal Medicine'),
        hospital = COALESCE(hospital, 'MediCare Metropolitan Hospital')
      WHERE doctorId = 1 OR email = 'doctor@medicare.local'
    `);

    _realDb.run(`
      UPDATE Doctor SET
        phone = COALESCE(phone, '+1 (555) 432-1002'),
        qualification = COALESCE(qualification, 'MD, FACC, FSCAI (Interventional Cardiology)'),
        experience = COALESCE(experience, '12 Years Cardiovascular Practice'),
        licenseNo = COALESCE(licenseNo, 'GMC-CARD-89214'),
        department = COALESCE(department, 'Cardiovascular Sciences & Arrhythmia Clinic'),
        hospital = COALESCE(hospital, 'MediCare Heart & Vascular Institute')
      WHERE doctorId = 2 OR email = 'dr.johnson@medicare.local'
    `);

    _realDb.run(`
      UPDATE Doctor SET
        phone = COALESCE(phone, '+1 (555) 432-1003'),
        qualification = COALESCE(qualification, 'MD, PhD, FACE (Endocrinology & Metabolism)'),
        experience = COALESCE(experience, '14 Years Metabolic Medicine'),
        licenseNo = COALESCE(licenseNo, 'GMC-ENDO-37192'),
        department = COALESCE(department, 'Division of Endocrinology, Diabetes & Nutrition'),
        hospital = COALESCE(hospital, 'MediCare Specialty Clinics')
      WHERE doctorId = 3 OR email = 'dr.chen@medicare.local'
    `);

    _realDb.run(`
      UPDATE Doctor SET
        phone = COALESCE(phone, '+1 (555) 432-1004'),
        qualification = COALESCE(qualification, 'MD, FAAP (Pediatrics & Internal Medicine)'),
        experience = COALESCE(experience, '9 Years Combined Practice'),
        licenseNo = COALESCE(licenseNo, 'GMC-PED-66281'),
        department = COALESCE(department, 'Pediatric & Adolescent Medicine Unit'),
        hospital = COALESCE(hospital, 'MediCare Children''s Pavilion')
      WHERE doctorId = 4 OR email = 'dr.davis@medicare.local'
    `);

    // Pharmacist profile specifics
    _realDb.run(`
      UPDATE Pharmacist SET
        phone = COALESCE(phone, '+1 (555) 678-2201'),
        licenseNo = COALESCE(licenseNo, 'RPH-001-MAS'),
        pharmacyName = COALESCE(pharmacyName, 'MediCare Central Clinical Dispensary'),
        qualification = COALESCE(qualification, 'Pharm.D, BCPS (Board Certified Pharmacotherapy Specialist)'),
        experience = COALESCE(experience, '11 Years Inpatient & Ambulatory Care')
      WHERE pharmacistId = 1 OR email = 'pharmacist@medicare.local'
    `);

    _realDb.run(`
      UPDATE Pharmacist SET
        phone = COALESCE(phone, '+1 (555) 678-2202'),
        licenseNo = COALESCE(licenseNo, 'RPH-002-MAS'),
        pharmacyName = COALESCE(pharmacyName, 'MediCare Outpatient & Community Pharmacy'),
        qualification = COALESCE(qualification, 'B.Pharm, Pharm.D, Clinical Pharmacist'),
        experience = COALESCE(experience, '7 Years Community & Hospital Pharmacy')
      WHERE pharmacistId = 2 OR email = 'pharma.sarah@medicare.local'
    `);

    // Admin profile defaults
    _realDb.run(`
      UPDATE Admin SET
        phone = COALESCE(phone, '+1 (555) 010-ADMIN'),
        roleTitle = COALESCE(roleTitle, 'Chief Medical Information & Systems Officer'),
        department = COALESCE(department, 'Digital Health Infrastructure & Compliance'),
        accessLevel = COALESCE(accessLevel, 'Tier-1 Root Superuser (Full Platform Authority)')
      WHERE adminId = 1
    `);
  } catch (err) {
    console.warn('Profile defaults seed note:', err.message);
  }

  saveDb();

  // Seed default admin on first run
  const countRes   = _realDb.exec('SELECT COUNT(*) AS c FROM Admin');
  const adminCount = countRes[0]?.values[0][0] ?? 0;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    _realDb.run('INSERT INTO Admin (name, email, password) VALUES (?, ?, ?)',
      ['Super Admin', 'admin@medicare.local', hash]);
    _realDb.run('INSERT INTO SystemSettings (adminId, notifyThresholdDays) VALUES (1, 7)');
    saveDb();
    console.log('Seeded default admin: admin@medicare.local / admin123');
  }

  // Seed default sample allergies if none exist
  const allergyRes = _realDb.exec('SELECT COUNT(*) AS c FROM PatientAllergy');
  const allergyCount = allergyRes[0]?.values[0][0] ?? 0;
  if (allergyCount === 0) {
    const patientsRes = _realDb.exec('SELECT patientId, email FROM Patient');
    if (patientsRes.length && patientsRes[0].values.length) {
      const patientList = patientsRes[0].values.map(r => ({ id: r[0], email: r[1] }));
      patientList.forEach((p, idx) => {
        if (p.id === 1 || p.email === 'john@medicare.local') {
          _realDb.run("INSERT INTO PatientAllergy (patientId, allergen, severity, reaction) VALUES (?, ?, ?, ?)",
            [p.id, 'Penicillin', 'severe', 'Anaphylaxis, severe hives and swelling']);
          _realDb.run("INSERT INTO PatientAllergy (patientId, allergen, severity, reaction) VALUES (?, ?, ?, ?)",
            [p.id, 'Aspirin', 'moderate', 'Gastrointestinal upset & bronchospasm']);
        } else if (p.id === 2 || p.email === 'jane@medicare.local') {
          _realDb.run("INSERT INTO PatientAllergy (patientId, allergen, severity, reaction) VALUES (?, ?, ?, ?)",
            [p.id, 'Sulfa Drugs', 'moderate', 'Cutaneous rash & fever']);
        } else if (idx % 2 === 0) {
          _realDb.run("INSERT INTO PatientAllergy (patientId, allergen, severity, reaction) VALUES (?, ?, ?, ?)",
            [p.id, 'NSAIDs (Ibuprofen/Naproxen)', 'moderate', 'Mild rash and stomach cramping']);
        }
      });
      saveDb();
    }
  }

  // Seed default historical vitals if none exist
  const vitalsRes = _realDb.exec('SELECT COUNT(*) AS c FROM PatientVitals');
  const vitalsCount = vitalsRes[0]?.values[0][0] ?? 0;
  if (vitalsCount === 0) {
    const patientsRes = _realDb.exec('SELECT patientId FROM Patient');
    if (patientsRes.length && patientsRes[0].values.length) {
      const pids = patientsRes[0].values.map(r => r[0]);
      const now = new Date();
      pids.forEach(pid => {
        // Generate 7-10 entries over past 2 weeks
        for (let dayOffset = 14; dayOffset >= 0; dayOffset -= 2) {
          const d = new Date(now);
          d.setDate(d.getDate() - dayOffset);
          d.setHours(8 + (dayOffset % 4), 15 + (dayOffset * 3) % 45, 0);
          const dateStr = d.toISOString().replace('T', ' ').substring(0, 19);

          // Realistic variations: higher BP/sugar when adhering poorly, normal when adhering well
          const baseSys = (pid % 2 === 1) ? 128 : 138;
          const sys = baseSys + ((dayOffset * 7) % 18) - 6;
          const dia = Math.round(sys * 0.65) + ((dayOffset * 3) % 8);
          const sugar = 100 + ((pid * 15 + dayOffset * 8) % 65);
          const pulse = 70 + ((pid * 7 + dayOffset * 4) % 18);
          const type = (dayOffset % 2 === 0) ? 'fasting' : 'post_prandial';

          _realDb.run(
            `INSERT INTO PatientVitals (patientId, systolic, diastolic, bloodSugar, sugarType, pulse, notes, recordedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [pid, sys, dia, sugar, type, pulse, `Routine ${type} check`, dateStr]
          );
        }
      });
      saveDb();
    }
  }

  _dbProxy = makeProxy();
  return _dbProxy;
});

// ── Exported lazy proxy ───────────────────────────────────────────────────────
// Routes call db.prepare(...) etc. synchronously AFTER server.js has awaited
// db.ready, so _realDb is guaranteed to be non-null by then.
const db = {
  get ready() { return ready; },
  prepare(sql)  { return _dbProxy.prepare(sql); },
  exec(sql)     { return _dbProxy.exec(sql); },
  pragma(str)   { return _dbProxy.pragma(str); },
};

module.exports = db;
