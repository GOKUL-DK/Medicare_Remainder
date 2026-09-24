const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');

const authRoutes       = require('./routes/auth');
const adminRoutes      = require('./routes/admin');
const pharmacistRoutes = require('./routes/pharmacist');
const patientRoutes    = require('./routes/patient');
const doctorRoutes     = require('./routes/doctor');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth',       authRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/pharmacist', pharmacistRoutes);
app.use('/api/patient',    patientRoutes);
app.use('/api/doctor',     doctorRoutes);

// Serve the front-end
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;

// Wait for the DB to initialise (sql.js is async) before accepting requests
db.ready.then(() => {
  const { startAdherenceMonitor } = require('./services/adherenceMonitor');
  app.listen(PORT, () => {
    console.log(`MediCare Reminder server running on http://localhost:${PORT}`);
    startAdherenceMonitor();
  });
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
