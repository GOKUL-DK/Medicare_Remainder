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

// Ensure DB is initialized before processing requests
app.use(async (req, res, next) => {
  try {
    await db.ready;
    next();
  } catch (err) {
    console.error('Database initialization failed:', err);
    res.status(500).json({ error: 'Database initialisation failed' });
  }
});

app.use('/api/auth',       authRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/pharmacist', pharmacistRoutes);
app.use('/api/patient',    patientRoutes);
app.use('/api/doctor',     doctorRoutes);

// Serve the front-end
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;

// Initialize background monitor when DB is ready
db.ready.then(() => {
  try {
    const { startAdherenceMonitor } = require('./services/adherenceMonitor');
    startAdherenceMonitor();
  } catch (e) {
    console.error('Failed to start adherence monitor:', e);
  }
}).catch(err => {
  console.error('Failed to initialise database:', err);
});

// Run HTTP server if started directly via node
if (require.main === module) {
  db.ready.then(() => {
    app.listen(PORT, () => {
      console.log(`MediCare Reminder server running on http://localhost:${PORT}`);
    });
  });
}

module.exports = app;
