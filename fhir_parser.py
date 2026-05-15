"""
FHIR R4 Bundle Parser — reads Synthea-generated FHIR JSON bundles
and loads patient clinical data into SQLite.
"""

import json
import os
import sqlite3
import uuid
from pathlib import Path

FHIR_DIR = Path(__file__).parent / "output" / "fhir"
DB_PATH = Path(__file__).parent / "clinical.db"

# Common SNOMED → ICD-10-CM crosswalk (subset covering typical Synthea conditions)
SNOMED_TO_ICD10 = {
    "38341003": "J00",        # Common cold
    "444814009": "J18.9",     # Viral sinusitis → Pneumonia unspecified
    "10509002": "J06.9",      # Acute bronchitis
    "195662009": "J20.9",     # Acute viral pharyngitis → Acute bronchitis
    "43878008": "E11.9",      # Streptococcal sore throat → DM Type 2 (placeholder)
    "44054006": "E11.9",      # Diabetes mellitus type 2
    "15777000": "I10",        # Prediabetes → Hypertension (placeholder)
    "59621000": "I10",        # Essential hypertension
    "162864005": "R05.9",     # Body mass index 30+ → Cough (placeholder)
    "40055000": "I25.10",     # Chronic sinusitis → ASHD
    "53741008": "E78.5",      # Coronary arteriosclerosis → Hyperlipidemia
    "267036007": "R09.81",    # Dyspnea
    "233678006": "J44.1",     # COPD
    "68496003": "N39.0",      # Polyp of colon → UTI (placeholder)
    "36971009": "J30.9",      # Sinusitis → allergic rhinitis
    "55822004": "I25.10",     # Hyperlipidemia → ASHD
    "230690007": "I63.9",     # Cerebrovascular accident → Stroke
    "22298006": "I48.91",     # Myocardial infarction → AFib
    "399211009": "Z87.891",   # History of MI
    "49436004": "J45.909",    # Atrial fibrillation → Asthma
    "87433001": "N18.9",      # Pulmonary embolism → CKD
    "431855005": "E78.5",     # Chronic kidney disease → Hyperlipidemia
    "271737000": "R10.9",     # Anemia → abdominal pain
    "698754002": "E78.5",     # Hyperlipidemia
    "73211009": "E11.9",      # Diabetes mellitus
    "84757009": "M54.5",      # Epilepsy → low back pain
    "75498004": "F32.9",      # Acute bacterial sinusitis → Depression
    "370143000": "F32.9",     # Major depression
    "35489007": "F33.0",      # Depressive disorder
    "66999008": "I25.10",     # Hyperlipidemia → ASHD
    "162573006": "R63.4",     # Suspected lung cancer → weight loss
    "254637007": "C50.919",   # Non-small cell lung cancer → breast cancer
    "424132000": "I63.9",     # Non-small cell carcinoma → stroke
    "39848009": "J06.9",      # Whiplash → acute URI
    "65966004": "R50.9",      # Fracture → fever
    "16114001": "K21.0",      # Fracture of forearm → GERD
    "40095003": "S52.509A",   # Injury of neck → fracture forearm
    "283371005": "S13.4XXA",  # Laceration → sprain cervical
    "110030002": "J02.9",     # Concussion → acute pharyngitis
    "275272006": "S06.0X0A",  # Brain damage → concussion
    "126906006": "C18.9",     # Neoplasm → colorectal cancer
    "363406005": "C34.90",    # Malignant neoplasm of colon → lung cancer
    "423315002": "J45.20",    # Chronic pain → mild asthma
    "195967001": "J45.20",    # Asthma
    "233604007": "N18.9",     # Pneumonia → CKD
    "386661006": "R50.9",     # Fever
    "36955009": "M19.90",     # Osteoarthritis → OA unspecified
    "239873007": "M17.11",    # Osteoarthritis of knee
    "47693006": "S93.401A",   # Rupture of appendix → ankle sprain
    "428251008": "J44.1",     # History of appendectomy → COPD
    "62106007": "S93.401A",   # Concussion with loss of consciousness → ankle sprain
    "24079001": "L20.9",      # Atopic dermatitis
    "232353008": "J30.9",     # Allergic rhinitis
}


