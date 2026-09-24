const db = require('../db');

// Runs periodically. Implements: ReminderSent -> Missed -> AlertSent (state chart)
function checkAndFlagMissed() {
  const overdue = db
    .prepare("SELECT * FROM Medicine WHERE status = 'pending' AND dueDate < date('now')")
    .all();

  for (const med of overdue) {
    db.prepare("UPDATE Medicine SET status = 'missed' WHERE medicineId = ?").run(med.medicineId);

    // createAlert() + sendAlert() -- logged as a notification the doctor can read via /doctor/alerts
    db.prepare(
      `INSERT INTO Notification (patientId, message, type) VALUES (?, ?, 'alert')`
    ).run(
      med.patientId,
      `Missed dose: ${med.name} (${med.dosage}) was due ${med.dueDate} and has not been taken.`
    );
  }

  const overdueVax = db
    .prepare("SELECT * FROM Vaccination WHERE status = 'pending' AND dueDate < date('now')")
    .all();

  for (const vax of overdueVax) {
    db.prepare("UPDATE Vaccination SET status = 'missed' WHERE vaccinationId = ?").run(vax.vaccinationId);
    db.prepare(
      `INSERT INTO Notification (patientId, message, type) VALUES (?, ?, 'alert')`
    ).run(vax.patientId, `Missed vaccination: ${vax.vaccineName} was due ${vax.dueDate}.`);
  }

  if (overdue.length || overdueVax.length) {
    console.log(`[AdherenceMonitor] Flagged ${overdue.length} medicine(s) and ${overdueVax.length} vaccination(s) as missed.`);
  }
}

// checkExpiringMedicines(): warns before expiry, using the admin-configured threshold
function checkExpiringSoon() {
  const settings = db.prepare('SELECT * FROM SystemSettings LIMIT 1').get();
  const thresholdDays = settings ? settings.notifyThresholdDays : 7;

  const expiring = db
    .prepare(
      `SELECT * FROM Medicine
       WHERE status = 'pending'
         AND expiryDate IS NOT NULL
         AND date(expiryDate) <= date('now', '+' || ? || ' days')`
    )
    .all(thresholdDays);

  for (const med of expiring) {
    const already = db
      .prepare("SELECT 1 FROM Notification WHERE patientId = ? AND message LIKE ? AND type = 'expiry'")
      .get(med.patientId, `%${med.name}%expiring%`);
    if (already) continue;

    db.prepare(`INSERT INTO Notification (patientId, message, type) VALUES (?, ?, 'expiry')`).run(
      med.patientId,
      `${med.name} is expiring on ${med.expiryDate}. Please refill soon.`
    );
  }
}

function startAdherenceMonitor(intervalMs = 60 * 60 * 1000) {
  checkAndFlagMissed();
  checkExpiringSoon();
  setInterval(() => {
    checkAndFlagMissed();
    checkExpiringSoon();
  }, intervalMs);
  console.log('[AdherenceMonitor] Background service started.');
}

module.exports = { startAdherenceMonitor, checkAndFlagMissed, checkExpiringSoon };
