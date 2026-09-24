// interactionChecker.js — Clinical Safety & Drug-Drug / Allergy Checker Engine
const db = require('../db');

// Knowledge base of clinically significant Drug-Drug Interactions
const DRUG_INTERACTION_RULES = [
  {
    drugs: ['warfarin', 'aspirin'],
    level: 'critical',
    title: 'Severe Bleeding & Hemorrhage Risk',
    description: 'Concurrent use of Warfarin (anticoagulant) and Aspirin (antiplatelet) substantially enhances hypoprothrombinemic response and increases the risk of major upper GI and intracranial bleeding.',
    recommendation: 'Avoid combination unless specifically indicated (e.g. mechanical heart valves). Monitor INR closely.'
  },
  {
    drugs: ['warfarin', 'ibuprofen'],
    level: 'critical',
    title: 'Major Gastrointestinal Ulceration & Hemorrhage Risk',
    description: 'NSAIDs like Ibuprofen inhibit platelet aggregation and cause gastric mucosal damage, significantly magnifying Warfarin anticoagulation toxicity.',
    recommendation: 'Avoid NSAIDs; consider acetaminophen for analgesia if appropriate.'
  },
  {
    drugs: ['warfarin', 'naproxen'],
    level: 'critical',
    title: 'Major Gastrointestinal Ulceration & Hemorrhage Risk',
    description: 'Naproxen strongly potentiates bleeding risks and GI bleeding when combined with Warfarin.',
    recommendation: 'Use non-NSAID alternatives (e.g., topical analgesics or acetaminophen).'
  },
  {
    drugs: ['clopidogrel', 'aspirin'],
    level: 'major',
    title: 'Dual Antiplatelet Therapy Bleeding Precaution',
    description: 'Combining Clopidogrel (Plavix) and Aspirin produces additive inhibition of platelet aggregation, elevating bleeding risk.',
    recommendation: 'Ensure dual antiplatelet therapy (DAPT) duration is clinically justified and monitor for signs of hemorrhage.'
  },
  {
    drugs: ['clopidogrel', 'omeprazole'],
    level: 'major',
    title: 'Reduced Antiplatelet Efficacy via CYP2C19 Inhibition',
    description: 'Omeprazole inhibits CYP2C19, decreasing the metabolic activation of Clopidogrel and reducing its cardioprotective efficacy.',
    recommendation: 'Consider switching to pantoprazole or an H2 blocker (famotidine).'
  },
  {
    drugs: ['lisinopril', 'spironolactone'],
    level: 'major',
    title: 'Risk of Severe Hyperkalemia & Cardiac Arrhythmia',
    description: 'Concomitant administration of ACE inhibitors (Lisinopril) with potassium-sparing diuretics (Spironolactone) can cause lethal serum potassium elevation.',
    recommendation: 'Monitor serum potassium and renal function closely within 1-2 weeks of initiation.'
  },
  {
    drugs: ['lisinopril', 'potassium'],
    level: 'major',
    title: 'Hyperkalemia Risk',
    description: 'Potassium supplements combined with ACE inhibitors lead to impaired potassium excretion.',
    recommendation: 'Avoid routine potassium supplementation unless hypokalemia is documented.'
  },
  {
    drugs: ['lisinopril', 'losartan'],
    level: 'major',
    title: 'Dual Renin-Angiotensin System (RAS) Blockade',
    description: 'Combining ACE inhibitors (Lisinopril) and ARBs (Losartan) increases hypotension, hyperkalemia, and acute kidney injury risk without added benefit.',
    recommendation: 'Dual RAS blockade is generally not recommended.'
  },
  {
    drugs: ['atorvastatin', 'clarithromycin'],
    level: 'major',
    title: 'Severe Rhabdomyolysis & Myopathy Risk',
    description: 'Clarithromycin strongly inhibits CYP3A4, dramatically elevating serum Atorvastatin / Simvastatin concentrations.',
    recommendation: 'Temporarily suspend statin therapy during clarithromycin course or switch to azithromycin.'
  },
  {
    drugs: ['simvastatin', 'clarithromycin'],
    level: 'critical',
    title: 'Severe Rhabdomyolysis & Myopathy Risk',
    description: 'Clarithromycin increases Simvastatin exposure up to 10-fold, triggering severe acute muscle breakdown and renal failure.',
    recommendation: 'Contraindicated. Suspend Simvastatin during antibiotic treatment.'
  },
  {
    drugs: ['metformin', 'ibuprofen'],
    level: 'moderate',
    title: 'Renal Impairment & Potential Lactic Acidosis',
    description: 'NSAIDs may acutely reduce glomerular filtration rate, causing metformin accumulation and increasing lactic acidosis risk.',
    recommendation: 'Ensure adequate hydration and monitor eGFR in patients on long-term NSAIDs.'
  },
  {
    drugs: ['propranolol', 'albuterol'],
    level: 'major',
    title: 'Bronchodilator Antagonism & Severe Bronchospasm',
    description: 'Non-selective beta-blockers (Propranolol) antagonize beta-2 agonist bronchodilators (Albuterol), precipitating acute asthma exacerbation.',
    recommendation: 'Use cardio-selective beta-blockers (e.g. Metoprolol, Bisoprolol) with caution or alternative antihypertensives.'
  },
  {
    drugs: ['sildenafil', 'nitroglycerin'],
    level: 'critical',
    title: 'Life-Threatening Hypotension & Cardiovascular Collapse',
    description: 'PDE5 inhibitors markedly potentiate the hypotensive effects of organic nitrates (Nitroglycerin/Isosorbide).',
    recommendation: 'Absolute contraindication. Do not co-administer.'
  },
  {
    drugs: ['tramadol', 'fluoxetine'],
    level: 'major',
    title: 'Serotonin Syndrome & Lowered Seizure Threshold',
    description: 'Combining serotonergic analgesics with SSRIs increases risk of Serotonin Syndrome (tremor, hyperreflexia, agitation) and seizures.',
    recommendation: 'Monitor for neurovegetative symptoms; consider alternative pain regimens.'
  },
  {
    drugs: ['ciprofloxacin', 'theophylline'],
    level: 'major',
    title: 'Theophylline Toxicity via CYP1A2 Inhibition',
    description: 'Ciprofloxacin inhibits theophylline clearance, causing nausea, palpitations, arrhythmias, and seizures.',
    recommendation: 'Reduce theophylline dose by 50% and monitor serum levels closely.'
  },
  {
    drugs: ['methotrexate', 'amoxicillin'],
    level: 'major',
    title: 'Methotrexate Toxicity (Bone Marrow Suppression)',
    description: 'Penicillins reduce renal tubular secretion of methotrexate, elevating serum methotrexate levels to toxic thresholds.',
    recommendation: 'Avoid combination or monitor complete blood count and methotrexate clearance closely.'
  }
];