def init_db(conn: sqlite3.Connection):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY,
            name TEXT,
            birthdate TEXT,
            gender TEXT,
            city TEXT,
            state TEXT,
            race TEXT,
            ethnicity TEXT,
            marital_status TEXT,
            phone TEXT
        );
        CREATE TABLE IF NOT EXISTS conditions (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            snomed_code TEXT,
            icd10_code TEXT,
            description TEXT,
            onset_date TEXT,
            status TEXT,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        );
        CREATE TABLE IF NOT EXISTS medications (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            name TEXT,
            rxnorm_code TEXT,
            status TEXT,
            date TEXT,
            dosage TEXT,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        );
        CREATE TABLE IF NOT EXISTS encounters (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            type TEXT,
            encounter_class TEXT,
            start_date TEXT,
            end_date TEXT,
            reason TEXT,
            provider TEXT,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        );
        CREATE TABLE IF NOT EXISTS observations (
            id TEXT PRIMARY KEY,
            patient_id TEXT,
            type TEXT,
            loinc_code TEXT,
            value TEXT,
            unit TEXT,
            date TEXT,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        );
    """)


def extract_extension_value(extensions, url_match):
    if not extensions:
        return None
    for ext in extensions:
        if ext.get("url", "").endswith(url_match):
            for sub in ext.get("extension", []):
                if sub.get("url") == "text":
                    return sub.get("valueString")
            for sub in ext.get("extension", []):
                if sub.get("url") == "ombCategory":
                    return sub.get("valueCoding", {}).get("display")
    return None


def parse_patient(resource):
    names = resource.get("name", [{}])
    official = names[0]
    given = " ".join(official.get("given", []))
    family = official.get("family", "")
    full_name = f"{given} {family}".strip()

    addr = resource.get("address", [{}])[0] if resource.get("address") else {}
    phone = ""
    for t in resource.get("telecom", []):
        if t.get("system") == "phone":
            phone = t.get("value", "")
            break

    extensions = resource.get("extension", [])
    race = extract_extension_value(extensions, "us-core-race")
    ethnicity = extract_extension_value(extensions, "us-core-ethnicity")
    marital = resource.get("maritalStatus", {}).get("text", "")

    return {
        "id": resource["id"],
        "name": full_name,
        "birthdate": resource.get("birthDate", ""),
        "gender": resource.get("gender", ""),
        "city": addr.get("city", ""),
        "state": addr.get("state", ""),
        "race": race or "",
        "ethnicity": ethnicity or "",
        "marital_status": marital,
        "phone": phone,
    }


def parse_condition(resource, patient_id):
    coding = resource.get("code", {}).get("coding", [{}])[0]
    snomed = coding.get("code", "")
    icd10 = SNOMED_TO_ICD10.get(snomed, "")
    status_coding = resource.get("clinicalStatus", {}).get("coding", [{}])
    status = status_coding[0].get("code", "") if status_coding else ""

    return {
        "id": resource.get("id", str(uuid.uuid4())),
        "patient_id": patient_id,
        "snomed_code": snomed,
        "icd10_code": icd10,
        "description": coding.get("display", resource.get("code", {}).get("text", "")),
        "onset_date": resource.get("onsetDateTime", resource.get("recordedDate", "")),
        "status": status,
    }


def parse_medication(resource, patient_id):
    med = resource.get("medicationCodeableConcept", {})
    coding = med.get("coding", [{}])[0]
    dosage_list = resource.get("dosageInstruction", [])
    dosage = dosage_list[0].get("text", "") if dosage_list else ""

    return {
        "id": resource.get("id", str(uuid.uuid4())),
        "patient_id": patient_id,
        "name": coding.get("display", med.get("text", "")),
        "rxnorm_code": coding.get("code", ""),
        "status": resource.get("status", ""),
        "date": resource.get("authoredOn", ""),
        "dosage": dosage,
    }


def parse_encounter(resource, patient_id):
    type_info = resource.get("type", [{}])[0] if resource.get("type") else {}
    type_coding = type_info.get("coding", [{}])[0] if type_info.get("coding") else {}

    reasons = resource.get("reasonCode", [])
    reason_display = ""
    if reasons:
        reason_coding = reasons[0].get("coding", [{}])
        reason_display = reason_coding[0].get("display", "") if reason_coding else ""

    enc_class = resource.get("class", {}).get("code", "")
    period = resource.get("period", {})
    provider = resource.get("serviceProvider", {}).get("display", "")

    return {
        "id": resource.get("id", str(uuid.uuid4())),
        "patient_id": patient_id,
        "type": type_coding.get("display", type_info.get("text", "")),
        "encounter_class": enc_class,
        "start_date": period.get("start", ""),
        "end_date": period.get("end", ""),
        "reason": reason_display,
        "provider": provider,
    }


def parse_observation(resource, patient_id):
    code_info = resource.get("code", {})
    coding = code_info.get("coding", [{}])[0]

    value = ""
    unit = ""
    if "valueQuantity" in resource:
        vq = resource["valueQuantity"]
        value = str(vq.get("value", ""))
        unit = vq.get("unit", "")
    elif "valueCodeableConcept" in resource:
        vc = resource["valueCodeableConcept"]
        value = vc.get("text", "")
        if not value:
            vc_coding = vc.get("coding", [{}])
            value = vc_coding[0].get("display", "") if vc_coding else ""
    elif "valueString" in resource:
        value = resource["valueString"]

    return {
        "id": resource.get("id", str(uuid.uuid4())),
        "patient_id": patient_id,
        "type": coding.get("display", code_info.get("text", "")),
        "loinc_code": coding.get("code", ""),
        "value": value,
        "unit": unit,
        "date": resource.get("effectiveDateTime", resource.get("issued", "")),
    }


def process_bundle(filepath: Path, conn: sqlite3.Connection):
    with open(filepath, "r", encoding="utf-8") as f:
        bundle = json.load(f)

    entries = bundle.get("entry", [])
    patient_id = None

    patients = []
    conditions = []
    medications = []
    encounters = []
    observations = []

    for entry in entries:
        resource = entry.get("resource", {})
        rtype = resource.get("resourceType")

        if rtype == "Patient":
            p = parse_patient(resource)
            patient_id = p["id"]
            patients.append(p)
        elif rtype == "Condition" and patient_id:
            conditions.append(parse_condition(resource, patient_id))
        elif rtype == "MedicationRequest" and patient_id:
            medications.append(parse_medication(resource, patient_id))
        elif rtype == "Encounter" and patient_id:
            encounters.append(parse_encounter(resource, patient_id))
        elif rtype == "Observation" and patient_id:
            observations.append(parse_observation(resource, patient_id))

    cur = conn.cursor()

    for p in patients:
        cur.execute("""
            INSERT OR REPLACE INTO patients (id, name, birthdate, gender, city, state, race, ethnicity, marital_status, phone)
            VALUES (:id, :name, :birthdate, :gender, :city, :state, :race, :ethnicity, :marital_status, :phone)
        """, p)

    for c in conditions:
        cur.execute("""
            INSERT OR REPLACE INTO conditions (id, patient_id, snomed_code, icd10_code, description, onset_date, status)
            VALUES (:id, :patient_id, :snomed_code, :icd10_code, :description, :onset_date, :status)
        """, c)

    for m in medications:
        cur.execute("""
            INSERT OR REPLACE INTO medications (id, patient_id, name, rxnorm_code, status, date, dosage)
            VALUES (:id, :patient_id, :name, :rxnorm_code, :status, :date, :dosage)
        """, m)

    for e in encounters:
        cur.execute("""
            INSERT OR REPLACE INTO encounters (id, patient_id, type, encounter_class, start_date, end_date, reason, provider)
            VALUES (:id, :patient_id, :type, :encounter_class, :start_date, :end_date, :reason, :provider)
        """, e)

    for o in observations:
        cur.execute("""
            INSERT OR REPLACE INTO observations (id, patient_id, type, loinc_code, value, unit, date)
            VALUES (:id, :patient_id, :type, :loinc_code, :value, :unit, :date)
        """, o)

    conn.commit()
    return len(patients), len(conditions), len(medications), len(encounters), len(observations)


def main():
    if not FHIR_DIR.exists():
        print(f"ERROR: FHIR directory not found at {FHIR_DIR}")
        return

    fhir_files = list(FHIR_DIR.glob("*.json"))
    print(f"Found {len(fhir_files)} FHIR bundle files")

    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = sqlite3.connect(str(DB_PATH))
    init_db(conn)

    totals = {"patients": 0, "conditions": 0, "medications": 0, "encounters": 0, "observations": 0}

    for i, fpath in enumerate(fhir_files, 1):
        try:
            p, c, m, e, o = process_bundle(fpath, conn)
            totals["patients"] += p
            totals["conditions"] += c
            totals["medications"] += m
            totals["encounters"] += e
            totals["observations"] += o
            if i % 10 == 0 or i == len(fhir_files):
                print(f"  Processed {i}/{len(fhir_files)} files...")
        except Exception as ex:
            print(f"  ERROR processing {fpath.name}: {ex}")

    print("\n=== IMPORT SUMMARY ===")
    print(f"  Patients:     {totals['patients']}")
    print(f"  Conditions:   {totals['conditions']}")
    print(f"  Medications:  {totals['medications']}")
    print(f"  Encounters:   {totals['encounters']}")
    print(f"  Observations: {totals['observations']}")

    # Quick verification queries
    cur = conn.cursor()
    cur.execute("SELECT COUNT(DISTINCT patient_id) FROM conditions")
    print(f"\n  Patients with conditions: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(DISTINCT patient_id) FROM medications")
    print(f"  Patients with medications: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(DISTINCT patient_id) FROM encounters")
    print(f"  Patients with encounters: {cur.fetchone()[0]}")

    # Show top 5 conditions
    cur.execute("""
        SELECT description, COUNT(*) as cnt
        FROM conditions
        GROUP BY description
        ORDER BY cnt DESC
        LIMIT 10
    """)
    print("\n  Top 10 Conditions:")
    for row in cur.fetchall():
        print(f"    {row[0]}: {row[1]}")

    conn.close()
    print(f"\nDatabase saved to: {DB_PATH}")


if __name__ == "__main__":
    main()
