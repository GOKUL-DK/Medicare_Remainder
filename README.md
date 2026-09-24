# 🏥 MediCare Reminder

A full-stack healthcare web platform engineered for medication adherence, daily pillbox scheduling, clinical safety & drug-drug interaction (DDI) checks, patient vitals tracking, and doctor-pharmacist coordination.

---

## 🌟 Key Features

* **💊 Smart Daily Pillbox & Monthly Calendar**: Time-slot organized dose management (Morning, Afternoon, Evening, Night) with meal timing instructions and monthly adherence history.
* **🛡️ Real-Time Clinical Safety Engine**: Automated Drug-Drug Interaction (DDI) & allergy cross-reactivity warning system with clinical override gating.
* **❤️ Health Vitals & Biometrics Logging**: Patient Blood Pressure (Systolic/Diastolic), Blood Glucose, and Pulse tracking with automated high-risk clinical alerts.
* **📊 Doctor Analytics & Correlation Charts**: Dual-axis visualization linking medication adherence percentages directly with blood pressure and glucose outcomes.
* **👥 4 Role-Based Portals**:
  * **Patient Portal**: Daily pillbox, adherence calendar, vitals logger, refill requests, direct doctor messaging, and health profile.
  * **Doctor Portal**: Population adherence charts, prescription safety engine, vitals correlation audits, patient notes replies.
  * **Pharmacist Portal**: Prescription order queue, direct dispensing with safety verification, refill approvals, label generation.
  * **Admin Portal**: User management, physician-pharmacist assignments, vaccine master list, notification thresholds, and audit exports.
* **👤 Interactive User Profile System**: Clickable sidebar user profiles detailing Blood Group, DOB/Age, Height, Weight, Phone, Medical Qualifications, and Emergency Contacts.

---

## 🛠️ Tech Stack

* **Backend**: Node.js, Express.js, JWT Authentication, bcryptjs
* **Database**: SQLite (via WASM sql.js engine)
* **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3 Custom Properties Design System, Chart.js

---

## 🚀 Quick Start Guide

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v16 or higher)

### 2. Installation & Running
```bash
# Navigate to the backend directory
cd backend

# Install dependencies (if not already installed)
npm install

# Start the server
node server.js
```

### 3. Accessing the Application
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 🔐 Default Demo Credentials

| Role | Email | Password |
|---|---|---|
| **Patient** | `patient@medicare.local` | `patient123` |
| **Doctor** | `doctor@medicare.local` | `doctor123` |
| **Pharmacist** | `pharmacist@medicare.local` | `pharma123` |
| **Admin** | `admin@medicare.local` | `admin123` |