// Knowledge base of Allergen-Drug Cross-Reactivity
const ALLERGY_CROSS_REACTIVE_MAP = [
  {
    allergenKeywords: ['penicillin', 'amoxicillin', 'ampicillin', 'penam', 'beta-lactam'],
    drugKeywords: ['penicillin', 'amoxicillin', 'ampicillin', 'augmentin', 'piperacillin', 'unasyn', 'ticarcillin', 'cephalexin', 'cefazolin', 'cefaclor'],
    allergenClass: 'Penicillin / Beta-Lactam Antibiotics',
    risk: 'Severe hypersensitivity reaction including anaphylaxis, bronchospasm, urticaria, and angioedema.'
  },
  {
    allergenKeywords: ['sulfa', 'sulfonamide', 'sulfamethoxazole', 'bactrim', 'septra'],
    drugKeywords: ['sulfamethoxazole', 'bactrim', 'septra', 'sulfasalazine', 'sulfadiazine', 'zonisamide', 'celecoxib'],
    allergenClass: 'Sulfonamide Class',
    risk: 'Potential Steven-Johnson syndrome (SJS), severe toxic epidermal necrolysis, or diffuse maculopapular rash.'
  },
  {
    allergenKeywords: ['aspirin', 'nsaid', 'ibuprofen', 'naproxen', 'ketorolac'],
    drugKeywords: ['aspirin', 'ibuprofen', 'advil', 'motrin', 'naproxen', 'aleve', 'ketorolac', 'diclofenac', 'meloxicam', 'indomethacin', 'celecoxib'],
    allergenClass: 'NSAIDs / Salicylates',
    risk: 'Samter\'s triad exacerbation, severe bronchospasm, facial edema, or anaphylactoid reaction.'
  },
  {
    allergenKeywords: ['statin', 'atorvastatin', 'simvastatin', 'rosuvastatin'],
    drugKeywords: ['atorvastatin', 'simvastatin', 'rosuvastatin', 'pravastatin', 'fluvastatin', 'lovastatin'],
    allergenClass: 'HMG-CoA Reductase Inhibitors (Statins)',
    risk: 'Immune-mediated necrotizing myopathy, severe generalized myalgia, or elevated transaminases.'
  },
  {
    allergenKeywords: ['opioid', 'codeine', 'morphine', 'tramadol', 'oxycodone'],
    drugKeywords: ['codeine', 'morphine', 'oxycodone', 'hydrocodone', 'tramadol', 'hydromorphone', 'fentanyl'],
    allergenClass: 'Opioid Analgesics',
    risk: 'Severe histamine release, respiratory depression, pruritus, or anaphylactoid reaction.'
  },
  {
    allergenKeywords: ['iodine', 'contrast'],
    drugKeywords: ['iodinated contrast', 'amiodarone', 'potassium iodide'],
    allergenClass: 'Iodine / Contrast Agents',
    risk: 'Severe anaphylactoid and cutaneous allergic response.'
  }
];

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
}

function matchesDrug(name, targetKeyword) {
  const normName = normalize(name);
  const normKeyword = normalize(targetKeyword);
  if (!normName || !normKeyword) return false;
  return normName.includes(normKeyword) || normKeyword.includes(normName);
}

/**
 * Checks safety of a proposed drug for a given patient.
 * @param {number} patientId
 * @param {string} proposedDrugName
 * @returns {object} { isSafe, warnings: [], activeMeds: [], allergies: [] }
 */
function checkSafety(patientId, proposedDrugName) {
  const warnings = [];

  if (!patientId || !proposedDrugName) {
    return { isSafe: true, warnings: [] };
  }

  // 1. Fetch active medicines for patient
  let activeMedicines = [];
  try {
    activeMedicines = db
      .prepare("SELECT medicineId, name, dosage, status FROM Medicine WHERE patientId = ? AND status != 'deleted'")
      .all(patientId);
  } catch (e) {
    activeMedicines = [];
  }

  // 2. Fetch documented allergies for patient
  let allergies = [];
  try {
    allergies = db
      .prepare("SELECT allergyId, allergen, severity, reaction FROM PatientAllergy WHERE patientId = ?")
      .all(patientId);
  } catch (e) {
    allergies = [];
  }

  const propNorm = normalize(proposedDrugName);

  // 3. Check Allergy Conflicts
  for (const allergy of allergies) {
    const allergenNorm = normalize(allergy.allergen);

    // Direct match between allergen and proposed drug
    if (propNorm.includes(allergenNorm) || allergenNorm.includes(propNorm)) {
      warnings.push({
        type: 'allergy-conflict',
        level: allergy.severity === 'severe' ? 'critical' : 'major',
        title: `⚠️ DIRECT ALLERGY MATCH: ${allergy.allergen}`,
        description: `Patient has a documented ${allergy.severity.toUpperCase()} allergy to "${allergy.allergen}". Reaction noted: "${allergy.reaction || 'Hypersensitivity'}". Prescribing "${proposedDrugName}" poses an immediate risk.`,
        recommendation: `DO NOT DISPENSE without clinical justification and emergency precautions. Consider non-cross-reactive alternatives.`,
        allergyId: allergy.allergyId
      });
      continue;
    }

    // Class cross-reactivity match
    for (const crossRule of ALLERGY_CROSS_REACTIVE_MAP) {
      const matchesAllergen = crossRule.allergenKeywords.some(kw => allergenNorm.includes(kw));
      const matchesProposed = crossRule.drugKeywords.some(kw => propNorm.includes(kw));

      if (matchesAllergen && matchesProposed) {
        warnings.push({
          type: 'allergy-conflict',
          level: allergy.severity === 'severe' ? 'critical' : 'major',
          title: `⚠️ ALLERGY CROSS-REACTIVITY: ${crossRule.allergenClass}`,
          description: `Patient has documented allergy to "${allergy.allergen}" (${allergy.reaction || 'Allergic reaction'}). "${proposedDrugName}" belongs to or cross-reacts with the ${crossRule.allergenClass}. Risk: ${crossRule.risk}`,
          recommendation: `Verify allergy history with patient and consider allergy-safe therapeutic class substitution.`,
          allergyId: allergy.allergyId
        });
        break;
      }
    }
  }

  // 4. Check Drug-Drug Interactions with Active Medicines
  for (const activeMed of activeMedicines) {
    const activeNorm = normalize(activeMed.name);

    for (const rule of DRUG_INTERACTION_RULES) {
      const match1 = (propNorm.includes(rule.drugs[0]) && activeNorm.includes(rule.drugs[1]));
      const match2 = (propNorm.includes(rule.drugs[1]) && activeNorm.includes(rule.drugs[0]));

      if (match1 || match2) {
        warnings.push({
          type: 'drug-interaction',
          level: rule.level,
          title: `⚡ DRUG INTERACTION: ${proposedDrugName} + ${activeMed.name}`,
          description: rule.description,
          recommendation: rule.recommendation,
          conflictingMedicine: activeMed.name
        });
      }
    }
  }

  const hasCritical = warnings.some(w => w.level === 'critical');
  const hasMajor = warnings.some(w => w.level === 'major');
  const isSafe = warnings.length === 0;

  return {
    isSafe,
    hasCritical,
    hasMajor,
    warnings,
    activeMedicinesCount: activeMedicines.length,
    allergiesCount: allergies.length,
    activeMedicines,
    allergies
  };
}

/**
 * Checks all active medications of a patient against each other for baseline interactions.
 * @param {number} patientId
 */
function checkPatientMedicationConflicts(patientId) {
  let activeMedicines = [];
  try {
    activeMedicines = db
      .prepare("SELECT medicineId, name, dosage, status FROM Medicine WHERE patientId = ? AND status != 'deleted'")
      .all(patientId);
  } catch (e) {
    return [];
  }

  const conflicts = [];
  for (let i = 0; i < activeMedicines.length; i++) {
    for (let j = i + 1; j < activeMedicines.length; j++) {
      const medA = normalize(activeMedicines[i].name);
      const medB = normalize(activeMedicines[j].name);

      for (const rule of DRUG_INTERACTION_RULES) {
        const match = (medA.includes(rule.drugs[0]) && medB.includes(rule.drugs[1])) ||
                      (medA.includes(rule.drugs[1]) && medB.includes(rule.drugs[0]));
        if (match) {
          conflicts.push({
            med1: activeMedicines[i].name,
            med2: activeMedicines[j].name,
            level: rule.level,
            title: rule.title,
            description: rule.description,
            recommendation: rule.recommendation
          });
        }
      }
    }
  }

  return conflicts;
}

module.exports = {
  checkSafety,
  checkPatientMedicationConflicts,
  DRUG_INTERACTION_RULES,
  ALLERGY_CROSS_REACTIVE_MAP
};
